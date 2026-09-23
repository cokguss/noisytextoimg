/* Vercel function: POST /api/generate — buat task render. */
const lib = require("./_lib");

module.exports = async (req, res) => {
  lib.setSecurityHeaders(res);
  if (req.method !== "POST") {
    return res.status(405).json({ status: false, error: "Method tidak diizinkan" });
  }
  if (!lib.sameOriginOk(req)) {
    return res.status(403).json({ status: false, error: "Akses ditolak" });
  }
  if (!lib.rateOk(lib.clientKey(req, "generate"), 10, 60000)) {
    return res
      .status(429)
      .json({ status: false, error: "Terlalu banyak request. Tunggu sebentar." });
  }

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
    if (!lib.ALLOWED_MODELS.includes(model)) {
      return res.status(400).json({ status: false, error: "Model tidak dikenal" });
    }
    const w = Number(width);
    const h = Number(height);
    if (!lib.ALLOWED_DIMS.some(([dw, dh]) => dw === w && dh === h)) {
      return res.status(400).json({ status: false, error: "Dimensi tidak didukung" });
    }
    if (!lib.credentialsReady()) {
      return res.status(500).json({ status: false, error: "Server belum dikonfigurasi" });
    }

    const finalPrompt = lib.enhancePrompt(prompt);
    const finalNegative = lib.mergeNegative(negativePrompt);
    const finalCfg = lib.tuneCfg(cfg, model);
    const { taskId, fp } = await lib.createAiBodyJob(
      finalPrompt,
      finalNegative,
      model,
      finalCfg,
      w,
      h
    );
    return res.json({ status: true, taskId, fp });
  } catch (e) {
    return res.status(500).json({
      status: false,
      error: e.response?.data?.message || e.message || "Gagal membuat task",
    });
  }
};
