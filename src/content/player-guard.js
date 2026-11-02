// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Leon Priest (GitHub: 7h3v01d)
//
// Layer 3 — neutralise ads that reach the player anyway (including
// server-stitched ones, as long as the player still flags them as ads):
// mute, run at 16x, seek to the end, and click Skip as soon as it exists.
// Restores the viewer's mute state and speed when the ad ends.
// Also handles the anti-adblock wall and the optional autoplay switch-off.

(function () {
  'use strict';

  const AD_CLASSES = ['ad-showing', 'ad-interrupting'];
  const SKIP_BUTTONS = [
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button-container button',
    'button[id^="skip-button"]'
  ].join(',');
  const AD_CLOSE = '.ytp-ad-overlay-close-button';
  const TICK_MS = 250;
  const MAX_RATE = 16;

  function createPlayerGuard(opts) {
    const doc = opts.doc;
    const win = opts.win || doc.defaultView;
    const report = opts.report || (() => {});
    const getSettings = opts.getSettings;
    const getVideoId = opts.getVideoId || (() => null);

    let player = null;
    let classObserver = null;
    let docObserver = null;
    let tick = null;
    let inAd = false;
    let saved = null;          // { muted, rate }
    let adStartedAt = 0;
    let adSeconds = 0;
    let autoplayHandledFor = null;

    const on = (k) => {
      const s = getSettings();
      return !!(s && s.enabled && s[k]);
    };

    function video() {
      return player && (player.querySelector('video.html5-main-video') || player.querySelector('video'));
    }

    function isAdShowing() {
      return !!player && AD_CLASSES.some((c) => player.classList.contains(c));
    }

    function neutraliseStep() {
      const v = video();
      if (!v) return;
      if (!v.muted) v.muted = true;
      if (v.playbackRate !== MAX_RATE) {
        try { v.playbackRate = MAX_RATE; } catch (_) { /* some builds cap lower */ }
      }
      const d = v.duration;
      if (Number.isFinite(d) && d > 0) {
        if (d > adSeconds) adSeconds = d;
        if (v.currentTime < d - 0.25) {
          try { v.currentTime = Math.max(0, d - 0.1); } catch (_) { /* ignore */ }
        }
      }
      const skip = player.querySelector(SKIP_BUTTONS);
      if (skip) { try { skip.click(); } catch (_) { /* ignore */ } }
      const close = player.querySelector(AD_CLOSE);
      if (close) { try { close.click(); } catch (_) { /* ignore */ } }
    }

    function enterAd() {
      if (inAd) return;
      inAd = true;
      adStartedAt = Date.now();
      adSeconds = 0;
      const v = video();
      saved = v ? { muted: v.muted, rate: v.playbackRate === MAX_RATE ? 1 : v.playbackRate } : null;
      neutraliseStep();
      tick = win.setInterval(() => {
        if (!isAdShowing()) { exitAd(); return; }
        neutraliseStep();
      }, TICK_MS);
    }

    function exitAd() {
      if (!inAd) return;
      inAd = false;
      if (tick) { win.clearInterval(tick); tick = null; }
      const v = video();
      if (v && saved) {
        v.muted = saved.muted;
        try { v.playbackRate = saved.rate; } catch (_) { /* ignore */ }
      }
      saved = null;
      const wall = (Date.now() - adStartedAt) / 1000;
      report({ t: 'l3', videoId: getVideoId(), seconds: Math.round(Math.max(adSeconds - wall, 0) * 10) / 10 });
    }

    function evaluate() {
      if (!player) return;
      if (isAdShowing() && on('layerNeutralise')) enterAd();
      else if (!isAdShowing()) exitAd();
    }

    function attach(p) {
      if (player === p) return;
      if (classObserver) classObserver.disconnect();
      player = p;
      classObserver = new win.MutationObserver(evaluate);
      classObserver.observe(player, { attributes: true, attributeFilter: ['class'] });
      evaluate();
    }

    function dismissWall(root) {
      if (!on('dismissWall')) return false;
      const wall = root.querySelector && root.querySelector('ytd-enforcement-message-view-model');
      if (!wall) return false;
      const dialog = wall.closest('tp-yt-paper-dialog');
      (dialog || wall).remove();
      doc.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach((b) => b.remove());
      const v = video();
      if (v && v.paused) {
        try { const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch (_) { /* ignore */ }
      }
      report({ t: 'wall' });
      return true;
    }

    function handleAutoplay() {
      if (!on('disableAutoplay')) return;
      const id = getVideoId();
      if (!id || autoplayHandledFor === id) return;
      const btn = doc.querySelector('.ytp-autonav-toggle-button[aria-checked="true"]');
      if (btn) {
        autoplayHandledFor = id;
        try { btn.click(); } catch (_) { /* ignore */ }
      }
    }

    function scan() {
      if (!player || !player.isConnected) {
        const p = doc.getElementById('movie_player');
        if (p) attach(p);
      }
      handleAutoplay();
    }

    let pending = null;
    function sweep() {
      pending = null;
      scan();
      dismissWall(doc);
    }

    function start() {
      sweep();
      // YouTube mutates the DOM constantly; coalesce into one sweep per 150ms.
      docObserver = new win.MutationObserver(() => {
        if (!pending) pending = win.setTimeout(sweep, 150);
      });
      docObserver.observe(doc.documentElement, { childList: true, subtree: true });
    }

    function stop() {
      exitAd();
      if (classObserver) classObserver.disconnect();
      if (docObserver) docObserver.disconnect();
      if (pending) { win.clearTimeout(pending); pending = null; }
      classObserver = docObserver = null;
      player = null;
    }

    return { start, stop, evaluate, sweep, isInAd: () => inAd };
  }

  const api = { createPlayerGuard, SKIP_BUTTONS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (globalThis.Clearcut = globalThis.Clearcut || {}).playerGuard = api;
})();
