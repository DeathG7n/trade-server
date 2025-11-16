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
let openPrices = [];
let closePrices30 = [];
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

const fs = require('fs');

function readStorage() {
  if (!fs.existsSync("storage.json")) {
    fs.writeFileSync("storage.json", JSON.stringify({}));
  }
  return JSON.parse(fs.readFileSync("storage.json"));
}

function writeStorage(obj) {
  fs.writeFileSync("storage.json", JSON.stringify(obj, null, 2));
}

function saveVar(key, value) {
  const data = readStorage();
  data[key] = value;
  writeStorage(data);
}

function loadVar(key) {
  return readStorage()[key];
}

ws.on("open", () => {
  console.log("🔌 Connected");
  send({ authorize: API_TOKEN });
});

//Websocket
ws.on("message", async (msg) => {
  const data = JSON.parse(msg);

  if (data.msg_type === "authorize") {
    console.log("✅ Authorized");
    send({ balance: 1 });
    send({ portfolio: 1 });
    send({
      ticks_history: "stpRNG",
      style: "candles",
      count: 500,
      granularity: 300,
      end: "latest",
    });
    setInterval(() => {
      send({
        ticks_history: "stpRNG",
        style: "candles",
        count: 300,
        granularity: 1800,
        end: "latest",
      });
    }, 900000);
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
    await run(10000);
    send({ balance: 1 });
  }

  if (data.msg_type === "portfolio") {
    if (data?.portfolio?.contracts?.length === 0) {
      openPosition = null;
      openContractId = null;
      position = null;
      subscribed = false;
      canBuy = true;
      saveVar("stopLoss", 0);
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
    await run(10000);
    send({ portfolio: 1 });
  }

  if (data.msg_type === "candles") {
    if (data?.echo_req?.granularity === 1800) {
      closePrices30 = data.candles.map((c) => c.close);
    } else {
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

        const len30 = closePrices30?.length;
        const currIndex30 = len30 - 1;

        const ema14_30 = calculateEMA(closePrices30, 14);
        const ema21_30 = calculateEMA(closePrices30, 21);
        const ema14_30Now = ema14_30[currIndex30];
        const ema21_30Now = ema21_30[currIndex30];

        const trend30 = ema14_30Now > ema21_30Now;

        if (previousCandle !== closePrices[prevIndex]) {
          if (trend30 === true) {
            if (canBuy === false) {
              if (position === "MULTDOWN") {
                closePosition(openContractId, `Opposite Signal`);
                if (
                  trend === true &&
                  bullish(prevIndex) &&
                  crossedEma(prevIndex, ema21Prev)
                ) {
                  buyMultiplier(
                    "MULTUP",
                    data?.echo_req?.ticks_history,
                    amount
                  );
                  previousCandle = closePrices[prevIndex];
                }
              }
            } else {
              if (
                trend === true &&
                bullish(prevIndex) &&
                crossedEma(prevIndex, ema21Prev)
              ) {
                buyMultiplier("MULTUP", data?.echo_req?.ticks_history, amount);
                previousCandle = closePrices[prevIndex];
              }
            }
          } else {
            if (canBuy === false) {
              if (position === "MULTUP") {
                closePosition(openContractId, `Opposite Signal`);
                if (
                  trend === false &&
                  bearish(prevIndex) &&
                  crossedEma(prevIndex, ema21Prev)
                ) {
                  buyMultiplier(
                    "MULTDOWN",
                    data?.echo_req?.ticks_history,
                    amount
                  );
                  previousCandle = closePrices[prevIndex];
                }
              }
            } else {
              if (
                trend === false &&
                bearish(prevIndex) &&
                crossedEma(prevIndex, ema21Prev)
              ) {
                buyMultiplier(
                  "MULTDOWN",
                  data?.echo_req?.ticks_history,
                  amount
                );
                previousCandle = closePrices[prevIndex];
              }
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
  }

  if (data.msg_type === "proposal_open_contract") {
    const stopLoss = loadVar("stopLoss")
    canBuy = false;
    subscribed = true;
    const type = data?.proposal_open_contract?.contract_type;
    const entrySpot = data?.proposal_open_contract?.entry_spot;
    const currentSpot = data?.proposal_open_contract?.current_spot;
    const orderAmount =
      data?.proposal_open_contract?.limit_order?.stop_out?.order_amount;
    const stopOut = data?.proposal_open_contract?.limit_order?.stop_out?.value;
    const stop =
      data?.proposal_open_contract?.limit_order?.stop_loss?.value;
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
      saveVar("stopLoss", 20);
      sendMessage(`💸 Stop Loss trailed from ${stopLoss}`);
    } else if (pip >= 20 && stopLoss < 10) {
      saveVar("stopLoss", 10);
      sendMessage(`💸 Stop Loss trailed from ${stopLoss}`);
    } else if (pip >= 10 && stopLoss < 5) {
      saveVar("stopLoss", 5);
      sendMessage(`💸 Stop Loss trailed from ${stopLoss}`);
    } else if (pip >= 5 && stopLoss === null) {
      saveVar("stopLoss", 1);
      sendMessage(`💸 Stop Loss trailed from ${stopLoss}`);
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
    saveVar("stopLoss", 0);
  }

  if (data.error) {
    const error = data?.error?.message;
    console.error("❗ Error: ", error);
    sendMessage(`❗ Error: ${error}`);
  }
});
