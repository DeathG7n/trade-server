const express = require('express')
const pm2 = require('pm2');
const axios = require('axios');
const app = express()
const WebSocket = require('ws');
const DerivAPIBasic = require('@deriv/deriv-api/dist/DerivAPIBasic');
const connection = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=36807');
const api = new DerivAPIBasic({ connection })
let count = 0
let previousCandles = [0,0,0,0]

const BOT_TOKEN = '8033524186:AAFp1cMBr1oRVUgCa2vwKPgroSw_i6M-qEQ';
const CHAT_ID = '8068534792';

app.listen(3000,()=>{
  setInterval(()=>{
    assets.forEach((asset)=>{ 
      getSignal(asset) 
    })
  },2000)
  console.log("Server is running")
})

const assets = [
  {
    name: "Volatility 75 Index",
    symbol: "R_75",
    count: 0
  },
  {
    name: "Volatility 150(1s) Index",
    symbol: "1HZ150V",
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
    const period1 = getTicksRequest(asset?.symbol, 10000000000000000000 , getTimeFrame(1, "mins"))
    const period15 = getTicksRequest(asset?.symbol, 10000000000000000000 , getTimeFrame(15, "mins"))

    const candles1 = await api.ticksHistory(period1);
    const candles15 = await api.ticksHistory(period15);

    const closePrices1 = candles1?.candles?.map(i => {return i?.close})
    const openPrices1 = candles1?.candles?.map(i => {return i?.open})
    const closePrices15 = candles15?.candles?.map(i => {return i?.close})
    const openPrices15 = candles15?.candles?.map(i => {return i?.open})

    const len = closePrices1?.length;
    const currIndex = len - 1;
    const prevIndex = len - 2;
    const secondIndex = len - 3
    const thirdIndex = len - 4

    const ema14 = calculateEMA(closePrices1, 14);
    const ema21 = calculateEMA(closePrices1, 21);
    const ema14_15 = calculateEMA(closePrices15, 14);
    const ema21_15 = calculateEMA(closePrices15, 21);

    const ema14Now = ema14[currIndex];
    const ema21Now = ema21[currIndex];
    const ema14_15Now = ema14_15[currIndex];
    const ema21_15Now = ema21_15[currIndex];

    const upTrend = ema14Now > ema21Now
    const downTrend = ema14Now < ema21Now
    const upTrend15 = ema14_15Now > ema21_15Now
    const downTrend15 = ema14_15Now < ema21_15Now

    const higherBullSignal = upTrend15 && bearish15(secondIndex) && bullish15(prevIndex)
    const higherBearSignal = downTrend15 && bullish15(secondIndex) && bearish15(prevIndex)
    const lowerBullSignal = upTrend && (bearish1(secondIndex) && bullish1(prevIndex) || bearish1(thirdIndex) && bullish1(secondIndex) && bullish1(prevIndexIndex))
    const lowerBearSignal = downTrend && (bullish1(secondIndex) && bearish1(prevIndex) || bullish1(thirdIndex) && bearish1(secondIndex) && bearish1(prevIndex))

    const buySignal = higherBullSignal && lowerBullSignal
    const sellSignal = higherBearSignal && lowerBearSignal

    function bearish1(candle){
      return openPrices1[candle] > closePrices1[candle]
    }
    function bullish1(candle){
      return closePrices1[candle] > openPrices1[candle]
    }

    function bearish15(candle){
      return openPrices15[candle] > closePrices15[candle]
    }
    function bullish15(candle){
      return closePrices15[candle] > openPrices15[candle]
    }

    if(previousCandles[asset?.count] !== closePrices1[prevIndex]){
      previousCandles[asset?.count] = closePrices1[19]
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
    pm2.connect(function (err) {
      if (err) {
        console.error(err);
        process.exit(2);
      }
    
      pm2.restart(0, function (err) {
        pm2.disconnect(); // Disconnect from PM2
          if (err) {
            console.error('Restart failed:', err);
            return;
          }
          console.log('Restarted successfully!');
      });
    }); 
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