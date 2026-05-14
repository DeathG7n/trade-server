const WebSocket = require("ws");
const express = require("express");
const app = express();
const cors = require("cors");
const axios = require("axios");
const { MongoClient } = require("mongodb");

const API_TOKEN = "cc2h1a8o1j3CiMQ";
let ws = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=36807");

const BOT_TOKEN = "8033524186:AAFp1cMBr1oRVUgCa2vwKPgroSw_i6M-qEQ";
const CHAT_ID = "8068534792";

const uri =
  "mongodb+srv://DeathG7n:if3anYichukwu@cluster0.gpfyqmb.mongodb.net/trading?retryWrites=true&w=majority";
const client = new MongoClient(uri);

let positions = {};
let count = 0;
let reason = "";
let amount = null;
let now = new Date();
let connection = false;

const symbols = ["stpRNG", "R_75", "stpRNG2", "stpRNG3", "stpRNG4", "stpRNG5"];
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
    openTime15: 0,
    trendUp15: false,
    trendDown15: false,
    canOpenTrade: true,
    canAlert: true,
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
  return high[candle] > ema && ema > low[candle];
}

function candleCrossesEitherEMA(index, ema1, ema2, high, low) {
  return (
    crossedEma(high, low, index, ema1[index]) ||
    crossedEma(high, low, index, ema2[index])
  );
}
function detectCrossover(emaFast, emaSlow) {
  const len = emaFast.length;

  if (len < 3) return null;

  const prevFast = emaFast[len - 3];
  const prevSlow = emaSlow[len - 3];

  const currFast = emaFast[len - 2];
  const currSlow = emaSlow[len - 2];

  if (prevFast <= prevSlow && currFast > currSlow) {
    return "bullish";
  }

  if (prevFast >= prevSlow && currFast < currSlow) {
    return "bearish";
  }

  return null;
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

function buyMultiplier(direction, symbol, stake, multiplier) {
  console.log(`📈 Buying ${direction} multiplier...`);
  send({
    buy: 1,
    price: stake,
    parameters: {
      amount: stake,
      basis: "stake",
      contract_type: direction,
      currency: "USD",
      symbol: symbol,
      multiplier: multiplier,
      limit_order: { stop_loss: stake / 5, take_profit: stake * 2 },
    },
  });
}

function closePosition(symbol, contract_id, why) {
  send({
    sell: contract_id,
    price: 0,
  });
  if (positions[symbol]) {
    positions[symbol].reason = why;
  }
  console.log(`❌ Closing position: ${contract_id}`);
}

async function connect() {
  try {
    await client.connect();
    console.log("Connected successfully to MongoDB");
    const database = client.db("trading");
    const collection = database.collection("trade");
    const assets = await collection.find({}).toArray();

    for (let i = 0; i < assets.length; i++) {
      if (symbols.includes(assets[i].name)) {
        if (positions[assets[i].name]) {
          positions[assets[i].name].stoploss = assets[i].stoploss;
        }
      } else {
        const result = await collection.deleteOne({ name: assets[i].name });
      }
    }

    for (let i = 0; i < symbols.length; i++) {
      const asset = {
        name: symbols[i],
        stoploss: 0,
      };

      const exists = await collection.findOne({ name: symbols[i] });
      if (exists) {
        continue;
      }
      const result = await collection.insertOne(asset);
      console.log(`Document created with _id: ${result.insertedId}`);
    }
    connection = true;
  } catch (e) {
    console.error(e);
  }
}

async function update(stop, symbol) {
  try {
    const database = client.db("trading");
    const collection = database.collection("trade");

    await collection.findOneAndUpdate(
      { name: symbol },
      { $set: { stoploss: stop } },
    );

    sendMessage(`💸 Stop Loss trailed to ${stop} on ${symbol}`);

    if (symbol && positions[symbol]) {
      positions[symbol].stoploss = stop;
    }
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
    symbols.forEach((s) => {
      send({ contracts_for: s });
      send({
        ticks_history: s,
        style: "candles",
        count: 500,
        granularity: 60,
        end: "latest",
        subscribe: 1,
      });
      send({
        ticks_history: s,
        style: "candles",
        count: 500,
        granularity: 900,
        end: "latest",
        subscribe: 1,
      });
    });
  }

  if (data.msg_type === "balance") {
    let balance = data.balance.balance;
    sendMessage(`💸 Balance is currently ${balance}`);
    console.log(`💸 Balance is currently ${balance}`);
    balance = Math.trunc(balance);
    if (isNumberBetween(balance, 1, 6)) {
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
    const activeSymbols = new Set();

    if (data?.portfolio?.contracts.length !== 0) {
      for (const contract of data?.portfolio?.contracts) {
        const md = marketData?.[contract?.symbol];

        if (positions[contract.symbol]) {
          md.canOpenTrade = false;
        } else {
          md.canOpenTrade = true;
        }
        activeSymbols.add(contract.symbol);

        if (!positions[contract.symbol]) {
          positions[contract.symbol] = {};
        }
        positions[contract.symbol] = {
          ...positions[contract.symbol],
          contractId: contract.contract_id,
          type: contract.contract_type,
          stoploss: 0,
        };

        if (!positions[contract.symbol].subscribed) {
          send({
            proposal_open_contract: 1,
            contract_id: contract.contract_id,
            subscribe: 1,
          });

          positions[contract.symbol].subscribed = true;
        }
      }
    }

    // Remove closed positions
    for (const symbol in positions) {
      if (!activeSymbols.has(symbol)) {
        delete positions[symbol];
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
        data?.contracts_for?.available[index].contract_category === "multiplier"
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
      }
      if (data.echo_req.granularity === 60) {
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

  if (data.msg_type === "ohlc") {
    const symbol = data.echo_req.ticks_history;
    const md = marketData[symbol];
    const position = positions[symbol];

    if (data.echo_req.granularity === 900) {
      if (md.openTime15 === 0) {
        md.openTime15 = data.ohlc.open_time;
      }
      if (md.close15.length === 0) {
        md.close15.push(Number(data.ohlc.close));
        md.open15.push(Number(data.ohlc.open));
      } else {
        md.close15[md.close15.length - 1] = Number(data.ohlc.close);
        md.open15[md.open15.length - 1] = Number(data.ohlc.open);
      }
      const len = md.close15.length;
      const currIndex = len - 1;
      const prevIndex = len - 2;

      const ema14 = calculateEMA(md.close15, 14);
      const ema14Then = ema14[prevIndex];

      const ema21 = calculateEMA(md.close15, 21);
      const ema21Then = ema21[prevIndex];

      md.trendUp15 = ema14Then > ema21Then;
      md.trendDown15 = ema14Then < ema21Then;

      if (md.openTime15 !== data.ohlc.open_time) {
        md.openTime15 = data.ohlc.open_time;
        send({
          ticks_history: data.echo_req.ticks_history,
          style: "candles",
          count: 500,
          granularity: data.echo_req.granularity,
          end: "latest",
        });
      }
    }

    if (data.echo_req.granularity === 60) {
      if (md.openTime === 0) {
        md.openTime = data.ohlc.open_time;
      }
      if (positions[symbol]) {
        md.canOpenTrade = false;
      } else {
        md.canOpenTrade = true;
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
      const len = md.close.length;
      const len15 = md.close15.length;
      const currIndex = len - 1;
      const prevIndex = len - 2;

      const ema14 = calculateEMA(md.close, 14);
      const ema14Then = ema14[prevIndex];

      const ema21 = calculateEMA(md.close, 21);
      const ema21Then = ema21[prevIndex];

      md.trendUp = ema14Then > ema21Then;
      md.trendDown = ema14Then < ema21Then;
      if (md.canAlert) {
        if (
          md.trendUp15 &&
          md.trendUp &&
          crossedEma(md.high, md.low, currIndex, ema21[currIndex]) &&
          recentEmaCross(ema14, ema21, 15) === "bullish"
        ) {
          sendMessage(`Bullish Signal on ${symbol}`);
          md.canAlert = false;
        }
        if (
          md.trendDown15 &&
          md.trendDown &&
          crossedEma(md.high, md.low, currIndex, ema21[currIndex]) &&
          recentEmaCross(ema14, ema21, 15) === "bearish"
        ) {
          sendMessage(`Bearish Signal on ${symbol}`);
          md.canAlert = false;
        }
      }

      if (md.openTime !== data.ohlc.open_time) {
        md.openTime = data.ohlc.open_time;

        if (md.canOpenTrade) {
          if (
            md.trendUp15 &&
            ((bearish(md.open15, md.close15, len15 - 4) &&
              bearish(md.open15, md.close15, len15 - 3) &&
              bullish(md.open15, md.close15, len15 - 2)) ||
              (bearish(md.open15, md.close15, len15 - 5) &&
                bearish(md.open15, md.close15, len15 - 4) &&
                bullish(md.open15, md.close15, len15 - 3) &&
                bullish(md.open15, md.close15, len15 - 2)) ||
              (bearish(md.open15, md.close15, len15 - 6) &&
                bearish(md.open15, md.close15, len15 - 5) &&
                bullish(md.open15, md.close15, len15 - 4) &&
                bearish(md.open15, md.close15, len15 - 3) &&
                bullish(md.open15, md.close15, len15 - 2)))
          ) {
            if (
              md.trendUp &&
              bullish(md.open, md.close, prevIndex) &&
              crossedEma(md.high, md.low, prevIndex, ema21[prevIndex])
            ) {
              buyMultiplier(
                "MULTUP",
                data?.echo_req?.ticks_history,
                amount,
                md.multiplier_range[0],
              );
              md.canOpenTrade = false;
              send({ portfolio: 1 });
            }
          }
          if (
            md.trendDown15 &&
            ((bullish(md.open15, md.close15, len15 - 4) &&
              bullish(md.open15, md.close15, len15 - 3) &&
              bearish(md.open15, md.close15, len15 - 2)) ||
              (bullish(md.open15, md.close15, len15 - 5) &&
                bullish(md.open15, md.close15, len15 - 4) &&
                bearish(md.open15, md.close15, len15 - 3) &&
                bearish(md.open15, md.close15, len15 - 2)) ||
              (bullish(md.open15, md.close15, len15 - 6) &&
                bullish(md.open15, md.close15, len15 - 5) &&
                bearish(md.open15, md.close15, len15 - 4) &&
                bullish(md.open15, md.close15, len15 - 3) &&
                bearish(md.open15, md.close15, len15 - 2)))
          ) {
            if (
              md.trendDown &&
              bearish(md.open, md.close, prevIndex) &&
              crossedEma(md.high, md.low, prevIndex, ema21[prevIndex])
            ) {
              buyMultiplier(
                "MULTDOWN",
                data?.echo_req?.ticks_history,
                amount,
                md.multiplier_range[0],
              );
              md.canOpenTrade = false;
              send({ portfolio: 1 });
            }
          }
        } else {
          if (position?.type === "MULTUP") {
            if (md.trendDown15) {
              closePosition(symbol, position.contractId, `Opposite Signal`);
            }
          }
          if (position?.type === "MULTDOWN") {
            if (md.trendUp15) {
              closePosition(symbol, position.contractId, `Opposite Signal`);
            }
          }
        }
        md.canAlert = true;
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

  if (data.msg_type === "proposal_open_contract") {
    const symbol = data.proposal_open_contract?.underlying;
    let position = positions[symbol];
    const md = marketData?.[symbol];
    md.canOpenTrade = false;
    position.subscribed = true;
    const commission = data.proposal_open_contract?.commission;
    const multiplier = data.proposal_open_contract?.multiplier;
    const type = data.proposal_open_contract?.contract_type;
    const entrySpot = data.proposal_open_contract?.entry_spot;
    const currentSpot = data.proposal_open_contract?.current_spot;
    const orderAmount =
      data.proposal_open_contract?.limit_order?.stop_out?.order_amount;
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
    const loss = type === "MULTUP" ? entrySpot - stopOut : stopOut - entrySpot;
    const risk = type === "MULTUP" ? entrySpot - stop : stop - entrySpot;
    const gain =
      type === "MULTUP" ? takeProfit - entrySpot : entrySpot - takeProfit;
    const profit = data.proposal_open_contract?.profit;

    if (connection) {
      if (profit >= profitAmount / 8 && position.stoploss === 0) {
        position.stoploss = Math.abs(commission);
        update(position.stoploss, symbol);
      }
      if (
        profit >= profitAmount / 4 &&
        position.stoploss === Math.abs(commission)
      ) {
        position.stoploss = profitAmount / 8;
        update(position.stoploss, symbol);
      }
      if (
        profit >= profitAmount / 2 &&
        position.stoploss === profitAmount / 8
      ) {
        position.stoploss = profitAmount / 4;
        update(position.stoploss, symbol);
      }
      if (position.stoploss !== 0 && profit <= position.stoploss) {
        closePosition(symbol, position.contractId, `Stop Loss Hit`);
        position.stoploss = 0;
        update(position.stoploss, symbol);
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
      stopLoss: position.stoploss,
      symbol: symbol,
      type: type,
    };
    const duration =
      data?.proposal_open_contract?.current_spot_time -
      data?.proposal_open_contract?.date_start;
    if (duration === 2) {
      sendMessage(JSON.stringify(runningTrade, null, 2));
    }
    console.log(runningTrade);
  }

  if (data.msg_type === "buy") {
    const symbol = data.echo_req.parameters.symbol;

    if (!positions[symbol]) {
      positions[symbol] = {};
    }

    const position = positions[symbol];

    position.type = data.echo_req.parameters.contract_type;
    position.contractId = data.buy.contract_id;

    sendMessage(`${positions[symbol].type} position entered on ${symbol}`);

    console.log(
      `🟢 Entered ${positions[symbol].type} position on ${symbol}, Contract ID: ${positions[symbol].contractId}`,
    );
  }

  if (data.msg_type === "sell") {
    const contractId = data.echo_req.sell;

    const symbol = Object.keys(positions).find(
      (s) => positions[s]?.contractId === contractId,
    );

    sendMessage(
      `💸 Position closed at ${data.sell?.sold_for} USD on ${symbol}, because ${positions[symbol]?.reason}`,
    );
    console.log(
      `💸 Position closed at ${data.sell?.sold_for} USD on ${symbol}, because ${positions[symbol]?.reason}`,
    );

    if (symbol) {
      positions[symbol].type = null;
      positions[symbol].contractId = null;
      positions[symbol].stoploss = 0;
    }

    update(0, symbol);
  }

  if (data.error) {
    const error = data?.error?.message;
    console.error("❗ Error: ", error);
    sendMessage(`❗ Error: ${error}`);
    for (const symbol in positions) {
      if (positions[symbol]?.contractId === "PENDING") {
        positions[symbol].contractId = null;
      }
    }
    if (error === "You have reached the rate limit for ticks_history.") {
      await run(30000);
      symbols.forEach((s) => {
        send({ contracts_for: s });
        send({
          ticks_history: s,
          style: "candles",
          count: 500,
          granularity: 60,
          end: "latest",
          subscribe: 1,
        });
        send({
          ticks_history: s,
          style: "candles",
          count: 500,
          granularity: 900,
          end: "latest",
          subscribe: 1,
        });
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
  fetch(
    "https://api.render.com/deploy/srv-d08lfobuibrs73b4vg9g?key=rpjXNGs05-o",
  ).then((res) => sendMessage(`Login Reinitiated`));
});
