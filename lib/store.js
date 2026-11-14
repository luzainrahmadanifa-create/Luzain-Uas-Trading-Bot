// Penyimpanan state & log. Filesystem Vercel tidak permanen, jadi:
//  - Produksi : Upstash Redis (Vercel Marketplace) via REST, tanpa dependensi.
//  - Lokal    : filesystem (untuk replay/backtest).
// Tidak ada secret yang ditulis ke log.
import { promises as fs } from 'node:fs';
import path from 'node:path';

const STATE_KEY = 'uas:state';

function upstashConfigured(env = process.env) {
  return Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
}

/**
 * Kirim satu perintah ke Upstash REST.
 * Memakai POST body (bukan command di URL) karena state berisi cache metadata
 * /api/pairs ~40 KB; kalau dikirim lewat URL akan ditolak (URL terlalu panjang).
 * Retry 3x untuk error jaringan/5xx.
 */
async function upstash(command, env = process.env) {
  const base = env.UPSTASH_REDIS_REST_URL.replace(/\/$/, '');
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(base, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify(command),
        signal: AbortSignal.timeout(10000)
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`upstash HTTP ${res.status}: ${text.slice(0, 160)}`);
      const data = JSON.parse(text);
      if (data && data.error) throw new Error(`upstash: ${data.error}`);
      return data;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  throw lastErr;
}

function localDir(env = process.env) {
  return path.resolve(env.LOCAL_STORE_DIR || './logs/local');
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function localAppend(kind, line, env) {
  const dir = localDir(env);
  await ensureDir(dir);
  await fs.appendFile(path.join(dir, `${kind}.jsonl`), line + '\n', 'utf8');
}

async function localRead(kind, env) {
  const file = path.join(localDir(env), `${kind}.jsonl`);
  try {
    const txt = await fs.readFile(file, 'utf8');
    return txt.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

export function storageMode(env = process.env) {
  return upstashConfigured(env) ? 'upstash' : 'local';
}

export async function getState(defaults = {}, env = process.env) {
  if (upstashConfigured(env)) {
    const r = await upstash(['GET', STATE_KEY], env);
    return r.result ? { ...defaults, ...JSON.parse(r.result) } : { ...defaults };
  }
  try {
    const txt = await fs.readFile(path.join(localDir(env), 'state.json'), 'utf8');
    return { ...defaults, ...JSON.parse(txt) };
  } catch (e) {
    if (e.code === 'ENOENT') return { ...defaults };
    throw e;
  }
}

export async function setState(state, env = process.env) {
  const payload = JSON.stringify(state);
  if (upstashConfigured(env)) {
    await upstash(['SET', STATE_KEY, payload], env);
    return;
  }
  const dir = localDir(env);
  await ensureDir(dir);
  await fs.writeFile(path.join(dir, 'state.json'), JSON.stringify(state, null, 2), 'utf8');
}

/** Tambah satu baris log (JSONL). */
export async function appendLog(kind, obj, env = process.env) {
  const line = JSON.stringify(obj);
  if (upstashConfigured(env)) {
    await upstash(['RPUSH', `uas:log:${kind}`, line], env);
    return;
  }
  await localAppend(kind, line, env);
}

export async function readLog(kind, env = process.env) {
  if (upstashConfigured(env)) {
    const r = await upstash(['LRANGE', `uas:log:${kind}`, '0', '-1'], env);
    return (r.result || []).map((l) => JSON.parse(l));
  }
  return localRead(kind, env);
}

/** Guard idempotency: satu candle hanya diproses sekali per pasangan. */
export function candleAlreadyProcessed(state, pairId, candleTime) {
  const last = state.lastCandle?.[pairId] ?? 0;
  return last >= candleTime;
}

export function markCandleProcessed(state, pairId, candleTime) {
  state.lastCandle = state.lastCandle || {};
  state.lastCandle[pairId] = candleTime;
}
