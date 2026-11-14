# UAS Algorithmic Trading — Bot Dry Run Indodax

**Nama:** Luzain Rahmadani F A  
**NIM:** 25110200048  
**Kelas:** Trad1  
**Dosen:** Pak Dwi  
**Mata kuliah:** Algorithmic Trading

Bot trading **dry run** (tanpa uang asli, tanpa API key, hanya API publik Indodax) yang menjalankan strategi trend-following hasil adaptasi UTS, lengkap dengan backtest 3 tahun, replay jendela forward, dashboard offline, dan audit hitung ulang dari log mentah.

<!-- STATUS_START -->
> **Status jujur:** backtest 3 tahun **selesai** dan dapat dihitung ulang. Forward test live **belum berjalan** karena mesin penyusunan tidak memiliki akun/kredensial Vercel; yang ada baru uji lokal (3 panggilan tick, 0 trade). Tidak ada satu pun angka forward yang dikarang. Kode dan langkah deploy sudah siap.
<!-- STATUS_END -->

## 0. Link pengumpulan

<!-- DEPLOY_LINKS_START -->
| Item | Nilai |
|---|---|
| Repo GitHub | _belum diisi_ |
| Commit hash | _belum diisi_ |
| URL Vercel | _belum diisi_ |
| Dashboard live | _belum diisi_ |
| Dicatat pada | _belum diisi_ |
<!-- DEPLOY_LINKS_END -->

Isi tabel di atas otomatis dengan:

```bash
node scripts/record_deploy.mjs --repo https://github.com/<user>/<repo> --commit <hash> --url https://<project>.vercel.app
```

---

## 1. Ringkasan hasil

Periode backtest: **5 November 2023 11.00 WIB → 5 November 2026 11.00 WIB** (berhenti tepat sebelum freeze date, 6.576 bar 4 jam, 0 gap/duplikat/harga nol).

| Metrik | Nilai |
|---|---|
| Modal awal (virtual) | Rp 100.000.000 |
| Ekuitas akhir | **Rp 144.748.539** |
| Return total (3 tahun) | **+44,75%** |
| CAGR | **+13,12%** |
| Max drawdown | **−21,22%** |
| Profit factor | **1,42** |
| Jumlah trade | **252** |
| Win rate | **26,19%** (66 menang / 186 rugi) |
| Rata-rata trade menang | **+12,01%** |
| Rata-rata trade rugi | **−2,72%** |
| Porsi biaya dari laba kotor | **17,45%** (fee Rp 21.211.885 + spread/slippage Rp 5.062.952) |
| Benchmark BTC/IDR buy & hold | **+163,46%**, MDD −49,21% |

**Strategi tidak mengalahkan BTC dalam return.** Keunggulannya adalah drawdown jauh lebih dangkal dan eksposur maksimum 60% (4 posisi × 15%). Ini dilaporkan apa adanya, bukan dibingkai sebagai kemenangan.

**Forward test:** jendela resmi 5 Nov 2026 12.00 WIB → 19 Nov 2026 12.00 WIB. Pada saat ZIP ini disusun (14 Nov 2026) jendela sudah berjalan ~64%, tetapi **belum ada deployment**; log terakhir berasal dari uji lokal 14 Nov 2026. Replay backtest pada jendela yang sama (data tersedia sampai 14 Nov, 54 candle 4 jam) menghasilkan 0 trade dan BTC −15,52%; ini pembanding, **bukan** hasil live.

---

## 2. Strategi (ringkas)

Long-only, timeframe **4 jam**, universe 5 pasangan IDR: **BTC, ETH, XRP, DOGE, SOL**.

**Entry** (semua harus benar pada candle tertutup):
1. Golden cross EMA 9 ke atas EMA 21.
2. Close > EMA 50.
3. EMA 50 sekarang > EMA 50 enam bar lalu (slope filter).
4. ATR14 / close ≤ 6% (filter volatilitas ekstrem).
5. Turnover 24 jam ≥ Rp 250 juta (filter likuiditas point-in-time).
6. Slot posisi < 4, daily loss limit belum tersentuh, kill switch mati, spread ≤ 2%.

**Exit:** trailing stop `close − 3 × ATR14` (hanya naik / ratchet) **atau** death cross EMA 9 ke bawah EMA 21.

**Sizing & risiko:** maksimum 4 posisi, 15% ekuitas berjalan per posisi, minimum order Rp 25.000, daily loss limit 3% dari ekuitas anchor 00.00 WIB, kill switch (env/state), retry 3× dengan backoff. Tidak ada short, margin, atau leverage.

Aturan lengkap dan perbandingan dengan UTS ada di [`strategy.md`](./strategy.md).

---

## 3. Struktur proyek

```
api/
  tick.js          # endpoint utama: data → validasi → sinyal → risiko → order simulasi → log
  dashboard.js     # dashboard server-rendered untuk Vercel (+ ?json=1)
  admin.js         # kill switch manual tanpa deploy ulang (CRON_SECRET)
lib/
  config.js        # SATU sumber parameter yang dibekukan
  indicators.js    # EMA, ATR, helper
  strategy.js      # computeSignals(): dipakai bot DAN backtest
  indodax.js       # klien API publik + timeout/retry
  execution.js     # fill order book + model biaya backtest
  risk.js          # daily loss, batas posisi, sizing, kill switch
  store.js         # Upstash Redis (produksi) / filesystem (lokal)
  metrics.js       # metrik bersama
scripts/
  select_universe.mjs   fetch_history.mjs      fetch_instruments.mjs
  snapshot_orderbook.mjs measure_costs.mjs     backtest.mjs
  run_variants.mjs       replay_forward.mjs    hitung_ulang.mjs
  freeze.mjs             build_dashboard.mjs    export_logs.mjs
  run_pipeline.mjs       serve_api.mjs          serve_dashboard.mjs
  dashboard/             # template, CSS, JS, pembuat grafik, section
data/
  freeze.json      # bukti pembekuan: waktu, parameter, SHA-256 file
  universe.json    # audit pemilihan universe point-in-time
  costs.json       # spread & slippage terukur dari order book
  instruments.json # fee & minimum order dari /api/pairs
  backtest/        # summary.json, trades.csv, equity_daily.csv, benchmark_daily.csv, signals.csv
  forward_replay/  # replay jendela forward (pembanding, bukan live)
  variants.json    # uji ketahanan parameter
  candles/         # candle 4 jam mentah + quality.json
logs/
  local/           # uji lokal (bukan produksi)
  export/          # log produksi setelah diekspor
dashboard/
  UAS_25110200048_LuzainRahmadaniFA.html  # dashboard offline mandiri
```

---

## 4. Menjalankan dari nol

Prasyarat: **Node.js ≥ 20**, tanpa dependensi npm.

```bash
# 1. Universe point-in-time (turnover 30 hari yang berakhir 1 Nov 2023)
node scripts/select_universe.mjs

# 2. Candle asli Indodax, timeframe 4 jam
node scripts/fetch_history.mjs --tf 240 --from 2023-10-15 --to 2026-11-14

# 3. Instrumen: fee taker, minimum order, tick size
node scripts/fetch_instruments.mjs

# 4. Ukur spread & slippage dari order book publik
#    (jalankan beberapa kali sehari saat persiapan)
node scripts/snapshot_orderbook.mjs
node scripts/measure_costs.mjs

# 5. Backtest 3 tahun + uji ketahanan parameter
node scripts/backtest.mjs
node scripts/run_variants.mjs

# 6. Replay jendela forward (pembanding, BUKAN forward live)
node scripts/replay_forward.mjs

# 7. Hitung ulang semua metrik dari log mentah + audit konsistensi
node scripts/hitung_ulang.mjs

# 8. Bangun dashboard offline satu file
node scripts/build_dashboard.mjs
```

Atau jalankan seluruh pipeline yang tidak membutuhkan keputusan manual:

```bash
node scripts/run_pipeline.mjs
```

Hasil utama:

- `data/recomputed.json` — semua metrik hasil hitung ulang + 6 cek konsistensi.
- `dashboard/UAS_25110200048_LuzainRahmadaniFA.html` — dashboard offline, tanpa CDN.
- `data/backtest/` — CSV mentah yang bisa diaudit.

### Menjalankan bot secara lokal

```bash
# Terminal 1: API lokal (tick, dashboard, admin)
CRON_SECRET=rahasia-lokal node scripts/serve_api.mjs 3000
# Windows PowerShell: $env:CRON_SECRET="rahasia-lokal"; node scripts/serve_api.mjs 3000

# Terminal 2: panggil tick
curl -H "Authorization: Bearer rahasia-lokal" http://127.0.0.1:3000/api/tick

# Dashboard
# http://127.0.0.1:3000/api/dashboard
```

Hasil tick ditulis ke `logs/local/` (state + JSONL). Jalankan `node scripts/hitung_ulang.mjs` lagi setelahnya.

Dashboard offline bisa dilihat tanpa server: buka file HTML-nya langsung, atau `node scripts/serve_dashboard.mjs 4173` lalu buka `http://127.0.0.1:4173/`.

---

## 5. Deploy ke Vercel (belum dilakukan)

Panduan lengkap, termasuk tes 401/200, Upstash, kill switch, penjadwal, dan troubleshooting ada di **[`DEPLOY.md`](./DEPLOY.md)**. Ringkasnya:

1. Push repo ke GitHub.
2. Import repo di Vercel (Framework Preset: `Other`), isi env `CRON_SECRET` dan `KILL_SWITCH=0`.
3. Tambahkan **Upstash Redis** dari tab Storage Vercel, hubungkan ke project, lalu **redeploy**.
4. Uji `/api/tick` tanpa secret (harus 401) dan dua kali dengan secret (harus 200, tidak dobel).
5. Aktifkan GitHub Actions: secrets `VERCEL_URL` + `CRON_SECRET`, jalankan workflow `tick` manual sekali.
6. Catat link dan hash dengan `node scripts/record_deploy.mjs --repo ... --commit ... --url ...`.

<!-- DEPLOY_STATUS_START -->
**Yang belum ada di mesin penyusunan:** akun/kredensial Vercel dan git. Karena itu belum ada URL live dan belum ada commit hash. Bukti pembekuan memakai SHA-256 file di `data/freeze.json`.
<!-- DEPLOY_STATUS_END -->

---

## 6. Forward test: protokol dan status

- **Freeze date:** Kamis, 5 November 2026, 12.00 WIB (sesuai PDF).
- **Jendela forward:** 5 Nov 12.00 WIB → 19 Nov 12.00 WIB (14 hari).
- Aturan, parameter, universe, dan kode tidak diubah selama jendela. Perubahan hanya boleh berupa bug fix yang tidak mengubah sinyal/risiko, dan dicatat di README.
- Metrik forward: return, MDD, PF, win rate, avg win/loss, jumlah trade, porsi biaya — **CAGR tidak ditampilkan** untuk jendela 14 hari karena tidak bermakna.
- Perbandingan dilakukan pada jendela yang sama dengan replay backtest, lalu selisihnya didekomposisi menjadi: perbedaan sinyal, harga fill (spread/slippage), keterlambatan cron, dan downtime/error API.

**Status saat ini (14 Nov 2026):** belum ada deployment. Log di `logs/local/` adalah uji lokal 7 Nov dan 14 Nov 2026: 3 panggilan, 0 trade. Kecocokan sinyal yang sudah teruji: **10/10 pair-candle cocok (100%)**, tetapi cakupan baru 3,7% (2 candle × 5 pair vs 54 candle × 5 pair).

Setelah 19 Nov:

```bash
UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... node scripts/export_logs.mjs
node scripts/replay_forward.mjs --from 2026-11-05T04:00:00Z --to 2026-11-19T05:00:00Z
node scripts/hitung_ulang.mjs
node scripts/build_dashboard.mjs
```

---

## 7. Sumber data & biaya

- **Candle:** `https://indodax.com/tradingview/history_v2` (timeframe 240), diunduh ulang 14 Nov 2026. Kualitas: 6.757 bar/pair (rentang 15 Okt 2023 – 14 Nov 2026), 0 gap, 0 duplikat, 0 harga nol pada jendela indikator.
- **Fee taker:** `https://indodax.com/api/pairs` = 0,20% (diakses 7 Nov 2026); halaman resmi `help.indodax.com` (Rincian Biaya Transaksi) juga 0,20%. Dipakai angka yang lebih mahal.
- **Minimum order:** API mencantumkan Rp 10.000; kode memakai **Rp 25.000** (mode Pro) agar lebih ketat.
- **Spread & slippage:** diukur dari `/api/depth` untuk order referensi Rp 25.000.000, 3 putaran snapshot pada 7 Nov 2026. Nilai (bps): BTC 0,007/2,07 · ETH 2,467/4,985 · XRP 3,349/2,146 · DOGE 15,396/0 · SOL 10,49/0. Keterbatasan: hanya satu hari pengamatan.
- **Benchmark:** BTC/IDR buy & hold, biaya 0,20%/sisi, periode yang sama.

Tidak ada API key, tidak ada endpoint privat, tidak ada uang asli.

---

## 8. Keamanan

- `/api/tick` dan `/api/admin` wajib `Authorization: Bearer $CRON_SECRET` (atau header `x-cron-secret`). Tanpa secret → HTTP 401.
- `.env` di-`.gitignore`; yang dikumpulkan hanya `.env.example` tanpa nilai rahasia.
- Log tidak menulis token, URL Redis, atau isi environment.
- Dashboard publik hanya membaca; tidak menerima perintah.
- Kill switch dapat diaktifkan lewat `POST /api/admin` tanpa deploy ulang, dan setiap perubahan dicatat di `killswitch.jsonl`.
- Parameter strategi tidak dibaca dari env, sehingga tidak bisa diubah diam-diam saat forward test.

---

## 9. Audit & integritas

`node scripts/hitung_ulang.mjs` membaca CSV/JSONL mentah dan menghitung ulang semua metrik, lalu membandingkannya dengan `summary.json`. Hasil terakhir: **6/6 cek konsistensi lolos**. `data/freeze.json` mencatat SHA-256 dari 8 file inti pada saat pembekuan; dashboard menampilkan apakah hash `lib/config.js` masih cocok.

Angka di dashboard **tidak diketik manual**. Semuanya berasal dari `data/recomputed.json` dan file mentah di `data/` + `logs/`.

### Keterbatasan yang diakui

1. Pemilihan parameter memakai data in-sample 2023–2026; belum ada out-of-sample murni. Backtest final dipotong sebelum freeze, tetapi eksplorasi varian melihat data hingga 7 Nov.
2. Snapshot order book hanya satu hari (3 putaran).
3. Eksekusi dry run mengasumsikan fill langsung pada level book; partial fill/antrean tidak dimodelkan.
4. Forward test live belum berjalan dan belum ada bukti uptime produksi.
5. Tidak ada commit hash karena git tidak tersedia; bukti memakai hash file.

---

## 10. Deliverable

- Source code lengkap (folder ini).
- `README.md` (dokumen ini), `strategy.md`, dan `DEPLOY.md` (panduan deploy Vercel).
- `data/freeze.json` — parameter beku + SHA-256.
- Log mentah: `data/backtest/`, `data/forward_replay/`, `logs/local/`.
- `scripts/hitung_ulang.mjs` — skrip hitung ulang.
- `dashboard/UAS_25110200048_LuzainRahmadaniFA.html` — dashboard offline mandiri.
- `.env.example` — tanpa secret.
- Refleksi lengkap ada di tab **Refleksi** dashboard.

---

## 11. Pernyataan integritas

Saya tidak memalsukan hasil forward test, tidak memakai data acak sebagai pengganti data Indodax, dan tidak mengetik angka dashboard secara manual. Hasil yang buruk atau belum lengkap dilaporkan apa adanya. Semua angka dapat ditelusuri ke file di `data/` dan `logs/`, lalu dihitung ulang dengan `scripts/hitung_ulang.mjs`.
