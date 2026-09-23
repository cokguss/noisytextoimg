# Noisy Text To IMG

Studio text-to-image di browser: tulis prompt (Indonesia/Inggris), dapatkan gambar. Tanpa akun, riwayat hanya di `localStorage` browser.

## Jalan lokal

```bash
npm install
cp .env.example .env   # lalu isi kredensial
node server.js          # http://localhost:3001
```

## Kredensial

Semua kunci provider **hanya** lewat env (tidak ada di source):

- `LIVE3D_APP_ID`, `LIVE3D_U_ID`, `LIVE3D_FN_NAME`, `LIVE3D_BRAND_KEY`, `LIVE3D_THEME_VERSION`
- Opsional: `ALLOWED_ORIGINS` (domain tambahan utk `/api`, koma)

## Deploy ke Vercel

1. Push repo ini.
2. Import di Vercel (framework: Other).
3. Project Settings → Environment Variables → isi 5 kunci `LIVE3D_*`.
4. Deploy. Frontend statis + `api/*.js` jadi serverless functions otomatis.

Catatan: `server.js` hanya untuk dev lokal (di-`.vercelignore` agar tidak bisa diunduh publik). Rate-limit + same-origin guard aktif di lokal maupun Vercel.
