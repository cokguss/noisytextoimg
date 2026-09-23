/* Vercel function: GET /api/health */
const lib = require("./_lib");

module.exports = (req, res) => {
  lib.setSecurityHeaders(res);
  return res.json({ status: true, service: "noisy-text-to-img" });
};
