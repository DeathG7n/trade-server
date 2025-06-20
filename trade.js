const WebSocket = require('ws');
const express = require('express')
const app = express()
const cors = require('cors')
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
let canBuy = false
let profit = null
let stopLoss = null
let stake = null
let subscribed = false
let count = 0
let reason = ""

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
    let emaArray = [];

    emaArray[0] = prices?.[0];

    for (let i = 1; i < prices?.length; i++) {
        emaArray[i] = (prices[i] * k) + (emaArray[i - 1] * (1 - k));
    }

    return emaArray;
}

function detectEMACrossover() {
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

    const trend = ema14Now > ema21Now

    const closePrev = closePrices[prevIndex]
    const openPrev = openPrices[prevIndex]

    const crossedUp = ema14Prev < ema21Prev && ema14Now > ema21Now;
    const crossedDown = ema14Prev > ema21Prev && ema14Now < ema21Now;

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

function closePosition(contract_id, reason) {
    send({
        sell: contract_id,
        price: 0,
    });
    reason = reason
    console.log(`❌ Closing position: ${contract_id} because of ${reason}`);
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
            send({ portfolio: 1 })
        }, 2100)
        setInterval(()=>{
            send({ ticks_history: 'R_75', style: 'candles', count: 10000000000000000000, granularity: 60, end: 'latest'})
        }, 1000)
    }

    if (data.msg_type === 'portfolio') {
        if(data?.portfolio?.contracts?.length === 0){
            canBuy = true
            openContractId = null;
            position = null;
            subscribed = false
            stopLoss = null
            profit = null
        } else{
            canBuy = false
            openPosition = data?.portfolio?.contracts[data?.portfolio?.contracts?.length - 1] 
            position = openPosition?.contract_type
            openContractId = openPosition?.contract_id
            if(data?.portfolio?.contracts?.length > 1){
                closePosition(openContractId, 'More than one position open!!!')
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
    }

    if (data.msg_type === 'candles') {
        closePrices = data?.candles?.map(i => {return i?.close})
        openPrices = data?.candles?.map(i => {return i?.open})
        
        const { crossedUp, crossedDown } = detectEMACrossover();

        if(canBuy){
            if (crossedUp) {
                canBuy = false
                if(position === null) {
                    position = 'MULTUP'
                }
                buyMultiplier('MULTUP');
            } else if (crossedDown) {
                canBuy = false
                if(position === null) {
                    position = 'MULTDOWN'
                }
                buyMultiplier('MULTDOWN');
            }
        } else if (canBuy === false){
            if (crossedUp) {
                canBuy = true
                position === 'MULTDOWN' && closePosition(openContractId, 'Down Position in Uptrend!!!');
                openContractId = null
            } else if (crossedDown) {
                canBuy = true
                position === 'MULTUP' && closePosition(openContractId, 'Up Position in Downtrend!!!');
                openContractId = null
            }
        }
        
        count += 1
        console.log(count)
        
    }

    if (data.msg_type === 'proposal_open_contract') {
        console.log(data)
        const entrySpot = data?.proposal_open_contract?.entry_spot
        const currentSpot = data?.proposal_open_contract?.current_spot
        const pip = currentSpot - entrySpot
        profit = data?.proposal_open_contract?.profit
        stake = data?.proposal_open_contract?.limit_order?.stop_out?.order_amount
        console.log(pip , profit)
        if(stopLoss === null){
            stopLoss = stake/4
        }
        if(stopLoss !== null && profit >= (Math.abs(stake)/4)){
            stopLoss = data?.proposal_open_contract?.commission
        }
        if(stopLoss !== null && profit !== null && profit <= stopLoss){
            stopLoss = null
            profit = null
            //closePosition(openContractId, 'Stop Loss Reached')
        }
        if(profit >= (Math.abs(stake)/2)){
            //closePosition(openContractId, 'Take Profit Reached')
        }
    }
    

    if (data.msg_type === 'buy') {
        sendMessage(`${position} position entered`)
        console.log(`🟢 Entered ${position} position, Contract ID: ${openContractId}`);
    }

    if (data.msg_type === 'sell') {
        sendMessage(`💸 Position closed at ${data?.sell?.sold_for} USD because ${reason}`)
        console.log(`💸 Position closed at ${data?.sell?.sold_for} USD`);
    }

    if (data.error) {
        console.error('❗ Error:', data.error.message);
    }
});
