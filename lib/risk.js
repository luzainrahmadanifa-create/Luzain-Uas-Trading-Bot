// Risk management wajib: batas posisi, daily loss limit (WIB), kill switch.
import { CONFIG } from './config.js';

const WIB_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric', month: '2-digit', day: '2-digit'
});

/** Tanggal WIB (YYYY-MM-DD). Hari berganti 00.00 WIB = 17.00 UTC. */
export function dayKeyWIB(tsMs) {
  const parts = WIB_FMT.formatToParts(new Date(tsMs));
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function killSwitchActive(state = {}, env = process.env) {
  return String(env.KILL_SWITCH || '').trim() === '1' || state.killSwitch === true;
}

/**
 * Pastikan anchor harian benar. equity harian diambil pada panggilan
 * pertama setelah 00.00 WIB.
 */
export function ensureDailyAnchor(state, equity, nowMs) {
  const key = dayKeyWIB(nowMs);
  if (state.dayKey !== key) {
    state.dayKey = key;
    state.dayStartEquity = equity;
    state.dayStartAt = new Date(nowMs).toISOString();
    state.dailyLossTripped = false;
    state.dailyEquityCaptured = false;
  }
  return state;
}

/** Catat equity harian sekali per hari (panggilan pertama setelah 00.00 WIB). */
export function maybeCaptureDailyEquity(state, equity, nowMs, positionsValue) {
  ensureDailyAnchor(state, equity, nowMs);
  if (!state.dailyEquityCaptured) {
    state.dailyEquityCaptured = true;
    return {
      dayKey: state.dayKey,
      at: new Date(nowMs).toISOString(),
      equity,
      cash: state.cash,
      positionsValue,
      positions: (state.positions || []).length
    };
  }
  return null;
}

/**
 * Cek apakah boleh membuka posisi baru.
 * @returns {{allowed:boolean, reasons:string[]}}
 */
export function canOpenPosition(state, { equity, openPositions }, env = process.env) {
  const reasons = [];
  if (killSwitchActive(state, env)) reasons.push('kill switch aktif');
  if (state.dailyLossTripped) reasons.push('daily loss limit sudah terlampaui hari ini');
  if (openPositions >= (state.maxPositions || CONFIG.maxPositions)) {
    reasons.push(`posisi terbuka maksimum (${openPositions})`);
  }
  if (state.dayStartEquity && equity < state.dayStartEquity * (1 - (state.dailyLossLimitPct ?? CONFIG.dailyLossLimitPct))) {
    state.dailyLossTripped = true;
    reasons.push('daily loss limit terlampaui');
  }
  return { allowed: reasons.length === 0, reasons };
}

/** Ukuran order berdasarkan ekuitas berjalan. */
export function positionSize(equity, allocPct = CONFIG.allocPctPerPosition, minOrder = CONFIG.minOrderIdr) {
  const target = equity * allocPct;
  return target >= minOrder ? target : 0;
}
