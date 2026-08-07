import WebSocket from "ws";
import express from "express";
import cors from "cors";
import axios from "axios";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import { wsUrl } from "./server.js";

import { bullish, bearish, crossedPrice } from "./util.js";

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
let portfolioSynced = false;
let lastBalance = null;

const timeframes = [60, 900];

/*
|--------------------------------------------------------------------------
| CONTRACT SUBSCRIPTIONS
|--------------------------------------------------------------------------
*/

const subscribedContracts = new Set();

/*
|--------------------------------------------------------------------------
| CONTRACT STATE
|--------------------------------------------------------------------------
|
| IMPORTANT:
|
| Do NOT use marketData[symbol].tradeState for an existing contract.
|
| Every contract gets its own state here.
|
| IDLE
| PROPOSAL_PENDING
| BUY_PENDING
| OPEN
| CLOSING
|
*/

const contractStates = new Map();

/*
|--------------------------------------------------------------------------
| PENDING TRADE STATE
|--------------------------------------------------------------------------
|
| This is per SYMBOL.
|
| Example:
|
| stpRNG -> PROPOSAL_PENDING
|
| This prevents the same symbol from requesting multiple proposals
| while waiting for a response.
|
*/

const pendingTrades = new Map();

/*
|--------------------------------------------------------------------------
| SYMBOLS
|--------------------------------------------------------------------------
*/

const symbols = ["stpRNG", "stpRNG2", "stpRNG3", "stpRNG4", "stpRNG5"];

/*
|--------------------------------------------------------------------------
| SYMBOLS ALLOWED TO TRADE
|--------------------------------------------------------------------------
*/

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
  "JD10",
  "JD25",
  "JD50",
  "JD75",
  "JD100",
];

/*
|--------------------------------------------------------------------------
| MARKET DATA
|--------------------------------------------------------------------------
*/

const marketData = {};

symbols.forEach((symbol) => {
  marketData[symbol] = {
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

    ema_15Then: 0,
    ema_15Now: 0,

    multiplier_range: [],

    canAlert: true,
    canAlert15: true,

    /*
    |--------------------------------------------------------------------------
    | SYMBOL-LEVEL STATE
    |--------------------------------------------------------------------------
    |
    | This is ONLY for pending entry requests.
    |
    */

    tradeState: "IDLE",
    pendingProposalId: null,
  };
});

/*
|--------------------------------------------------------------------------
| EXPRESS
|--------------------------------------------------------------------------
*/

app.use(cors());

app.get("/", (req, res) => {
  res.json("Hi");
});

app.listen(3000, () => {
  console.log("Server is running");
});

/*
|--------------------------------------------------------------------------
| WEBSOCKET SEND
|--------------------------------------------------------------------------
*/

function send(message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/*
|--------------------------------------------------------------------------
| SLEEP
|--------------------------------------------------------------------------
*/

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(ms) {
  await sleep(ms);
}

/*
|--------------------------------------------------------------------------
| EMA
|--------------------------------------------------------------------------
*/

function calculateEMA(prices, period) {
  const k = 2 / (period + 1);

  const emaArray = [];

  if (!prices.length) {
    return emaArray;
  }

  emaArray[0] = prices[0];

  for (let i = 1; i < prices.length; i++) {
    emaArray[i] = prices[i] * k + emaArray[i - 1] * (1 - k);
  }

  return emaArray;
}

/*
|--------------------------------------------------------------------------
| TELEGRAM
|--------------------------------------------------------------------------
*/

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

/*
|--------------------------------------------------------------------------
| CONTRACT STATE HELPERS
|--------------------------------------------------------------------------
*/

function getContractState(contractId) {
  return contractStates.get(contractId);
}

function setContractState(contractId, state, extra = {}) {
  if (!contractId) return;

  const current = contractStates.get(contractId) || {};

  contractStates.set(contractId, {
    ...current,
    state,
    ...extra,
    updatedAt: Date.now(),
  });

  console.log(`🔄 Contract ${contractId} state -> ${state}`);
}

function deleteContractState(contractId) {
  if (!contractId) return;

  contractStates.delete(contractId);
}

/*
|--------------------------------------------------------------------------
| PENDING SYMBOL STATE
|--------------------------------------------------------------------------
*/

function setSymbolPending(symbol, state, proposalId = null) {
  const md = marketData[symbol];

  if (!md) return;

  md.tradeState = state;
  md.pendingProposalId = proposalId;

  pendingTrades.set(symbol, {
    state,
    proposalId,
    updatedAt: Date.now(),
  });

  console.log(`🔄 ${symbol} state -> ${state}`);
}

function clearSymbolPending(symbol) {
  const md = marketData[symbol];

  if (!md) return;

  md.tradeState = "IDLE";
  md.pendingProposalId = null;

  pendingTrades.delete(symbol);

  console.log(`🔄 ${symbol} state -> IDLE`);
}

/*
|--------------------------------------------------------------------------
| PROPOSAL
|--------------------------------------------------------------------------
*/

async function getMultiProposal(direction, symbol, stake, multiplier) {
  const stopLoss = stake / 2.5;
  const takeProfit = stopLoss * 5;

  const request = {
    proposal: 1,
    amount: stake,
    contract_type: direction,
    currency: "USD",
    underlying_symbol: symbol,
    multiplier: multiplier,
    basis: "stake",

    limit_order: {
      stop_loss: stopLoss,
      take_profit: takeProfit,
    },
  };

  send(request);
}

/*
|--------------------------------------------------------------------------
| BUY CONTRACT
|--------------------------------------------------------------------------
*/

function buyContract(direction, id, stake) {
  console.log(`📈 Buying ${direction} contract...`);

  send({
    buy: id,
    price: stake,
  });
}

/*
|--------------------------------------------------------------------------
| CLOSE POSITION
|--------------------------------------------------------------------------
|
| IMPORTANT:
|
| State is changed using CONTRACT ID, not just symbol.
|
*/

function closePosition(symbol, contractId, reason) {
  if (!contractId) return;

  const state = getContractState(contractId);

  /*
  |--------------------------------------------------------------------------
  | Prevent duplicate sells
  |--------------------------------------------------------------------------
  */

  if (state?.state === "CLOSING") {
    console.log(`⏳ Contract ${contractId} is already CLOSING`);

    return;
  }

  /*
  |--------------------------------------------------------------------------
  | Make sure the contract actually exists
  |--------------------------------------------------------------------------
  */

  const position = positions.find((p) => p.contract_id === contractId);

  if (!position) {
    console.log(`⚠️ Cannot close unknown contract ${contractId}`);

    return;
  }

  /*
  |--------------------------------------------------------------------------
  | Set THIS contract to CLOSING
  |--------------------------------------------------------------------------
  */

  setContractState(contractId, "CLOSING", {
    symbol,
    reason,
  });

  position.reason = reason;

  console.log(`❌ Closing position ${contractId} on ${symbol}`);

  send({
    sell: contractId,
    price: 0,
  });

  sendMessage(
    `❌ Closing contract ${contractId} on ${symbol} because ${reason}`,
  );
}

/*
|--------------------------------------------------------------------------
| MONGODB CONNECTION
|--------------------------------------------------------------------------
*/

async function connect() {
  try {
    await client.connect();

    console.log("Connected successfully to MongoDB");

    connection = true;
    authorized = true;
  } catch (error) {
    console.error(error);
  }
}

/*
|--------------------------------------------------------------------------
| UPDATE STOP LOSS
|--------------------------------------------------------------------------
*/

async function update(stop, id, symbol) {
  try {
    if (!symbol || !id) return;

    const database = client.db("trading");
    const collection = database.collection("trade");

    await collection.findOneAndUpdate(
      {
        contract_id: id,
      },
      {
        $set: {
          stoploss: stop,
        },
      },
    );

    send({
      portfolio: 1,
    });
  } catch (error) {
    console.error(error);
  }
}

/*
|--------------------------------------------------------------------------
| LOAD MONGODB
|--------------------------------------------------------------------------
*/

connect();

/*
|--------------------------------------------------------------------------
| WEBSOCKET OPEN
|--------------------------------------------------------------------------
*/

ws.on("open", () => {
  console.log("🔌 Connected");

  const interval = setInterval(() => {
    if (authorized) {
      send({
        authorize: API_TOKEN,
      });

      authorized = false;

      clearInterval(interval);
    }
  }, 1000);
});

/*
|--------------------------------------------------------------------------
| WEBSOCKET MESSAGE
|--------------------------------------------------------------------------
*/

try {
  ws.on("message", async (msg) => {
    const data = JSON.parse(msg);

    /*
    |--------------------------------------------------------------------------
    | AUTHORIZE
    |--------------------------------------------------------------------------
    */

    if (data.msg_type === "authorize") {
      console.log("✅ Authorized");

      send({
        balance: 1,
        subscribe: 1,
      });

      symbols.forEach((symbol) => {
        send({
          contracts_for: symbol,
        });

        timeframes.forEach((timeframe) => {
          send({
            ticks_history: symbol,
            style: "candles",
            count: 500,
            granularity: timeframe,
            end: "latest",
            subscribe: 1,
          });
        });
      });
    }

    /*
    |--------------------------------------------------------------------------
    | BALANCE
    |--------------------------------------------------------------------------
    */

    if (data.msg_type === "balance") {
      balance = data.balance.balance;

      if (balance !== lastBalance) {
        console.log(`💸 Balance is currently ${balance}`);

        lastBalance = balance;
      }

      balance = Math.trunc(balance);

      if (balance < 7) {
        amount = 1;
      } else {
        const forefeit = 2 ** Math.floor(Math.log2(balance / 7) + 1);

        amount = Math.min(1000, forefeit);
      }

      send({
        portfolio: 1,
      });
    }

    /*
    |--------------------------------------------------------------------------
    | PORTFOLIO
    |--------------------------------------------------------------------------
    |
    | THIS IS THE IMPORTANT FIX.
    |
    | We reconcile contracts individually.
    |
    */

    if (data.msg_type === "portfolio") {
      const database = client.db("trading");
      const collection = database.collection("trade");

      const portfolioContracts = data?.portfolio?.contracts || [];

      const activeContractIds = new Set(
        portfolioContracts.map((contract) => contract.contract_id),
      );

      /*
      |--------------------------------------------------------------------------
      | GET CURRENT DATABASE POSITIONS ONCE
      |--------------------------------------------------------------------------
      */

      const assets = await collection.find({}).toArray();

      /*
      |--------------------------------------------------------------------------
      | REMOVE CONTRACTS THAT ARE ACTUALLY CLOSED
      |--------------------------------------------------------------------------
      */

      for (const asset of assets) {
        const contractId = asset.contract_id;

        if (!activeContractIds.has(contractId)) {
          console.log(`🗑️ Contract ${contractId} is no longer in portfolio`);

          /*
          |--------------------------------------------------------------------------
          | Remove from state
          |--------------------------------------------------------------------------
          */

          deleteContractState(contractId);

          subscribedContracts.delete(contractId);

          /*
          |--------------------------------------------------------------------------
          | Remove from memory
          |--------------------------------------------------------------------------
          */

          positions = positions.filter((p) => p.contract_id !== contractId);

          /*
          |--------------------------------------------------------------------------
          | Remove from database
          |--------------------------------------------------------------------------
          */

          await collection.deleteOne({
            contract_id: contractId,
          });
        }
      }

      /*
      |--------------------------------------------------------------------------
      | PROCESS EVERY ACTIVE CONTRACT
      |--------------------------------------------------------------------------
      */

      for (const contract of portfolioContracts) {
        const contractId = contract.contract_id;

        const symbol = contract.underlying_symbol;

        /*
        |--------------------------------------------------------------------------
        | Check existing DB record
        |--------------------------------------------------------------------------
        */

        let position = await collection.findOne({
          contract_id: contractId,
        });

        /*
        |--------------------------------------------------------------------------
        | Create DB record if necessary
        |--------------------------------------------------------------------------
        */

        if (!position) {
          position = {
            name: symbol,
            contract_id: contractId,
            stoploss: 0,
            date_start: contract.date_start,
            type: contract.contract_type,
          };

          await collection.insertOne(position);

          console.log(`📝 Document created for ${contractId}`);
        }

        /*
        |--------------------------------------------------------------------------
        | Update in-memory position
        |--------------------------------------------------------------------------
        */

        const existingIndex = positions.findIndex(
          (p) => p.contract_id === contractId,
        );

        if (existingIndex === -1) {
          positions.push(position);
        }

        /*
        |--------------------------------------------------------------------------
        | INITIALIZE CONTRACT STATE
        |--------------------------------------------------------------------------
        */

        const currentState = getContractState(contractId);

        /*
        |--------------------------------------------------------------------------
        | CRITICAL:
        |
        | Portfolio says this contract exists.
        |
        | Therefore:
        |
        | - If CLOSING -> KEEP CLOSING
        | - Otherwise -> OPEN
        |
        | We NEVER modify another contract's state.
        |--------------------------------------------------------------------------
        */

        if (currentState?.state === "CLOSING") {
          console.log(`⏳ ${contractId} remains CLOSING`);
        } else {
          setContractState(contractId, "OPEN", {
            symbol,
            type: contract.contract_type,
          });
        }

        /*
        |--------------------------------------------------------------------------
        | The symbol may have been waiting for a buy.
        |
        | Once the actual contract exists,
        | clear the symbol's pending state.
        |--------------------------------------------------------------------------
        */

        const md = marketData[symbol];

        if (
          md &&
          (md.tradeState === "PROPOSAL_PENDING" ||
            md.tradeState === "BUY_PENDING")
        ) {
          clearSymbolPending(symbol);
        }

        /*
        |--------------------------------------------------------------------------
        | Subscribe to this contract ONCE
        |--------------------------------------------------------------------------
        */

        if (!subscribedContracts.has(contractId)) {
          console.log(`📡 Subscribing to contract ${contractId}`);

          send({
            proposal_open_contract: 1,
            contract_id: contractId,
            subscribe: 1,
          });

          subscribedContracts.add(contractId);
        }
      }

      /*
      |--------------------------------------------------------------------------
      | PORTFOLIO SYNCHRONIZATION COMPLETE
      |--------------------------------------------------------------------------
      */

      if (!portfolioSynced) {
        portfolioSynced = true;

        console.log("✅ Portfolio synchronized");
      }
    }

    /*
    |--------------------------------------------------------------------------
    | CONTRACTS FOR
    |--------------------------------------------------------------------------
    */

    if (data.msg_type === "contracts_for") {
      const symbol = data.echo_req.contracts_for;

      const md = marketData[symbol];

      if (!md) return;

      for (
        let index = 0;
        index < data?.contracts_for?.available?.length;
        index++
      ) {
        if (
          data?.contracts_for?.available[index]?.contract_category ===
          "multiplier"
        ) {
          md.multiplier_range =
            data?.contracts_for?.available[index]?.multiplier_range;
        }
      }
    }

    /*
    |--------------------------------------------------------------------------
    | HISTORICAL CANDLES
    |--------------------------------------------------------------------------
    */

    if (data.msg_type === "candles") {
      const symbol = data.echo_req.ticks_history;

      const md = marketData[symbol];

      if (!md) return;

      const current = new Date();

      if (now.getHours() !== current.getHours()) {
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
      } catch (error) {
        sendMessage(String(error));
      }

      count++;

      console.log(`Candles loaded: ${count}`);
    }

    /*
    |--------------------------------------------------------------------------
    | OHLC
    |--------------------------------------------------------------------------
    */

    if (data.msg_type === "ohlc" && portfolioSynced) {
      const symbol = data.echo_req.ticks_history;

      const md = marketData[symbol];

      if (!md) return;

      /*
      |--------------------------------------------------------------------------
      | POSITIONS FOR THIS SYMBOL ONLY
      |--------------------------------------------------------------------------
      */

      const matchingPositions = positions.filter((p) => p?.name === symbol);

      const multiplierPositions = matchingPositions.filter(
        (p) => p.type !== "ONETOUCH",
      );

      /*
      |--------------------------------------------------------------------------
      | MULTIPLIER RANGE
      |--------------------------------------------------------------------------
      */

      if (!md.multiplier_range?.length) {
        return;
      }

      /*
      |--------------------------------------------------------------------------
      | 15 MINUTE
      |--------------------------------------------------------------------------
      */

      if (data.echo_req.granularity === 900) {
        if (md.openTime15 === 0) {
          md.openTime15 = data.ohlc.open_time;
        }

        /*
        |--------------------------------------------------------------------------
        | NEW 15M CANDLE
        |--------------------------------------------------------------------------
        */

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

        /*
        |--------------------------------------------------------------------------
        | UPDATE CURRENT CANDLE
        |--------------------------------------------------------------------------
        */

        if (md.close15.length === 0) {
          md.close15.push(Number(data.ohlc.close));

          md.open15.push(Number(data.ohlc.open));

          md.high15.push(Number(data.ohlc.high));

          md.low15.push(Number(data.ohlc.low));
        } else {
          const last = md.close15.length - 1;

          md.close15[last] = Number(data.ohlc.close);

          md.open15[last] = Number(data.ohlc.open);

          md.high15[last] = Number(data.ohlc.high);

          md.low15[last] = Number(data.ohlc.low);
        }

        const len = md.close15.length;

        const prevIndex = len - 2;

        const currIndex = len - 1;

        if (len < 200) {
          return;
        }

        const ema5 = calculateEMA(md.close15, 5);

        const ema9 = calculateEMA(md.close15, 9);

        const ema14 = calculateEMA(md.close15, 14);

        md.ema_15Then = ema9[prevIndex];

        md.ema_15Now = ema9[currIndex];

        md.trendUp15 =
          ema9[prevIndex] > ema14[prevIndex] &&
          ema5[currIndex] > ema5[prevIndex];

        md.trendDown15 =
          ema9[prevIndex] < ema14[prevIndex] &&
          ema5[currIndex] < ema5[prevIndex];
      }

      /*
      |--------------------------------------------------------------------------
      | 1 MINUTE
      |--------------------------------------------------------------------------
      */

      if (data.echo_req.granularity === 60) {
        if (md.openTime === 0) {
          md.openTime = data.ohlc.open_time;
        }

        /*
        |--------------------------------------------------------------------------
        | NEW 1M CANDLE
        |--------------------------------------------------------------------------
        */

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

        /*
        |--------------------------------------------------------------------------
        | UPDATE CURRENT CANDLE
        |--------------------------------------------------------------------------
        */

        if (md.close.length === 0) {
          md.close.push(Number(data.ohlc.close));

          md.open.push(Number(data.ohlc.open));

          md.high.push(Number(data.ohlc.high));

          md.low.push(Number(data.ohlc.low));
        } else {
          const last = md.close.length - 1;

          md.close[last] = Number(data.ohlc.close);

          md.open[last] = Number(data.ohlc.open);

          md.high[last] = Number(data.ohlc.high);

          md.low[last] = Number(data.ohlc.low);
        }

        const len = md.close.length;

        const prevIndex = len - 2;

        if (len < 200) {
          return;
        }

        /*
        |--------------------------------------------------------------------------
        | ENTRY
        |--------------------------------------------------------------------------
        |
        | No open multiplier contract on THIS symbol.
        |
        | Also make sure this symbol is not already
        | waiting for a proposal/buy.
        |--------------------------------------------------------------------------
        */

        const symbolIsPending =
          md.tradeState === "PROPOSAL_PENDING" ||
          md.tradeState === "BUY_PENDING";

        const hasOpenPosition = multiplierPositions.length > 0;

        if (
          !hasOpenPosition &&
          !symbolIsPending &&
          Math.trunc(balance) !== 0 &&
          tradeSymbols.includes(symbol) &&
          md.tradeState === "IDLE"
        ) {
          if (crossedPrice(md.high, md.low, prevIndex, md.ema_15Now)) {
            /*
            |--------------------------------------------------------------------------
            | MULTUP
            |--------------------------------------------------------------------------
            */

            if (
              md.trendUp15 &&
              bullish(md.open, md.close, prevIndex) &&
              md.close[prevIndex] > md.ema_15Now
            ) {
              setSymbolPending(symbol, "PROPOSAL_PENDING");

              try {
                await getMultiProposal(
                  "MULTUP",
                  symbol,
                  amount,
                  md.multiplier_range[0],
                );
              } catch (error) {
                clearSymbolPending(symbol);

                sendMessage(String(error));
              }
            } else if (

            /*
            |--------------------------------------------------------------------------
            | MULTDOWN
            |--------------------------------------------------------------------------
            */
              md.trendDown15 &&
              bearish(md.open, md.close, prevIndex) &&
              md.close[prevIndex] < md.ema_15Now
            ) {
              setSymbolPending(symbol, "PROPOSAL_PENDING");

              try {
                await getMultiProposal(
                  "MULTDOWN",
                  symbol,
                  amount,
                  md.multiplier_range[0],
                );
              } catch (error) {
                clearSymbolPending(symbol);

                sendMessage(String(error));
              }
            }
          }
        }

        /*
        |--------------------------------------------------------------------------
        | OPPOSITE SIGNAL EXIT
        |--------------------------------------------------------------------------
        |
        | IMPORTANT:
        |
        | Each contract is checked individually.
        |
        | Closing contract A does NOT affect
        | contract B.
        |--------------------------------------------------------------------------
        */

        if (multiplierPositions.length > 0) {
          for (const position of multiplierPositions) {
            const contractId = position.contract_id;

            const contractState = getContractState(contractId);

            /*
            |--------------------------------------------------------------------------
            | Never send another sell while CLOSING
            |--------------------------------------------------------------------------
            */

            if (contractState?.state === "CLOSING") {
              continue;
            }

            /*
            |--------------------------------------------------------------------------
            | MULTUP
            |--------------------------------------------------------------------------
            */

            if (position.type === "MULTUP" && md.trendDown15) {
              try {
                closePosition(symbol, contractId, "Opposite Signal");
              } catch (error) {
                sendMessage(String(error));
              }
            } else if (position.type === "MULTDOWN" && md.trendUp15) {

            /*
            |--------------------------------------------------------------------------
            | MULTDOWN
            |--------------------------------------------------------------------------
            */
              try {
                closePosition(symbol, contractId, "Opposite Signal");
              } catch (error) {
                sendMessage(String(error));
              }
            }
          }
        }
      }
    }

    /*
    |--------------------------------------------------------------------------
    | PROPOSAL RESPONSE
    |--------------------------------------------------------------------------
    */

    if (data.msg_type === "proposal") {
      const symbol = data?.echo_req?.underlying_symbol;

      const md = marketData[symbol];

      if (!md) return;

      const proposalId = data?.proposal?.id;

      /*
      |--------------------------------------------------------------------------
      | Validate proposal
      |--------------------------------------------------------------------------
      */

      if (!proposalId) {
        console.log(`⚠️ Proposal response without ID for ${symbol}`);

        clearSymbolPending(symbol);

        return;
      }

      /*
      |--------------------------------------------------------------------------
      | Set symbol to BUY_PENDING
      |--------------------------------------------------------------------------
      */

      setSymbolPending(symbol, "BUY_PENDING", proposalId);

      try {
        buyContract(
          data?.echo_req?.contract_type,
          proposalId,
          data?.proposal?.ask_price,
        );
      } catch (error) {
        clearSymbolPending(symbol);

        sendMessage(String(error));
      }
    }

    /*
    |--------------------------------------------------------------------------
    | PROPOSAL OPEN CONTRACT
    |--------------------------------------------------------------------------
    */

    if (data.msg_type === "proposal_open_contract") {
      const id = data?.echo_req?.contract_id;

      const contract = data?.proposal_open_contract;

      if (!contract) return;

      const position = positions.find((p) => p.contract_id === id);

      const symbol = contract?.underlying_symbol;

      const commission = contract?.commission;

      const multiplier = contract?.multiplier;

      const type = contract?.contract_type;

      const entrySpot = Number(contract?.entry_spot);

      const currentSpot = Number(contract?.current_spot);

      const orderAmount = contract?.buy_price;

      const lossAmount = contract?.limit_order?.stop_loss?.order_amount;

      const profitAmount = contract?.limit_order?.take_profit?.order_amount;

      const stopOut = Number(contract?.limit_order?.stop_out?.value);

      const stop = Number(contract?.limit_order?.stop_loss?.value);

      const takeProfit = Number(contract?.limit_order?.take_profit?.value);

      const pip =
        type === "MULTUP" ? currentSpot - entrySpot : entrySpot - currentSpot;

      const loss =
        type === "MULTUP" ? entrySpot - stopOut : stopOut - entrySpot;

      const risk = type === "MULTUP" ? entrySpot - stop : stop - entrySpot;

      const gain =
        type === "MULTUP" ? takeProfit - entrySpot : entrySpot - takeProfit;

      const profit = Number(contract?.profit);

      const duration = contract?.current_spot_time - contract?.date_start;

      /*
      |--------------------------------------------------------------------------
      | CONTRACT STATE
      |--------------------------------------------------------------------------
      */

      const state = getContractState(id);

      /*
      |--------------------------------------------------------------------------
      | If we don't know this contract yet,
      | initialize it as OPEN.
      |--------------------------------------------------------------------------
      */

      if (!state) {
        setContractState(id, "OPEN", {
          symbol,
          type,
        });
      }

      /*
      |--------------------------------------------------------------------------
      | UPDATE POSITION
      |--------------------------------------------------------------------------
      */

      if (position) {
        position.subscribed = true;

        position.profit = profit;
      }

      /*
      |--------------------------------------------------------------------------
      | TRAILING STOP
      |--------------------------------------------------------------------------
      */

      if (connection && type !== "ONETOUCH") {
        if (!position) {
          return;
        }

        if (lossAmount == null) {
          return;
        }

        /*
        |--------------------------------------------------------------------------
        | If contract is closing,
        | don't perform another stop update.
        |--------------------------------------------------------------------------
        */

        const currentContractState = getContractState(id);

        if (currentContractState?.state === "CLOSING") {
          return;
        }

        /*
        |--------------------------------------------------------------------------
        | FIRST TRAIL
        |--------------------------------------------------------------------------
        */

        if (pip >= risk && position.stoploss === 0) {
          position.stoploss = Math.abs(commission);

          await update(position.stoploss, id, symbol);
        }

        /*
        |--------------------------------------------------------------------------
        | SECOND TRAIL
        |--------------------------------------------------------------------------
        */

        if (pip >= risk * 2 && position.stoploss === Math.abs(commission)) {
          position.stoploss = Math.abs(lossAmount);

          await update(position.stoploss, id, symbol);
        }

        /*
        |--------------------------------------------------------------------------
        | THIRD TRAIL
        |--------------------------------------------------------------------------
        */

        if (pip >= risk * 2.5 && position.stoploss === Math.abs(lossAmount)) {
          position.stoploss = Math.abs(lossAmount * 1.25);

          await update(position.stoploss, id, symbol);
        }

        /*
        |--------------------------------------------------------------------------
        | FOURTH TRAIL
        |--------------------------------------------------------------------------
        */

        if (
          pip >= risk * 4 &&
          position.stoploss === Math.abs(lossAmount * 1.25)
        ) {
          position.stoploss = Math.abs(lossAmount * 2);

          await update(position.stoploss, id, symbol);
        }

        /*
        |--------------------------------------------------------------------------
        | BOT-MANAGED STOP LOSS
        |--------------------------------------------------------------------------
        */

        if (position.stoploss !== 0 && profit <= position.stoploss) {
          closePosition(symbol, id, "Stop Loss Hit");
        }
      }

      /*
      |--------------------------------------------------------------------------
      | RUNNING TRADE DATA
      |--------------------------------------------------------------------------
      */

      const runningTrade = {
        contractId: id,
        multiplier,
        pip,
        profit,
        loss,
        orderAmount,
        stopOutAmount: stopOut,
        lossAmount,
        profitAmount,
        gain,
        risk,
        stopLoss: position?.stoploss,
        symbol,
        type,
        state: getContractState(id)?.state,
      };

      if (duration <= 2) {
        sendMessage(JSON.stringify(runningTrade, null, 2));
      }

      console.log(runningTrade);
    }

    /*
    |--------------------------------------------------------------------------
    | BUY RESPONSE
    |--------------------------------------------------------------------------
    */

    if (data.msg_type === "buy") {
      const contractId = data?.buy?.contract_id;

      console.log(`🟢 Bought contract ${contractId}`);

      /*
      |--------------------------------------------------------------------------
      | Do NOT immediately mark it OPEN here.
      |
      | Portfolio will confirm that the contract
      | actually exists.
      |--------------------------------------------------------------------------
      */

      if (contractId) {
        setContractState(contractId, "BUY_PENDING");
      }
    }

    /*
    |--------------------------------------------------------------------------
    | SELL RESPONSE
    |--------------------------------------------------------------------------
    */

    if (data.msg_type === "sell") {
      const database = client.db("trading");

      const collection = database.collection("trade");

      const contractId = data.sell?.contract_id || data.echo_req?.sell;

      if (!contractId) {
        return;
      }

      const position = positions.find((p) => p.contract_id === contractId);

      if (!position) {
        console.log(`⚠️ Sell response for unknown contract ${contractId}`);

        subscribedContracts.delete(contractId);

        deleteContractState(contractId);

        return;
      }

      const symbol = position.name;

      console.log(
        `💸 Position closed at ${data.sell?.sold_for} USD on ${symbol}`,
      );

      /*
      |--------------------------------------------------------------------------
      | REMOVE CONTRACT STATE
      |--------------------------------------------------------------------------
      */

      deleteContractState(contractId);

      /*
      |--------------------------------------------------------------------------
      | REMOVE SUBSCRIPTION
      |--------------------------------------------------------------------------
      */

      subscribedContracts.delete(contractId);

      /*
      |--------------------------------------------------------------------------
      | REMOVE MEMORY POSITION
      |--------------------------------------------------------------------------
      */

      positions = positions.filter((p) => p.contract_id !== contractId);

      /*
      |--------------------------------------------------------------------------
      | REMOVE DATABASE POSITION
      |--------------------------------------------------------------------------
      */

      await collection.deleteOne({
        contract_id: contractId,
      });

      console.log(`🗑️ Deleted closed contract ${contractId}`);
    }

    /*
    |--------------------------------------------------------------------------
    | CONTRACT UPDATE
    |--------------------------------------------------------------------------
    */

    if (data.msg_type === "contract_update") {
      const contractId = data.echo_req?.contract_id;

      const position = positions.find((p) => p.contract_id === contractId);

      if (position) {
        sendMessage(`💸 Position updated on ${position.name}`);
      }
    }

    /*
    |--------------------------------------------------------------------------
    | ERRORS
    |--------------------------------------------------------------------------
    */

    if (data.error) {
      const error = data.error.message;

      const echoReq = data.echo_req;

      console.error("❗ Error:", error);

      /*
      |--------------------------------------------------------------------------
      | SELL ERROR
      |--------------------------------------------------------------------------
      |
      | ONLY reset the contract that failed.
      |--------------------------------------------------------------------------
      */

      if (echoReq?.sell) {
        const contractId = echoReq.sell;

        const position = positions.find((p) => p.contract_id === contractId);

        if (position) {
          const state = getContractState(contractId);

          if (state?.state === "CLOSING") {
            setContractState(contractId, "OPEN", {
              symbol: position.name,
              type: position.type,
            });

            console.log(
              `⚠️ Sell failed for ${contractId}; state restored to OPEN`,
            );
          }
        }
      }

      /*
      |--------------------------------------------------------------------------
      | PROPOSAL / BUY ERROR
      |--------------------------------------------------------------------------
      |
      | Only reset the affected SYMBOL.
      |--------------------------------------------------------------------------
      */

      if (echoReq?.underlying_symbol) {
        const symbol = echoReq.underlying_symbol;

        const md = marketData[symbol];

        if (
          md &&
          (md.tradeState === "PROPOSAL_PENDING" ||
            md.tradeState === "BUY_PENDING")
        ) {
          clearSymbolPending(symbol);

          console.log(`⚠️ Entry failed for ${symbol}; state restored to IDLE`);
        }
      }

      sendMessage(`❗ Error: ${error}`);

      /*
      |--------------------------------------------------------------------------
      | RATE LIMIT
      |--------------------------------------------------------------------------
      */

      if (error === "You have reached the rate limit for ticks_history.") {
        await run(30000);

        symbols.forEach((symbol) => {
          send({
            contracts_for: symbol,
          });

          timeframes.forEach((timeframe) => {
            send({
              ticks_history: symbol,

              style: "candles",

              count: 500,

              granularity: timeframe,

              end: "latest",

              subscribe: 1,
            });
          });
        });

        sendMessage("Candles Resubscribed");
      }

      /*
      |--------------------------------------------------------------------------
      | LOGIN ERROR
      |--------------------------------------------------------------------------
      */

      if (error === "Please log in.") {
        fetch(DEPLOY_HOOK).then(() => sendMessage("Login Reinitiated"));
      }
    }
  });
} catch (error) {
  sendMessage(String(error));
}

/*
|--------------------------------------------------------------------------
| WEBSOCKET CLOSE
|--------------------------------------------------------------------------
*/

ws.on("close", () => {
  sendMessage("WebSocket disconnected. Reconnecting...");

  fetch(DEPLOY_HOOK).then(() => sendMessage("Login Reinitiated"));
});
