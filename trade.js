const WebSocket = require('ws');
const express = require('express')
const app = express()
const cors = require('cors')
const ta = require('ta.js')
const axios = require('axios');

const API_TOKEN = 'St6G0SSIRWnEhYd';
const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=36807');

const BOT_TOKEN = '8033524186:AAFp1cMBr1oRVUgCa2vwKPgroSw_i6M-qEQ';
const CHAT_ID = '8068534792';

let candles = []
let heikinCandles = []
let closePrices = []
let closePrices15 = []
let openPrices = []
let position = null
let openContractId = null
let openPosition = {}
let canBuy = false
let profit = null
let stopLoss = null
let stake = null
let subscribed = false

app.use(cors())

app.get("/",(req, res)=>{
  res.json("Hi")
})

app.listen(3000,()=>{
  console.log("Server is running")
})

function send(msg) {
    ws.send(JSON.stringify(msg));
}

function bearish(candle){
    return heikinCandles[candle]?.haOpen > heikinCandles[candle]?.haClose
}
function bullish(candle){
    return heikinCandles[candle]?.haOpen < heikinCandles[candle]?.haClose
}

function convertToHeikinAshi(candles) {
    if (!candles || candles.length === 0) return [];

    const haCandles = [];

    for (let i = 0; i < candles.length; i++) {
        const { open, high, low, close } = candles[i];

        const haClose = (open + high + low + close) / 4;

        let haOpen;
        if (i === 0) {
            // For the first candle, use real open/close
            haOpen = (open + close) / 2;
        } else {
            const prev = haCandles[i - 1];
            haOpen = (prev.haOpen + prev.haClose) / 2;
        }

        const haHigh = Math.max(high, haOpen, haClose);
        const haLow = Math.min(low, haOpen, haClose);

        haCandles.push({ haOpen, haHigh, haLow, haClose });
    }

    return haCandles;
}

function calculateEMA(prices, period) {
    const k = 2 / (period + 1);
    let emaArray = [];

    emaArray[0] = prices?.[0];

    for (let i = 1; i < prices?.length; i++) {
        emaArray[i] = (prices[i] * k) + (emaArray[i - 1] * (1 - k));
    }

    return emaArray;
}

function detectEMACrossover(closePrices) {
    if (closePrices?.length < 22){
        console.log("not enough")
    }

    const ema14 = calculateEMA(closePrices, 14);
    const ema21 = calculateEMA(closePrices, 21);

    const len = closePrices?.length;
    const prevIndex = len - 2;
    const currIndex = len - 1;

    const ema14Prev = ema14[prevIndex];
    const ema21Prev = ema21[prevIndex];
    const ema14Now = ema14[currIndex];
    const ema21Now = ema21[currIndex];

    const closePrev = closePrices[prevIndex]
    const openPrev = openPrices[prevIndex]

    // const crossedUp = ema14Prev < ema21Prev && ema14Now > ema21Now;
    // const crossedDown = ema14Prev > ema21Prev && ema14Now < ema21Now;

    const crossedUp = closePrev > ema21Prev && openPrev < ema21Prev;
    const crossedDown = closePrev < ema21Prev && openPrev > ema21Prev;

    return { crossedUp, crossedDown };
}

function detectSignal() {
    const ema14 = calculateEMA(closePrices, 14);
    const ema21 = calculateEMA(closePrices, 21);

    const ema14_15 = calculateEMA(closePrices15, 14);
    const ema21_15 = calculateEMA(closePrices15, 21);

    const len = closePrices?.length;
    const thirdIndex = len - 4;
    const secondIndex = len - 3;
    const prevIndex = len - 2;
    const currIndex = len - 1;

    const ema14Now = ema14[currIndex];
    const ema21Now = ema21[currIndex];

    const ema14_15Now = ema14_15[currIndex];
    const ema21_15Now = ema21_15[currIndex];

    const trend = ema14Now > ema21Now
    const trend15 = ema14_15Now > ema21_15Now

    const buyUpSignal = trend15 && trend && (bearish(secondIndex) && bullish(prevIndex) || bearish(thirdIndex) && bullish(secondIndex) && bullish(prevIndex))
    const buyDownSignal = trend15 === false && trend === false && (bullish(secondIndex) && bearish(prevIndex) || bullish(thirdIndex) && bearish(secondIndex) && bearish(prevIndex))
    const sellUpSignal = trend15 && trend === false && (bullish(secondIndex) && bearish(prevIndex) || bullish(thirdIndex) && bearish(secondIndex) && bearish(prevIndex))
    const sellDownSignal = trend15 === false && trend && (bearish(secondIndex) && bullish(prevIndex) || bearish(thirdIndex) && bullish(secondIndex) && bullish(prevIndex))

    return { buyUpSignal , buyDownSignal,  sellUpSignal, sellDownSignal };
}

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

function buyMultiplier(direction) {
    position = direction
    console.log(`📈 Buying ${direction} multiplier...`);
    send({
        buy: 1,
        price: 1,
        parameters: {
            amount: 1,
            basis: 'stake',
            contract_type: direction,
            currency: 'USD',
            symbol: 'R_75',
            multiplier: 100,
        }
    });
}

function closePosition(contract_id) {
    send({
        sell: contract_id,
        price: 0,
    });
    send({ portfolio: 1 })
    console.log(`❌ Closing position: ${contract_id}`);
}

ws.on('open', () => {
    console.log('🔌 Connected');
    send({ authorize: API_TOKEN });
});

ws.on('message', async(msg) => {
    const data = JSON.parse(msg);
    //console.log(data)

    if (data.msg_type === 'authorize') {
        console.log('✅ Authorized');
        setInterval(()=>{
            send({ ticks_history: 'R_75', style: 'candles', count: 10000000000000000000, granularity: 60, end: 'latest'})
            send({ ticks_history: 'R_75', style: 'candles', count: 10000000000000000000, granularity: 900, end: 'latest'})
            send({ portfolio: 1 })
        }, 5000)
    }

    if (data.msg_type === 'portfolio') {
        if(data?.portfolio?.contracts?.length == 0){
            canBuy = true
            openContractId = null;
            position = null;
            subscribed = false
            stopLoss = null
        } else{
            canBuy = false
            openPosition = data?.portfolio?.contracts[data?.portfolio?.contracts?.length - 1] 
            position = openPosition?.contract_type
            openContractId = openPosition?.contract_id
            if(data?.portfolio?.contracts?.length > 1){
                closePosition(openContractId)
            }
            if(subscribed === false){
                send({
                    proposal_open_contract: 1,
                    contract_id: openContractId,
                    subscribe: 1
                });
                subscribed = true
            }
             
        }
        // for (let i = 0; i < data?.portfolio?.contracts?.length; i++) {
        //     console.log(data?.portfolio?.contracts[i]?.contract_id)
        //     closePosition(data?.portfolio?.contracts[i]?.contract_id)
        // }
    }

    if (data.msg_type === 'candles') {
        if(data?.echo_req?.granularity === 60){
            closePrices = data?.candles?.map(i => {return i?.close})
            openPrices = data?.candles?.map(i => {return i?.open})
            candles = data?.candles
            heikinCandles = convertToHeikinAshi(candles)
        } else{
            closePrices15 = data?.candles?.map(i => {return i?.close})
        }

        const { buyUpSignal , buyDownSignal,  sellUpSignal, sellDownSignal } = detectSignal();

        if(canBuy){
            if (buyUpSignal) {
                if(position === null) {
                    position = 'MULTUP'
                }
                buyMultiplier('MULTUP');
                send({ portfolio: 1 })
            } else if (buyDownSignal) {
                if(position === null) {
                    position = 'MULTDOWN'
                }
                buyMultiplier('MULTDOWN');
                send({ portfolio: 1 })
            }
        } else {
            if (sellDownSignal) {
                position === 'MULTDOWN' && closePosition(openContractId);
            } else if (sellUpSignal) {
                position === 'MULTUP' && closePosition(openContractId);
            }
        }

        // if(canBuy){
        //     if (crossedUp) {
        //         buyMultiplier('MULTUP');
        //         send({ portfolio: 1 })
        //     } else if (crossedDown) {
        //         buyMultiplier('MULTDOWN');
        //         send({ portfolio: 1 })
        //     }
        // } else {
        //     if (crossedUp) {
        //         position === 'MULTDOWN' && closePosition(openContractId);
        //         send({ portfolio: 1 })
        //     } else if (crossedDown) {
        //         position === 'MULTUP' && closePosition(openContractId);
        //         send({ portfolio: 1 })
        //     }
        // }
        
        
    }

    if (data.msg_type === 'proposal_open_contract') {
        profit = data?.proposal_open_contract?.profit
        stake = data?.proposal_open_contract?.limit_order?.stop_out?.order_amount
        if(stopLoss === null){
            stopLoss = Math.abs(stake)/4
        }
        if(stopLoss !== null && profit <= stopLoss){
            closePosition(openContractId)
        }
        if(profit >= (Math.abs(stake)/4)){
            //closePosition(openContractId)
        }
    }
    

    if (data.msg_type === 'buy') {
        sendMessage(`${position} position entered`)
        console.log(`🟢 Entered ${position} position, Contract ID: ${openContractId}`);
    }

    if (data.msg_type === 'sell') {
        sendMessage(`💸 Position closed at ${data?.sell?.sold_for} USD`)
        console.log(`💸 Position closed at ${data?.sell?.sold_for} USD`);
    }

    if (data.error) {
        console.error('❗ Error:', data.error.message);
    }
});