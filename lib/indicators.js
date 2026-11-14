// Indikator teknikal murni (tanpa dependensi).
// Dipakai bersama oleh backtest dan bot supaya sinyal identik.

/** EMA dengan seed SMA pada periode pertama. */
export function ema(values, period) {
  const n = values.length;
  const out = new Array(n).fill(null);
  if (n < period || period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  const k = 2 / (period + 1);
  for (let i = period; i < n; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** ATR Wilder. */
export function atr(highs, lows, closes, period) {
  const n = closes.length;
  const out = new Array(n).fill(null);
  if (n <= period) return out;
  const tr = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (i === 0) { tr[i] = highs[i] - lows[i]; continue; }
    const a = highs[i] - lows[i];
    const b = Math.abs(highs[i] - closes[i - 1]);
    const c = Math.abs(lows[i] - closes[i - 1]);
    tr[i] = Math.max(a, b, c);
  }
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  let prev = sum / period;
  out[period] = prev;
  for (let i = period + 1; i < n; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

/** Rolling sum sederhana (untuk turnover 24 jam). */
export function rollingSum(values, window) {
  const n = values.length;
  const out = new Array(n).fill(null);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    if (i >= window - 1) out[i] = sum;
  }
  return out;
}

export function crossAbove(a, b, i) {
  if (i < 1) return false;
  if (a[i] == null || b[i] == null || a[i - 1] == null || b[i - 1] == null) return false;
  return a[i - 1] <= b[i - 1] && a[i] > b[i];
}

export function crossBelow(a, b, i) {
  if (i < 1) return false;
  if (a[i] == null || b[i] == null || a[i - 1] == null || b[i - 1] == null) return false;
  return a[i - 1] >= b[i - 1] && a[i] < b[i];
}

/** Simple Moving Average (dipakai untuk metrik/benchmark bila perlu). */
export function sma(values, period) {
  const n = values.length;
  const out = new Array(n).fill(null);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}
