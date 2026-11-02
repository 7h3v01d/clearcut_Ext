// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Leon Priest (GitHub: 7h3v01d)
//
// Sponsor-segment skipping (SponsorBlock community data). Auto-skips enabled
// categories and shows a toast with Undo, which seeks back and leaves that
// segment alone for the rest of the video.

(function () {
  'use strict';

  function createSponsorSkipper(opts) {
    const doc = opts.doc;
    const win = opts.win || doc.defaultView;
    const sb = opts.sponsor; // lib/sponsor.js api
    const fetchSegments = opts.fetchSegments;
    const report = opts.report || (() => {});
    const getSettings = opts.getSettings;
    const isInAd = opts.isInAd || (() => false);
    const labels = opts.labels || {};
    const toaster = opts.toaster || globalThis.Clearcut.toast.createToaster({ doc, win });

    let videoId = null;
    let segments = [];
    let done = new Set();     // skipped or undone — never auto-skip again this video
    let generation = 0;
    let lastToast = null; // handle of our own toast, while it is showing

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
      const t = lastToast;
      lastToast = null;
      return t ? t.runAction() : false;
    }

    function hideToast() {
      if (lastToast) { lastToast = null; toaster.hide(); }
    }

    function showToast(v, seg, from) {
      const handle = toaster.show({
        player: v.closest('#movie_player'),
        message: `Skipped ${labels[seg.category] || seg.category}`,
        action: { label: 'Undo', run: () => { v.currentTime = Math.max(0, from - 0.5); } },
        onHide: () => { if (lastToast === handle) lastToast = null; }
      });
      lastToast = handle;
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
