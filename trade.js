const WebSocket = require('ws');
const express = require('express')
const app = express()
const cors = require('cors')
const ta = require('ta.js')

const API_TOKEN = 'St6G0SSIRWnEhYd';
const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=36807');

let closePrices = []
let openPrices = []
let position = null
let openContractId = null
let openPositions = false
let count = 0

app.use(cors())

app.get("/",(req, res)=>{
  console.log("Hi")
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

function buyMultiplier(direction) {
    console.log(`📈 Sending ${direction} order...`);

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
            stop_loss: 0.5,
        },
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
            send({ ticks_history: 'R_75', style: 'candles', count: 22, granularity: 60, end: 'latest'})
            send({ portfolio: 1 })
        }, 5000)
    }

    if (data.msg_type === 'portfolio') {
        if(data?.portfolio?.contracts == []){
            openPositions = false
        } else{
            openPositions = true
        }
    }

    if (data.msg_type === 'candles') {
        closePrices = data?.candles?.map(i => {return i?.close})
        openPrices = data?.candles?.map(i => {return i?.open})

        const current14 = closePrices.slice(-14)
        const current21 = closePrices

        const previous14 = closePrices.slice(-15).slice(0,14)
        const previous21 = closePrices.slice(0,21)
        
        const current14ema = ta.ema(current14, current14.length)
        const current21ema = ta.ema(current21, current21.length)
        
        const previous14ema = ta.ema(previous14, previous14.length)
        const previous21ema = ta.ema(previous21, previous21.length)

        const crossedUp = previous14ema < previous21ema && current14ema > current21ema;
        const crossedDown = previous14ema > previous21ema && current14ema < current21ema;

        if (crossedUp) {
            if (position === 'MULTDOWN') closePosition(openContractId);
            openPositions === false && buyMultiplier('MULTUP');
        } else if (crossedDown) {
            if (position === 'MULTUP') closePosition(openContractId);
            openPositions === false && buyMultiplier('MULTDOWN');
        }

        count += 1
        console.log(count)
    }
    

    if (data.msg_type === 'buy') {
        openContractId = data.buy.contract_id;
        position = data.buy.contract_type;
        console.log(`🟢 Entered ${position} position, Contract ID: ${openContractId}`);
    }

    if (data.msg_type === 'sell') {
        console.log(`💸 Position closed at ${data.sell.sold_for} USD`);
        openContractId = null;
        position = null;
    }

    if (data.error) {
        console.error('❗ Error:', data.error.message);
    }
});


    // if (data.msg_type === 'tick') {
    //     const price = Number(data.tick.quote);
    //     closePrices.push(price);
    //     if (closePrices.length > 50) closePrices.shift();

    //     const ema14 = calculateEMA(closePrices.slice(-14), 14);
    //     const ema21 = calculateEMA(closePrices.slice(-21), 21);

    //     console.log(`EMA14: ${ema14.toFixed(2)}, EMA21: ${ema21.toFixed(2)}, Price: ${price}`);

        // Detect crossover
        // const lastEma14 = calculateEMA(closePrices.slice(-15, -1), 14);
        // const lastEma21 = calculateEMA(closePrices.slice(-22, -1), 21);

        // const crossedUp = lastEma14 < lastEma21 && ema14 > ema21;
        // const crossedDown = lastEma14 > lastEma21 && ema14 < ema21;

        // if (crossedUp) {
        //     if (position === 'MULTDOWN') closePosition(openContractId);
            //if (openContractId == null) buyMultiplier('MULTUP');
        // } else if (crossedDown) {
        //     if (position === 'MULTUP') closePosition(openContractId);
            //if (openContractId == null) buyMultiplier('MULTDOWN');
    //     }
    // }