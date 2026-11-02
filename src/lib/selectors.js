// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Leon Priest (GitHub: 7h3v01d)
//
// Layer 2 (cosmetic) and distraction-control selectors, plus the CSS builder.
// Kept in one place so a YouTube markup change is a one-file fix.

(function () {
  'use strict';

  // Plain ad elements. Also used for counting, so no :has() here.
  const AD_ELEMENTS = [
    'ytd-ad-slot-renderer',
    'ytd-in-feed-ad-layout-renderer',
    'ytd-display-ad-renderer',
    'ytd-promoted-sparkles-web-renderer',
    'ytd-promoted-sparkles-text-search-renderer',
    'ytd-promoted-video-renderer',
    'ytd-compact-promoted-video-renderer',
    'ytd-search-pyv-renderer',
    'ytd-banner-promo-renderer',
    'ytd-statement-banner-renderer',
    'ytd-brand-video-shelf-renderer',
    'ytd-brand-video-singleton-renderer',
    'ytd-action-companion-ad-renderer',
    'ytd-companion-slot-renderer',
    'ytd-player-legacy-desktop-watch-ads-renderer',
    'ytd-mealbar-promo-renderer',
    '#masthead-ad',
    '#player-ads',
    '.ytp-ad-overlay-container',
    '.ytp-ad-overlay-slot',
    '.ytp-featured-product',
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]'
  ];

  // Empty shells left behind once the ad inside is hidden.
  const AD_SHELLS = [
    'ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer)',
    'ytd-rich-section-renderer:has(ytd-statement-banner-renderer)',
    'ytd-rich-section-renderer:has(ytd-brand-video-shelf-renderer)'
  ];

  // Anti-adblock enforcement wall (dialog + dimmed backdrop).
  const WALL = [
    'tp-yt-paper-dialog:has(ytd-enforcement-message-view-model)',
    'ytd-enforcement-message-view-model',
    'body:has(ytd-enforcement-message-view-model) tp-yt-iron-overlay-backdrop'
  ];

  const DISTRACTIONS = {
    hideShorts: [
      'ytd-reel-shelf-renderer',
      'ytd-rich-shelf-renderer[is-shorts]',
      'ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])',
      'grid-shelf-view-model:has(a[href^="/shorts/"])',
      'ytd-video-renderer:has(a[href^="/shorts/"])',
      'ytd-guide-entry-renderer:has(a[title="Shorts"])',
      'ytd-mini-guide-entry-renderer[aria-label="Shorts"]'
    ],
    hideComments: [
      'ytd-comments#comments',
      '#comments'
    ],
    hideEndCards: [
      '.ytp-ce-element',
      '.ytp-endscreen-content',
      '.ytp-cards-teaser',
      '.ytp-paid-content-overlay'
    ],
    hideHomeFeed: [
      'ytd-browse[page-subtype="home"] ytd-rich-grid-renderer'
    ],
    hideRelated: [
      'ytd-watch-flexy #secondary #related',
      'ytd-watch-next-secondary-results-renderer'
    ]
  };

  const HIDE = '{display:none!important}';

  /** Build the stylesheet for the given (merged) settings. */
  function buildCss(settings) {
    if (!settings || !settings.enabled) return '';
    const groups = [];
    if (settings.layerCosmetic) groups.push(AD_ELEMENTS, AD_SHELLS);
    if (settings.dismissWall) groups.push(WALL);
    for (const [key, sels] of Object.entries(DISTRACTIONS)) {
      if (settings[key]) groups.push(sels);
    }
    // One rule per selector: an unsupported selector then only drops itself.
    const rules = [];
    for (const g of groups) for (const s of g) rules.push(s + HIDE);
    if (settings.hideHomeFeed) {
      rules.push(
        'ytd-browse[page-subtype="home"] #primary::before{' +
        'content:"Home feed hidden by Clearcut — search or open Subscriptions.";' +
        'display:block;padding:48px 24px;font:14px "JetBrains Mono",Consolas,monospace;color:#8a98a3}'
      );
    }
    return rules.join('\n');
  }

  // Counting only uses renderer elements: the #id containers and .ytp-* player
  // slots exist as empty placeholders on every page and would read as leaks.
  const AD_COUNT_SELECTOR = AD_ELEMENTS.filter((s) => s.startsWith('ytd-')).join(',');

  const api = { AD_ELEMENTS, AD_SHELLS, WALL, DISTRACTIONS, AD_COUNT_SELECTOR, buildCss };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (globalThis.Clearcut = globalThis.Clearcut || {}).selectors = api;
})();
