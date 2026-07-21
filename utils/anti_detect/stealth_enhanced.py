"""Enhanced stealth evasions beyond puppeteer-extra-stealth.

This module generates a supplementary JavaScript snippet that is injected
*on top of* ``utils/stealth.min.js`` (which covers chrome.app, chrome.csi,
chrome.runtime, media.canPlayType, hardwareConcurrency, etc.).

The supplementary script targets evasion vectors that are either
* newer than the bundled stealth.min.js (generated 2024-06-10) or
* known to be checked by Chinese domestic platforms (Douyin/Xiaohongshu/Kuaishou).
"""
from __future__ import annotations

from pathlib import Path

from patchright.async_api import BrowserContext

from conf import BASE_DIR

# ── Supplementary stealth script (injected after stealth.min.js) ────────────
_ENHANCED_STEALTH_JS = """
(() => {
  'use strict';

  // ── 1. navigator.webdriver ───────────────────────────────────────────────
  // Playwright/patchright sets this to true by default. Remove it entirely.
  if (Object.getOwnPropertyDescriptor(navigator, 'webdriver')) {
    try {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
        configurable: true,
      });
    } catch (e) {
      // Some platforms seal the descriptor; ignore.
    }
  }
  // Also wipe the property off the prototype chain if present.
  if ('webdriver' in navigator) {
    try { delete navigator.webdriver; } catch (e) {}
  }

  // ── 2. navigator.plugins ─────────────────────────────────────────────────
  // Real Chrome has 2-3 plugins (PDF, Native Client, Widevine). Headless has 0.
  const _mockPlugins = [
    {
      name: 'Chrome PDF Plugin',
      filename: 'internal-pdf-viewer',
      description: 'Portable Document Format',
      version: 'undefined',
      length: 1,
      item: () => null,
      namedItem: () => null,
    },
    {
      name: 'Widevine Content Decryption Module',
      filename: 'widevinecdmadapter.dll',
      description: 'Widevine Content Decryption Module',
      version: 'undefined',
      length: 0,
      item: () => null,
      namedItem: () => null,
    },
  ];

  if (!navigator.plugins || navigator.plugins.length === 0) {
    try {
      Object.defineProperty(navigator, 'plugins', {
        get: () => {
          const arr = _mockPlugins.slice();
          arr.length = arr.length;
          arr.item = idx => arr[idx] || null;
          arr.namedItem = name => arr.find(p => p.name === name) || null;
          return arr;
        },
        configurable: true,
        enumerable: true,
      });
    } catch (e) {}
  }

  // ── 3. navigator.mimeTypes ───────────────────────────────────────────────
  if (!navigator.mimeTypes || navigator.mimeTypes.length === 0) {
    try {
      Object.defineProperty(navigator, 'mimeTypes', {
        get: () => {
          const mimes = [
            { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: _mockPlugins[0] },
            { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: _mockPlugins[0] },
          ];
          mimes.length = mimes.length;
          mimes.item = idx => mimes[idx] || null;
          mimes.namedItem = name => mimes.find(m => m.type === name) || null;
          return mimes;
        },
        configurable: true,
        enumerable: true,
      });
    } catch (e) {}
  }

  // ── 4. navigator.languages ───────────────────────────────────────────────
  // Headless often reports ['en-US', 'en'] only. Match a mainland-China browser.
  try {
    Object.defineProperty(navigator, 'languages', {
      get: () => ['zh-CN', 'zh', 'en'],
      configurable: true,
      enumerable: true,
    });
  } catch (e) {}

  // ── 5. Notification.permission ───────────────────────────────────────────
  // Real browsers that have NOT interacted with a site return "default".
  try {
    Object.defineProperty(Notification, 'permission', {
      get: () => 'default',
      configurable: true,
      enumerable: true,
    });
  } catch (e) {}

  // ── 6. Permissions.query ─────────────────────────────────────────────────
  // Some sites probe permissions to detect headless (always-prompt vs always-denied).
  const _origPermissionsQuery = navigator.permissions?.query;
  if (_origPermissionsQuery) {
    navigator.permissions.query = function(queryInfo) {
      if (queryInfo?.name === 'notifications') {
        return Promise.resolve({ state: 'prompt', onchange: null });
      }
      return _origPermissionsQuery.call(this, queryInfo);
    };
  }

  // ── 7. Canvas 2D noise (light) ───────────────────────────────────────────
  // Platforms increasingly use canvas fingerprinting. We add imperceptible noise.
  // DISABLED: Douyin/creator.douyin.com uses canvas fingerprinting to detect
  // automation, BUT mutating getImageData on this site causes Douyin's
  // VMP obfuscated integrity-check to throw — halting React hydration so
  // the QR code never mounts (canvas content is a static placeholder,
  // byte-identical across 2s/5s/10s polls). Leave commented out for
  // platforms that don't run the same check.
  // const _origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
  // CanvasRenderingContext2D.prototype.getImageData = function(...args) {
  //   const imageData = _origGetImageData.apply(this, args);
  //   const data = imageData.data;
  //   for (let i = 0; i < data.length; i += 4) {
  //     const noise = ((i * 31) % 3) - 1;
  //     data[i] = Math.min(255, Math.max(0, data[i] + noise));
  //     data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
  //     data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
  //   }
  //   return imageData;
  // };

  // ── 8. WebGL parameter spoofing ──────────────────────────────────────────
  // Unmask renderer / vendor are the most common WebGL fingerprint vectors.
  const _origGetParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(parameter) {
    switch (parameter) {
      case 37445: // UNMASKED_VENDOR_WEBGL
        return 'Google Inc. (NVIDIA)';
      case 37446: // UNMASKED_RENDERER_WEBGL
        return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Direct3D11 vs_5_0 ps_5_0, D3D11)';
      case 7937: // RENDERER
        return 'WebKit WebGL';
      case 7936: // VENDOR
        return 'WebKit';
      default:
        return _origGetParameter.call(this, parameter);
    }
  };

  // ── 9. outerWidth / outerHeight consistency ──────────────────────────────
  // Headless may expose outerWidth === innerWidth. Add realistic chrome decoration.
  try {
    Object.defineProperty(window, 'outerWidth', {
      get: () => window.innerWidth + (window.screen?.availLeft || 0) + 16,
      configurable: true,
    });
    Object.defineProperty(window, 'outerHeight', {
      get: () => window.innerHeight + (window.outerHeight - window.innerHeight || 80),
      configurable: true,
    });
  } catch (e) {}

  // ── 10. Device Memory ────────────────────────────────────────────────────
  // Delete first (may be defined as non-configurable data property),
  // then redefine as accessor.
  try { delete navigator.deviceMemory; } catch (e) {}
  try {
    Object.defineProperty(navigator, 'deviceMemory', {
      get: () => 8,
      configurable: true,
      enumerable: true,
    });
  } catch (e) {}

  // ── 11. Max Touch Points ─────────────────────────────────────────────────
  try { delete navigator.maxTouchPoints; } catch (e) {}
  try {
    Object.defineProperty(navigator, 'maxTouchPoints', {
      get: () => 10,
      configurable: true,
      enumerable: true,
    });
  } catch (e) {}

  // ── 12. Chrome branding consistency ──────────────────────────────────────
  // Some scripts check navigator.vendor for exact 'Google Inc.' string.
  try {
    Object.defineProperty(navigator, 'vendor', {
      get: () => 'Google Inc.',
      configurable: true,
      enumerable: true,
    });
  } catch (e) {}

  // ── 13. navigator.platform ───────────────────────────────────────────────
  // Must match User-Agent OS; mismatch (MacIntel + Windows UA) is an
  // instant bot signal for Douyin's uc-secure-sdk.
  try {
    Object.defineProperty(navigator, 'platform', {
      get: () => 'MacIntel',
      configurable: true,
      enumerable: true,
    });
  } catch (e) {}

  // ── 14. window.chrome.runtime ────────────────────────────────────────────
  // Real Chrome exposes window.chrome with a runtime object (even if
  // empty). Headless / patchright leaves chrome.runtime undefined,
  // which is a strong bot signal.
  if (!window.chrome) {
    window.chrome = {};
  }
  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      id: undefined,
      connect: () => undefined,
      sendMessage: () => undefined,
    };
  }
  // window.chrome.loadTimes (deprecated but some scripts probe it).
  // Memoize timestamps so repeat calls don't leak fresh Date.now().
  if (!window.chrome.loadTimes) {
    window.chrome.loadTimes = (() => {
      const t = Date.now() / 1000;
      return () => ({
        requestTime: t,
        startLoadTime: t - 0.5,
        commitLoadTime: t - 0.3,
        finishDocumentLoadTime: t - 0.1,
        finishLoadTime: t,
        firstPaintTime: t - 0.2,
        firstPaintAfterLoadTime: 0,
        navigationType: 'Other',
        wasFetchedViaSpdy: false,
        wasNpnNegotiated: false,
        npnNegotiatedProtocol: 'unknown',
        wasAlternateProtocolAvailable: false,
        connectionInfo: 'http/1.1',
      });
    })();
  }

  // ── 15. Error.prototype.stack trace cleanup ───────────────────────────────
  // Playwright/patchright's ``context.add_init_script`` evaluates JS inside
  // a V8 wrapper that injects markers like ``__playwright_evaluation_script__``
  // / ``__puppeteer_evaluation_script__`` into stack trace strings. Real
  // users never have these markers. CreepJS / uc-secure-sdk probes
  // ``new Error().stack`` (and the ``error.toString()`` chain that reads
  // it) and flags any marker presence.
  //
  // Surgical approach: redefine the ``stack`` getter on Error.prototype so
  // every read of ``.stack`` runs the captured trace through a marker-strip
  // regex. We strip ONLY the two known playwright/puppeteer markers — not
  // just any substring containing ``playwright`` — so legitimate user
  // error messages or custom error classes that happen to mention the
  // marker in their .name / .message are not corrupted.
  const _origStackDesc = Object.getOwnPropertyDescriptor(Error.prototype, 'stack');
  if (_origStackDesc && _origStackDesc.get) {
    try {
      const _origStackGet = _origStackDesc.get;
      const STACK_LINES = /^\\s*at (?:__playwright_evaluation_script__|__puppeteer_evaluation_script__).*\n?/gm;
      const STACK_TOKENS = /__playwright_evaluation_script__|__puppeteer_evaluation_script__/g;
      Object.defineProperty(Error.prototype, 'stack', {
        get() {
          const raw = _origStackGet.call(this);
          if (typeof raw !== 'string') return raw;
          // Two-pass: first drop whole lines whose frame is marker-only
          // (the dominant V8 framing), then strip any residual markers
          // that appear inline as tokens.
          return raw.replace(STACK_LINES, '').replace(STACK_TOKENS, '');
        },
        configurable: true,
        enumerable: false,
      });
    } catch (e) {}
  }

  // ── 16. navigator.connection (Mac Intel WiFi) ───────────────────────────
  // Chromium exposes NetworkInformation via ``navigator.connection`` with
  // ``rtt / downlink / effectiveType / saveData / type`` plus an
  // ``EventTarget`` interface (``addEventListener`` for ``change`` events).
  // Real Mac-Chromium-over-WiFi typical values: 4g effective type, 50ms
  // rtt, 10Mbps downlink, saveData false, type wifi on newer Chromium.
  //
  // ``Object.freeze`` blocks page-side mutation of our mock — a probe that
  // writes-then-re-reads would otherwise see the write succeed on real
  // NetworkInformation and silently fail on our frozen object (which would
  // be a fingerprintable inconsistency on its own). ``addEventListener`` /
  // ``removeEventListener`` / ``dispatchEvent`` are no-op shims so a page
  // that subscribes to ``change`` doesn't crash.
  // Jitter rtt/downlink per launch so the connection fingerprint varies
  // across uploads. Without jitter, every upload produces the same exact
  // numeric values, which a CreepJS session-history check would flag as
  // automation. Values stay in the realistic Mac-wifi-home range.
  const _jitterRtt = 25 + Math.floor(Math.random() * 55);     // [25, 80) ms
  const _jitterDownlink = 5 + Math.floor(Math.random() * 20);  // [5, 25)  Mbps
  const _mockConnection = Object.freeze({
    effectiveType: '4g',
    rtt: _jitterRtt,
    downlink: _jitterDownlink,
    saveData: false,
    type: 'wifi',
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  });
  try {
    Object.defineProperty(navigator, 'connection', {
      get: () => _mockConnection,
      configurable: true,
      enumerable: true,
    });
  } catch (e) {}

  // ── 17. document.fonts Mac Intel font manifest ───────────────────────────
  // ``document.fonts.check(text, fontFamily)`` returns true if Chromium can
  // render ``text`` using ``fontFamily``. CreepJS probes a battery of OS-
  // typical font names: if a Windows/Linux-only font returns true on a
  // Mac UA, or a Mac-only font returns false, that's a fingerprint
  // mismatch signal.
  //
  // Override path-consults a curated manifest: known Mac-Intel fonts
  // short-circuit to ``true`` (matching the fingerprint UA claim); known
  // Windows/Linux/CJK-only fonts short-circuit to ``false``; everything
  // else defers to the real implementation so we don't fabricate claims
  // about user-installed fonts we can't know about.
  //
  // ``fontFamily`` may be a CSS-style comma-separated fallback list
  // (e.g. ``"Helvetica Neue", Arial, sans-serif``); we extract the first
  // primary name (what CSS font-matching would pick first) before
  // consulting the manifest.
  const _MAC_INTEL_FONTS = new Set([
    'Helvetica Neue', 'Helvetica', 'Times', 'Times New Roman',
    'Courier', 'Courier New', 'Monaco', 'Geneva', 'Verdana',
    'Lucida Grande', 'Lucida Sans Unicode', 'Avenir', 'Avenir Next',
    'Optima', 'Futura', 'Copperplate', 'Gill Sans',
    // Mac-bundled system fonts that ship with macOS — CreepJS probes
    // these on Mac UA; missing them is an instant mismatch signal.
    'Hoefler Text', 'Iowan Old Style', 'Snell Roundhand',
    'Charter', 'Big Caslon', 'American Typewriter',
    'Apple Chancery', 'Marker Felt', 'Zapfino', 'Bradley Hand',
    '-apple-system', 'BlinkMacSystemFont', 'system-ui',
  ]);
  const _NON_MAC_INTEL_FONTS = new Set([
    // Windows-only
    'Microsoft YaHei', 'Microsoft YaHei UI', 'Microsoft JhengHei',
    'Calibri', 'Cambria', 'Candara', 'Consolas',
    'Segoe UI', 'Segoe UI Emoji', 'Tahoma',
    // Linux-only
    'Liberation Sans', 'Liberation Serif', 'Liberation Mono',
    'Noto Sans CJK SC', 'Noto Sans CJK TC', 'Noto Sans', 'Noto Sans Mono',
    'WenQuanYi Micro Hei', 'WenQuanYi Zen Hei', 'DejaVu Sans',
    // Mainland-China-only (common in Chinese-fingerprinter probes)
    'SimSun', 'NSimSun', 'SimHei', 'PMingLiU', 'MingLiU',
  ]);
  try {
    const _origFontsCheck = FontFaceSet.prototype.check;
    FontFaceSet.prototype.check = function(text, fontFamily, ...rest) {
      if (typeof fontFamily !== 'string') {
        return _origFontsCheck.call(this, text, fontFamily, ...rest);
      }
      const primary = fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
      if (_MAC_INTEL_FONTS.has(primary)) return true;
      if (_NON_MAC_INTEL_FONTS.has(primary)) return false;
      return _origFontsCheck.call(this, text, fontFamily, ...rest);
    };
    // Symmetric override for FontFaceSet.prototype.load. Probes compare
    // check() ↔ load() to catch asymmetric overrides, so we mirror the
    // whitelist behavior across both methods. Per CSS Font Loading API
    // spec: whitelisted fonts resolve with an empty array of FontFace
    // objects; non-whitelisted fonts reject with a DOMException of
    // name "NetworkError". Anything else defers to the real impl.
    const _origFontsLoad = FontFaceSet.prototype.load;
    FontFaceSet.prototype.load = function(text, fontFamily, ...rest) {
      if (typeof fontFamily !== 'string') {
        return _origFontsLoad.call(this, text, fontFamily, ...rest);
      }
      const primary = fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
    if (_MAC_INTEL_FONTS.has(primary)) {
      // Match real FontFaceSet.load() latency (system font lookup
      // ~0.5-3ms) so a performance.now() before/after probe can't
      // fingerprint an instantly-resolved promise as our override.
      return new Promise(resolve => setTimeout(() => resolve([]), 1 + Math.floor(Math.random() * 4)));
    }
    if (_NON_MAC_INTEL_FONTS.has(primary)) {
      // Rejection path: same latency-mimicking delay since real loads
      // also reject after a similar (very small) system-cache look up.
      return new Promise((_, reject) =>
        setTimeout(() => reject(new DOMException('Font load failed', 'NetworkError')), 1 + Math.floor(Math.random() * 4))
      );
    }
      return _origFontsLoad.call(this, text, fontFamily, ...rest);
    };
  } catch (e) {}
})();
"""


def get_enhanced_stealth_script() -> str:
    """Return the supplementary stealth JS string."""
    return _ENHANCED_STEALTH_JS


async def apply_anti_detect(context: BrowserContext) -> BrowserContext:
    """Inject both base stealth.min.js *and* the enhanced supplementary script.

    This should be called immediately after ``browser.new_context()`` and
    **before** ``context.new_page()``.
    """
    # 1. Base stealth (puppeteer-extra-stealth evasions)
    stealth_js_path = Path(BASE_DIR) / "utils" / "stealth.min.js"
    if stealth_js_path.exists():
        await context.add_init_script(path=str(stealth_js_path))

    # 2. Enhanced supplementary evasions
    await context.add_init_script(script=get_enhanced_stealth_script())

    return context
