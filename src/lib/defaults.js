// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Leon Priest (GitHub: 7h3v01d)
//
// Default settings shared by the service worker, content scripts and popup.

(function () {
  'use strict';

  const SB_CATEGORIES = [
    { id: 'sponsor', label: 'Sponsor reads' },
    { id: 'selfpromo', label: 'Self-promotion' },
    { id: 'interaction', label: 'Like/subscribe nags' },
    { id: 'intro', label: 'Intros' },
    { id: 'outro', label: 'Outros / end cards' },
    { id: 'preview', label: 'Previews / recaps' },
    { id: 'filler', label: 'Filler tangents' },
    { id: 'music_offtopic', label: 'Non-music in music videos' }
  ];

  const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

  // '' = leave YouTube's choice alone; 'max' = best the video offers.
  const QUALITIES = [
    { id: 'max', label: 'Best available' },
    { id: 'hd2160', label: '2160p' },
    { id: 'hd1440', label: '1440p' },
    { id: 'hd1080', label: '1080p' },
    { id: 'hd720', label: '720p' },
    { id: 'large', label: '480p' },
    { id: 'medium', label: '360p' }
  ];

  const RESUME_MINUTES = [0, 5, 10, 20];
  const SHORTS_PLAYS = [1, 2, 3];

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    // Ad ladder
    layerData: true,      // L1: strip ad payloads from YouTube JSON
    layerNetwork: true,   // L1: block ad/measurement endpoints (DNR)
    layerCosmetic: true,  // L2: hide ad slots that render anyway
    layerNeutralise: true,// L3: mute + fast-forward + auto-skip ads that play
    dismissWall: true,    //     remove the "ad blockers aren't allowed" wall
    // Sponsor skipping
    sponsorSkip: true,
    sbCategories: Object.freeze({
      sponsor: true,
      selfpromo: true,
      interaction: true,
      intro: false,
      outro: false,
      preview: false,
      filler: false,
      music_offtopic: false
    }),
    // Distraction control
    hideShorts: false,
    hideComments: false,
    hideEndCards: true,
    hideHomeFeed: false,
    hideRelated: false,
    disableAutoplay: false,
    // Playback
    defaultSpeed: 0,      // 0 = don't change
    defaultQuality: '',   // '' = don't change
    resumeEnabled: true,
    resumeMinMinutes: 5,  // only remember videos at least this long
    focusMode: false,
    powerKeys: true,      // ] [ \ speed · A/B loop · Shift+S screenshot
    // Shorts
    shortsAutoScroll: false,
    shortsPlays: 1        // plays before moving on
  });

  const isSpeed = (v) => v === 0 || SPEEDS.includes(v);
  const isQuality = (v) => v === '' || QUALITIES.some((q) => q.id === v);

  /** Merge stored settings over defaults, ignoring unknown keys and wrong types. */
  function mergeSettings(stored) {
    const out = {};
    const src = stored && typeof stored === 'object' ? stored : {};
    for (const [key, def] of Object.entries(DEFAULT_SETTINGS)) {
      if (key === 'sbCategories') {
        const cats = {};
        const s = src.sbCategories && typeof src.sbCategories === 'object' ? src.sbCategories : {};
        for (const [c, v] of Object.entries(def)) cats[c] = typeof s[c] === 'boolean' ? s[c] : v;
        out.sbCategories = cats;
      } else {
        out[key] = typeof src[key] === typeof def ? src[key] : def;
      }
    }
    if (!isSpeed(out.defaultSpeed)) out.defaultSpeed = DEFAULT_SETTINGS.defaultSpeed;
    if (!isQuality(out.defaultQuality)) out.defaultQuality = DEFAULT_SETTINGS.defaultQuality;
    if (!RESUME_MINUTES.includes(out.resumeMinMinutes)) out.resumeMinMinutes = DEFAULT_SETTINGS.resumeMinMinutes;
    if (!SHORTS_PLAYS.includes(out.shortsPlays)) out.shortsPlays = DEFAULT_SETTINGS.shortsPlays;
    return out;
  }

  /** Sanitise one channel's stored preferences; null when there's nothing to keep. */
  function cleanChannelPref(p) {
    if (!p || typeof p !== 'object') return null;
    const speed = isSpeed(p.speed) ? p.speed : 0;
    const quality = isQuality(p.quality) ? p.quality : '';
    if (!speed && !quality) return null;
    return { name: typeof p.name === 'string' ? p.name.slice(0, 100) : '', speed, quality };
  }

  const api = { DEFAULT_SETTINGS, SB_CATEGORIES, SPEEDS, QUALITIES, RESUME_MINUTES, SHORTS_PLAYS, mergeSettings, cleanChannelPref, isSpeed, isQuality };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (globalThis.Clearcut = globalThis.Clearcut || {}).defaults = api;
})();
