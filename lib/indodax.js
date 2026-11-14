// Klien API publik Indodax (tanpa API key, tanpa login).
// Batas: 180 request/menit. Kita batasi sendiri maksimum 3 request/detik.
import { CONFIG, TF_SECONDS } from './config.js';

const BASE = CONFIG.apiBase;
let nextSlot = 0;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function rateLimit() {
  const minGap = 1000 / CONFIG.apiRateLimitPerSec;
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + minGap;
  if (wait > 0) await sleep(wait);
}

/**
 * GET JSON dengan timeout + retry terbatas (exponential backoff).
 * Retry hanya untuk error jaringan, 429, dan 5xx.
 */
export async function httpJson(pathOrUrl, { retries = CONFIG.retry.attempts } = {}) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : BASE + pathOrUrl;
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    await rateLimit();
    try {
      const res = await fetch(url, {
        headers: {
          accept: 'application/json',
          // Cloudflare Indodax memblokir UA yang mengandung "bot"; pakai UA browser standar.
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        },
        signal: AbortSignal.timeout(CONFIG.retry.timeoutMs)
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status} ${url}`);
        await sleep(CONFIG.retry.baseDelayMs * Math.pow(2, attempt));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await sleep(CONFIG.retry.baseDelayMs * Math.pow(2, attempt));
    }
  }
  throw lastErr || new Error('request gagal: ' + url);
}

export async function getServerTime() {
  const j = await httpJson('/api/server_time');
  return Math.floor(Number(j.server_time) / 1000);
}

export async function getPairs() {
  return httpJson('/api/pairs');
}

export async function getPriceIncrements() {
  const j = await httpJson('/api/price_increments');
  return j.increments || {};
}

export async function getDepth(pairId) {
  return httpJson('/api/depth/' + pairId);
}

export async function getTickerAll() {
  const j = await httpJson('/api/ticker_all');
  return j.tickers || {};
}

/**
 * Ambil candle historis. API mengirim ~650 bar per request, jadi dipecah.
 * @returns {Promise<Array<{t:number,o:number,h:number,l:number,c:number,v:number}>>}
 */
export async function getCandles(symbol, tf, fromSec, toSec) {
  const dur = TF_SECONDS[String(tf)];
  if (!dur) throw new Error('tf tidak valid: ' + tf);
  const chunk = 600 * dur;
  const all = [];
  let cursor = Math.floor(fromSec);
  const end = Math.floor(toSec);
  while (cursor < end) {
    const to = Math.min(cursor + chunk, end);
    const url = `/tradingview/history_v2?symbol=${encodeURIComponent(symbol)}&tf=${tf}&from=${cursor}&to=${to}`;
    const rows = await httpJson(url);
    if (Array.isArray(rows)) {
      for (const r of rows) {
        all.push({
          t: Number(r.Time),
          o: Number(r.Open),
          h: Number(r.High),
          l: Number(r.Low),
          c: Number(r.Close),
          v: Number(r.Volume)
        });
      }
    }
    cursor = to;
    // beri jeda kecil agar ramah terhadap batas 3 req/detik
    await sleep(50);
  }
  // dedup + urut
  const byTime = new Map();
  for (const c of all) byTime.set(c.t, c);
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

/** Ringkasan order book: best bid/ask dan kedalaman. */
export function summarizeDepth(depth) {
  const bids = (depth.buy || []).map(([p, q]) => ({ p: Number(p), q: Number(q) }));
  const asks = (depth.sell || []).map(([p, q]) => ({ p: Number(p), q: Number(q) }));
  bids.sort((a, b) => b.p - a.p);
  asks.sort((a, b) => a.p - b.p);
  const bestBid = bids.length ? bids[0].p : null;
  const bestAsk = asks.length ? asks[0].p : null;
  const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : null;
  const spread = bestBid && bestAsk ? (bestAsk - bestBid) : null;
  const spreadPct = mid ? spread / mid : null;
  return { bids, asks, bestBid, bestAsk, mid, spread, spreadPct };
}
