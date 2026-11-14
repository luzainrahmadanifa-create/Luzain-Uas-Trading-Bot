// =====================================================================
// STRATEGI INTI - SATU FUNGSI SINYAL UNTUK BOT DAN BACKTEST
// Aturan (frozen):
//   Entry  : EMA9 memotong ke atas EMA21 (golden cross) pada candle TERTUTUP,
//            close > EMA50, ATR14/close <= maxAtrPct, turnover 24 bar >= batas.
//   Exit   : close < trailing stop ATR(14) x 3.0  ATAU  EMA9 < EMA21 (death cross).
//   Sizing : maks 20% ekuitas per posisi, maks 5 posisi, long-only.
// =====================================================================
import { ema, atr, rollingSum, crossAbove, crossBelow } from './indicators.js';
import { TF_SECONDS } from './config.js';

/**
 * @typedef {{t:number,o:number,h:number,l:number,c:number,v:number}} Candle
 */

/**
 * Buang candle yang belum tertutup.
 * Aturan PDF: bar dengan Time + durasi timeframe > server_time tidak boleh dipakai.
 */
export function dropUnclosed(candles, serverTimeSec, tf) {
  const dur = TF_SECONDS[String(tf)];
  if (!dur) throw new Error('timeframe tidak dikenal: ' + tf);
  return candles.filter((c) => c.t + dur <= serverTimeSec);
}

/**
 * Validasi data sebelum bot boleh membuka posisi.
 * Mengembalikan daftar masalah (kosong = valid).
 */
export function validateCandles(candles, cfg, serverTimeSec) {
  const issues = [];
  const tf = cfg.timeframe;
  const dur = TF_SECONDS[String(tf)];
  const need = Math.max(cfg.emaTrend, cfg.atrPeriod) + 5;

  if (!Array.isArray(candles) || candles.length === 0) {
    return ['candle kosong'];
  }
  if (candles.length < need) issues.push(`candle kurang: ${candles.length} < ${need}`);

  // urut + duplikat
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].t === candles[i - 1].t) issues.push('candle duplikat di ' + candles[i].t);
    if (candles[i].t < candles[i - 1].t) issues.push('candle tidak urut di ' + candles[i].t);
  }

  // harga/volume nol atau negatif
  for (const c of candles) {
    if (!(c.o > 0 && c.h > 0 && c.l > 0 && c.c > 0)) { issues.push('harga nol/negatif di ' + c.t); break; }
    if (!(c.v >= 0)) { issues.push('volume negatif di ' + c.t); break; }
  }

  // candle hilang pada jendela indikator
  const window = Math.min(candles.length, need + 2);
  const tail = candles.slice(-window);
  let missing = 0;
  for (let i = 1; i < tail.length; i++) {
    const gap = tail[i].t - tail[i - 1].t;
    if (gap > dur * 1.5) missing++;
  }
  if (missing > 0) issues.push(`ada ${missing} candle hilang di jendela indikator`);

  // data basi
  const last = candles[candles.length - 1];
  const age = serverTimeSec - (last.t + dur);
  if (age > cfg.staleMultiplier * dur) {
    issues.push(`candle tertutup terakhir basi ${Math.round(age / 60)} menit (> ${cfg.staleMultiplier}x timeframe)`);
  }

  // harga close terakhir harus masuk akal
  if (last.c <= 0) issues.push('close terakhir tidak valid');
  return [...new Set(issues)];
}

/**
 * Hitung indikator + sinyal untuk seluruh candle.
 * Mengembalikan { rows, warmup }.
 */
export function computeSignals(candles, cfg) {
  const n = candles.length;
  const closes = candles.map((c) => c.c);
  const highs = candles.map((c) => c.h);
  const lows = candles.map((c) => c.l);
  const volumes = candles.map((c) => c.v);
  const turnover = candles.map((c) => c.c * c.v); // IDR

  const emaFast = ema(closes, cfg.emaFast);
  const emaSlow = ema(closes, cfg.emaSlow);
  const emaTrend = ema(closes, cfg.emaTrend);
  const atrArr = atr(highs, lows, closes, cfg.atrPeriod);
  const tfSec = TF_SECONDS[String(cfg.timeframe)] || 3600;
  const turnoverWindow = Math.max(2, Math.round(86400 / tfSec)); // 24 jam
  const turnover24 = rollingSum(turnover, turnoverWindow);

  const warmup = Math.max(cfg.emaTrend, cfg.atrPeriod) + 1;
  const rows = new Array(n);

  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const af = emaFast[i];
    const as = emaSlow[i];
    const at = emaTrend[i];
    const a = atrArr[i];
    const atrPct = a != null && c.c > 0 ? a / c.c : null;

    const crossUp = crossAbove(emaFast, emaSlow, i);
    const crossDown = crossBelow(emaFast, emaSlow, i);

    const hasIndicators = af != null && as != null && at != null && a != null;
    const trendOk = hasIndicators && c.c > at;
    const slopeOk = !cfg.trendSlopeBars
      ? true
      : (i >= cfg.trendSlopeBars && emaTrend[i] != null && emaTrend[i - cfg.trendSlopeBars] != null
        && emaTrend[i] > emaTrend[i - cfg.trendSlopeBars]);
    const volOk = atrPct != null && atrPct <= cfg.maxAtrPct;
    const liqOk = turnover24[i] != null && turnover24[i] >= cfg.minTurnover24hIdr;

    rows[i] = {
      t: c.t,
      o: c.o, h: c.h, l: c.l, c: c.c, v: c.v,
      emaFast: af, emaSlow: as, emaTrend: at, atr: a, atrPct,
      turnover24h: turnover24[i],
      crossUp, crossDown, trendOk, slopeOk, volOk, liqOk,
      entrySignal: hasIndicators && crossUp && trendOk && slopeOk && volOk && liqOk,
      exitSignal: hasIndicators && crossDown,
      ready: i >= warmup && hasIndicators
    };
  }
  return { rows, warmup };
}

/**
 * Trailing stop ATR untuk satu posisi.
 * Stop_t = max(Stop_{t-1}, close_t - mult * ATR_t)
 */
export function nextTrailingStop(prevStop, close, atrValue, mult) {
  const candidate = close - mult * atrValue;
  if (!Number.isFinite(prevStop)) return candidate;
  return Math.max(prevStop, candidate);
}

/** Metrik bantu untuk laporan. */
export function summarizeRows(rows) {
  const ready = rows.filter((r) => r.ready);
  return {
    bars: rows.length,
    readyBars: ready.length,
    entries: ready.filter((r) => r.entrySignal).length,
    exits: ready.filter((r) => r.exitSignal).length
  };
}
