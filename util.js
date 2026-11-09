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

export function calculateEMA(prices, period) {
  const k = 2 / (period + 1);

  const emaArray = [];

  if (!prices.length) {
    return emaArray;
  }

  emaArray[0] = prices[0];

  for (let i = 1; i < prices.length; i++) {
    emaArray[i] = prices[i] * k + emaArray[i - 1] * (1 - k);
  }

  return emaArray;
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

export function recentEmaCross(emaFast, emaSlow, lookback) {
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
  if (high.length !== low.length || high.length !== close.length) {
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

    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;

    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;

    tr[i] = Math.max(
      high[i] - low[i],
      Math.abs(high[i] - close[i - 1]),
      Math.abs(low[i] - close[i - 1]),
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
    smoothTR[i] = smoothTR[i - 1] - smoothTR[i - 1] / period + tr[i];

    smoothPlusDM[i] =
      smoothPlusDM[i - 1] - smoothPlusDM[i - 1] / period + plusDM[i];

    smoothMinusDM[i] =
      smoothMinusDM[i - 1] - smoothMinusDM[i - 1] / period + minusDM[i];
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

    plusDI[i] = (100 * smoothPlusDM[i]) / smoothTR[i];
    minusDI[i] = (100 * smoothMinusDM[i]) / smoothTR[i];

    const sum = plusDI[i] + minusDI[i];

    dx[i] = sum === 0 ? 0 : (100 * Math.abs(plusDI[i] - minusDI[i])) / sum;
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
    adx[i] = (adx[i - 1] * (period - 1) + dx[i]) / period;
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

export function crossedPrice(high, low, candle, price) {
  return high?.[candle] >= price && price >= low?.[candle];
}

export function crossedEma(high, low, candle, ema) {
  return high?.[candle] >= ema?.[candle] && ema?.[candle] >= low?.[candle];
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

export function candleDistance(close, ema, index) {
  return Math.abs(close[index] - ema[index]);
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
        Math.abs(low[i] - close[i - 1]),
      ),
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
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }

  return atr;
}

export function calculateHeikinAshi(open, high, low, close) {
  const haOpen = [];
  const haHigh = [];
  const haLow = [];
  const haClose = [];

  if (
    open.length !== high.length ||
    high.length !== low.length ||
    low.length !== close.length
  ) {
    throw new Error("OHLC arrays must have the same length.");
  }

  for (let i = 0; i < close.length; i++) {
    // HA Close
    haClose[i] = (open[i] + high[i] + low[i] + close[i]) / 4;

    if (i === 0) {
      // First candle
      haOpen[i] = (open[i] + close[i]) / 2;
    } else {
      // Remaining candles
      haOpen[i] = (haOpen[i - 1] + haClose[i - 1]) / 2;
    }

    // HA High
    haHigh[i] = Math.max(high[i], haOpen[i], haClose[i]);

    // HA Low
    haLow[i] = Math.min(low[i], haOpen[i], haClose[i]);
  }

  return {
    open: haOpen,
    high: haHigh,
    low: haLow,
    close: haClose,
  };
}

export function trendContinuation(trend, open, close, high, low) {
  const len = open.length;
  const prevIndex = len - 2;
  const thirdIndex = len - 3;
  const fourthIndex = len - 4;
  if (trend === "up") {
    if (
      bearish(open, close, fourthIndex) &&
      bearish(open, close, thirdIndex) &&
      bullish(open, close, prevIndex)
    ) {
      return true;
    }
    if (
      low[prevIndex] <= low[thirdIndex] &&
      close[prevIndex] >= low[thirdIndex]
    ) {
      return true;
    }
  }
  if (trend === "down") {
    if (
      bullish(open, close, fourthIndex) &&
      bullish(open, close, thirdIndex) &&
      bearish(open, close, prevIndex)
    ) {
      return true;
    }
    if (
      high[prevIndex] >= high[thirdIndex] &&
      close[prevIndex] <= high[thirdIndex]
    ) {
      return true;
    }
  }
  return null;
}

export function candleRangeTheoryEntry(trend, high, low, close) {
  const len = close.length;
  const prevIndex = len - 2;
  const thirdIndex = len - 3;
  if (trend === "up") {
    if (
      low[prevIndex] <= low[thirdIndex] &&
      close[prevIndex] >= low[thirdIndex]
    ) {
      return true;
    }
  }
  if (trend === "down") {
    if (
      high[prevIndex] >= high[thirdIndex] &&
      close[prevIndex] <= high[thirdIndex]
    ) {
      return true;
    }
  }
  return null;
}

export function engulfingCandleEntry(trend, open, close) {
  const len = close.length;
  const prevIndex = len - 2;
  const thirdIndex = len - 3;
  if (
    candleBody(open, close, prevIndex) > candleBody(open, close, thirdIndex)
  ) {
    if (trend === "up") {
      if (bearish(open, close, thirdIndex) && bullish(open, close, prevIndex)) {
        return true;
      }
    }
    if (trend === "down") {
      if (bullish(open, close, thirdIndex) && bearish(open, close, prevIndex)) {
        return true;
      }
    }
  }
  return null;
}

export function haramiEntry(trend, open, close, high, low) {
  const len = close.length;
  const prevIndex = len - 2;
  const thirdIndex = len - 3;
  if (high[thirdIndex] > high[prevIndex] && low[prevIndex] > low[thirdIndex]) {
    if (trend === "up") {
      if (bearish(open, close, thirdIndex) && bullish(open, close, prevIndex)) {
        return true;
      }
    }
    if (trend === "down") {
      if (bullish(open, close, thirdIndex) && bearish(open, close, prevIndex)) {
        return true;
      }
    }
  }
  return null;
}

export function withinHtfCandleRange(high, low, close) {
  const htfLength = high.length;
  const ltfLength = close.length;
  const prevHtfCandle = htfLength - 2;
  const prevLtfCandle = ltfLength - 2;
  return (
    high[prevHtfCandle] >= close[prevLtfCandle] &&
    close[prevLtfCandle] >= low[prevHtfCandle]
  );
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Market structure helpers (Daily / 4H / 15m / 5m strategy) ---

/** Confirmed swing high at index i (needs `right` bars after it). */
export function isSwingHigh(high, i, left = 2, right = 2) {
  if (i < left || i + right >= high.length) return false;
  const v = high[i];
  for (let j = i - left; j <= i + right; j++) {
    if (j === i) continue;
    if (high[j] >= v) return false;
  }
  return true;
}

export function isSwingLow(low, i, left = 2, right = 2) {
  if (i < left || i + right >= low.length) return false;
  const v = low[i];
  for (let j = i - left; j <= i + right; j++) {
    if (j === i) continue;
    if (low[j] <= v) return false;
  }
  return true;
}

/** Returns arrays of { index, price } for swing highs/lows up to last confirmed bar. */
export function findSwings(high, low, left = 2, right = 2) {
  const highs = [];
  const lows = [];
  const end = Math.min(high.length, low.length) - right - 1;
  for (let i = left; i <= end; i++) {
    if (isSwingHigh(high, i, left, right)) {
      highs.push({ index: i, price: high[i] });
    }
    if (isSwingLow(low, i, left, right)) {
      lows.push({ index: i, price: low[i] });
    }
  }
  return { highs, lows };
}

/**
 * 4H bias from last swing structure.
 * up: higher high + higher low; down: lower high + lower low; else none.
 */
export function structureBias(high, low, left = 2, right = 2) {
  const { highs, lows } = findSwings(high, low, left, right);
  if (highs.length < 2 || lows.length < 2) return "none";
  const h1 = highs[highs.length - 2];
  const h2 = highs[highs.length - 1];
  const l1 = lows[lows.length - 2];
  const l2 = lows[lows.length - 1];
  const hh = h2.price > h1.price;
  const hl = l2.price > l1.price;
  const lh = h2.price < h1.price;
  const ll = l2.price < l1.price;
  if (hh && hl) return "up";
  if (lh && ll) return "down";
  return "none";
}

/**
 * Weak high: swing high whose following move down fails to break prior swing low.
 * Weak low: swing low whose following move up fails to break prior swing high.
 */
export function weakStrongLevels(high, low, left = 2, right = 2) {
  const { highs, lows } = findSwings(high, low, left, right);
  const weakHighs = [];
  const weakLows = [];
  const strongHighs = [];
  const strongLows = [];

  for (let i = 1; i < highs.length; i++) {
    const h = highs[i];
    const priorLow = [...lows].reverse().find((l) => l.index < h.index);
    if (!priorLow) continue;
    const laterLow = lows.find((l) => l.index > h.index);
    if (!laterLow) continue;
    if (laterLow.price > priorLow.price) {
      weakHighs.push(h);
    } else {
      strongHighs.push(h);
    }
  }

  for (let i = 1; i < lows.length; i++) {
    const l = lows[i];
    const priorHigh = [...highs].reverse().find((h) => h.index < l.index);
    if (!priorHigh) continue;
    const laterHigh = highs.find((h) => h.index > l.index);
    if (!laterHigh) continue;
    if (laterHigh.price < priorHigh.price) {
      weakLows.push(l);
    } else {
      strongLows.push(l);
    }
  }

  return {
    weakHighs,
    weakLows,
    strongHighs,
    strongLows,
    lastSwingHigh: highs[highs.length - 1] || null,
    lastSwingLow: lows[lows.length - 1] || null,
    highs,
    lows,
  };
}

/**
 * Detect BOS / CHOCH on closed bar `signalIndex` (usually len-2).
 * bias: "up" | "down" | "none" from higher TF.
 * Returns { type, direction, level } or null.
 * CHOCH: first break against local structure; BOS: continuation break with bias.
 */
export function detectBosChoch(high, low, close, signalIndex, bias, left = 2, right = 2) {
  if (signalIndex < left + right + 2) return null;
  // Only evaluate swings confirmed before signal bar
  const sliceEnd = signalIndex; // exclusive of forming; signal is last closed
  const h = high.slice(0, sliceEnd + 1);
  const l = low.slice(0, sliceEnd + 1);
  const { highs, lows } = findSwings(h, l, left, right);
  if (highs.length < 1 || lows.length < 1) return null;

  const lastHigh = highs[highs.length - 1];
  const lastLow = lows[lows.length - 1];
  const c = close[signalIndex];
  const prevC = close[signalIndex - 1];

  // Bullish break of last swing high
  if (prevC <= lastHigh.price && c > lastHigh.price) {
    const localDown = lastLow.index > lastHigh.index || (lows.length >= 2 && lows[lows.length - 1].price < lows[lows.length - 2].price);
    if (bias === "up") {
      return { type: localDown ? "CHOCH" : "BOS", direction: "bullish", level: lastHigh.price };
    }
    if (bias === "down") {
      return { type: "CHOCH", direction: "bullish", level: lastHigh.price };
    }
    return { type: "BOS", direction: "bullish", level: lastHigh.price };
  }

  // Bearish break of last swing low
  if (prevC >= lastLow.price && c < lastLow.price) {
    const localUp = lastHigh.index > lastLow.index || (highs.length >= 2 && highs[highs.length - 1].price > highs[highs.length - 2].price);
    if (bias === "down") {
      return { type: localUp ? "CHOCH" : "BOS", direction: "bearish", level: lastLow.price };
    }
    if (bias === "up") {
      return { type: "CHOCH", direction: "bearish", level: lastLow.price };
    }
    return { type: "BOS", direction: "bearish", level: lastLow.price };
  }

  return null;
}

/** Previous completed daily candle high/low (index len-2 if last is forming). */
export function previousDayRange(high, low, signalIndex) {
  if (signalIndex < 0 || !high?.length) return null;
  return { high: high[signalIndex], low: low[signalIndex] };
}