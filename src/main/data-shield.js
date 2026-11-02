// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Leon Priest (GitHub: 7h3v01d)
//
// Layer 1 — data shield. Runs in the page's MAIN world at document_start.
// Strips ad payloads out of YouTube's JSON before the player or the feed
// renderer ever sees them. Hooks:
//   * JSON.parse              (fetch().text() + parse, XHR paths)
//   * Response.prototype.json (fetch().json() paths)
//   * window.ytInitialPlayerResponse / window.ytInitialData (inline bootstrap)
// Every hook is a Proxy over the native function, and Function.prototype.toString
// is proxied so the hooks still stringify as native code.
//
// Self-contained on purpose: nothing is exposed on window. When loaded under
// Node (tests) it exports its API instead of installing.

(function () {
  'use strict';

  const MSG_TAG = '__clearcut';
  const MAX_DEPTH = 64;

  // Keys whose values are ad payloads. Deleted wherever they appear.
  const AD_KEYS = new Set([
    'adPlacements',
    'adSlots',
    'playerAds',
    'adBreakHeartbeatParams',
    'adBreakParams',
    'adParams'
  ]);

  // Renderers that are ads when they appear as an item in a list.
  const AD_RENDERERS = new Set([
    'adSlotRenderer',
    'displayAdRenderer',
    'promotedSparklesWebRenderer',
    'promotedSparklesTextSearchRenderer',
    'promotedVideoRenderer',
    'compactPromotedVideoRenderer',
    'compactPromotedItemRenderer',
    'inFeedAdLayoutRenderer',
    'searchPyvRenderer',
    'bannerPromoRenderer',
    'statementBannerRenderer',
    'brandVideoShelfRenderer',
    'brandVideoSingletonRenderer',
    'actionCompanionAdRenderer',
    'companionAdRenderer',
    'adsEngagementPanelContentRenderer',
    'playerLegacyDesktopWatchAdsRenderer',
    'mealbarPromoRenderer'
  ]);

  // Containers that wrap a single renderer under `content`.
  const WRAPPERS = new Set(['richItemRenderer', 'richSectionRenderer']);

  // Anti-adblock enforcement dialogs live under these renderer names.
  const WALL_RENDERERS = new Set(['enforcementMessageViewModel']);

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  /** True when a list item is an ad (directly or via a rich-item wrapper). */
  function isAdItem(item) {
    if (!isPlainObject(item)) return false;
    for (const key of Object.keys(item)) {
      if (AD_RENDERERS.has(key)) return true;
      if (WRAPPERS.has(key)) {
        const inner = item[key] && item[key].content;
        if (isPlainObject(inner)) {
          for (const k of Object.keys(inner)) if (AD_RENDERERS.has(k)) return true;
        }
      }
      if (key === 'engagementPanelSectionListRenderer') {
        const panel = item[key];
        if (panel && panel.targetId === 'engagement-panel-ads') return true;
        const content = panel && panel.content;
        if (isPlainObject(content) && 'adsEngagementPanelContentRenderer' in content) return true;
      }
    }
    return false;
  }

  /** Does this parsed value look like a YouTube InnerTube response? */
  function looksLikeYouTube(value) {
    if (isPlainObject(value)) {
      return 'responseContext' in value || 'playabilityStatus' in value || 'videoDetails' in value;
    }
    if (Array.isArray(value) && value.length > 0 && value.length < 16) {
      return value.some((v) => isPlainObject(v) && ('playerResponse' in v || 'response' in v));
    }
    return false;
  }

  /**
   * Prune ad payloads in place.
   * @returns {{removed:number, walls:number, videoId:(string|null), isPlayer:boolean}}
   */
  function prune(root) {
    const result = { removed: 0, walls: 0, videoId: null, isPlayer: false };
    if (root === null || typeof root !== 'object') return result;

    const seen = new WeakSet();
    const stack = [[root, 0]];
    while (stack.length) {
      const [node, depth] = stack.pop();
      if (node === null || typeof node !== 'object' || seen.has(node) || depth > MAX_DEPTH) continue;
      seen.add(node);

      if (Array.isArray(node)) {
        for (let i = node.length - 1; i >= 0; i--) {
          if (isAdItem(node[i])) {
            node.splice(i, 1);
            result.removed++;
          } else if (node[i] !== null && typeof node[i] === 'object') {
            stack.push([node[i], depth + 1]);
          }
        }
        continue;
      }

      if (('playabilityStatus' in node || 'streamingData' in node) && isPlainObject(node.videoDetails)) {
        result.isPlayer = true;
        if (!result.videoId && typeof node.videoDetails.videoId === 'string') {
          result.videoId = node.videoDetails.videoId;
        }
      }

      for (const key of Object.keys(node)) {
        if (AD_KEYS.has(key)) {
          delete node[key];
          result.removed++;
          continue;
        }
        if (WALL_RENDERERS.has(key)) {
          delete node[key];
          result.walls++;
          continue;
        }
        const child = node[key];
        if (child !== null && typeof child === 'object') stack.push([child, depth + 1]);
      }
    }
    return result;
  }

  /**
   * Install the hooks on a window-like object.
   * @param {Window} win
   * @param {{post?:(msg:object)=>void}} [opts]
   */
  function install(win, opts) {
    const state = { enabled: true };
    const post = (opts && opts.post) || function (msg) {
      try { win.postMessage(Object.assign({ [MSG_TAG]: 1, dir: 'up' }, msg), win.location.origin); } catch (_) { /* ignore */ }
    };

    function handle(value, source) {
      if (!state.enabled || !looksLikeYouTube(value)) return;
      let r;
      try { r = prune(value); } catch (_) { return; }
      if (r.isPlayer) {
        post({ t: 'l1', kind: 'player', videoId: r.videoId, removed: r.removed, source });
      } else if (r.removed > 0) {
        post({ t: 'l1', kind: 'data', removed: r.removed, source });
      }
      if (r.walls > 0) post({ t: 'l1', kind: 'wall', removed: r.walls, source });
    }

    // --- native-looking toString for our proxies -------------------------
    const nativeOf = new WeakMap();
    const FnProto = win.Function.prototype;
    const origToString = FnProto.toString;
    const toStringProxy = new Proxy(origToString, {
      apply(target, thisArg, args) {
        const real = nativeOf.has(thisArg) ? nativeOf.get(thisArg) : thisArg;
        return Reflect.apply(target, real, args);
      }
    });
    nativeOf.set(toStringProxy, origToString);
    try { FnProto.toString = toStringProxy; } catch (_) { /* ignore */ }

    function wrap(owner, name, makeHandler) {
      const original = owner[name];
      if (typeof original !== 'function') return;
      const proxy = new Proxy(original, { apply: makeHandler(original) });
      nativeOf.set(proxy, original);
      try {
        const desc = Object.getOwnPropertyDescriptor(owner, name) || { writable: true, configurable: true, enumerable: false };
        Object.defineProperty(owner, name, Object.assign({}, desc, { value: proxy }));
      } catch (_) { /* ignore */ }
    }

    // --- JSON.parse ------------------------------------------------------
    wrap(win.JSON, 'parse', () => function (target, thisArg, args) {
      const result = Reflect.apply(target, thisArg, args);
      // Cheap pre-filter: only YouTube-sized text containing a marker key.
      const text = args[0];
      if (typeof text === 'string' && text.length > 64 &&
          (text.indexOf('"responseContext"') !== -1 || text.indexOf('"playabilityStatus"') !== -1)) {
        try { handle(result, 'parse'); } catch (_) { /* never break the page */ }
      }
      return result;
    });

    // --- Response.prototype.json ----------------------------------------
    if (win.Response && win.Response.prototype) {
      wrap(win.Response.prototype, 'json', () => function (target, thisArg, args) {
        const p = Reflect.apply(target, thisArg, args);
        let url = '';
        try { url = thisArg && thisArg.url ? String(thisArg.url) : ''; } catch (_) { /* ignore */ }
        if (url && url.indexOf('/youtubei/') === -1) return p;
        return p.then((value) => {
          try { handle(value, 'fetch'); } catch (_) { /* ignore */ }
          return value;
        });
      });
    }

    // --- Inline bootstrap globals --------------------------------------
    for (const name of ['ytInitialPlayerResponse', 'ytInitialData']) {
      try {
        let stored = win[name];
        if (stored !== undefined) handle(stored, name);
        Object.defineProperty(win, name, {
          configurable: true,
          enumerable: true,
          get() { return stored; },
          set(v) {
            try { handle(v, name); } catch (_) { /* ignore */ }
            stored = v;
          }
        });
      } catch (_) { /* property locked — fall back to JSON hooks */ }
    }

    // --- Config channel from the isolated world -------------------------
    try {
      win.addEventListener('message', (e) => {
        const d = e.data;
        if (e.source !== win || !d || d[MSG_TAG] !== 1 || d.dir !== 'down') return;
        if (typeof d.enabled === 'boolean') state.enabled = d.enabled;
      });
    } catch (_) { /* ignore */ }

    return state;
  }

  const api = { prune, isAdItem, looksLikeYouTube, install, AD_KEYS, AD_RENDERERS, MSG_TAG };
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  install(window);
})();
