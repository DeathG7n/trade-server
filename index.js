const express = require('express')
const app = express()
const cors = require('cors')
const WebSocket = require('ws');
const DerivAPIBasic = require('@deriv/deriv-api/dist/DerivAPIBasic');
const connection = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=36807');
const ta = require('ta.js')
const api = new DerivAPIBasic({ connection })
let data = null
let count = 0

app.use(cors())

app.get("/",(req, res)=>{
  assets.forEach((asset)=>{ 
    getSignal(asset) 
  })
  res.json(data)
  data = null
})

app.listen(3000,()=>{
  console.log("Server is running")
})

const assets = [
  {
    name: "Volatility 75 Index",
    symbol: "R_75"
  }
]


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
    const period = getTicksRequest(asset?.symbol, 21 , getTimeFrame(1, "mins"))

    const candles = await api.ticksHistory(period);

    const closePrices = candles?.candles?.map(i => {return i?.close})
    const openPrices = candles?.candles?.map(i => {return i?.open})

    const current14 = closePrices.slice(-14)
    const current21 = closePrices

    const current14ema = ta.ema(current14, current14.length)
    const current21ema = ta.ema(current21, current21.length)

    function bearish(candle){
      return openPrices[candle] > closePrices[candle]
    }
    function bullish(candle){
      return closePrices[candle] > openPrices[candle]
    }


    if(current14ema > current21ema){
      if(bearish(19) && bullish(20)){
        data = `Bullish Signal Detected on ${asset?.name}`
        console.log(`${asset?.name} is bullish`)
      }
      if(bearish(18) && bullish(19) && bullish(20)){
        data = `Bullish Signal Detected on ${asset?.name}`
        console.log(`${asset?.name} is bullish`)
      }
    }

    if(current14ema < current21ema){
      if(bullish(19) && bearish(20)){
        data = `Bearish Signal Detected on ${asset?.name}`
        console.log(`${asset?.name} is bearish`)
      }
      if(bullish(18) && bearish(19) && bearish(20)){
        data = `Bearish Signal Detected on ${asset?.name}`
        console.log(`${asset?.name} is bearish`)
      }
    }

    count += 1
    console.log(data, count)
    console.log(current14, current21)

  } catch (error){
    data = error?.error?.message
    console.log(error?.error?.message) 
  }
};


