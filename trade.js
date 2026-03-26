const WebSocket = require("ws");
const express = require("express");
const app = express();
const cors = require("cors");
const axios = require("axios");
const { MongoClient } = require("mongodb");
const { cross } = require("ta.js");

const API_TOKEN = "cc2h1a8o1j3CiMQ";
let ws = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=36807");

const BOT_TOKEN = "8033524186:AAFp1cMBr1oRVUgCa2vwKPgroSw_i6M-qEQ";
const CHAT_ID = "8068534792";

const uri =
  "mongodb+srv://DeathG7n:if3anYichukwu@cluster0.gpfyqmb.mongodb.net/trading?retryWrites=true&w=majority";
const client = new MongoClient(uri);

let closePrices = [];
let openPrices = [];
let closePrices15 = [];
let openPrices15 = [];
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
let now = new Date();
let openTime = 0;
let openTime2 = 0;
let trendUp15 = null;
let trendDown15 = null;

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

function candleCrossesEitherEMA(index, ema1, ema2) {
  return crossedEma(index, ema1[index]) || crossedEma(index, ema2[index]);
}

function recentEmaCross(emaFast, emaSlow, lookback = 15) {
  const len = emaFast.length;

  for (let i = len - 2; i >= len - lookback - 1 && i > 0; i--) {
    // Bullish cross
    if (emaFast[i - 1] <= emaSlow[i - 1] && emaFast[i] > emaSlow[i]) {
      return "bullish";
    }

    // Bearish cross
    if (emaFast[i - 1] >= emaSlow[i - 1] && emaFast[i] < emaSlow[i]) {
      return "bearish";
    }
  }

  return null;
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
      error.response?.data || error.message,
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
      multiplier: 500,
      limit_order: { stop_loss: stake / 5, take_profit: stake },
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
      { returnNewDocument: true },
    );
    sendMessage(`💸 Stop Loss trailed to ${stop}`);
    stopLoss = stop;
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
    send({
      ticks_history: "BOOM1000",
      style: "candles",
      count: 500,
      granularity: 60,
      end: "latest",
      subscribe: 1,
    });
    send({
      ticks_history: "BOOM1000",
      style: "candles",
      count: 500,
      granularity: 900,
      end: "latest",
      subscribe: 1,
    });
  }

  if (data.msg_type === "balance") {
    let balance = data?.balance?.balance;
    sendMessage(`💸 Balance is currently ${balance}`);
    console.log(`💸 Balance is currently ${balance}`);
    balance = Math.trunc(balance);
    if (isNumberBetween(balance, 0, 5)) {
      amount = 1;
    } else if (isNumberBetween(balance, 6, 11)) {
      amount = 2;
    } else if (isNumberBetween(balance, 12, 23)) {
      amount = 4;
    } else if (isNumberBetween(balance, 24, 47)) {
      amount = 8;
    } else if (isNumberBetween(balance, 48, 95)) {
      amount = 16;
    } else if (isNumberBetween(balance, 96, 191)) {
      amount = 32;
    } else if (isNumberBetween(balance, 192, 383)) {
      amount = 64;
    } else if (isNumberBetween(balance, 384, 767)) {
      amount = 128;
    } else if (isNumberBetween(balance, 768, 1535)) {
      amount = 256;
    } else if (isNumberBetween(balance, 1536, 3071)) {
      amount = 512;
    } else if (isNumberBetween(balance, 3072, 5120)) {
      amount = 1000;
    } else {
      amount = 2000;
    }
    send({ portfolio: 1 });
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
  }

  if (data.msg_type === "ohlc") {
    if (data.ohlc.granularity === 60) {
      if (openTime !== data.ohlc.open_time) {
        openTime = data.ohlc.open_time;
        send({
          ticks_history: data?.echo_req?.ticks_history,
          style: "candles",
          count: 500,
          granularity: data?.echo_req?.granularity,
          end: "latest",
        });
      }
    }
    if (data.ohlc.granularity === 900) {
      if (openTime2 !== data.ohlc.open_time) {
        openTime2 = data.ohlc.open_time;
        send({
          ticks_history: data?.echo_req?.ticks_history,
          style: "candles",
          count: 500,
          granularity: data?.echo_req?.granularity,
          end: "latest",
        });
      }
    }
  }

  if (data.msg_type === "candles") {
    const current = new Date();
    if (now.getHours() != current.getHours()) {
      now = new Date();
      sendMessage("Bot is still running");
    }
    if (data?.echo_req?.granularity === 900) {
      closePrices15 = data.candles.map((c) => c.close);
      openPrices15 = data.candles.map((c) => c.open);

      const len = closePrices15?.length;
      const currIndex = len - 1;

      const ema14 = calculateEMA(closePrices15, 14);
      const ema14Now = ema14[currIndex];

      const ema21 = calculateEMA(closePrices15, 21);
      const ema21Now = ema21[currIndex];

      trendUp15 = ema14Now > ema21Now;
      trendDown15 = ema21Now > ema14Now;
    }
    if (data?.echo_req?.granularity === 60) {
      try {
        closePrices = data.candles.map((c) => c.close);
        openPrices = data.candles.map((c) => c.open);
        highPrices = data.candles.map((c) => c.high);
        lowPrices = data.candles.map((c) => c.low);

        const len = closePrices?.length;
        const thirdIndex = len - 3;
        const prevIndex = len - 2;
        const currIndex = len - 1;

        const ema14 = calculateEMA(closePrices, 14);
        const ema14Prev = ema14[prevIndex];
        const ema14Now = ema14[currIndex];

        const ema21 = calculateEMA(closePrices, 21);
        const ema21Prev = ema21[prevIndex];
        const ema21Now = ema21[currIndex];

        const trendUp = ema14Now > ema21Now;
        const trendDown = ema21Now > ema14Now;

        const crossType = recentEmaCross(ema14, ema21, 15);

        if (previousCandle !== closePrices[prevIndex]) {
          // if (
          //   bullish(thirdIndex) && bearish(prevIndex)
          // ) {
          //   if (canBuy === false) {
          //     if (position === "MULTDOWN") {
          //       closePosition(openContractId, `Opposite Signal`);
          //       buyMultiplier("MULTUP", data?.echo_req?.ticks_history, amount);
          //       previousCandle = closePrices[prevIndex];
          //     }
          //   } else {
          //     buyMultiplier("MULTUP", data?.echo_req?.ticks_history, amount);
          //     previousCandle = closePrices[prevIndex];
          //   }
          // }
          if (bullish(thirdIndex) && bearish(prevIndex)) {
            if (canBuy === false) {
              if (position === "MULTUP") {
                closePosition(openContractId, `Opposite Signal`);
                buyMultiplier(
                  "MULTDOWN",
                  data?.echo_req?.ticks_history,
                  amount,
                );
                previousCandle = closePrices[prevIndex];
              }
            } else {
              buyMultiplier("MULTDOWN", data?.echo_req?.ticks_history, 1);
              previousCandle = closePrices[prevIndex];
            }
          }
        }
      } catch (err) {
        sendMessage(err);
      }
    }

    count += 1;
    console.log(count);
  }

  if (data.msg_type === "proposal_open_contract") {
    canBuy = false;
    subscribed = true;
    const duration =
      data.proposal_open_contract.current_spot_time -
      data.proposal_open_contract.date_start;
    console.log(duration);
    if(duration % 60 == 0){
      timePassed =duration / 60
      sendMessage(`${timePassed} minute${timePassed > 1 ? "s" : ""} has passed`) 
    }
    const type = data?.proposal_open_contract?.contract_type;
    const entrySpot = data?.proposal_open_contract?.entry_spot;
    const currentSpot = data?.proposal_open_contract?.current_spot;
    const orderAmount =
      data?.proposal_open_contract?.limit_order?.stop_out?.order_amount;
    const lossAmount =
      data?.proposal_open_contract?.limit_order?.stop_loss?.order_amount;
    const profitAmount =
      data?.proposal_open_contract?.limit_order?.take_profit?.order_amount;
    const stopOut = data?.proposal_open_contract?.limit_order?.stop_out?.value;
    const stop = data?.proposal_open_contract?.limit_order?.stop_loss?.value;
    const takeProfit =
      data?.proposal_open_contract?.limit_order?.take_profit?.value;
    const pip =
      type === "MULTUP" ? currentSpot - entrySpot : entrySpot - currentSpot;
    const loss = type === "MULTUP" ? entrySpot - stopOut : stopOut - entrySpot;
    const risk = type === "MULTUP" ? entrySpot - stop : stop - entrySpot;
    const gain =
      type === "MULTUP" ? takeProfit - entrySpot : entrySpot - takeProfit;
    const profit = data?.proposal_open_contract?.profit;
    if (pip >= 100 && stopLoss === 0) {
      update(20);
    }
    if (stopLoss !== 0 && pip < stopLoss) {
      //closePosition(openContractId, `Stop Loss Hit`);
    }
    if(duration >= 300){
      closePosition(openContractId, `Stop Loss Hit`)
      console.log("5 minutes has passed")
    }
    const runningTrade = {
      pip: pip,
      profit: profit,
      loss: loss,
      orderAmount: orderAmount,
      lossAmount: lossAmount,
      profitAmount: profitAmount,
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
      `🟢 Entered ${position} position, Contract ID: ${openContractId}`,
    );
    send({ portfolio: 1 });
  }

  if (data.msg_type === "sell") {
    sendMessage(
      `💸 Position closed at ${data?.sell?.sold_for} USD, because ${reason}`,
    );
    console.log(
      `💸 Position closed at ${data?.sell?.sold_for} USD, because ${reason}`,
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
    if (error === "You have reached the rate limit for ticks_history.") {
      await run(30000);
      send({
        ticks_history: "BOOM1000",
        style: "candles",
        count: 500,
        granularity: 300,
        end: "latest",
        subscribe: 1,
      });
      sendMessage(`Candles Resubscribed`);
    }
    if (error === "Please log in.") {
      fetch(
        "https://api.render.com/deploy/srv-d08lfobuibrs73b4vg9g?key=rpjXNGs05-o",
      ).then((res) => sendMessage(`Login Reinitiated`));
    }
  }
});

ws.on("close", () => {
  sendMessage("WebSocket disconnected. Reconnecting...");
  ws = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=36807");
});
