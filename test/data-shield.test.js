// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Leon Priest (GitHub: 7h3v01d)
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const shield = require('../src/main/data-shield.js');

function playerResponse(extra) {
  return Object.assign({
    responseContext: {},
    playabilityStatus: { status: 'OK' },
    streamingData: { formats: [] },
    videoDetails: { videoId: 'dQw4w9WgXcQ', title: 'x' },
    adPlacements: [{ adPlacementRenderer: {} }],
    playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }],
    adSlots: [{ adSlotRenderer: {} }],
    auxiliaryUi: { messageRenderers: { enforcementMessageViewModel: { title: 'Ad blockers are not allowed' } } }
  }, extra);
}

function feedResponse() {
  return {
    responseContext: {},
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [{
          tabRenderer: {
            content: {
              richGridRenderer: {
                contents: [
                  { richItemRenderer: { content: { videoRenderer: { videoId: 'aaaaaaaaaaa' } } } },
                  { richItemRenderer: { content: { adSlotRenderer: { slotId: '1' } } } },
                  { richItemRenderer: { content: { videoRenderer: { videoId: 'bbbbbbbbbbb' } } } },
                  { richSectionRenderer: { content: { statementBannerRenderer: {} } } },
                  { engagementPanelSectionListRenderer: { targetId: 'engagement-panel-ads' } }
                ]
              }
            }
          }
        }]
      }
    }
  };
}

test('prune strips player ad keys and reports the video', () => {
  const r = playerResponse();
  const res = shield.prune(r);
  assert.equal(res.isPlayer, true);
  assert.equal(res.videoId, 'dQw4w9WgXcQ');
  assert.equal(res.removed, 3);
  assert.equal(res.walls, 1);
  assert.ok(!('adPlacements' in r) && !('playerAds' in r) && !('adSlots' in r));
  assert.deepEqual(r.auxiliaryUi.messageRenderers, {});
  assert.deepEqual(r.streamingData, { formats: [] }, 'content data untouched');
});

test('prune removes ad items from feed lists and keeps real videos', () => {
  const r = feedResponse();
  const res = shield.prune(r);
  const items = r.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.richGridRenderer.contents;
  assert.equal(res.removed, 3);
  assert.equal(res.isPlayer, false);
  assert.deepEqual(items.map((i) => i.richItemRenderer.content.videoRenderer.videoId), ['aaaaaaaaaaa', 'bbbbbbbbbbb']);
});

test('prune finds a player response nested inside a /next-style array', () => {
  const arr = [{ page: 'watch', playerResponse: playerResponse() }, { response: feedResponse() }];
  assert.equal(shield.looksLikeYouTube(arr), true);
  const res = shield.prune(arr);
  assert.equal(res.isPlayer, true);
  assert.equal(res.removed, 6);
});

test('prune is cycle-safe and leaves non-ad data alone', () => {
  const a = { responseContext: {}, items: [{ videoRenderer: { id: 1 } }] };
  a.self = a;
  const res = shield.prune(a);
  assert.equal(res.removed, 0);
  assert.equal(a.items.length, 1);
});

test('looksLikeYouTube rejects unrelated JSON', () => {
  assert.equal(shield.looksLikeYouTube({ hello: 'world' }), false);
  assert.equal(shield.looksLikeYouTube([1, 2, 3]), false);
  assert.equal(shield.looksLikeYouTube(null), false);
  assert.equal(shield.looksLikeYouTube('x'), false);
});

// ---- hooks, exercised in a fresh V8 context that stands in for the page ----

function makePage() {
  const posted = [];
  const ctx = vm.createContext({});
  vm.runInContext(`
    var location = { origin: 'https://www.youtube.com' };
    var __listeners = [];
    function addEventListener(t, fn) { __listeners.push(fn); }
    function postMessage() {}
    globalThis.Response = class Response { constructor(obj, url) { this._o = obj; this.url = url; }
      json() { return Promise.resolve(this._o); } };
    var window = globalThis;
  `, ctx);
  const src = fs.readFileSync(path.join(__dirname, '../src/main/data-shield.js'), 'utf8');
  // Load the API inside the page realm (module present → export, no auto-install).
  ctx.module = { exports: {} };
  vm.runInContext(src, ctx);
  const api = ctx.module.exports;
  delete ctx.module;
  const realm = vm.runInContext('globalThis', ctx);
  const state = api.install(realm, { post: (m) => posted.push(m) });
  return { ctx, posted, state };
}

test('JSON.parse hook prunes YouTube JSON and stays native-looking', () => {
  const { ctx, posted } = makePage();
  const out = vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(playerResponse()))})`, ctx);
  assert.equal(out.adPlacements, undefined);
  assert.equal(posted.length, 2);
  assert.deepEqual(posted.map((p) => p.kind).sort(), ['player', 'wall']);
  assert.equal(posted.find((p) => p.kind === 'player').videoId, 'dQw4w9WgXcQ');

  const str = vm.runInContext('Function.prototype.toString.call(JSON.parse)', ctx);
  assert.match(str, /function parse\(\) \{ \[native code\] \}/);
  const str2 = vm.runInContext('Function.prototype.toString.toString()', ctx);
  assert.match(str2, /function toString\(\) \{ \[native code\] \}/);
});

test('JSON.parse hook ignores ordinary JSON', () => {
  const { ctx, posted } = makePage();
  const out = vm.runInContext(`JSON.parse('{"adPlacements":[1],"padding":"${'x'.repeat(80)}"}')`, ctx);
  assert.equal(JSON.stringify(out.adPlacements), '[1]', 'non-YouTube payloads are never modified');
  assert.equal(posted.length, 0);
});

test('ytInitialPlayerResponse assignment is pruned via the setter', () => {
  const { ctx, posted } = makePage();
  vm.runInContext(`var ytInitialPlayerResponse = ${JSON.stringify(playerResponse())};`, ctx);
  assert.equal(vm.runInContext('ytInitialPlayerResponse.playerAds', ctx), undefined);
  assert.equal(vm.runInContext('ytInitialPlayerResponse.videoDetails.videoId', ctx), 'dQw4w9WgXcQ');
  assert.ok(posted.some((p) => p.kind === 'player' && p.removed === 3));
});

test('ytInitialData assignment strips feed ads', () => {
  const { ctx } = makePage();
  vm.runInContext(`ytInitialData = ${JSON.stringify(feedResponse())};`, ctx);
  const n = vm.runInContext('ytInitialData.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.richGridRenderer.contents.length', ctx);
  assert.equal(n, 2);
});

test('Response.json hook prunes /youtubei/ responses only', async () => {
  const { ctx } = makePage();
  ctx.__a = playerResponse();
  ctx.__b = playerResponse();
  const yt = await vm.runInContext(`new Response(__a, 'https://www.youtube.com/youtubei/v1/player').json()`, ctx);
  assert.equal(yt.adPlacements, undefined);
  const other = await vm.runInContext(`new Response(__b, 'https://www.youtube.com/s/other.json').json()`, ctx);
  assert.ok(Array.isArray(other.adPlacements), 'non-InnerTube fetches untouched');
});

test('disabling via the config channel stops pruning', () => {
  const { ctx, state } = makePage();
  state.enabled = false;
  const out = vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(playerResponse()))})`, ctx);
  assert.ok(Array.isArray(out.adPlacements));
});

test('config message from page with wrong direction is ignored', () => {
  const { ctx, state } = makePage();
  const listeners = vm.runInContext('__listeners', ctx);
  listeners.forEach((fn) => fn({ source: vm.runInContext('globalThis', ctx), data: { __clearcut: 1, dir: 'up', enabled: false } }));
  assert.equal(state.enabled, true);
  listeners.forEach((fn) => fn({ source: vm.runInContext('globalThis', ctx), data: { __clearcut: 1, dir: 'down', enabled: false } }));
  assert.equal(state.enabled, false);
});
