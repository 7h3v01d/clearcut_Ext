// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Leon Priest (GitHub: 7h3v01d)
//
// v0.3: Shorts auto-scroll and ad-Short skipping.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const defaults = require('../src/lib/defaults.js');
const { createShortsScroller, shortIdFromUrl } = require('../src/content/shorts.js');

const ROOT = path.join(__dirname, '..');
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

const doms = [];
test.afterEach(() => { while (doms.length) doms.pop().window.close(); });

const A = 'AAAAAAAAAAA';
const B = 'BBBBBBBBBBB';

function shortsPage({ button = true, settings = {} } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <ytd-shorts>
      <div id="shorts-inner-container">
        <ytd-reel-video-renderer is-active><div id="shorts-player"><video></video></div></ytd-reel-video-renderer>
      </div>
      ${button ? '<div id="navigation-button-down"><button>Next</button></div>' : ''}
    </ytd-shorts></body></html>`, { url: `https://www.youtube.com/shorts/${A}` });
  doms.push(dom);
  const win = dom.window;
  const doc = win.document;
  const v = doc.querySelector('video');
  const st = { t: 0, d: 30, paused: false };
  Object.defineProperties(v, {
    currentTime: { get: () => st.t, set: (x) => { st.t = x; }, configurable: true },
    duration: { get: () => st.d, configurable: true },
    paused: { get: () => st.paused, configurable: true }
  });
  const cfg = Object.assign(defaults.mergeSettings(null), { shortsAutoScroll: true }, settings);
  const events = [];
  let clock = 1_000_000;
  const scroller = createShortsScroller({ doc, win, getSettings: () => cfg, report: (e) => events.push(e), now: () => clock });
  scroller.start();

  let nexts = 0;
  const btn = doc.querySelector('#navigation-button-down button');
  if (btn) {
    btn.addEventListener('click', () => {
      nexts++;
      win.history.pushState({}, '', `/shorts/${B}`); // YouTube moves to the next Short
    });
  }
  const at = (t) => { st.t = t; v.dispatchEvent(new win.Event('timeupdate')); };
  /** Play through to the end and wrap back to the start (what a looping Short does). */
  const loop = () => { at(10); at(29.6); at(0.1); };
  return { win, doc, v, st, cfg, scroller, events, at, loop, nexts: () => nexts, advance: (ms) => { clock += ms; } };
}

test('shortIdFromUrl', () => {
  assert.equal(shortIdFromUrl(`https://www.youtube.com/shorts/${A}?feature=share`), A);
  assert.equal(shortIdFromUrl(`https://www.youtube.com/watch?v=${A}`), null);
  assert.equal(shortIdFromUrl('nope'), null);
});

test('shortsPlays validates against the allowed list', () => {
  assert.equal(defaults.mergeSettings({ shortsPlays: 7 }).shortsPlays, 1);
  assert.equal(defaults.mergeSettings({ shortsPlays: 3 }).shortsPlays, 3);
  assert.equal(defaults.mergeSettings(null).shortsAutoScroll, false, 'off by default');
});

test('advances to the next Short when the loop wraps', () => {
  const p = shortsPage();
  p.at(5);
  p.at(20);
  assert.equal(p.nexts(), 0, 'no advance mid-play');
  p.loop();
  assert.equal(p.nexts(), 1);
});

test('"Play each Short: twice" waits for the second wrap', () => {
  const p = shortsPage({ settings: { shortsPlays: 2 } });
  p.loop();
  assert.equal(p.nexts(), 0);
  p.loop();
  assert.equal(p.nexts(), 1);
});

test('play count resets for each new Short', () => {
  const p = shortsPage({ settings: { shortsPlays: 2 } });
  p.loop();               // Short A: 1 play
  p.win.history.pushState({}, '', `/shorts/${B}`); // viewer swipes on manually
  p.loop();               // Short B: 1 play — must not count A's play
  assert.equal(p.nexts(), 0);
  p.loop();
  assert.equal(p.nexts(), 1);
});

test('a manual seek in the middle is not a wrap', () => {
  const p = shortsPage();
  p.at(12);
  p.at(0.2); // viewer drags back to the start from mid-way
  assert.equal(p.nexts(), 0);
});

test('stays put while paused, while comments are open, or while the tab is hidden', () => {
  const p = shortsPage();
  p.st.paused = true;
  p.loop();
  assert.equal(p.nexts(), 0, 'paused');
  p.st.paused = false;

  p.doc.querySelector('ytd-shorts').insertAdjacentHTML('beforeend',
    '<ytd-engagement-panel-section-list-renderer visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"></ytd-engagement-panel-section-list-renderer>');
  p.loop();
  assert.equal(p.nexts(), 0, 'comments open');
  p.doc.querySelector('ytd-engagement-panel-section-list-renderer').setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN');

  Object.defineProperty(p.doc, 'visibilityState', { value: 'hidden', configurable: true });
  p.loop();
  assert.equal(p.nexts(), 0, 'tab hidden');
  Object.defineProperty(p.doc, 'visibilityState', { value: 'visible', configurable: true });

  p.loop();
  assert.equal(p.nexts(), 1, 'advances once nothing is in the way');
});

test('advances only once per Short', () => {
  const p = shortsPage();
  // Next button that does NOT navigate (e.g. end of feed).
  const btn = p.doc.querySelector('#navigation-button-down button');
  const stuck = btn.cloneNode(true);
  let clicks = 0;
  stuck.addEventListener('click', () => clicks++);
  btn.replaceWith(stuck);
  p.loop();
  p.loop();
  p.loop();
  assert.equal(clicks, 1);
});

test('ended also counts as a play (non-looping player)', () => {
  const p = shortsPage();
  p.v.dispatchEvent(new p.win.Event('ended'));
  assert.equal(p.nexts(), 1);
});

test('no button: falls back to ArrowDown, then scrolls only if that did nothing', async () => {
  const p = shortsPage({ button: false });
  const keys = [];
  p.doc.addEventListener('keydown', (e) => keys.push(e.key));
  const container = p.doc.getElementById('shorts-inner-container');
  let scrolled = 0;
  container.scrollBy = () => { scrolled++; };
  p.loop();
  assert.deepEqual(keys, ['ArrowDown']);
  await tick(600);
  assert.equal(scrolled, 1, 'URL unchanged → scroll fallback');

  // Second case: the key worked, so no scroll.
  const q = shortsPage({ button: false });
  q.doc.addEventListener('keydown', () => q.win.history.pushState({}, '', `/shorts/${B}`));
  let qScrolled = 0;
  q.doc.getElementById('shorts-inner-container').scrollBy = () => { qScrolled++; };
  q.loop();
  await tick(600);
  assert.equal(qScrolled, 0);
});

test('does nothing when switched off, on watch pages, or for non-Shorts video', () => {
  const off = shortsPage({ settings: { shortsAutoScroll: false } });
  off.loop();
  assert.equal(off.nexts(), 0);

  const master = shortsPage({ settings: { enabled: false } });
  master.loop();
  assert.equal(master.nexts(), 0);

  const p = shortsPage();
  const other = p.doc.createElement('video');
  p.doc.body.appendChild(other);
  let t = 0;
  Object.defineProperties(other, {
    currentTime: { get: () => t, configurable: true },
    duration: { get: () => 30, configurable: true }
  });
  t = 29.8; other.dispatchEvent(new p.win.Event('timeupdate'));
  t = 0.1; other.dispatchEvent(new p.win.Event('timeupdate'));
  assert.equal(p.nexts(), 0, 'video outside ytd-shorts ignored');
});

test('ad Shorts are skipped immediately (layer 3) and reported once', () => {
  const p = shortsPage({ settings: { shortsAutoScroll: false } });
  p.doc.querySelector('ytd-reel-video-renderer').insertAdjacentHTML('beforeend', '<ad-badge-view-model></ad-badge-view-model>');
  p.scroller.sweepAds();
  // YouTube has moved to B but the old reel is still marked active for a moment.
  p.scroller.sweepAds();
  assert.equal(p.nexts(), 1, 'skipped even with auto-scroll off; stale DOM right after not re-judged');
  p.advance(2000);
  p.doc.querySelector('ad-badge-view-model').remove();
  p.scroller.sweepAds();
  assert.equal(p.nexts(), 1, 'the real Short B is left alone');
  assert.equal(p.events.length, 1);
  assert.equal(p.events[0].t, 'l3');
  assert.equal(p.events[0].shorts, true);
});

test('ad-Short skipping follows the L3 toggle', () => {
  const p = shortsPage({ settings: { layerNeutralise: false } });
  p.doc.querySelector('ytd-reel-video-renderer').insertAdjacentHTML('beforeend', '<ytd-ad-slot-renderer></ytd-ad-slot-renderer>');
  p.scroller.sweepAds();
  assert.equal(p.nexts(), 0);
});

test('manifest loads shorts.js before main.js', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const iso = m.content_scripts.find((c) => !c.world).js;
  assert.ok(iso.indexOf('src/content/shorts.js') > -1 && iso.indexOf('src/content/shorts.js') < iso.indexOf('src/content/main.js'));
});
