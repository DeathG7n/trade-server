const express = require('express')
const app = express()
const cors = require('cors')
const WebSocket = require('ws');
const DerivAPIBasic = require('@deriv/deriv-api/dist/DerivAPIBasic');
const connection = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=36807');
const ta = require('ta.js')
const api = new DerivAPIBasic({ connection })
let data = {
    signal : false,
    text: "No signal yet"
}

app.use(cors())

app.get("/",(req, res)=>{
    assets.forEach((asset)=>{ 
        getTicksHistory(asset) 
    })
    res.json(data)
    data = {
        signal : false,
        text: "No signal yet"
    }
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

  
const getTicksHistory = async (asset) => {
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
        if(lowerTrend == true){
            if(bearish1(19) && bullish1(20)){
                data = {
                    signal : true,
                    text: `${asset?.name} is bullish`,
                    data: closePricesM1_21
                }
                console.log(`${asset?.name} is bullish`)
            }
            if(bearish1(18) && bullish1(17) && bullish1(20)){
                data = {
                    signal : true,
                    text: `${asset?.name} is bullish`,
                    data: closePricesM1_21
                }
                console.log(`${asset?.name} is bullish`)
            }
        }
      }
      if(bullish15(18) && bearish15(19)){
        if(lowerTrend == false){
            if(bullish1(19) && bearish1(20)){
                data = {
                    signal : true,
                    text: `${asset?.name} is bullish`,
                    data: closePricesM1_21
                }
                console.log(`${asset?.name} is bullish`)
            }
            if(bullish1(18) && bearish1(19) && bearish1(20)){
                data = {
                    signal : true,
                    text: `${asset?.name} is bullish`,
                    data: closePricesM1_21
                }
                console.log(`${asset?.name} is bullish`)
            }
        }
      }

    } catch (error){
        data = {
            signal : true,
            text: error?.message,
        }
      console.log(error) 
    }
};

