// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Leon Priest (GitHub: 7h3v01d)
//
// Isolated-world entry point. Wires settings, the cosmetic stylesheet, the
// bridge from the MAIN-world data shield, layer 3, sponsor skipping and the
// event batch that feeds the health log.

(function () {
  'use strict';

  const CC = globalThis.Clearcut;
  const MSG_TAG = '__clearcut';
  const FLUSH_MS = 1500;

  let settings = CC.defaults.mergeSettings(null);
  let styleEl = null;
  let queue = [];
  let flushTimer = null;
  let l2Seen = new WeakSet();
  let l2Pending = 0;
  let currentVideo = null;

  // ---- event batching → service worker ---------------------------------
  function report(ev) {
    queue.push(ev);
    if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
  }

  function flush() {
    flushTimer = null;
    if (l2Pending) { queue.push({ t: 'l2', hidden: l2Pending }); l2Pending = 0; }
    if (!queue.length) return;
    const batch = queue;
    queue = [];
    try {
      chrome.runtime.sendMessage({ type: 'events', events: batch }).catch(() => {});
    } catch (_) { /* extension reloaded — this tab's script is orphaned */ }
  }

  // ---- layer 2: stylesheet ---------------------------------------------
  function applyCss() {
    const css = CC.selectors.buildCss(settings);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.setAttribute('data-clearcut', 'css');
    }
    styleEl.textContent = css;
    const parent = document.head || document.documentElement;
    if (parent && styleEl.parentNode !== parent) parent.appendChild(styleEl);
  }

  // Count ad elements that render anyway (i.e. got past layer 1).
  function countLeakedAds() {
    if (!settings.enabled || !settings.layerCosmetic) return;
    const found = document.querySelectorAll(CC.selectors.AD_COUNT_SELECTOR);
    for (const el of found) {
      if (l2Seen.has(el)) continue;
      l2Seen.add(el);
      l2Pending++;
    }
    if (l2Pending && !flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
  }

  // ---- bridge to the MAIN-world shield ---------------------------------
  function pushConfigDown() {
    window.postMessage({ [MSG_TAG]: 1, dir: 'down', enabled: settings.enabled && settings.layerData }, location.origin);
  }

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== window || !d || d[MSG_TAG] !== 1 || d.dir !== 'up') return;
    if (d.t !== 'l1') return;
    report({
      t: 'l1',
      kind: String(d.kind || ''),
      videoId: typeof d.videoId === 'string' ? d.videoId : null,
      removed: Number(d.removed) || 0
    });
  });

  // ---- layer 3 + sponsor skipping --------------------------------------
  const getSettings = () => settings;
  const getVideoId = () => CC.sponsor.videoIdFromUrl(location.href);

  const guard = CC.playerGuard.createPlayerGuard({ doc: document, win: window, report, getSettings, getVideoId });

  const labels = {};
  for (const c of CC.defaults.SB_CATEGORIES) labels[c.id] = c.label.toLowerCase();

  const skipper = CC.sponsorSkipper.createSponsorSkipper({
    doc: document,
    win: window,
    sponsor: CC.sponsor,
    report,
    getSettings,
    labels,
    isInAd: () => guard.isInAd(),
    fetchSegments: async (videoId, categories) => {
      const res = await chrome.runtime.sendMessage({ type: 'sb:get', videoId, categories });
      return res && res.ok ? res.segments : [];
    }
  });

  function onNavigate() {
    const id = getVideoId();
    if (id !== currentVideo) {
      currentVideo = id;
      if (id) report({ t: 'video', videoId: id });
    }
    skipper.setVideo(id);
    countLeakedAds();
  }

  // ---- settings ----------------------------------------------------------
  function applySettings(next, previous) {
    settings = CC.defaults.mergeSettings(next);
    pushConfigDown();
    applyCss();
    const sbChanged = !previous ||
      previous.sponsorSkip !== settings.sponsorSkip ||
      JSON.stringify(previous.sbCategories) !== JSON.stringify(settings.sbCategories) ||
      previous.enabled !== settings.enabled;
    if (sbChanged) { skipper.setVideo(null); onNavigate(); }
    guard.evaluate();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) applySettings(changes.settings.newValue, settings);
  });

  // ---- boot ----------------------------------------------------------------
  applyCss();
  pushConfigDown();
  chrome.storage.local.get('settings').then((r) => applySettings(r.settings, null)).catch(() => {});

  function boot() {
    applyCss(); // <head> exists now
    guard.start();
    skipper.start();
    onNavigate();
    document.addEventListener('yt-navigate-finish', onNavigate);
    document.addEventListener('yt-page-data-updated', () => countLeakedAds());
    // Light periodic sweep for ad elements and SPA URL changes we missed.
    setInterval(() => {
      if (CC.sponsor.videoIdFromUrl(location.href) !== currentVideo) onNavigate();
      countLeakedAds();
    }, 2000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();

  // Flush on tab hide so counts aren't lost.
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
})();
