# Checklist Kepatuhan — Soal UAS Bot Dry Run Indodax

Dokumen ini memetakan setiap ketentuan PDF ke bukti di dalam ZIP. Status ditulis apa adanya; yang belum terpenuhi tidak ditutupi.

## A. Tugas inti

| # | Ketentuan PDF | Status | Bukti |
|---|---|---|---|
| 1 | Strategi ditulis lengkap: entry, exit, sizing, semua parameter | **Terpenuhi** | `strategy.md`, `lib/config.js` |
| 2 | Perubahan dari strategi UTS dicatat | **Terpenuhi** | `strategy.md` bagian 10, dashboard tab "Aturan & Perubahan" |
| 3 | Universe 3–10 pasangan IDR likuid | **Terpenuhi** | 5 pasangan: BTC, ETH, XRP, DOGE, SOL — `lib/config.js`, `data/universe.json` |
| 4 | Menghindari survivorship bias (likuiditas di awal periode) | **Terpenuhi** | Turnover 30 hari yang berakhir 1 Nov 2023 — `data/universe_selection.csv`, `data/universe.json` |
| 5 | Backtest minimal 3 tahun, data asli Indodax | **Terpenuhi** | 5 Nov 2023 – 5 Nov 2026, 6.576 bar 4 jam, `data/backtest/` |
| 6 | Fee + spread + slippage hasil pengukuran | **Terpenuhi (dengan batasan)** | Fee 0,20% dari `/api/pairs`; spread/slippage dari 3 snapshot order book — `data/costs.json`, `data/snapshots/` |
| 7 | Bot Vercel mengambil data live, sinyal sama dengan backtest | **Kode siap, belum deploy** | `api/tick.js` + `lib/strategy.js` (fungsi yang sama); uji lokal 3 panggilan |
| 8 | Eksekusi simulasi di bid/ask | **Terpenuhi** | `lib/execution.js` menyapu level order book; `orders.jsonl` mencatat best bid/ask, fill rata-rata, fee |
| 9 | Forward test 2 minggu tanpa perubahan | **Belum berjalan** | Jendela 5–19 Nov 2026; per 14 Nov baru uji lokal, belum ada deployment |
| 10 | Dashboard HTML membandingkan backtest & forward + refleksi | **Terpenuhi (forward = status apa adanya)** | `dashboard/UAS_25110200048_LuzainRahmadaniFA.html`, tab Forward & Refleksi |
| 11 | Long-only, tanpa short/margin/leverage | **Terpenuhi** | `lib/strategy.js`, `lib/risk.js`; hanya BUY lalu SELL aset yang dimiliki |
| 12 | Timeframe 1 jam / 4 jam / harian | **Terpenuhi** | 4 jam (`tf=240`); 1 jam diuji dan ditolak karena fee drag |
| 13 | Hanya API publik, tanpa API key | **Terpenuhi** | `lib/indodax.js`: server_time, pairs, depth, ticker_all, history_v2 |

## B. Data Indodax

| # | Ketentuan | Status | Bukti |
|---|---|---|---|
| 14 | Buang candle yang belum tertutup | **Terpenuhi** | `dropUnclosed()` di `lib/strategy.js`; diuji pada `logs/local/signals.jsonl` |
| 15 | Validasi: data basi > 2× tf, gap, harga/volume nol, book kosong, spread > 2% | **Terpenuhi** | `validateCandles()`, `validateBook()`; `issues` di `signals.jsonl` |
| 16 | Setiap kejadian tidak valid dicatat | **Terpenuhi** | `signals.jsonl` + `errors.jsonl` |
| 17 | Penarikan historis bertahap, maks 3 req/detik, tidak paralel | **Terpenuhi** | `lib/indodax.js` (`rateLimit`, chunk 600 bar), `scripts/fetch_history.mjs` |
| 18 | Penarikan backtest di laptop, bukan fungsi Vercel | **Terpenuhi** | `scripts/fetch_history.mjs`; tidak dipanggil dari `api/tick.js` |

## C. Eksekusi dry run

| # | Ketentuan | Status | Bukti |
|---|---|---|---|
| 19 | Modal awal virtual Rp100.000.000 | **Terpenuhi** | `CONFIG.startingEquityIdr` |
| 20 | Beli di ask, jual di bid; sapu level berikutnya; harga rata-rata | **Terpenuhi** | `simulateBuy` / `simulateSell` di `lib/execution.js` |
| 21 | Dilarang fill di mid/close | **Terpenuhi** | Bot memakai `book.asks` / `book.bids`; backtest memakai open bar berikutnya + biaya |
| 22 | Fee taker all-in, cantumkan dua sumber + tanggal, pakai yang lebih mahal | **Terpenuhi** | `lib/config.js` `feeSource`; `data/instruments.json`; 0,20% |
| 23 | Minimum order Rp25.000 (atau halaman resmi) | **Terpenuhi** | `CONFIG.minOrderIdr = 25000` |
| 24 | Patuhi kenaikan harga & pembulatan kuantitas | **Terpenuhi** | `quantityIncrement`, `priceIncrement` dari `/api/pairs` + `/api/price_increments` |
| 25 | Snapshot order book minimal 3× sehari, median spread/slippage, snapshot mentah ikut | **Sebagian** | 3 putaran pada satu hari (7 Nov 2026), bukan 3× sehari selama berhari-hari — `data/snapshots/`, diakui di refleksi |
| 26 | Posisi terbuka dinilai best bid; equity harian pada panggilan pertama setelah 00.00 WIB | **Terpenuhi** | `api/tick.js` langkah 2–3; `equity.jsonl` |
| 27 | Setiap order mencatat waktu, pair, sisi, qty, best bid/ask, fill rata-rata, fee, selisih vs sinyal | **Terpenuhi** | `orders.jsonl` field `ts, pair, side, qty, bestBid, bestAsk, avgPrice, fee, fillVsSignalPct` |

## D. Risk management

| # | Ketentuan | Status | Bukti |
|---|---|---|---|
| 28 | Batas jumlah posisi dan ukuran maksimum | **Terpenuhi** | Maks 4 posisi, 15% ekuitas — `lib/risk.js`, `CONFIG` |
| 29 | Daily loss limit, berhenti buka posisi sampai hari berikutnya, batas 00.00 WIB | **Terpenuhi** | `ensureDailyAnchor`, `canOpenPosition`; `dayKey` WIB di state |
| 30 | Kill switch manual tanpa deploy ulang, setiap pemakaian tercatat | **Terpenuhi** | `POST /api/admin`, env `KILL_SWITCH`, `killswitch.jsonl` |
| 31 | Timeout, error API, respons kosong, retry terbatas | **Terpenuhi** | `httpJson()` 3 percobaan, backoff, timeout 12 detik; `errors.jsonl` |
| 32 | Idempotency per candle | **Terpenuhi** | `lastCandle[pair]`, `candleAlreadyProcessed`; `signals.jsonl` `newCandle:false` |

## E. Vercel

| # | Ketentuan | Status | Bukti |
|---|---|---|---|
| 33 | Satu endpoint `/api/tick` | **Terpenuhi** | `api/tick.js` |
| 34 | Durasi < 300 detik | **Terpenuhi** | Uji lokal ~5–7 detik; `maxDuration: 60` di `vercel.json` |
| 35 | Penjadwal luar untuk 4 jam | **Siap** | `.github/workflows/tick.yml` tiap jam; `vercel.json` cron harian |
| 36 | State persisten | **Terpenuhi** | `lib/store.js`: Upstash Redis (produksi) / filesystem (lokal) |
| 37 | Endpoint dilindungi `CRON_SECRET` | **Terpenuhi** | 401 tanpa secret (diuji); `/api/tick` dan `/api/admin` |
| 38 | Uji koneksi Indodax dari Vercel | **Belum bisa** | Belum deploy; uji koneksi lokal berhasil |
| 39 | Dashboard di Vercel + HTML offline mandiri | **Sebagian** | HTML offline selesai; `api/dashboard.js` siap tetapi belum deploy |
| 40 | Catat waktu setiap panggilan untuk uptime | **Terpenuhi** | `calls.jsonl`; dashboard menghitung uptime dari slot 4 jam |
| 41 | Secret hanya di env, `.env` di `.gitignore`, `.env.example` tanpa rahasia | **Terpenuhi** | `.gitignore`, `.env.example` |

## F. Jadwal & pengumpulan

| # | Ketentuan | Status | Bukti |
|---|---|---|---|
| 42 | Freeze date 5 Nov 2026 12.00 WIB, dicatat + commit | **Sebagian** | `CONFIG.frozenAt`, `data/freeze.json`; hash file ada, **commit git tidak ada** (git tidak tersedia) |
| 43 | Forward 5–19 Nov tanpa ubah aturan | **Belum berjalan** | Baru uji lokal; tidak ada deployment |
| 44 | ZIP berisi source, README, strategi, commit freeze, log mentah, skrip hitung ulang, dashboard offline, refleksi, `.env.example` | **Terpenuhi kecuali commit hash** | Isi ZIP |
| 45 | Link Vercel aktif + link repo | **Belum ada** | Tidak ada akun/kredensial Vercel di mesin penyusunan. Langkah lengkap ada di `DEPLOY.md` |

## G. Metrik wajib di dashboard

| # | Metrik | Status | Letak |
|---|---|---|---|
| 46 | Backtest: return total, CAGR, MDD | **Ada** | Tab Ringkasan & Backtest |
| 47 | Forward: return total, MDD — **tanpa CAGR** | **Ada** (0,00% dari uji lokal) | Tab Forward; CAGR tidak ditampilkan untuk 14 hari |
| 48 | Profit factor, win rate, avg win, avg loss, jumlah trade | **Ada** | Ringkasan, Backtest, Log Trade |
| 49 | Porsi biaya = (fee + spread + slippage) / laba kotor | **Ada** | 17,45% — tab Backtest |
| 50 | Benchmark BTC/IDR periode sama | **Ada** | Backtest +163,46% (MDD −49,21%); replay forward −15,52% |
| 51 | Gap backtest vs forward pada jendela 14 hari | **Ada, belum final** | Tab Forward; dijelaskan bahwa forward live belum berjalan |
| 52 | Panel operasional: uptime, error API, kill switch | **Ada** | 3 panggilan / 54 slot, uptime 5,6%, 0 error, 0 kill switch |
| 53 | Semua angka bisa dihitung ulang dari log mentah | **Terpenuhi** | `scripts/hitung_ulang.mjs` → `data/recomputed.json`, 6/6 cek lolos |

## H. Rubrik & red flags

| Komponen | Status | Catatan |
|---|---|---|
| Kecocokan backtest–forward 25% | **Sebagian** | Replay 54 candle, bot 10 pair-candle, sinyal 10/10 cocok; forward live belum berjalan |
| Eksekusi realistis & risk 25% | **Kuat** | Fill bid/ask, fee, min order, daily loss, kill switch, idempotency, retry |
| Stabilitas Vercel & log 20% | **Belum dapat dinilai** | Belum deploy; log lokal lengkap |
| Keamanan & kualitas kode 15% | **Kuat** | Tanpa secret, CRON_SECRET, fungsi sinyal sama |
| Dashboard, dokumentasi, refleksi 15% | **Kuat** | `hitung_ulang`, README, strategi, refleksi berangka |

**Red flags yang dicegah:**

- Tidak ada angka forward yang dikarang; forward yang belum berjalan ditulis "belum berjalan".
- Tidak ada data acak; semua candle dari API Indodax.
- Tidak ada angka dashboard yang diketik manual; dashboard dibangun dari `data/recomputed.json`.
- Tidak ada fill di mid/close; bot memakai bid/ask, backtest memakai open bar berikutnya + biaya.
- Parameter dan universe tidak berubah setelah freeze; hash file dicatat.

**Keterbatasan utama yang diakui:** belum deploy ke Vercel, forward live belum berjalan, snapshot order book baru satu hari, dan tidak ada commit git. Semua ini mengurangi nilai komponen terkait dan tidak ditutupi.
