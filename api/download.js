/* Vercel function: GET /api/download?url=... — proxy unduhan same-origin.
   Host di-allowlist ketat agar tidak jadi open proxy. */
const axios = require("axios");
const lib = require("./_lib");

module.exports = async (req, res) => {
  lib.setSecurityHeaders(res);
  if (req.method !== "GET") {
    return res.status(405).json({ status: false, error: "Method tidak diizinkan" });
  }
  if (!lib.sameOriginOk(req)) {
    return res.status(403).json({ status: false, error: "Akses ditolak" });
  }
  if (!lib.rateOk(lib.clientKey(req, "download"), 30, 60000)) {
    return res
      .status(429)
      .json({ status: false, error: "Terlalu banyak request. Tunggu sebentar." });
  }

  try {
    const raw = String((req.query && req.query.url) || "");
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

    const type =
      String(upstream.headers["content-type"] || "image/webp").split(";")[0].trim() ||
      "image/webp";
    const ext = type.includes("png")
      ? "png"
      : type.includes("jpeg") || type.includes("jpg")
        ? "jpg"
        : "webp";
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
};
