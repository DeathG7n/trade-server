

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

// function calculateADX(high, low, close, period = 14) {
//   const tr = [];
//   const plusDM = [];
//   const minusDM = [];

//   // Step 1: TR, +DM, -DM
//   tr[0] = 0;
//   plusDM[0] = 0;
//   minusDM[0] = 0;

//   for (let i = 1; i < high.length; i++) {
//     const upMove = high[i] - high[i - 1];
//     const downMove = low[i - 1] - low[i];

//     plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
//     minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;

//     tr[i] = Math.max(
//       high[i] - low[i],
//       Math.abs(high[i] - close[i - 1]),
//       Math.abs(low[i] - close[i - 1]),
//     );
//   }

//   const smoothTR = [];
//   const smoothPlusDM = [];
//   const smoothMinusDM = [];

//   // First smoothed values
//   smoothTR[period] = 0;
//   smoothPlusDM[period] = 0;
//   smoothMinusDM[period] = 0;

//   for (let i = 1; i <= period; i++) {
//     smoothTR[period] += tr[i];
//     smoothPlusDM[period] += plusDM[i];
//     smoothMinusDM[period] += minusDM[i];
//   }

//   // Wilder smoothing
//   for (let i = period + 1; i < high.length; i++) {
//     smoothTR[i] = smoothTR[i - 1] - smoothTR[i - 1] / period + tr[i];

//     smoothPlusDM[i] =
//       smoothPlusDM[i - 1] - smoothPlusDM[i - 1] / period + plusDM[i];

//     smoothMinusDM[i] =
//       smoothMinusDM[i - 1] - smoothMinusDM[i - 1] / period + minusDM[i];
//   }

//   const plusDI = [];
//   const minusDI = [];
//   const dx = [];

//   for (let i = period; i < high.length; i++) {
//     plusDI[i] = (100 * smoothPlusDM[i]) / smoothTR[i];
//     minusDI[i] = (100 * smoothMinusDM[i]) / smoothTR[i];

//     dx[i] = (100 * Math.abs(plusDI[i] - minusDI[i])) / (plusDI[i] + minusDI[i]);
//   }

//   const adx = [];

//   // First ADX = average of first 'period' DX values
//   let sumDX = 0;
//   for (let i = period; i < period * 2; i++) {
//     sumDX += dx[i];
//   }

//   adx[period * 2 - 1] = sumDX / period;

//   // Wilder smoothing of ADX
//   for (let i = period * 2; i < high.length; i++) {
//     adx[i] = (adx[i - 1] * (period - 1) + dx[i]) / period;
//   }

//   return {
//     adx,
//     plusDI,
//     minusDI,
//   };
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