// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Leon Priest (GitHub: 7h3v01d)
//
// v0.4: power keys — speed, A–B loop, screenshot.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const defaults = require('../src/lib/defaults.js');
const { createToaster } = require('../src/content/toast.js');
const pk = require('../src/content/power-keys.js');

const ROOT = path.join(__dirname, '..');
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const doms = [];
test.afterEach(() => { while (doms.length) doms.pop().window.close(); });

function page({ settings = {}, ad = false, url, canvas, title = 'Cool Video: Part 1/2 - YouTube' } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head><title>${title}</title></head><body>
    <input id="search">
    <div id="contenteditable-root" contenteditable="true"></div>
    <div id="movie_player"><video></video><div class="ytp-progress-bar"></div></div>
  </body></html>`, { url: url || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  doms.push(dom);
  const win = dom.window;
  const doc = win.document;
  const v = doc.querySelector('video');
  const st = { t: 0, d: 600, rate: 1, vw: 1920, vh: 1080 };
  Object.defineProperties(v, {
    currentTime: { get: () => st.t, set: (x) => { st.t = x; }, configurable: true },
    duration: { get: () => st.d, configurable: true },
    playbackRate: { get: () => st.rate, set: (x) => { st.rate = x; }, configurable: true },
    videoWidth: { get: () => st.vw, configurable: true },
    videoHeight: { get: () => st.vh, configurable: true }
  });
  const cfg = Object.assign(defaults.mergeSettings(null), settings);
  const toaster = createToaster({ doc, win });
  const downloads = [];
  let adNow = ad;
  const keys = pk.createPowerKeys({
    doc, win, toaster,
    getSettings: () => cfg,
    adShowing: () => adNow,
    makeCanvas: canvas || (() => fakeCanvas()),
    download: (blob, name) => downloads.push({ blob, name })
  });
  keys.start();
  const press = (key, init = {}, target = doc.body) => {
    const ev = new win.KeyboardEvent('keydown', Object.assign({ key, bubbles: true, cancelable: true }, init));
    target.dispatchEvent(ev);
    return ev;
  };
  return { win, doc, v, st, cfg, keys, press, downloads, setAd: (x) => { adNow = x; } };
}

function fakeCanvas(opts = {}) {
  const c = { width: 0, height: 0, drawn: null };
  c.getContext = () => (opts.noCtx ? null : {
    drawImage: (src, x, y, w, h) => {
      if (opts.tainted) throw new Error('SecurityError');
      c.drawn = { src, w, h };
    }
  });
  c.toBlob = (cb, type) => cb(opts.nullBlob ? null : { type, size: 123 });
  return c;
}

// ---- pure helpers -------------------------------------------------------------
test('clampRate steps by 0.25 within 0.25–4', () => {
  assert.equal(pk.clampRate(1.1), 1);
  assert.equal(pk.clampRate(1.13), 1.25);
  assert.equal(pk.clampRate(9), 4);
  assert.equal(pk.clampRate(0), 0.25);
});

test('fileName strips " - YouTube" and unsafe characters', () => {
  assert.equal(pk.fileName('Cool Video: Part 1/2 - YouTube', 83), 'Cool Video Part 1 2 @ 1m23s.png');
  assert.equal(pk.fileName('', 3725), 'YouTube @ 1h02m05s.png');
  assert.equal(pk.fileName('a'.repeat(200), 0).length, 80 + ' @ 0m00s.png'.length);
});

// ---- speed --------------------------------------------------------------------
test('] and [ step speed past YouTube\'s 2× cap; \\ resets', () => {
  const p = page();
  for (let i = 0; i < 14; i++) p.press(']');
  assert.equal(p.st.rate, 4, 'capped at 4×');
  p.press('[');
  assert.equal(p.st.rate, 3.75);
  const ev = p.press('\\');
  assert.equal(p.st.rate, 1);
  assert.equal(ev.defaultPrevented, true, 'handled keys are consumed');
  for (let i = 0; i < 10; i++) p.press('[');
  assert.equal(p.st.rate, 0.25, 'floor at 0.25×');
  assert.ok(p.doc.querySelector('[data-clearcut="toast"]'), 'speed shown on screen');
});

test('held ] repeats, but other keys ignore auto-repeat', () => {
  const p = page();
  p.press(']', { repeat: true });
  p.press(']', { repeat: true });
  assert.equal(p.st.rate, 1.5);
  p.st.t = 10;
  p.press('a', { repeat: true });
  assert.equal(p.keys.loop().a, null);
});

// ---- guards -------------------------------------------------------------------
test('keys are ignored while typing, with modifiers, during ads, off watch pages, or when disabled', () => {
  const p = page();
  p.press(']', {}, p.doc.getElementById('search'));
  p.press(']', {}, p.doc.getElementById('contenteditable-root'));
  p.press(']', { ctrlKey: true });
  p.press(']', { altKey: true });
  p.press(']', { metaKey: true });
  assert.equal(p.st.rate, 1);
  const untouched = p.press('x');
  assert.equal(untouched.defaultPrevented, false, 'unhandled keys pass through to YouTube');

  p.setAd(true);
  p.press(']');
  assert.equal(p.st.rate, 1, 'ad showing');

  const shorts = page({ url: 'https://www.youtube.com/shorts/AAAAAAAAAAA' });
  shorts.press(']');
  assert.equal(shorts.st.rate, 1, 'not a watch page');

  const off = page({ settings: { powerKeys: false } });
  off.press(']');
  assert.equal(off.st.rate, 1);
});

test('isEditable recognises text inputs but not buttons/checkboxes', () => {
  const p = page();
  const mk = (html) => { const d = p.doc.createElement('div'); d.innerHTML = html; return d.firstChild; };
  assert.equal(pk.isEditable(mk('<input type="text">')), true);
  assert.equal(pk.isEditable(mk('<input>')), true);
  assert.equal(pk.isEditable(mk('<input type="checkbox">')), false);
  assert.equal(pk.isEditable(mk('<textarea></textarea>')), true);
  assert.equal(pk.isEditable(mk('<button></button>')), false);
  assert.equal(pk.isEditable(null), false);
});

// ---- A–B loop ------------------------------------------------------------------
test('A then B loops the section, with progress-bar markers; B again stops', async () => {
  const p = page();
  p.st.t = 60;
  p.press('a');
  assert.ok(p.doc.querySelector('[data-clearcut="loop-marks"]'), 'start marker drawn');
  p.st.t = 90;
  p.press('b');
  assert.deepEqual(p.keys.loop(), { a: 60, b: 90, active: true });
  assert.equal(p.st.t, 60, 'jumps back to A when the loop starts');
  const span = p.doc.querySelector('[data-clearcut="loop-marks"] > div');
  assert.equal(span.style.left, '10%');
  assert.equal(span.style.width, '5%');

  p.st.t = 90.02; // playback reaches B
  await tick(80);
  assert.equal(p.st.t, 60, 'wrapped back to A');

  p.press('b');
  assert.deepEqual(p.keys.loop(), { a: null, b: null, active: false });
  assert.equal(p.doc.querySelector('[data-clearcut="loop-marks"]'), null);
  p.st.t = 95;
  await tick(80);
  assert.equal(p.st.t, 95, 'no more wrapping');
});

test('B without A, or B before A, does not start a loop', () => {
  const p = page();
  p.st.t = 50;
  p.press('b');
  assert.equal(p.keys.loop().active, false);
  p.press('a');
  p.st.t = 50.2;
  p.press('b');
  assert.equal(p.keys.loop().active, false, 'end must be after the start');
  p.st.t = 30;
  p.press('b');
  assert.equal(p.keys.loop().active, false);
});

test('pressing A again re-anchors and clears an active loop; reset() clears for a new video', () => {
  const p = page();
  p.st.t = 10; p.press('a');
  p.st.t = 20; p.press('b');
  p.st.t = 15; p.press('a');
  assert.deepEqual(p.keys.loop(), { a: 15, b: null, active: false });
  p.keys.reset();
  assert.deepEqual(p.keys.loop(), { a: null, b: null, active: false });
});

test('the loop does not fight an ad', async () => {
  const p = page();
  p.st.t = 10; p.press('a');
  p.st.t = 20; p.press('b');
  p.setAd(true);
  p.st.t = 25; // ad media time
  await tick(80);
  assert.equal(p.st.t, 25);
  p.keys.reset();
});

// ---- screenshot -------------------------------------------------------------------
test('Shift+S saves the frame at full video resolution with a titled filename', async () => {
  let made = null;
  const p = page({ canvas: () => (made = fakeCanvas()) });
  p.st.t = 83.6;
  const ev = p.press('S', { shiftKey: true });
  assert.equal(ev.defaultPrevented, true);
  await tick(5);
  assert.equal(made.width, 1920);
  assert.equal(made.height, 1080);
  assert.equal(made.drawn.src, p.v);
  assert.equal(p.downloads.length, 1);
  assert.equal(p.downloads[0].name, 'Cool Video Part 1 2 @ 1m23s.png');
  assert.equal(p.downloads[0].blob.type, 'image/png');
});

test('plain s is left for YouTube; screenshot failures are reported, not thrown', async () => {
  const p = page();
  assert.equal(p.press('s').defaultPrevented, false);

  for (const opts of [{ noCtx: true }, { tainted: true }, { nullBlob: true }]) {
    const q = page({ canvas: () => fakeCanvas(opts) });
    const ok = await q.keys.shoot(q.v);
    assert.equal(ok, false, JSON.stringify(opts));
    assert.equal(q.downloads.length, 0);
  }
  const noSize = page();
  noSize.st.vw = 0;
  assert.equal(await noSize.keys.shoot(noSize.v), false, 'no frame decoded yet');
});

test('manifest loads power-keys.js before main.js; setting is on by default', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const iso = m.content_scripts.find((c) => !c.world).js;
  assert.ok(iso.indexOf('src/content/power-keys.js') > -1 && iso.indexOf('src/content/power-keys.js') < iso.indexOf('src/content/main.js'));
  assert.equal(defaults.mergeSettings(null).powerKeys, true);
});

test('full boot: navigating to another video clears an A–B loop', async () => {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <div id="movie_player"><video></video><div class="ytp-progress-bar"></div></div></body></html>`,
  { url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA', runScripts: 'outside-only' });
  doms.push(dom);
  const win = dom.window;
  const doc = win.document;
  const v = doc.querySelector('video');
  let t = 0;
  Object.defineProperties(v, {
    currentTime: { get: () => t, set: (x) => { t = x; }, configurable: true },
    duration: { get: () => 600, configurable: true }
  });
  win.chrome = {
    storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} }, onChanged: { addListener() {} } },
    runtime: { sendMessage: async () => ({ ok: true, segments: [] }), onMessage: { addListener() {} } }
  };
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  for (const f of m.content_scripts.find((c) => !c.world).js) win.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  await tick(20);
  const key = (k) => doc.body.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  t = 10; key('a');
  t = 20; key('b');
  assert.ok(doc.querySelector('[data-clearcut="loop-marks"]'));
  win.history.pushState({}, '', '/watch?v=BBBBBBBBBBB');
  doc.dispatchEvent(new win.Event('yt-navigate-finish'));
  assert.equal(doc.querySelector('[data-clearcut="loop-marks"]'), null);
  t = 25;
  await tick(80);
  assert.equal(t, 25, 'old loop no longer wraps the new video');
});
