/* Noisy Text To IMG API client: panggil local server (server.js)
   Server yang handle crypto + request ke live3d, jadi bebas CORS. */

const NoisyAPI = (() => {
  const API_BASE = ""; // same origin

  const RATIO_MAP = {
    "1:1": [1024, 1024],
    "16:9": [1024, 576],
    "4:3": [1024, 768],
    "9:16": [576, 1024],
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Bedakan kegagalan jaringan (fetch menolak / res non-JSON: server mati,
  // fungsi Vercel crash) dari error API asli (JSON {status:false, error}).
  function isNetworkError(err) {
    return (
      err instanceof TypeError /* fetch gagal: DNS/offline/CORS */ ||
      err?.name === "AbortError" ||
      err?.name === "APIHTTPError" ||
      err?.name === "APINoJSON"
    );
  }

  async function post(path, body) {
    const res = await fetch(API_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text().catch(() => "");
    let json = {};
    try {
      json = JSON.parse(text);
    } catch {
      json = {};
    }
    if (!res.ok || json.status === false) {
      if (!json.error) {
        // Bukan JSON error dari API → kemungkinan besar jaringan/gateway
        const e = new Error(`HTTP ${res.status}`);
        e.name = res.ok ? "APINoJSON" : "APIHTTPError";
        e.httpStatus = res.status;
        throw e;
      }
      const e = new Error(json.error);
      e.httpStatus = res.status;
      throw e;
    }
    return json;
  }

  function demoResult(prompt, ratio = "1:1") {
    const seed = encodeURIComponent((prompt || "noisy").slice(0, 40));
    const dims = RATIO_MAP[ratio] || RATIO_MAP["1:1"];
    return `https://picsum.photos/seed/${seed}/${dims[0]}/${dims[1]}`;
  }

  /**
   * @param {object} opts
   * @param {string} opts.prompt
   * @param {string} [opts.negativePrompt]
   * @param {string} [opts.model]
   * @param {number} [opts.cfg]
   * @param {string} [opts.ratio]
   * @param {number} [opts.width]
   * @param {number} [opts.height]
   * @param {(info: {phase:string, message:string, attempt?:number, taskId?:string}) => void} [opts.onProgress]
   * @param {(mode: 'live'|'demo') => void} [opts.onMode]
   */
  async function generate({
    prompt,
    negativePrompt = "",
    model = "AbsoluteReality_v1.8.1.safetensors",
    cfg = 7,
    ratio = "1:1",
    onProgress = () => {},
    onMode = () => {},
  }) {
    let mode = "live";
    let taskId;
    let fp;
    const [width, height] = RATIO_MAP[ratio] || RATIO_MAP["1:1"];

    try {
      onProgress({ phase: "create", message: "Mengirim prompt…" });
      const created = await post("/api/generate", {
        prompt,
        negativePrompt,
        model,
        cfg,
        width,
        height,
      });
      taskId = created.taskId;
      fp = created.fp;
      onMode("live");
      onProgress({
        phase: "create",
        message: "Task dibuat, antre render…",
        taskId,
      });
    } catch (err) {
      if (!isNetworkError(err)) {
        // Error asli dari API (mis. belum dikonfigurasi, rate limit, 403):
        // tampilkan apa adanya, JANGAN samarkan jadi mode demo.
        throw err;
      }
      // Server down / offline murni → demo mode supaya UI tetap jalan
      mode = "demo";
      onMode("demo");
      taskId = "demo-" + Math.random().toString(36).slice(2, 10);
      onProgress({
        phase: "demo",
        message: "Server tidak terjangkau. Mode demo…",
        taskId,
      });
      await sleep(2400);
        onProgress({
        phase: "demo",
        message: "Merender hasil contoh…",
        attempt: 1,
      });
      await sleep(1800);
      return { url: demoResult(prompt, ratio), taskId, mode, prompt, model, cfg, ratio };
    }

    const maxAttempts = 30;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await sleep(5000);
      onProgress({
        phase: "poll",
        message: statusMessage(attempt),
        attempt,
        taskId,
      });

      let data;
      try {
        data = await post("/api/check", { taskId, fp });
      } catch {
        continue; // network glitch saat poll, coba lagi
      }

      if (data.done && data.status_code === 2) {
        return { url: data.url, taskId, mode, prompt, model, cfg, ratio };
      }

      if (data.done && data.status_code === 3) {
        throw new Error(data.error || "Task diblokir safety filter.");
      }
    }

    throw new Error("Timeout. Server terlalu lama merender. Coba lagi.");
  }

  function statusMessage(attempt) {
    if (attempt <= 2) return "Menyiapkan diffusion…";
    if (attempt <= 6) return "Merender langkah pertama…";
    if (attempt <= 12) return "Menyempurnakan detail…";
    if (attempt <= 20) return "Upscaling hasil…";
    return "Hampir selesai…";
  }

  return { generate };
})();
