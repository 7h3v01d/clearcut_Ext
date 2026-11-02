// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Leon Priest (GitHub: 7h3v01d)
//
// Packaging integrity, service worker and popup, each with a stubbed chrome API.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { JSDOM } = require('jsdom');
const defaults = require('../src/lib/defaults.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test('manifest: MV3, every referenced file exists, MAIN world scripts are the shield and bridge only', () => {
  assert.equal(manifest.manifest_version, 3);
  const files = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    ...manifest.content_scripts.flatMap((c) => c.js),
    ...manifest.declarative_net_request.rule_resources.map((r) => r.path)
  ];
  for (const f of files) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
  const main = manifest.content_scripts.filter((c) => c.world === 'MAIN');
  assert.equal(main.length, 1);
  assert.deepEqual(main[0].js, ['src/main/data-shield.js', 'src/main/player-bridge.js']);
  // Isolated-world load order: libraries before the modules that use them, main.js last.
  const iso = manifest.content_scripts.find((c) => !c.world).js;
  assert.equal(iso.at(-1), 'src/content/main.js');
  assert.ok(iso.indexOf('src/content/toast.js') < iso.indexOf('src/content/sponsor-skipper.js'));
  assert.ok(iso.indexOf('src/content/rpc.js') < iso.indexOf('src/content/main.js'));
  assert.equal(main[0].run_at, 'document_start');
  for (const c of manifest.content_scripts) assert.deepEqual(c.matches, ['*://www.youtube.com/*']);
});

test('manifest: permissions are minimal', () => {
  assert.deepEqual(manifest.permissions.sort(), ['declarativeNetRequest', 'storage']);
  assert.deepEqual(manifest.host_permissions.sort(), ['*://www.youtube.com/*', 'https://sponsor.ajay.app/*']);
});

test('DNR rules: valid shape, unique ids, block-only, never touch video streams', () => {
  const rules = JSON.parse(read('rules/ad-network.json'));
  const ids = rules.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const r of rules) {
    assert.ok(Number.isInteger(r.id) && r.id > 0);
    assert.equal(r.action.type, 'block');
    assert.ok(Array.isArray(r.condition.resourceTypes) && r.condition.resourceTypes.length);
    const f = r.condition.urlFilter || '';
    assert.doesNotMatch(f, /googlevideo|videoplayback|youtubei\/v1\/player/);
    assert.ok(!(r.condition.requestDomains || []).includes('googlevideo.com'));
  }
});

test('every source file carries the SPDX header and Leon Priest attribution, no Keystone branding', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const f of walk(path.join(ROOT, 'src'))) {
    const s = fs.readFileSync(f, 'utf8');
    assert.match(s, /SPDX-License-Identifier: Apache-2\.0/, f);
    assert.match(s, /Leon Priest/, f);
    assert.doesNotMatch(s, /keystone/i, f);
  }
});

test('data-shield auto-installs in a page realm and prunes there', () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', runScripts: 'outside-only' });
  dom.window.eval(read('src/main/data-shield.js'));
  const out = dom.window.eval(`JSON.parse('{"responseContext":{},"playabilityStatus":{},"videoDetails":{"videoId":"dQw4w9WgXcQ"},"adPlacements":[1],"playerAds":[2]}')`);
  assert.equal(out.adPlacements, undefined);
  assert.equal(out.playerAds, undefined);
  const keys = Object.keys(dom.window).filter((k) => /clearcut/i.test(k));
  assert.deepEqual(keys, [], 'nothing exposed on the page window');
  dom.window.close();
});

// ---- service worker ---------------------------------------------------------
function loadServiceWorker({ fetchImpl } = {}) {
  const store = {};
  const onMessage = [];
  const rulesetCalls = [];
  const chrome = {
    storage: {
      local: {
        get: async (k) => {
          if (k == null) return JSON.parse(JSON.stringify(store));
          const keys = typeof k === 'string' ? [k] : k;
          return Object.fromEntries(keys.map((x) => [x, store[x] === undefined ? undefined : JSON.parse(JSON.stringify(store[x]))]));
        },
        set: async (o) => { Object.assign(store, JSON.parse(JSON.stringify(o))); },
        remove: async (k) => { for (const x of [].concat(k)) delete store[x]; }
      },
      onChanged: { addListener() {} }
    },
    runtime: {
      onInstalled: { addListener: (fn) => { chrome._installed = fn; } },
      onStartup: { addListener() {} },
      onMessage: { addListener: (fn) => onMessage.push(fn) }
    },
    declarativeNetRequest: { updateEnabledRulesets: async (o) => { rulesetCalls.push(o); } },
    commands: { onCommand: { addListener: (fn) => { chrome._command = fn; } } }
  };
  const ctx = vm.createContext({
    chrome, fetch: fetchImpl, AbortController, setTimeout, clearTimeout, TextEncoder, URL,
    crypto: webcrypto, console
  });
  ctx.globalThis = ctx;
  ctx.importScripts = (...files) => {
    for (const f of files) vm.runInContext(read(path.posix.join('src/background', f)), ctx, { filename: f });
  };
  vm.runInContext(read('src/background/sw.js'), ctx);
  const send = (msg) => new Promise((resolve) => {
    const async = onMessage[0](msg, {}, resolve);
    if (!async) resolve(undefined);
  });
  return { chrome, store, send, rulesetCalls };
}

test('SW: install writes defaults and enables the network ruleset', async () => {
  const sw = loadServiceWorker();
  await sw.chrome._installed();
  assert.equal(sw.store.settings.enabled, true);
  assert.ok(sw.store.stats.days);
  assert.equal(JSON.stringify(sw.rulesetCalls.at(-1)), JSON.stringify({ enableRulesetIds: ['ad_network'] }));
});

test('SW: concurrent event batches are all recorded (serialised writes)', async () => {
  const sw = loadServiceWorker();
  await sw.chrome._installed();
  await Promise.all([
    sw.send({ type: 'events', events: [{ t: 'l2', hidden: 2 }] }),
    sw.send({ type: 'events', events: [{ t: 'l2', hidden: 3 }] }),
    sw.send({ type: 'events', events: [{ t: 'sb', seconds: 10 }] })
  ]);
  const day = Object.values(sw.store.stats.days)[0];
  assert.equal(day.l2, 5);
  assert.equal(day.sb, 1);
});

test('SW: SponsorBlock lookup uses the hash prefix, caches, and treats 404 as none', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.includes('/aaaa')) return { ok: false, status: 404 };
    return {
      ok: true, status: 200,
      json: async () => [{ videoID: 'dQw4w9WgXcQ', segments: [{ category: 'sponsor', actionType: 'skip', segment: [10, 40], UUID: 'u1' }] }]
    };
  };
  const sw = loadServiceWorker({ fetchImpl });
  const r1 = await sw.send({ type: 'sb:get', videoId: 'dQw4w9WgXcQ', categories: ['sponsor'] });
  assert.equal(r1.ok, true);
  assert.equal(r1.segments.length, 1);
  assert.ok(!urls[0].includes('dQw4w9WgXcQ'), 'video ID never sent');
  await sw.send({ type: 'sb:get', videoId: 'dQw4w9WgXcQ', categories: ['sponsor'] });
  assert.equal(urls.length, 1, 'second lookup served from cache');

  const bad = await sw.send({ type: 'sb:get', videoId: '../../evil', categories: ['sponsor'] });
  assert.equal(bad.ok, false);
  assert.equal(urls.length, 1);
});

test('SW: SponsorBlock network errors resolve to empty, not a hang', async () => {
  const sw = loadServiceWorker({ fetchImpl: async () => { throw new Error('offline'); } });
  const r = await sw.send({ type: 'sb:get', videoId: 'dQw4w9WgXcQ', categories: ['sponsor'] });
  assert.equal(r.ok, false);
  assert.deepEqual([...r.segments], []);
});

// ---- popup ------------------------------------------------------------------
test('popup renders health + counters and writes toggles to storage', async () => {
  const html = read('src/popup/popup.html').replace(/<script[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'chrome-extension://x/src/popup/popup.html', runScripts: 'outside-only' });
  const store = {
    settings: defaults.mergeSettings(null),
    stats: {
      days: { [require('../src/lib/health.js').dayKey(Date.now())]: { l1Player: 2, l1Items: 7, l2: 1, l3: 1, walls: 0, sb: 3, savedSec: 95 } },
      videos: [{ id: 'a', ts: Date.now(), l1Seen: true, l1Removed: 3, l3: 1 }],
      log: [{ ts: Date.now(), t: 'sb', category: 'sponsor', seconds: 30 }]
    }
  };
  const listeners = [];
  dom.window.chrome = {
    runtime: { getManifest: () => manifest, sendMessage: async () => ({ ok: true }) },
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
  await tick(20);
  const $ = (id) => dom.window.document.getElementById(id);
  assert.equal($('ver').textContent, 'v' + manifest.version);
  assert.equal($('s-l1').textContent, '7');
  assert.equal($('s-sb').textContent, '3');
  assert.equal($('s-saved').textContent, '1m 35s');
  assert.equal($('health').dataset.level, 'warn');
  assert.equal(dom.window.document.querySelectorAll('#log li').length, 1);

  const shorts = dom.window.document.querySelector('input[data-key="hideShorts"]');
  shorts.checked = true;
  shorts.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  const intro = dom.window.document.querySelector('input[data-key="sbCategories.intro"]');
  intro.checked = true;
  intro.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await tick(10);
  assert.equal(store.settings.hideShorts, true);
  assert.equal(store.settings.sbCategories.intro, true);
  assert.equal(store.settings.sbCategories.sponsor, true, 'sibling categories preserved');

  const master = dom.window.document.querySelector('input[data-key="enabled"]');
  master.checked = false;
  master.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await tick(10);
  assert.equal($('health').dataset.level, 'off');
  dom.window.close();
});
