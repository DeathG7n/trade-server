/* eslint-disable no-undef */
import WebSocket from "ws";
import express from "express";
import cors from "cors";
import axios from "axios";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

import {
  bullish,
  bearish,
  structureBias,
  weakStrongLevels,
  detectBosChoch,
  previousDayRange,
  findSwings,
} from "./util.js";

dotenv.config();

const app = express();

let ws = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let intentionalClose = false;
let pingTimer = null;
let lastActivityAt = 0; // any server message counts as alive
const PING_INTERVAL_MS = 30000; // Deriv keep-alive: send { ping: 1 }
const STALE_CONNECTION_MS = 90000; // only force-close if fully silent
const RECONNECT_MIN_GAP_MS = 15000; // avoid tight reconnect loops
let lastReconnectScheduledAt = 0;
let connecting = false; // prevent concurrent connectWebSocket

const API_TOKEN = process.env.API_TOKEN;
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const APP_ID = process.env.APP_ID;
const ACCOUNT_ID = process.env.ACCOUNT_ID;
const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri);

let positions = [];
let amount = null;
let balance = null;
let now = new Date();
let connection = false;
let authorized = false;
let portfolioSynced = false;
let lastBalance = null;

// Structure strategy timeframes
const TF_DAILY = 86400;
const TF_4H = 14400;
const TF_15M = 900;
const TF_5M = 300;
const timeframes = [TF_DAILY, TF_4H, TF_15M, TF_5M];
const HISTORY_RESYNC_MS = 15 * 60 * 1000;
// Multiplier risk: SL = stake/PORTION, TP = 3x SL
const MULT_PORTION = 4;
const SWING_LEFT = 2;
const SWING_RIGHT = 2;
const subscribedContracts = new Set();
const contractStates = new Map();
const pendingTrades = new Map();

const symbols = [
  // "stpRNG",
  // "stpRNG2",
  // "stpRNG3",
  // "stpRNG4",
  // "stpRNG5",
  // "1HZ10V",
  // "R_10",
  // "1HZ15V",
  // "1HZ25V",
  "R_25",
  // "1HZ30V",
  // "1HZ50V",
  // "R_50",
  // "1HZ75V",
  //"R_75",
  // "1HZ90V",
  // "1HZ100V",
  //"R_100",
  // "JD10",
  // "JD25",
  // "JD50",
  // "JD75",
  "JD100",
];

const tradeSymbols = [
  // "stpRNG",
  // "stpRNG2",
  // "stpRNG3",
  // "stpRNG4",
  // "stpRNG5",
  "1HZ10V",
  "R_10",
  "1HZ15V",
  "1HZ25V",
  "R_25",
  "1HZ30V",
  "1HZ50V",
  "R_50",
  "1HZ75V",
  "R_75",
  "1HZ90V",
  "1HZ100V",
  "R_100",
  // "JD10",
  // "JD25",
  // "JD50",
  // "JD75",
  // "JD100",
];

const alertSymbols = [
  // "stpRNG",
  // "stpRNG2",
  // "stpRNG3",
  // "stpRNG4",
  // "stpRNG5",
  // "1HZ10V",
  // "R_10",
  // "1HZ25V",
  "R_25",
  // "1HZ50V",
  // "R_50",
  // "1HZ75V",
  // "R_75",
  // "1HZ100V",
  // "R_100",
  // "JD10",
  // "JD25",
  // "JD50",
  // "JD75",
  "JD100",
];

const marketData = {};

function emptySeries() {
  return { close: [], open: [], high: [], low: [], openTime: 0, historyPending: false, lastHistoryAt: 0 };
}

symbols.forEach((symbol) => {
  marketData[symbol] = {
    // Per-timeframe OHLCV-like series
    daily: emptySeries(),
    h4: emptySeries(),
    m15: emptySeries(),
    m5: emptySeries(),
    // Legacy aliases used in older close logic
    close: [],
    open: [],
    high: [],
    low: [],
    openTime: 0,
    bias: "none", // 4H structure bias
    dayRange: null,
    lastBosChoch: null,
    canAlertBias: true,
    canAlertStructure: true,
    canAlertBos: true,
    multiplier_range: [],
    tradeState: "IDLE",
    pendingProposalId: null,
    entryCandle: 0,
  };
});

function seriesForGranularity(md, granularity) {
  if (granularity === TF_DAILY) return md.daily;
  if (granularity === TF_4H) return md.h4;
  if (granularity === TF_15M) return md.m15;
  if (granularity === TF_5M) return md.m5;
  return null;
}

app.use(cors());

app.get("/", (req, res) => {
  res.json("Hi");
});

app.listen(3000, () => {
  console.log("Server is running");
});

function send(message) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.log("⚠️ Cannot send message: WebSocket is not open");
    return false;
  }

  try {
    ws.send(JSON.stringify(message));
    return true;
  } catch (error) {
    console.error("❌ WebSocket send error:", error.message);
    return false;
  }
}

const sendMessage = async (message) => {
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

    await axios.post(url, {
      chat_id: CHAT_ID,
      text: message,
    });

    console.log("Message sent successfully!");
  } catch (error) {
    console.error(
      "Error sending message:",
      error.response?.data || error?.message,
    );
  }
};

function getContractState(contractId) {
  return contractStates.get(contractId);
}

function setContractState(contractId, state, extra = {}) {
  if (!contractId) return;

  const current = contractStates.get(contractId) || {};

  contractStates.set(contractId, {
    ...current,
    state,
    ...extra,
    updatedAt: Date.now(),
  });

  console.log(`🔄 Contract ${contractId} state -> ${state}`);
}

function deleteContractState(contractId) {
  if (!contractId) return;

  contractStates.delete(contractId);
}

function setSymbolPending(symbol, state, proposalId = null) {
  const md = marketData[symbol];

  if (!md) return;

  md.tradeState = state;
  md.pendingProposalId = proposalId;

  pendingTrades.set(symbol, {
    state,
    proposalId,
    updatedAt: Date.now(),
  });

  console.log(`🔄 ${symbol} state -> ${state}`);
}

function clearSymbolPending(symbol) {
  const md = marketData[symbol];

  if (!md) return;

  md.tradeState = "IDLE";
  md.pendingProposalId = null;

  pendingTrades.delete(symbol);

  console.log(`🔄 ${symbol} state -> IDLE`);
}

async function getMultiProposal(direction, symbol, stake, multiplier, portion) {
  const stopLoss = stake / portion;
  const takeProfit = stopLoss * 3;

  const request = {
    proposal: 1,
    amount: stake,
    contract_type: direction,
    currency: "USD",
    underlying_symbol: symbol,
    multiplier: multiplier,
    basis: "stake",

    limit_order: {
      stop_loss: stopLoss,
      take_profit: takeProfit,
    },
  };

  send(request);
}



function buyContract(direction, id, stake) {
  console.log(`📈 Buying ${direction} contract...`);

  send({
    buy: id,
    price: stake,
  });
}

function closePosition(symbol, contractId, reason) {
  if (!contractId) return;

  const state = getContractState(contractId);

  if (state?.state === "CLOSING") {
    console.log(`⏳ Contract ${contractId} is already CLOSING`);
    return;
  }

  const position = positions.find((p) => p.contract_id === contractId);

  if (!position) {
    console.log(`⚠️ Cannot close unknown contract ${contractId}`);
    return;
  }

  setContractState(contractId, "CLOSING", {
    symbol,
    reason,
  });

  position.reason = reason;

  console.log(`❌ Closing position ${contractId} on ${symbol}`);

  send({
    sell: contractId,
    price: 0,
  });

  sendMessage(
    `❌ Closing contract ${contractId} on ${symbol} because ${reason}`,
  );
}

async function connect() {
  try {
    await client.connect();

    console.log("Connected successfully to MongoDB");

    connection = true;
    authorized = false;
  } catch (error) {
    console.error("MongoDB connection error:", error);
  }
}

async function update(stop, id, symbol) {
  try {
    if (!symbol || !id) return;

    const database = client.db("trading");
    const collection = database.collection("trade");

    await collection.findOneAndUpdate(
      {
        contract_id: id,
      },
      {
        $set: {
          stoploss: stop,
        },
      },
    );

    send({
      portfolio: 1,
    });
  } catch (error) {
    console.error(error);
  }
}

await connect();

/*
|--------------------------------------------------------------------------
| FRESH DERIV OTP (new trading API)
| Demo or real: POST /trading/v1/options/accounts/{accountId}/otp
| Connect to returned URL. Do NOT send authorize after connect.
|--------------------------------------------------------------------------
*/

async function getFreshWsUrl() {
  if (!APP_ID) {
    throw new Error("APP_ID is missing");
  }

  if (!ACCOUNT_ID) {
    throw new Error("ACCOUNT_ID is missing");
  }

  if (!API_TOKEN) {
    throw new Error("API_TOKEN is missing");
  }

  const url = `https://api.derivws.com/trading/v1/options/accounts/${ACCOUNT_ID}/otp`;

  console.log("🔐 Requesting fresh Deriv OTP...");
  console.log("Account ID:", ACCOUNT_ID);

  const otpResponse = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "Deriv-App-ID": APP_ID,
      "Content-Type": "application/json",
    },
  });

  const responseText = await otpResponse.text();

  console.log("OTP Status:", otpResponse.status);

  if (!otpResponse.ok) {
    throw new Error(
      `Deriv OTP request failed (${otpResponse.status}): ${responseText}`,
    );
  }

  let otpResult;

  try {
    otpResult = JSON.parse(responseText);
  } catch {
    throw new Error(
      `Deriv returned non-JSON response: ${responseText.substring(0, 300)}`,
    );
  }

  const freshWsUrl = otpResult?.data?.url;

  if (!freshWsUrl) {
    throw new Error(
      `WebSocket URL was not returned by Deriv: ${JSON.stringify(otpResult)}`,
    );
  }

  console.log("✅ Fresh WebSocket URL obtained");

  return freshWsUrl;
}

/*
|--------------------------------------------------------------------------
| WEBSOCKET CONNECTION MANAGEMENT
|--------------------------------------------------------------------------
*/

const reconnectBaseDelay = 5000;
const reconnectMaxDelay = 300000;

function stopPing() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

function startPing() {
  stopPing();
  lastActivityAt = Date.now();

  pingTimer = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    // Only force-close if the socket is fully silent.
    // Deriv replies to { ping: 1 } with msg_type "ping" and ping: "pong"
    // (NOT msg_type "pong"). Any inbound message updates lastActivityAt.
    if (lastActivityAt && Date.now() - lastActivityAt > STALE_CONNECTION_MS) {
      console.warn("⚠️ Socket silent (no messages) — closing for reconnect");
      stopPing();
      try {
        ws.close();
      } catch (error) {
        sendMessage(`❌ Error closing WebSocket: ${error.message}`);
      }
      return;
    }

    try {
      send({ ping: 1 });
      if (typeof ws.ping === "function") {
        ws.ping();
      }
    } catch (error) {
      console.error("❌ Ping failed:", error.message);
    }
  }, PING_INTERVAL_MS);
}

function resetConnectionState() {
  authorized = false;
  portfolioSynced = false;
  connection = false;
  stopPing();
  subscribedContracts.clear();
}

function scheduleReconnect() {
  if (intentionalClose) {
    return;
  }

  if (reconnectTimer) {
    return;
  }

  reconnectAttempts++;

  // Exponential backoff + jitter: 5s → 10s → 20s … max 5 min
  let delay = Math.min(
    reconnectBaseDelay * 2 ** (reconnectAttempts - 1),
    reconnectMaxDelay,
  );
  delay = Math.round(delay * (0.8 + Math.random() * 0.4));

  const sinceLast = Date.now() - lastReconnectScheduledAt;
  if (lastReconnectScheduledAt && sinceLast < RECONNECT_MIN_GAP_MS) {
    delay = Math.max(delay, RECONNECT_MIN_GAP_MS - sinceLast);
  }

  lastReconnectScheduledAt = Date.now();

  console.log(
    `🔄 WebSocket reconnect scheduled in ${Math.round(
      delay / 1000,
    )}s (attempt ${reconnectAttempts})`,
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWebSocket();
  }, delay);
}

async function connectWebSocket() {
  if (intentionalClose) {
    return;
  }

  if (connecting) {
    console.log("⚠️ connectWebSocket already in progress");
    return;
  }

  if (
    ws &&
    (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
  ) {
    console.log("⚠️ WebSocket is already connected/connecting");
    return;
  }

  connecting = true;
  console.log("🔌 Connecting to Deriv WebSocket...");

  resetConnectionState();

  /*
   * IMPORTANT:
   * Request a NEW OTP every time we create a WebSocket.
   * This prevents reconnects from reusing an expired/used
   * OTP WebSocket URL.
   */
  let freshWsUrl;

  try {
    freshWsUrl = await getFreshWsUrl();
  } catch (error) {
    console.error("❌ Failed to obtain fresh Deriv OTP:", error.message);
    connecting = false;
    scheduleReconnect();
    return;
  }

  if (intentionalClose) {
    connecting = false;
    return;
  }

  ws = new WebSocket(freshWsUrl);

  ws.on("open", () => {
    // New Deriv API: OTP WebSocket is already authenticated.
    // Do NOT send { authorize: API_TOKEN }.
    console.log(
      "🔌 Connected to Deriv WebSocket (OTP — already authenticated)",
    );

    connecting = false;
    reconnectAttempts = 0;
    connection = true;
    authorized = true;
    lastActivityAt = Date.now();

    // Periodic ping keeps idle proxies/firewalls from dropping the socket (1006)
    startPing();

    send({
      balance: 1,
      subscribe: 1,
    });

    send({
      portfolio: 1,
    });

    symbols.forEach((symbol) => {
      send({
        contracts_for: symbol,
      });

      timeframes.forEach((timeframe) => {
        send({
          ticks_history: symbol,
          style: "candles",
          count: 500,
          granularity: timeframe,
          end: "latest",
          subscribe: 1,
        });
      });
    });
  });

  ws.on("error", (error) => {
    console.error("❌ WebSocket error:", error.message);
  });

  ws.on("close", (code, reason) => {
    console.log(
      `🔌 WebSocket disconnected. Code: ${code}, Reason: ${
        reason?.toString() || "Unknown"
      }`,
    );

    connecting = false;
    resetConnectionState();

    if (!intentionalClose) {
      sendMessage(
        `WebSocket disconnected (${code}). Reconnecting with backoff...`,
      );
      scheduleReconnect();
    }
  });

  ws.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg);

      // Any message proves the socket is alive
      lastActivityAt = Date.now();

      // Deriv answers { ping: 1 } with msg_type "ping" and ping: "pong"
      if (
        data.msg_type === "ping" ||
        data.msg_type === "pong" ||
        data.ping === "pong" ||
        data.pong === 1
      ) {
        return;
      }

      // Legacy authorize response — not used with OTP sockets.
      // Kept only so unexpected authorize messages do not break the handler.
      if (data.msg_type === "authorize") {
        if (data.error) {
          console.error(
            "❌ Unexpected authorize error on OTP socket:",
            data.error,
          );
          return;
        }

        console.log("✅ Authorize message received (optional on OTP socket)");
        authorized = true;
        connection = true;
        return;
      }

      if (data.msg_type === "balance") {
        balance = data.balance.balance;

        if (balance !== lastBalance) {
          console.log(`💸 Balance is currently ${balance}`);

          lastBalance = balance;
        }

        balance = Math.trunc(balance);

        if (balance < 7) {
          amount = 1;
        } else {
          const forefeit = 2 ** Math.floor(Math.log2(balance / 7) + 1);

          amount = Math.min(1000, forefeit);
        }

        send({
          portfolio: 1,
        });

        return;
      }

      if (data.msg_type === "portfolio") {
        const database = client.db("trading");
        const collection = database.collection("trade");

        const portfolioContracts = data?.portfolio?.contracts || [];

        const activeContractIds = new Set(
          portfolioContracts.map((contract) => contract.contract_id),
        );

        const assets = await collection.find({}).toArray();

        for (const asset of assets) {
          const contractId = asset.contract_id;

          if (!activeContractIds.has(contractId)) {
            console.log(`🗑️ Contract ${contractId} is no longer in portfolio`);

            deleteContractState(contractId);

            subscribedContracts.delete(contractId);

            positions = positions.filter((p) => p.contract_id !== contractId);

            await collection.deleteOne({
              contract_id: contractId,
            });
          }
        }

        for (const contract of portfolioContracts) {
          const contractId = contract.contract_id;

          const symbol = contract.underlying_symbol;

          let position = await collection.findOne({
            contract_id: contractId,
          });

          if (!position) {
            position = {
              name: symbol,
              contract_id: contractId,
              stoploss: 0,
              date_start: contract.date_start,
              type: contract.contract_type,
            };

            await collection.insertOne(position);

            console.log(`📝 Document created for ${contractId}`);
          }

          const existingIndex = positions.findIndex(
            (p) => p.contract_id === contractId,
          );

          if (existingIndex === -1) {
            positions.push(position);
          }

          const currentState = getContractState(contractId);

          if (currentState?.state === "CLOSING") {
            console.log(`⏳ ${contractId} remains CLOSING`);
          } else {
            setContractState(contractId, "OPEN", {
              symbol,
              type: contract.contract_type,
            });
          }

          const md = marketData[symbol];

          if (
            md &&
            (md.tradeState === "PROPOSAL_PENDING" ||
              md.tradeState === "BUY_PENDING")
          ) {
            clearSymbolPending(symbol);
          }

          if (!subscribedContracts.has(contractId)) {
            console.log(`📡 Subscribing to contract ${contractId}`);

            send({
              proposal_open_contract: 1,
              contract_id: contractId,
              subscribe: 1,
            });

            subscribedContracts.add(contractId);
          }
        }

        if (!portfolioSynced) {
          portfolioSynced = true;

          console.log("✅ Portfolio synchronized");
        }

        return;
      }

      if (data.msg_type === "contracts_for") {
        const symbol = data.echo_req.contracts_for;

        const md = marketData[symbol];

        if (!md) return;

        for (
          let index = 0;
          index < data?.contracts_for?.available?.length;
          index++
        ) {
          if (
            data?.contracts_for?.available[index]?.contract_category ===
            "multiplier"
          ) {
            md.multiplier_range =
              data?.contracts_for?.available[index]?.multiplier_range;
          }
        }

        return;
      }


      if (data.msg_type === "candles") {
        const symbol = data.echo_req.ticks_history;
        const md = marketData[symbol];
        if (!md || !data.candles?.length) return;

        const current = new Date();
        if (now.getHours() !== current.getHours()) {
          now = new Date();
          sendMessage("Bot is still running");
        }

        try {
          const series = seriesForGranularity(md, data.echo_req.granularity);
          if (!series) return;
          series.close = data.candles.map((c) => Number(c.close));
          series.open = data.candles.map((c) => Number(c.open));
          series.high = data.candles.map((c) => Number(c.high));
          series.low = data.candles.map((c) => Number(c.low));
          series.historyPending = false;
          series.lastHistoryAt = Date.now();
          // Keep m5 mirrored on legacy fields for any residual code
          if (data.echo_req.granularity === TF_5M) {
            md.close = series.close;
            md.open = series.open;
            md.high = series.high;
            md.low = series.low;
          }
        } catch (error) {
          sendMessage(String(error));
        }
        return;
      }

      if (data.msg_type === "ohlc" && portfolioSynced) {
        const symbol = data.echo_req.ticks_history;
        const md = marketData[symbol];
        if (!md) return;

        if (!md.multiplier_range?.length) {
          console.log(`⛔ ${symbol}: No multiplier range available`);
          return;
        }

        const granularity = data.echo_req.granularity;
        const series = seriesForGranularity(md, granularity);
        if (!series) return;

        // --- Update series (in-place OHLC) ---
        if (series.openTime === 0) {
          series.openTime = data.ohlc.open_time;
        }
        const isNewCandle = series.openTime !== data.ohlc.open_time;
        if (isNewCandle) {
          series.openTime = data.ohlc.open_time;
          series.close.push(Number(data.ohlc.close));
          series.open.push(Number(data.ohlc.open));
          series.high.push(Number(data.ohlc.high));
          series.low.push(Number(data.ohlc.low));
          const MAX_BARS = 600;
          if (series.close.length > MAX_BARS) {
            const drop = series.close.length - MAX_BARS;
            series.close.splice(0, drop);
            series.open.splice(0, drop);
            series.high.splice(0, drop);
            series.low.splice(0, drop);
          }
          if (granularity === TF_5M) {
            md.canAlertBos = true;
            md.canAlertStructure = true;
          }
          if (granularity === TF_4H) md.canAlertBias = true;
          // Periodic history resync
          const needHistory =
            series.close.length < 50 ||
            Date.now() - series.lastHistoryAt > HISTORY_RESYNC_MS;
          if (needHistory && !series.historyPending) {
            series.historyPending = true;
            send({
              ticks_history: symbol,
              style: "candles",
              count: 500,
              granularity,
              end: "latest",
            });
          }
        } else if (series.close.length === 0) {
          series.close.push(Number(data.ohlc.close));
          series.open.push(Number(data.ohlc.open));
          series.high.push(Number(data.ohlc.high));
          series.low.push(Number(data.ohlc.low));
        } else {
          const last = series.close.length - 1;
          series.close[last] = Number(data.ohlc.close);
          series.open[last] = Number(data.ohlc.open);
          series.high[last] = Number(data.ohlc.high);
          series.low[last] = Number(data.ohlc.low);
        }

        if (granularity === TF_5M) {
          md.close = series.close;
          md.open = series.open;
          md.high = series.high;
          md.low = series.low;
        }

        // Only evaluate structure / entries on a newly closed 5m bar
        if (granularity !== TF_5M || !isNewCandle) {
          return;
        }
        if (series.historyPending) return;

        const m5 = md.m5;
        const h4 = md.h4;
        const m15 = md.m15;
        const daily = md.daily;
        const signalIndex = m5.close.length - 2;
        if (signalIndex < 10) return;

        // Daily range (previous completed day)
        if (daily.close.length >= 2) {
          const dIdx = daily.close.length - 2;
          md.dayRange = previousDayRange(daily.high, daily.low, dIdx);
        }

        // 4H bias
        if (h4.close.length >= 20) {
          const prevBias = md.bias;
          md.bias = structureBias(h4.high, h4.low, SWING_LEFT, SWING_RIGHT);
          if (
            md.canAlertBias &&
            md.bias !== "none" &&
            md.bias !== prevBias &&
            alertSymbols.includes(symbol)
          ) {
            sendMessage(
              `📐 ${symbol} 4H bias → ${md.bias.toUpperCase()}`,
            );
            md.canAlertBias = false;
          }
        }

        // 15m weak/strong levels (alerts)
        if (m15.close.length >= 30 && md.canAlertStructure) {
          const levels = weakStrongLevels(
            m15.high,
            m15.low,
            SWING_LEFT,
            SWING_RIGHT,
          );
          const tips = [];
          if (levels.weakHighs.length) {
            const wh = levels.weakHighs[levels.weakHighs.length - 1];
            tips.push(`WeakHigh@${wh.price.toFixed(2)}`);
          }
          if (levels.weakLows.length) {
            const wl = levels.weakLows[levels.weakLows.length - 1];
            tips.push(`WeakLow@${wl.price.toFixed(2)}`);
          }
          if (tips.length && alertSymbols.includes(symbol)) {
            sendMessage(`🏷 ${symbol} 15m structure: ${tips.join(" | ")}`);
            md.canAlertStructure = false;
          }
        }

        // 5m BOS / CHOCH
        const event = detectBosChoch(
          m5.high,
          m5.low,
          m5.close,
          signalIndex,
          md.bias,
          SWING_LEFT,
          SWING_RIGHT,
        );

        if (event && md.canAlertBos) {
          md.lastBosChoch = event;
          const msg = `⚡ ${symbol} 5m ${event.type} ${event.direction} @ ${Number(event.level).toFixed(2)} (bias=${md.bias})`;
          console.log(msg);
          if (alertSymbols.includes(symbol)) {
            sendMessage(msg);
          }
          md.canAlertBos = false;
        }

        // --- Multiplier entry: bias-aligned BOS/CHOCH ---
        const matchingPositions = positions.filter((p) => p?.name === symbol);
        const openMult = matchingPositions.filter(
          (p) => p.type === "MULTUP" || p.type === "MULTDOWN",
        );
        const symbolIsPending =
          md.tradeState === "PROPOSAL_PENDING" ||
          md.tradeState === "BUY_PENDING";
        const hasOpen = openMult.length > 0;

        if (
          event &&
          !hasOpen &&
          !symbolIsPending &&
          md.tradeState === "IDLE" &&
          Math.trunc(balance) !== 0 &&
          amount != null &&
          amount <= balance &&
          tradeSymbols.includes(symbol) &&
          md.multiplier_range?.length
        ) {
          const bullEntry =
            (event.direction === "bullish" &&
              (md.bias === "up" || md.bias === "none") &&
              (event.type === "BOS" || event.type === "CHOCH"));
          const bearEntry =
            (event.direction === "bearish" &&
              (md.bias === "down" || md.bias === "none") &&
              (event.type === "BOS" || event.type === "CHOCH"));

          // Prefer trading only with clear 4H bias when available
          const allowBull = md.bias === "up" && event.direction === "bullish";
          const allowBear = md.bias === "down" && event.direction === "bearish";

          if (allowBull) {
            md.entryCandle = data.ohlc.open_time;
            setSymbolPending(symbol, "PROPOSAL_PENDING");
            sendMessage(
              `📈 ${symbol} MULTUP — 5m ${event.type} bullish with 4H up bias`,
            );
            try {
              await getMultiProposal(
                "MULTUP",
                symbol,
                amount,
                md.multiplier_range[0],
                MULT_PORTION,
              );
            } catch (error) {
              clearSymbolPending(symbol);
              sendMessage(String(error));
            }
          } else if (allowBear) {
            md.entryCandle = data.ohlc.open_time;
            setSymbolPending(symbol, "PROPOSAL_PENDING");
            sendMessage(
              `📉 ${symbol} MULTDOWN — 5m ${event.type} bearish with 4H down bias`,
            );
            try {
              await getMultiProposal(
                "MULTDOWN",
                symbol,
                amount,
                md.multiplier_range[0],
                MULT_PORTION,
              );
            } catch (error) {
              clearSymbolPending(symbol);
              sendMessage(String(error));
            }
          }
        }

        // Opposite bias exit for open multipliers
        for (const position of openMult) {
          const contractId = position.contract_id;
          const st = getContractState(contractId);
          if (st?.state === "CLOSING") continue;
          if (position.type === "MULTUP" && md.bias === "down") {
            try {
              closePosition(symbol, contractId, "4H bias flipped down");
            } catch (e) {
              sendMessage(String(e));
            }
          } else if (position.type === "MULTDOWN" && md.bias === "up") {
            try {
              closePosition(symbol, contractId, "4H bias flipped up");
            } catch (e) {
              sendMessage(String(e));
            }
          }
        }

        return;
      }

      if (data.msg_type === "proposal") {
        const symbol = data?.echo_req?.underlying_symbol;

        const md = marketData[symbol];

        if (!md) return;

        const proposalId = data?.proposal?.id;

        if (!proposalId) {
          console.log(`⚠️ Proposal response without ID for ${symbol}`);

          clearSymbolPending(symbol);

          return;
        }

        setSymbolPending(symbol, "BUY_PENDING", proposalId);

        try {
          const ctype = data?.echo_req?.contract_type;
          const barrier = data?.echo_req?.barrier;
          if (ctype === "ONETOUCH") {
            sendMessage(
              `🎯 Buying ONETOUCH ${symbol} barrier=${barrier ?? "?"} ask=${data?.proposal?.ask_price}`,
            );
          }
          buyContract(
            ctype,
            proposalId,
            data?.proposal?.ask_price,
          );
        } catch (error) {
          clearSymbolPending(symbol);

          sendMessage(String(error));
        }

        return;
      }

      if (data.msg_type === "proposal_open_contract") {
        const id = data?.echo_req?.contract_id;

        const contract = data?.proposal_open_contract;

        if (!contract) return;

        const position = positions.find((p) => p.contract_id === id);

        const symbol = contract?.underlying_symbol;

        const commission = contract?.commission;

        const multiplier = contract?.multiplier;

        const type = contract?.contract_type;

        const entrySpot = Number(contract?.entry_spot);

        const currentSpot = Number(contract?.current_spot);

        const orderAmount = contract?.buy_price;

        const lossAmount = contract?.limit_order?.stop_loss?.order_amount;

        const profitAmount = contract?.limit_order?.take_profit?.order_amount;

        const stopOut = Number(contract?.limit_order?.stop_out?.value);

        const stop = Number(contract?.limit_order?.stop_loss?.value);

        const takeProfit = Number(contract?.limit_order?.take_profit?.value);

        const pip =
          type === "MULTUP" ? currentSpot - entrySpot : entrySpot - currentSpot;

        const loss =
          type === "MULTUP" ? entrySpot - stopOut : stopOut - entrySpot;

        const risk = type === "MULTUP" ? entrySpot - stop : stop - entrySpot;

        const gain =
          type === "MULTUP" ? takeProfit - entrySpot : entrySpot - takeProfit;

        const profit = Number(contract?.profit);

        const duration = contract?.current_spot_time - contract?.date_start;

        const state = getContractState(id);

        if (!state) {
          setContractState(id, "OPEN", {
            symbol,
            type,
          });
        }

        if (position) {
          position.subscribed = true;
          position.profit = profit;
          position.amount = orderAmount;
          position.risk = lossAmount;
          // Persist touch barrier for close rules
          if (type === "ONETOUCH") {
            const barrier =
              contract?.barrier ??
              data?.echo_req?.barrier ??
              marketData[symbol]?.pendingTouchBarrier;
            if (barrier != null && barrier !== "") {
              position.barrier = String(barrier);
            }
          }
        }



        if (connection && type !== "ONETOUCH") {
          if (!position) {
            return;
          }

          if (loss == null) {
            return;
          }

          const currentContractState = getContractState(id);

          if (currentContractState?.state === "CLOSING") {
            return;
          }

          if (pip >= risk && position.stoploss === 0) {
            position.stoploss = Math.abs(commission);

            await update(position.stoploss, id, symbol);
          }

          if (pip >= risk * 2 && position.stoploss === Math.abs(commission)) {
            position.stoploss = Math.abs(lossAmount);

            await update(position.stoploss, id, symbol);
          }

          if (pip >= risk * 3 && position.stoploss === Math.abs(lossAmount)) {
            position.stoploss = Math.abs(lossAmount * 2);

            await update(position.stoploss, id, symbol);
          }

          if (
            pip >= risk * 6 &&
            position.stoploss === Math.abs(lossAmount * 2)
          ) {
            position.stoploss = Math.abs(lossAmount * 4);

            await update(position.stoploss, id, symbol);
          }

          if (
            pip >= risk * 10 &&
            position.stoploss === Math.abs(lossAmount * 4)
          ) {
            position.stoploss = Math.abs(lossAmount * 8);

            await update(position.stoploss, id, symbol);
          }

          if (position.stoploss !== 0 && profit <= position.stoploss) {
            closePosition(symbol, id, "Stop Loss Hit");
          }
        }

        const runningTrade = {
          contractId: id,
          multiplier,
          pip,
          profit,
          loss,
          orderAmount,
          stopOutAmount: stopOut,
          lossAmount,
          profitAmount,
          gain,
          risk,
          stopLoss: position?.stoploss,
          symbol,
          type,
          state: getContractState(id)?.state,
        };

        if (duration <= 2) {
          sendMessage(JSON.stringify(runningTrade, null, 2));
        }

        console.log(runningTrade);

        return;
      }

      if (data.msg_type === "buy") {
        // Buy can fail (e.g. insufficient balance) with error and no buy.contract_id
        if (data.error) {
          const errMsg =
            data.error.message || data.error.code || JSON.stringify(data.error);
          console.error("❌ Buy failed:", errMsg);
          sendMessage(`❌ Buy failed: ${errMsg}`);

          const failSymbol =
            data?.echo_req?.underlying_symbol ||
            data?.echo_req?.passthrough?.symbol;
          // Clear any symbol left in BUY_PENDING / PROPOSAL_PENDING
          for (const sym of Object.keys(marketData)) {
            const md = marketData[sym];
            if (
              md &&
              (md.tradeState === "BUY_PENDING" ||
                md.tradeState === "PROPOSAL_PENDING")
            ) {
              clearSymbolPending(sym);
            }
          }
          if (failSymbol && marketData[failSymbol]) {
            clearSymbolPending(failSymbol);
          }
          return;
        }

        const contractId =
          data?.buy?.contract_id ??
          data?.buy?.contractId ??
          data?.contract_id;

        console.log(`🟢 Bought contract ${contractId}`);
        console.log("Buy response:", JSON.stringify(data?.buy ?? data));

        if (!contractId) {
          console.error(
            "❌ Buy response missing contract_id:",
            JSON.stringify(data),
          );
          sendMessage(
            `❌ Buy response missing contract_id — check balance/stake. Raw: ${JSON.stringify(data?.buy ?? data?.error ?? {})}`,
          );
          for (const sym of Object.keys(marketData)) {
            const md = marketData[sym];
            if (
              md &&
              (md.tradeState === "BUY_PENDING" ||
                md.tradeState === "PROPOSAL_PENDING")
            ) {
              clearSymbolPending(sym);
            }
          }
          return;
        }

        setContractState(contractId, "OPEN");

        // Subscribe to open-contract updates for touch management / early close
        send({
          proposal_open_contract: 1,
          contract_id: contractId,
          subscribe: 1,
        });

        // Clear pending on the symbol that was buying
        for (const sym of Object.keys(marketData)) {
          const md = marketData[sym];
          if (md && md.tradeState === "BUY_PENDING") {
            clearSymbolPending(sym);
          }
        }

        sendMessage(`🟢 Bought contract ${contractId}`);

        return;
      }

      if (data.msg_type === "sell") {
        const database = client.db("trading");

        const collection = database.collection("trade");

        const contractId = data.sell?.contract_id || data.echo_req?.sell;

        if (!contractId) {
          return;
        }

        const position = positions.find((p) => p.contract_id === contractId);

        if (!position) {
          console.log(`⚠️ Sell response for unknown contract ${contractId}`);

          subscribedContracts.delete(contractId);

          deleteContractState(contractId);

          return;
        }

        const symbol = position.name;

        console.log(
          `💸 Position closed at ${data.sell?.sold_for} USD on ${symbol}`,
        );

        deleteContractState(contractId);

        subscribedContracts.delete(contractId);

        positions = positions.filter((p) => p.contract_id !== contractId);

        await collection.deleteOne({
          contract_id: contractId,
        });

        console.log(`🗑️ Deleted closed contract ${contractId}`);

        return;
      }

      if (data.msg_type === "contract_update") {
        const contractId = data.echo_req?.contract_id;

        const position = positions.find((p) => p.contract_id === contractId);

        if (position) {
          sendMessage(`💸 Position updated on ${position.name}`);
        }

        return;
      }

      if (data.error) {
        const error = data.error.message;

        const echoReq = data.echo_req;

        console.error("❗ Error:", error);

        if (echoReq?.sell) {
          const contractId = echoReq.sell;

          const position = positions.find((p) => p.contract_id === contractId);

          if (position) {
            const state = getContractState(contractId);

            if (state?.state === "CLOSING") {
              setContractState(contractId, "OPEN", {
                symbol: position.name,
                type: position.type,
              });

              console.log(
                `⚠️ Sell failed for ${contractId}; state restored to OPEN`,
              );
            }
          }
        }

        if (echoReq?.underlying_symbol) {
          const symbol = echoReq.underlying_symbol;

          const md = marketData[symbol];

          if (
            md &&
            (md.tradeState === "PROPOSAL_PENDING" ||
              md.tradeState === "BUY_PENDING")
          ) {
            clearSymbolPending(symbol);

            console.log(
              `⚠️ Entry failed for ${symbol}; state restored to IDLE`,
            );
          }
        }

        sendMessage(`❗ Error: ${error}`);

        if (error === "You have reached the rate limit for ticks_history.") {
          if (!ws || ws.readyState !== WebSocket.OPEN || !authorized) {
            return;
          }

          // Wait before resubscribing — immediate flood causes more limits / 1006
          console.log(
            "⏳ Rate limited on ticks_history — waiting 60s before resubscribe...",
          );

          setTimeout(() => {
            if (!ws || ws.readyState !== WebSocket.OPEN || !authorized) {
              return;
            }

            console.log(
              "🔄 Resubscribing candles after rate-limit cooldown...",
            );

            (async () => {
              for (const symbol of symbols) {
                if (!ws || ws.readyState !== WebSocket.OPEN || !authorized) {
                  break;
                }

                send({ contracts_for: symbol });

                for (const timeframe of timeframes) {
                  send({
                    ticks_history: symbol,
                    style: "candles",
                    count: 500,
                    granularity: timeframe,
                    end: "latest",
                    subscribe: 1,
                  });
                  await new Promise((r) => setTimeout(r, 300));
                }
              }

              sendMessage("Candles Resubscribed");
            })();
          }, 60000);
        }

        if (error === "Please log in.") {
          // New API: session expired — get a fresh OTP socket; do not send authorize.
          console.log(
            "⚠️ Session expired — reconnecting with a new OTP WebSocket...",
          );

          authorized = false;

          if (
            ws &&
            (ws.readyState === WebSocket.OPEN ||
              ws.readyState === WebSocket.CONNECTING)
          ) {
            try {
              ws.close();
            } catch (error) {
              console.error("❌ Error closing WebSocket:", error);
            }
          }

          scheduleReconnect();
        }
      }
    } catch (error) {
      console.error("❌ WebSocket message handler error:", error);
    }
  });
}

/*
|--------------------------------------------------------------------------
| START WEBSOCKET
|--------------------------------------------------------------------------
*/

connectWebSocket();

/*
|--------------------------------------------------------------------------
| PROCESS ERROR HANDLING
|--------------------------------------------------------------------------
*/

process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled Rejection:", reason);
});

/*
|--------------------------------------------------------------------------
| GRACEFUL SHUTDOWN
|--------------------------------------------------------------------------
*/

async function shutdown(signal) {
  console.log(`🛑 Received ${signal}. Shutting down...`);

  intentionalClose = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);

    reconnectTimer = null;
  }

  if (
    ws &&
    (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
  ) {
    ws.close();
  }

  try {
    await client.close();

    console.log("✅ MongoDB connection closed");
  } catch (error) {
    console.error("❌ MongoDB shutdown error:", error);
  }

  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("SIGINT", () => shutdown("SIGINT"));