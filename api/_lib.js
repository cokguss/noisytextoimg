/* Shared logic untuk Vercel functions (api/*.js).
   Sumber kebenaran logika ada di engine.js (ikut ter-deploy).
   CATATAN: guard + limiter di sini duplikat kecil dari server.js
   (sengaja, agar fungsi serverless tidak menarik seluruh Express app).
   Ubah di dua tempat bila perlu. */
const engine = require("./_engine");

const apiHits = new Map();

function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()"
  );
}

// Anti-scrape: hanya browser same-origin (frontend sendiri mengirim
// Origin/Referer). curl & scraper langsung ditolak.
function sameOriginOk(req) {
  const host = String(req.headers.host || "").toLowerCase();
  const extra = String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const allowed = new Set([host, ...extra]);
  const from = req.headers.origin || req.headers.referer || "";
  if (!from) return false;
  try {
    return allowed.has(new URL(from).host.toLowerCase());
  } catch {
    return false;
  }
}

function rateOk(key, max, windowMs) {
  const now = Date.now();
  const arr = (apiHits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) return false;
  arr.push(now);
  apiHits.set(key, arr);
  return true;
}

function clientKey(req, name) {
  const fwd = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  const ip = fwd || (req.socket && req.socket.remoteAddress) || "anon";
  return `${ip}|${name}`;
}

module.exports = {
  ...engine,
  setSecurityHeaders,
  sameOriginOk,
  rateOk,
  clientKey,
};
