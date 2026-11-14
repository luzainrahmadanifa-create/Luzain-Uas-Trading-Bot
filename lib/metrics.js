// Perhitungan metrik. Semua angka dashboard harus berasal dari sini (hitung_ulang).
export function totalReturnPct(initial, final) {
  return ((final - initial) / initial) * 100;
}

export function cagrPct(initial, final, days) {
  if (days <= 0 || initial <= 0) return null;
  const years = days / 365.25;
  if (years <= 0) return null;
  return (Math.pow(final / initial, 1 / years) - 1) * 100;
}

/**
 * Maximum drawdown dari deret equity (urut waktu).
 * @param {{t:number, equity:number}[]} series
 */
export function maxDrawdown(series) {
  let peak = -Infinity;
  let mdd = 0;
  let peakAt = null;
  let troughAt = null;
  let curPeakAt = null;
  for (const p of series) {
    if (p.equity > peak) { peak = p.equity; curPeakAt = p.t; }
    const dd = peak > 0 ? (p.equity - peak) / peak : 0;
    if (dd < mdd) { mdd = dd; peakAt = curPeakAt; troughAt = p.t; }
  }
  return { mddPct: mdd * 100, peakAt, troughAt };
}

export function tradeStats(trades) {
  const closed = trades.filter((t) => Number.isFinite(t.pnl));
  const wins = closed.filter((t) => t.pnl > 0);
  const losses = closed.filter((t) => t.pnl <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const fees = closed.reduce((s, t) => s + (t.feeIn || 0) + (t.feeOut || 0), 0);
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
  const avgWinPct = wins.length ? wins.reduce((s, t) => s + (t.pnlPct || 0), 0) / wins.length : 0;
  const avgLossPct = losses.length ? losses.reduce((s, t) => s + (t.pnlPct || 0), 0) / losses.length : 0;
  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);
  const payoff = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : null;
  const expectancy = closed.length ? closed.reduce((s, t) => s + t.pnl, 0) / closed.length : 0;
  return {
    trades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    grossProfit,
    grossLoss,
    netProfit: grossProfit - grossLoss,
    profitFactor,
    avgWin,
    avgLoss,
    avgWinPct,
    avgLossPct,
    payoff,
    expectancy,
    fees,
    bestTrade: closed.length ? Math.max(...closed.map((t) => t.pnl)) : 0,
    worstTrade: closed.length ? Math.min(...closed.map((t) => t.pnl)) : 0
  };
}

/** Porsi biaya = (fee + spread + slippage) / laba kotor. */
export function costSharePct(costs, grossProfit) {
  if (!(grossProfit > 0)) return null;
  return (costs / grossProfit) * 100;
}

/** Buy & hold: beli di open pertama, nilai di close terakhir. */
export function buyAndHold(candles, initial, feePct) {
  if (!candles.length) return null;
  const entry = candles[0].o;
  const exit = candles[candles.length - 1].c;
  const qty = (initial * (1 - feePct)) / entry;
  const final = qty * exit * (1 - feePct);
  return {
    entry, exit, qty,
    final,
    returnPct: totalReturnPct(initial, final)
  };
}

/** Deret equity harian dari equity per bar (ambil nilai terakhir tiap hari UTC). */
export function dailyEquity(series) {
  const byDay = new Map();
  for (const p of series) {
    const day = Math.floor(p.t / 86400);
    byDay.set(day, p); // bar terakhir hari itu menang
  }
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

/** Maximum drawdown beruntun (consecutive losses). */
export function maxConsecutiveLosses(trades) {
  let cur = 0, max = 0;
  for (const t of trades) {
    if (t.pnl <= 0) { cur++; max = Math.max(max, cur); } else cur = 0;
  }
  return max;
}
