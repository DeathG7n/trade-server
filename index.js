const express = require('express')
const app = express()
const cors = require('cors')
const WebSocket = require('ws');
const DerivAPIBasic = require('@deriv/deriv-api/dist/DerivAPIBasic');
const connection = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=36807');
const ta = require('ta.js')
const api = new DerivAPIBasic({ connection })
let data = "No signal yet"
const date = new Date();

app.use(cors())

app.get("/1minute",(req, res)=>{
  assets.forEach((asset)=>{ 
    get1minute(asset) 
  })
  res.json(data)
  data = "No signal yet"
})

app.get("/5minutes",(req, res)=>{
  assets.forEach((asset)=>{ 
    get5minutes(asset) 
  })
  res.json(data)
  data = "No signal yet"
})

app.listen(3000,()=>{
  console.log("Server is running")
})

const assets = [
    {
        name: "Volatility 150(1s) Index",
        symbol: "1HZ150V"
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

  
const get1minute = async (asset) => {
    try{
      const periodM1_14 = getTicksRequest(asset?.symbol, 14 , getTimeFrame(1, "mins"))
      const periodM15_14 = getTicksRequest(asset?.symbol, 14 , getTimeFrame(15, "mins"))
      const periodM1_21 = getTicksRequest(asset?.symbol, 21 , getTimeFrame(1, "mins"))
      const periodM15_21 = getTicksRequest(asset?.symbol, 21 , getTimeFrame(15, "mins"))
      
      const candlesM1_14 = await api.ticksHistory(periodM1_14);
      const candlesM15_14 = await api.ticksHistory(periodM15_14);
      const candlesM1_21 = await api.ticksHistory(periodM1_21);
      const candlesM15_21 = await api.ticksHistory(periodM15_21);
  
      const closePricesM1_14 = candlesM1_14?.candles?.map(i => {return i?.close})
      const closePricesM15_14 = candlesM15_14?.candles?.map(i => {return i?.close})
      const closePricesM1_21 = candlesM1_21?.candles?.map(i => {return i?.close})
      const closePricesM15_21 = candlesM15_21?.candles?.map(i => {return i?.close})
  
      const openPricesM1_21 = candlesM1_21?.candles?.map(i => {return i?.open})
      const openPricesM15_21 = candlesM15_21?.candles?.map(i => {return i?.open})
  
      const higher14ema = ta.ema(closePricesM15_14, closePricesM1_14?.length)
      const higher21ema = ta.ema(closePricesM15_21, closePricesM15_21?.length)
      const lower14ema = ta.ema(closePricesM1_14, closePricesM1_14?.length)
      const lower21ema = ta.ema(closePricesM1_21, closePricesM1_21?.length)
  
      const higherTrend = higher14ema > higher21ema ? true : false
      const lowerTrend = lower14ema > lower21ema ? true : false

      function bearish1(candle){
        return openPricesM1_21[candle] > closePricesM1_21[candle]
      }
      function bullish1(candle){
        return closePricesM1_21[candle] > openPricesM1_21[candle]
      }

      function bearish15(candle){
        return openPricesM15_21[candle] > closePricesM15_21[candle]
      }
      function bullish15(candle){
        return closePricesM15_21[candle] > openPricesM15_21[candle]
      }

      if(bearish15(18) && bullish15(19)){
        data = true
        if(lowerTrend == true){
            if(bearish1(18) && bullish1(19)){
              data = `${asset?.name} is bullish on the 1 minute`
              console.log(`${asset?.name} is bullish`)
            }
            if(bearish1(17) && bullish1(18) && bullish1(19)){
              data = `${asset?.name} is bullish on the 1 minute`
              console.log(`${asset?.name} is bullish`)
            }
        }
      }
      if(bullish15(18) && bearish15(19)){
        data = true
        if(lowerTrend == false){
            if(bullish1(18) && bearish1(19)){
              data = `${asset?.name} is bearish on the 1 minute`
              console.log(`${asset?.name} is bearish`)
            }
            if(bullish1(17) && bearish1(18) && bearish1(19)){
              data = `${asset?.name} is bearish on the 1 minute`
              console.log(`${asset?.name} is bearish`)
            }
        }
      }

      console.log(data, date.toString())

    } catch (error){
        data = {
          signal : true,
          text: error?.message,
        }
      console.log(error) 
    }
};

const get5minutes = async (asset) => {
  try{
    const periodM5_14 = getTicksRequest(asset?.symbol, 14 , getTimeFrame(5, "mins"))
    const periodH1_14 = getTicksRequest(asset?.symbol, 14 , getTimeFrame(1, "hrs"))
    const periodM5_21 = getTicksRequest(asset?.symbol, 21 , getTimeFrame(5, "mins"))
    const periodH1_21 = getTicksRequest(asset?.symbol, 21 , getTimeFrame(1, "hrs"))
    
    const candlesM5_14 = await api.ticksHistory(periodM5_14);
    const candlesH1_14 = await api.ticksHistory(periodH1_14);
    const candlesM5_21 = await api.ticksHistory(periodM5_21);
    const candlesH1_21 = await api.ticksHistory(periodH1_21);

    const closePricesM5_14 = candlesM5_14?.candles?.map(i => {return i?.close})
    const closePricesH1_14 = candlesH1_14?.candles?.map(i => {return i?.close})
    const closePricesM5_21 = candlesM5_21?.candles?.map(i => {return i?.close})
    const closePricesH1_21 = candlesH1_21?.candles?.map(i => {return i?.close})

    const openPricesM5_21 = candlesM5_21?.candles?.map(i => {return i?.open})
    const openPricesH1_21 = candlesH1_21?.candles?.map(i => {return i?.open})

    const higher14ema = ta.ema(closePricesH1_14, closePricesM5_14?.length)
    const higher21ema = ta.ema(closePricesH1_21, closePricesH1_21?.length)
    const lower14ema = ta.ema(closePricesM5_14, closePricesM5_14?.length)
    const lower21ema = ta.ema(closePricesM5_21, closePricesM5_21?.length)

    const higherTrend = higher14ema > higher21ema ? true : false
    const lowerTrend = lower14ema > lower21ema ? true : false

    function bearish5(candle){
      return openPricesM5_21[candle] > closePricesM5_21[candle]
    }
    function bullish5(candle){
      return closePricesM5_21[candle] > openPricesM5_21[candle]
    }

    function bearish60(candle){
      return openPricesH1_21[candle] > closePricesH1_21[candle]
    }
    function bullish60(candle){
      return closePricesH1_21[candle] > openPricesH1_21[candle]
    }

    if(bearish60(18) && bullish60(19)){
      data = true
      if(lowerTrend == true){
          if(bearish5(18) && bullish5(19)){
            data = `${asset?.name} is bullish on the 5 minutes`
            console.log(`${asset?.name} is bullish`)
          }
          if(bearish5(17) && bullish5(18) && bullish5(19)){
            data = `${asset?.name} is bullish on the 5 minutes`
            console.log(`${asset?.name} is bullish`)
          }
      }
    }
    if(bullish60(18) && bearish60(19)){
      data = true
      if(lowerTrend == false){
          if(bullish5(18) && bearish5(19)){
            data = `${asset?.name} is bearish on the 5 minutes`
            console.log(`${asset?.name} is bearish`)
          }
          if(bullish5(17) && bearish5(18) && bearish5(19)){
            data = `${asset?.name} is bearish on the 5 minutes`
            console.log(`${asset?.name} is bearish`)
          }
      }
    }

    console.log(data, date.toString())

  } catch (error){
    data = error?.error?.message
    console.log(error) 
  }
};
