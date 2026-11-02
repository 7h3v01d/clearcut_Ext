// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Leon Priest (GitHub: 7h3v01d)
//
// Sponsor-segment skipping (SponsorBlock community data). Auto-skips enabled
// categories and shows a small toast with Undo, which seeks back and leaves
// that segment alone for the rest of the video.

(function () {
  'use strict';

  const TOAST_MS = 5000;

  const TOAST_CSS = `
    :host{all:initial}
    .t{position:absolute;right:16px;bottom:72px;z-index:70;display:flex;align-items:center;gap:12px;
       padding:8px 12px;background:#11161d;border:1px solid #1e2831;border-left:2px solid #2fd6c3;
       color:#c8d3da;font:12px "JetBrains Mono",Consolas,monospace;letter-spacing:.02em;
       box-shadow:0 4px 18px rgba(0,0,0,.45);pointer-events:auto}
    .k{color:#2fd6c3;text-transform:uppercase;font-size:10px}
    button{all:unset;cursor:pointer;color:#ffb454;padding:2px 6px;border:1px solid #1e2831}
    button:hover{background:#1e2831}
  `;

  function createSponsorSkipper(opts) {
    const doc = opts.doc;
    const win = opts.win || doc.defaultView;
    const sb = opts.sponsor; // lib/sponsor.js api
    const fetchSegments = opts.fetchSegments;
    const report = opts.report || (() => {});
    const getSettings = opts.getSettings;
    const isInAd = opts.isInAd || (() => false);
    const labels = opts.labels || {};

    let videoId = null;
    let segments = [];
    let done = new Set();     // skipped or undone — never auto-skip again this video
    let generation = 0;
    let toastHost = null;
    let toastTimer = null;
    let lastUndo = null;

    const active = () => {
      const s = getSettings();
      return !!(s && s.enabled && s.sponsorSkip);
    };

    function mainVideo(target) {
      if (!target || target.localName !== 'video') return null;
      return target.closest && target.closest('#movie_player') ? target : null;
    }

    async function setVideo(id) {
      if (id === videoId) return;
      videoId = id;
      segments = [];
      done = new Set();
      hideToast();
      const gen = ++generation;
      if (!id || !active()) return;
      const cats = sb.enabledCategories(getSettings().sbCategories);
      if (cats.length === 0) return;
      try {
        const segs = await fetchSegments(id, cats);
        if (gen === generation) segments = Array.isArray(segs) ? segs : [];
      } catch (_) {
        if (gen === generation) segments = [];
      }
    }

    function onTime(e) {
      if (!segments.length || !active() || isInAd()) return;
      const v = mainVideo(e.target);
      if (!v) return;
      const hit = sb.pickSkip(segments, v.currentTime, done);
      if (!hit) return;
      const from = v.currentTime;
      const to = Number.isFinite(v.duration) ? Math.min(hit.to, v.duration) : hit.to;
      for (const u of hit.uuids) done.add(u);
      v.currentTime = to;
      report({ t: 'sb', videoId, category: hit.segment.category, seconds: Math.round((to - from) * 10) / 10 });
      showToast(v, hit.segment, from);
    }

    /** Seek back to before the last skip; that segment stays un-skipped. */
    function undoLast() {
      const fn = lastUndo;
      lastUndo = null;
      if (fn) fn();
      return !!fn;
    }

    function hideToast() {
      if (toastTimer) { win.clearTimeout(toastTimer); toastTimer = null; }
      if (toastHost) { toastHost.remove(); toastHost = null; }
      lastUndo = null;
    }

    function showToast(v, seg, from) {
      hideToast();
      const player = v.closest('#movie_player');
      if (!player) return;
      toastHost = doc.createElement('div');
      toastHost.setAttribute('data-clearcut', 'toast');
      const root = toastHost.attachShadow({ mode: 'closed' });
      const style = doc.createElement('style');
      style.textContent = TOAST_CSS;
      const box = doc.createElement('div');
      box.className = 't';
      const k = doc.createElement('span');
      k.className = 'k';
      k.textContent = 'Clearcut';
      const msg = doc.createElement('span');
      msg.textContent = `Skipped ${labels[seg.category] || seg.category}`;
      const undo = doc.createElement('button');
      undo.textContent = 'Undo';
      lastUndo = () => {
        v.currentTime = Math.max(0, from - 0.5);
        hideToast();
      };
      undo.addEventListener('click', (ev) => {
        ev.stopPropagation();
        undoLast();
      });
      box.append(k, msg, undo);
      root.append(style, box);
      player.appendChild(toastHost);
      toastTimer = win.setTimeout(hideToast, TOAST_MS);
    }

    function start() {
      doc.addEventListener('timeupdate', onTime, true);
    }

    function stop() {
      doc.removeEventListener('timeupdate', onTime, true);
      hideToast();
    }

    return { start, stop, setVideo, undoLast, _state: () => ({ videoId, segments, done }) };
  }

  const api = { createSponsorSkipper };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (globalThis.Clearcut = globalThis.Clearcut || {}).sponsorSkipper = api;
})();
