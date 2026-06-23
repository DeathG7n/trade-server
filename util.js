// function candleCrossesEitherEMA(index, ema1, ema2, high, low) {
//   return (
//     crossedEma(high, low, index, ema1) || crossedEma(high, low, index, ema2)
//   );
// }

// function detectCrossover(emaFast, emaSlow) {
//   const len = emaFast.length;

//   if (len < 3) return null;

//   const prevFast = emaFast[len - 3];
//   const prevSlow = emaSlow[len - 3];

//   const currFast = emaFast[len - 2];
//   const currSlow = emaSlow[len - 2];

//   if (prevFast <= prevSlow && currFast > currSlow) {
//     return "bullish";
//   }

//   if (prevFast >= prevSlow && currFast < currSlow) {
//     return "bearish";
//   }

//   return null;
// }

// async function getTouchProposal(barrier, symbol, stake) {
//   const request = {
//     proposal: 1,
//     amount: stake * 0.35,
//     barrier: barrier,
//     basis: "stake",
//     contract_type: "ONETOUCH",
//     currency: "USD",
//     duration: 20,
//     duration_unit: "m",
//     underlying_symbol: symbol,
//   };
//   ws.send(JSON.stringify(request));
// }

// function isNumberBetween(number, lowerBound, upperBound) {
//   return number >= lowerBound && number <= upperBound;
// }

// function recentEmaCross(emaFast, emaSlow, lookback = 15) {
//   const len = emaFast.length;

//   for (let i = len - 2; i >= len - lookback - 1 && i > 0; i--) {
//     // Bullish cross
//     if (emaFast[i - 1] <= emaSlow[i - 1] && emaFast[i] > emaSlow[i]) {
//       return "bullish";
//     }

//     // Bearish cross
//     if (emaFast[i - 1] >= emaSlow[i - 1] && emaFast[i] < emaSlow[i]) {
//       return "bearish";
//     }
//   }

//   return null;
// }