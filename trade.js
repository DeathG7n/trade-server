const WebSocket = require("ws");
const express = require("express");
const app = express();
const cors = require("cors");
const axios = require("axios");
const { MongoClient } = require("mongodb");

const API_TOKEN = "IxcmbIEL0Mb4fvQ";
const ws = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=36807");

const BOT_TOKEN = "8033524186:AAFp1cMBr1oRVUgCa2vwKPgroSw_i6M-qEQ";
const CHAT_ID = "8068534792";

const uri =
  "mongodb+srv://DeathG7n:if3anYichukwu@cluster0.gpfyqmb.mongodb.net/trading?retryWrites=true&w=majority";
const client = new MongoClient(uri);

let closePrices = [];
let openPrices = [];
let highPrices = [];
let lowPrices = [];
let position = null;
let openContractId = null;
let openPosition = null;
let canBuy = false;
let subscribed = false;
let count = 0;
let reason = "";
let previousCandle = 0;
let amount = null;
let stopLoss = null;

app.use(cors());

app.get("/", (req, res) => {
  res.json("Hi");
});

app.listen(3000, () => {
  console.log("Server is running");
});

//Functions
function bearish(candle) {
  return openPrices[candle] > closePrices[candle];
}
function bullish(candle) {
  return closePrices[candle] > openPrices[candle];
}

function crossedEma(candle, ema) {
  return highPrices[candle] > ema && ema > lowPrices[candle];
}

function send(msg) {
  ws.send(JSON.stringify(msg));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(ms) {
  // console.log(`⏳ Waiting ${ms / 1000} seconds...`);
  await sleep(ms);
  // console.log("✅ Done!");
}

function isNumberBetween(number, lowerBound, upperBound) {
  return number >= lowerBound && number <= upperBound;
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

function buyMultiplier(direction, sym, stake) {
  console.log(`📈 Buying ${direction} multiplier...`);
  send({
    buy: 1,
    price: stake,
    parameters: {
      amount: stake,
      basis: "stake",
      contract_type: direction,
      currency: "USD",
      symbol: sym,
      multiplier: 750,
      limit_order: { stop_loss: stake / 2, take_profit: stake * 5 },
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

async function connect() {
  try {
    await client.connect();
    console.log("Connected successfully to MongoDB");
    const database = client.db("trading");
    const collection = database.collection("trade");
    const result = await collection.findOne({});
    stopLoss = result?.stoploss;
  } catch (e) {
    console.error(e);
  }
}

async function update(stop) {
  try {
    const database = client.db("trading");
    const collection = database.collection("trade");
    await collection.findOneAndUpdate(
      { trade: true },
      { $set: { stoploss: stop } },
      { returnNewDocument: true }
    );
    sendMessage(`💸 Stop Loss trailed to ${stop}`);
  } catch (e) {
    console.error(e);
  }
}

connect();

ws.on("open", () => {
  console.log("🔌 Connected");
  send({ authorize: API_TOKEN });
});

//Websocket
ws.on("message", async (msg) => {
  const data = JSON.parse(msg);

  if (data.msg_type === "authorize") {
    console.log("✅ Authorized");
    send({ balance: 1, subscribe: 1 });
    send({ portfolio: 1 });
    send({
      ticks_history: "stpRNG",
      style: "candles",
      count: 500,
      granularity: 300,
      end: "latest",
    });
  }

  if (data.msg_type === "balance") {
    let balance = data?.balance?.balance;
    if (isNumberBetween(balance, 0, 5)) {
      amount = 1;
    } else if (isNumberBetween(balance, 5, 10)) {
      amount = 2;
    } else if (isNumberBetween(balance, 10, 20)) {
      amount = 4;
    } else if (isNumberBetween(balance, 20, 40)) {
      amount = 8;
    } else if (isNumberBetween(balance, 40, 80)) {
      amount = 16;
    } else if (isNumberBetween(balance, 80, 160)) {
      amount = 32;
    } else if (isNumberBetween(balance, 160, 320)) {
      amount = 64;
    } else if (isNumberBetween(balance, 320, 640)) {
      amount = 128;
    } else if (isNumberBetween(balance, 640, 1280)) {
      amount = 256;
    } else if (isNumberBetween(balance, 1280, 2560)) {
      amount = 512;
    } else if (isNumberBetween(balance, 2560, 5120)) {
      amount = 1000;
    } else {
      amount = 1000;
    }
    sendMessage(`💸 Balance is currently ${balance}`);
    // await run(10000);
    // send({ balance: 1 });
  }

  if (data.msg_type === "portfolio") {
    if (data?.portfolio?.contracts?.length === 0) {
      openPosition = null;
      openContractId = null;
      position = null;
      subscribed = false;
      canBuy = true;
      if (stopLoss !== null) {
        if (stopLoss === 0) {
          return;
        } else {
          update(0); 
        }
      }
    } else {
      openPosition =
        data?.portfolio?.contracts[data?.portfolio?.contracts?.length - 1];
      position = openPosition?.contract_type;
      openContractId = openPosition?.contract_id;
      if (data?.portfolio?.contracts?.length > 1) {
        closePosition(openContractId, "too many positions");
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
    // await run(10000);
    // send({ portfolio: 1 });
  }

  if (data.msg_type === "candles") {
    try {
      closePrices = data.candles.map((c) => c.close);
      openPrices = data.candles.map((c) => c.open);
      highPrices = data.candles.map((c) => c.high);
      lowPrices = data.candles.map((c) => c.low);

      const len = closePrices?.length;
      const prevIndex = len - 2;
      const currIndex = len - 1;

      const ema14 = calculateEMA(closePrices, 14);
      const ema21 = calculateEMA(closePrices, 21);
      const ema21Prev = ema21[prevIndex];
      const ema14Now = ema14[currIndex];
      const ema21Now = ema21[currIndex];

      const trend = ema14Now > ema21Now;

      if (previousCandle !== closePrices[prevIndex]) {
        if (
          trend === true &&
          bullish(prevIndex) &&
          crossedEma(prevIndex, ema21Prev)
        ) {
          if (canBuy === false) {
            if (position === "MULTDOWN") {
              closePosition(openContractId, `Opposite Signal`);
              buyMultiplier("MULTUP", data?.echo_req?.ticks_history, amount);
              previousCandle = closePrices[prevIndex];
            }
          } else {
            buyMultiplier("MULTUP", data?.echo_req?.ticks_history, amount);
            previousCandle = closePrices[prevIndex];
          }
        }
        if (
          trend === false &&
          bearish(prevIndex) &&
          crossedEma(prevIndex, ema21Prev)
        ) {
          if (canBuy === false) {
            if (position === "MULTUP") {
              closePosition(openContractId, `Opposite Signal`);
              buyMultiplier("MULTDOWN", data?.echo_req?.ticks_history, amount);
              previousCandle = closePrices[prevIndex];
            }
          } else {
            buyMultiplier("MULTDOWN", data?.echo_req?.ticks_history, amount);
            previousCandle = closePrices[prevIndex];
          }
        }
      }
    } catch (err) {
      sendMessage(err);
    }

    count += 1;
    console.log(count);
    send({
      ticks_history: data?.echo_req?.ticks_history,
      style: "candles",
      count: 500,
      granularity: data?.echo_req?.granularity,
      end: "latest",
    });
  }

  if (data.msg_type === "proposal_open_contract") {
    canBuy = false;
    subscribed = true;
    const type = data?.proposal_open_contract?.contract_type;
    const entrySpot = data?.proposal_open_contract?.entry_spot;
    const currentSpot = data?.proposal_open_contract?.current_spot;
    const orderAmount =
      data?.proposal_open_contract?.limit_order?.stop_out?.order_amount;
    const stopOut = data?.proposal_open_contract?.limit_order?.stop_out?.value;
    const stop = data?.proposal_open_contract?.limit_order?.stop_loss?.value;
    const takeProfit =
      data?.proposal_open_contract?.limit_order?.take_profit?.value;
    const pip =
      type === "MULTUP" ? currentSpot - entrySpot : entrySpot - currentSpot;
    const loss = type === "MULTUP" ? entrySpot - stopOut : stopOut - entrySpot;
    const risk =
      type === "MULTUP" ? entrySpot - stopLoss : stopLoss - entrySpot;
    const gain =
      type === "MULTUP" ? takeProfit - entrySpot : entrySpot - takeProfit;
    const profit = data?.proposal_open_contract?.profit;
    if (pip >= 40 && stopLoss < 20) {
      update(20);
    } else if (pip >= 20 && stopLoss < 10) {
      update(10);
    } else if (pip >= 10 && stopLoss < 5) {
      update(5);
    } else if (pip >= 5 && stopLoss === 0) {
      update(1);
    }
    if (stopLoss !== 0 && pip < stopLoss) {
      closePosition(openContractId, `Stop Loss Hit`);
    }
    const runningTrade = {
      pip: pip,
      profit: profit,
      loss: loss,
      orderAmount: orderAmount,
      gain: gain,
      risk: risk,
      stopLoss: stopLoss,
    };
    console.log(runningTrade);
  }

  if (data.msg_type === "buy") {
    position = data?.echo_req?.parameters?.contract_type;
    openContractId = data?.buy?.contract_id;
    sendMessage(`${position} position entered`);
    console.log(
      `🟢 Entered ${position} position, Contract ID: ${openContractId}`
    );
    send({ portfolio: 1 });
  }

  if (data.msg_type === "sell") {
    sendMessage(
      `💸 Position closed at ${data?.sell?.sold_for} USD, because ${reason}`
    );
    console.log(
      `💸 Position closed at ${data?.sell?.sold_for} USD, because ${reason}`
    ); 
    position = null;
    openContractId = null;
    canBuy = true;
    subscribed = false;
    update(0);
    send({ portfolio: 1 });
  }

  if (data.error) {
    const error = data?.error?.message;
    console.error("❗ Error: ", error);
    sendMessage(`❗ Error: ${error}`);
  }
});
