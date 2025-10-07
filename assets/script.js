/* 実用重視。プライベート関数は先頭にアンダースコア */

// DOM elements - initialized after DOM load
let _canvas, _ctx, _input, _btnView, _btnSave, _btnSpeak, _btnViewEdit, _btnTheme, _topbar, _viewControls;

// These can be accessed immediately
const _rootStyle = document.documentElement.style;
const _mobileQuery = window.matchMedia("(max-width: 640px)");
const _metaThemeColor = document.querySelector('meta[name="theme-color"]');
const _prefersDarkQuery = window.matchMedia?.("(prefers-color-scheme: dark)");

let _mode = "edit"; // 'edit' or 'view'
let _lastText = "";
let _devicePixelRatio = Math.max(window.devicePixelRatio || 1, 1);
let _theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
const _padding = 24; // canvas 内余白
const _lineHeightRatioBase = 1.02; // 単一行の行間比
const _lineHeightRatioMulti = 1.18; // 複数行時に少し広げる
const _fontFamily = "sans-serif";

function _initDOMElements() {
  _canvas = document.getElementById("canvas");
  _ctx = _canvas.getContext("2d");
  _input = document.getElementById("input");
  _btnView = document.getElementById("btnView");
  _btnSave = document.getElementById("btnSave");
  _btnSpeak = document.getElementById("btnSpeak");
  _btnViewEdit = document.getElementById("btnViewEdit");
  _btnTheme = document.getElementById("btnTheme");
  _topbar = document.querySelector(".topbar");
  _viewControls = document.querySelector(".view-controls");

  // Initialize _lastText with input value
  _lastText = _input.value || "";
}

function _readStoredTheme() {
  try {
    const stored = localStorage.getItem("bigtext-theme");
    return stored === "light" || stored === "dark" ? stored : null;
  } catch (err) {
    return null;
  }
}

function _updateThemeMeta() {
  if (!_metaThemeColor) return;
  const styles = getComputedStyle(document.documentElement);
  const themeColor = styles.getPropertyValue("--bg").trim();
  if (themeColor) {
    _metaThemeColor.setAttribute("content", themeColor);
  }
}

function _refreshThemeToggle() {
  if (!_btnTheme) return;
  const isDark = _theme === "dark";
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";
  _btnTheme.setAttribute("aria-pressed", String(!isDark));
  _btnTheme.setAttribute("aria-label", label);
  _btnTheme.title = label;
  let span = _btnTheme.querySelector("span");
  if (!span) {
    span = document.createElement("span");
    span.setAttribute("aria-hidden", "true");
    _btnTheme.appendChild(span);
  }
  span.textContent = isDark ? "🌙" : "☀️";
}

function _setTheme(theme, persist = true) {
  _theme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = _theme;
  if (persist) {
    try {
      localStorage.setItem("bigtext-theme", _theme);
    } catch (err) {
      /* ignore */
    }
  }
  _updateThemeMeta();
  _refreshThemeToggle();
  if (_mode === "view") {
    requestAnimationFrame(_drawText);
  }
}

function _toggleTheme() {
  _setTheme(_theme === "dark" ? "light" : "dark");
}

(function initTheme() {
  const stored = _readStoredTheme();
  if (stored) {
    _theme = stored;
  }
  _setTheme(_theme, false);
  if (_prefersDarkQuery) {
    const handlePrefersChange = (e) => {
      if (_readStoredTheme()) return;
      _setTheme(e.matches ? "dark" : "light", false);
    };
    if (typeof _prefersDarkQuery.addEventListener === "function") {
      _prefersDarkQuery.addEventListener("change", handlePrefersChange);
    }
  }
})();

/* キャンバスリサイズ（高DPI対応） */
function _resizeCanvas() {
  const rect = _canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width * _devicePixelRatio));
  const h = Math.max(1, Math.floor(rect.height * _devicePixelRatio));
  if (_canvas.width !== w || _canvas.height !== h) {
    _canvas.width = w;
    _canvas.height = h;
    _ctx.setTransform(_devicePixelRatio, 0, 0, _devicePixelRatio, 0, 0);
  }
}

/* テキスト行に分割（改行コードを正規化してから '\n' で分割）。空行はスペース1つに */
function _toLines(text) {
  if (typeof text !== "string") return [" "];
  const normalized = text.replace(/\r\n?|\u2028|\u2029/g, "\n"); // CRLF/CR/LS/PS → \n
  return normalized.split("\n").map((l) => (l === "" ? " " : l));
}

/* 指定フォントサイズでテキストが収まるか判定 */
function _fits(fontSize, lines, cw, ch) {
  _ctx.font = `${fontSize}px ${_fontFamily}`;
  const maxW = cw - _padding * 2;
  for (let line of lines) {
    const m = _ctx.measureText(line);
    if (m.width > maxW + 1) return false;
  }
  let ascent = 0,
    descent = 0;
  try {
    const m = _ctx.measureText(lines[0] || "M");
    ascent = m.actualBoundingBoxAscent || fontSize * 0.8;
    descent = m.actualBoundingBoxDescent || fontSize * 0.2;
  } catch (e) {
    ascent = fontSize * 0.8;
    descent = fontSize * 0.2;
  }
  const lineHeightRatio =
    lines.length > 1 ? _lineHeightRatioMulti : _lineHeightRatioBase;
  const lineH = (ascent + descent) * lineHeightRatio;
  const totalH = lineH * lines.length;
  return totalH <= ch - _padding * 2 + 1;
}

/* 最大フォントサイズを二分探索で求める */
function _computeMaxFontSize(lines, cw, ch) {
  if (!lines || lines.length === 0) return 16;
  let low = 4,
    high = 4000;
  if (lines.join("\n").trim() === "") return 48; // 空白のみ
  for (let i = 0; i < 40; i++) {
    const mid = Math.floor((low + high) / 2);
    if (_fits(mid, lines, cw, ch)) low = mid;
    else high = mid;
    if (high - low <= 1) break;
  }
  return low;
}

/* キャンバスにテキストを描画 */
function _drawText() {
  _resizeCanvas();
  const rect = _canvas.getBoundingClientRect();
  const cw = rect.width,
    ch = rect.height;
  const lines = _toLines(_lastText);
  const size = _computeMaxFontSize(lines, cw, ch);
  _ctx.clearRect(
    0,
    0,
    _canvas.width / _devicePixelRatio,
    _canvas.height / _devicePixelRatio,
  );
  const g = _ctx.createLinearGradient(0, 0, 0, ch);
  const styles = getComputedStyle(document.documentElement);
  g.addColorStop(
    0,
    styles.getPropertyValue("--canvas-gradient-start").trim() ||
    "#0b0b0b",
  );
  g.addColorStop(
    1,
    styles.getPropertyValue("--canvas-gradient-end").trim() || "#071018",
  );
  _ctx.fillStyle = g;
  _ctx.fillRect(0, 0, cw, ch);
  _ctx.font = `${size}px ${_fontFamily}`;
  _ctx.textAlign = "center";
  _ctx.textBaseline = "alphabetic";
  let ascent = 0,
    descent = 0;
  try {
    const m = _ctx.measureText(lines[0] || "M");
    ascent = m.actualBoundingBoxAscent || size * 0.8;
    descent = m.actualBoundingBoxDescent || size * 0.2;
  } catch (e) {
    ascent = size * 0.8;
    descent = size * 0.2;
  }
  const lineHeightRatio =
    lines.length > 1 ? _lineHeightRatioMulti : _lineHeightRatioBase;
  const lineH = (ascent + descent) * lineHeightRatio;
  const totalH = lineH * lines.length;
  const verticalSpace = Math.max(0, ch - totalH);
  const startY = verticalSpace * 0.45 + ascent; // 中央より少し上
  const centerX = cw / 2;
  _ctx.lineWidth = Math.max(2, Math.floor(size * 0.06));
  _ctx.strokeStyle =
    styles.getPropertyValue("--canvas-text-stroke").trim() ||
    "rgba(0,0,0,0.6)";
  _ctx.fillStyle =
    styles.getPropertyValue("--canvas-text-fill").trim() || "#ffffff";
  for (let i = 0; i < lines.length; i++) {
    const y = startY + i * lineH;
    _ctx.strokeText(lines[i], centerX, y);
    _ctx.fillText(lines[i], centerX, y);
  }
}

/* ===== レイアウト補助 ===== */
function _keyboardOverlap() {
  if (!window.visualViewport) return 0;
  const vv = window.visualViewport;
  const layoutHeight = window.innerHeight;
  const overlap = layoutHeight - (vv.height + vv.offsetTop);
  return Math.max(0, overlap);
}

function _updateControlOffsets() {
  const overlap = _keyboardOverlap();
  const topbarHeight =
    _topbar && typeof _topbar.getBoundingClientRect === "function"
      ? _topbar.getBoundingClientRect().height
      : 0;
  _rootStyle.setProperty("--topbar-height", `${topbarHeight}px`);
  _rootStyle.setProperty("--viewport-bottom-offset", `${overlap}px`);
  if (_mobileQuery.matches && _mode === "edit") {
    const stackHeight = topbarHeight + overlap;
    _rootStyle.setProperty("--controls-stack-height", `${stackHeight}px`);
  } else {
    _rootStyle.setProperty("--controls-stack-height", "0px");
  }
  if (_mode === "view" && _viewControls) {
    const viewRect = _viewControls.getBoundingClientRect();
    // Extra spacing below view controls (padding in px)
    const VIEW_CONTROLS_OFFSET_PADDING = 32;
    const offset = viewRect.height + VIEW_CONTROLS_OFFSET_PADDING;
    _rootStyle.setProperty("--view-controls-offset", `${offset}px`);
  } else {
    _rootStyle.setProperty("--view-controls-offset", "0px");
  }
}

/* ===== Web Speech API 読み上げ ===== */
let _voices = [];
let _preferredVoice = null;
let _speaking = false;
function _refreshVoices() {
  if (!("speechSynthesis" in window)) return;
  _voices = speechSynthesis.getVoices();
  const preferredLangs = [];
  const navLang = (navigator.language || "en-US").toLowerCase();
  preferredLangs.push(navLang);
  if (!navLang.startsWith("en")) preferredLangs.push("en-US", "en");
  preferredLangs.push("ja-JP", "ja");
  _preferredVoice = null;
  for (const lang of preferredLangs) {
    const match = _voices.find(
      (v) => v.lang && v.lang.toLowerCase().startsWith(lang),
    );
    if (match) {
      _preferredVoice = match;
      break;
    }
  }
}
function _textForSpeech() {
  const normalized = (_lastText || "").replace(
    /\r\n?|\u2028|\u2029/g,
    "\n",
  );
  return normalized
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join(". ");
}
function _speak() {
  if (!("speechSynthesis" in window)) {
    alert("Speech synthesis is not supported in this browser.");
    return;
  }
  try {
    speechSynthesis.cancel();
    if (_speaking) {
      _speaking = false;
      _btnSpeak.textContent = "Speak";
    }
    const text = _textForSpeech();
    if (!text) {
      alert("Enter some text before using speech synthesis.");
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    if (_preferredVoice) {
      u.voice = _preferredVoice;
      u.lang = _preferredVoice.lang;
    } else {
      u.lang = navigator.language || "en-US";
    }
    u.rate = 1.0;
    u.pitch = 1.0;
    u.onstart = () => {
      _speaking = true;
      _btnSpeak.textContent = "Stop";
    };
    u.onend = () => {
      _speaking = false;
      _btnSpeak.textContent = "Speak";
    };
    u.onerror = () => {
      _speaking = false;
      _btnSpeak.textContent = "Speak";
    };
    speechSynthesis.speak(u);
  } catch (err) {
    console.error("Speech synthesis failed:", err);
    alert(
      "Speech synthesis is blocked. Please open this page over HTTPS in a regular browser tab.",
    );
  }
}
function _toggleSpeak() {
  if (_speaking) {
    speechSynthesis.cancel();
    _speaking = false;
    _btnSpeak.textContent = "Speak";
  } else {
    _speak();
  }
}

/* ====== ファイル名生成（空白・改行→アンダースコア、拡張子は .png）====== */
function _buildFileName(raw) {
  let s = String(raw ?? "");
  // 改行系を \n に統一
  s = s.replace(/\r\n?|\u2028|\u2029/g, "\n");
  // 半角/全角スペース・タブ・改行をアンダースコアに（1対1変換）
  s = s.replace(/[\u0020\u3000\t\n\r]/g, "_");
  // OSで不正になりうる文字は安全側で _ に
  s = s.replace(/[\\\/:\*?"<>\|#%]/g, "_");
  // 空なら既定名
  if (s.length === 0 || /^_*$/.test(s)) s = "image";
  // 末尾に拡張子
  if (!/\.png$/i.test(s)) s += ".png";
  return s;
}

/* PNG 保存（Blobを直接ダウンロード） */
function _savePNG() {
  const textNow = _mode === "view" ? _lastText : _input.value;
  const fileName = _buildFileName(textNow);
  if (_mode === "view") _drawText();
  else {
    _lastText = textNow;
    _drawText();
  }
  _canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName; // 指定どおり、文字列そのまま（空白・改行は_）+ .png
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url); // 即時解放（ブロックされにくい）
  }, "image/png");
}

/* モード切替 */
function _enterView() {
  _mode = "view";
  document.body.classList.add("view-mode");
  _topbar.style.display = "none";
  _btnView.textContent = "Edit";
  _lastText = _input.value;
  _drawText();
  _canvas.addEventListener("click", _onCanvasClickToEdit);
  _btnSpeak.textContent = _speaking ? "Stop" : "Speak";
  _updateControlOffsets();
}
function _enterEdit() {
  _mode = "edit";
  document.body.classList.remove("view-mode");
  _topbar.style.display = "flex";
  _btnView.textContent = "View";
  _canvas.removeEventListener("click", _onCanvasClickToEdit);
  if (_speaking) {
    speechSynthesis.cancel();
    _speaking = false;
  }
  _btnSpeak.textContent = "Speak";
  // Clear canvas in edit mode
  _ctx.clearRect(
    0,
    0,
    _canvas.width / _devicePixelRatio,
    _canvas.height / _devicePixelRatio,
  );
  requestAnimationFrame(_updateControlOffsets);
}
function _onCanvasClickToEdit() {
  _enterEdit();
}

/* イベントリスナー設定 */
function _setupEventListeners() {
  _btnView.addEventListener("click", () => {
    if (_mode === "edit") _enterView();
    else _enterEdit();
  });
  _btnSave.addEventListener("click", _savePNG);
  _btnSpeak.addEventListener("click", _toggleSpeak);
  if (_btnViewEdit) {
    _btnViewEdit.addEventListener("click", _enterEdit);
  }
  _btnTheme?.addEventListener("click", _toggleTheme);
  _input.addEventListener("input", () => {
    _lastText = _input.value;
    if (_mode === "view") _drawText();
    requestAnimationFrame(_updateControlOffsets);
  });
  window.addEventListener("resize", () => {
    _updateControlOffsets();
    if (_mode === "view") requestAnimationFrame(_drawText);
  });
  window.addEventListener("orientationchange", () => {
    setTimeout(() => {
      _updateControlOffsets();
      if (_mode === "view") _drawText();
    }, 120);
  });
  window.speechSynthesis?.addEventListener("voiceschanged", _refreshVoices);
}

/* --- 簡易セルフテスト --- */
function _assert(name, cond) {
  if (!cond) {
    console.error("[TEST FAIL]", name);
  } else {
    console.log("%c[TEST PASS]", "color:#4ade80", name);
  }
}
function _runSelfTests() {
  console.group("Self Tests");
  _assert(
    "toLines basic",
    JSON.stringify(_toLines("a\nb")) === JSON.stringify(["a", "b"]),
  );
  _assert(
    "toLines CRLF",
    JSON.stringify(_toLines("a\r\nb")) === JSON.stringify(["a", "b"]),
  );
  _assert(
    "toLines CR",
    JSON.stringify(_toLines("a\rb")) === JSON.stringify(["a", "b"]),
  );
  _assert(
    "toLines keep empty",
    JSON.stringify(_toLines("a\n\nb")) ===
    JSON.stringify(["a", " ", "b"]),
  );
  _assert(
    "toLines non-string",
    _toLines(null).length === 1 && _toLines(null)[0] === " ",
  );
  // 追加テスト: ファイル名
  _assert(
    "buildFileName newline/space",
    _buildFileName("あ い\nう").startsWith("あ_い_う") &&
    _buildFileName("あ い\nう").endsWith(".png"),
  );
  _assert(
    "buildFileName forbidden chars",
    _buildFileName("a/b\\c").indexOf("/") === -1 &&
    _buildFileName("a/b\\c").indexOf("\\") === -1,
  );
  _assert(
    "buildFileName empty -> image.png",
    _buildFileName("   ").toLowerCase() === "image.png",
  );
  console.groupEnd();
}

/* 初期セットアップ */
(function _init() {
  function _fitCanvasToParent() {
    const mainRect = document
      .querySelector("main")
      .getBoundingClientRect();
    _canvas.style.width = mainRect.width + "px";
    _canvas.style.height = mainRect.height + "px";
    _resizeCanvas();
  }

  // Visual Viewport API for iOS keyboard handling
  function _handleVisualViewportChange() {
    _updateControlOffsets();
    if (_mode === "view") {
      _fitCanvasToParent();
      _drawText();
    }
  }

  // Initialize DOM elements when DOM is ready
  function _initializeApp() {
    _initDOMElements();
    _setupEventListeners();
    _fitCanvasToParent();
    _updateControlOffsets();
    _enterEdit();
    _runSelfTests();
    _refreshVoices();

    if (!("speechSynthesis" in window)) {
      _btnSpeak.disabled = true;
      _btnSpeak.title = "Speech synthesis is not supported in this browser.";
    }
  }

  // Use DOMContentLoaded for faster initialization
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initializeApp);
  } else {
    _initializeApp();
  }

  window.addEventListener("load", () => {
    _fitCanvasToParent();
    _updateControlOffsets();
  });
  window.addEventListener("resize", () => {
    _fitCanvasToParent();
    _updateControlOffsets();
  });

  // Add visual viewport support for iOS keyboard
  if (window.visualViewport) {
    window.visualViewport.addEventListener(
      "resize",
      _handleVisualViewportChange,
    );
    window.visualViewport.addEventListener(
      "scroll",
      _handleVisualViewportChange,
    );
  }

  const _onMediaChange = () => {
    _updateControlOffsets();
    _fitCanvasToParent();
    if (_mode === "view") _drawText();
  };
  if (_mobileQuery.addEventListener)
    _mobileQuery.addEventListener("change", _onMediaChange);
  else if (_mobileQuery.addListener)
    _mobileQuery.addListener(_onMediaChange);

  // Register service worker for PWA
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("./sw.js")
        .then((registration) => {
          console.log("SW registered: ", registration);
        })
        .catch((registrationError) => {
          console.log("SW registration failed: ", registrationError);
        });
    });
  }
})();