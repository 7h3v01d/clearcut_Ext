// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Leon Priest (GitHub: 7h3v01d)
//
// jsdom integration: player guard (layer 3 + wall), sponsor skipper, and a
// full boot of the isolated-world content scripts with a stubbed chrome API.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { createPlayerGuard } = require('../src/content/player-guard.js');
const { createSponsorSkipper } = require('../src/content/sponsor-skipper.js');
const { createToaster } = require('../src/content/toast.js');
const sponsor = require('../src/lib/sponsor.js');
const defaults = require('../src/lib/defaults.js');

const ROOT = path.join(__dirname, '..');
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

// Every window is closed after its test so jsdom timers can't keep Node alive.
const doms = [];
function jsdom(html, opts) {
  const d = new JSDOM(html, opts);
  doms.push(d);
  return d;
}
test.afterEach(() => { while (doms.length) doms.pop().window.close(); });

/** Give a jsdom <video> controllable media state. */
function fakeMedia(v, { duration = 600, currentTime = 0, paused = false } = {}) {
  const st = { duration, currentTime, paused, rate: 1, muted: false, plays: 0 };
  Object.defineProperties(v, {
    duration: { get: () => st.duration, configurable: true },
    currentTime: { get: () => st.currentTime, set: (x) => { st.currentTime = x; }, configurable: true },
    paused: { get: () => st.paused, configurable: true },
    playbackRate: { get: () => st.rate, set: (x) => { st.rate = x; }, configurable: true },
    muted: { get: () => st.muted, set: (x) => { st.muted = x; }, configurable: true },
    play: { value: () => { st.paused = false; st.plays++; return Promise.resolve(); }, configurable: true }
  });
  return st;
}

function watchPage() {
  const dom = jsdom(`<!doctype html><html><head></head><body>
    <div id="movie_player" class="html5-video-player"><video class="html5-main-video"></video></div>
  </body></html>`, { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  return dom;
}

test('L3: ad-showing → muted, 16x, seeked to end, skip clicked; restored after', async () => {
  const dom = watchPage();
  const { document: doc, window: win } = dom.window;
  const v = doc.querySelector('video');
  const media = fakeMedia(v);
  media.rate = 1.5; // viewer's own speed

  const events = [];
  const settings = defaults.mergeSettings(null);
  const guard = createPlayerGuard({ doc, win, report: (e) => events.push(e), getSettings: () => settings, getVideoId: () => 'dQw4w9WgXcQ' });
  guard.start();

  // An ad starts: YouTube flips the class and swaps the media to a 30s ad.
  media.duration = 30;
  media.currentTime = 0;
  const player = doc.getElementById('movie_player');
  player.classList.add('ad-showing');
  await tick(10);
  assert.equal(guard.isInAd(), true);
  assert.equal(media.muted, true);
  assert.equal(media.rate, 16);
  assert.ok(media.currentTime >= 29.8, 'seeked to the end of the ad');

  // Skip button appears later in the ad.
  let clicked = 0;
  const btn = doc.createElement('button');
  btn.className = 'ytp-skip-ad-button';
  btn.addEventListener('click', () => clicked++);
  player.appendChild(btn);
  await tick(300);
  assert.ok(clicked >= 1, 'skip button clicked');

  // Ad ends.
  player.classList.remove('ad-showing');
  await tick(10);
  assert.equal(guard.isInAd(), false);
  assert.equal(media.muted, false, 'mute restored');
  assert.equal(media.rate, 1.5, 'viewer speed restored');
  assert.equal(events.filter((e) => e.t === 'l3').length, 1);
  assert.equal(events[0].videoId, 'dQw4w9WgXcQ');
  guard.stop();
});

test('L3 respects the layer toggle', async () => {
  const dom = watchPage();
  const { document: doc, window: win } = dom.window;
  const media = fakeMedia(doc.querySelector('video'));
  const settings = Object.assign(defaults.mergeSettings(null), { layerNeutralise: false });
  const guard = createPlayerGuard({ doc, win, getSettings: () => settings });
  guard.start();
  doc.getElementById('movie_player').classList.add('ad-showing');
  await tick(10);
  assert.equal(media.muted, false);
  assert.equal(guard.isInAd(), false);
  guard.stop();
});

test('L3 attaches to a player created after start (SPA navigation)', async () => {
  const dom = jsdom('<!doctype html><body></body>', { url: 'https://www.youtube.com/' });
  const { document: doc, window: win } = dom.window;
  const guard = createPlayerGuard({ doc, win, getSettings: () => defaults.mergeSettings(null) });
  guard.start();
  const p = doc.createElement('div');
  p.id = 'movie_player';
  const v = doc.createElement('video');
  p.appendChild(v);
  doc.body.appendChild(p);
  const media = fakeMedia(v, { duration: 15 });
  await tick(200); // sweep is coalesced to 150ms
  p.classList.add('ad-interrupting');
  await tick(10);
  assert.equal(media.muted, true);
  guard.stop();
});

test('wall: enforcement dialog removed, backdrop removed, playback resumed', async () => {
  const dom = watchPage();
  const { document: doc, window: win } = dom.window;
  const media = fakeMedia(doc.querySelector('video'), { paused: true });
  const events = [];
  const guard = createPlayerGuard({ doc, win, report: (e) => events.push(e), getSettings: () => defaults.mergeSettings(null) });
  guard.start();

  doc.body.insertAdjacentHTML('beforeend',
    '<tp-yt-iron-overlay-backdrop class="opened"></tp-yt-iron-overlay-backdrop>' +
    '<tp-yt-paper-dialog><ytd-enforcement-message-view-model></ytd-enforcement-message-view-model></tp-yt-paper-dialog>');
  await tick(200);
  assert.equal(doc.querySelector('tp-yt-paper-dialog'), null);
  assert.equal(doc.querySelector('tp-yt-iron-overlay-backdrop'), null);
  assert.equal(media.plays, 1);
  assert.deepEqual(events, [{ t: 'wall' }]);
  guard.stop();
});

test('autoplay is switched off once per video, not fought after the viewer re-enables it', async () => {
  const dom = watchPage();
  const { document: doc, window: win } = dom.window;
  doc.body.insertAdjacentHTML('beforeend', '<button class="ytp-autonav-toggle-button" aria-checked="true"></button>');
  const btn = doc.querySelector('.ytp-autonav-toggle-button');
  let clicks = 0;
  btn.addEventListener('click', () => { clicks++; btn.setAttribute('aria-checked', String(btn.getAttribute('aria-checked') !== 'true')); });
  const settings = Object.assign(defaults.mergeSettings(null), { disableAutoplay: true });
  const guard = createPlayerGuard({ doc, win, getSettings: () => settings, getVideoId: () => 'dQw4w9WgXcQ' });
  guard.start();
  assert.equal(clicks, 1);
  btn.setAttribute('aria-checked', 'true'); // viewer turns it back on
  guard.sweep();
  assert.equal(clicks, 1);
  guard.stop();
});

// ---- sponsor skipper -------------------------------------------------------
function makeSkipper(doc, win, segments, extra) {
  const events = [];
  const settings = defaults.mergeSettings(null);
  const skipper = createSponsorSkipper(Object.assign({
    doc, win, sponsor, report: (e) => events.push(e), getSettings: () => settings,
    toaster: createToaster({ doc, win }),
    fetchSegments: async () => segments, labels: { sponsor: 'sponsor read' }
  }, extra));
  return { skipper, events, settings };
}

test('sponsor skipper skips once, shows toast, Undo seeks back and is respected', async () => {
  const dom = watchPage();
  const { document: doc, window: win } = dom.window;
  const v = doc.querySelector('video');
  const media = fakeMedia(v, { duration: 600 });
  const { skipper, events } = makeSkipper(doc, win, [{ uuid: 'a', category: 'sponsor', start: 60, end: 90 }]);
  skipper.start();
  await skipper.setVideo('dQw4w9WgXcQ');

  media.currentTime = 61;
  v.dispatchEvent(new win.Event('timeupdate'));
  assert.equal(media.currentTime, 90);
  assert.equal(events.length, 1);
  assert.equal(events[0].category, 'sponsor');
  assert.equal(events[0].seconds, 29);

  const host = doc.querySelector('[data-clearcut="toast"]');
  assert.ok(host, 'toast shown inside the player');

  assert.equal(skipper.undoLast(), true);
  assert.equal(media.currentTime, 60.5, 'Undo seeks back to just before the segment');
  assert.equal(doc.querySelector('[data-clearcut="toast"]'), null, 'toast closed on undo');
  assert.equal(skipper.undoLast(), false, 'undo is single-shot');

  media.currentTime = 61;
  v.dispatchEvent(new win.Event('timeupdate'));
  assert.equal(media.currentTime, 61, 'an undone segment is never re-skipped this video');
  assert.equal(events.length, 1);
  skipper.stop();
  assert.equal(doc.querySelector('[data-clearcut="toast"]'), null);
});

test('sponsor skipper does nothing during ads or for non-player videos', async () => {
  const dom = watchPage();
  const { document: doc, window: win } = dom.window;
  const v = doc.querySelector('video');
  const media = fakeMedia(v);
  let inAd = true;
  const { skipper, events } = makeSkipper(doc, win, [{ uuid: 'a', category: 'sponsor', start: 0, end: 30 }], { isInAd: () => inAd });
  skipper.start();
  await skipper.setVideo('dQw4w9WgXcQ');
  media.currentTime = 5;
  v.dispatchEvent(new win.Event('timeupdate'));
  assert.equal(media.currentTime, 5);

  inAd = false;
  const stray = doc.createElement('video');
  const strayMedia = fakeMedia(stray);
  doc.body.appendChild(stray);
  strayMedia.currentTime = 5;
  stray.dispatchEvent(new win.Event('timeupdate'));
  assert.equal(strayMedia.currentTime, 5, 'preview/hover videos outside #movie_player are ignored');
  assert.equal(events.length, 0);
  skipper.stop();
});

test('sponsor skipper drops results from a stale navigation', async () => {
  const dom = watchPage();
  const { document: doc, window: win } = dom.window;
  let release;
  const slow = new Promise((r) => { release = r; });
  const calls = [];
  const { skipper } = makeSkipper(doc, win, null, {
    fetchSegments: (id) => { calls.push(id); return id === 'AAAAAAAAAAA' ? slow : Promise.resolve([]); }
  });
  const first = skipper.setVideo('AAAAAAAAAAA');
  await skipper.setVideo('BBBBBBBBBBB');
  release([{ uuid: 'x', category: 'sponsor', start: 1, end: 9 }]);
  await first;
  assert.deepEqual(skipper._state().segments, []);
  assert.equal(skipper._state().videoId, 'BBBBBBBBBBB');
});

// ---- full isolated-world boot with a chrome stub -------------------------
function chromeStub(initial) {
  const store = { settings: initial };
  const listeners = [];
  const sent = [];
  const runtimeListeners = [];
  return {
    sent,
    store,
    runtimeListeners,
    api: {
      storage: {
        local: {
          get: async (k) => (k == null ? { ...store } : typeof k === 'string' ? { [k]: store[k] } : Object.fromEntries(k.map((x) => [x, store[x]]))),
          remove: async (k) => { for (const x of [].concat(k)) delete store[x]; },
          set: async (o) => {
            const changes = {};
            for (const [k, v] of Object.entries(o)) { changes[k] = { oldValue: store[k], newValue: v }; store[k] = v; }
            listeners.forEach((fn) => fn(changes, 'local'));
          }
        },
        onChanged: { addListener: (fn) => listeners.push(fn) }
      },
      runtime: {
        sendMessage: async (m) => { sent.push(m); return m.type === 'sb:get' ? { ok: true, segments: [] } : { ok: true }; },
        onMessage: { addListener: (fn) => { runtimeListeners.push(fn); } }
      }
    }
  };
}

function bootContent(dom, chrome) {
  const win = dom.window;
  win.chrome = chrome.api;
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const iso = manifest.content_scripts.find((c) => !c.world);
  for (const f of iso.js) win.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
}

test('content boot: stylesheet injected, settings live-update, L1 bridge relays to service worker', async () => {
  const dom = jsdom('<!doctype html><html><head></head><body><div id="movie_player"><video></video></div></body></html>',
    { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', runScripts: 'outside-only' });
  const chrome = chromeStub(undefined);
  const posts = [];
  dom.window.addEventListener('message', (e) => { if (e.data && e.data.dir === 'down') posts.push(e.data); });
  bootContent(dom, chrome);
  await tick(20);

  const doc = dom.window.document;
  const style = doc.querySelector('style[data-clearcut="css"]');
  assert.ok(style && /ytd-ad-slot-renderer/.test(style.textContent));
  assert.ok(posts.some((p) => p.enabled === true), 'config pushed down to MAIN world');
  assert.ok(chrome.sent.some((m) => m.type === 'sb:get' && m.videoId === 'dQw4w9WgXcQ'));

  // Live settings change: master off → empty stylesheet, L1 told to stop.
  await chrome.api.storage.local.set({ settings: Object.assign(defaults.mergeSettings(null), { enabled: false }) });
  await tick(20);
  assert.equal(style.textContent, '');
  assert.equal(posts[posts.length - 1].enabled, false);

  // An L1 report from the MAIN world gets relayed (sanitised) in a batch.
  // jsdom's postMessage leaves event.source null; Chrome sets it to the window
  // (the documented MAIN↔isolated pattern), so dispatch the event Chrome would.
  const up = (data, source) => dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data, source }));
  up({ __clearcut: 1, dir: 'up', t: 'l1', kind: 'data', removed: 9 }, null); // foreign source: ignored
  up({ __clearcut: 1, dir: 'up', t: 'l1', kind: 'player', videoId: 'dQw4w9WgXcQ', removed: 3, extra: 'dropped' }, dom.window);
  await tick(1700);
  const batch = chrome.sent.find((m) => m.type === 'events' && m.events.some((e) => e.t === 'l1'));
  assert.ok(batch, 'event batch flushed');
  const ev = batch.events.find((e) => e.t === 'l1');
  assert.deepEqual({ ...ev }, { t: 'l1', kind: 'player', videoId: 'dQw4w9WgXcQ', removed: 3 }, 'extra fields stripped');
  const allL1 = chrome.sent.filter((m) => m.type === 'events').flatMap((m) => m.events).filter((e) => e.t === 'l1');
  assert.equal(allL1.length, 1, 'message from a foreign source was dropped');
  dom.window.close();
});

test('content boot: leaked ad renderers are counted once as L2', async () => {
  const dom = jsdom('<!doctype html><html><head></head><body><ytd-ad-slot-renderer></ytd-ad-slot-renderer><div id="player-ads"></div></body></html>',
    { url: 'https://www.youtube.com/', runScripts: 'outside-only' });
  const chrome = chromeStub(undefined);
  bootContent(dom, chrome);
  await tick(1700);
  const l2 = chrome.sent.filter((m) => m.type === 'events').flatMap((m) => m.events).filter((e) => e.t === 'l2');
  assert.equal(l2.length, 1);
  assert.equal(l2[0].hidden, 1, 'renderer counted; empty #player-ads placeholder not');
  dom.window.close();
});
