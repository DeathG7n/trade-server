/* eslint-disable no-undef */
import WebSocket from "ws";
import express from "express";
import cors from "cors";
import axios from "axios";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

import { bearish, bullish, calculateATR, crossedPrice } from "./util.js";

dotenv.config();

const app = express();

let ws = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let intentionalClose = false;

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

/*
|--------------------------------------------------------------------------
| CONFIGURATION
|--------------------------------------------------------------------------
*/

const ONE_HOUR = 3600;
const ONE_MINUTE = 60;

const timeframes = [ONE_HOUR, ONE_MINUTE];

const HISTORY_COUNT = 200;
const MAX_CANDLES = 250;

const reconnectBaseDelay = 5000;
const reconnectMaxDelay = 300000;

const INITIAL_REQUEST_DELAY = 350;

const subscribedContracts = new Set();
const contractStates = new Map();
const pendingTrades = new Map();

/*
|--------------------------------------------------------------------------
| SYMBOLS
|--------------------------------------------------------------------------
*/

const symbols = [
  "stpRNG",
  "stpRNG2",
  "stpRNG3",
  "stpRNG4",
  "stpRNG5",

  "1HZ10V",
  "R_10",

  "1HZ25V",
  "R_25",

  "1HZ50V",
  "R_50",

  "1HZ75V",
  "R_75",

  "1HZ100V",
  "R_100",

  // "JD10",
  // "JD25",
  // "JD50",
  // "JD75",
  "JD100",
];

const tradeSymbols = [
  "stpRNG",
  "stpRNG2",
  "stpRNG3",
  "stpRNG4",
  "stpRNG5",

  "1HZ10V",
  "R_10",

  "1HZ25V",
  "R_25",

  "1HZ50V",
  "R_50",

  "1HZ75V",
  "R_75",

  "1HZ100V",
  "R_100",

  // "JD10",
  // "JD25",
  // "JD50",
  // "JD75",
  // "JD100",
];

const alertSymbols = ["R_10", "R_50", "1HZ75V", "JD100"];

/*
|--------------------------------------------------------------------------
| MARKET DATA
|--------------------------------------------------------------------------
*/

const marketData = {};

symbols.forEach((symbol) => {
  marketData[symbol] = {
    // 1-minute candles
    close: [],
    open: [],
    high: [],
    low: [],
    openTime: 0,

    // 1-hour candles
    close1h: [],
    open1h: [],
    high1h: [],
    low1h: [],
    openTime1h: 0,

    // 1-minute trend
    trendUp: false,
    trendDown: false,

    // 1-hour trend
    trendUp1h: false,
    trendDown1h: false,

    // EMA values
    ema1h21: 0,
    ema1h50: 0,

    ema1m21: 0,
    ema1m50: 0,

    multiplier_range: [],

    // Alerts
    canAlert: true,

    // Entry state
    tradeState: "IDLE",
    pendingProposalId: null,

    // Stream readiness
    history1mLoaded: false,
    history1hLoaded: false,

    // Last EMA values
    lastEma1h21: null,
    lastEma1h50: null,
    lastEma1m21: null,
    lastEma1m50: null,
  };
});

/*
|--------------------------------------------------------------------------
| EXPRESS
|--------------------------------------------------------------------------
*/

app.use(cors());

app.get("/", (req, res) => {
  res.json("Hi");
});

app.listen(3000, () => {
  console.log("Server is running");
});

/*
|--------------------------------------------------------------------------
| BASIC HELPERS
|--------------------------------------------------------------------------
*/

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSocketOpen() {
  return ws && ws.readyState === WebSocket.OPEN;
}

function send(message) {
  if (!isSocketOpen()) {
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

/*
|--------------------------------------------------------------------------
| TELEGRAM
|--------------------------------------------------------------------------
*/

const sendMessage = async (message) => {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log("⚠️ Telegram credentials are missing");
    return;
  }

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

/*
|--------------------------------------------------------------------------
| CONTRACT STATE
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| SYMBOL ENTRY STATE
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| EMA
|--------------------------------------------------------------------------
*/

function calculateEMA(prices, period) {
  if (!Array.isArray(prices) || prices.length === 0) {
    return [];
  }

  const k = 2 / (period + 1);
  const emaArray = new Array(prices.length);

  emaArray[0] = Number(prices[0]);

  for (let i = 1; i < prices.length; i++) {
    const price = Number(prices[i]);

    emaArray[i] = price * k + emaArray[i - 1] * (1 - k);
  }

  return emaArray;
}

function calculateNextEMA(previousEMA, price, period) {
  if (!Number.isFinite(previousEMA)) {
    return Number(price);
  }

  const numericPrice = Number(price);

  if (!Number.isFinite(numericPrice)) {
    return previousEMA;
  }

  const k = 2 / (period + 1);

  return numericPrice * k + previousEMA * (1 - k);
}

/*
|--------------------------------------------------------------------------
| CANDLE HELPERS
|--------------------------------------------------------------------------
*/

function appendCandle(md, timeframe, candle) {
  const isOneHour = timeframe === ONE_HOUR;

  const closeArray = isOneHour ? md.close1h : md.close;
  const openArray = isOneHour ? md.open1h : md.open;
  const highArray = isOneHour ? md.high1h : md.high;
  const lowArray = isOneHour ? md.low1h : md.low;

  const openTimeKey = isOneHour ? "openTime1h" : "openTime";

  const openTime = Number(candle.open_time);

  const open = Number(candle.open);
  const high = Number(candle.high);
  const low = Number(candle.low);
  const close = Number(candle.close);

  if (
    !Number.isFinite(openTime) ||
    !Number.isFinite(open) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close)
  ) {
    return false;
  }

  const currentOpenTime = md[openTimeKey];

  /*
   * First live candle after history.
   */
  if (currentOpenTime === 0) {
    md[openTimeKey] = openTime;

    closeArray.push(close);
    openArray.push(open);
    highArray.push(high);
    lowArray.push(low);

    return true;
  }

  /*
   * Same candle:
   * Update the current candle rather than adding another one.
   */
  if (currentOpenTime === openTime) {
    const last = closeArray.length - 1;

    if (last < 0) {
      closeArray.push(close);
      openArray.push(open);
      highArray.push(high);
      lowArray.push(low);
    } else {
      closeArray[last] = close;
      openArray[last] = open;
      highArray[last] = high;
      lowArray[last] = low;
    }

    return true;
  }

  /*
   * New candle:
   * Append it.
   *
   * IMPORTANT:
   * We do NOT call ticks_history here.
   * The existing OHLC subscription continues delivering data.
   */
  md[openTimeKey] = openTime;

  closeArray.push(close);
  openArray.push(open);
  highArray.push(high);
  lowArray.push(low);

  /*
   * Keep arrays bounded.
   */
  while (closeArray.length > MAX_CANDLES) {
    closeArray.shift();
    openArray.shift();
    highArray.shift();
    lowArray.shift();
  }

  if (isOneHour) {
    md.canAlert = true;
  } else {
    md.canAlert = true;
  }

  return true;
}

/*
|--------------------------------------------------------------------------
| TREND / EMA UPDATE
|--------------------------------------------------------------------------
*/

function updateOneHourIndicators(md) {
  const len = md.close1h.length;

  if (len < 50) {
    md.trendUp1h = false;
    md.trendDown1h = false;
    return false;
  }

  const previousIndex = len - 2;
  const currentIndex = len - 1;

  if (previousIndex < 0) {
    return false;
  }

  /*
   * Initial calculation.
   */
  if (md.lastEma1h21 == null || md.lastEma1h50 == null) {
    const ema21 = calculateEMA(md.close1h, 21);
    const ema50 = calculateEMA(md.close1h, 50);

    md.lastEma1h21 = ema21[currentIndex];
    md.lastEma1h50 = ema50[currentIndex];

    md.ema1h21 = ema21[currentIndex];
    md.ema1h50 = ema50[currentIndex];

    md.trendUp1h = ema21[previousIndex] > ema50[previousIndex];
    md.trendDown1h = ema21[previousIndex] < ema50[previousIndex];

    return true;
  }

  /*
   * Recalculate because historical data may have changed.
   *
   * 250 candles is small enough for this operation,
   * but this only occurs on 1-hour OHLC updates.
   */
  const ema21 = calculateEMA(md.close1h, 21);
  const ema50 = calculateEMA(md.close1h, 50);

  md.ema1h21 = ema21[currentIndex];
  md.ema1h50 = ema50[currentIndex];

  md.lastEma1h21 = ema21[currentIndex];
  md.lastEma1h50 = ema50[currentIndex];

  /*
   * IMPORTANT:
   * Trend is determined from the previous CLOSED candle.
   */
  md.trendUp1h = ema21[previousIndex] > ema50[previousIndex];
  md.trendDown1h = ema21[previousIndex] < ema50[previousIndex];

  return true;
}

function updateOneMinuteIndicators(md) {
  const len = md.close.length;

  if (len < 50) {
    md.trendUp = false;
    md.trendDown = false;
    return false;
  }

  const previousIndex = len - 2;

  if (previousIndex < 0) {
    return false;
  }

  const ema21 = calculateEMA(md.close, 21);
  const ema50 = calculateEMA(md.close, 50);

  const currentIndex = len - 1;

  md.ema1m21 = ema21[currentIndex];
  md.ema1m50 = ema50[currentIndex];

  md.lastEma1m21 = ema21[currentIndex];
  md.lastEma1m50 = ema50[currentIndex];

  md.trendUp = ema21[previousIndex] > ema50[previousIndex];
  md.trendDown = ema21[previousIndex] < ema50[previousIndex];

  return true;
}

/*
|--------------------------------------------------------------------------
| DERIV PROPOSAL
|--------------------------------------------------------------------------
*/

async function getMultiProposal(direction, symbol, stake, multiplier) {
  if (!Number.isFinite(Number(stake)) || Number(stake) <= 0) {
    throw new Error(`Invalid stake for ${symbol}: ${stake}`);
  }

  if (!Number.isFinite(Number(multiplier)) || Number(multiplier) <= 0) {
    throw new Error(`Invalid multiplier for ${symbol}: ${multiplier}`);
  }

  const stopLoss = Number(stake) / 2;
  const takeProfit = stopLoss * 3;

  const request = {
    proposal: 1,
    amount: Number(stake),
    contract_type: direction,
    currency: "USD",
    underlying_symbol: symbol,
    multiplier: Number(multiplier),
    basis: "stake",

    limit_order: {
      stop_loss: stopLoss,
      take_profit: takeProfit,
    },
  };

  const sent = send(request);

  if (!sent) {
    throw new Error(`Failed to send proposal request for ${symbol}`);
  }
}

/*
|--------------------------------------------------------------------------
| BUY
|--------------------------------------------------------------------------
*/

function buyContract(direction, id, stake) {
  if (!id) {
    throw new Error("Cannot buy contract without proposal ID");
  }

  if (!Number.isFinite(Number(stake)) || Number(stake) <= 0) {
    throw new Error(`Invalid buy price: ${stake}`);
  }

  console.log(`📈 Buying ${direction} contract...`);

  const sent = send({
    buy: id,
    price: Number(stake),
  });

  if (!sent) {
    throw new Error(`Failed to send buy request for proposal ${id}`);
  }
}

/*
|--------------------------------------------------------------------------
| CLOSE POSITION
|--------------------------------------------------------------------------
*/

function closePosition(symbol, contractId, reason) {
  if (!contractId) {
    return;
  }

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
    type: position.type,
  });

  position.reason = reason;

  console.log(`❌ Closing position ${contractId} on ${symbol}`);

  const sent = send({
    sell: contractId,
    price: 0,
  });

  if (!sent) {
    setContractState(contractId, "OPEN", {
      symbol,
      type: position.type,
    });

    return;
  }

  sendMessage(
    `❌ Closing contract ${contractId} on ${symbol} because ${reason}`,
  );
}

/*
|--------------------------------------------------------------------------
| MONGODB
|--------------------------------------------------------------------------
*/

async function connect() {
  try {
    await client.connect();

    console.log("Connected successfully to MongoDB");

    connection = true;
    authorized = false;
  } catch (error) {
    connection = false;

    console.error("MongoDB connection error:", error.message);
  }
}

async function update(stop, id, symbol) {
  try {
    if (!symbol || !id) {
      return;
    }

    const numericStop = Number(stop);

    if (!Number.isFinite(numericStop)) {
      console.log(`⚠️ Invalid stop-loss value for ${id}: ${stop}`);

      return;
    }

    const database = client.db("trading");
    const collection = database.collection("trade");

    await collection.updateOne(
      {
        contract_id: id,
      },
      {
        $set: {
          stoploss: numericStop,
          updatedAt: new Date(),
        },
      },
    );

    /*
     * IMPORTANT:
     * Do NOT request portfolio here.
     *
     * Previously:
     *
     * DB update
     * → portfolio request
     * → portfolio response
     * → contract subscription
     *
     * This could create unnecessary traffic.
     */
  } catch (error) {
    console.error(
      `❌ MongoDB stop-loss update failed for ${id}:`,
      error.message,
    );
  }
}

await connect();

/*
|--------------------------------------------------------------------------
| RESET MARKET DATA
|--------------------------------------------------------------------------
*/

function resetMarketData() {
  for (const symbol of symbols) {
    const md = marketData[symbol];

    md.close = [];
    md.open = [];
    md.high = [];
    md.low = [];

    md.close1h = [];
    md.open1h = [];
    md.high1h = [];
    md.low1h = [];

    md.openTime = 0;
    md.openTime1h = 0;

    md.trendUp = false;
    md.trendDown = false;

    md.trendUp1h = false;
    md.trendDown1h = false;

    md.ema1h21 = 0;
    md.ema1h50 = 0;

    md.ema1m21 = 0;
    md.ema1m50 = 0;

    md.lastEma1h21 = null;
    md.lastEma1h50 = null;

    md.lastEma1m21 = null;
    md.lastEma1m50 = null;

    md.history1mLoaded = false;
    md.history1hLoaded = false;

    md.canAlert = true;
  }
}

/*
|--------------------------------------------------------------------------
| FRESH DERIV OTP
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
| CONNECTION STATE
|--------------------------------------------------------------------------
*/

function resetConnectionState() {
  authorized = false;
  portfolioSynced = false;
  connection = false;

  subscribedContracts.clear();

  /*
   * Historical market data belongs to the previous
   * WebSocket session, so clear it.
   */
  resetMarketData();
}

/*
|--------------------------------------------------------------------------
| RECONNECT
|--------------------------------------------------------------------------
*/

function scheduleReconnect() {
  if (intentionalClose) {
    return;
  }

  if (reconnectTimer) {
    return;
  }

  reconnectAttempts++;

  const delay = Math.min(
    reconnectBaseDelay * 2 ** (reconnectAttempts - 1),
    reconnectMaxDelay,
  );

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

/*
|--------------------------------------------------------------------------
| INITIAL MARKET SUBSCRIPTIONS
|--------------------------------------------------------------------------
*/

async function subscribeMarketData() {
  if (!isSocketOpen() || !authorized) {
    return;
  }

  console.log("📡 Starting market data subscriptions...");

  for (const symbol of symbols) {
    if (!isSocketOpen() || !authorized) {
      return;
    }

    /*
     * contracts_for is needed for multiplier ranges.
     */
    send({
      contracts_for: symbol,
    });

    await sleep(INITIAL_REQUEST_DELAY);

    /*
     * Request each historical timeframe once.
     *
     * IMPORTANT:
     * These are initial history requests.
     * The returned subscription continues through OHLC.
     */
    for (const timeframe of timeframes) {
      if (!isSocketOpen() || !authorized) {
        return;
      }

      send({
        ticks_history: symbol,
        style: "candles",
        count: HISTORY_COUNT,
        granularity: timeframe,
        end: "latest",
        subscribe: 1,
      });

      await sleep(INITIAL_REQUEST_DELAY);
    }
  }

  console.log("✅ Initial market data subscriptions sent");
}

/*
|--------------------------------------------------------------------------
| WEBSOCKET CONNECTION
|--------------------------------------------------------------------------
*/

async function connectWebSocket() {
  if (intentionalClose) {
    return;
  }

  if (
    ws &&
    (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
  ) {
    console.log("⚠️ WebSocket is already connected/connecting");

    return;
  }

  console.log("🔌 Connecting to Deriv WebSocket...");

  resetConnectionState();

  let freshWsUrl;

  try {
    freshWsUrl = await getFreshWsUrl();
  } catch (error) {
    console.error("❌ Failed to obtain fresh Deriv OTP:", error.message);

    scheduleReconnect();

    return;
  }

  if (intentionalClose) {
    return;
  }

  ws = new WebSocket(freshWsUrl);

  /*
   * Prevent stale WebSocket events from affecting state.
   */
  const currentSocket = ws;

  currentSocket.on("open", () => {
    if (ws !== currentSocket) {
      return;
    }

    console.log("🔌 Connected to Deriv WebSocket");

    reconnectAttempts = 0;

    connection = true;
    authorized = false;

    /*
     * Authorize once.
     *
     * No 1-second authorization interval.
     */
    const sent = send({
      authorize: API_TOKEN,
    });

    if (!sent) {
      console.log("⚠️ Authorization request could not be sent");
    }
  });

  currentSocket.on("error", (error) => {
    console.error("❌ WebSocket error:", error.message);
  });

  currentSocket.on("close", (code, reason) => {
    /*
     * Only the active socket is allowed to update
     * global connection state.
     */
    if (ws !== currentSocket) {
      return;
    }

    console.log(
      `🔌 WebSocket disconnected. Code: ${code}, Reason: ${
        reason?.toString() || "Unknown"
      }`,
    );

    ws = null;

    resetConnectionState();

    if (!intentionalClose) {
      sendMessage("WebSocket disconnected. Reconnecting...");

      scheduleReconnect();
    }
  });

  currentSocket.on("message", async (msg) => {
    /*
     * Ignore messages from an old socket.
     */
    if (ws !== currentSocket) {
      return;
    }

    try {
      const data = JSON.parse(msg);

      /*
      |--------------------------------------------------------------------------
      | AUTHORIZE
      |--------------------------------------------------------------------------
      */

      if (data.msg_type === "authorize") {
        console.log("✅ Authorized");

        authorized = true;
        connection = true;

        /*
         * Balance subscription.
         */
        send({
          balance: 1,
          subscribe: 1,
        });

        /*
         * Existing portfolio.
         */
        send({
          portfolio: 1,
        });

        /*
         * Start market data subscriptions.
         *
         * This is done only once after authorization.
         */
        await subscribeMarketData();

        return;
      }

      /*
      |--------------------------------------------------------------------------
      | BALANCE
      |--------------------------------------------------------------------------
      */

      if (data.msg_type === "balance") {
        const rawBalance = Number(data?.balance?.balance);

        if (!Number.isFinite(rawBalance)) {
          console.log("⚠️ Invalid balance received");

          return;
        }

        if (rawBalance !== lastBalance) {
          console.log(`💸 Balance is currently ${rawBalance}`);

          lastBalance = rawBalance;
        }

        balance = Math.trunc(rawBalance);

        if (balance < 7) {
          amount = 1;
        } else {
          const forefeit = 2 ** Math.floor(Math.log2(balance / 7) + 1);

          amount = Math.min(1000, forefeit);
        }

        return;
      }

      /*
      |--------------------------------------------------------------------------
      | PORTFOLIO
      |--------------------------------------------------------------------------
      */

      if (data.msg_type === "portfolio") {
        const database = client.db("trading");
        const collection = database.collection("trade");

        const portfolioContracts = data?.portfolio?.contracts || [];

        const activeContractIds = new Set(
          portfolioContracts.map((contract) => contract.contract_id),
        );

        const assets = await collection.find({}).toArray();

        /*
         * Remove contracts no longer in portfolio.
         */
        for (const asset of assets) {
          const contractId = asset.contract_id;

          if (!activeContractIds.has(contractId)) {
            console.log(`🗑️ Contract ${contractId} is no longer in portfolio`);

            /*
             * Don't delete a contract that is currently
             * waiting for a sell response unless the
             * portfolio confirms it is gone.
             */
            deleteContractState(contractId);

            subscribedContracts.delete(contractId);

            positions = positions.filter((p) => p.contract_id !== contractId);

            await collection.deleteOne({
              contract_id: contractId,
            });
          }
        }

        /*
         * Process active contracts.
         */
        for (const contract of portfolioContracts) {
          const contractId = contract.contract_id;

          const symbol = contract.underlying_symbol;

          if (!symbol || !contractId) {
            continue;
          }

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

          /*
           * Keep in-memory position synchronized
           * with MongoDB.
           */
          const existingIndex = positions.findIndex(
            (p) => p.contract_id === contractId,
          );

          if (existingIndex === -1) {
            positions.push(position);
          } else {
            positions[existingIndex] = {
              ...positions[existingIndex],
              ...position,
            };
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

          /*
           * The proposal/buy process has successfully
           * resulted in an actual portfolio contract.
           */
          if (md) {
            if (
              md.tradeState === "PROPOSAL_PENDING" ||
              md.tradeState === "BUY_PENDING"
            ) {
              clearSymbolPending(symbol);
            }
          }

          /*
           * Subscribe to contract updates only once.
           */
          if (!subscribedContracts.has(contractId)) {
            console.log(`📡 Subscribing to contract ${contractId}`);

            const sent = send({
              proposal_open_contract: 1,
              contract_id: contractId,
              subscribe: 1,
            });

            if (sent) {
              subscribedContracts.add(contractId);
            }
          }
        }

        if (!portfolioSynced) {
          portfolioSynced = true;

          console.log("✅ Portfolio synchronized");
        }

        return;
      }

      /*
      |--------------------------------------------------------------------------
      | CONTRACTS FOR
      |--------------------------------------------------------------------------
      */

      if (data.msg_type === "contracts_for") {
        const symbol = data.echo_req?.contracts_for;

        const md = marketData[symbol];

        if (!md) {
          return;
        }

        const available = data?.contracts_for?.available || [];

        for (const contract of available) {
          if (contract?.contract_category === "multiplier") {
            md.multiplier_range = contract.multiplier_range || [];

            break;
          }
        }

        if (!md.multiplier_range.length) {
          console.log(`⚠️ ${symbol}: No multiplier range returned`);
        }

        return;
      }

      /*
      |--------------------------------------------------------------------------
      | CANDLES
      |--------------------------------------------------------------------------
      */

      if (data.msg_type === "candles") {
        const symbol = data.echo_req?.ticks_history;

        const timeframe = Number(data.echo_req?.granularity);

        const md = marketData[symbol];

        if (!md) {
          return;
        }

        if (!Array.isArray(data.candles) || data.candles.length === 0) {
          console.log(`⚠️ Empty candle history for ${symbol} ${timeframe}`);

          return;
        }

        /*
         * Replace historical data completely.
         *
         * This happens only when the initial history
         * request is received.
         */
        if (timeframe === ONE_HOUR) {
          md.close1h = data.candles.map((c) => Number(c.close));

          md.open1h = data.candles.map((c) => Number(c.open));

          md.high1h = data.candles.map((c) => Number(c.high));

          md.low1h = data.candles.map((c) => Number(c.low));

          md.openTime1h =
            Number(data.candles[data.candles.length - 1]?.open_time) || 0;

          md.history1hLoaded = true;

          updateOneHourIndicators(md);

          console.log(`📊 ${symbol}: 1H history loaded (${md.close1h.length})`);
        }

        if (timeframe === ONE_MINUTE) {
          md.close = data.candles.map((c) => Number(c.close));

          md.open = data.candles.map((c) => Number(c.open));

          md.high = data.candles.map((c) => Number(c.high));

          md.low = data.candles.map((c) => Number(c.low));

          md.openTime =
            Number(data.candles[data.candles.length - 1]?.open_time) || 0;

          md.history1mLoaded = true;

          updateOneMinuteIndicators(md);

          console.log(`📊 ${symbol}: 1M history loaded (${md.close.length})`);
        }

        const current = new Date();

        if (now.getHours() !== current.getHours()) {
          now = new Date();

          sendMessage("Bot is still running");
        }

        return;
      }

      /*
      |--------------------------------------------------------------------------
      | OHLC
      |--------------------------------------------------------------------------
      */

      if (data.msg_type === "ohlc" && portfolioSynced) {
        const symbol = data.echo_req?.ticks_history;

        const timeframe = Number(data.echo_req?.granularity);

        const md = marketData[symbol];

        if (!md) {
          return;
        }

        /*
         * We only need multiplier positions
         * for this strategy.
         */
        const matchingPositions = positions.filter((p) => p?.name === symbol);

        const multiplierPositions = matchingPositions.filter(
          (p) => p.type !== "ONETOUCH",
        );

        /*
         * Multiplier range is required before
         * attempting an entry.
         */
        if (!md.multiplier_range?.length) {
          console.log(`⛔ ${symbol}: No multiplier range available`);

          return;
        }

        /*
        |--------------------------------------------------------------------------
        | 1-HOUR OHLC
        |--------------------------------------------------------------------------
        */

        if (timeframe === ONE_HOUR) {
          if (!md.history1hLoaded) {
            return;
          }

          appendCandle(md, ONE_HOUR, data.ohlc);

          updateOneHourIndicators(md);

          return;
        }

        /*
        |--------------------------------------------------------------------------
        | 1-MINUTE OHLC
        |--------------------------------------------------------------------------
        */

        if (timeframe === ONE_MINUTE) {
          if (!md.history1mLoaded) {
            return;
          }

          appendCandle(md, ONE_MINUTE, data.ohlc);

          updateOneMinuteIndicators(md);

          const len = md.close.length;
          const len1h = md.close1h.length;

          /*
           * PRIORITY 2:
           * Require BOTH timeframes to have enough
           * data before evaluating a trade.
           */
          if (len < 200 || len1h < 200) {
            return;
          }

          const prevIndex = len - 2;
          const prevIndex1h = len1h - 2;

          if (prevIndex < 0 || prevIndex1h < 0) {
            return;
          }

          const symbolIsPending =
            md.tradeState === "PROPOSAL_PENDING" ||
            md.tradeState === "BUY_PENDING";

          const hasOpenPosition = multiplierPositions.length > 0;

          /*
           * Make sure balance is valid.
           */
          const validBalance =
            Number.isFinite(Number(balance)) && Number(balance) > 0;

          /*
           * Make sure amount is valid.
           */
          const validAmount =
            Number.isFinite(Number(amount)) && Number(amount) > 0;

          /*
          |--------------------------------------------------------------------------
          | ENTRY
          |--------------------------------------------------------------------------
          */

          if (
            !hasOpenPosition &&
            !symbolIsPending &&
            validBalance &&
            validAmount &&
            tradeSymbols.includes(symbol) &&
            md.tradeState === "IDLE"
          ) {
            /*
             * BULLISH PULLBACK
             */
            if (
              md.trendUp1h &&
              (crossedPrice(md.high, md.low, prevIndex, md.ema1h21) ||
                crossedPrice(md.high, md.low, prevIndex, md.ema1h50)) &&
              bullish(md.open, md.close, prevIndex) &&
              bearish(md.open1h, md.close1h, prevIndex1h) &&
              md.close[prevIndex] > md.ema1h50
            ) {
              setSymbolPending(symbol, "PROPOSAL_PENDING");

              if (md.canAlert && alertSymbols.includes(symbol)) {
                sendMessage(`Bullish Signal on ${symbol}`);

                md.canAlert = false;
              }

              try {
                await getMultiProposal(
                  "MULTUP",
                  symbol,
                  amount,
                  md.multiplier_range[0],
                );
              } catch (error) {
                clearSymbolPending(symbol);

                sendMessage(`❌ Proposal error on ${symbol}: ${error.message}`);
              }
            } else if (

            /*
             * BEARISH PULLBACK
             */
              md.trendDown1h &&
              (crossedPrice(md.high, md.low, prevIndex, md.ema1h21) ||
                crossedPrice(md.high, md.low, prevIndex, md.ema1h50)) &&
              bearish(md.open, md.close, prevIndex) &&
              bullish(md.open1h, md.close1h, prevIndex1h) &&
              md.close[prevIndex] < md.ema1h50
            ) {
              setSymbolPending(symbol, "PROPOSAL_PENDING");

              if (md.canAlert && alertSymbols.includes(symbol)) {
                sendMessage(`Bearish Signal on ${symbol}`);

                md.canAlert = false;
              }

              try {
                await getMultiProposal(
                  "MULTDOWN",
                  symbol,
                  amount,
                  md.multiplier_range[0],
                );
              } catch (error) {
                clearSymbolPending(symbol);

                sendMessage(`❌ Proposal error on ${symbol}: ${error.message}`);
              }
            }
          }

          /*
          |--------------------------------------------------------------------------
          | EXIT ON OPPOSITE 1-HOUR TREND
          |--------------------------------------------------------------------------
          */

          if (multiplierPositions.length > 0) {
            for (const position of multiplierPositions) {
              const contractId = position.contract_id;

              const contractState = getContractState(contractId);

              if (contractState?.state === "CLOSING") {
                continue;
              }

              if (position.type === "MULTUP" && md.trendDown1h) {
                try {
                  closePosition(symbol, contractId, "Opposite Signal");
                } catch (error) {
                  sendMessage(`❌ Close error: ${error.message}`);
                }
              } else if (position.type === "MULTDOWN" && md.trendUp1h) {
                try {
                  closePosition(symbol, contractId, "Opposite Signal");
                } catch (error) {
                  sendMessage(`❌ Close error: ${error.message}`);
                }
              }
            }
          }
        }

        return;
      }

      /*
      |--------------------------------------------------------------------------
      | PROPOSAL
      |--------------------------------------------------------------------------
      */

      if (data.msg_type === "proposal") {
        const symbol = data?.echo_req?.underlying_symbol;

        const md = marketData[symbol];

        if (!md) {
          return;
        }

        const proposalId = data?.proposal?.id;

        if (!proposalId) {
          console.log(`⚠️ Proposal response without ID for ${symbol}`);

          clearSymbolPending(symbol);

          return;
        }

        /*
         * Make sure this proposal belongs to
         * the proposal currently pending for
         * this symbol.
         */
        if (md.tradeState !== "PROPOSAL_PENDING") {
          console.log(`⚠️ Unexpected proposal for ${symbol}`);

          return;
        }

        /*
         * Save proposal ID.
         */
        setSymbolPending(symbol, "BUY_PENDING", proposalId);

        const contractType = data?.echo_req?.contract_type;

        const askPrice = Number(data?.proposal?.ask_price);

        if (!contractType || !Number.isFinite(askPrice) || askPrice <= 0) {
          clearSymbolPending(symbol);

          sendMessage(`❌ Invalid proposal received for ${symbol}`);

          return;
        }

        try {
          buyContract(contractType, proposalId, askPrice);
        } catch (error) {
          clearSymbolPending(symbol);

          sendMessage(`❌ Buy request failed for ${symbol}: ${error.message}`);
        }

        return;
      }

      /*
      |--------------------------------------------------------------------------
      | BUY RESPONSE
      |--------------------------------------------------------------------------
      */

      if (data.msg_type === "buy") {
        const contractId = data?.buy?.contract_id;

        const proposalId = data?.echo_req?.buy;

        if (!contractId) {
          console.log("⚠️ Buy response without contract ID");

          /*
           * Try to identify symbol using proposal ID.
           */
          for (const [symbol, pending] of pendingTrades) {
            if (String(pending.proposalId) === String(proposalId)) {
              clearSymbolPending(symbol);

              sendMessage(
                `❌ Buy response did not contain a contract ID for ${symbol}`,
              );

              break;
            }
          }

          return;
        }

        /*
         * Find symbol associated with this proposal.
         */
        let symbol = null;

        for (const [pendingSymbol, pending] of pendingTrades) {
          if (String(pending.proposalId) === String(proposalId)) {
            symbol = pendingSymbol;
            break;
          }
        }

        console.log(
          `🟢 Bought contract ${contractId}${symbol ? ` on ${symbol}` : ""}`,
        );

        /*
         * The contract has been purchased,
         * but portfolio synchronization is still
         * required before considering it fully OPEN.
         */
        setContractState(contractId, "BUY_PENDING", {
          symbol,
          proposalId,
          type: data?.buy?.contract_type,
        });

        /*
         * Do NOT clear symbol pending here.
         *
         * Portfolio confirmation will transition
         * the contract to OPEN and clear the
         * symbol's pending state.
         */

        return;
      }

      /*
      |--------------------------------------------------------------------------
      | PROPOSAL OPEN CONTRACT
      |--------------------------------------------------------------------------
      */

      if (data.msg_type === "proposal_open_contract") {
        const id = data?.echo_req?.contract_id;

        const contract = data?.proposal_open_contract;

        if (!id || !contract) {
          return;
        }

        const position = positions.find((p) => p.contract_id === id);

        const symbol = contract?.underlying_symbol;

        const md = marketData[symbol];

        if (!md) {
          return;
        }

        const commission = Number(contract?.commission);

        const multiplier = Number(contract?.multiplier);

        const type = contract?.contract_type;

        const entrySpot = Number(contract?.entry_spot);

        const currentSpot = Number(contract?.current_spot);

        const orderAmount = Number(contract?.buy_price);

        const lossAmount = Number(
          contract?.limit_order?.stop_loss?.order_amount,
        );

        const profitAmount = Number(
          contract?.limit_order?.take_profit?.order_amount,
        );

        const stopOut = Number(contract?.limit_order?.stop_out?.value);

        const stop = Number(contract?.limit_order?.stop_loss?.value);

        const takeProfit = Number(contract?.limit_order?.take_profit?.value);

        const profit = Number(contract?.profit);

        const duration =
          Number(contract?.current_spot_time) - Number(contract?.date_start);

        /*
         * Validate required prices.
         */
        if (!Number.isFinite(entrySpot) || !Number.isFinite(currentSpot)) {
          return;
        }

        const pip =
          type === "MULTUP" ? currentSpot - entrySpot : entrySpot - currentSpot;

        const loss =
          type === "MULTUP" ? entrySpot - stopOut : stopOut - entrySpot;

        const risk = type === "MULTUP" ? entrySpot - stop : stop - entrySpot;

        const gain =
          type === "MULTUP" ? takeProfit - entrySpot : entrySpot - takeProfit;

        /*
         * Initialize contract state if needed.
         */
        let state = getContractState(id);

        if (!state) {
          setContractState(id, "OPEN", {
            symbol,
            type,
          });

          state = getContractState(id);
        }

        /*
         * Update in-memory position.
         */
        if (position) {
          position.subscribed = true;
          position.profit = profit;
        }

        /*
        |--------------------------------------------------------------------------
        | ATR SAFETY
        |--------------------------------------------------------------------------
        */

        if (md.high.length < 15 || md.low.length < 15 || md.close.length < 15) {
          return;
        }

        const atr = calculateATR(md.high, md.low, md.close, 14);

        if (!atr?.length) {
          return;
        }

        const currentATR = Number(atr[atr.length - 1]);

        /*
         * PRIORITY 6:
         * Never trade/close based on invalid ATR.
         */
        if (!Number.isFinite(currentATR) || currentATR <= 0) {
          console.log(`⚠️ Invalid ATR for ${symbol}`);

          return;
        }

        /*
        |--------------------------------------------------------------------------
        | ACTIVE MULTIPLIER POSITION MANAGEMENT
        |--------------------------------------------------------------------------
        */

        if (connection && type !== "ONETOUCH") {
          if (!position) {
            return;
          }

          /*
           * If Deriv has not supplied the stop-loss
           * order amount yet, don't run the staged
           * stop-loss logic.
           */
          if (!Number.isFinite(lossAmount)) {
            return;
          }

          const currentContractState = getContractState(id);

          if (currentContractState?.state === "CLOSING") {
            return;
          }

          /*
          |--------------------------------------------------------------------------
          | STAGED STOP LOSS
          |--------------------------------------------------------------------------
          */

          /*
           * Stage 1:
           * Move stop to commission.
           */
          if (
            pip >= risk &&
            position.stoploss === 0 &&
            Number.isFinite(commission)
          ) {
            const newStop = Math.abs(commission);

            position.stoploss = newStop;

            await update(newStop, id, symbol);
          }

          /*
           * Stage 2:
           * Move stop to original loss amount.
           */
          if (
            pip >= risk * 3 &&
            Number.isFinite(position.stoploss) &&
            Number.isFinite(commission) &&
            position.stoploss === Math.abs(commission)
          ) {
            const newStop = Math.abs(lossAmount);

            position.stoploss = newStop;

            await update(newStop, id, symbol);
          }

          /*
           * Stage 3:
           * Lock additional profit.
           */
          if (
            pip >= risk * 5 &&
            Number.isFinite(position.stoploss) &&
            position.stoploss === Math.abs(lossAmount)
          ) {
            const newStop = Math.abs(lossAmount * 4);

            position.stoploss = newStop;

            await update(newStop, id, symbol);
          }

          /*
          |--------------------------------------------------------------------------
          | ATR STOP
          |--------------------------------------------------------------------------
          */

          if (pip <= -(currentATR * 2)) {
            closePosition(symbol, id, "Stop Loss Hit");

            return;
          }

          /*
          |--------------------------------------------------------------------------
          | ATR TAKE PROFIT
          |--------------------------------------------------------------------------
          */

          if (pip >= currentATR * 6) {
            closePosition(symbol, id, "Take Profit Reached");

            return;
          }

          /*
          |--------------------------------------------------------------------------
          | PROFIT STOP
          |--------------------------------------------------------------------------
          */

          if (
            Number.isFinite(position.stoploss) &&
            position.stoploss !== 0 &&
            Number.isFinite(profit) &&
            profit <= position.stoploss
          ) {
            closePosition(symbol, id, "Stop Loss Hit");

            return;
          }
        }

        /*
        |--------------------------------------------------------------------------
        | RUNNING TRADE DATA
        |--------------------------------------------------------------------------
        */

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

        /*
         * Only report newly opened trades.
         */
        if (Number.isFinite(duration) && duration <= 2) {
          sendMessage(JSON.stringify(runningTrade, null, 2));
        }

        console.log(runningTrade);

        return;
      }

      /*
      |--------------------------------------------------------------------------
      | SELL RESPONSE
      |--------------------------------------------------------------------------
      */

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

        /*
         * Only now is the contract completely
         * removed from local state.
         */
        deleteContractState(contractId);

        subscribedContracts.delete(contractId);

        positions = positions.filter((p) => p.contract_id !== contractId);

        await collection.deleteOne({
          contract_id: contractId,
        });

        /*
         * If there is still a pending entry
         * on this symbol, don't touch it.
         */
        console.log(`🗑️ Deleted closed contract ${contractId}`);

        return;
      }

      /*
      |--------------------------------------------------------------------------
      | CONTRACT UPDATE
      |--------------------------------------------------------------------------
      */

      if (data.msg_type === "contract_update") {
        const contractId = data.echo_req?.contract_id;

        const position = positions.find((p) => p.contract_id === contractId);

        if (position) {
          sendMessage(`💸 Position updated on ${position.name}`);
        }

        return;
      }

      /*
      |--------------------------------------------------------------------------
      | ERRORS
      |--------------------------------------------------------------------------
      */

      if (data.error) {
        const error = data.error.message || "Unknown Deriv error";

        const echoReq = data.echo_req || {};

        console.error("❗ Error:", error);

        /*
        |--------------------------------------------------------------------------
        | SELL ERROR
        |--------------------------------------------------------------------------
        */

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

        /*
        |--------------------------------------------------------------------------
        | PROPOSAL / BUY ERROR
        |--------------------------------------------------------------------------
        */

        const errorSymbol = echoReq?.underlying_symbol;

        if (errorSymbol) {
          const md = marketData[errorSymbol];

          if (
            md &&
            (md.tradeState === "PROPOSAL_PENDING" ||
              md.tradeState === "BUY_PENDING")
          ) {
            clearSymbolPending(errorSymbol);

            console.log(
              `⚠️ Entry failed for ${errorSymbol}; state restored to IDLE`,
            );
          }
        }

        /*
         * If the error references a proposal ID,
         * locate the corresponding symbol.
         */
        const proposalId = echoReq?.proposal_id || echoReq?.buy;

        if (proposalId) {
          for (const [pendingSymbol, pending] of pendingTrades) {
            if (String(pending.proposalId) === String(proposalId)) {
              clearSymbolPending(pendingSymbol);

              console.log(`⚠️ Pending trade cleared for ${pendingSymbol}`);

              break;
            }
          }
        }

        /*
        |--------------------------------------------------------------------------
        | AUTHORIZATION ERROR
        |--------------------------------------------------------------------------
        */

        if (error.toLowerCase().includes("please log in")) {
          console.log("⚠️ Deriv requested login again");

          authorized = false;

          if (isSocketOpen()) {
            send({
              authorize: API_TOKEN,
            });
          }

          return;
        }

        /*
        |--------------------------------------------------------------------------
        | RATE LIMIT
        |--------------------------------------------------------------------------
        */

        if (error === "You have reached the rate limit for ticks_history.") {
          /*
           * IMPORTANT:
           *
           * We no longer resubscribe all candles.
           *
           * Existing candle subscriptions should
           * continue. If the WebSocket itself is alive,
           * there is no reason to resend 32 history
           * requests.
           */
          console.log("⚠️ ticks_history rate limit reached.");

          sendMessage(
            "⚠️ Deriv ticks_history rate limit reached. Existing candle subscriptions will be retained.",
          );

          return;
        }

        /*
        |--------------------------------------------------------------------------
        | GENERIC ERROR
        |--------------------------------------------------------------------------
        */

        sendMessage(`❗ Error: ${error}`);

        return;
      }
    } catch (error) {
      console.error("❌ WebSocket message handler error:", error);
    }
  });
}

/*
|--------------------------------------------------------------------------
| START
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
