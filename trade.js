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

let closePrices = []
let openPrices = []
let position = null
let openContractId = null
let openPosition = {}
let openPositions = false

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

function calculateEMA(prices, period) {
    const k = 2 / (period + 1);
    let ema = prices[0];
    for (let i = 1; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
    }
    return ema;
}

function detectCrossover() {
    const lastCloses = closePrices.slice(-22); // Enough for EMA-21

    const ema14_now = calculateEMA(lastCloses.slice(-14), 14);
    const ema21_now = calculateEMA(lastCloses.slice(-21), 21);
    const ema14_prev = calculateEMA(lastCloses.slice(-15, -1), 14);
    const ema21_prev = calculateEMA(lastCloses.slice(-22, -1), 21);

    const crossedUp = ema14_prev < ema21_prev && ema14_now > ema21_now;
    const crossedDown = ema14_prev > ema21_prev && ema14_now < ema21_now;

    return { crossedUp, crossedDown };
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
    console.log(`❌ Closing position: ${contract_id}`);
}

ws.on('open', () => {
    console.log('🔌 Connected');
    send({ authorize: API_TOKEN });
});

ws.on('message', async(msg) => {
    const data = JSON.parse(msg);

    if (data.msg_type === 'authorize') {
        console.log('✅ Authorized');
        setInterval(()=>{
            send({ ticks_history: 'R_75', style: 'candles', count: 23, granularity: 60, end: 'latest'})
            send({ portfolio: 1 })
        }, 5000)
    }

    if (data.msg_type === 'portfolio') {
        // console.log(data?.portfolio?.contracts)
        if(data?.portfolio?.contracts?.length == 0){
            openPositions = false
        } else{
            openPositions = true
            openPosition = data?.portfolio?.contracts[data?.portfolio?.contracts?.length - 1] 
            position = openPosition?.contract_type
            openContractId = openPosition?.contract_id
        }
        // for (let i = 0; i < data?.portfolio?.contracts?.length; i++) {
        //     console.log(data?.portfolio?.contracts[i]?.contract_id)
        //     closePosition(data?.portfolio?.contracts[i]?.contract_id)
        // }
    }

    if (data.msg_type === 'candles') {
        closePrices = data?.candles?.map(i => {return i?.close})
        openPrices = data?.candles?.map(i => {return i?.open})

        const { crossedUp, crossedDown } = detectCrossover();

        if (crossedUp) {
            sendMessage(`Crossed Up`)
            position === 'MULTDOWN' && closePosition(openContractId);
            openPositions === false && buyMultiplier('MULTUP');
        } else if (crossedDown) {
            sendMessage(`Crossed Down`)
            position === 'MULTDOWN' && closePosition(openContractId);
            openPositions === false && buyMultiplier('MULTDOWN');
        }
    }
    

    if (data.msg_type === 'buy') {
        console.log(`🟢 Entered ${position} position, Contract ID: ${openContractId}`);
    }

    if (data.msg_type === 'sell') {
        console.log(`💸 Position closed at ${data?.sell?.sold_for} USD`);
        openContractId = null;
        position = null;
    }

    if (data.error) {
        console.error('❗ Error:', data.error.message);
    }
});