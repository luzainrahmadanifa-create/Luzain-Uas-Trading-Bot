// =====================================================================
// /api/tick - satu endpoint yang dipanggil penjadwal.
// Alur: baca state -> ambil data live -> hitung sinyal (fungsi sama
// dengan backtest) -> eksekusi order simulasi di bid/ask -> simpan state & log.
// Wajib dilindungi CRON_SECRET (header Authorization: Bearer ...).
// =====================================================================
import { CONFIG } from '../lib/config.js';
import { getServerTime, getCandles, getDepth, getPairs, summarizeDepth } from '../lib/indodax.js';
import { dropUnclosed, validateCandles, computeSignals } from '../lib/strategy.js';
import { simulateBuy, simulateSell, validateBook } from '../lib/execution.js';
import {
  getState, setState, appendLog,
  candleAlreadyProcessed, markCandleProcessed
} from '../lib/store.js';
import {
  dayKeyWIB, canOpenPosition, positionSize,
  ensureDailyAnchor, maybeCaptureDailyEquity, killSwitchActive
} from '../lib/risk.js';

const TF_SEC = CONFIG.tfMinutes * 60;

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers['authorization'] || '';
  const headerSecret = req.headers['x-cron-secret'] || '';
  const q = req.query?.secret;
  return auth === `Bearer ${secret}` || headerSecret === secret || q === secret;
}

function defaultState(nowMs) {
  return {
    createdAt: new Date(nowMs).toISOString(),
    startingEquity: CONFIG.startingEquityIdr,
    cash: CONFIG.startingEquityIdr,
    positions: {},
    lastCandle: {},
    runCount: 0,
    lastRunAt: null,
    killSwitch: false,
    dayKey: null,
    dayStartEquity: CONFIG.startingEquityIdr,
    dailyLossTripped: false,
    dailyEquityCaptured: false,
    maxPositions: CONFIG.maxPositions,
    dailyLossLimitPct: CONFIG.dailyLossLimitPct,
    meta: null
  };
}

async function loadMeta(state, nowMs) {
  const day = dayKeyWIB(nowMs);
  if (state.meta && state.meta.day === day) return state.meta;
  const pairs = await getPairs();
  const map = {};
  for (const p of pairs) {
    if (!p.symbol.endsWith('IDR')) continue;
    map[p.id] = {
      symbol: p.symbol,
      quantityIncrement: Number(p.quantity_increment ?? 1e-8) || 1e-8,
      minOrderIdr: Number(p.trade_min_base_currency ?? 10000),
      feeTakerPct: Number(p.trade_fee_percent_taker ?? 0.2) / 100
    };
  }
  return { day, pairs: map };
}

export default async function handler(req, res) {
  const started = Date.now();
  const nowMs = Date.now();
  const runAt = new Date(nowMs).toISOString();

  if (!authorized(req)) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  const actions = [];
  const errors = [];
  let state = await getState(defaultState(nowMs));

  try {
    const serverTime = await getServerTime();
    state.meta = await loadMeta(state, nowMs);

    // ---- 1. ambil data tiap pasangan ----
    const contexts = [];
    for (const u of CONFIG.universe) {
      const pairId = u.pairId;
      const meta = state.meta.pairs[pairId] || { quantityIncrement: 1e-8, minOrderIdr: 10000 };
      const ctx = { ...u, meta, ok: false };
      try {
        const from = serverTime - (CONFIG.candleLimit + 20) * TF_SEC;
        const raw = await getCandles(u.symbol, CONFIG.timeframe, from, serverTime);
        const closed = dropUnclosed(raw, serverTime, CONFIG.timeframe);
        const issues = validateCandles(closed, CONFIG, serverTime);
        ctx.issues = issues;
        ctx.candles = closed;
        ctx.rows = computeSignals(closed, CONFIG).rows;
        ctx.last = ctx.rows.at(-1);

        const depthRaw = await getDepth(pairId);
        const book = summarizeDepth(depthRaw);
        const bookCheck = validateBook(book, CONFIG);
        ctx.book = book;
        ctx.bookCheck = bookCheck;
        if (!bookCheck.ok) issues.push(...bookCheck.issues.map((x) => 'book: ' + x));
        ctx.ok = issues.length === 0;
      } catch (e) {
        ctx.issues = ['fetch: ' + e.message];
        errors.push({ ts: runAt, pair: u.symbol, stage: 'fetch', error: e.message });
      }
      contexts.push(ctx);
    }

    // ---- 2. ekuitas mark-to-market pada best bid ----
    let positionsValue = 0;
    for (const [pairId, pos] of Object.entries(state.positions)) {
      const ctx = contexts.find((c) => c.pairId === pairId);
      const mark = ctx?.book?.bestBid;
      positionsValue += pos.qty * (mark || pos.lastMark || pos.entryPrice);
    }
    let equity = state.cash + positionsValue;

    // ---- 3. anchor & equity harian (00.00 WIB) ----
    ensureDailyAnchor(state, equity, nowMs);
    const dailySnap = maybeCaptureDailyEquity(state, equity, nowMs, positionsValue);
    if (dailySnap) await appendLog('equity', dailySnap);

    const killed = killSwitchActive(state);
    if (killed) {
      const source = String(process.env.KILL_SWITCH || '').trim() === '1' ? 'env:KILL_SWITCH' : 'state.killSwitch';
      actions.push({ type: 'kill_switch', note: 'pembukaan posisi baru dihentikan' });
      await appendLog('killswitch', {
        ts: runAt, source, active: true,
        equity, positions: Object.keys(state.positions).length,
        note: 'kill switch aktif: tidak ada posisi baru yang dibuka pada tick ini'
      });
    }

    // ---- 4. proses tiap pasangan ----
    for (const ctx of contexts) {
      if (!ctx.ok || !ctx.last) continue;
      const pairId = ctx.pairId;
      const lastT = ctx.last.t;
      const isNew = !candleAlreadyProcessed(state, pairId, lastT);
      const pos = state.positions[pairId];

      await appendLog('signals', {
        ts: runAt,
        pair: ctx.symbol,
        candleT: lastT,
        candleIso: new Date(lastT * 1000).toISOString(),
        close: ctx.last.c,
        emaFast: ctx.last.emaFast,
        emaSlow: ctx.last.emaSlow,
        emaTrend: ctx.last.emaTrend,
        atr: ctx.last.atr,
        entrySignal: ctx.last.entrySignal,
        exitSignal: ctx.last.exitSignal,
        stop: pos?.stop ?? null,
        hasPosition: Boolean(pos),
        newCandle: isNew
      });

      if (!isNew) continue;

      // ---- 4a. EXIT ----
      if (pos) {
        const stopHit = ctx.last.c < pos.stop;
        const deathCross = ctx.last.exitSignal;
        if (stopHit || deathCross) {
          const sell = simulateSell(ctx.book, pos.qty, ctx.meta.quantityIncrement);
          if (!sell.ok) {
            errors.push({ ts: runAt, pair: ctx.symbol, stage: 'sell', error: sell.reason });
          } else {
            const pnl = sell.notional - sell.fee - pos.entryNotional - pos.entryFee;
            state.cash += sell.notional - sell.fee;
            delete state.positions[pairId];
            const order = {
              ts: runAt, pair: ctx.symbol, side: 'sell',
              qty: sell.qty, bestBid: ctx.book.bestBid, bestAsk: ctx.book.bestAsk,
              avgPrice: sell.avgPrice, notional: sell.notional, fee: sell.fee,
              levels: sell.levels,
              signalCandleT: lastT,
              fillVsSignalPct: (sell.avgPrice / ctx.last.c - 1) * 100,
              reason: stopHit ? 'trailing_stop' : 'death_cross',
              pnl, pnlPct: (pnl / (pos.entryNotional + pos.entryFee)) * 100,
              entryT: pos.entryT
            };
            await appendLog('orders', order);
            actions.push({ type: 'sell', pair: ctx.symbol, qty: sell.qty, price: sell.avgPrice, reason: order.reason });
          }
        }
      }

      // ---- 4b. ENTRY ----
      if (!state.positions[pairId] && ctx.last.entrySignal) {
        const equityNow = state.cash + Object.entries(state.positions).reduce((s, [pid, p]) => {
          const c = contexts.find((x) => x.pairId === pid);
          return s + p.qty * (c?.book?.bestBid || p.lastMark || p.entryPrice);
        }, 0);
        const gate = canOpenPosition(state, {
          equity: equityNow,
          openPositions: Object.keys(state.positions).length
        });
        if (!gate.allowed) {
          actions.push({ type: 'entry_blocked', pair: ctx.symbol, reasons: gate.reasons });
        } else {
          const size = positionSize(equityNow);
          if (size < CONFIG.minOrderIdr) {
            actions.push({ type: 'entry_blocked', pair: ctx.symbol, reasons: ['ukuran order di bawah minimum'] });
          } else {
            const buy = simulateBuy(ctx.book, size, ctx.meta.quantityIncrement);
            if (!buy.ok) {
              errors.push({ ts: runAt, pair: ctx.symbol, stage: 'buy', error: buy.reason });
            } else if (buy.notional + buy.fee > state.cash) {
              actions.push({ type: 'entry_blocked', pair: ctx.symbol, reasons: ['kas tidak cukup'] });
            } else {
              const stop = buy.avgPrice - CONFIG.atrMult * ctx.last.atr;
              state.cash -= buy.notional + buy.fee;
              state.positions[pairId] = {
                symbol: ctx.symbol,
                qty: buy.qty,
                entryPrice: buy.avgPrice,
                entryNotional: buy.notional,
                entryFee: buy.fee,
                entryT: nowMs,
                stop,
                signalT: lastT,
                lastMark: ctx.book.bestBid
              };
              const order = {
                ts: runAt, pair: ctx.symbol, side: 'buy',
                qty: buy.qty, bestBid: ctx.book.bestBid, bestAsk: ctx.book.bestAsk,
                avgPrice: buy.avgPrice, notional: buy.notional, fee: buy.fee,
                levels: buy.levels,
                signalCandleT: lastT,
                fillVsSignalPct: (buy.avgPrice / ctx.last.c - 1) * 100,
                reason: 'golden_cross',
                stop
              };
              await appendLog('orders', order);
              actions.push({ type: 'buy', pair: ctx.symbol, qty: buy.qty, price: buy.avgPrice, stop });
            }
          }
        }
      }

      markCandleProcessed(state, pairId, lastT);
    }

    // ---- 5. update & simpan ----
    let posVal = 0;
    for (const [pairId, pos] of Object.entries(state.positions)) {
      const ctx = contexts.find((c) => c.pairId === pairId);
      const mark = ctx?.book?.bestBid || pos.lastMark || pos.entryPrice;
      pos.lastMark = mark;
      posVal += pos.qty * mark;
    }
    state.runCount += 1;
    state.lastRunAt = runAt;
    state.lastEquity = state.cash + posVal;
    await setState(state);

    const call = {
      ts: runAt,
      ok: errors.length === 0,
      durationMs: Date.now() - started,
      serverTime,
      pairsEvaluated: contexts.filter((c) => c.ok).length,
      pairsFailed: contexts.filter((c) => !c.ok).length,
      actions: actions.length,
      errors: errors.length,
      equity: state.lastEquity,
      positions: Object.keys(state.positions).length,
      killSwitch: killed,
      dayKey: state.dayKey
    };
    await appendLog('calls', call);
    for (const e of errors) await appendLog('errors', e);

    res.status(200).json({
      ok: errors.length === 0,
      runAt,
      equity: state.lastEquity,
      cash: state.cash,
      positions: Object.keys(state.positions).length,
      actions,
      errors,
      pairs: contexts.map((c) => ({
        pair: c.symbol,
        ok: c.ok,
        candle: c.last ? new Date(c.last.t * 1000).toISOString() : null,
        entrySignal: c.last?.entrySignal ?? null,
        exitSignal: c.last?.exitSignal ?? null,
        issues: c.issues
      })),
      durationMs: Date.now() - started
    });
  } catch (e) {
    await appendLog('errors', { ts: runAt, stage: 'tick', error: e.message, stack: e.stack?.split('\n').slice(0, 5) });
    await appendLog('calls', {
      ts: runAt, ok: false, durationMs: Date.now() - started,
      actions: actions.length, errors: 1, error: e.message
    });
    res.status(500).json({ ok: false, error: e.message });
  }
}
