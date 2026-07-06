

export function detectCrossover(emaFast, emaSlow) {
  const len = emaFast.length;

  if (len < 3) return null;

  const prevFast = emaFast[len - 3];
  const prevSlow = emaSlow[len - 3];

  const currFast = emaFast[len - 2];
  const currSlow = emaSlow[len - 2];

  if (prevFast <= prevSlow && currFast > currSlow) {
    return "bullish";
  }

  if (prevFast >= prevSlow && currFast < currSlow) {
    return "bearish";
  }

  return null;
}

// export async function getTouchProposal(barrier, symbol, stake) {
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

export function isNumberBetween(number, lowerBound, upperBound) {
  return number >= lowerBound && number <= upperBound;
}

export function recentEmaCross(emaFast, emaSlow, lookback = 15) {
  const len = emaFast.length;

  for (let i = len - 2; i >= len - lookback - 1 && i > 0; i--) {
    // Bullish cross
    if (emaFast[i - 1] <= emaSlow[i - 1] && emaFast[i] > emaSlow[i]) {
      return "bullish";
    }

    // Bearish cross
    if (emaFast[i - 1] >= emaSlow[i - 1] && emaFast[i] < emaSlow[i]) {
      return "bearish";
    }
  }

  return null;
}

export function calculateADX(high, low, close, period = 14) {
  if (
    high.length !== low.length ||
    high.length !== close.length
  ) {
    throw new Error("High, Low and Close arrays must have equal lengths.");
  }

  const len = high.length;

  if (len < period * 2) {
    return {
      adx: Array(len).fill(null),
      plusDI: Array(len).fill(null),
      minusDI: Array(len).fill(null),
    };
  }

  const tr = Array(len).fill(0);
  const plusDM = Array(len).fill(0);
  const minusDM = Array(len).fill(0);

  // True Range and Directional Movement
  for (let i = 1; i < len; i++) {
    const upMove = high[i] - high[i - 1];
    const downMove = low[i - 1] - low[i];

    plusDM[i] =
      upMove > downMove && upMove > 0 ? upMove : 0;

    minusDM[i] =
      downMove > upMove && downMove > 0 ? downMove : 0;

    tr[i] = Math.max(
      high[i] - low[i],
      Math.abs(high[i] - close[i - 1]),
      Math.abs(low[i] - close[i - 1])
    );
  }

  const smoothTR = Array(len).fill(null);
  const smoothPlusDM = Array(len).fill(null);
  const smoothMinusDM = Array(len).fill(null);

  // Initial Wilder sums
  let trSum = 0;
  let plusSum = 0;
  let minusSum = 0;

  for (let i = 1; i <= period; i++) {
    trSum += tr[i];
    plusSum += plusDM[i];
    minusSum += minusDM[i];
  }

  smoothTR[period] = trSum;
  smoothPlusDM[period] = plusSum;
  smoothMinusDM[period] = minusSum;

  // Wilder smoothing
  for (let i = period + 1; i < len; i++) {
    smoothTR[i] =
      smoothTR[i - 1] -
      smoothTR[i - 1] / period +
      tr[i];

    smoothPlusDM[i] =
      smoothPlusDM[i - 1] -
      smoothPlusDM[i - 1] / period +
      plusDM[i];

    smoothMinusDM[i] =
      smoothMinusDM[i - 1] -
      smoothMinusDM[i - 1] / period +
      minusDM[i];
  }

  const plusDI = Array(len).fill(null);
  const minusDI = Array(len).fill(null);
  const dx = Array(len).fill(null);

  for (let i = period; i < len; i++) {
    if (smoothTR[i] === 0) {
      plusDI[i] = 0;
      minusDI[i] = 0;
      dx[i] = 0;
      continue;
    }

    plusDI[i] = 100 * smoothPlusDM[i] / smoothTR[i];
    minusDI[i] = 100 * smoothMinusDM[i] / smoothTR[i];

    const sum = plusDI[i] + minusDI[i];

    dx[i] =
      sum === 0
        ? 0
        : (100 * Math.abs(plusDI[i] - minusDI[i])) / sum;
  }

  const adx = Array(len).fill(null);

  // First ADX = average of first period DX values
  let dxSum = 0;

  for (let i = period; i < period * 2; i++) {
    dxSum += dx[i];
  }

  adx[period * 2 - 1] = dxSum / period;

  // Wilder smoothing of ADX
  for (let i = period * 2; i < len; i++) {
    adx[i] =
      ((adx[i - 1] * (period - 1)) + dx[i]) / period;
  }

  return {
    adx,
    plusDI,
    minusDI,
  };
}

export function bearish(open, close, candle) {
  return open?.[candle] > close?.[candle];
}
export function bullish(open, close, candle) {
  return close?.[candle] > open?.[candle];
}

export function crossedEma(high, low, candle, ema) {
  return high?.[candle] > ema?.[candle] && ema?.[candle] > low?.[candle];
}

export function candleCrossesEitherEMA(index, ema1, ema2, high, low) {
  return (
    crossedEma(high, low, index, ema1) || crossedEma(high, low, index, ema2)
  );
}

// Body size
export function candleBody(open, close, index) {
  return Math.abs(close[index] - open[index]);
}

export function calculateATR(high, low, close, period = 14) {
  if (
    high.length !== low.length ||
    low.length !== close.length ||
    high.length < period + 1
  ) {
    return [];
  }

  const tr = [];

  // True Range
  tr.push(high[0] - low[0]);

  for (let i = 1; i < high.length; i++) {
    tr.push(
      Math.max(
        high[i] - low[i],
        Math.abs(high[i] - close[i - 1]),
        Math.abs(low[i] - close[i - 1])
      )
    );
  }

  const atr = [];

  // First ATR = SMA of first period TRs
  let firstATR = 0;
  for (let i = 0; i < period; i++) {
    firstATR += tr[i];
  }
  firstATR /= period;

  atr[period - 1] = firstATR;

  // Wilder smoothing
  for (let i = period; i < tr.length; i++) {
    atr[i] = ((atr[i - 1] * (period - 1)) + tr[i]) / period;
  }

  return atr;
}