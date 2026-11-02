// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Leon Priest (GitHub: 7h3v01d)
//
// Shorts auto-scroll. Shorts loop forever, so "ended" rarely fires: a play
// is counted when playback wraps from the last moment back to the start.
// After the chosen number of plays, move to the next Short — unless you've
// paused, opened comments/description, or the tab is hidden.
// Also skips ad Shorts (part of layer 3).

(function () {
  'use strict';

  const WRAP_TAIL = 0.75;   // "was at the end" if within this many seconds
  const WRAP_HEAD = 1.0;    // "is back at the start" if below this
  const AD_SWEEP_MS = 400;
  const SETTLE_MS = 1500;   // after moving on, let YouTube swap the active reel before judging it

  const NEXT_BUTTONS = [
    '#navigation-button-down button',
    '#navigation-button-down ytd-button-renderer button',
    'ytd-shorts [aria-label="Next video"]'
  ].join(',');

  const OPEN_PANEL = 'ytd-shorts ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]';

  const AD_MARKERS = [
    'ytd-reel-video-renderer[is-active] ytd-ad-slot-renderer',
    'ytd-reel-video-renderer[is-active] ad-badge-view-model',
    'ytd-reel-video-renderer[is-active] ytd-ad-badge-renderer',
    'ytd-reel-video-renderer[is-active] ytd-in-feed-ad-layout-renderer'
  ].join(',');

  function shortIdFromUrl(href) {
    try {
      const m = new URL(href).pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})/);
      return m ? m[1] : null;
    } catch (_) {
      return null;
    }
  }

  function createShortsScroller(opts) {
    const doc = opts.doc;
    const win = opts.win || doc.defaultView;
    const getSettings = opts.getSettings;
    const report = opts.report || (() => {});
    const getHref = opts.getHref || (() => win.location.href);
    const now = opts.now || (() => Date.now());

    let currentId = null;
    let plays = 0;
    let lastTime = 0;
    let advancedFor = null;
    let adSkippedFor = null;
    let sweepTimer = null;
    let lastNextAt = -Infinity;

    const s = () => getSettings() || {};
    const autoOn = () => !!(s().enabled && s().shortsAutoScroll);
    const adSkipOn = () => !!(s().enabled && s().layerNeutralise);

    function shortsVideo(target) {
      if (!target || target.localName !== 'video') return null;
      return target.closest && target.closest('ytd-shorts') ? target : null;
    }

    function syncId() {
      const id = shortIdFromUrl(getHref());
      if (id !== currentId) {
        currentId = id;
        plays = 0;
        lastTime = 0;
      }
      return id;
    }

    function blocked(v) {
      if (doc.visibilityState === 'hidden') return 'hidden';
      if (v && v.paused) return 'paused';
      if (doc.querySelector(OPEN_PANEL)) return 'panel';
      return null;
    }

    /** Move to the next Short. Returns how it did it (for tests/diagnostics). */
    function next() {
      lastNextAt = now();
      const btn = doc.querySelector(NEXT_BUTTONS);
      if (btn && !btn.disabled) { btn.click(); return 'button'; }
      // No button: try the ArrowDown shortcut; if the Short hasn't changed
      // shortly after, scroll the reel container instead.
      const before = shortIdFromUrl(getHref());
      const ev = new win.KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true, cancelable: true });
      (doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : doc.body).dispatchEvent(ev);
      win.setTimeout(() => {
        if (shortIdFromUrl(getHref()) !== before) return;
        const scroller = doc.getElementById('shorts-inner-container');
        if (scroller && typeof scroller.scrollBy === 'function') {
          try { scroller.scrollBy({ top: scroller.clientHeight || win.innerHeight, behavior: 'smooth' }); } catch (_) { /* ignore */ }
        }
      }, 500);
      return 'key';
    }

    function maybeAdvance(v) {
      const id = currentId;
      if (!id || advancedFor === id || !autoOn()) return null;
      if (plays < (s().shortsPlays || 1)) return null;
      if (blocked(v)) return null;
      advancedFor = id;
      return next();
    }

    function onTime(e) {
      const v = shortsVideo(e.target);
      if (!v) return;
      syncId();
      const t = v.currentTime;
      const d = v.duration;
      if (Number.isFinite(d) && d > WRAP_TAIL * 2 && lastTime >= d - WRAP_TAIL && t < WRAP_HEAD) {
        plays++;
        maybeAdvance(v);
      }
      lastTime = t;
    }

    function onEnded(e) {
      const v = shortsVideo(e.target);
      if (!v) return;
      syncId();
      plays++;
      maybeAdvance(v);
    }

    // A paused-then-resumed Short that already met its play count advances
    // on the next wrap; nothing to do on pause itself.

    function sweepAds() {
      const id = syncId();
      if (!id || !adSkipOn() || adSkippedFor === id) return;
      if (now() - lastNextAt < SETTLE_MS) return;
      if (!doc.querySelector(AD_MARKERS)) return;
      adSkippedFor = id;
      advancedFor = id;
      next();
      report({ t: 'l3', videoId: null, seconds: 0, shorts: true });
    }

    function start() {
      doc.addEventListener('timeupdate', onTime, true);
      doc.addEventListener('ended', onEnded, true);
      sweepTimer = win.setInterval(() => { if (shortIdFromUrl(getHref())) sweepAds(); }, AD_SWEEP_MS);
    }

    function stop() {
      doc.removeEventListener('timeupdate', onTime, true);
      doc.removeEventListener('ended', onEnded, true);
      if (sweepTimer) { win.clearInterval(sweepTimer); sweepTimer = null; }
    }

    return { start, stop, sweepAds, next, _state: () => ({ currentId, plays, advancedFor }) };
  }

  const api = { createShortsScroller, shortIdFromUrl, NEXT_BUTTONS, AD_MARKERS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (globalThis.Clearcut = globalThis.Clearcut || {}).shorts = api;
})();
