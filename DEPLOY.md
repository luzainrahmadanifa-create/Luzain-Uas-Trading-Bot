# Panduan Deploy — Vercel + GitHub (dry run Indodax)

Dokumen ini langkah operasional, bukan bagian strategi. Aturan trading **tidak berubah** selama proses ini. Estimasi total: 60–90 menit, sekali jalan.

> **Batas kejujuran:** deploy pada 14–15 Nov berarti forward test live hanya mencakup sebagian jendela resmi (5–19 Nov), bukan 14 hari penuh. Tulis apa adanya di README dan refleksi. Yang dinilai adalah log asli yang bisa dihitung ulang, bukan klaim 14 hari.

---

## 0. Yang harus disiapkan

| Kebutuhan | Gratis? | Catatan |
|---|---|---|
| Akun GitHub | ya | repo boleh publik; kalau privat, undang dosen sebagai collaborator |
| Akun Vercel | ya | paket Hobby cukup |
| Upstash Redis | ya | dibuat dari dalam Vercel (Marketplace), bukan akun terpisah |
| Git + Node.js di laptop | ya | Node ≥ 20 |

**Jangan pernah** menaruh `CRON_SECRET` di README, dashboard, screenshot, atau chat. Nilainya hanya di env Vercel dan secret GitHub Actions.

---

## 1. Pasang Git & Node (sekali saja)

Buka **PowerShell baru**, lalu:

```powershell
winget install --id Git.Git -e --source winget
winget install --id OpenJS.NodeJS.LTS -e --source winget
```

Tutup dan buka lagi PowerShell, lalu cek:

```powershell
git --version
node -v
```

Set identitas commit (pakai email GitHub-mu):

```powershell
git config --global user.name "Luzain Rahmadani F A"
git config --global user.email "email-kamu@example.com"
```

---

## 2. Buat repo GitHub dan push

1. Buka github.com → **New repository** → nama `uas-algo-indodax` → **Create** (jangan centang README/gitignore, kita sudah punya).
2. Di PowerShell, masuk ke folder proyek (yang berisi `package.json`), lalu:

```powershell
cd "C:\Users\HENDRIK KUSBANDONO\Downloads\UAS ALGO\uas-algo-indodax"
git init -b main
git add .
git commit -m "Snapshot beku 5 Nov 2026: bot dry run Indodax + backtest 3 tahun + dashboard"
git remote add origin https://github.com/<USER>/uas-algo-indodax.git
git push -u origin main
```

Kalau `git add .` ikut memasukkan file besar yang tidak perlu, cek dengan `git status`. File `data/variants/*/signals.csv`, `logs/local/`, dan `.env` sudah diabaikan.

**Simpan hash commit pertamanya** (nanti dipakai di langkah 6):

```powershell
git rev-parse HEAD
```

---

## 3. Import ke Vercel

1. Vercel dashboard → **Add New → Project → Import Git Repository** → pilih repo tadi.
2. **Framework Preset:** `Other`. **Root Directory:** biarkan kosong (root repo). Build/Output biarkan default.
3. Sebelum klik Deploy, buka **Environment Variables** dan isi:

| Name | Value |
|---|---|
| `CRON_SECRET` | hasil perintah di bawah |
| `KILL_SWITCH` | `0` |

Buat secret acak:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Salin hasilnya ke `CRON_SECRET` **dan** simpan di password manager. Jangan pakai spasi atau tanda kutip.

4. Klik **Deploy**, tunggu sampai selesai. Catat URL produksi, misalnya `https://uas-algo-indodax.vercel.app`.

---

## 4. Tambahkan Upstash Redis (wajib)

Tanpa ini, state posisi hilang setiap panggilan karena filesystem Vercel sementara.

1. Di project Vercel → tab **Storage** → **Create Database** → **Upstash Redis** → pilih region **Singapore** → paket gratis → **Create**.
2. Klik **Connect Project** → pilih project ini → centang **Production** (dan Preview bila mau) → **Connect**.
3. Vercel otomatis menambahkan `UPSTASH_REDIS_REST_URL` dan `UPSTASH_REDIS_REST_TOKEN`.
4. **Redeploy** supaya env baru terbaca: tab **Deployments** → deployment terakhir → menu `...` → **Redeploy**.

Cek dari laptop (ganti `<URL>` dan `<SECRET>`):

```powershell
$env:CRON = "<SECRET>"
curl.exe -s "https://<URL>/api/dashboard?json=1"
```

Di output JSON harus ada `"storage":"upstash"`. Kalau masih `"local"`, env Upstash belum terbaca — ulangi redeploy.

---

## 5. Uji endpoint (wajib, jangan dilewat)

### 5a. Tanpa secret harus 401

```powershell
curl.exe -i "https://<URL>/api/tick"
```

Harus `HTTP/1.1 401`.

### 5b. Dengan secret harus 200, dua kali

```powershell
curl.exe -s -H "Authorization: Bearer $env:CRON" "https://<URL>/api/tick"
curl.exe -s -H "Authorization: Bearer $env:CRON" "https://<URL>/api/tick"
```

Yang benar:

- Keduanya `"ok": true`, `"errors": []`.
- Panggilan kedua **tidak** membuka posisi ganda untuk candle yang sama (`actions` kosong atau hanya aksi yang memang belum pernah dilakukan).
- `runAt` berbeda, `pairs[].candle` sama.

### 5c. Dashboard hidup

Buka `https://<URL>/api/dashboard` di browser. Panel operasional harus menunjukkan panggilan bertambah dan storage `upstash`.

### 5d. Uji kill switch (sekali, lalu matikan lagi)

```powershell
curl.exe -s -X POST -H "Authorization: Bearer $env:CRON" -H "Content-Type: application/json" -d '{\"killSwitch\":true}' "https://<URL>/api/admin"
curl.exe -s -H "Authorization: Bearer $env:CRON" "https://<URL>/api/admin"
curl.exe -s -X POST -H "Authorization: Bearer $env:CRON" -H "Content-Type: application/json" -d '{\"killSwitch\":false}' "https://<URL>/api/admin"
```

Ini menghasilkan bukti di `killswitch.jsonl` bahwa kill switch bekerja tanpa deploy ulang. Pastikan status akhir **false**.

---

## 6. Penjadwal: GitHub Actions

Vercel Hobby hanya boleh cron 1×/hari (sudah diatur sebagai cadangan pukul 10.20 WIB). Penjadwal utama memakai Actions tiap jam.

1. Repo GitHub → **Settings → Secrets and variables → Actions → New repository secret**:
   - `VERCEL_URL` = host saja, **tanpa** `https://` (contoh `uas-algo-indodax.vercel.app`)
   - `CRON_SECRET` = secret yang sama dengan Vercel
2. Repo → tab **Actions** → aktifkan workflows bila diminta → pilih **tick** → **Run workflow**.
3. Pastikan run pertama hijau dan output menampilkan `HTTP 200` serta `"ok": true`.

Catatan: jadwal Actions hanya aktif kalau file `.github/workflows/tick.yml` ada di branch **default** (`main`).

---

## 7. Catat link + bukti (sekali)

Masih di folder proyek:

```powershell
node scripts/record_deploy.mjs --repo https://github.com/<USER>/uas-algo-indodax --commit <HASH_DARI_LANGKAH_2> --url https://<URL>
```

Script ini:

- menulis `data/deploy.json`,
- mengisi blok `git` + `deployment` di `data/freeze.json`,
- mengisi tabel link di README,
- **memverifikasi** SHA-256 semua file inti masih sama dengan yang dibekukan (harus "COCOK").

Lalu commit dan push:

```powershell
git add README.md data/deploy.json data/freeze.json
git commit -m "Catat link repo, commit snapshot, dan URL Vercel"
git push
```

Kalau Vercel melakukan auto-deploy, tunggu selesai. Perubahan ini hanya dokumentasi, bukan kode strategi.

> Hash commit di tabel merujuk **snapshot kode** (commit langkah 2). Commit dokumentasi setelahnya tidak mengubah file yang di-hash, jadi buktinya tetap sah. Sebutkan hal ini di README bila perlu.

---

## 8. Rutinitas harian sampai 19 Nov

Cukup 5 menit, 2× sehari:

1. Buka `https://<URL>/api/dashboard?json=1` → cek `calls`, `errors`, `storage`.
2. Cek tab **Actions** di GitHub → semua run hijau.
3. Kalau ada error API, **jangan** ubah strategi. Biarkan tercatat di `errors.jsonl` dan jelaskan di refleksi.

Yang **tidak boleh** dilakukan selama jendela forward:

- mengubah `lib/config.js`, `lib/strategy.js`, `lib/risk.js`, atau universe;
- mengganti timeframe;
- menghapus/mengedit log mentah;
- menambahkan posisi manual atau mengisi angka dashboard dengan tangan;
- menjalankan dua penjadwal yang menembak pada menit yang sama.

---

## 9. Finalisasi Kamis 19 Nov (sebelum 23.59 WIB)

Jendela forward berakhir **19 Nov 2026 12.00 WIB** (05.00 UTC). Lakukan setelah itu.

### 9a. Tarik log dari Redis

```powershell
$env:UPSTASH_REDIS_REST_URL = "<dari Vercel Storage>"
$env:UPSTASH_REDIS_REST_TOKEN = "<dari Vercel Storage>"
node scripts/export_logs.mjs
```

Hasil: `logs/export/*.jsonl` + `state.json` + `manifest.json`.

### 9b. Replay jendela penuh + hitung ulang

```powershell
node scripts/replay_forward.mjs --from 2026-11-05T04:00:00Z --to 2026-11-19T05:00:00Z
node scripts/hitung_ulang.mjs
node scripts/build_dashboard.mjs
```

Pastikan `hitung_ulang` menulis **6/6 cek lolos** dan dashboard memakai `logs/export` (bukan `logs/local`).

### 9c. Perbarui dokumen

- Isi angka forward asli di README bagian 6 (ganti kalimat "belum berjalan").
- Tambahkan catatan tanggal mulai live (misalnya 15 Nov) dan cakupan hari sebenarnya.
- Jangan menampilkan CAGR untuk forward 14 hari.

### 9d. Zip ulang

```powershell
$stage = Join-Path $env:TEMP "uas_final"
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
robocopy . $stage /E /XD node_modules .git .vercel /XF .env /NFL /NDL /NJH /NJS /NP | Out-Null
Get-ChildItem "$stage\data\variants" -Recurse -Filter signals.csv | Remove-Item -Force
Compress-Archive -Path "$stage\*" -DestinationPath "..\UAS_25110200048_LuzainRahmadaniFA.zip" -Force
```

### 9e. Kumpulkan

- ZIP final
- URL Vercel
- URL repo GitHub
- commit hash

---

## 10. Kalau ada masalah

| Gejala | Penyebab umum | Perbaikan |
|---|---|---|
| `/api/tick` 401 | secret beda/spasi | samakan env Vercel dan secret Actions, redeploy |
| `/api/tick` 500 + `upstash HTTP 401` | token salah | reconnect Upstash, redeploy |
| `"storage":"local"` di dashboard | env Upstash belum ada saat build | redeploy setelah connect |
| Dashboard 503 | `data/recomputed.json` tidak ikut | jalankan `hitung_ulang`, redeploy |
| Error 403 dari Indodax | Cloudflare menolak | UA browser sudah dipakai; tunggu tick berikutnya, catat di `errors.jsonl` |
| Fungsi timeout | jaringan lambat | `maxDuration` 60 dtk; cek durasi di `calls.jsonl` |
| Actions tidak jalan | workflow bukan di `main` / Actions mati | aktifkan Actions, push ke `main`, jalankan manual |
| Posisi dobel | dua penjadwal menembak bersamaan | pakai satu penjadwal; endpoint idempoten per candle |
| `Cannot use import statement` | `type: module` tidak terbaca | pastikan `package.json` ikut ter-deploy (root repo) |

---

## 11. Checklist deploy

- [ ] Git + Node terpasang, repo GitHub berisi kode
- [ ] Vercel deploy sukses, URL produksi dicatat
- [ ] `CRON_SECRET` + `KILL_SWITCH=0` terisi
- [ ] Upstash Redis terhubung, dashboard menunjukkan `storage: upstash`
- [ ] `/api/tick` tanpa secret → 401
- [ ] `/api/tick` dengan secret → 200, dua kali, tidak dobel
- [ ] `/api/dashboard` terbuka
- [ ] Kill switch dites, status akhir false, tercatat di log
- [ ] Actions berjalan hijau tiap jam
- [ ] `record_deploy.mjs` dijalankan, hash COCOK, README terisi
- [ ] Commit + push dokumentasi
- [ ] Catat tanggal mulai live yang sebenarnya (jujur)
