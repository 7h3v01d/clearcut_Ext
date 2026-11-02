// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Leon Priest (GitHub: 7h3v01d)
//
// Playback memory:
//   * speed and quality: the channel's saved preference, else the global
//     default, applied once per video after any pre-roll. Never fights a
//     change you make mid-video.
//   * resume position: long videos pick up where you left off, with a
//     "Start over" toast. Positions live in storage.local as r:<videoId>.

(function () {
  'use strict';

  const SAVE_EVERY_MS = 5000;
  const EDGE_SEC = 30;        // don't remember the first/last 30s
  const CTX_ATTEMPTS = 5;

  function fmtTime(sec) {
    const s = Math.floor(Math.max(0, sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const pad = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
  }

  function hasStartTime(href) {
    try {
      const u = new URL(href);
      return u.searchParams.has('t') || u.searchParams.has('start') || /(^|[#&])t=/.test(u.hash.slice(1));
    } catch (_) {
      return false;
    }
  }

  function createPlayback(opts) {
    const doc = opts.doc;
    const win = opts.win || doc.defaultView;
    const rpc = opts.rpc;
    const storage = opts.storage;          // { get(key), set(key, value), remove(key) } → Promises
    const toaster = opts.toaster;
    const getSettings = opts.getSettings;
    const getChannels = opts.getChannels || (() => ({}));
    const adShowing = opts.adShowing || (() => false);
    const getHref = opts.getHref || (() => win.location.href);
    const now = opts.now || (() => Date.now());

    let videoId = null;
    let appliedFor = null;
    let applying = false;
    let ctxAttempts = 0;
    let ctx = null;              // { videoId, channelId, author }
    let resumeCheckedFor = null;
    let resumeBusy = false;
    let lastSave = 0;
    let clearedFor = null;
    let resumeToast = null;

    const settings = () => getSettings() || {};
    const active = () => !!settings().enabled;

    function mainVideo(target) {
      if (!target || target.localName !== 'video') return null;
      return target.closest && target.closest('#movie_player') ? target : null;
    }

    function prefsFor(c) {
      const s = settings();
      const ch = c && c.channelId ? (getChannels() || {})[c.channelId] : null;
      return {
        speed: (ch && ch.speed) || s.defaultSpeed || 0,
        quality: (ch && ch.quality) || s.defaultQuality || '',
        fromChannel: !!ch
      };
    }

    function applyPrefs(v, p) {
      if (p.speed) {
        try { v.playbackRate = p.speed; } catch (_) { /* ignore */ }
      }
      if (p.quality) rpc.call('quality', { level: p.quality });
    }

    async function applyOnce(v, id) {
      applying = true;
      const r = await rpc.call('ctx');
      applying = false;
      if (id !== videoId) return;
      const ok = r.ok && r.data && r.data.videoId === id;
      if (!ok && ++ctxAttempts < CTX_ATTEMPTS) return; // try again on a later tick
      ctx = ok ? r.data : null;
      appliedFor = id;
      applyPrefs(v, prefsFor(ctx));
    }

    function key(id) { return 'r:' + id; }

    function longEnough(d) {
      return Number.isFinite(d) && d >= settings().resumeMinMinutes * 60 && d > EDGE_SEC * 3;
    }

    async function maybeResume(v, id) {
      const d = v.duration;
      if (Number.isNaN(d) || !d) return;      // metadata not loaded yet
      resumeCheckedFor = id;
      if (!settings().resumeEnabled || !longEnough(d) || hasStartTime(getHref())) return;
      resumeBusy = true;
      let saved = null;
      try { saved = await storage.get(key(id)); } catch (_) { /* ignore */ }
      resumeBusy = false;
      if (id !== videoId || !saved || typeof saved.t !== 'number') return;
      if (saved.t <= EDGE_SEC || saved.t >= d - EDGE_SEC) return;
      if (v.currentTime > 15) return;            // YouTube or the viewer already moved
      v.currentTime = saved.t;
      resumeToast = toaster.show({
        player: v.closest('#movie_player'),
        message: `Resumed at ${fmtTime(saved.t)}`,
        action: { label: 'Start over', run: () => { v.currentTime = 0; } },
        ms: 6000
      });
    }

    function savePosition(v, id) {
      if (!settings().resumeEnabled || resumeCheckedFor !== id || resumeBusy) return;
      const d = v.duration;
      if (!longEnough(d)) return;
      const t = now();
      if (t - lastSave < SAVE_EVERY_MS) return;
      lastSave = t;
      const pos = v.currentTime;
      if (pos >= d - EDGE_SEC) {
        if (clearedFor !== id) { clearedFor = id; storage.remove(key(id)); }
      } else if (pos > EDGE_SEC) {
        clearedFor = null;
        storage.set(key(id), { t: Math.round(pos * 10) / 10, d: Math.round(d), at: t });
      }
    }

    function onTime(e) {
      const v = mainVideo(e.target);
      if (!v || !videoId || !active() || adShowing()) return;
      const id = videoId;
      if (appliedFor !== id && !applying) applyOnce(v, id);
      if (resumeCheckedFor !== id && !resumeBusy) maybeResume(v, id);
      savePosition(v, id);
    }

    function onEnded(e) {
      const v = mainVideo(e.target);
      if (!v || !videoId || adShowing()) return;
      if (settings().resumeEnabled && clearedFor !== videoId) {
        clearedFor = videoId;
        storage.remove(key(videoId));
      }
    }

    function setVideo(id) {
      if (id === videoId) return;
      videoId = id;
      ctx = null;
      ctxAttempts = 0;
      lastSave = 0;
      clearedFor = null;
      resumeToast = null;
    }

    /** Re-apply now (the viewer changed this channel's prefs in the popup). */
    function applyNow() {
      const v = doc.querySelector('#movie_player video');
      if (!v || !active() || appliedFor !== videoId || adShowing()) return false;
      applyPrefs(v, prefsFor(ctx));
      return true;
    }

    /** Context for the popup: which channel is playing and what applies to it. */
    async function describe() {
      const r = await rpc.call('ctx');
      const c = r.ok && r.data ? r.data : null;
      if (c && c.videoId === videoId) ctx = c;
      const v = doc.querySelector('#movie_player video');
      return {
        videoId,
        channelId: c ? c.channelId : null,
        author: c ? c.author : null,
        rate: v ? v.playbackRate : null,
        prefs: prefsFor(c)
      };
    }

    function start() {
      doc.addEventListener('timeupdate', onTime, true);
      doc.addEventListener('ended', onEnded, true);
    }

    function stop() {
      doc.removeEventListener('timeupdate', onTime, true);
      doc.removeEventListener('ended', onEnded, true);
    }

    return {
      start, stop, setVideo, applyNow, describe,
      startOver: () => (resumeToast ? resumeToast.runAction() : false),
      _state: () => ({ videoId, appliedFor, resumeCheckedFor, ctx })
    };
  }

  const api = { createPlayback, fmtTime, hasStartTime };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (globalThis.Clearcut = globalThis.Clearcut || {}).playback = api;
})();
