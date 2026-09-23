const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const crypto = require("crypto");
const CryptoJS = require("crypto-js");

// Loader .env minimal tanpa dep (lokal saja; di Vercel pakai env dashboard).
// File .env TIDAK di-push (lihat .gitignore).
(function loadEnv() {
  try {
    const p = path.join(__dirname, ".env");
    if (!fs.existsSync(p)) return;
    const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      if (k && !(k in process.env)) process.env[k] = v;
    }
  } catch {
    /* abaikan */
  }
})();

const app = express();
const PORT = process.env.PORT || 3001;

// --- Security headers (tanpa dep tambahan) ---
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

// --- Blokir file sensitif agar tidak bocor via express.static ---
const BLOCKED_STATIC = [
  /\/server\.js$/i,
  /\/package(-lock)?\.json$/i,
  /^\/node_modules(\/|$)/i,
  /^\/\.git(\/|$)/i,
  /^\/\.env/i,
  /\.log$/i,
];
app.use((req, res, next) => {
  if (BLOCKED_STATIC.some((re) => re.test(req.path))) {
    return res.status(404).end();
  }
  next();
});

// --- Rate limit sederhana per IP untuk /api/* (lindungi kuota provider) ---
const apiHits = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${req.ip}|${req.path}`;
    const arr = (apiHits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      return res
        .status(429)
        .json({ status: false, error: "Terlalu banyak request. Tunggu sebentar." });
    }
    arr.push(now);
    apiHits.set(key, arr);
    next();
  };
}
const sweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of apiHits) {
    const fresh = arr.filter((t) => now - t < 60000);
    if (!fresh.length) apiHits.delete(k);
    else apiHits.set(k, fresh);
  }
}, 60000);
if (typeof sweepTimer.unref === "function") sweepTimer.unref();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Anti-scrape: /api/* hanya untuk browser same-origin (frontend sendiri).
// fetch browser selalu mengirim Origin/Referer; curl & scraper langsung ditolak.
// Domain tambahan (mis. custom domain) via env ALLOWED_ORIGINS="a.com,b.com".
function sameOriginGuard(req, res, next) {
  const host = String(req.get("host") || "").toLowerCase();
  const extra = String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const allowed = new Set([host, ...extra]);
  const from = req.get("origin") || req.get("referer") || "";
  if (!from) {
    return res.status(403).json({ status: false, error: "Akses ditolak" });
  }
  let oh;
  try {
    oh = new URL(from).host.toLowerCase();
  } catch {
    return res.status(403).json({ status: false, error: "Akses ditolak" });
  }
  if (!allowed.has(oh)) {
    return res.status(403).json({ status: false, error: "Akses ditolak" });
  }
  next();
}
app.use("/api/", sameOriginGuard);
app.use("/api/generate", rateLimit(10, 60000));
app.use("/api/check", rateLimit(90, 60000));
app.use("/api/download", rateLimit(30, 60000));
app.use(express.static(path.join(__dirname), { dotfiles: "deny" }));

// Logika provider + kamus ID->EN hidup di engine.js (shared dgn api/_lib.js
// di Vercel, yang tidak bisa meng-require server.js karena di-ignored).
const engine = require("./api/_engine");
const {
  enhancePrompt,
  mergeNegative,
  tuneCfg,
  createAiBodyJob,
  cekjob,
  credentialsReady,
  ALLOWED_MODELS,
  ALLOWED_DIMS,
  DEFAULT_NEGATIVE,
} = engine;


// POST /api/generate: buat task
app.post("/api/generate", async (req, res) => {
  try {
    const {
      prompt,
      negativePrompt = "",
      model = "AbsoluteReality_v1.8.1.safetensors",
      cfg = 7,
      width = 1024,
      height = 1024,
    } = req.body || {};

    if (!prompt || !String(prompt).trim()) {
      return res.status(400).json({ status: false, error: "Prompt wajib diisi" });
    }

    if (!credentialsReady()) {
      return res.status(500).json({ status: false, error: "Server belum dikonfigurasi" });
    }

    if (!ALLOWED_MODELS.includes(model)) {
      return res.status(400).json({ status: false, error: "Model tidak dikenal" });
    }

    const w = Number(width);
    const h = Number(height);
    const dimsOk = ALLOWED_DIMS.some(([dw, dh]) => dw === w && dh === h);
    if (!dimsOk) {
      return res.status(400).json({ status: false, error: "Dimensi tidak didukung" });
    }

    const finalPrompt = enhancePrompt(prompt);
    const finalNegative = mergeNegative(negativePrompt);
    const finalCfg = tuneCfg(cfg, model);

    const { taskId, fp } = await createAiBodyJob(
      finalPrompt,
      finalNegative,
      model,
      finalCfg,
      w,
      h
    );

    res.json({ status: true, taskId, fp });
  } catch (e) {
    res.status(500).json({
      status: false,
      error: e.response?.data?.message || e.message || "Gagal membuat task",
    });
  }
});

// POST /api/check: poll status
app.post("/api/check", async (req, res) => {
  try {
    const { taskId, fp } = req.body || {};
    if (!taskId || !fp) {
      return res
        .status(400)
        .json({ status: false, error: "taskId dan fp wajib" });
    }

    if (!credentialsReady()) {
      return res.status(500).json({ status: false, error: "Server belum dikonfigurasi" });
    }

    const data = await cekjob(taskId, fp);

    if (data.status === 2) {
      const pathImg = data.result_image || "";
      const url = pathImg.startsWith("http")
        ? pathImg
        : "https://temp.live3d.io/" + pathImg;
      return res.json({ status: true, done: true, status_code: 2, url });
    }

    if (data.status === 3) {
      return res.json({
        status: false,
        done: true,
        status_code: 3,
        error: "Task diblokir safety filter",
      });
    }

    res.json({ status: true, done: false, status_code: data.status });
  } catch (e) {
    res.status(500).json({
      status: false,
      error: e.response?.data?.message || e.message || "Gagal cek status",
    });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ status: true, service: "noisy-text-to-img" });
});

// GET /api/download?url=... : proxy unduhan same-origin agar atribut
// `download` browser (termasuk HP) dihormati — tidak buka tab baru.
// Host di-allowlist ketat agar endpoint tidak jadi open proxy.
app.get("/api/download", async (req, res) => {
  try {
    const raw = String(req.query.url || "");
    let u;
    try {
      u = new URL(raw);
    } catch {
      return res.status(400).json({ status: false, error: "URL tidak valid" });
    }
    if (u.protocol !== "https:" || u.hostname !== "temp.live3d.io") {
      return res.status(400).json({ status: false, error: "Host tidak diizinkan" });
    }

    const upstream = await axios.get(u.toString(), {
      responseType: "stream",
      timeout: 30000,
      maxContentLength: 25 * 1024 * 1024,
      maxBodyLength: 25 * 1024 * 1024,
    });

    const type = String(upstream.headers["content-type"] || "image/webp").split(";")[0].trim() || "image/webp";
    const ext = type.includes("png") ? "png" : type.includes("jpeg") || type.includes("jpg") ? "jpg" : "webp";
    res.setHeader("Content-Type", type);
    res.setHeader("Content-Disposition", `attachment; filename="noisy-generate.${ext}"`);
    res.setHeader("Cache-Control", "private, max-age=3600");
    upstream.data.on("error", () => {
      if (!res.headersSent) res.status(502).end();
      else res.end();
    });
    upstream.data.pipe(res);
  } catch (e) {
    if (!res.headersSent) {
      res.status(502).json({ status: false, error: "Gagal mengunduh gambar" });
    } else {
      res.end();
    }
  }
});

app.get("/privacy", (_req, res) => {
  res.sendFile(path.join(__dirname, "privacy.html"));
});

app.get("/privacy.html", (_req, res) => {
  res.sendFile(path.join(__dirname, "privacy.html"));
});

// Hanya listen saat dijalankan langsung (node server.js). Saat di-require
// (unit test / Vercel functions via api/_lib.js) tidak ada side effect.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Noisy Text To IMG → http://localhost:${PORT}`);
  });
}


// Diekspor agar bisa dipakai unit test.
module.exports = { app, ...engine };
