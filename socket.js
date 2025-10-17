const WebSocket = require("ws");
const express = require("express");
const app = express();
const cors = require("cors");
const axios = require("axios");

const API_TOKEN = "IxcmbIEL0Mb4fvQ";
const ws = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=36807");

const BOT_TOKEN = "8033524186:AAFp1cMBr1oRVUgCa2vwKPgroSw_i6M-qEQ";
const CHAT_ID = "8068534792";

let closePrices = [];
let openPrices = [];
let count = 0;
const assets = ["BOOM1000", "CRASH1000", "R_75"];
const previousCandles = [0, 0, 0];

app.use(cors());

app.get("/", (req, res) => {
  ws.on("open", () => {
    console.log("🔌 Connected");
    sendMessage("🔌 Connected")
    send({ authorize: API_TOKEN });
  });
  res.json("Hi");
});

app.listen(3000, () => {
  console.log("Server is running");
});

function send(msg) {
  ws.send(JSON.stringify(msg));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(ms) {
  console.log(`⏳ Waiting ${ms / 1000} seconds...`);
  await sleep(ms);
  console.log("✅ Done!");
}

function bearish(candle) {
  return openPrices[candle] > closePrices[candle];
}
function bullish(candle) {
  return closePrices[candle] > openPrices[candle];
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
      error.response?.data || error.message
    );
  }
};

ws.on("open", () => {
  console.log("🔌 Connected");
  sendMessage("🔌 Connected");
  send({ authorize: API_TOKEN });
});

ws.on("message", async (msg) => {
  const data = JSON.parse(msg);

  if (data.msg_type === "authorize") {
    console.log("✅ Authorized");
    assets.forEach((asset) => {
      send({
        ticks_history: asset,
        style: "candles",
        count: 10000000000,
        granularity: 300,
        end: "latest",
      });
    });
  }

  if (data.msg_type === "candles") {
    if (data?.echo_req?.ticks_history.slice(0, 4) === "BOOM") {
      closePrices = data?.candles?.map((i) => {
        return i?.close;
      });
      openPrices = data?.candles?.map((i) => {
        return i?.open;
      });
      const len = closePrices?.length;
      const prevIndex = len - 2;

      if (previousCandles[0] !== closePrices[prevIndex]) {
        previousCandles[0] = closePrices[prevIndex];
        bullish(prevIndex) &&
          sendMessage(`BOOM on ${data?.echo_req?.ticks_history}`);
      }
    }
    if (data?.echo_req?.ticks_history.slice(0, 5) === "CRASH") {
      closePrices = data?.candles?.map((i) => {
        return i?.close;
      });
      openPrices = data?.candles?.map((i) => {
        return i?.open;
      });
      const len = closePrices?.length;
      const prevIndex = len - 2;
      if (previousCandles[1] !== closePrices[prevIndex]) {
        previousCandles[1] = closePrices[prevIndex];
        bearish(prevIndex) &&
          sendMessage(`CRASH on ${data?.echo_req?.ticks_history}`);
      }
    }
    if (data?.echo_req?.ticks_history === "R_75") {
      closePrices = data?.candles?.map((i) => {
        return i?.close;
      });
      openPrices = data?.candles?.map((i) => {
        return i?.open;
      });
      const len = closePrices?.length;
      const prevIndex = len - 3;
      const currIndex = len - 2;

      const ema14 = calculateEMA(closePrices, 14);
      const ema21 = calculateEMA(closePrices, 21);

      const ema14Now = ema14[currIndex];
      const ema21Now = ema21[currIndex];

      const trend = ema14Now > ema21Now;

      if (previousCandles[2] !== closePrices[prevIndex]) {
        previousCandles[2] = closePrices[prevIndex];
        if (trend && bearish(prevIndex) && bullish(currIndex)) {
          sendMessage(`Bullish on ${data?.echo_req?.ticks_history}`);
        }

        if (!trend && bullish(prevIndex) && bearish(currIndex)) {
          sendMessage(`Bearish on ${data?.echo_req?.ticks_history}`);
        }
      }
    }
    count += 1;
    console.log(count);
    await run(30000);
    send({
      ticks_history: data?.echo_req?.ticks_history,
      style: "candles",
      count: 10000000000,
      granularity: 300,
      end: "latest",
    });
  }

  if (data.error) {
    console.error("❗ Error:", data.error.message);
    sendMessage("❗ Error:", data.error.message);
  }
});

function calculateEMA(prices, period) {
  const k = 2 / (period + 1);
  let emaArray = [];
  emaArray[0] = prices?.[0];
  for (let i = 1; i < prices?.length; i++) {
    emaArray[i] = prices[i] * k + emaArray[i - 1] * (1 - k);
  }
  return emaArray;
}
