/* Vercel function: POST /api/check — poll status task. */
const lib = require("./_lib");

module.exports = async (req, res) => {
  lib.setSecurityHeaders(res);
  if (req.method !== "POST") {
    return res.status(405).json({ status: false, error: "Method tidak diizinkan" });
  }
  if (!lib.sameOriginOk(req)) {
    return res.status(403).json({ status: false, error: "Akses ditolak" });
  }
  if (!lib.rateOk(lib.clientKey(req, "check"), 90, 60000)) {
    return res
      .status(429)
      .json({ status: false, error: "Terlalu banyak request. Tunggu sebentar." });
  }

  try {
    const { taskId, fp } = req.body || {};
    if (!taskId || !fp) {
      return res.status(400).json({ status: false, error: "taskId dan fp wajib" });
    }
    if (!lib.credentialsReady()) {
      return res.status(500).json({ status: false, error: "Server belum dikonfigurasi" });
    }

    const data = await lib.cekjob(taskId, fp);

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

    return res.json({ status: true, done: false, status_code: data.status });
  } catch (e) {
    return res.status(500).json({
      status: false,
      error: e.response?.data?.message || e.message || "Gagal cek status",
    });
  }
};
