// Model eksekusi: fill mengikuti order book (dry run) dan model biaya untuk backtest.
import { CONFIG } from './config.js';

const FEE = CONFIG.feeTakerPct;

export function floorToIncrement(value, increment) {
  if (!increment || increment <= 0) return value;
  const steps = Math.floor((value + 1e-12) / increment);
  return Number((steps * increment).toFixed(12));
}

export function roundToIncrement(value, increment) {
  if (!increment || increment <= 0) return value;
  return Number((Math.round(value / increment) * increment).toFixed(12));
}

/**
 * Simulasi BUY dengan menyapu level ask. Fee dihitung terpisah.
 * @param {{asks:{p:number,q:number}[]}} book
 * @param {number} notionalIdr jumlah rupiah yang ingin dibelanjakan (termasuk fee? tidak; ini nilai order)
 * @param {number} quantityIncrement
 */
export function simulateBuy(book, notionalIdr, quantityIncrement = 0) {
  const asks = book.asks || [];
  if (!asks.length) return { ok: false, reason: 'order book ask kosong' };
  let remaining = notionalIdr;
  let qty = 0;
  let cost = 0;
  let levels = 0;
  let worst = null;
  for (const lvl of asks) {
    if (remaining <= 0) break;
    const levelNotional = lvl.p * lvl.q;
    const takeNotional = Math.min(remaining, levelNotional);
    const takeQty = takeNotional / lvl.p;
    qty += takeQty;
    cost += takeNotional;
    remaining -= takeNotional;
    worst = lvl.p;
    levels++;
    if (levels >= CONFIG.orderBookLevels) break;
  }
  qty = floorToIncrement(qty, quantityIncrement);
  if (qty <= 0) return { ok: false, reason: 'kuantitas nol setelah pembulatan' };
  const notional = qty * (cost / (qty || 1));
  const avgPrice = cost / (qty || 1);
  const fee = notional * FEE;
  return {
    ok: true,
    side: 'buy',
    qty,
    avgPrice,
    notional,
    fee,
    feePct: FEE,
    levels,
    worstPrice: worst,
    partial: remaining > 1
  };
}

/**
 * Simulasi SELL dengan menyapu level bid.
 */
export function simulateSell(book, qtyToSell, quantityIncrement = 0) {
  const bids = book.bids || [];
  if (!bids.length) return { ok: false, reason: 'order book bid kosong' };
  let qty = floorToIncrement(qtyToSell, quantityIncrement);
  if (qty <= 0) return { ok: false, reason: 'kuantitas nol' };
  let remaining = qty;
  let proceeds = 0;
  let levels = 0;
  let worst = null;
  for (const lvl of bids) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, lvl.q);
    proceeds += take * lvl.p;
    remaining -= take;
    worst = lvl.p;
    levels++;
    if (levels >= CONFIG.orderBookLevels) break;
  }
  const filled = qty - remaining;
  if (filled <= 0) return { ok: false, reason: 'tidak ada likuiditas bid' };
  const avgPrice = proceeds / filled;
  const notional = proceeds;
  const fee = notional * FEE;
  return {
    ok: true,
    side: 'sell',
    qty: filled,
    avgPrice,
    notional,
    fee,
    feePct: FEE,
    levels,
    worstPrice: worst,
    partial: remaining > 1e-12
  };
}

/**
 * Harga fill untuk BACKTEST. Candle tidak punya bid/ask, jadi pakai
 * spread & slippage hasil pengukuran order book (data/costs.json).
 * Buy membayar setengah spread + slippage; sell menerima lebih sedikit.
 */
export function backtestFillPrice(close, side, cost) {
  const halfSpread = (cost?.spreadBps || 0) / 2 / 10000;
  const slip = (cost?.slippageBps || 0) / 10000;
  return side === 'buy' ? close * (1 + halfSpread + slip) : close * (1 - halfSpread - slip);
}

export function feeFor(notional, pct = FEE) {
  return notional * pct;
}

export function spreadPctOf(book) {
  if (!book || !book.bestBid || !book.bestAsk) return null;
  const mid = (book.bestBid + book.bestAsk) / 2;
  return (book.bestAsk - book.bestBid) / mid;
}

/** Validasi book sebelum eksekusi. */
export function validateBook(book, cfg = CONFIG) {
  const issues = [];
  if (!book || !book.bids?.length || !book.asks?.length) {
    issues.push('order book kosong');
    return { ok: false, issues };
  }
  const sp = spreadPctOf(book);
  if (sp == null) issues.push('bid/ask tidak valid');
  else if (sp > cfg.maxSpreadPct) issues.push(`spread ${(sp * 100).toFixed(2)}% > ${(cfg.maxSpreadPct * 100).toFixed(0)}%`);
  if (book.bestAsk <= book.bestBid) issues.push('ask <= bid');
  if (book.bestBid <= 0) issues.push('bid nol/negatif');
  return { ok: issues.length === 0, issues, spreadPct: sp };
}
