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
    name: "Volatility 150(1s) Index",
    symbol: "1HZ150V"
  },
  {
    name: "Volatility 75 Index",
    symbol: "R_75"
  },
  {
    name: "Jump 100 Index",
    symbol: "JD100"
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
    const periodM15 = getTicksRequest(asset?.symbol, 21 , getTimeFrame(15, "mins"))
    const periodH1 = getTicksRequest(asset?.symbol, 21 , getTimeFrame(1, "hrs"))

    const candlesM15 = await api.ticksHistory(periodM15);
    const candlesH1 = await api.ticksHistory(periodH1);

    const closePricesM15 = candlesM15?.candles?.map(i => {return i?.close})
    const closePricesH1 = candlesH1?.candles?.map(i => {return i?.close})

    const openPricesM15 = candlesM15?.candles?.map(i => {return i?.open})
    const openPricesH1 = candlesH1?.candles?.map(i => {return i?.open})

    function bearish15(candle){
      return openPricesM15[candle] > closePricesM15[candle]
    }
    function bullish15(candle){
      return closePricesM15[candle] > openPricesM15[candle]
    }

    function bearish60(candle){
      return openPricesH1[candle] > closePricesH1[candle]
    }
    function bullish60(candle){
      return closePricesH1[candle] > openPricesH1[candle]
    }

    if(bearish15(18) && bullish15(19)){
      data = `${asset?.name} is bullish on the 15 minutes`
      console.log(`${asset?.name} is bullish`)
    }
    if(bullish15(18) && bearish15(19)){
      data = `${asset?.name} is bearish on the 15 minutes`
      console.log(`${asset?.name} is bearish`)
    }

    if(bearish60(18) && bullish60(19)){
      data = `${asset?.name} is bullish on the 1 hour`
      console.log(`${asset?.name} is bullish`)
    }
    if(bullish60(18) && bearish60(19)){
      data = `${asset?.name} is bearish on the 1 hour`
      console.log(`${asset?.name} is bearish`)
    }

    count += 1
    console.log(data, count)

  } catch (error){
    data = error?.error?.message
    console.log(error?.error?.message) 
  }
};