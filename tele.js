// bot.js
const WebSocket = require("ws");
const express = require("express");
const app = express();
const cors = require("cors");
const axios = require("axios");

const API_TOKEN = "IxcmbIEL0Mb4fvQ";
const WS_URL = "wss://ws.derivws.com/websockets/v3?app_id=36807";

const BOT_TOKEN = "8033524186:AAFp1cMBr1oRVUgCa2vwKPgroSw_i6M-qEQ";
const CHAT_ID = "8068534792";

app.use(cors());
app.get("/", (req, res) => res.json("Hi"));

app.listen(3000, () => {
  console.log("Server is running on port 3000");
});

/* ---------- State ---------- */
let ws = null;
let reconnectDelay = 1000;
let maxReconnectDelay = 60000;

let close1m = [];
let open1m = [];
let high1m = [];
let low1m = [];
let epochs1m = []; // timestamps for closed-candle detection

let close30m = [];
let epochs30m = [];

let position = null;
let openContractId = null;
let openPosition = null;
let canBuy = true;
let subscribedContract = null; // symbol for which we subscribed
let subscribedPortfolioContract = null;
let lastTradedEpoch1m = null; // to prevent duplicate trades per closed candle

/* ---------- Helpers ---------- */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sendMessage(message) {
  return axios
    .post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: message,
    })
    .catch((err) =>
      console.error("Telegram send error:", err.response?.data || err.message)
    );
}

function sendRaw(msg) {
  try {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  } catch (err) {
    console.error("sendRaw error", err);
  }
}

function isNumberBetween(number, lowerBound, upperBound) {
  return number >= lowerBound && number <= upperBound;
}

/* EMA: uses first value as seed (simple) */
function calculateEMA(prices, period) {
  if (!prices || prices.length === 0) return [];
  const k = 2 / (period + 1);
  const ema = [];
  ema[0] = prices[0];
  for (let i = 1; i < prices.length; i++) {
    ema[i] = prices[i] * k + ema[i - 1] * (1 - k);
  }
  return ema;
}

/* Detect crossover between two moving averages arrays.
   Returns 'bullish', 'bearish', or null.
   Ensures arrays are long enough before checking.
*/
function detectCrossover(fast, slow) {
  if (!fast || !slow) return null;
  const n = Math.min(fast.length, slow.length);
  if (n < 2) return null;
  const prevFast = fast[n - 2];
  const prevSlow = slow[n - 2];
  const currFast = fast[n - 1];
  const currSlow = slow[n - 1];
  if (prevFast < prevSlow && currFast > currSlow) return "bullish";
  if (prevFast > prevSlow && currFast < currSlow) return "bearish";
  return null;
}

function bullish(idx) {
  return open1m[idx] < close1m[idx];
}
function bearish(idx) {
  return open1m[idx] > close1m[idx];
}
function crossedEma(idx, emaValue) {
  return high1m[idx] > emaValue && emaValue > low1m[idx];
}

/* Buy multiplier wrapper */
function buyMultiplier(direction, sym, stake) {
  if (!stake || stake <= 0) {
    console.warn("Invalid stake, skipping buy:", stake);
    return;
  }
  console.log(`📈 Attempting to buy ${direction} with stake ${stake}`);
  sendRaw({
    buy: 1,
    price: stake,
    parameters: {
      amount: stake,
      basis: "stake",
      contract_type: direction,
      currency: "USD",
      symbol: sym,
      multiplier: 750,
      // note: confirm Deriv accepts limit_order this way for multipliers
      limit_order: { stop_loss: Math.max(0.0001, stake / 5), take_profit: stake / 2 },
    },
  });
}

/* Close a position */
function closePosition(contract_id, why) {
  if (!contract_id) return;
  sendRaw({ sell: contract_id, price: 0 });
  console.log(`❌ Closing position ${contract_id} because: ${why}`);
}

/* Choose stake from balance */
function stakeFromBalance(balance) {
  if (isNumberBetween(balance, 0, 5)) return 1;
  if (isNumberBetween(balance, 5, 10)) return 2;
  if (isNumberBetween(balance, 10, 20)) return 4;
  if (isNumberBetween(balance, 20, 40)) return 8;
  if (isNumberBetween(balance, 40, 80)) return 16;
  if (isNumberBetween(balance, 80, 160)) return 32;
  if (isNumberBetween(balance, 160, 320)) return 64;
  if (isNumberBetween(balance, 320, 640)) return 128;
  if (isNumberBetween(balance, 640, 1280)) return 256;
  if (isNumberBetween(balance, 1280, 2560)) return 512;
  return 1000;
}

/* ---------- WebSocket lifecycle ---------- */
function connect() {
  ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    console.log("🔌 WS connected");
    reconnectDelay = 1000;
    // authorize
    sendRaw({ authorize: API_TOKEN });
  });

  ws.on("message", async (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      console.error("Invalid JSON:", err);
      return;
    }

    /* Handle authorize */
    if (data.msg_type === "authorize") {
      console.log("✅ Authorized");
      // request balance + portfolio
      sendRaw({ balance: 1 });
      sendRaw({ portfolio: 1 });

      // Subscribe to 1m candles (subscribe:1) — reasonable count
      sendRaw({
        ticks_history: "stpRNG",
        style: "candles",
        count: 500,
        granularity: 60,
        end: "latest",
        subscribe: 1,
      });

      // Subscribe to 30-minute candles (subscribe:1). We use granularity 1800.
      sendRaw({
        ticks_history: "stpRNG",
        style: "candles",
        count: 300,
        granularity: 1800,
        end: "latest",
        subscribe: 1,
      });

      return;
    }

    /* Balance response */
    if (data.msg_type === "balance") {
      const balance = data?.balance?.balance;
      if (typeof balance === "number") {
        const stake = stakeFromBalance(balance);
        // store (or you can set a global amount variable)
        global.__stake = stake;
      }
      return;
    }

    /* Portfolio response */
    if (data.msg_type === "portfolio") {
      const contracts = data?.portfolio?.contracts || [];
      if (contracts.length === 0) {
        openPosition = null;
        openContractId = null;
        position = null;
        canBuy = true;
      } else {
        openPosition = contracts[contracts.length - 1];
        position = openPosition?.contract_type;
        openContractId = openPosition?.contract_id;
        // subscribe to proposal updates for this contract (if needed)
        if (!subscribedPortfolioContract && openContractId) {
          sendRaw({
            proposal_open_contract: 1,
            contract_id: openContractId,
            subscribe: 1,
          });
          subscribedPortfolioContract = openContractId;
        }
        // avoid more than one open contract: if more than 1, close extras
        if (contracts.length > 1) {
          closePosition(openContractId, "too many positions");
        }
      }
      return;
    }

    /* Candles subscription (1m or 30m) */
    if (data.msg_type === "candles") {
      try {
        const gran = data?.echo_req?.granularity;
        const candles = data?.candles || [];
        if (gran === 1800) {
          // 30-minute candles
          close30m = candles.map((c) => c.close);
          epochs30m = candles.map((c) => c.epoch);
        } else if (gran === 60) {
          // 1-minute candles
          close1m = candles.map((c) => c.close);
          open1m = candles.map((c) => c.open);
          high1m = candles.map((c) => c.high);
          low1m = candles.map((c) => c.low);
          epochs1m = candles.map((c) => c.epoch);

          // Trade logic happens on closed 1m candle (use prev candle)
          if (epochs1m.length < 2 || close30m.length < 2) return;

          const idxPrev = close1m.length - 2;
          const epochPrev = epochs1m[idxPrev];

          // Only evaluate once per closed candle
          if (lastTradedEpoch1m === epochPrev) return;

          // compute EMAs for 1m
          const ema14_1m = calculateEMA(close1m, 14);
          const ema21_1m = calculateEMA(close1m, 21);
          if (ema14_1m.length < 2 || ema21_1m.length < 2) return;

          const ema14Now = ema14_1m[ema14_1m.length - 1];
          const ema21Now = ema21_1m[ema21_1m.length - 1];
          const trend1m = ema14Now > ema21Now;

          // compute EMAs for 30m using close30m
          const ema14_30 = calculateEMA(close30m, 14);
          const ema21_30 = calculateEMA(close30m, 21);
          if (ema14_30.length < 2 || ema21_30.length < 2) return;
          const ema14_30Now = ema14_30[ema14_30.length - 1];
          const ema21_30Now = ema21_30[ema21_30.length - 1];
          const trend30m = ema14_30Now > ema21_30Now;

          // For crossedEma use ema21 value for the prev candle index (if exists)
          const ema21Prev = ema21_1m[idxPrev];

          // Decide trade: only if 30m trend aligns, and 1m confirmation (bullish/bearish + crossedEma)
          const stake = global.__stake || 1;

          if (trend30m) {
            // long bias
            if (!canBuy && position === "MULTDOWN") {
              // opposite open, close first
              closePosition(openContractId, "Opposite Signal (30m)");
            }
            if (canBuy || position === "MULTDOWN") {
              if (trend1m && bullish(idxPrev) && crossedEma(idxPrev, ema21Prev)) {
                buyMultiplier("MULTUP", data?.echo_req?.ticks_history, stake);
                lastTradedEpoch1m = epochPrev;
              }
            }
          } else {
            // short bias
            if (!canBuy && position === "MULTUP") {
              closePosition(openContractId, "Opposite Signal (30m)");
            }
            if (canBuy || position === "MULTUP") {
              if (!trend1m && bearish(idxPrev) && crossedEma(idxPrev, ema21Prev)) {
                buyMultiplier("MULTDOWN", data?.echo_req?.ticks_history, stake);
                lastTradedEpoch1m = epochPrev;
              }
            }
          }
        }
      } catch (err) {
        console.error("Candles handler error:", err);
        await sendMessage(`Error in candles handler: ${String(err)}`);
      }
      return;
    }

    /* Proposal / running trade updates */
    if (data.msg_type === "proposal_open_contract") {
      // mark that we have an open trade streaming update
      canBuy = false;
      subscribedContract = data?.proposal_open_contract?.symbol || subscribedContract;
      // you can inspect running values here and decide to close based on pip/profit etc.
      // e.g. log running trade:
      const p = data.proposal_open_contract;
      console.log("Running contract update:", {
        contract_id: p.contract_id,
        contract_type: p.contract_type,
        entry_spot: p.entry_spot,
        current_spot: p.current_spot,
        profit: p.profit,
      });
      return;
    }

    /* Buy confirmation */
    if (data.msg_type === "buy") {
      position = data?.echo_req?.parameters?.contract_type;
      openContractId = data?.buy?.contract_id;
      canBuy = false;
      sendMessage(`${position} position entered (contract ${openContractId})`);
      console.log(`🟢 Entered ${position}, contract ${openContractId}`);
      return;
    }

    /* Sell confirmation */
    if (data.msg_type === "sell") {
      canBuy = true;
      sendMessage(
        `💸 Position closed at ${data?.sell?.sold_for} USD, reason: ${data?.sell?.reason || "closed"}`
      );
      console.log("💸 Sold:", data.sell);
      position = null;
      openContractId = null;
      return;
    }

    /* Errors */
    if (data.error) {
      console.error("API error:", data.error);
      await sendMessage(`❗ Deriv error: ${data.error.message}`);
      return;
    }
  });

  ws.on("close", (code, reason) => {
    console.warn(`WS closed: ${code} ${reason}`);
    // attempt reconnect with backoff
    setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 1.5, maxReconnectDelay);
      connect();
    }, reconnectDelay);
  });

  ws.on("error", (err) => {
    console.error("WS error:", err.message || err);
    try { ws.close(); } catch (e) {}
  });
}

/* Start connection */
connect();
