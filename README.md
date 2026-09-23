<div align="center">

# Noisy Text To IMG

**Studio text-to-image di browser.** Tulis prompt Bahasa Indonesia, dapatkan gambar.
Tanpa akun. Tanpa install. Tanpa GPU lokal.

[![Node](https://img.shields.io/badge/node-%3E%3D18-8cc84b?style=flat-square&logo=node.js)](https://nodejs.org)
[![Express](https://img.shields.io/badge/express-4.x-lightgrey?style=flat-square)](https://expressjs.com)
[![Vercel Ready](https://img.shields.io/badge/vercel-ready-black?style=flat-square&logo=vercel)](https://vercel.com)
[![License](https://img.shields.io/badge/license-lihat_LICENSE.md-yellow?style=flat-square)](LICENSE.md)

[Demo](#) · [Lapor Bug](https://github.com/cokguss/noisytextoimg/issues) · [Channel Telegram](https://t.me/noisytechh)

</div>

---

## Fitur

| | |
|---|---|
| Prompt Indonesia | Kamus ID→EN 300+ entri + reduplikasi + guard frasa Inggris |
| 3 model | AbsoluteReality v1.8 (rekomendasi) · majicmix Realistic v7 · MeinaMix v11 Anime |
| CFG & rasio | Slider 1–20 (auto-tune per model) · 1:1 / 16:9 / 4:3 / 9:16 |
| Riwayat lokal | 24 terakhir di `localStorage` — server tidak menyimpan apa pun |
| Unduhan langsung | Proxy same-origin, 1 klik tanpa tab baru (desktop & HP) |
| Keamanan | Rate-limit · same-origin guard · secrets via env · security headers |

## Mulai dalam 1 menit

```bash
npm install
cp .env.example .env   # isi 5 kunci LIVE3D_*
node server.js          # http://localhost:3001
```

## Struktur

```
├── index.html / privacy.html   # frontend (tanpa build step)
├── css/ js/ assets/ fonts/     # gaya, logika, logo, font lokal
├── server.js                   # dev lokal (Express)
├── api/                        # serverless functions (Vercel)
│   ├── _lib.js                 # logic bersama, tanpa side effect
│   └── generate.js check.js download.js health.js
└── vercel.json                 # maxDuration 60 + security headers
```

## Environment Variables

| Key | Wajib | Keterangan |
|---|---|---|
| `LIVE3D_APP_ID` | Ya | ID aplikasi provider render |
| `LIVE3D_U_ID` | Ya | User ID provider |
| `LIVE3D_FN_NAME` | Ya | Nama fungsi render |
| `LIVE3D_BRAND_KEY` | Ya | Brand key provider |
| `LIVE3D_THEME_VERSION` | Ya | Theme version provider |
| `ALLOWED_ORIGINS` | Tidak | Domain tambahan utk `/api`, pisah koma |

> Tidak ada nilai asli di repo ini. Bocor = rotasi kunci + isi ulang env.

## Deploy ke Vercel

1. Fork / push repo ini.
2. **Add New Project** → Import → framework: **Other**.
3. **Settings → Environment Variables** → isi 5 kunci `LIVE3D_*` (Production + Preview).
4. **Deploy.** Frontend tersaji statis, `api/*.js` jadi functions otomatis.

`server.js` tidak ikut deploy (lihat `.vercelignore`) sehingga source backend tidak bisa diunduh publik.

## API (internal, same-origin only)

| Endpoint | Method | Keterangan |
|---|---|---|
| `/api/generate` | POST | Buat task (`prompt`, `model`, `cfg`, `width`, `height`) |
| `/api/check` | POST | Poll status (`taskId`, `fp`) |
| `/api/download` | GET | Proxy unduhan (`?url=`, host allowlist) |
| `/api/health` | GET | Status servis |

Semua endpoint menolak request tanpa `Origin`/`Referer` se-host (403) + rate-limit.

## Privasi

- Tanpa akun, tanpa cookie tracking, tanpa database riwayat di server.
- Riwayat generate hidup di `localStorage` browser-mu (hapus kapan saja).
- Detail: [Kebijakan Privasi](privacy.html).

## Lisensi

Lihat [LICENSE.md](LICENSE.md).

---

<div align="center">

Dibangun oleh **Noisy** · Support system **BloodSkill**
· [Telegram](https://t.me/noisy02) · [GitHub](https://github.com/cokguss) · [Channel](https://t.me/noisytechh)

</div>
