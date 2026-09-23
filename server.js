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

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCwlO+boC6cwRo3UfXVBadaYwcX
0zKS2fuVNY2qZ0dgwb1NJ+/Q9FeAosL4ONiosD71on3PVYqRUlL5045mvH2K9i8b
AFVMEip7E6RMK6tKAAif7xzZrXnP1GZ5Rijtqdgwh+YmzTo39cuBCsZqK9oEoeQ3
r/myG9S+9cR5huTuFQIDAQAB
-----END PUBLIC KEY-----`;

// Kredensial HANYA dari env (.env lokal / Vercel dashboard). Tidak ada
// nilai asli di source agar aman di-push ke repo publik. Lihat .env.example.
const APP_ID = process.env.LIVE3D_APP_ID || "";
const U_ID = process.env.LIVE3D_U_ID || "";
const FN_NAME = process.env.LIVE3D_FN_NAME || "";
const BRAND_KEY = process.env.LIVE3D_BRAND_KEY || "";
const THEME_VERSION = process.env.LIVE3D_THEME_VERSION || "";

function credentialsReady() {
  return Boolean(APP_ID && U_ID && FN_NAME && BRAND_KEY && THEME_VERSION);
}

// Whitelist agar sampah tidak diteruskan ke provider.
const ALLOWED_MODELS = [
  "AbsoluteReality_v1.8.1.safetensors",
  "majicmixRealistic_v7.safetensors",
  "meinamix_meinaV11.safetensors",
];
const ALLOWED_DIMS = [
  [1024, 1024],
  [1024, 576],
  [1024, 768],
  [576, 1024],
];
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

const DEFAULT_NEGATIVE =
  "(worst quality, low quality:1.4), deformed, ugly, bad anatomy, bad hands, missing fingers, extra fingers, mutated hands, extra limbs, extra digit, fewer digit, blurry, out of focus, watermark, text, logo, signature, username, jpeg artifacts, grain, lowres, monochrome, duplicate, cropped, bad feet, error";

const QUALITY_TAIL =
  "masterpiece, best quality, ultra detailed, sharp focus, high resolution";

const COMMAND_PREFIX_RE =
  /^(?:tolong\s+|please\s+|mohon\s+)?(?:buatkan|buat|bikin|generate|create|render|saya\s+ingin|aku\s+ingin|mau|mw)\s+(?:saya\s+|aku\s+|sebuah\s+|satu\s+|a\s+|an\s+|the\s+|gambar\s+|foto\s+|photo\s+|image\s+|picture\s+|potrait\s+|portrait\s+)*/i;

const ID_TO_EN = [
  // --- Frasa majemuk & reduplikasi: wajib SEBELUM kata tunggalnya ---
  // Paling panjang dulu agar tidak terpotong oleh aturan yg lebih pendek
  [/\bdi luar angkasa\b/gi, "in outer space"],
  [/\bbintang-bintang\b/gi, "stars"],
  [/\bawan-awan\b/gi, "clouds"],
  [/\bbunga-bunga\b/gi, "flowers"],
  [/\bpohon-pohon\b/gi, "trees"],
  [/\bbukit-bukit\b/gi, "hills"],
  [/\bgagah berani\b/gi, "brave"],
  [/\bberambut panjang\b/gi, "long hair"],
  [/\bberambut pendek\b/gi, "short hair"],
  [/\bcat air\b/gi, "watercolor"],
  [/\bmalam hari\b/gi, "night"],
  [/\bpagi hari\b/gi, "morning"],
  [/\bsore hari\b/gi, "golden hour"],
  [/\bsiang hari\b/gi, "daytime"],
  [/\bdi atas\b/gi, "above"],
  [/\bdi bawah\b/gi, "under"],
  [/\bdi dalam\b/gi, "inside"],
  [/\bdi luar\b/gi, "outside"],
  [/\bdi samping\b/gi, "beside"],
  [/\bdi depan\b/gi, "in front of"],
  [/\bdi belakang\b/gi, "behind"],
  [/\bdi tengah\b/gi, "in the middle of"],
  [/\bdi dekat\b/gi, "near"],
  [/\banak laki-laki\b/gi, "boy"],
  [/\banak perempuan\b/gi, "girl"],
  [/\borang tua\b/gi, "elderly person"],
  [/\btengah malam\b/gi, "midnight"],
  [/\blatar belakang\b/gi, "background"],
  [/\blatar depan\b/gi, "foreground"],
  [/\bhitam putih\b/gi, "black and white"],
  [/\bmerah muda\b/gi, "pink"],
  [/\bair terjun\b/gi, "waterfall"],
  [/\bes krim\b/gi, "ice cream"],
  [/\bmatahari terbenam\b/gi, "sunset"],
  [/\bluar angkasa\b/gi, "outer space"],
  [/\bseluruh badan\b/gi, "full body"],
  [/\bsetengah badan\b/gi, "upper body"],
  [/\bjarak dekat\b/gi, "close-up"],
  [/\brumah sakit\b/gi, "hospital"],
  [/\bkamar tidur\b/gi, "bedroom"],
  [/\bruang tamu\b/gi, "living room"],
  [/\bkolam renang\b/gi, "swimming pool"],
  [/\bair mancur\b/gi, "fountain"],
  [/\blampu jalan\b/gi, "street lamp"],
  [/\bgunung berapi\b/gi, "volcano"],
  [/\bmusim dingin\b/gi, "winter"],
  [/\bmusim panas\b/gi, "summer"],
  [/\bmusim hujan\b/gi, "rainy season"],
  [/\bmusim semi\b/gi, "spring"],
  [/\bmusim gugur\b/gi, "autumn"],
  [/\bmasa depan\b/gi, "future"],
  [/\bbaju besi\b/gi, "armor"],
  [/\bjam tangan\b/gi, "wristwatch"],
  [/\bkaca mata\b/gi, "glasses"],
  [/\btempat tidur\b/gi, "bed"],

  // --- Kata ganti/penunjuk & partikel yg merusak grammar Inggris: buang saja ---
  [/\byang\b/gi, ""],
  [/\bsaya\b/gi, ""],
  [/\baku\b/gi, ""],
  [/\bkamu\b/gi, ""],
  [/\bkita\b/gi, ""],
  [/\bmereka\b/gi, ""],
  [/\bdia\b/gi, ""],
  [/\bini\b/gi, ""],
  [/\bitu\b/gi, ""],
  [/\btersebut\b/gi, ""],
  [/\bpara\b/gi, ""],
  [/\bada\b/gi, ""],
  [/\badalah\b/gi, ""],
  [/\bsedang\b/gi, ""],
  [/\bsaat\b/gi, ""],
  [/\bhari\b/gi, ""],
  [/\bberwarna\b/gi, ""],

  // --- Artikel & penegas jumlah ---
  [/\bsebuah\b/gi, "a"],
  [/\bseekor\b/gi, "a"],
  [/\bseorang\b/gi, "a"],
  [/\bsatu\b/gi, "one"],

  // --- Negasi, penghubung & intensitas ---
  [/\btidak\b/gi, "no"],
  [/\bjangan\b/gi, "no"],
  [/\bbukan\b/gi, "no"],
  [/\btanpa\b/gi, "without"],
  [/\bsangat\b/gi, "very"],
  [/\bpaling\b/gi, "most"],
  [/\bkurang\b/gi, "less"],
  [/\bagak\b/gi, "slightly"],
  [/\bcukup\b/gi, "quite"],
  [/\bterlalu\b/gi, "too"],
  [/\batau\b/gi, "or"],
  [/\btapi\b/gi, "but"],
  [/\btetapi\b/gi, "but"],
  [/\bseperti\b/gi, "like"],
  [/\bsambil\b/gi, "while"],
  [/\bpada\b/gi, "on"],
  [/\boleh\b/gi, "by"],
  [/\btentang\b/gi, "about"],
  [/\bsebagai\b/gi, "as"],
  [/\bterbuat\b/gi, "made"],

  // --- Orang ---
  [/\bwanita\b/gi, "woman"],
  [/\bperempuan\b/gi, "woman"],
  [/\bpria\b/gi, "man"],
  [/\blelaki\b/gi, "man"],
  [/\blaki-laki\b/gi, "man"],
  [/\bcantik\b/gi, "beautiful"],
  [/\bganteng\b/gi, "handsome"],
  [/\bcowok\b/gi, "young man"],
  [/\bcewek\b/gi, "young woman"],
  [/\bgadis\b/gi, "young woman"],
  [/\banak\b/gi, "child"],
  [/\bbayi\b/gi, "baby"],
  [/\bkakek\b/gi, "grandfather"],
  [/\bnenek\b/gi, "grandmother"],
  [/\bkeluarga\b/gi, "family"],
  [/\bteman\b/gi, "friend"],
  [/\borang\b/gi, "person"],
  [/\bmanusia\b/gi, "human"],
  [/\braja\b/gi, "king"],
  [/\bratu\b/gi, "queen"],
  [/\bputri\b/gi, "princess"],
  [/\bpangeran\b/gi, "prince"],
  [/\bprajurit\b/gi, "warrior"],
  [/\btentara\b/gi, "soldier"],
  [/\bksatria\b/gi, "knight"],
  [/\bpahlawan\b/gi, "hero"],
  [/\bpetani\b/gi, "farmer"],
  [/\bdokter\b/gi, "doctor"],
  [/\bpolisi\b/gi, "police"],
  [/\bguru\b/gi, "teacher"],
  [/\bastronot\b/gi, "astronaut"],
  [/\bpilot\b/gi, "pilot"],
  [/\bkoki\b/gi, "chef"],
  [/\bpenyihir\b/gi, "wizard"],
  [/\brobot\b/gi, "robot"],
  [/\balien\b/gi, "alien"],
  [/\bzombie\b/gi, "zombie"],
  [/\bvampir\b/gi, "vampire"],
  [/\bperi\b/gi, "fairy"],
  [/\bkurcaci\b/gi, "dwarf"],
  [/\bdewa\b/gi, "god"],
  [/\bdewi\b/gi, "goddess"],
  [/\bmalaikat\b/gi, "angel"],
  [/\biblis\b/gi, "demon"],
  [/\bhantu\b/gi, "ghost"],

  // --- Tubuh & pakaian ---
  [/\bwajah\b/gi, "face"],
  [/\bmata\b/gi, "eyes"],
  [/\brambut\b/gi, "hair"],
  [/\bkulit\b/gi, "skin"],
  [/\btopi\b/gi, "hat"],
  [/\bhelm\b/gi, "helmet"],
  [/\bsepatu\b/gi, "shoes"],
  [/\bsandal\b/gi, "sandals"],
  [/\btas\b/gi, "bag"],
  [/\bkacamata\b/gi, "glasses"],
  [/\bpayung\b/gi, "umbrella"],
  [/\bmahkota\b/gi, "crown"],
  [/\bkalung\b/gi, "necklace"],
  [/\bgelang\b/gi, "bracelet"],
  [/\bcincin\b/gi, "ring"],
  [/\bjubah\b/gi, "cloak"],
  [/\bgaun\b/gi, "gown"],
  [/\bseragam\b/gi, "uniform"],
  [/\bjas\b/gi, "suit"],
  [/\bdasi\b/gi, "tie"],
  [/\bkerudung\b/gi, "hijab"],
  [/\bjilbab\b/gi, "hijab"],
  [/\bjaket\b/gi, "jacket"],
  [/\bpakaian\b/gi, "clothing"],
  [/\bbaju\b/gi, "clothes"],
  [/\bcelana\b/gi, "pants"],
  [/\brok\b/gi, "skirt"],

  // --- Kata kerja ---
  [/\bberdiri\b/gi, "standing"],
  [/\bduduk\b/gi, "sitting"],
  [/\bberlari\b/gi, "running"],
  [/\bberjalan\b/gi, "walking"],
  [/\bterbang\b/gi, "flying"],
  [/\bberenang\b/gi, "swimming"],
  [/\bmemegang\b/gi, "holding"],
  [/\bmembawa\b/gi, "carrying"],
  [/\bmenatap\b/gi, "gazing"],
  [/\bmelihat\b/gi, "looking"],
  [/\btersenyum\b/gi, "smiling"],
  [/\btertawa\b/gi, "laughing"],
  [/\bmenangis\b/gi, "crying"],
  [/\btidur\b/gi, "sleeping"],
  [/\bmakan\b/gi, "eating"],
  [/\bminum\b/gi, "drinking"],
  [/\bmemakai\b/gi, "wearing"],
  [/\bmenggunakan\b/gi, "using"],
  [/\bmenari\b/gi, "dancing"],
  [/\bbernyanyi\b/gi, "singing"],
  [/\bbermain\b/gi, "playing"],
  [/\bmembaca\b/gi, "reading"],
  [/\bmenulis\b/gi, "writing"],
  [/\bmenggambar\b/gi, "drawing"],
  [/\bmelukis\b/gi, "painting"],
  [/\bmelompat\b/gi, "jumping"],
  [/\bberjuang\b/gi, "fighting"],
  [/\bmemotret\b/gi, "photographing"],

  // --- Alam & cuaca ---
  [/\blangit\b/gi, "sky"],
  [/\bawan\b/gi, "cloud"],
  [/\bmatahari\b/gi, "sun"],
  [/\bbulan\b/gi, "moon"],
  [/\bbintang\b/gi, "star"],
  [/\blaut\b/gi, "sea"],
  [/\bdanau\b/gi, "lake"],
  [/\bapi\b/gi, "fire"],
  [/\bair\b/gi, "water"],
  [/\bes\b/gi, "ice"],
  [/\bsalju\b/gi, "snow"],
  [/\bkabut\b/gi, "fog"],
  [/\basap\b/gi, "smoke"],
  [/\bbadai\b/gi, "storm"],
  [/\bpetir\b/gi, "lightning"],
  [/\bangin\b/gi, "wind"],
  [/\bombak\b/gi, "waves"],
  [/\bpasir\b/gi, "sand"],
  [/\bbatu\b/gi, "rock"],
  [/\bgurun\b/gi, "desert"],
  [/\blembah\b/gi, "valley"],
  [/\btebing\b/gi, "cliff"],
  [/\bgua\b/gi, "cave"],
  [/\bpulau\b/gi, "island"],
  [/\bsawah\b/gi, "rice field"],
  [/\bladang\b/gi, "field"],
  [/\btaman\b/gi, "garden"],
  [/\bdesa\b/gi, "village"],
  [/\bpelangi\b/gi, "rainbow"],
  [/\bhutan\b/gi, "forest"],
  [/\bpantai\b/gi, "beach"],
  [/\bgunung\b/gi, "mountain"],
  [/\bsungai\b/gi, "river"],
  [/\bpohon\b/gi, "tree"],
  [/\bbunga\b/gi, "flower"],
  [/\bkota\b/gi, "city"],
  [/\bpedesaan\b/gi, "countryside"],

  // --- Hewan ---
  [/\bharimau\b/gi, "tiger"],
  [/\bmacan\b/gi, "tiger"],
  [/\bkucing\b/gi, "cat"],
  [/\banjing\b/gi, "dog"],
  [/\bburung\b/gi, "bird"],
  [/\belang\b/gi, "eagle"],
  [/\bgagak\b/gi, "crow"],
  [/\bmerpati\b/gi, "dove"],
  [/\bnaga\b/gi, "dragon"],
  [/\bserigala\b/gi, "wolf"],
  [/\bsinga\b/gi, "lion"],
  [/\bgajah\b/gi, "elephant"],
  [/\bkuda\b/gi, "horse"],
  [/\bsapi\b/gi, "cow"],
  [/\bkambing\b/gi, "goat"],
  [/\bdomba\b/gi, "sheep"],
  [/\bayam\b/gi, "chicken"],
  [/\bbebek\b/gi, "duck"],
  [/\bikan\b/gi, "fish"],
  [/\bhiu\b/gi, "shark"],
  [/\bpaus\b/gi, "whale"],
  [/\blumba-lumba\b/gi, "dolphin"],
  [/\bular\b/gi, "snake"],
  [/\bkupu-kupu\b/gi, "butterfly"],
  [/\blebah\b/gi, "bee"],
  [/\blaba-laba\b/gi, "spider"],
  [/\bsemut\b/gi, "ant"],
  [/\bmonyet\b/gi, "monkey"],
  [/\bkelinci\b/gi, "rabbit"],
  [/\btikus\b/gi, "mouse"],
  [/\bkura-kura\b/gi, "turtle"],
  [/\bkatak\b/gi, "frog"],
  [/\bbuaya\b/gi, "crocodile"],
  [/\bkadal\b/gi, "lizard"],
  [/\bberuang\b/gi, "bear"],
  [/\bpanda\b/gi, "panda"],
  [/\bjerapah\b/gi, "giraffe"],
  [/\bzebra\b/gi, "zebra"],
  [/\bbadak\b/gi, "rhino"],
  [/\brusa\b/gi, "deer"],
  [/\brubah\b/gi, "fox"],

  // --- Tempat & benda ---
  [/\bgedung\b/gi, "building"],
  [/\brumah\b/gi, "house"],
  [/\bjalan\b/gi, "street"],
  [/\bpasar\b/gi, "market"],
  [/\bsekolah\b/gi, "school"],
  [/\btoko\b/gi, "store"],
  [/\bkantor\b/gi, "office"],
  [/\bpabrik\b/gi, "factory"],
  [/\bgereja\b/gi, "church"],
  [/\bmasjid\b/gi, "mosque"],
  [/\bperpustakaan\b/gi, "library"],
  [/\bmuseum\b/gi, "museum"],
  [/\bistana\b/gi, "palace"],
  [/\bkuil\b/gi, "temple"],
  [/\bcandi\b/gi, "temple"],
  [/\bkastil\b/gi, "castle"],
  [/\bmenara\b/gi, "tower"],
  [/\bjembatan\b/gi, "bridge"],
  [/\bkapal\b/gi, "ship"],
  [/\bperahu\b/gi, "boat"],
  [/\bpesawat\b/gi, "airplane"],
  [/\bkereta\b/gi, "train"],
  [/\bmobil\b/gi, "car"],
  [/\bmotor\b/gi, "motorcycle"],
  [/\bsepeda\b/gi, "bicycle"],
  [/\bdapur\b/gi, "kitchen"],
  [/\bkamar\b/gi, "room"],
  [/\bmeja\b/gi, "table"],
  [/\bkursi\b/gi, "chair"],
  [/\bsofa\b/gi, "sofa"],
  [/\bcermin\b/gi, "mirror"],
  [/\bjendela\b/gi, "window"],
  [/\bpintu\b/gi, "door"],
  [/\bdinding\b/gi, "wall"],
  [/\blantai\b/gi, "floor"],
  [/\batap\b/gi, "roof"],
  [/\btangga\b/gi, "stairs"],
  [/\bpagar\b/gi, "fence"],
  [/\bpatung\b/gi, "statue"],
  [/\blukisan\b/gi, "painting"],
  [/\btrotoar\b/gi, "sidewalk"],
  [/\blampu\b/gi, "lamp"],
  [/\blilin\b/gi, "candle"],
  [/\bkayu\b/gi, "wood"],
  [/\bbesi\b/gi, "metal"],
  [/\bkaca\b/gi, "glass"],
  [/\bkertas\b/gi, "paper"],
  [/\bkain\b/gi, "fabric"],
  [/\bplastik\b/gi, "plastic"],
  [/\bpedang\b/gi, "sword"],
  [/\bperisai\b/gi, "shield"],
  [/\bpanah\b/gi, "arrow"],
  [/\bbusur\b/gi, "bow"],
  [/\btombak\b/gi, "spear"],
  [/\bkapak\b/gi, "axe"],
  [/\bpistol\b/gi, "gun"],
  [/\bpisau\b/gi, "knife"],

  // --- Makanan & minuman ---
  [/\bkuliner\b/gi, "food"],
  [/\bmakanan\b/gi, "food"],
  [/\bminuman\b/gi, "drink"],
  [/\bnasi\b/gi, "rice"],
  [/\bmie\b/gi, "noodles"],
  [/\broti\b/gi, "bread"],
  [/\bkue\b/gi, "cake"],
  [/\bcoklat\b/gi, "chocolate"],
  [/\bkopi\b/gi, "coffee"],
  [/\bteh\b/gi, "tea"],
  [/\bsusu\b/gi, "milk"],
  [/\bbuah\b/gi, "fruit"],
  [/\bapel\b/gi, "apple"],
  [/\bjeruk\b/gi, "orange"],
  [/\bpisang\b/gi, "banana"],
  [/\banggur\b/gi, "grapes"],
  [/\bstroberi\b/gi, "strawberry"],
  [/\bsemangka\b/gi, "watermelon"],
  [/\bmangga\b/gi, "mango"],
  [/\bkelapa\b/gi, "coconut"],
  [/\bdurian\b/gi, "durian"],
  [/\btelur\b/gi, "egg"],
  [/\bdaging\b/gi, "meat"],
  [/\bsayur\b/gi, "vegetables"],

  // --- Warna ---
  [/\bmerah\b/gi, "red"],
  [/\bbiru\b/gi, "blue"],
  [/\bhijau\b/gi, "green"],
  [/\bkuning\b/gi, "yellow"],
  [/\bputih\b/gi, "white"],
  [/\bhitam\b/gi, "black"],
  [/\bungu\b/gi, "purple"],
  [/\boranye\b/gi, "orange"],
  [/\bcoklat\b/gi, "brown"],
  [/\babu-abu\b/gi, "gray"],
  [/\bemas\b/gi, "gold"],
  [/\bperak\b/gi, "silver"],
  [/\bpink\b/gi, "pink"],
  [/\bkrem\b/gi, "cream"],

  // --- Sifat tambahan yg sempat bocor ---
  [/\breflektif\b/gi, "reflective"],
  [/\btropis\b/gi, "tropical"],
  [/\bgagah\b/gi, "brave"],
  [/\bberani\b/gi, "brave"],
  [/\bmegah\b/gi, "majestic"],
  [/\blayangan\b/gi, "kite"],
  [/\bsecangkir\b/gi, "a cup of"],
  [/\bpanas\b/gi, "hot"],
  [/\bjernih\b/gi, "clear"],
  [/\bberambut\b/gi, "hair"],
  [/\bbahasa\b/gi, "language"],
  [/\bInggris\b/gi, "English"],
  [/\bmurni\b/gi, "pure"],
  [/\bterkenal\b/gi, "famous"],
  [/\bpopuler\b/gi, "popular"],
  [/\bkuno\b/gi, "ancient"],
  [/\bkhusus\b/gi, "special"],
  [/\bangkasa\b/gi, "space"],

  // --- Sifat ---
  [/\bbesar\b/gi, "big"],
  [/\bkecil\b/gi, "small"],
  [/\braksasa\b/gi, "giant"],
  [/\btinggi\b/gi, "tall"],
  [/\bpendek\b/gi, "short"],
  [/\bgemuk\b/gi, "chubby"],
  [/\bkurus\b/gi, "slim"],
  [/\btua\b/gi, "old"],
  [/\bmuda\b/gi, "young"],
  [/\bbaru\b/gi, "new"],
  [/\bkuno\b/gi, "ancient"],
  [/\bmodern\b/gi, "modern"],
  [/\btradisional\b/gi, "traditional"],
  [/\bfuturistik\b/gi, "futuristic"],
  [/\bindah\b/gi, "beautiful"],
  [/\bjelek\b/gi, "ugly"],
  [/\blucu\b/gi, "cute"],
  [/\bseram\b/gi, "creepy"],
  [/\bmenakutkan\b/gi, "scary"],
  [/\bhangat\b/gi, "warm"],
  [/\bdingin\b/gi, "cold"],
  [/\bsejuk\b/gi, "cool"],
  [/\bcerah\b/gi, "bright"],
  [/\bmendung\b/gi, "cloudy"],
  [/\bsibuk\b/gi, "busy"],
  [/\bsepi\b/gi, "quiet"],
  [/\bramai\b/gi, "crowded"],
  [/\bmewah\b/gi, "luxurious"],
  [/\bsederhana\b/gi, "simple"],
  [/\bcepat\b/gi, "fast"],
  [/\blambat\b/gi, "slow"],
  [/\bkuat\b/gi, "strong"],
  [/\blemah\b/gi, "weak"],
  [/\bbahagia\b/gi, "happy"],
  [/\bsedih\b/gi, "sad"],
  [/\bmarah\b/gi, "angry"],
  [/\btakut\b/gi, "scared"],
  [/\bbersih\b/gi, "clean"],
  [/\bkotor\b/gi, "dirty"],
  [/\bbasah\b/gi, "wet"],
  [/\bkering\b/gi, "dry"],
  [/\btajam\b/gi, "sharp"],
  [/\bhalus\b/gi, "smooth"],
  [/\bberat\b/gi, "heavy"],
  [/\bringan\b/gi, "light"],
  [/\bmisterius\b/gi, "mysterious"],
  [/\bmagis\b/gi, "magical"],
  [/\bepik\b/gi, "epic"],
  [/\bdramatis\b/gi, "dramatic"],
  [/\bromantis\b/gi, "romantic"],
  [/\bsuci\b/gi, "sacred"],
  [/\bjahat\b/gi, "evil"],
  [/\bdetail\b/gi, "detailed"],
  [/\bnyata\b/gi, "realistic"],
  [/\brealistis\b/gi, "photorealistic"],
  [/\bfiksi\b/gi, "fiction"],
  [/\bfantasi\b/gi, "fantasy"],
  [/\bpetualangan\b/gi, "adventure"],
  [/\bpertempuran\b/gi, "battle"],

  // --- Posisi ---
  [/\batas\b/gi, "above"],
  [/\bbawah\b/gi, "under"],
  [/\bdepan\b/gi, "front"],
  [/\bbelakang\b/gi, "behind"],
  [/\bsamping\b/gi, "beside"],
  [/\btengah\b/gi, "center"],
  [/\bdalam\b/gi, "inside"],
  [/\bluar\b/gi, "outside"],
  [/\bdekat\b/gi, "near"],
  [/\bjauh\b/gi, "far"],
  [/\bkiri\b/gi, "left"],
  [/\bkanan\b/gi, "right"],
  [/\bantara\b/gi, "between"],
  [/\bseberang\b/gi, "across"],
  [/\bsekitar\b/gi, "around"],

  // --- Waktu ---
  [/\bpagi\b/gi, "morning"],
  [/\bsiang\b/gi, "daytime"],
  [/\bsore\b/gi, "golden hour"],
  [/\bsenja\b/gi, "sunset"],
  [/\bfajar\b/gi, "dawn"],
  [/\bsubuh\b/gi, "dawn"],
  [/\bmalam\b/gi, "night"],

  // --- Seni, foto & konsep ---
  [/\btema\b/gi, "theme"],
  [/\bkonsep\b/gi, "concept"],
  [/\bdesain\b/gi, "design"],
  [/\bsketsa\b/gi, "sketch"],
  [/\bkartun\b/gi, "cartoon"],
  [/\bkomik\b/gi, "comic"],
  [/\bkarikatur\b/gi, "caricature"],
  [/\bposter\b/gi, "poster"],
  [/\bwallpaper\b/gi, "wallpaper"],
  [/\bgrup\b/gi, "group"],
  [/\bkamera\b/gi, "camera"],
  [/\bfokus\b/gi, "focus"],
  [/\bmakro\b/gi, "macro"],
  [/\bsiluet\b/gi, "silhouette"],
  [/\brefleksi\b/gi, "reflection"],
  [/\bbayangan\b/gi, "shadow"],
  [/\bpencahayaan\b/gi, "lighting"],
  [/\bbersinar\b/gi, "glowing"],
  [/\bkilau\b/gi, "glow"],
  [/\bgaya\b/gi, "style"],
  [/\bpotret\b/gi, "portrait"],
  [/\bpotrait\b/gi, "portrait"],
  [/\bwajah\b/gi, "face"],
  [/\bfoto\b/gi, "photo"],
  [/\bgambar\b/gi, "image"],
  [/\bcahaya\b/gi, "lighting"],
  [/\bterang\b/gi, "bright"],
  [/\bgelap\b/gi, "dark"],
  [/\bhujan\b/gi, "rain"],
  [/\bpemandangan\b/gi, "scenery"],
  [/\blanskap\b/gi, "landscape"],
  [/\bstudio\b/gi, "studio"],
  [/\blensa\b/gi, "lens"],
  [/\bsudut\b/gi, "angle"],
  [/\bcinema\b/gi, "cinematic"],
  [/\bsinematik\b/gi, "cinematic"],
  [/\banime\b/gi, "anime"],
  [/\bdengan\b/gi, "with"],
  [/\bdan\b/gi, "and"],
  [/\bdi\b(?=\s)/gi, "in"],
  [/\bke\b(?=\s)/gi, "to"],
  [/\buntuk\b/gi, "for"],
  [/\bdari\b/gi, "from"],

  // --- Lainnya ---
  [/\bcinta\b/gi, "love"],
  [/\bhati\b/gi, "heart"],
  [/\bperang\b/gi, "war"],
  [/\bdamai\b/gi, "peaceful"],
  [/\bmimpi\b/gi, "dream"],
  [/\bdunia\b/gi, "world"],
  [/\balam\b/gi, "nature"],
  [/\bsemesta\b/gi, "universe"],
  [/\bsurga\b/gi, "heaven"],
  [/\bneraka\b/gi, "hell"],
  [/\bsihir\b/gi, "magic"],
  [/\bbudaya\b/gi, "culture"],
];

function enhancePrompt(raw) {
  let p = String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!p) return "";

  for (let i = 0; i < 4; i++) {
    const next = p.replace(COMMAND_PREFIX_RE, "").trim();
    if (next === p) break;
    p = next;
  }

  // Lindungi frasa Inggris yg mengandung kata yg ejaannya bentrok dgn ID
  // mis. "hot air balloon" -> jangan jadi "hot water balloon" karena \bair\b
  const GUARDS = [[/\bhot air balloon\b/gi, "__HOT_AIR_BALLOON__"]];
  const GUARD_VALUES = { __HOT_AIR_BALLOON__: "hot air balloon" };
  for (const [re, ph] of GUARDS) p = p.replace(re, ph);

  for (const [re, en] of ID_TO_EN) {
    p = p.replace(re, en);
  }

  for (const [ph, val] of Object.entries(GUARD_VALUES)) {
    p = p.split(ph).join(val);
  }

  // Normalisasi reduplikasi Inggris yg tersisa dari hasil translate: star-star -> stars
  p = p.replace(/\b(\w+)-\1\b/gi, (m, w) => w + "s");

  // Bersihkan sisa spasi/koma ganda akibat kata yg dibuang (mis. "yang", "saya")
  p = p
    .replace(/\s{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .trim();

  p = p
    .replace(/[.!?]+\s*$/, "")
    .replace(/\s*,\s*$/, "")
    .trim();

  const hasQuality = /masterpiece|best quality|ultra detailed|high resolution/i.test(
    p
  );
  if (!hasQuality && p) {
    p = `${p}, ${QUALITY_TAIL}`;
  }

  return p.slice(0, 2000);
}

function mergeNegative(userNeg) {
  const user = String(userNeg || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/,\s*$/, "");
  if (!user) return DEFAULT_NEGATIVE;
  return `${user}, ${DEFAULT_NEGATIVE}`.slice(0, 1000);
}

function tuneCfg(cfg, model) {
  let value = Number(cfg);
  if (!Number.isFinite(value) || value < 1 || value > 20) value = 7;
  if (/meinamix/i.test(model || "") && value > 9) value = 9;
  if (/absolute|majicmix/i.test(model || "") && value < 5) value = 5;
  return value;
}

function generateRandomString(len) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let res = "";
  for (let i = 0; i < len; i++)
    res += chars.charAt(Math.floor(Math.random() * chars.length));
  return res;
}

function aesenc(data, key) {
  const k = CryptoJS.enc.Utf8.parse(key);
  const encrypted = CryptoJS.AES.encrypt(data, k, {
    iv: k,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  return encrypted.toString();
}

function rsaenc(data) {
  const buffer = Buffer.from(data, "utf8");
  const encrypted = crypto.publicEncrypt(
    { key: PUBLIC_KEY, padding: crypto.constants.RSA_PKCS1_PADDING },
    buffer
  );
  return encrypted.toString("base64");
}

function gencryptoheaders(type, fp = null) {
  const fingerPrint = fp || crypto.randomBytes(16).toString("hex");
  const i = generateRandomString(16);
  const s = rsaenc(i);
  return {
    fp: fingerPrint,
    fp1: aesenc(`${APP_ID}:${fingerPrint}`, i),
    "x-guide": s,
    "x-code": Date.now().toString(),
  };
}

function browserHeaders(fp, nonce) {
  const ch = gencryptoheaders("create", fp);
  const headers = {
    "User-Agent": UA,
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    "accept-language": "en-US",
    fp: ch.fp,
    fp1: ch.fp1,
    "x-guide": ch["x-guide"],
    "x-code": ch["x-code"],
    "theme-version": THEME_VERSION,
    "brand-key": BRAND_KEY,
    Referer: "https://live3d.io/",
    "sec-ch-ua": '"Chromium";v="153", "Not_A Brand";v="8"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-site": "same-site",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
    Origin: "https://live3d.io",
  };
  if (nonce) headers.nonce = nonce;
  return headers;
}

async function createAiBodyJob(
  prompt,
  negativePrompt,
  model = "AbsoluteReality_v1.8.1.safetensors",
  cfg = 7,
  width = 1024,
  height = 1024
) {
  const fp = crypto.randomBytes(16).toString("hex");
  const payload = {
    fn_name: FN_NAME,
    call_type: 3,
    data: "",
    input: {
      cfg: cfg,
      lora: [],
      model: model,
      negative_prompt: negativePrompt || DEFAULT_NEGATIVE,
      prompt: prompt,
      request_from: 9,
      width: Number(width) || 1024,
      height: Number(height) || 1024,
    },
    request_from: 9,
    origin_from: BRAND_KEY,
  };

  const res = await axios.post(
    "https://app-v1.live3d.io/aitools/of/create",
    payload,
    {
      headers: browserHeaders(fp, FN_NAME),
      timeout: 30000,
    }
  );

  if (res.data.code !== 200)
    throw new Error(
      res.data.detail || res.data.message || "Failed to create job"
    );
  return { taskId: res.data.data.task_id, fp };
}

async function cekjob(taskId, fp) {
  const res = await axios.post(
    "https://app-v1.live3d.io/aitools/of/check-status",
    {
      task_id: taskId,
      fn_name: FN_NAME,
      call_type: 3,
      request_from: 9,
      origin_from: BRAND_KEY,
    },
    {
      headers: browserHeaders(fp),
      timeout: 30000,
    }
  );
  return res.data.data;
}

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

// Diekspor agar bisa dipakai unit test & Vercel functions tanpa duplikasi.
module.exports = {
  app,
  enhancePrompt,
  mergeNegative,
  tuneCfg,
  createAiBodyJob,
  cekjob,
  credentialsReady,
  ALLOWED_MODELS,
  ALLOWED_DIMS,
  DEFAULT_NEGATIVE,
};
