// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Leon Priest (GitHub: 7h3v01d)
//
// v0.2: player bridge, RPC, toast, playback memory (speed/quality/resume),
// focus mode, plus their service-worker and popup surfaces.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { JSDOM } = require('jsdom');

const defaults = require('../src/lib/defaults.js');
const selectors = require('../src/lib/selectors.js');
const bridge = require('../src/main/player-bridge.js');
const { createRpc } = require('../src/content/rpc.js');
const { createToaster } = require('../src/content/toast.js');
const { createPlayback, fmtTime, hasStartTime } = require('../src/content/playback.js');
const { createPlayerGuard } = require('../src/content/player-guard.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

const doms = [];
function jsdom(html, opts) {
  const d = new JSDOM(html, opts);
  doms.push(d);
  return d;
}
test.afterEach(() => { while (doms.length) doms.pop().window.close(); });

function fakeMedia(v, { duration = 1200, currentTime = 0 } = {}) {
  const st = { duration, currentTime, rate: 1, muted: false };
  Object.defineProperties(v, {
    duration: { get: () => st.duration, configurable: true },
    currentTime: { get: () => st.currentTime, set: (x) => { st.currentTime = x; }, configurable: true },
    playbackRate: { get: () => st.rate, set: (x) => { st.rate = x; }, configurable: true },
    muted: { get: () => st.muted, set: (x) => { st.muted = x; }, configurable: true }
  });
  return st;
}

function watchPage(url) {
  return jsdom(`<!doctype html><html><head></head><body>
    <ytd-watch-flexy><div id="movie_player"><video class="html5-main-video"></video>
    <button class="ytp-size-button"></button></div></ytd-watch-flexy></body></html>`,
  { url: url || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
}

// ---- defaults -------------------------------------------------------------
test('playback settings validate against the allowed lists', () => {
  const m = defaults.mergeSettings({ defaultSpeed: 7, defaultQuality: 'hd9000', resumeMinMinutes: 3 });
  assert.equal(m.defaultSpeed, 0);
  assert.equal(m.defaultQuality, '');
  assert.equal(m.resumeMinMinutes, 5);
  const ok = defaults.mergeSettings({ defaultSpeed: 1.5, defaultQuality: 'hd1080', resumeMinMinutes: 0 });
  assert.deepEqual([ok.defaultSpeed, ok.defaultQuality, ok.resumeMinMinutes], [1.5, 'hd1080', 0]);
});

test('cleanChannelPref drops empty prefs and junk values', () => {
  assert.equal(defaults.cleanChannelPref({ speed: 0, quality: '' }), null);
  assert.equal(defaults.cleanChannelPref(null), null);
  assert.deepEqual(defaults.cleanChannelPref({ speed: 9, quality: 'hd720', name: 'x'.repeat(300) }),
    { name: 'x'.repeat(100), speed: 0, quality: 'hd720' });
});

// ---- player bridge -----------------------------------------------------------
test('pickQuality: best ≤ target, max, and fallbacks', () => {
  const avail = ['hd1080', 'hd720', 'large', 'medium', 'auto'];
  assert.equal(bridge.pickQuality(avail, 'max'), 'hd1080');
  assert.equal(bridge.pickQuality(avail, 'hd2160'), 'hd1080', 'target above what exists → best available');
  assert.equal(bridge.pickQuality(avail, 'hd720'), 'hd720');
  assert.equal(bridge.pickQuality(['hd1080', 'medium'], 'hd720'), 'medium', 'never above the target');
  assert.equal(bridge.pickQuality(['hd1080'], 'medium'), 'hd1080', 'nothing low enough → lowest available');
  assert.equal(bridge.pickQuality([], 'max'), null);
  assert.equal(bridge.pickQuality(avail, 'bogus'), null);
});

function bridgePage() {
  const dom = jsdom('<!doctype html><body><div id="movie_player"></div></body>', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  const win = dom.window;
  const p = win.document.getElementById('movie_player');
  const calls = [];
  let levels = [];
  p.getAvailableQualityLevels = () => levels;
  p.setPlaybackQualityRange = (a, b) => calls.push(['range', a, b]);
  p.setPlaybackQuality = (a) => calls.push(['q', a]);
  p.getPlayerResponse = () => ({ videoDetails: { videoId: 'dQw4w9WgXcQ', channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw', author: 'Rick Astley' } });
  const replies = [];
  win.addEventListener('message', (e) => { if (e.data && e.data.t === 'reply') replies.push(e.data); });
  bridge.install(win);
  // jsdom leaves event.source null; Chrome sets it, so dispatch what Chrome would.
  const send = (data) => win.dispatchEvent(new win.MessageEvent('message', { data: Object.assign({ __clearcut: 1, dir: 'down' }, data), source: win }));
  return { win, calls, replies, send, setLevels: (l) => { levels = l; } };
}

test('bridge: ctx reply carries video, channel and author', async () => {
  const b = bridgePage();
  b.send({ rpc: 1, cmd: 'ctx' });
  await tick(20);
  assert.equal(b.replies.length, 1);
  assert.equal(b.replies[0].ok, true);
  assert.deepEqual({ ...b.replies[0].data }, { videoId: 'dQw4w9WgXcQ', channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw', author: 'Rick Astley', isLive: false });
});

test('bridge: quality waits for levels, then sets the range', async () => {
  const b = bridgePage();
  b.send({ rpc: 7, cmd: 'quality', level: 'hd720' });
  await tick(50);
  assert.equal(b.replies.length, 0, 'still waiting while levels are empty');
  b.setLevels(['hd1080', 'hd720', 'large']);
  await tick(600);
  assert.equal(b.replies.length, 1);
  assert.equal(b.replies[0].data, 'hd720');
  assert.deepEqual(b.calls, [['range', 'hd720', 'hd720'], ['q', 'hd720']]);
});

test('bridge: ignores messages without an rpc id or from another source', async () => {
  const b = bridgePage();
  b.send({ cmd: 'ctx' });
  b.win.dispatchEvent(new b.win.MessageEvent('message', { data: { __clearcut: 1, dir: 'down', rpc: 2, cmd: 'ctx' }, source: null }));
  b.send({ rpc: 3, cmd: 'nope' });
  await tick(20);
  assert.equal(b.replies.length, 1);
  assert.equal(b.replies[0].rpc, 3);
  assert.equal(b.replies[0].ok, false);
});

// ---- rpc --------------------------------------------------------------------
test('rpc resolves on reply, times out to ok:false, never rejects', async () => {
  const dom = jsdom('', { url: 'https://www.youtube.com/' });
  const win = dom.window;
  const outgoing = [];
  win.addEventListener('message', (e) => { if (e.data && e.data.dir === 'down') outgoing.push(e.data); });
  const rpc = createRpc({ win, timeoutMs: 100 });
  const p = rpc.call('ctx');
  await tick(10);
  assert.equal(outgoing[0].cmd, 'ctx');
  assert.equal(rpc.handleReply({ t: 'reply', rpc: outgoing[0].rpc, ok: true, data: { a: 1 } }), true);
  assert.deepEqual(await p, { ok: true, data: { a: 1 } });
  assert.equal(rpc.handleReply({ t: 'l1' }), false);
  const late = await rpc.call('ctx');
  assert.equal(late.ok, false);
  assert.equal(late.timedOut, true);
  assert.equal(rpc._pending(), 0);
});

// ---- toast ------------------------------------------------------------------
test('toast: one at a time, onHide fires on replace, action is single-shot', async () => {
  const dom = watchPage();
  const { document: doc, window: win } = dom.window;
  const player = doc.getElementById('movie_player');
  const toaster = createToaster({ doc, win });
  let hidA = 0;
  let ran = 0;
  const a = toaster.show({ player, message: 'a', action: { label: 'x', run: () => ran++ }, onHide: () => hidA++ });
  toaster.show({ player, message: 'b' });
  assert.equal(hidA, 1);
  assert.equal(doc.querySelectorAll('[data-clearcut="toast"]').length, 1);
  assert.equal(a.runAction(), false, 'a replaced toast can no longer act');
  assert.equal(ran, 0);
  const c = toaster.show({ player, message: 'c', action: { label: 'y', run: () => ran++ }, ms: 30 });
  assert.equal(c.runAction(), true);
  assert.equal(c.runAction(), false);
  assert.equal(ran, 1);
  toaster.show({ player, message: 'd', ms: 30 });
  await tick(60);
  assert.equal(toaster.isShowing(), false, 'auto-hides');
});

// ---- playback -----------------------------------------------------------------
function fakeRpc(ctx) {
  const calls = [];
  return {
    calls,
    ctx,
    call: async (cmd, payload) => {
      calls.push([cmd, payload]);
      if (cmd === 'ctx') return this_ctx(ctx);
      return { ok: true, data: payload && payload.level };
    }
  };
  function this_ctx(c) { return typeof c === 'function' ? c() : { ok: !!c, data: c }; }
}

function memStore(initial) {
  const m = new Map(Object.entries(initial || {}));
  return {
    map: m,
    get: async (k) => m.get(k),
    set: async (k, v) => { m.set(k, v); },
    remove: async (k) => { m.delete(k); }
  };
}

const CTX = { videoId: 'dQw4w9WgXcQ', channelId: 'UCchannel000000000000000', author: 'Chan' };

function setup(opts) {
  const o = opts || {};
  const dom = watchPage(o.url);
  const { document: doc, window: win } = dom.window;
  const v = doc.querySelector('video');
  const media = fakeMedia(v, o.media);
  const settings = Object.assign(defaults.mergeSettings(null), o.settings || {});
  const rpc = o.rpc || fakeRpc(CTX);
  const storage = memStore(o.stored);
  let channels = o.channels || {};
  let ad = !!o.ad;
  let clock = 1_000_000;
  const toaster = createToaster({ doc, win });
  const pb = createPlayback({
    doc, win, rpc, storage, toaster,
    getSettings: () => settings,
    getChannels: () => channels,
    adShowing: () => ad,
    now: () => clock
  });
  pb.start();
  pb.setVideo('dQw4w9WgXcQ');
  const time = async (t) => {
    if (t !== undefined) media.currentTime = t;
    v.dispatchEvent(new win.Event('timeupdate'));
    await tick(5);
  };
  return {
    doc, win, v, media, settings, rpc, storage, pb, time,
    setAd: (x) => { ad = x; },
    setChannels: (c) => { channels = c; },
    advance: (ms) => { clock += ms; }
  };
}

test('playback: global default speed applied once; a manual change is not fought', async () => {
  const s = setup({ settings: { defaultSpeed: 1.5 } });
  await s.time(1);
  assert.equal(s.media.rate, 1.5);
  s.media.rate = 1.25; // viewer changes speed
  await s.time(2);
  await s.time(3);
  assert.equal(s.media.rate, 1.25);
  assert.equal(s.rpc.calls.filter(([c]) => c === 'ctx').length, 1);
});

test('playback: channel prefs override defaults; quality goes through the bridge', async () => {
  const s = setup({
    settings: { defaultSpeed: 1.5, defaultQuality: 'hd720' },
    channels: { UCchannel000000000000000: { name: 'Chan', speed: 2, quality: 'max' } }
  });
  await s.time(1);
  assert.equal(s.media.rate, 2);
  assert.deepEqual(s.rpc.calls.find(([c]) => c === 'quality'), ['quality', { level: 'max' }]);
});

test('playback: "don\'t change" defaults leave speed and quality alone', async () => {
  const s = setup();
  await s.time(1);
  assert.equal(s.media.rate, 1);
  assert.equal(s.rpc.calls.some(([c]) => c === 'quality'), false);
});

test('playback: nothing is applied while an ad is showing', async () => {
  const s = setup({ settings: { defaultSpeed: 2 }, ad: true });
  await s.time(1);
  assert.equal(s.rpc.calls.length, 0);
  assert.equal(s.media.rate, 1);
  s.setAd(false);
  await s.time(1);
  assert.equal(s.media.rate, 2);
});

test('playback: stale ctx is retried, then defaults apply without a channel', async () => {
  const stale = { videoId: 'otherVideo1', channelId: 'UCx', author: 'x' };
  const s = setup({
    settings: { defaultSpeed: 1.25 },
    channels: { UCx: { speed: 3, quality: '' } },
    rpc: fakeRpc(stale)
  });
  for (let i = 0; i < 4; i++) await s.time(i + 1);
  assert.equal(s.media.rate, 1, 'not yet applied while retrying');
  await s.time(6);
  assert.equal(s.media.rate, 1.25, 'stale channel prefs ignored after giving up');
});

test('playback: applyNow re-applies after the channel prefs change', async () => {
  const s = setup();
  await s.time(1);
  s.setChannels({ UCchannel000000000000000: { speed: 1.75, quality: '' } });
  assert.equal(s.pb.applyNow(), true);
  assert.equal(s.media.rate, 1.75);
});

test('resume: seeks to the saved position with a Start over toast', async () => {
  const s = setup({ stored: { 'r:dQw4w9WgXcQ': { t: 312.4, d: 1200, at: 1 } } });
  await s.time(0.2);
  await tick(5);
  assert.equal(s.media.currentTime, 312.4);
  assert.ok(s.doc.querySelector('[data-clearcut="toast"]'));
  assert.equal(s.pb.startOver(), true);
  assert.equal(s.media.currentTime, 0);
});

for (const [name, opts] of [
  ['URL has a start time', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90' }],
  ['video shorter than the minimum', { media: { duration: 240 } }],
  ['saved position is in the last 30s', { stored: { 'r:dQw4w9WgXcQ': { t: 1180, d: 1200, at: 1 } } }],
  ['YouTube already moved past 15s', { media: { duration: 1200, currentTime: 200 } }],
  ['resume is switched off', { settings: { resumeEnabled: false } }]
]) {
  test(`resume: skipped when ${name}`, async () => {
    const stored = opts.stored || { 'r:dQw4w9WgXcQ': { t: 600, d: 1200, at: 1 } };
    const s = setup(Object.assign({}, opts, { stored }));
    const before = s.media.currentTime;
    await s.time();
    await tick(5);
    assert.equal(s.media.currentTime, before);
  });
}

test('resume: positions are saved (throttled), cleared near the end and on ended', async () => {
  const s = setup();
  await s.time(1);        // resume check happens on this tick (nothing stored)
  await s.time(100);
  assert.equal(s.storage.map.get('r:dQw4w9WgXcQ').t, 100);
  await s.time(110);
  assert.equal(s.storage.map.get('r:dQw4w9WgXcQ').t, 100, 'throttled to every 5s');
  s.advance(5000);
  await s.time(120);
  assert.equal(s.storage.map.get('r:dQw4w9WgXcQ').t, 120);
  s.advance(5000);
  await s.time(1185);
  assert.equal(s.storage.map.has('r:dQw4w9WgXcQ'), false, 'finished videos are forgotten');

  s.storage.map.set('r:dQw4w9WgXcQ', { t: 500, d: 1200, at: 1 });
  s.pb.setVideo('AAAAAAAAAAA');
  s.pb.setVideo('dQw4w9WgXcQ');
  s.v.dispatchEvent(new s.win.Event('ended'));
  assert.equal(s.storage.map.has('r:dQw4w9WgXcQ'), false);
});

test('resume: never overwrites the stored position while it is still being read', async () => {
  const stored = { 'r:dQw4w9WgXcQ': { t: 700, d: 1200, at: 1 } };
  const s = setup({ stored, media: { duration: 1200, currentTime: 0 } });
  // Slow storage read: the first tick starts the resume check…
  const realGet = s.storage.get;
  s.storage.get = async (k) => { await tick(40); return realGet(k); };
  s.media.currentTime = 100; // …while the viewer is already past 30s (e.g. YouTube's own resume)
  s.v.dispatchEvent(new s.win.Event('timeupdate'));
  s.advance(6000);
  s.v.dispatchEvent(new s.win.Event('timeupdate'));
  assert.equal(s.storage.map.get('r:dQw4w9WgXcQ').t, 700, 'old position intact during the read');
  await tick(60);
});

test('fmtTime and hasStartTime', () => {
  assert.equal(fmtTime(65), '1:05');
  assert.equal(fmtTime(3725), '1:02:05');
  assert.equal(hasStartTime('https://www.youtube.com/watch?v=x&t=10'), true);
  assert.equal(hasStartTime('https://www.youtube.com/watch?v=x#t=1m'), true);
  assert.equal(hasStartTime('https://www.youtube.com/watch?v=x'), false);
});

// ---- focus mode ---------------------------------------------------------------
test('focus mode CSS is scoped to watch pages and parses', () => {
  const css = selectors.buildCss(Object.assign(defaults.mergeSettings(null), { focusMode: true }));
  const focusRules = css.split('\n').filter((r) => r.includes('data-clearcut-page'));
  assert.equal(focusRules.length, selectors.FOCUS_HIDE.length + selectors.FOCUS_RULES.length);
  const dom = jsdom('<!doctype html><body></body>');
  for (const sel of selectors.FOCUS_HIDE) assert.doesNotThrow(() => dom.window.document.querySelector(sel), sel);
  assert.doesNotMatch(selectors.buildCss(defaults.mergeSettings(null)), /data-clearcut-page/);
});

test('focus mode: theatre switched on once per video, and left alone afterwards', () => {
  const dom = watchPage();
  const { document: doc, window: win } = dom.window;
  const btn = doc.querySelector('.ytp-size-button');
  const flexy = doc.querySelector('ytd-watch-flexy');
  let clicks = 0;
  btn.addEventListener('click', () => { clicks++; flexy.toggleAttribute('theater'); });
  const settings = Object.assign(defaults.mergeSettings(null), { focusMode: true });
  let vid = 'dQw4w9WgXcQ';
  const guard = createPlayerGuard({ doc, win, getSettings: () => settings, getVideoId: () => vid });
  guard.start();
  assert.equal(clicks, 1);
  btn.click(); // viewer leaves theatre
  guard.sweep();
  assert.equal(clicks, 2, 'no re-click for the same video');
  vid = 'AAAAAAAAAAA';
  guard.sweep();
  assert.equal(clicks, 3, 'next video: theatre again');
  guard.stop();
});

// ---- content boot: page tag + popup context ----------------------------------
test('content boot tags watch pages and answers the popup via the player RPC', async () => {
  const dom = jsdom('<!doctype html><html><head></head><body><div id="movie_player"><video></video></div></body></html>',
    { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', runScripts: 'outside-only' });
  const win = dom.window;
  const store = {};
  const runtimeListeners = [];
  win.chrome = {
    storage: {
      local: {
        get: async (k) => (k == null ? { ...store } : Object.fromEntries([].concat(k).map((x) => [x, store[x]]))),
        set: async () => {},
        remove: async () => {}
      },
      onChanged: { addListener() {} }
    },
    runtime: {
      sendMessage: async () => ({ ok: true, segments: [] }),
      onMessage: { addListener: (fn) => runtimeListeners.push(fn) }
    }
  };
  // Stand in for the MAIN-world bridge: answer ctx RPCs the way Chrome would deliver them.
  win.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.dir !== 'down' || d.cmd !== 'ctx') return;
    win.dispatchEvent(new win.MessageEvent('message', { source: win, data: { __clearcut: 1, dir: 'up', t: 'reply', rpc: d.rpc, ok: true, data: CTX } }));
  });
  const manifest = JSON.parse(read('manifest.json'));
  for (const f of manifest.content_scripts.find((c) => !c.world).js) win.eval(read(f));
  await tick(20);
  assert.equal(win.document.documentElement.getAttribute('data-clearcut-page'), 'watch');

  const answer = await new Promise((resolve) => {
    const asyncReply = runtimeListeners[0]({ type: 'ctx:get' }, {}, resolve);
    assert.equal(asyncReply, true);
  });
  assert.equal(answer.channelId, CTX.channelId);
  assert.equal(answer.author, 'Chan');
  assert.equal(runtimeListeners[0]({ type: 'other' }, {}, () => {}), false);
});

// ---- service worker -----------------------------------------------------------
function loadSW(store) {
  const onMessage = [];
  const chrome = {
    storage: {
      local: {
        get: async (k) => (k == null ? JSON.parse(JSON.stringify(store))
          : Object.fromEntries([].concat(k).map((x) => [x, store[x] === undefined ? undefined : JSON.parse(JSON.stringify(store[x]))]))),
        set: async (o) => { Object.assign(store, JSON.parse(JSON.stringify(o))); },
        remove: async (k) => { for (const x of [].concat(k)) delete store[x]; }
      },
      onChanged: { addListener() {} }
    },
    runtime: {
      onInstalled: { addListener: (fn) => { chrome._installed = fn; } },
      onStartup: { addListener: (fn) => { chrome._startup = fn; } },
      onMessage: { addListener: (fn) => onMessage.push(fn) }
    },
    declarativeNetRequest: { updateEnabledRulesets: async () => {} },
    commands: { onCommand: { addListener: (fn) => { chrome._command = fn; } } }
  };
  const ctx = vm.createContext({ chrome, fetch: async () => ({ ok: false, status: 404 }), AbortController, setTimeout, clearTimeout, TextEncoder, URL, crypto: webcrypto, console });
  ctx.globalThis = ctx;
  ctx.importScripts = (...files) => { for (const f of files) vm.runInContext(read(path.posix.join('src/background', f)), ctx); };
  vm.runInContext(read('src/background/sw.js'), ctx);
  const send = (msg) => new Promise((resolve) => { if (!onMessage[0](msg, {}, resolve)) resolve(undefined); });
  return { chrome, send };
}

test('SW: resume positions are pruned to the newest 300 and nothing older than 90 days', async () => {
  const now = Date.now();
  const store = { settings: defaults.mergeSettings(null), 'r:old': { t: 100, d: 900, at: now - 91 * 86400000 }, other: 1 };
  for (let i = 0; i < 310; i++) store['r:v' + i] = { t: 100, d: 900, at: now - i * 1000 };
  const sw = loadSW(store);
  await sw.chrome._startup();
  const left = Object.keys(store).filter((k) => k.startsWith('r:'));
  assert.equal(left.length, 300);
  assert.ok(!('r:old' in store));
  assert.ok('r:v0' in store && !('r:v309' in store), 'newest kept');
  assert.equal(store.other, 1, 'unrelated keys untouched');
});

test('SW: shortcut toggles focus mode; resume:clear forgets positions only', async () => {
  const store = { settings: defaults.mergeSettings(null), 'r:a': { t: 1, at: 1 }, channels: { UCx: { speed: 2 } } };
  const sw = loadSW(store);
  sw.chrome._command('toggle-focus');
  await tick(10);
  assert.equal(store.settings.focusMode, true);
  sw.chrome._command('toggle-focus');
  await tick(10);
  assert.equal(store.settings.focusMode, false);
  sw.chrome._command('something-else');
  const r = await sw.send({ type: 'resume:clear' });
  assert.equal(r.ok, true);
  assert.ok(!('r:a' in store));
  assert.equal(store.channels.UCx.speed, 2);
});

// ---- popup ------------------------------------------------------------------
test('popup: This channel shows for a YouTube tab and writes channel prefs', async () => {
  const html = read('src/popup/popup.html').replace(/<script[^>]*><\/script>/g, '');
  const dom = jsdom(html, { url: 'chrome-extension://x/src/popup/popup.html', runScripts: 'outside-only' });
  const store = { settings: Object.assign(defaults.mergeSettings(null), { defaultSpeed: 1.25 }), channels: {} };
  const listeners = [];
  const manifest = JSON.parse(read('manifest.json'));
  dom.window.chrome = {
    runtime: { getManifest: () => manifest, sendMessage: async () => ({ ok: true }) },
    tabs: {
      query: async () => [{ id: 4, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }],
      sendMessage: async (id, msg) => (id === 4 && msg.type === 'ctx:get' ? Object.assign({ rate: 1 }, CTX) : null)
    },
    storage: {
      local: {
        get: async () => JSON.parse(JSON.stringify(store)),
        set: async (o) => {
          const changes = {};
          for (const [k, v] of Object.entries(o)) { changes[k] = { newValue: v }; store[k] = v; }
          listeners.forEach((fn) => fn(changes, 'local'));
        }
      },
      onChanged: { addListener: (fn) => listeners.push(fn) }
    }
  };
  for (const f of ['src/lib/defaults.js', 'src/lib/health.js', 'src/popup/popup.js']) dom.window.eval(read(f));
  await tick(30);
  const doc = dom.window.document;
  assert.equal(doc.getElementById('channel').hidden, false);
  assert.equal(doc.getElementById('chan-name').textContent, 'Chan');
  const sp = doc.querySelector('select[data-chan="speed"]');
  assert.equal(sp.options[0].textContent, 'Default (1.25×)');

  sp.value = '2';
  sp.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await tick(10);
  assert.deepEqual({ ...store.channels[CTX.channelId] }, { name: 'Chan', speed: 2, quality: '' });

  sp.value = '0'; // back to default → entry removed entirely
  sp.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await tick(10);
  assert.equal(CTX.channelId in store.channels, false);

  const gq = doc.querySelector('select[data-key="defaultQuality"]');
  gq.value = 'hd1080';
  gq.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  const gs = doc.querySelector('select[data-key="resumeMinMinutes"]');
  gs.value = '10';
  gs.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await tick(10);
  assert.equal(store.settings.defaultQuality, 'hd1080');
  assert.equal(store.settings.resumeMinMinutes, 10, 'stored as a number');
});

test('popup: This channel stays hidden off YouTube', async () => {
  const html = read('src/popup/popup.html').replace(/<script[^>]*><\/script>/g, '');
  const dom = jsdom(html, { url: 'chrome-extension://x/src/popup/popup.html', runScripts: 'outside-only' });
  let asked = false;
  dom.window.chrome = {
    runtime: { getManifest: () => ({ version: '0.2.0' }), sendMessage: async () => ({}) },
    tabs: { query: async () => [{ id: 1, url: 'https://example.com/' }], sendMessage: async () => { asked = true; } },
    storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } }
  };
  for (const f of ['src/lib/defaults.js', 'src/lib/health.js', 'src/popup/popup.js']) dom.window.eval(read(f));
  await tick(30);
  assert.equal(dom.window.document.getElementById('channel').hidden, true);
  assert.equal(asked, false);
});
