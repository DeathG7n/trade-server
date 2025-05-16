const express = require('express')
const say = require('say');
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
  },
   {
    name: "Volatility 150 Index",
    symbol: "1HZ150V"
  },
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
    const period = getTicksRequest(asset?.symbol, 22 , getTimeFrame(5, "mins"))

    const candles = await api.ticksHistory(period);

    const closePrices = candles?.candles?.map(i => {return i?.close})

    const current14 = closePrices.slice(-14)
    const previous14 = closePrices.slice(-15).slice(0,14)

    const current21 = closePrices.slice(-21)
    const previous21 = closePrices.slice(0,21)

    const current14ema = ta.ema(current14, current14.length)
    const previous14ema = ta.ema(previous14, previous14.length)
    const current21ema = ta.ema(current21, current21.length)
    const previous21ema = ta.ema(previous21, previous21.length)


    if(previous14ema > previous21ema && current14ema < current21ema){
      console.log(`Bullish Crossover Detected on ${asset?.name}`)
      data = `Bullish Crossover Detected on ${asset?.name}`
      say.speak(`signal`);
    }

    if(previous14ema < previous21ema && current14ema > current21ema){
      console.log(`Bearish Crossover Detected on ${asset?.name}`)
      data = `Bearish Crossover Detected on ${asset?.name}`
      say.speak(`signal`);
    }

    count += 1
    console.log(data, count)

  } catch (error){
    data = error?.error?.message
    console.log(error?.error?.message) 
  }
};

const arg = process.argv
if (arg[arg.length - 1] == "true"){
  setInterval(()=>{
    assets.forEach((asset)=>{ 
      getSignal(asset) 
    })
  }, 1000)
} 
