const express = require('express')
const axios = require('axios');
const app = express()
const WebSocket = require('ws');
const DerivAPIBasic = require('@deriv/deriv-api/dist/DerivAPIBasic');
const connection = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=36807');
const api = new DerivAPIBasic({ connection })
let count = 0
let previousCandles = [0,0,0,0]
let currentCandles = [0,0,0,0]

const BOT_TOKEN = '8033524186:AAFp1cMBr1oRVUgCa2vwKPgroSw_i6M-qEQ';
const CHAT_ID = '8068534792';

app.get("/", async(req, res)=>{
  assets.forEach((asset)=>{ 
    getSignal(asset) 
  })
  res.json(currentCandles)
})

app.listen(3000,()=>{
  console.log("Server is running") 
  setInterval(()=>{
    assets.forEach((asset)=>{ 
      getSignal(asset) 
    })
  }, 10000) 
})

const assets = [
  {
    name: "Volatility 150(1s) Index",
    symbol: "1HZ150V",
    count: 0
  },
  {
    name: "Volatility 75 Index",
    symbol: "R_75",
    count: 1
  },
  {
    name: "Jump 10 Index",
    symbol: "JD10",
    count: 2
  },
  {
    name: "Jump 100 Index",
    symbol: "JD100",
    count: 3
  }
]

const sendMessage = async (message) => {
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    await axios.post(url, {
      chat_id: CHAT_ID,
      text: message,
    });
    console.log('Message sent successfully!');
  } catch (error) {
    console.error('Error sending message:', error.response?.data || error.message);
  }
};

function getTimeFrame(count, time){
    if(time == "mins"){
      return count * 60
    }
    if(time == "hrs"){
      return count * 3600
    }
}
  
function getTicksRequest(symbol, count, timeframe){
    const ticks_history_request = {
      ticks_history: symbol,
      count: count,
      end: 'latest',
      style: 'candles',
      granularity: timeframe,
    };
    return ticks_history_request
}

const getSignal = async (asset) => {
  try{
    const period5 = getTicksRequest(asset?.symbol, 10000000000000000000 , getTimeFrame(5, "mins"))
    const period60 = getTicksRequest(asset?.symbol, 10000000000000000000 , getTimeFrame(1, "hrs"))

    const candles5 = await api.ticksHistory(period5);
    const candles60 = await api.ticksHistory(period60);

    const closePrices5 = candles5?.candles?.map(i => {return i?.close})
    const openPrices5 = candles5?.candles?.map(i => {return i?.open})
    const closePrices60 = candles60?.candles?.map(i => {return i?.close})
    const openPrices60 = candles60?.candles?.map(i => {return i?.open})

    const len = closePrices5?.length;
    const currIndex = len - 1;
    const prevIndex = len - 2;
    const secondIndex = len - 3
    const thirdIndex = len - 4

    const ema14 = calculateEMA(closePrices5, 14);
    const ema21 = calculateEMA(closePrices5, 21);
    const ema14_60 = calculateEMA(closePrices60, 14);
    const ema21_60 = calculateEMA(closePrices60, 21);

    const ema14Now = ema14[currIndex];
    const ema21Now = ema21[currIndex];
    const ema14_60Now = ema14_60[currIndex];
    const ema21_60Now = ema21_60[currIndex];

    const upTrend = ema14Now > ema21Now
    const downTrend = ema14Now < ema21Now
    const upTrend15 = ema14_60Now > ema21_60Now
    const downTrend15 = ema14_60Now < ema21_60Now

    const higherBullSignal = upTrend15 && bearish60(secondIndex) && bullish60(prevIndex)
    const higherBearSignal = downTrend15 && bullish60(secondIndex) && bearish60(prevIndex)
    const lowerBullSignal = upTrend && (bearish5(secondIndex) && bullish5(prevIndex) || bearish5(thirdIndex) && bullish5(secondIndex) && bullish5(prevIndexIndex))
    const lowerBearSignal = downTrend && (bullish5(secondIndex) && bearish5(prevIndex) || bullish5(thirdIndex) && bearish5(secondIndex) && bearish5(prevIndex))

    const buySignal = higherBullSignal && lowerBullSignal
    const sellSignal = higherBearSignal && lowerBearSignal

    function bearish5(candle){
      return openPrices5[candle] > closePrices5[candle]
    }
    function bullish5(candle){
      return closePrices5[candle] > openPrices5[candle]
    }

    function bearish60(candle){
      return openPrices60[candle] > closePrices60[candle]
    }
    function bullish60(candle){
      return closePrices60[candle] > openPrices60[candle]
    }
    currentCandles[asset.count] = closePrices5[currIndex]

    if(previousCandles[asset.count] !== closePrices5[prevIndex]){
      previousCandles[asset.count] = closePrices5[prevIndex]
      if(buySignal){
        sendMessage(`${asset?.name} is bullish`)
        console.log(`${asset?.name} is bullish`)
      }

      if(sellSignal){
        sendMessage(`${asset?.name} is bearish`)
        console.log(`${asset?.name} is bearish`)
      }

    }
    
    count += 1
    console.log(count)

  } catch (error){
    console.log(error?.error?.message)
  }
};


function calculateEMA(prices, period) {
    const k = 2 / (period + 1);
    let emaArray = [];

    emaArray[0] = prices?.[0];

    for (let i = 1; i < prices?.length; i++) {
      emaArray[i] = (prices[i] * k) + (emaArray[i - 1] * (1 - k));
    }

    return emaArray;
}