// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Leon Priest (GitHub: 7h3v01d)
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto, createHash } = require('node:crypto');
const { JSDOM } = require('jsdom');

const defaults = require('../src/lib/defaults.js');
const selectors = require('../src/lib/selectors.js');
const sponsor = require('../src/lib/sponsor.js');
const health = require('../src/lib/health.js');

// ---- defaults -----------------------------------------------------------
test('mergeSettings fills defaults and rejects wrong types', () => {
  const m = defaults.mergeSettings({ enabled: 'yes', hideShorts: true, bogus: 1, sbCategories: { intro: true, sponsor: 'no' } });
  assert.equal(m.enabled, true);
  assert.equal(m.hideShorts, true);
  assert.equal('bogus' in m, false);
  assert.equal(m.sbCategories.intro, true);
  assert.equal(m.sbCategories.sponsor, true);
  assert.equal(defaults.mergeSettings(null).layerData, true);
});

test('every SB category has a default and a label', () => {
  const ids = defaults.SB_CATEGORIES.map((c) => c.id).sort();
  assert.deepEqual(ids, Object.keys(defaults.DEFAULT_SETTINGS.sbCategories).sort());
});

// ---- selectors ------------------------------------------------------------
test('buildCss is empty when disabled and respects toggles', () => {
  const s = defaults.mergeSettings(null);
  assert.equal(selectors.buildCss(Object.assign({}, s, { enabled: false })), '');
  const css = selectors.buildCss(s);
  assert.match(css, /ytd-ad-slot-renderer\{display:none!important\}/);
  assert.doesNotMatch(css, /ytd-reel-shelf-renderer/, 'Shorts off by default');
  const css2 = selectors.buildCss(Object.assign({}, s, { hideShorts: true, layerCosmetic: false }));
  assert.match(css2, /ytd-reel-shelf-renderer/);
  assert.doesNotMatch(css2, /ytd-ad-slot-renderer/);
});

test('every selector parses (each is its own rule, so one bad selector cannot sink the sheet)', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const all = [...selectors.AD_ELEMENTS, ...selectors.AD_SHELLS, ...selectors.WALL,
    ...Object.values(selectors.DISTRACTIONS).flat()];
  for (const sel of all) {
    assert.doesNotThrow(() => dom.window.document.querySelector(sel), sel);
  }
  const all_on = Object.assign(defaults.mergeSettings(null), { hideShorts: true, hideComments: true, hideHomeFeed: true, hideRelated: true });
  const rules = selectors.buildCss(all_on).split('\n');
  assert.equal(rules.length, all.length + 1, 'one rule per selector plus the home-feed note');
});

test('count selector excludes always-present placeholders', () => {
  assert.doesNotMatch(selectors.AD_COUNT_SELECTOR, /#player-ads|#masthead-ad|\.ytp-/);
  assert.match(selectors.AD_COUNT_SELECTOR, /ytd-ad-slot-renderer/);
});

// ---- sponsor ----------------------------------------------------------------
test('hashPrefix is the first 4 hex chars of sha256(videoId)', async () => {
  const p = await sponsor.hashPrefix('dQw4w9WgXcQ', webcrypto.subtle);
  assert.equal(p, createHash('sha256').update('dQw4w9WgXcQ').digest('hex').slice(0, 4));
});

test('buildUrl only sends prefix, categories and action types', () => {
  const u = new URL(sponsor.buildUrl('abcd', ['sponsor', 'intro']));
  assert.equal(u.origin + u.pathname, 'https://sponsor.ajay.app/api/skipSegments/abcd');
  assert.deepEqual(JSON.parse(u.searchParams.get('categories')), ['sponsor', 'intro']);
  assert.deepEqual(JSON.parse(u.searchParams.get('actionTypes')), ['skip']);
});

test('parseSegments filters by video, category, action and length', () => {
  const json = [
    { videoID: 'other000000', segments: [{ category: 'sponsor', segment: [1, 50], UUID: 'x' }] },
    { videoID: 'dQw4w9WgXcQ', segments: [
      { category: 'sponsor', actionType: 'skip', segment: [60, 90], UUID: 'b' },
      { category: 'sponsor', actionType: 'skip', segment: [10, 30], UUID: 'a' },
      { category: 'intro', actionType: 'skip', segment: [0, 5], UUID: 'c' },
      { category: 'sponsor', actionType: 'mute', segment: [100, 120], UUID: 'd' },
      { category: 'sponsor', actionType: 'skip', segment: [200, 200.4], UUID: 'e' },
      { category: 'sponsor', actionType: 'skip', segment: ['bad', 3], UUID: 'f' }
    ] }
  ];
  const segs = sponsor.parseSegments(json, 'dQw4w9WgXcQ', ['sponsor']);
  assert.deepEqual(segs.map((s) => s.uuid), ['a', 'b']);
  assert.deepEqual(sponsor.parseSegments({}, 'x', ['sponsor']), []);
});

test('pickSkip respects done-set, end guard and chains overlaps', () => {
  const segs = [
    { uuid: 'a', category: 'sponsor', start: 10, end: 30 },
    { uuid: 'b', category: 'selfpromo', start: 29.8, end: 45 },
    { uuid: 'c', category: 'sponsor', start: 100, end: 110 }
  ];
  assert.equal(sponsor.pickSkip(segs, 5, new Set()), null);
  const hit = sponsor.pickSkip(segs, 12, new Set());
  assert.equal(hit.to, 45);
  assert.deepEqual(hit.uuids, ['a', 'b']);
  assert.equal(sponsor.pickSkip(segs, 12, new Set(['a'])), null);
  assert.equal(sponsor.pickSkip(segs, 109.8, new Set()), null, 'too close to the end to bother');
});

test('videoIdFromUrl handles watch and live URLs only', () => {
  assert.equal(sponsor.videoIdFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10'), 'dQw4w9WgXcQ');
  assert.equal(sponsor.videoIdFromUrl('https://www.youtube.com/live/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(sponsor.videoIdFromUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ'), null);
  assert.equal(sponsor.videoIdFromUrl('https://www.youtube.com/watch?v=bad'), null);
  assert.equal(sponsor.videoIdFromUrl('not a url'), null);
});

// ---- health ---------------------------------------------------------------
const T0 = new Date(2026, 10, 2, 9, 0, 0).getTime();

function feed(events) {
  const s = health.emptyStats();
  events.forEach((e, i) => health.applyEvent(s, e, T0 + i * 1000));
  return s;
}

test('applyEvent aggregates the day and per-video records', () => {
  const s = feed([
    { t: 'l1', kind: 'player', videoId: 'v1', removed: 3 },
    { t: 'l1', kind: 'data', removed: 2 },
    { t: 'l2', hidden: 4 },
    { t: 'l3', videoId: 'v1', seconds: 14.5 },
    { t: 'wall' },
    { t: 'sb', videoId: 'v1', category: 'sponsor', seconds: 30 },
    { t: 'nonsense' }
  ]);
  const d = s.days[health.dayKey(T0)];
  assert.deepEqual(d, { l1Player: 1, l1Items: 5, l2: 4, l3: 1, walls: 1, sb: 1, savedSec: 44.5 });
  assert.equal(s.videos.length, 1);
  assert.deepEqual({ ...s.videos[0], ts: 0 }, { id: 'v1', ts: 0, l1Seen: true, l1Removed: 3, l3: 1 });
  assert.equal(s.log.length, 6);
});

test('clean player responses mark the video seen without logging noise', () => {
  const s = feed([{ t: 'l1', kind: 'player', videoId: 'v1', removed: 0 }]);
  assert.equal(s.videos[0].l1Seen, true);
  assert.equal(s.log.length, 0);
});

test('stats are bounded (videos, log, days)', () => {
  const s = health.emptyStats();
  for (let i = 0; i < 400; i++) health.applyEvent(s, { t: 'l3', videoId: 'v' + i }, T0 + i * 86400000 / 10);
  assert.ok(s.videos.length <= 30);
  assert.ok(s.log.length <= 150);
  assert.ok(Object.keys(s.days).length <= 14);
});

test('computeStatus: idle, ok, warn, bad', () => {
  assert.equal(health.computeStatus(health.emptyStats()).level, 'idle');

  const ok = feed([{ t: 'l1', kind: 'player', videoId: 'a', removed: 3 }, { t: 'l1', kind: 'player', videoId: 'b', removed: 0 }]);
  assert.equal(health.computeStatus(ok).level, 'ok');

  const warn = feed([{ t: 'l1', kind: 'player', videoId: 'a', removed: 3 }, { t: 'l3', videoId: 'a' }]);
  assert.equal(health.computeStatus(warn).level, 'warn');
  assert.match(health.computeStatus(warn).detail, /despite stripping/);

  const blind = feed([{ t: 'video', videoId: 'a' }, { t: 'l3', videoId: 'a' }, { t: 'video', videoId: 'b' }, { t: 'l3', videoId: 'b' }]);
  assert.equal(health.computeStatus(blind).title, 'Layer 1 hook broken');

  const missing = feed([
    { t: 'l1', kind: 'player', videoId: 'a', removed: 0 }, { t: 'l3', videoId: 'a' },
    { t: 'l1', kind: 'player', videoId: 'b', removed: 0 }, { t: 'l3', videoId: 'b' }
  ]);
  assert.equal(health.computeStatus(missing).title, 'Layer 1 missing ads');

  const quietBlind = feed([{ t: 'video', videoId: 'a' }, { t: 'video', videoId: 'b' }, { t: 'video', videoId: 'c' }]);
  assert.equal(health.computeStatus(quietBlind).title, 'Layer 1 blind');
});

test('formatDuration', () => {
  assert.equal(health.formatDuration(9.4), '9s');
  assert.equal(health.formatDuration(125), '2m 05s');
  assert.equal(health.formatDuration(3725), '1h 02m');
});
