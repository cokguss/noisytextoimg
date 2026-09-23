(() => {
  document.documentElement.classList.add("js");
  // Splash loading: planet orbit + progress 00/100, fade lalu hapus dari DOM.
  // Pola dari noisyamprem (loader.js): eased progress + min tampil + guard load.
  (() => {
    const splash = document.getElementById("splash");
    if (!splash) return;
    const bar = document.getElementById("splashBar");
    const count = document.getElementById("splashCount");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const MIN_SHOW = reduced ? 250 : 1100;
    const startedAt = Date.now();
    let done = false;
    let progressDone = false;
    let pageLoaded = document.readyState === "complete";
    function finish() {
      if (done) return;
      done = true;
      splash.classList.add("is-done");
      splash.style.pointerEvents = "none";
      setTimeout(() => {
        if (splash.parentNode) splash.parentNode.removeChild(splash);
      }, 650);
    }
    function maybe() {
      if (progressDone && pageLoaded) {
        const elapsed = Date.now() - startedAt;
        if (elapsed >= MIN_SHOW) finish();
        else setTimeout(maybe, MIN_SHOW - elapsed + 40);
      }
    }
    if (reduced) {
      if (bar) bar.style.width = "100%";
      if (count) count.textContent = "100";
      progressDone = true;
      maybe();
    } else {
      const easeOut = (p) => 1 - Math.pow(1 - p, 3);
      const t0 = performance.now();
      const DUR = 1200;
      const tick = (t) => {
        const p = Math.min(1, (t - t0) / DUR);
        const val = Math.round(easeOut(p) * 100);
        if (bar) bar.style.width = `${val}%`;
        if (count) count.textContent = String(val).padStart(2, "0");
        if (p < 1) requestAnimationFrame(tick);
        else {
          progressDone = true;
          maybe();
        }
      };
      requestAnimationFrame(tick);
    }
    if (!pageLoaded) {
      window.addEventListener("load", () => {
        pageLoaded = true;
        maybe();
      });
    }
    // Guard: jangan blokir halaman lebih dari ~4 detik
    setTimeout(() => {
      pageLoaded = true;
      maybe();
    }, reduced ? 300 : 4000);
  })();
  // Background video harmonization: aktifkan has-video + hormati reduced-motion / data-saver
  (() => {
    const html = document.documentElement;
    const vid = document.getElementById("bg-video-el");
    if (!vid) return;
    html.classList.add("has-video");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const saveData = navigator.connection && navigator.connection.saveData;
    const smallScreen = window.matchMedia("(max-width: 768px)").matches;
    if (reduced || saveData || smallScreen) {
      // HP/hemat-data: jangan unduh video 6,3MB sama sekali
      vid.pause();
      vid.removeAttribute("autoplay");
      vid.preload = "none";
      const src = vid.querySelector("source");
      if (src) src.remove();
      vid.load();
      return;
    }
    // Coba autoplay, fallback diam bila diblokir
    const p = vid.play();
    if (p && p.catch) p.catch(() => {});
    window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", (e) => {
      if (e.matches) vid.pause(); else vid.play().catch(() => {});
    });
  })();

  const $ = (sel, root = document) => root.querySelector(sel);

  const form = $("#gen-form");
  const promptEl = $("#prompt");
  const negEl = $("#negative-prompt");
  const modelEl = $("#model");
  const modelTrigger = $("#model-trigger");
  const modelMenu = $("#model-menu");
  const cfgEl = $("#cfg");
  const cfgOut = $("#cfg-value");
  const ratioEl = $("#ratio");
  const promptCount = $("#prompt-count");
  const promptError = $("#prompt-error");
  const generateBtn = $("#generate-btn");
  const stage = $("#stage");
  const apiStatus = $("#api-status");

  const views = {
    empty: $('[data-view="empty"]'),
    loading: $('[data-view="loading"]'),
    result: $('[data-view="result"]'),
    error: $('[data-view="error"]'),
  };

  const loadStatus = $("#load-status");
  const progressFill = $("#progress-fill");
  const loadTask = $("#load-task");
  const loadAttempt = $("#load-attempt");
  const loadPct = $("#load-pct");
  const resultImg = $("#result-img");
  const resultPrompt = $("#result-prompt");
  const resultModel = $("#result-model");
  const resultCfg = $("#result-cfg");
  const resultRatio = $("#result-ratio");
  const downloadBtn = $("#download-btn");
  const copyBtn = $("#copy-btn");
  const shareBtn = $("#share-btn");
  const regenBtn = $("#regen-btn");
  const retryBtn = $("#retry-btn");
  const errorMsg = $("#error-msg");

  let busy = false;
  let lastPrompt = "";
  let lastNeg = "";
  let lastModel = "";
  let lastCfg = 7;
  let lastRatio = "1:1";

  const RECOMMENDED_MODEL = "AbsoluteReality_v1.8.1.safetensors";

  function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function setStatus(state, label) {
    apiStatus.dataset.state = state;
    $(".status-label", apiStatus).textContent = label;
  }

  function setView(name) {
    stage.dataset.state = name;
    Object.entries(views).forEach(([key, el]) => {
      const active = key === name;
      el.hidden = !active;
      el.classList.toggle("is-entering", false);
      if (active) {
        void el.offsetWidth;
        el.classList.add("is-entering");
      }
    });
  }

  function updateCount() {
    const len = promptEl.value.length;
    promptCount.textContent = `${len} / 2000`;
  }

  function updateRange() {
    const min = Number(cfgEl.min);
    const max = Number(cfgEl.max);
    const val = Number(cfgEl.value);
    const pct = ((val - min) / (max - min)) * 100;
    cfgEl.style.setProperty("--range-pct", `${pct}%`);
    cfgOut.textContent = String(val);
  }

  const detailsAnimating = new WeakSet();

  function animateDetailsBody(details, body, open) {
    if (!body || !details) return Promise.resolve();

    if (prefersReducedMotion()) {
      details.open = open;
      details.classList.toggle("is-closing", !open);
      body.style.height = open ? "auto" : "0px";
      body.style.opacity = open ? "1" : "0";
      body.style.pointerEvents = open ? "auto" : "none";
      return Promise.resolve();
    }

    if (detailsAnimating.has(details)) return Promise.resolve();

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        body.classList.remove("is-animating");
        body.removeEventListener("transitionend", onEnd);
        window.clearTimeout(timer);
        if (open) {
          details.open = true;
          details.classList.remove("is-closing");
          body.style.height = "auto";
          body.style.opacity = "1";
          body.style.pointerEvents = "auto";
        } else {
          details.open = false;
          details.classList.remove("is-closing");
          body.style.height = "0px";
          body.style.opacity = "0";
          body.style.pointerEvents = "none";
        }
        detailsAnimating.delete(details);
        resolve();
      };

      const onEnd = (e) => {
        if (e.target !== body || e.propertyName !== "height") return;
        finish();
      };

      const timer = window.setTimeout(finish, 520);
      detailsAnimating.add(details);

      if (open) {
        details.open = true;
        details.classList.remove("is-closing");
        body.style.height = "0px";
        body.style.opacity = "0";
        body.style.pointerEvents = "none";
        void body.offsetHeight;
        body.classList.add("is-animating");
        body.style.pointerEvents = "auto";
        const target = body.scrollHeight;
        requestAnimationFrame(() => {
          if (settled || !open) return;
          body.style.opacity = "1";
          body.style.height = `${target}px`;
        });
        body.addEventListener("transitionend", onEnd);
      } else {
        details.open = true;
        details.classList.add("is-closing");
        body.style.pointerEvents = "none";
        body.style.height = `${body.scrollHeight}px`;
        void body.offsetHeight;
        body.classList.add("is-animating");
        requestAnimationFrame(() => {
          if (settled || open) return;
          body.style.opacity = "0";
          body.style.height = "0px";
        });
        body.addEventListener("transitionend", onEnd);
      }
    });
  }

  function initDetailsToggle(details) {
    if (!details) return;
    const summary = details.querySelector("summary");
    const body = details.querySelector("[data-details-body]");
    if (!summary || !body) return;

    if (prefersReducedMotion()) {
      body.style.height = details.open ? "auto" : "0px";
      body.style.opacity = details.open ? "1" : "0";
      if (details.open) body.style.pointerEvents = "auto";
    } else if (details.open) {
      body.style.height = "auto";
      body.style.opacity = "1";
      body.style.pointerEvents = "auto";
    } else {
      body.style.height = "0px";
      body.style.opacity = "0";
    }

    summary.addEventListener("click", (e) => {
      e.preventDefault();
      if (detailsAnimating.has(details)) return;
      animateDetailsBody(details, body, !details.open);
    });
  }

  function setModelUI(value) {
    if (!value) return;
    const opts = document.querySelectorAll(".model-option");
    let matched = null;
    opts.forEach((opt) => {
      const on = opt.dataset.value === value;
      opt.classList.toggle("is-selected", on);
      opt.setAttribute("aria-selected", on ? "true" : "false");
      if (on) matched = opt;
    });
    if (matched) {
      $("#model-trigger-name").textContent = matched.dataset.name || "";
      $("#model-trigger-desc").textContent = matched.dataset.desc || "";
      modelEl.value = matched.dataset.value;
      const rec = $("#model-rec");
      if (rec) rec.hidden = matched.dataset.value !== RECOMMENDED_MODEL;
    }
  }

  function openModelMenu() {
    modelMenu.hidden = false;
    modelTrigger.setAttribute("aria-expanded", "true");
    const active =
      modelMenu.querySelector(".model-option.is-selected") ||
      modelMenu.querySelector(".model-option");
    modelMenu.querySelectorAll(".model-option").forEach((o) => o.classList.remove("is-active"));
    if (active) {
      active.classList.add("is-active");
      active.focus({ preventScroll: true });
    }
  }

  function closeModelMenu() {
    if (!modelMenu || modelMenu.hidden) return;
    modelMenu.hidden = true;
    modelTrigger.setAttribute("aria-expanded", "false");
    modelMenu.querySelectorAll(".model-option").forEach((o) => o.classList.remove("is-active"));
  }

  function initModelPicker() {
    const options = [...modelMenu.querySelectorAll(".model-option")];

    modelTrigger.addEventListener("click", () => {
      if (modelTrigger.disabled) return;
      if (modelMenu.hidden) openModelMenu();
      else closeModelMenu();
    });

    modelTrigger.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (modelMenu.hidden) openModelMenu();
      } else if (e.key === "Escape") {
        closeModelMenu();
      }
    });

    options.forEach((opt, idx) => {
      opt.addEventListener("click", () => {
        setModelUI(opt.dataset.value);
        closeModelMenu();
        modelTrigger.focus();
      });

      opt.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setModelUI(opt.dataset.value);
          closeModelMenu();
          modelTrigger.focus();
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          const next = options[(idx + 1) % options.length];
          options.forEach((o) => o.classList.remove("is-active"));
          next.classList.add("is-active");
          next.focus();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          const prev = options[(idx - 1 + options.length) % options.length];
          options.forEach((o) => o.classList.remove("is-active"));
          prev.classList.add("is-active");
          prev.focus();
        } else if (e.key === "Escape") {
          closeModelMenu();
          modelTrigger.focus();
        }
      });
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest("[data-model-picker]")) closeModelMenu();
    });
  }

  function setBusy(state) {
    busy = state;
    generateBtn.disabled = state;
    generateBtn.classList.toggle("btn--busy", state);
    promptEl.readOnly = state;
    negEl.readOnly = state;
    modelTrigger.disabled = state;
    cfgEl.disabled = state;
    document.querySelectorAll(".ratio-opt, .preset-chip, #random-prompt-btn").forEach((el) => {
      el.disabled = state;
    });
    if (state) closeModelMenu();
  }

  function setRatioUI(ratio) {
    if (!ratioEl) return;
    ratioEl.value = ratio;
    document.querySelectorAll(".ratio-opt").forEach((btn) => {
      const on = btn.dataset.ratio === ratio;
      btn.classList.toggle("is-selected", on);
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });
    stage.style.setProperty("--stage-ratio", ratio.replace(":", " / "));
  }

  function initRatioPicker() {
    document.querySelectorAll(".ratio-opt").forEach((btn) => {
      btn.addEventListener("click", () => setRatioUI(btn.dataset.ratio));
    });
  }

  const RANDOM_PROMPTS = [
    "(masterpiece), rain-soaked cyberpunk street market at night, neon reflections, cinematic 35mm",
    "(masterpiece), editorial portrait of a chef in a steamy kitchen, warm tungsten light, kodak portra",
    "(masterpiece), brutalist library interior, dust motes in light shafts, architectural photography",
    "(masterpiece), anime warrior standing on cliff edge at sunset, wind in hair, vibrant sky",
    "(masterpiece), macro photo of dew on a beetle shell, iridescent detail, studio flash",
    "(masterpiece), lonely gas station on a desert highway at dusk, cinematic wide shot",
    "(masterpiece), fantasy library floating among clouds, golden light, matte painting style",
    "(masterpiece), street photographer snapshot of musicians in a subway, grainy 400 iso film",
  ];

  function initPromptTools() {
    const randomBtn = $("#random-prompt-btn");
    if (randomBtn) {
      randomBtn.addEventListener("click", () => {
        const next = RANDOM_PROMPTS[Math.floor(Math.random() * RANDOM_PROMPTS.length)];
        promptEl.value = next;
        updateCount();
        promptError.hidden = true;
        promptEl.setAttribute("aria-invalid", "false");
        promptEl.focus();
      });
    }

    document.querySelectorAll(".preset-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        if (chip.dataset.preset) {
          promptEl.value = chip.dataset.preset;
        } else if (chip.dataset.promptAppend) {
          const base = promptEl.value.trim();
          const add = chip.dataset.promptAppend;
          if (!base) {
            promptEl.value = add.replace(/^,\s*/, "");
          } else if (!base.toLowerCase().includes(add.replace(/^,\s*/, "").toLowerCase())) {
            promptEl.value = (base.replace(/,\s*$/, "") + "," + add).replace(/^,\s*/, "");
          }
        }
        updateCount();
        promptError.hidden = true;
        promptEl.setAttribute("aria-invalid", "false");
        promptEl.focus();
      });
    });
  }

  async function flashBtnText(btn, okText) {
    const label = $(".btn-text", btn);
    if (!label) return;
    const prev = label.textContent;
    label.textContent = okText;
    setTimeout(() => {
      label.textContent = prev;
    }, 1400);
  }

  async function shareResult() {
    const url = resultImg.src;
    const text = lastPrompt ? `Noisy Text To IMG: ${lastPrompt.slice(0, 80)}` : "Noisy Text To IMG";
    try {
      if (navigator.share) {
        await navigator.share({ title: "Noisy Text To IMG", text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      await flashBtnText(shareBtn, "Tautan tersalin");
    } catch {
      try {
        await navigator.clipboard.writeText(url);
        await flashBtnText(shareBtn, "Tautan tersalin");
      } catch {
        await flashBtnText(shareBtn, "Gagal");
      }
    }
  }

  function validate() {
    const ok = promptEl.value.trim().length > 0;
    promptError.hidden = ok;
    promptEl.setAttribute("aria-invalid", ok ? "false" : "true");
    if (!ok) promptEl.focus();
    return ok;
  }

  function progressFor(info) {
    if (info.phase === "create") return 12;
    if (info.phase === "demo") return 45;
    if (info.phase === "poll" && info.attempt) {
      return Math.min(92, 18 + info.attempt * 6);
    }
    return 8;
  }

  async function runGenerate() {
    if (busy) return;
    if (!validate()) return;

    const prompt = promptEl.value.trim();
    const negativePrompt = negEl.value.trim();
    const model = modelEl.value;
    const cfg = Number(cfgEl.value);
    const ratio = ratioEl ? ratioEl.value : "1:1";

    lastPrompt = prompt;
    lastNeg = negativePrompt;
    lastModel = model;
    lastCfg = cfg;
    lastRatio = ratio;

    setBusy(true);
    setView("loading");
    setStatus("busy", "Render");
    progressFill.style.width = "4%";
    loadStatus.textContent = "Mengirim prompt…";
    loadTask.textContent = "task · -";
    loadAttempt.textContent = "poll · 0/30";
    if (loadPct) loadPct.textContent = "04";

    try {
      const result = await NoisyAPI.generate({
        prompt,
        negativePrompt,
        model,
        cfg,
        ratio,
        onMode(mode) {
          if (mode === "demo") setStatus("busy", "Demo");
        },
        onProgress(info) {
          if (info.message) loadStatus.textContent = info.message;
          if (info.taskId) loadTask.textContent = `task · ${info.taskId.slice(0, 12)}`;
          if (info.attempt != null) {
            loadAttempt.textContent = `poll · ${info.attempt}/30`;
          }
          const pct = progressFor(info);
          progressFill.style.width = `${pct}%`;
          if (loadPct) loadPct.textContent = String(pct).padStart(2, "0");
        },
      });

      progressFill.style.width = "100%";
      await new Promise((r) => setTimeout(r, 280));

      showResult(result);
      History.add({
        prompt: lastPrompt,
        negativePrompt: lastNeg,
        model: (result.model || lastModel || "").replace(".safetensors", ""),
        cfg: result.cfg != null ? result.cfg : lastCfg,
        ratio: result.ratio || lastRatio,
        url: result.url,
        mode: result.mode,
        ts: Date.now(),
      });
      setStatus("done", result.mode === "demo" ? "Demo" : "Selesai");
    } catch (err) {
      showError(err.message || "Terjadi kesalahan.");
      setStatus("error", "Gagal");
    } finally {
      setBusy(false);
    }
  }

  function downloadHref(url) {
    // Via proxy same-origin agar langsung mengunduh (desktop & HP),
    // bukan membuka tab baru. Mode demo (picsum) tetap direct.
    if (/^https:\/\/temp\.live3d\.io\//.test(url || "")) {
      return `/api/download?url=${encodeURIComponent(url)}`;
    }
    return url;
  }

  function showResult(result) {
    resultImg.src = result.url;
    resultImg.alt = `Hasil untuk: ${result.prompt}`;
    resultPrompt.textContent = result.prompt;
    resultModel.textContent = result.model.replace(".safetensors", "");
    resultCfg.textContent = String(result.cfg);
    if (resultRatio) resultRatio.textContent = result.ratio || lastRatio || "1:1";
    downloadBtn.href = downloadHref(result.url);
    downloadBtn.download = "noisy-generate.webp";

    const frame = $(".result-frame");
    if (frame && result.ratio) {
      frame.style.aspectRatio = result.ratio.replace(":", " / ");
    }

    setView("result");
    const view = views.result;
    view.classList.remove("is-revealing");
    void view.offsetWidth;
    view.classList.add("is-revealing");
  }

  function showError(message) {
    errorMsg.textContent = message;
    setView("error");
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    runGenerate();
  });

  promptEl.addEventListener("input", () => {
    updateCount();
    if (promptEl.value.trim()) {
      promptError.hidden = true;
      promptEl.setAttribute("aria-invalid", "false");
    }
  });

  promptEl.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      runGenerate();
    }
  });

  cfgEl.addEventListener("input", updateRange);

  document.querySelectorAll(".example-card").forEach((card) => {
    card.addEventListener("click", () => {
      promptEl.value = card.dataset.prompt || "";
      updateCount();
      promptEl.focus();
      promptEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  });

  copyBtn.addEventListener("click", async () => {
    const label = $(".btn-text", copyBtn);
    if (!label) return;
    try {
      await navigator.clipboard.writeText(lastPrompt);
      label.textContent = "Tersalin";
      setTimeout(() => {
        label.textContent = "Salin prompt";
      }, 1400);
    } catch {
      label.textContent = "Gagal";
      setTimeout(() => {
        label.textContent = "Salin prompt";
      }, 1400);
    }
  });

  regenBtn.addEventListener("click", () => {
    promptEl.value = lastPrompt;
    negEl.value = lastNeg;
    setModelUI(lastModel);
    cfgEl.value = String(lastCfg);
    if (ratioEl) setRatioUI(lastRatio);
    updateCount();
    updateRange();
    runGenerate();
  });

  if (shareBtn) shareBtn.addEventListener("click", shareResult);

  retryBtn.addEventListener("click", () => {
    runGenerate();
  });

  resultImg.addEventListener("error", () => {
    if (stage.dataset.state !== "result") return;
    showError("Gambar gagal dimuat dari server hasil.");
    setStatus("error", "Gagal");
  });

  function smoothScrollTo(target) {
    const headerH =
      parseInt(
        getComputedStyle(document.documentElement).getPropertyValue("--header-h"),
        10
      ) || 64;
    const top =
      target.getBoundingClientRect().top + window.scrollY - headerH - 16;
    window.scrollTo({
      top,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }

  function initReveal() {
    const els = document.querySelectorAll(".reveal");
    if (!els.length) return;
    if (prefersReducedMotion() || !("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("is-visible"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    els.forEach((el) => io.observe(el));
  }

  function initSmoothAnchors() {
    document.querySelectorAll('a[href^="#"]').forEach((link) => {
      link.addEventListener("click", (e) => {
        const id = link.getAttribute("href");
        if (!id || id === "#") return;
        const target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();
        smoothScrollTo(target);
        history.replaceState(null, "", id);
      });
    });
  }

  // Riwayat generate: localStorage browser saja (konsisten dgn klaim privasi:
  // server tidak menyimpan apa pun). Maks 24 entri terakhir.
  const History = (() => {
    const KEY = "noisy-history-v1";
    const MAX = 24;
    const grid = $("#history-grid");
    const emptyEl = $("#history-empty");
    const clearBtn = $("#history-clear");
    if (!grid) return { add() {}, init() {} };

    function load() {
      try {
        const raw = localStorage.getItem(KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
      } catch {
        return [];
      }
    }

    function save(items) {
      try {
        localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX)));
      } catch {
        // Kuota penuh / mode privat: riwayat sesi ini dilewati diam-diam
      }
    }

    function fmtTime(ts) {
      try {
        return new Date(ts).toLocaleString("id-ID", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        });
      } catch {
        return "";
      }
    }

    function useItem(item) {
      promptEl.value = item.prompt || "";
      negEl.value = item.negativePrompt || "";
      setModelUI(item.model || modelEl.value);
      cfgEl.value = String(item.cfg || 7);
      if (ratioEl) setRatioUI(item.ratio || "1:1");
      updateCount();
      updateRange();
      promptError.hidden = true;
      promptEl.setAttribute("aria-invalid", "false");
      const target = document.querySelector(".workspace") || promptEl;
      target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
      promptEl.focus({ preventScroll: true });
    }

    function card(item) {
      const el = document.createElement("article");
      el.className = "history-card";
      el.setAttribute("role", "listitem");

      const thumb = document.createElement("button");
      thumb.type = "button";
      thumb.className = "history-thumb";
      thumb.title = "Pakai prompt ini";
      thumb.setAttribute("aria-label", `Pakai prompt: ${(item.prompt || "").slice(0, 60)}`);
      const img = document.createElement("img");
      img.src = item.url;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.addEventListener("error", () => img.remove());
      thumb.appendChild(img);
      if (item.mode === "demo") {
        const badge = document.createElement("span");
        badge.className = "history-mode";
        badge.textContent = "demo";
        thumb.appendChild(badge);
      }
      thumb.addEventListener("click", () => useItem(item));

      const body = document.createElement("div");
      body.className = "history-body";
      const p = document.createElement("p");
      p.className = "history-prompt";
      p.textContent = item.prompt || "(tanpa prompt)";
      const meta = document.createElement("p");
      meta.className = "mono history-meta";
      meta.textContent = [item.model, item.cfg != null ? `cfg ${item.cfg}` : "", item.ratio, fmtTime(item.ts)]
        .filter(Boolean)
        .join(" · ");

      const actions = document.createElement("div");
      actions.className = "history-actions";
      const useBtn = document.createElement("button");
      useBtn.type = "button";
      useBtn.className = "history-btn";
      useBtn.textContent = "Pakai";
      useBtn.addEventListener("click", () => useItem(item));
      const dl = document.createElement("a");
      dl.className = "history-btn";
      dl.href = downloadHref(item.url);
      dl.download = "noisy-generate.webp";
      dl.textContent = "Unduh";
      const del = document.createElement("button");
      del.type = "button";
      del.className = "history-btn history-btn--danger";
      del.textContent = "Hapus";
      del.addEventListener("click", () => remove(item.id));
      actions.append(useBtn, dl, del);

      body.append(p, meta, actions);
      el.append(thumb, body);
      return el;
    }

    function render() {
      const items = load();
      grid.textContent = "";
      items.forEach((item) => grid.appendChild(card(item)));
      const has = items.length > 0;
      if (emptyEl) emptyEl.hidden = has;
      if (clearBtn) clearBtn.hidden = !has;
    }

    function add(entry) {
      if (!entry || !entry.url) return;
      const items = load();
      items.unshift({
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        ...entry,
      });
      save(items);
      render();
    }

    function remove(id) {
      save(load().filter((item) => item.id !== id));
      render();
    }

    function init() {
      render();
      if (!clearBtn) return;
      const modal = $("#confirm-clear");
      const okBtn = $("#confirm-clear-ok");
      const cancelBtn = $("#confirm-clear-cancel");
      const desc = $("#confirm-clear-desc");
      if (!modal || !okBtn || !cancelBtn) return;
      let lastFocus = null;

      function openConfirm() {
        const n = load().length;
        if (!n) return;
        if (desc) {
          desc.textContent = `Seluruh ${n} riwayat di browser ini akan dihapus permanen.`;
        }
        lastFocus = document.activeElement;
        modal.hidden = false;
        document.body.style.overflow = "hidden";
        cancelBtn.focus();
      }

      function closeConfirm() {
        modal.hidden = true;
        document.body.style.overflow = "";
        if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
      }

      clearBtn.addEventListener("click", openConfirm);
      okBtn.addEventListener("click", () => {
        save([]);
        render();
        closeConfirm();
      });
      cancelBtn.addEventListener("click", closeConfirm);
      modal.addEventListener("click", (e) => {
        if (e.target === modal) closeConfirm();
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !modal.hidden) closeConfirm();
      });
    }

    return { add, init };
  })();

  updateCount();
  updateRange();
  initDetailsToggle($("#neg-details"));
  document.querySelectorAll(".faq-item").forEach(initDetailsToggle);
  initReveal();
  initSmoothAnchors();
  initModelPicker();
  initRatioPicker();
  initPromptTools();
  History.init();
  setModelUI(modelEl.value);
  setRatioUI(ratioEl ? ratioEl.value : "1:1");
  setView("empty");
})();
