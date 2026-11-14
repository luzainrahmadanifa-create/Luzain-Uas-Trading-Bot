// =====================================================================
// /api/admin - kill switch manual TANPA deploy ulang.
// Dilindungi CRON_SECRET yang sama dengan /api/tick.
//   GET  /api/admin                 -> status singkat
//   POST /api/admin { "killSwitch": true }  -> aktifkan
//   POST /api/admin { "killSwitch": false } -> matikan
// Setiap perubahan dicatat ke log 'killswitch'.
// =====================================================================
import { CONFIG } from '../lib/config.js';
import { getState, setState, appendLog } from '../lib/store.js';

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers['authorization'] || '';
  const headerSecret = req.headers['x-cron-secret'] || '';
  return auth === `Bearer ${secret}` || headerSecret === secret;
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body); } catch { return {}; }
}

function defaults() {
  return {
    startingEquity: CONFIG.startingEquityIdr,
    cash: CONFIG.startingEquityIdr,
    positions: {},
    lastCandle: {},
    runCount: 0,
    killSwitch: false,
    dailyLossTripped: false,
    maxPositions: CONFIG.maxPositions,
    dailyLossLimitPct: CONFIG.dailyLossLimitPct
  };
}

function summary(state) {
  return {
    ok: true,
    killSwitch: state.killSwitch === true,
    envKillSwitch: String(process.env.KILL_SWITCH || '') === '1',
    runCount: state.runCount ?? 0,
    lastRunAt: state.lastRunAt ?? null,
    cash: state.cash ?? null,
    equity: state.lastEquity ?? state.cash ?? null,
    positions: Object.keys(state.positions || {}).length,
    dayKey: state.dayKey ?? null,
    dailyLossTripped: state.dailyLossTripped === true
  };
}

export default async function handler(req, res) {
  if (!authorized(req)) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  try {
    const state = await getState(defaults());

    if (req.method === 'GET') {
      res.status(200).json(summary(state));
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'method not allowed' });
      return;
    }

    const body = parseBody(req);
    if (typeof body.killSwitch !== 'boolean') {
      res.status(400).json({ ok: false, error: 'body harus { "killSwitch": true|false }' });
      return;
    }

    const before = state.killSwitch === true;
    state.killSwitch = body.killSwitch;
    state.killSwitchChangedAt = new Date().toISOString();
    await setState(state);
    await appendLog('killswitch', {
      ts: new Date().toISOString(),
      source: 'admin-api',
      before,
      active: state.killSwitch,
      note: body.note || (state.killSwitch ? 'kill switch diaktifkan manual' : 'kill switch dimatikan manual')
    });

    res.status(200).json({ ...summary(state), changed: before !== state.killSwitch });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
