// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Leon Priest (GitHub: 7h3v01d)
//
// MAIN-world player bridge. The YouTube player's own methods
// (getPlayerResponse, setPlaybackQualityRange, …) only exist in the page's
// JavaScript world, so the isolated content script asks for them through
// postMessage RPC:
//   down  { __clearcut:1, dir:'down', rpc:<id>, cmd:'ctx' | 'quality', level? }
//   up    { __clearcut:1, dir:'up', t:'reply', rpc:<id>, ok, data }
// Nothing is exposed on window.

(function () {
  'use strict';

  const MSG_TAG = '__clearcut';

  // Our quality ids, best first, mapped to YouTube's level names.
  const QUALITY_ORDER = ['highres', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];

  /**
   * Choose a level from what this video offers.
   * 'max' → best available; otherwise the best available level not above the target.
   */
  function pickQuality(available, wanted) {
    const avail = (available || []).filter((l) => QUALITY_ORDER.includes(l));
    if (!avail.length) return null;
    avail.sort((a, b) => QUALITY_ORDER.indexOf(a) - QUALITY_ORDER.indexOf(b));
    if (wanted === 'max') return avail[0];
    const target = QUALITY_ORDER.indexOf(wanted);
    if (target === -1) return null;
    for (const l of avail) if (QUALITY_ORDER.indexOf(l) >= target) return l;
    return avail[avail.length - 1];
  }

  function ctxOf(player) {
    let vd = null;
    try { vd = player.getPlayerResponse && player.getPlayerResponse().videoDetails; } catch (_) { /* ignore */ }
    if (!vd) {
      try {
        const d = player.getVideoData && player.getVideoData();
        if (d) vd = { videoId: d.video_id, author: d.author, channelId: null };
      } catch (_) { /* ignore */ }
    }
    if (!vd) return null;
    return {
      videoId: typeof vd.videoId === 'string' ? vd.videoId : null,
      channelId: typeof vd.channelId === 'string' ? vd.channelId : null,
      author: typeof vd.author === 'string' ? vd.author.slice(0, 100) : null,
      isLive: !!vd.isLiveContent && !!vd.isLive
    };
  }

  function applyQuality(player, level) {
    let avail = [];
    try { avail = player.getAvailableQualityLevels() || []; } catch (_) { return null; }
    const chosen = pickQuality(avail, level);
    if (!chosen) return null;
    try { if (player.setPlaybackQualityRange) player.setPlaybackQualityRange(chosen, chosen); } catch (_) { /* ignore */ }
    try { if (player.setPlaybackQuality) player.setPlaybackQuality(chosen); } catch (_) { /* ignore */ }
    return chosen;
  }

  function install(win) {
    const doc = win.document;
    const reply = (rpc, ok, data) => {
      try { win.postMessage({ [MSG_TAG]: 1, dir: 'up', t: 'reply', rpc, ok, data }, win.location.origin); } catch (_) { /* ignore */ }
    };

    function handle(d, attempt) {
      const player = doc.getElementById('movie_player');
      const ready = player && typeof player.getAvailableQualityLevels === 'function';
      if (d.cmd === 'ctx') {
        const ctx = player ? ctxOf(player) : null;
        if (ctx || attempt >= 10) return reply(d.rpc, !!ctx, ctx);
      } else if (d.cmd === 'quality') {
        const levels = ready ? (player.getAvailableQualityLevels() || []) : [];
        // Levels are empty until the stream is loaded; retry for ~5s.
        if (levels.length || attempt >= 10) {
          const chosen = ready ? applyQuality(player, String(d.level || '')) : null;
          return reply(d.rpc, !!chosen, chosen);
        }
      } else {
        return reply(d.rpc, false, null);
      }
      win.setTimeout(() => handle(d, attempt + 1), 500);
    }

    win.addEventListener('message', (e) => {
      const d = e.data;
      if (e.source !== win || !d || d[MSG_TAG] !== 1 || d.dir !== 'down' || typeof d.rpc !== 'number') return;
      handle(d, 0);
    });
  }

  const api = { pickQuality, ctxOf, applyQuality, install, QUALITY_ORDER };
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  install(window);
})();
