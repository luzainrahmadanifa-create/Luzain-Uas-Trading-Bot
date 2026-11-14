// =====================================================================
// KONFIGURASI STRATEGI - DIBEKUKAN (FROZEN)
// File ini adalah satu-satunya sumber parameter untuk BOT dan BACKTEST.
// Jangan ubah setelah freeze date. Perubahan harus lewat commit baru
// yang tercatat di README (dan akan menggugurkan komponen kecocokan).
// =====================================================================

export const CONFIG = Object.freeze({
  version: '1.0.0',
  // Freeze date resmi sesuai PDF: Kamis, 5 November 2026, 12.00 WIB.
  frozenAt: '2026-11-05T12:00:00+07:00', // dicatat juga di data/freeze.json
  timezone: 'Asia/Jakarta',

  // --- Data & timeframe ---
  timeframe: '240',         // 4 jam. tf yang didukung API: 1,15,30,60,240,1D
  tfMinutes: 240,
  candleLimit: 400,         // bar yang diambil bot tiap tick (cukup untuk EMA50 + ATR14)
  staleMultiplier: 2,       // data dianggap basi bila candle tertutup > 2x timeframe

  // --- Universe (hasil seleksi likuiditas point-in-time, lihat data/universe.json) ---
  // Diisi oleh scripts/select_universe.mjs. 3-10 pasangan IDR.
  universe: [
    { symbol: 'BTCIDR', pairId: 'btcidr', label: 'BTC/IDR' },
    { symbol: 'ETHIDR', pairId: 'ethidr', label: 'ETH/IDR' },
    { symbol: 'XRPIDR', pairId: 'xrpidr', label: 'XRP/IDR' },
    { symbol: 'DOGEIDR', pairId: 'dogeidr', label: 'DOGE/IDR' },
    { symbol: 'SOLIDR', pairId: 'solidr', label: 'SOL/IDR' }
  ],

  // --- Indikator (trend following, adaptasi dari strategi UTS) ---
  emaFast: 9,
  emaSlow: 21,
  emaTrend: 50,
  atrPeriod: 14,
  atrMult: 3.0,
  maxAtrPct: 0.06,          // filter volatilitas ekstrem: ATR/close <= 6%
  trendSlopeBars: 6,        // 0 = nonaktif; >0 = EMA50 harus naik dibanding N bar lalu

  // --- Filter likuiditas (point-in-time, dihitung dari candle) ---
  minTurnover24hIdr: 250_000_000, // Rp250 juta turnover 24 bar terakhir

  // --- Sizing & portofolio ---
  startingEquityIdr: 100_000_000,
  maxPositions: 4,
  allocPctPerPosition: 0.15,      // maksimum 15% ekuitas berjalan per posisi
  minOrderIdr: 25_000,            // aturan lebih ketat dari trade_min (Rp10.000)
  minOrderSource: 'https://indodax.com (mode Pro, min Rp25.000) + /api/pairs trade_min_base_currency=Rp10.000; dipakai yang lebih ketat',

  // --- Biaya ---
  // Fee taker all-in. Sumber:
  //  - /api/pairs trade_fee_percent_taker = 0.2 (akses 2026-11-07)
  //  - halaman resmi help.indodax.com (Rincian Biaya Transaksi) -> dipakai angka lebih mahal
  feeTakerPct: 0.002,             // 0.20% per sisi (beli & jual)
  feeSource: {
    apiPairs: { value: 0.2, url: 'https://indodax.com/api/pairs', accessed: '2026-11-07' },
    official: { value: 0.2, url: 'https://help.indodax.com (Rincian Biaya Transaksi)', accessed: '2026-11-07' },
    used: 0.2,
    note: 'Dipakai angka yang lebih mahal dari kedua sumber. Fee taker all-in termasuk pajak.'
  },

  // --- Risk management ---
  dailyLossLimitPct: 0.03,        // 3% dari ekuitas anchor 00:00 WIB
  maxSpreadPct: 0.02,             // tolak entry bila spread bid-ask > 2%

  // --- Eksekusi ---
  orderBookLevels: 25,
  retry: { attempts: 3, baseDelayMs: 500, timeoutMs: 12_000 },
  apiBase: 'https://indodax.com',
  apiRateLimitPerSec: 3,

  // --- Backtest ---
  // Tepat 3 tahun dan BERHENTI SEBELUM freeze date (5 Nov 2026 12.00 WIB).
  // Bar 4 jam terakhir yang tertutup sebelum freeze adalah bar 00:00Z
  // (tutup 04:00Z = 11.00 WIB), jadi data setelah freeze tidak masuk backtest.
  backtestStart: '2023-11-05T04:00:00Z',
  backtestEnd: '2026-11-05T03:59:59Z',
  benchmarkSymbol: 'BTCIDR'
});

export const TF_SECONDS = {
  '1': 60, '15': 900, '30': 1800, '60': 3600, '240': 14400, '1D': 86400
};
