import WebSocket from "ws";
import express from "express";
import cors from "cors";
import axios from "axios";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import { wsUrl } from "./server.js";

dotenv.config();
const app = express();

let ws = new WebSocket(wsUrl);

// eslint-disable-next-line no-undef
const API_TOKEN = process.env.API_TOKEN;
// eslint-disable-next-line no-undef
const BOT_TOKEN = process.env.BOT_TOKEN;
// eslint-disable-next-line no-undef
const CHAT_ID = process.env.CHAT_ID;

// eslint-disable-next-line no-undef
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

let positions = [];
let count = 0;
let amount = null;
let balance = null;
let now = new Date();
let connection = false;
let authorized = false;
let loading = true;
const subscribedContracts = new Set();

const symbols = ["stpRNG", "stpRNG2", "stpRNG3", "stpRNG4", "stpRNG5"];
let marketData = {};
symbols.forEach((s) => {
  marketData[s] = {
    close: [],
    open: [],
    high: [],
    low: [],
    openTime: 0,
    trendUp: false,
    trendDown: false,
    multiplier_range: [],
  };
});

app.use(cors());

app.get("/", (req, res) => {
  res.json("Hi");
});

app.listen(3000, () => {
  console.log("Server is running");
});

//Functions
function bearish(open, close, candle) {
  return open[candle] > close[candle];
}
function bullish(open, close, candle) {
  return close[candle] > open[candle];
}

function crossedEma(high, low, candle, ema) {
  return high[candle] > ema[candle] && ema[candle] > low[candle];
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
  emaArray[0] = prices[0];
  for (let i = 1; i < prices.length; i++) {
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
      error.response?.data || error?.message,
    );
  }
};

async function getMultiProposal(direction, symbol, stake, multiplier) {
  const stopLoss = stake / 2.5;
  const takeProfit = stopLoss * 3;
  const request = {
    proposal: 1,
    amount: stake,
    contract_type: direction,
    currency: "USD",
    underlying_symbol: symbol,
    multiplier: multiplier,
    basis: "stake",
    limit_order: { stop_loss: stopLoss, take_profit: takeProfit },
  };
  ws.send(JSON.stringify(request));
}

function buyContract(direction, id, stake) {
  console.log(`📈 Buying ${direction} contract...`);
  send({
    buy: id,
    price: stake,
  });
}

function closePosition(symbol, contract_id, why) {
  send({
    sell: contract_id,
    price: 0,
  });
  const position = positions.find((p) => p.contract_id === contract_id);
  if (position) {
    position.reason = why;
  } else {
    console.warn("Position not found for close:", contract_id);
  }
  console.log(`❌ Closing position: ${contract_id}`);
}

async function connect() {
  try {
    await client.connect();
    console.log("Connected successfully to MongoDB");
    connection = true;
    authorized = true;
  } catch (e) {
    console.error(e);
  }
}

async function update(stop, id, symbol) {
  try {
    const database = client.db("trading");
    const collection = database.collection("trade");

    await collection.findOneAndUpdate(
      { contract_id: id },
      { $set: { stoploss: stop } },
    );

    sendMessage(`💸 Stop Loss trailed to ${stop} on ${symbol}`);

    send({ portfolio: 1 });
  } catch (e) {
    console.error(e);
  }
}

connect();

ws.on("open", () => {
  console.log("🔌 Connected");
  const interval = setInterval(() => {
    if (authorized) {
      send({ authorize: API_TOKEN });
      authorized = false;
      clearInterval(interval);
    }
  }, 1000);
});

//Websocket
try {
  ws.on("message", async (msg) => {
    const data = JSON.parse(msg);

    if (data.msg_type === "authorize") {
      console.log("✅ Authorized");
      send({ balance: 1, subscribe: 1 });
      symbols.forEach((s) => {
        send({ contracts_for: s });
        send({
          ticks_history: s,
          style: "candles",
          count: 500,
          granularity: 300,
          end: "latest",
          subscribe: 1,
        });
      });
    }

    if (data.msg_type === "balance") {
      balance = data.balance.balance;
      sendMessage(`💸 Balance is currently ${balance}`);
      console.log(`💸 Balance is currently ${balance}`);
      balance = Math.trunc(balance);
      if (isNumberBetween(balance, 0, 6)) {
        amount = 1;
      } else if (isNumberBetween(balance, 7, 13)) {
        amount = 2;
      } else if (isNumberBetween(balance, 14, 27)) {
        amount = 4;
      } else if (isNumberBetween(balance, 28, 59)) {
        amount = 8;
      } else if (isNumberBetween(balance, 60, 119)) {
        amount = 10;
      } else if (isNumberBetween(balance, 120, 239)) {
        amount = 20;
      } else if (isNumberBetween(balance, 240, 479)) {
        amount = 40;
      } else if (isNumberBetween(balance, 480, 599)) {
        amount = 80;
      } else if (isNumberBetween(balance, 600, 1199)) {
        amount = 100;
      } else if (isNumberBetween(balance, 1200, 2399)) {
        amount = 200;
      } else if (isNumberBetween(balance, 2400, 4799)) {
        amount = 400;
      } else if (isNumberBetween(balance, 4800, 5999)) {
        amount = 800;
      } else if (isNumberBetween(balance, 6000, 11999)) {
        amount = 1000;
      } else if (balance >= 12000) {
        amount = 2000;
      }
      send({ portfolio: 1 });
    }
    if (data.msg_type === "portfolio") {
      loading = true;
      const database = client.db("trading");
      const collection = database.collection("trade");
      let assets = await collection.find({}).toArray();
      positions = assets;

      const activeContractIds = data?.portfolio?.contracts.map(
        (contract) => contract.contract_id,
      );

      for (const asset of assets) {
        const stillOpen = activeContractIds?.includes(asset.contract_id);

        if (!stillOpen) {
          await collection.deleteOne({
            contract_id: asset.contract_id,
          });

          console.log(`Deleted closed contract ${asset.contract_id}`);
        }
      }

      if (data?.portfolio?.contracts.length !== 0) {
        let ticker = 0;
        for (const contract of data.portfolio.contracts) {
          const asset = {
            name: contract.underlying_symbol,
            contract_id: contract.contract_id,
            stoploss: 0,
            date_start: contract.date_start,
            type: contract.contract_type,
          };

          const exists = await collection.findOne({
            contract_id: contract.contract_id,
          });

          if (!exists) {
            const result = await collection.insertOne(asset);
            console.log(`Document created with _id: ${result.insertedId}`);
          }
          assets = await collection.find({}).toArray();
          positions = assets;

          ticker += 1;
          if (ticker === data?.portfolio?.contracts.length) {
            loading = false;
          } else {
            loading = true;
          }
        }
        for (const position of positions) {
          const id = position.contract_id;

          if (subscribedContracts.has(id)) continue;

          send({
            proposal_open_contract: 1,
            contract_id: id,
            subscribe: 1,
          });

          subscribedContracts.add(id);
        }
      } else {
        loading = false;
        for (let i = 0; i < positions.length; i++) {
          await collection.deleteOne({
            contract_id: positions[i].contract_id,
          });

          console.log(`Deleted closed contract ${positions[i].contract_id}`);
        }
      }
    }

    if (data.msg_type === "contracts_for") {
      const symbol = data.echo_req.contracts_for;
      const md = marketData[symbol];
      for (
        let index = 0;
        index < data?.contracts_for?.available.length;
        index++
      ) {
        if (
          data?.contracts_for?.available[index].contract_category ===
          "multiplier"
        )
          md.multiplier_range =
            data?.contracts_for?.available[index]?.multiplier_range;
      }
    }

    if (data.msg_type === "candles") {
      const symbol = data.echo_req.ticks_history;
      const md = marketData[symbol];
      const current = new Date();
      if (now.getHours() != current.getHours()) {
        now = new Date();
        sendMessage("Bot is still running");
      }
      try {
        if (data.echo_req.granularity === 300) {
          md.close = data.candles.map((c) => c.close);
          md.open = data.candles.map((c) => c.open);
          md.high = data.candles.map((c) => c.high);
          md.low = data.candles.map((c) => c.low);
        }
      } catch (err) {
        sendMessage(err);
      }
      count += 1;
      console.log(count);
    }

    if (data.msg_type === "ohlc" && !loading) {
      const symbol = data.echo_req.ticks_history;
      const md = marketData[symbol];
      const matchingPositions = positions.filter((p) => p?.name === symbol);

      if (data.echo_req.granularity === 300) {
        if (md.openTime === 0) {
          md.openTime = data.ohlc.open_time;
        }
        const multiplierPositions = matchingPositions.filter(
          (p) => p.type !== "ONETOUCH",
        );
        const riskyPosition = multiplierPositions.find((p) => p.stoploss === 0);

        if (md.close.length === 0) {
          md.close.push(Number(data.ohlc.close));
          md.open.push(Number(data.ohlc.open));
          md.high.push(Number(data.ohlc.high));
          md.low.push(Number(data.ohlc.low));
        } else {
          md.close[md.close.length - 1] = Number(data.ohlc.close);
          md.open[md.open.length - 1] = Number(data.ohlc.open);
          md.high[md.high.length - 1] = Number(data.ohlc.high);
          md.low[md.low.length - 1] = Number(data.ohlc.low);
        }

        const len = md.close.length;
        const currIndex = len - 1;
        const prevIndex = len - 2;

        const ema9 = calculateEMA(md.close, 9);
        const ema9Now = ema9[currIndex];

        const ema14 = calculateEMA(md.close, 14);
        const ema14Now = ema14[currIndex];

        md.trendUp = ema9Now > ema14Now;
        md.trendDown = ema9Now < ema14Now;

        if (!riskyPosition && Math.trunc(balance) !== 0) {
          if (
            md.trendUp &&
            crossedEma(md.high, md.low, prevIndex, ema14) &&
            recentEmaCross(ema9, ema14, 15) &&
            bullish(md.open, md.close, prevIndex)
          ) {
            await getMultiProposal(
              "MULTUP",
              symbol,
              amount,
              md.multiplier_range[0],
            );
            loading = true;
          }
          if (
            md.trendDown &&
            crossedEma(md.high, md.low, prevIndex, ema14) &&
            recentEmaCross(ema9, ema14, 15) &&
            bearish(md.open, md.close, prevIndex)
          ) {
            await getMultiProposal(
              "MULTDOWN",
              symbol,
              amount,
              md.multiplier_range[0],
            );
            loading = true;
          }
        }

        for (const contract of multiplierPositions) {
          if (contract?.type === "MULTUP") {
            if (
              md.trendDown &&
              crossedEma(md.high, md.low, prevIndex, ema14) &&
              recentEmaCross(ema9, ema14, 15) &&
              bearish(md.open, md.close, prevIndex)
            ) {
              contract.contract_id &&
                closePosition(symbol, contract.contract_id, `Opposite Signal`);
            }
          }
          if (contract?.type === "MULTDOWN") {
            if (
              md.trendUp &&
              crossedEma(md.high, md.low, prevIndex, ema14) &&
              recentEmaCross(ema9, ema14, 15) &&
              bullish(md.open5, md.close5, prevIndex)
            ) {
              contract.contract_id &&
                closePosition(symbol, contract.contract_id, `Opposite Signal`);
            }
          }
        }

        if (md.openTime !== data.ohlc.open_time) {
          md.openTime = data.ohlc.open_time;
          send({
            ticks_history: data.echo_req.ticks_history,
            style: "candles",
            count: 500,
            granularity: data.echo_req.granularity,
            end: "latest",
          });
        }
      }
    }
    if (data.msg_type === "proposal") {
      buyContract(
        data?.echo_req?.contract_type,
        data?.proposal?.id,
        data?.proposal?.ask_price,
      );
    }

    if (data.msg_type === "proposal_open_contract" && !loading) {
      const id = data?.echo_req?.contract_id;
      const position = positions.find((p) => p.contract_id === id);
      const symbol = data.proposal_open_contract?.underlying_symbol;
      const commission = data.proposal_open_contract?.commission;
      const multiplier = data.proposal_open_contract?.multiplier;
      const type = data.proposal_open_contract?.contract_type;
      const entrySpot = data.proposal_open_contract?.entry_spot;
      const currentSpot = data.proposal_open_contract?.current_spot;
      const orderAmount = data?.proposal_open_contract?.buy_price;
      const lossAmount =
        data.proposal_open_contract?.limit_order?.stop_loss?.order_amount;
      const profitAmount =
        data.proposal_open_contract?.limit_order?.take_profit?.order_amount;
      const stopOut = data.proposal_open_contract?.limit_order?.stop_out?.value;
      const stop = data.proposal_open_contract?.limit_order?.stop_loss?.value;
      const takeProfit =
        data.proposal_open_contract?.limit_order?.take_profit?.value;
      const pip =
        type === "MULTUP" ? currentSpot - entrySpot : entrySpot - currentSpot;
      const loss =
        type === "MULTUP" ? entrySpot - stopOut : stopOut - entrySpot;
      const risk = type === "MULTUP" ? entrySpot - stop : stop - entrySpot;
      const gain =
        type === "MULTUP" ? takeProfit - entrySpot : entrySpot - takeProfit;
      const profit = Number(data.proposal_open_contract?.profit);
      const duration =
        data?.proposal_open_contract?.current_spot_time -
        data?.proposal_open_contract?.date_start;
      if (position) {
        position.subscribed = true;
        position.profit = profit;
      }

      if (connection && type !== "ONETOUCH") {
        if (pip >= risk && position.stoploss === 0) {
          position.stoploss = Math.abs(commission);
          update(position.stoploss, id, symbol);
        }
        if (
          profit >= Math.abs(lossAmount * 2) && //0.8
          position.stoploss === Math.abs(commission)
        ) {
          position.stoploss = Math.abs(lossAmount); //0.4
          update(position.stoploss, id, symbol);
        }
        if (
          profit >= Math.abs(lossAmount * 5) && //2
          position.stoploss === Math.abs(lossAmount) //0.4
        ) {
          position.stoploss = Math.abs(lossAmount * 2.5); //1
          update(position.stoploss, id, symbol);
        }
        if (
          profit >= Math.abs(lossAmount * 10) && //4
          position.stoploss === Math.abs(lossAmount * 2.5) //1
        ) {
          position.stoploss = Math.abs(lossAmount * 5); //2
          update(position.stoploss, id, symbol);
        }
        if (
          position &&
          position.stoploss !== 0 &&
          profit <= position.stoploss
        ) {
          closePosition(symbol, position.contract_id, `Stop Loss Hit`);
          position.stoploss = 0;
          update(position.stoploss, id, symbol);
        }
      }

      const runningTrade = {
        multiplier: multiplier,
        pip: pip,
        profit: profit,
        loss: loss,
        orderAmount: orderAmount,
        lossAmount: lossAmount,
        profitAmount: profitAmount,
        gain: gain,
        risk: risk,
        stopLoss: position?.stoploss,
        symbol: symbol,
        type: type,
      };

      if (duration === 2) {
        sendMessage(JSON.stringify(runningTrade, null, 2));
      }

      console.log(runningTrade);
    }

    if (data.msg_type === "buy") {
      sendMessage(`${data?.buy?.shortcode}`);
      console.log(`🟢 ${data?.buy?.shortcode}`);
    }

    if (data.msg_type === "sell") {
      const database = client.db("trading");
      const collection = database.collection("trade");
      const contract_id = data.sell?.contract_id || data.echo_req?.sell;

      const position = positions.find((p) => p.contract_id === contract_id);

      if (!position) return;

      sendMessage(
        `💸 Position closed at ${data.sell?.sold_for} USD on ${position.name}, because ${position.reason}`,
      );

      console.log(
        `💸 Position closed at ${data.sell?.sold_for} USD on ${position.name}, because ${position.reason}`,
      );

      await collection.deleteOne({ contract_id: contract_id });

      console.log(`Deleted closed contract ${contract_id}`);
    }

    if (data.msg_type === "contract_update") {
      const position = positions.find(
        (p) => p.contract_id === data.echo_req.contract_id,
      );
      sendMessage(`💸 Position updated on ${position.name}`);
    }

    if (data.error) {
      const error = data?.error?.message;
      console.error("❗ Error: ", error);
      sendMessage(`❗ Error: ${error}`);
      if (error === "You have reached the rate limit for ticks_history.") {
        await run(30000);
        symbols.forEach((s) => {
          send({ contracts_for: s });
          send({
            ticks_history: s,
            style: "candles",
            count: 500,
            granularity: 300,
            end: "latest",
            subscribe: 1,
          });
        });
        sendMessage(`Candles Resubscribed`);
      }
      if (error === "Please log in.") {
        fetch(
          "https://api.render.com/deploy/srv-d08lfobuibrs73b4vg9g?key=rpjXNGs05-o",
        ).then(() => sendMessage(`Login Reinitiated`));
      }
    }
  });
} catch (error) {
  sendMessage(error);
}

ws.on("close", () => {
  sendMessage("WebSocket disconnected. Reconnecting...");
  fetch(
    "https://api.render.com/deploy/srv-d08lfobuibrs73b4vg9g?key=rpjXNGs05-o",
  ).then(() => sendMessage(`Login Reinitiated`));
});
