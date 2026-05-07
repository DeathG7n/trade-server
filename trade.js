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

let positions = {};
let count = 0;
let reason = "";
let previousCandle = 0;
let amount = null;
let stopLoss = 0;
let now = new Date();

const symbols = [
  "stpRNG",
  "stpRNG2",
  "stpRNG3",
  "stpRNG4",
  "stpRNG5",
  "JD10",
  "JD100",
  "JD50",
  "JD75",
];
let marketData = {};
symbols.forEach((s) => {
  marketData[s] = {
    close: [],
    high: [],
    low: [],
    open: [],
    close15: [],
    open15: [],
    close60: [],
    openTime: 0,
    openTime15: 0,
    openTime60: 0,
    trendUp15: false,
    trendDown15: false,
    trendUp60: false,
    trendDown60: false,
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
function canOpenTrade(symbol) {
  return !positions[symbol]?.contractId;
}
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
      //limit_order: { stop_loss: stake / 5, take_profit: stake / 5 },
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
    stopLoss = result.stoploss;
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
    symbols.forEach((s) => {
      send({ contracts_for: s });
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
    const activeSymbols = new Set();

    for (const contract of data?.portfolio?.contracts) {
      activeSymbols.add(contract.symbol);

      if (!positions[contract.symbol]) {
        positions[contract.symbol] = {};
      }

      positions[contract.symbol] = {
        contractId: contract.contract_id,
        type: contract.contract_type,
        stopLoss,
        reason,
        amount,
        subscribed: false,
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

    // Remove closed positions
    for (const symbol in positions) {
      if (!activeSymbols.has(symbol)) {
        delete positions[symbol];
      }
    }

    // Reset stop loss if no open trades
    if (activeSymbols.size === 0 && stopLoss !== 0) {
      update(0);
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
    } catch (err) {
      sendMessage(err);
    }
    count += 1;
    console.log(count);
  }

  if (data.msg_type === "ohlc") {
    const symbol = data.echo_req.ticks_history;
    const md = marketData[symbol];
    if (!positions[symbol]) {
      positions[symbol] = {
        contractId: null,
        type: null,
      };
    }
    let position = positions[symbol];

    if (data.echo_req.granularity === 900) {
      if(md.openTime15 === 0){
        md.openTime15 = data.ohlc.open_time;
      }
      // if (md.close15.length === 0) {
      //   md.close15.push(Number(data.ohlc.close));
      // } else {
      //   md.close15[md.close15.length - 1] = Number(data.ohlc.close);
      // }

      if (md.openTime15 !== data.ohlc.open_time) {
        console.log(marketData["stpRNG3"]) 
        const len = md.close15.length;
        const currIndex = len - 1;

        const ema5 = calculateEMA(md.close15, 5); 
        const ema5Now = ema5[currIndex];

        const ema9 = calculateEMA(md.close15, 9);
        const ema9Now = ema9[currIndex];

        const crossover = detectCrossover(ema5, ema9);

        md.trendUp15 = ema5Now > ema9Now;
        md.trendDown15 = ema9Now > ema5Now;
        md.openTime15 = data.ohlc.open_time;
        if (canOpenTrade(symbol)) {
          // ✅ Bullish crossover → Buy UP
          if (crossover === "bullish") {
            position.contractId = "PENDING";
            buyMultiplier(
              "MULTUP",
              data?.echo_req?.ticks_history,
              amount,
              md.multiplier_range[0],
            );
            setTimeout(() => {
              if (positions[symbol]?.contractId === "PENDING") {
                positions[symbol].contractId = null;
                console.log(`Reset stale pending trade for ${symbol}`);
              }
            }, 15000);
          }

          // ✅ Bearish crossover → Buy DOWN
          if (crossover === "bearish") {
            position.contractId = "PENDING";
            buyMultiplier(
              "MULTDOWN",
              data?.echo_req?.ticks_history,
              amount,
              md.multiplier_range[0],
            );
            setTimeout(() => {
              if (positions[symbol]?.contractId === "PENDING") {
                positions[symbol].contractId = null;
                console.log(`Reset stale pending trade for ${symbol}`);
              }
            }, 15000);
          }
        } else {
          if (position.type === "MULTUP") {
            if (crossover === "bearish") {
              closePosition(position.contractId, `Opposite Signal`);
            }
          }
          if (position.type === "MULTDOWN") {
            if (crossover === "bullish") {
              closePosition(position.contractId, `Opposite Signal`);
            }
          }
        }
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
    if (!positions[symbol]) {
      positions[symbol] = {};
    }
    let position = positions[symbol];
    position.subscribed = true;
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
    // if(profit > Math.abs(lossAmount) && stopLoss === 0){
    //   update(risk/ 4)
    // }
    // if (pip >= 2 && stopLoss === 0) {
    //   update(0.5);
    // }
    // if (pip >= 4 && stopLoss === 0) {
    //   update(1);
    // }
    // if (stopLoss !== 0 && pip < stopLoss) {
    //   closePosition(openContractId, `Stop Loss Hit`);
    // }
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
      stopLoss: stopLoss,
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
    positions[symbol].type = data.echo_req.parameters.contract_type;

    positions[symbol].contractId = data.buy.contract_id;
    sendMessage(`${positions[symbol].type} position entered on ${symbol}`);

    console.log(
      `🟢 Entered ${positions[symbol].type} position on ${symbol}, Contract ID: ${positions[symbol].contractId}`,
    );
  }

  if (data.msg_type === "sell") {
    sendMessage(
      `💸 Position closed at ${data.sell?.sold_for} USD, because ${reason}`,
    );
    console.log(
      `💸 Position closed at ${data.sell?.sold_for} USD, because ${reason}`,
    );
    const contractId = data.echo_req.sell;

    const symbol = Object.keys(positions).find(
      (s) => positions[s]?.contractId === contractId,
    );
    if (symbol) {
      positions[symbol].type = null;
      positions[symbol].contractId = null;
    }
    update(0);
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
