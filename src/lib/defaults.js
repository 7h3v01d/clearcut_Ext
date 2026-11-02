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
    disableAutoplay: false
  });

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
    return out;
  }

  const api = { DEFAULT_SETTINGS, SB_CATEGORIES, mergeSettings };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (globalThis.Clearcut = globalThis.Clearcut || {}).defaults = api;
})();
