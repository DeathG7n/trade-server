const WebSocket = require('ws');
const express = require('express')
const app = express()
const cors = require('cors')
const axios = require('axios');

const API_TOKEN = 'IxcmbIEL0Mb4fvQ';
const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=36807');

const BOT_TOKEN = '8033524186:AAFp1cMBr1oRVUgCa2vwKPgroSw_i6M-qEQ';
const CHAT_ID = '8068534792';

let closePrices = []
let openPrices = []
let position = null
let openContractId = null
let openPosition = null
let openPositions = false
let canBuy = false
let profit = null
let stopLoss = -250
let stake = null
let subscribed = false
let count = 0
let reason = ""
let previousCandle = 0


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

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function run(ms) {
    console.log(`⏳ Waiting ${ms/1000} seconds...`);
    await sleep(ms)
    console.log("✅ Done!");
}

function bearish(candle){
    return openPrices[candle] > closePrices[candle]
}
function bullish(candle){
    return closePrices[candle] > openPrices[candle]
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

    const prevClose = closePrices[prevIndex]
    const prevOpen = openPrices[prevIndex]

    const crossedUp = bullish(prevIndex) && prevClose >= ema21Prev && ema21Prev >= prevOpen
    const crossedDown = bearish(prevIndex) && prevOpen >= ema21Prev && ema21Prev >= prevClose

    // const crossedUp = bearish(prevIndex) && bullish(currIndex)
    // const crossedDown = bullish(prevIndex) && bearish(currIndex)

    // const crossedUp = ema14Prev < ema21Prev && ema14Now > ema21Now;
    // const crossedDown = ema14Prev > ema21Prev && ema14Now < ema21Now;

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
    //console.log(data)

    if (data.msg_type === 'authorize') {
        console.log('✅ Authorized');
        send({ portfolio: 1 })
        setInterval(()=>{
            send({ portfolio: 1 })
        }, 10000)
        setInterval(()=>{
            send({ ticks_history: 'R_75', style: 'candles', count: 10000000000000000000, granularity: 60, end: 'latest'})
        }, 1000)
    }

    if (data.msg_type === 'portfolio') {
        if(data?.portfolio?.contracts?.length === 0){
            openPosition = null
            openContractId = null;
            position = null;
            subscribed = false
            profit = null
            stopLoss = -250
            canBuy = true
        } else{
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
    }

    if (data.msg_type === 'candles') {
        closePrices = data?.candles?.map(i => {return i?.close})
        openPrices = data?.candles?.map(i => {return i?.open})
        const len = closePrices?.length;
        const prevIndex = len - 2;
        
        const { crossedUp, crossedDown } = detectEMACrossover();

        if(previousCandle !== closePrices[prevIndex]){
            previousCandle = closePrices[prevIndex]
            if (crossedUp) {
                position === 'MULTDOWN' && closePosition(openContractId);
                canBuy === true && buyMultiplier('MULTUP');
            } else if (crossedDown) {
                position === 'MULTUP' && closePosition(openContractId);
                canBuy === true && buyMultiplier('MULTDOWN');
            }
            await run(30000)
        } 
        count += 1
        console.log(count)    
    }

    if (data.msg_type === 'proposal_open_contract') {
        canBuy = false
        openPositions = true
        const entrySpot = data?.proposal_open_contract?.entry_spot
        const currentSpot = data?.proposal_open_contract?.current_spot
        const pip = currentSpot - entrySpot
        profit = data?.proposal_open_contract?.profit
        stake = data?.proposal_open_contract?.limit_order?.stop_out?.order_amount
        console.log(pip , profit)
        if(pip <= stopLoss){
            closePosition(openContractId)
            await run(2000)
        }
        if(stopLoss === -250 && pip >= 250){
            stopLoss = 50
        }
        if(pip >= 1000){
            closePosition(openContractId)
            await run(2000)
        }
    }
    

    if (data.msg_type === 'buy') {
        position = data?.echo_req?.parameters?.contract_type
        openContractId = data?.buy?.contract_id
        send({
            proposal_open_contract: 1,
            contract_id: data?.buy?.contract_id,
            subscribe: 1
        });
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
