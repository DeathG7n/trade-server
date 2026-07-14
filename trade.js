import WebSocket from "ws";
import express from "express";
import cors from "cors";
import axios from "axios";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import { wsUrl } from "./server.js";
import {
  bearish,
  bullish,
  calculateHeikinAshi,
  candleCrossesEitherEMA,
  crossedEma,
} from "./util.js";

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
const DEPLOY_HOOK = process.env.DEPLOY_HOOK;

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
let lastBalance = null;
let timeframes = [60, 900];
let trades = 1;
const subscribedContracts = new Set();

const symbols = [
  "stpRNG",
  "stpRNG2",
  // "stpRNG3",
  // "stpRNG4",
  // "stpRNG5",
  // "1HZ10V",
  // "R_10",
  // "1HZ25V",
  // "R_25",
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
  // "JD100",
];

const alertSymbols = [];
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
];
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
    close15: [],
    open15: [],
    high15: [],
    low15: [],
    openTime15: 0,
    trendUp15: false,
    trendDown15: false,
    multiplier_range: [],
    canAlert: true,
    canAlert15: true,
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

function send(msg) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(ms) {
  // console.log(`⏳ Waiting ${ms / 1000} seconds...`);
  await sleep(ms);
  // console.log("✅ Done!");
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
  const stopLoss = stake / 2;
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
  send(request);
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
    if (!symbol) return;
    const database = client.db("trading");
    const collection = database.collection("trade");
    await collection.findOneAndUpdate(
      { contract_id: id },
      { $set: { stoploss: stop } },
    );

    //sendMessage(`💸 Stop Loss trailed to ${stop} on ${symbol}`);

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
        timeframes.forEach((t) => {
          send({
            ticks_history: s,
            style: "candles",
            count: 500,
            granularity: t,
            end: "latest",
            subscribe: 1,
          });
        });
      });
    }

    if (data.msg_type === "balance") {
      balance = data.balance.balance;
      if (balance !== lastBalance) {
        //sendMessage(`💸 Balance is currently ${balance}`);
        console.log(`💸 Balance is currently ${balance}`);
        lastBalance = balance;
      }
      balance = Math.trunc(balance);
      if (balance < 12) {
        amount = 1;
      } else {
        amount = Math.min(1000, 2 ** Math.floor(Math.log2(balance / 12) + 1));
      }

      const forefeit = 2 ** Math.floor(Math.log2(balance / 12) + 1);
      if (forefeit < 1000) {
        trades = 1;
      } else {
        trades = Math.trunc(forefeit / 1000);
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
          const symbol = contract.underlying_symbol;
          const asset = {
            name: symbol,
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
        if (data.echo_req.granularity === 900) {
          md.close15 = data.candles.map((c) => c.close);
          md.open15 = data.candles.map((c) => c.open);
          md.high15 = data.candles.map((c) => c.high);
          md.low15 = data.candles.map((c) => c.low);
        }
        if (data.echo_req.granularity === 60) {
          md.close = data.candles.map((c) => c.close);
          md.open = data.candles.map((c) => c.open);
          md.high = data.candles.map((c) => c.high);
          md.low = data.candles.map((c) => c.low);
        }
      } catch (err) {
        sendMessage(String(err));
      }
      count += 1;
      console.log(count);
    }

    if (data.msg_type === "ohlc" && !loading) {
      const symbol = data.echo_req.ticks_history;
      const md = marketData[symbol];
      const matchingPositions = positions.filter((p) => p?.name === symbol);
      const multiplierPositions = matchingPositions.filter(
        (p) => p.type !== "ONETOUCH",
      );
      const riskyPosition = multiplierPositions.find((p) => p.stoploss === 0);
      if (!md.multiplier_range?.length) return;

      if (data.echo_req.granularity === 900) {
        if (md.openTime15 === 0) {
          md.openTime15 = data.ohlc.open_time;
        }

        if (md.openTime15 !== data.ohlc.open_time) {
          md.openTime15 = data.ohlc.open_time;
          md.canAlert15 = true;
          send({
            ticks_history: data.echo_req.ticks_history,
            style: "candles",
            count: 500,
            granularity: data.echo_req.granularity,
            end: "latest",
          });

          return;
        }

        if (md.close15.length === 0) {
          md.close15.push(Number(data.ohlc.close));
          md.open15.push(Number(data.ohlc.open));
          md.high15.push(Number(data.ohlc.high));
          md.low15.push(Number(data.ohlc.low));
        } else {
          md.close15[md.close15.length - 1] = Number(data.ohlc.close);
          md.open15[md.open15.length - 1] = Number(data.ohlc.open);
          md.high15[md.high15.length - 1] = Number(data.ohlc.high);
          md.low15[md.low15.length - 1] = Number(data.ohlc.low);
        }

        const len = md.close15.length;
        const prevIndex = len - 2;
        if (len < 200) return;

        const ema14 = calculateEMA(md.close15, 14);
        const ema21 = calculateEMA(md.close15, 21);

        md.trendUp15 = ema14[prevIndex] > ema21[prevIndex]
        md.trendDown15 = ema14[prevIndex] < ema21[prevIndex]
      }

      if (data.echo_req.granularity === 60) {
        if (md.openTime === 0) {
          md.openTime = data.ohlc.open_time;
        }

        if (md.openTime !== data.ohlc.open_time) {
          md.openTime = data.ohlc.open_time;
          md.canAlert = true;
          send({
            ticks_history: data.echo_req.ticks_history,
            style: "candles",
            count: 500,
            granularity: data.echo_req.granularity,
            end: "latest",
          });
          return;
        }

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

        const ha = calculateHeikinAshi(md.open, md.high, md.low, md.close);

        const haOpen = ha.open;
        const haHigh = ha.high;
        const haLow = ha.low;
        const haClose = ha.close;

        const len = md.close.length;
        const currIndex = len - 1;
        const prevIndex = len - 2;
        const thirdIndex = len - 3;
        if (len < 200) return;

        const ema50 = calculateEMA(md.close, 50);
        const ema50Then = ema50[prevIndex];

        if (md.canAlert && alertSymbols.includes(symbol)) {
          if (
            md.trendUp15 &&
            candleCrossesEitherEMA(currIndex, ema50, ema50, md.high, md.low) &&
            bullish(md.open, md.close, currIndex)
          ) {
            sendMessage(`Bullish signal off EMA on ${symbol} 1 minute`);
            md.canAlert = false;
          }
          if (
            md.trendDown15 &&
            candleCrossesEitherEMA(currIndex, ema50, ema50, md.high, md.low) &&
            bearish(md.open, md.close, currIndex)
          ) {
            sendMessage(`Bearish signal off EMA on ${symbol} 1 minute`);
            md.canAlert = false;
          }
        }

        if (
          !riskyPosition &&
          Math.trunc(balance) !== 0 &&
          tradeSymbols.includes(symbol)
        ) {
          if (
            crossedEma(haHigh, haLow, prevIndex, ema50) ||
            crossedEma(haHigh, haLow, thirdIndex, ema50)
          ) {
            if (
              md.trendUp15 &&
              bullish(haOpen, haClose, prevIndex) &&
              haClose[prevIndex] > ema50Then
            ) {
              loading = true;
              await getMultiProposal(
                "MULTUP",
                symbol,
                amount,
                md.multiplier_range[0],
              );
            }
            if (
              md.trendDown15 &&
              bearish(haOpen, haClose, prevIndex) &&
              haClose[prevIndex] < ema50Then
            ) {
              loading = true;
              await getMultiProposal(
                "MULTDOWN",
                symbol,
                amount,
                md.multiplier_range[0],
              );
            }
          }
        }
        if (multiplierPositions.length !== 0) {
          for (const contract of multiplierPositions) {
            if (contract?.type === "MULTUP") {
              if (md.trendDown15) {
                loading = true;
                contract.contract_id &&
                  closePosition(
                    symbol,
                    contract.contract_id,
                    `Opposite Signal`,
                  );
              }
            }
            if (contract?.type === "MULTDOWN") {
              if (md.trendUp15) {
                loading = true;
                contract.contract_id &&
                  closePosition(
                    symbol,
                    contract.contract_id,
                    `Opposite Signal`,
                  );
              }
            }
          }
        }
      }
    }
    if (data.msg_type === "proposal") {
      for (let i = 0; i < trades; i++) {
        try {
          buyContract(
            data?.echo_req?.contract_type,
            data?.proposal?.id,
            data?.proposal?.ask_price,
          );
        } catch (err) {
          sendMessage(String(err));
        }
      }
    }

    if (data.msg_type === "proposal_open_contract") {
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
      const stopOut =
        data.proposal_open_contract?.limit_order?.stop_out?.order_amount;
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
        if (!position) return;
        if (lossAmount == null) return;
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
          profit >= Math.abs(lossAmount * 2.5) && //1
          position.stoploss === Math.abs(lossAmount) //0.4
        ) {
          position.stoploss = Math.abs(lossAmount * 1.25); //0.5
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
        stopOutAmount: stopOut,
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
      //sendMessage(`${data?.buy?.shortcode}`);
      console.log(`🟢 ${data?.buy?.shortcode}`);
    }

    if (data.msg_type === "sell") {
      const database = client.db("trading");
      const collection = database.collection("trade");
      const contract_id = data.sell?.contract_id || data.echo_req?.sell;

      const position = positions.find((p) => p.contract_id === contract_id);

      if (!position) return;

      subscribedContracts.delete(contract_id);
      // sendMessage(
      //   `💸 Position closed at ${data.sell?.sold_for} USD on ${position.name}, because ${position.reason}`,
      // );

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

      if (position) {
        sendMessage(`💸 Position updated on ${position.name}`);
      }
    }

    if (data.error) {
      const error = data?.error?.message;
      console.error("❗ Error: ", error);
      sendMessage(`❗ Error: ${error}`);
      if (error === "You have reached the rate limit for ticks_history.") {
        await run(30000);
        symbols.forEach((s) => {
          send({ contracts_for: s });
          timeframes.forEach((t) => {
            send({
              ticks_history: s,
              style: "candles",
              count: 500,
              granularity: t,
              end: "latest",
              subscribe: 1,
            });
          });
        });
        sendMessage(`Candles Resubscribed`);
      }
      if (error === "Please log in.") {
        fetch(DEPLOY_HOOK).then(() => sendMessage(`Login Reinitiated`));
      }
    }
  });
} catch (err) {
  sendMessage(String(err));
}

ws.on("close", () => {
  sendMessage("WebSocket disconnected. Reconnecting...");
  fetch(DEPLOY_HOOK).then(() => sendMessage(`Login Reinitiated`));
});
