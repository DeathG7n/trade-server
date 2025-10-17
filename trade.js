const WebSocket = require("ws");
const pm2 = require("pm2");
const express = require("express");
const app = express();
const cors = require("cors");
const axios = require("axios");

const API_TOKEN = "IxcmbIEL0Mb4fvQ";
const ws = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=36807");

const BOT_TOKEN = "8033524186:AAFp1cMBr1oRVUgCa2vwKPgroSw_i6M-qEQ";
const CHAT_ID = "8068534792";

let closePrices = [];
let position = null;
let openContractId = null;
let openPosition = null;
let canBuy = false;
let profit = null;
let subscribed = false;
let count = 0;
let reason = "";
let previousCandle = 0;

app.use(cors());

app.get("/", (req, res) => {
  ws.on("open", () => {
    console.log("🔌 Connected");
    sendMessage("🔌 Connected");
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

function calculateEMA(prices, period) {
  const k = 2 / (period + 1);
  let emaArray = [];
  emaArray[0] = prices?.[0];
  for (let i = 1; i < prices?.length; i++) {
    emaArray[i] = prices[i] * k + emaArray[i - 1] * (1 - k);
  }
  return emaArray;
}

function detectCrossover(fastMA, slowMA) {
  const lastIndex = fastMA.length - 1;
  const prevFast = fastMA[lastIndex - 1];
  const prevSlow = slowMA[lastIndex - 1];
  const currFast = fastMA[lastIndex];
  const currSlow = slowMA[lastIndex];
  if (prevFast < prevSlow && currFast > currSlow) {
    return "bullish";
  }
  if (prevFast > prevSlow && currFast < currSlow) {
    return "bearish";
  }
  return null;
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

function buyMultiplier(direction) {
  console.log(`📈 Buying ${direction} multiplier...`);
  send({
    buy: 1,
    price: 1,
    parameters: {
      amount: 1,
      basis: "stake",
      contract_type: direction,
      currency: "USD",
      symbol: "JD10",
      multiplier: 1000000000,
    },
  });
}

function closePosition(contract_id, why) {
  send({
    sell: contract_id,
    price: 0,
  });
  reason = why;
  console.log(`❌ Closing position: ${contract_id}`);
}

ws.on("open", () => {
  console.log("🔌 Connected");
  sendMessage("🔌 Connected");
  send({ authorize: API_TOKEN });
});

ws.on("message", async (msg) => {
  const data = JSON.parse(msg);

  if (data.msg_type === "authorize") {
    console.log("✅ Authorized");
    send({ portfolio: 1 });
    send({
      ticks_history: "JD10",
      style: "candles",
      count: 1000000000,
      granularity: 900,
      end: "latest",
    });
  }

  if (data.msg_type === "portfolio") {
    if (data?.portfolio?.contracts?.length === 0) {
      openPosition = null;
      openContractId = null;
      position = null;
      subscribed = false;
      profit = null;
      canBuy = true;
    } else {
      openPosition =
        data?.portfolio?.contracts[data?.portfolio?.contracts?.length - 1];
      position = openPosition?.contract_type;
      openContractId = openPosition?.contract_id;
      if (data?.portfolio?.contracts?.length > 1) {
        closePosition(openContractId);
      }
      if (subscribed === false) {
        send({
          proposal_open_contract: 1,
          contract_id: openContractId,
          subscribe: 1,
        });
        subscribed = true;
      }
    }
  }

  if (data.msg_type === "candles") {
    closePrices = data?.candles?.map((i) => {
      return i?.close;
    });
    openPrices = data?.candles?.map((i) => {
      return i?.open;
    });

    const ema14 = calculateEMA(closePrices, 14);
    const ema21 = calculateEMA(closePrices, 21);

    const len = closePrices?.length;
    const prevIndex = len - 2;

    const signal = detectCrossover(ema14, ema21);

    if (previousCandle !== closePrices[prevIndex]) {
      previousCandle = closePrices[prevIndex];
      if (signal === "bullish") {
        position === "MULTDOWN" &&
          closePosition(openContractId, `Opposite Signal`);
        await run(2000);
        canBuy === true && buyMultiplier("MULTUP");
      } else if (signal === "bearish") {
        position === "MULTUP" &&
          closePosition(openContractId, `Opposite Signal`);
        await run(2000);
        canBuy === true && buyMultiplier("MULTDOWN");
      }
      await run(30000);
    }
    count += 1;
    console.log(count);
    await run(30000);
    send({ portfolio: 1 });
    send({
      ticks_history: data?.echo_req?.ticks_history,
      style: "candles",
      count: 1000000000,
      granularity: data?.echo_req?.granularity,
      end: "latest",
    });
  }

  if (data.msg_type === "proposal_open_contract") {
    canBuy = false;
    const type = data?.proposal_open_contract?.contract_type;
    const entrySpot = data?.proposal_open_contract?.entry_spot;
    const currentSpot = data?.proposal_open_contract?.current_spot;
    const pip =
      type === "MULTUP" ? currentSpot - entrySpot : entrySpot - currentSpot;
    profit = data?.proposal_open_contract?.profit;
    console.log(pip, profit);
  }

  if (data.msg_type === "buy") {
    position = data?.echo_req?.parameters?.contract_type;
    openContractId = data?.buy?.contract_id;
    send({
      proposal_open_contract: 1,
      contract_id: data?.buy?.contract_id,
      subscribe: 1,
    });
    sendMessage(`${position} position entered`);
    console.log(
      `🟢 Entered ${position} position, Contract ID: ${openContractId}`
    );
  }

  if (data.msg_type === "sell") {
    sendMessage(
      `💸 Position closed at ${data?.sell?.sold_for} USD, because ${reason}`
    );
    console.log(
      `💸 Position closed at ${data?.sell?.sold_for} USD, because ${reason}`
    );
  }

  if (data.error) {
    console.error("❗ Error:", data.error.message);
    sendMessage("❗ Error:", data.error.message);
  }
});
