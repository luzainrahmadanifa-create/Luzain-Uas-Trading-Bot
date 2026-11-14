// =====================================================================
// /api/dashboard - halaman dashboard di Vercel (server-rendered).
// Membaca data/recomputed.json (hasil hitung ulang) + state & log live.
// Tidak menerima perintah, tidak menulis apa pun, tidak memuat secret.
//   GET /api/dashboard          -> HTML
//   GET /api/dashboard?json=1   -> JSON ringkas (untuk audit)
// =====================================================================
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../lib/config.js';
import { getState, readLog, storageMode } from '../lib/store.js';

const IDENTITY = {
  name: 'Luzain Rahmadani F A',
  nim: '25110200048',
  kelas: 'Trad1',
  dosen: 'Pak Dwi'
};
const FWD_START = '2026-11-05T12:00:00+07:00';
const FWD_END = '2026-11-19T12:00:00+07:00';

const nf0 = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function idr(v) {
  return v === null || v === undefined || !Number.isFinite(Number(v)) ? 'n/a' : 'Rp ' + nf0.format(Math.round(Number(v)));
}
function pct(v, d = 2) {
  return v === null || v === undefined || !Number.isFinite(Number(v)) ? 'n/a' : (Number(v) >= 0 ? '+' : '') + Number(v).toFixed(d) + '%';
}
function pctRaw(v, d = 2) {
  return v === null || v === undefined || !Number.isFinite(Number(v)) ? 'n/a' : Number(v).toFixed(d) + '%';
}
function num(v, d = 0) {
  return v === null || v === undefined || !Number.isFinite(Number(v)) ? 'n/a' : nf2.format(Number(v));
}
function dateWib(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('id-ID', {
      timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }).replace(/\./g, ':') + ' WIB';
  } catch { return String(iso); }
}
function cls(v) { return Number(v) > 0 ? 'pos' : (Number(v) < 0 ? 'neg' : ''); }

async function readJson(rel, fallback = null) {
  try { return JSON.parse(await fs.readFile(path.join(process.cwd(), rel), 'utf8')); }
  catch { return fallback; }
}

function card(title, sub, body) {
  return '<section class="card"><h2>' + esc(title) + '</h2>' + (sub ? '<p class="sub">' + esc(sub) + '</p>' : '') + body + '</section>';
}
function kpi(label, value, hint, tone = '') {
  return '<div class="kpi"><div class="label">' + esc(label) + '</div><div class="value ' + tone + '">' + value + '</div><div class="hint">' + hint + '</div></div>';
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'method not allowed' });
    return;
  }

  try {
    const rec = await readJson('data/recomputed.json');
    const freeze = await readJson('data/freeze.json', {});
    if (!rec || !rec.backtest) {
      res.status(503).setHeader('Content-Type', 'text/html; charset=utf-8').send(
        '<!doctype html><meta charset="utf-8"><title>Dashboard belum siap</title>' +
        '<body style="font-family:system-ui;background:#070d19;color:#e7eefc;padding:40px">' +
        '<h1>Dashboard belum siap</h1><p><code>data/recomputed.json</code> tidak ditemukan di bundle fungsi. ' +
        'Jalankan <code>node scripts/hitung_ulang.mjs</code> lalu deploy ulang.</p></body>'
      );
      return;
    }

    const state = await getState({}, process.env);
    const [calls, equityLog, orders, errors, killLog] = await Promise.all([
      readLog('calls').catch(() => []),
      readLog('equity').catch(() => []),
      readLog('orders').catch(() => []),
      readLog('errors').catch(() => []),
      readLog('killswitch').catch(() => [])
    ]);

    const nowMs = Date.now();
    const fStart = Date.parse(FWD_START);
    const fEnd = Date.parse(FWD_END);
    const progressPct = Math.max(0, Math.min(100, ((nowMs - fStart) / (fEnd - fStart)) * 100));
    const daysElapsed = Math.max(0, (nowMs - fStart) / 86400000);

    const bt = rec.backtest;
    const fwd = rec.forward || { equity: {} };
    const fwEq = fwd.equity || {};
    const bench = rec.benchmark || {};
    const checks = rec.checks || [];
    const checksPass = checks.filter((x) => x.ok === true).length;
    const liveMode = storageMode() === 'upstash';
    const hasLiveCalls = liveMode && calls.length > 0;

    const payload = {
      generatedAt: new Date().toISOString(),
      identity: IDENTITY,
      strategyVersion: CONFIG.version,
      frozenAt: CONFIG.frozenAt,
      storage: storageMode(),
      checks: { passed: checksPass, total: checks.length },
      backtest: {
        returnPct: bt.totalReturnPct, cagrPct: bt.cagrPct, mddPct: bt.mddPct,
        trades: bt.trades, winRate: bt.winRate, profitFactor: bt.profitFactor,
        costSharePct: bt.costSharePct, start: bt.start, end: bt.end
      },
      benchmark: { returnPct: bench.returnPct, mddPct: bench.mddPct },
      forward: {
        sourceDir: fwd.sourceDir || null,
        calls: calls.length, trades: fwd.trades ?? 0, orders: orders.length,
        returnPct: fwEq.totalReturnPct ?? null, mddPct: fwEq.mddPct ?? null,
        firstCall: calls[0]?.ts ?? null, lastCall: calls[calls.length - 1]?.ts ?? null,
        uptimePct: fwd.uptimePct ?? null, apiErrors: errors.length,
        killSwitchCalls: killLog.length
      },
      ops: {
        progressPct, daysElapsed,
        runCount: state.runCount ?? 0,
        lastRunAt: state.lastRunAt ?? null,
        killSwitch: state.killSwitch === true,
        dailyLossTripped: state.dailyLossTripped === true,
        openPositions: Object.keys(state.positions || {}).length,
        cash: state.cash ?? null
      },
      replay: rec.replay || null,
      gap: rec.gap || null
    };

    if (String(new URL(req.url, 'http://localhost').searchParams.get('json') || '') === '1') {
      res.status(200).json(payload);
      return;
    }

    const banner = hasLiveCalls
      ? '<div class="banner warn"><b>Forward test live berjalan.</b> ' + num(calls.length) + ' panggilan tercatat sejak ' + esc(dateWib(calls[0]?.ts)) + '. Hasil belum final.</div>'
      : '<div class="banner bad"><b>Forward test live belum berjalan.</b> Halaman ini menampilkan hasil backtest dan status storage. Log live akan muncul otomatis setelah bot di-deploy dan dipanggil. Tidak ada angka forward yang dikarang.</div>';

    const html = `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>UAS Algorithmic Trading — ${esc(IDENTITY.name)} (${esc(IDENTITY.nim)})</title>
<style>
:root{--bg:#070d19;--panel:#0e1729;--panel2:#121f36;--line:#22334f;--text:#e7eefc;--muted:#8fa3c4;--accent:#22d3ee;--green:#4ade80;--red:#f87171;--amber:#fbbf24}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(1000px 500px at 10% -10%,rgba(34,211,238,.10),transparent 60%),var(--bg);color:var(--text);font:14px/1.6 system-ui,"Segoe UI",Arial,sans-serif}
.wrap{max-width:1080px;margin:0 auto;padding:0 20px}
header{border-bottom:1px solid var(--line);padding:30px 0 22px;background:linear-gradient(180deg,rgba(18,31,54,.85),transparent)}
.eyebrow{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--accent);font-weight:700}
h1{font-size:clamp(22px,3vw,32px);margin:8px 0 6px;letter-spacing:-.5px}
.meta{color:var(--muted);font-size:12.5px}
.banner{margin:22px 0;padding:13px 16px;border-radius:12px;font-size:13px;border:1px solid}
.banner.warn{border-color:rgba(245,158,11,.4);background:rgba(245,158,11,.08);color:#fcd34d}
.banner.bad{border-color:rgba(239,68,68,.4);background:rgba(239,68,68,.08);color:#fca5a5}
.grid{display:grid;gap:14px;grid-template-columns:repeat(4,minmax(0,1fr))}
.kpi,.card{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:14px}
.kpi{padding:14px 15px}.kpi .label{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:700}
.kpi .value{font-size:24px;font-weight:800;letter-spacing:-.6px;margin-top:6px}
.kpi .hint{color:var(--muted);font-size:11.5px;margin-top:5px}
.card{padding:16px 18px;margin-top:16px}.card h2{font-size:16px;margin:0 0 3px}
.sub{color:var(--muted);font-size:12.5px;margin:0 0 12px}
.pos{color:var(--green)}.neg{color:var(--red)}
table{width:100%;border-collapse:collapse;font-size:12.8px}
th,td{padding:8px 10px;border-bottom:1px solid rgba(34,51,79,.8);text-align:left}
th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.06em}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
tr:last-child td{border-bottom:0}
code{font-family:"Cascadia Mono",Consolas,monospace;font-size:12px;background:#0a1424;padding:1px 5px;border-radius:5px}
.badges{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}
.badge{font-size:11px;padding:4px 9px;border-radius:999px;border:1px solid var(--line);color:var(--muted)}
.badge.ok{color:#86efac;border-color:rgba(34,197,94,.35);background:rgba(34,197,94,.1)}
footer{color:var(--muted);font-size:11.5px;border-top:1px solid var(--line);padding:18px 0 30px;margin-top:28px}
@media(max-width:900px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:560px){.grid{grid-template-columns:1fr}}
</style></head><body>
<header><div class="wrap">
<div class="eyebrow">UAS Algorithmic Trading · Bot Dry Run Indodax</div>
<h1>Golden Cross + ATR Trailing Stop — dashboard Vercel</h1>
<div class="meta">${esc(IDENTITY.name)} · NIM ${esc(IDENTITY.nim)} · Kelas ${esc(IDENTITY.kelas)} · Dosen: ${esc(IDENTITY.dosen)}<br>
Strategi v${esc(CONFIG.version)} · beku ${esc(dateWib(CONFIG.frozenAt))} · storage: <code>${esc(storageMode())}</code> · dibuat ${esc(dateWib(payload.generatedAt))}</div>
</div></header>
<main class="wrap">
${banner}
<div class="grid">
${kpi('Return backtest', pct(bt.totalReturnPct), '3 tahun, sesudah biaya', bt.totalReturnPct >= 0 ? 'pos' : 'neg')}
${kpi('CAGR', pct(bt.cagrPct), num(bt.periodDays ?? rec.backtest.days) + ' hari', bt.cagrPct >= 0 ? 'pos' : 'neg')}
${kpi('Max drawdown', pct(bt.mddPct), 'BTC ' + pct(bench.mddPct), 'neg')}
${kpi('Profit factor', num(bt.profitFactor, 2), num(bt.trades) + ' trade · win ' + pctRaw(bt.winRate), '')}
${kpi('Porsi biaya', pctRaw(bt.costSharePct), 'fee + spread + slippage', '')}
${kpi('Benchmark BTC', pct(bench.returnPct), 'buy & hold periode sama', bench.returnPct >= 0 ? 'pos' : 'neg')}
${kpi('Forward live', pct(fwEq.totalReturnPct), num(calls.length) + ' panggilan · ' + num(fwd.trades ?? 0) + ' trade', '')}
${kpi('Progress forward', num(progressPct, 0) + '%', num(daysElapsed, 1) + ' / 14 hari', '')}
</div>

${card('Audit & status', 'Angka backtest berasal dari data/recomputed.json; angka forward dari state/log live.',
  '<table><tbody>' +
  '<tr><td>Hitung ulang dari log mentah</td><td class="num"><b>' + checksPass + ' / ' + checks.length + ' cek lolos</b></td></tr>' +
  '<tr><td>Freeze date</td><td class="num">' + esc(dateWib(CONFIG.frozenAt)) + '</td></tr>' +
  '<tr><td>Commit git beku</td><td class="num">' + esc(freeze?.git?.commit || 'belum tersedia (lihat data/freeze.json)') + '</td></tr>' +
  '<tr><td>Kill switch</td><td class="num">' + (state.killSwitch === true ? '<b style="color:#fca5a5">AKTIF</b>' : 'mati') + '</td></tr>' +
  '<tr><td>Daily loss limit tersentuh</td><td class="num">' + (state.dailyLossTripped === true ? 'ya' : 'tidak') + '</td></tr>' +
  '<tr><td>Posisi terbuka</td><td class="num">' + num(Object.keys(state.positions || {}).length) + '</td></tr>' +
  '<tr><td>Kas</td><td class="num">' + idr(state.cash) + '</td></tr>' +
  '<tr><td>Panggilan tick terakhir</td><td class="num">' + esc(dateWib(state.lastRunAt)) + '</td></tr>' +
  '<tr><td>Error API</td><td class="num">' + num(errors.length) + '</td></tr>' +
  '</tbody></table>')}

${card('Jendela forward test', 'Sesuai PDF: freeze 5 Nov 2026 12.00 WIB, forward 14 hari sampai 19 Nov 2026 12.00 WIB.',
  '<table><tbody>' +
  '<tr><td>Mulai</td><td class="num">' + esc(dateWib(FWD_START)) + '</td></tr>' +
  '<tr><td>Selesai</td><td class="num">' + esc(dateWib(FWD_END)) + '</td></tr>' +
  '<tr><td>Replay backtest (bukan live)</td><td class="num">' + pct(rec.replay?.totalReturnPct) + ' · ' + num(rec.replay?.trades) + ' trade</td></tr>' +
  '<tr><td>Gap forward vs replay</td><td class="num">' + pct(rec.gap?.diffPct) + ' pp</td></tr>' +
  '</tbody></table>' +
  '<p class="sub" style="margin-top:10px">CAGR tidak ditampilkan untuk jendela 14 hari karena tidak bermakna. Dashboard offline lengkap ada di <code>dashboard/UAS_25110200048_LuzainRahmadaniFA.html</code>.</p>')}

${card('Cara membaca', 'Tidak ada hasil yang dikarang.',
  '<ul style="margin:0;padding-left:18px;color:var(--muted);font-size:13px">' +
  '<li>Backtest memakai candle asli Indodax dan berhenti sebelum freeze date.</li>' +
  '<li>Biaya = fee taker 0,20%/sisi + setengah spread + slippage terukur.</li>' +
  '<li>Strategi tidak mengalahkan BTC dalam return; keunggulannya drawdown lebih dangkal. Ini dilaporkan apa adanya.</li>' +
  '<li>Forward live baru sah setelah bot di-deploy dan berjalan 14 hari penuh.</li>' +
  '</ul>')}

<div class="badges">
<span class="badge ok">DRY RUN — tanpa uang asli</span>
<span class="badge">API publik, tanpa API key</span>
<span class="badge">Long-only</span>
<span class="badge">CRON_SECRET</span>
<span class="badge">Idempoten per candle</span>
</div>
</main>
<footer><div class="wrap">UAS Algorithmic Trading · ${esc(IDENTITY.name)} · ${esc(IDENTITY.nim)} · Kelas ${esc(IDENTITY.kelas)} · dashboard server-rendered dari data + log, bukan angka manual.</div></footer>
</body></html>`;

    res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(html);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
