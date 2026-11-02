// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Leon Priest (GitHub: 7h3v01d)
//
// Service worker: settings defaults, network ruleset toggle, SponsorBlock
// lookups (cached), and the health-log writer.

importScripts('../lib/defaults.js', '../lib/sponsor.js', '../lib/health.js');

const CC = globalThis.Clearcut;
const SB_TTL_MS = 30 * 60 * 1000;
const SB_TIMEOUT_MS = 6000;
const sbCache = new Map(); // key -> { at, segments }

// ---- settings + network ruleset ---------------------------------------
async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return CC.defaults.mergeSettings(settings);
}

async function syncRuleset(settings) {
  const on = settings.enabled && settings.layerNetwork;
  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets(
      on ? { enableRulesetIds: ['ad_network'] } : { disableRulesetIds: ['ad_network'] }
    );
  } catch (_) { /* ignore */ }
}

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  await chrome.storage.local.set({ settings });
  const { stats } = await chrome.storage.local.get('stats');
  if (!stats) await chrome.storage.local.set({ stats: CC.health.emptyStats() });
  await syncRuleset(settings);
});

chrome.runtime.onStartup.addListener(async () => syncRuleset(await getSettings()));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) syncRuleset(CC.defaults.mergeSettings(changes.settings.newValue));
});

// ---- health log writer (serialised so concurrent batches don't clobber) --
let writeChain = Promise.resolve();

function recordEvents(events) {
  writeChain = writeChain.then(async () => {
    const { stats } = await chrome.storage.local.get('stats');
    const s = stats && stats.days ? stats : CC.health.emptyStats();
    const now = Date.now();
    for (const ev of events) CC.health.applyEvent(s, ev, now);
    await chrome.storage.local.set({ stats: s });
  }).catch(() => {});
  return writeChain;
}

// ---- SponsorBlock -------------------------------------------------------
async function sponsorSegments(videoId, categories) {
  const cats = categories.slice().sort();
  const key = `${videoId}|${cats.join(',')}`;
  const hit = sbCache.get(key);
  if (hit && Date.now() - hit.at < SB_TTL_MS) return hit.segments;

  const prefix = await CC.sponsor.hashPrefix(videoId);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SB_TIMEOUT_MS);
  let segments = [];
  try {
    const res = await fetch(CC.sponsor.buildUrl(prefix, cats), { signal: ctrl.signal, credentials: 'omit' });
    if (res.ok) segments = CC.sponsor.parseSegments(await res.json(), videoId, cats);
    else if (res.status !== 404) throw new Error(`SponsorBlock HTTP ${res.status}`); // 404 = no segments
  } finally {
    clearTimeout(timer);
  }
  sbCache.set(key, { at: Date.now(), segments });
  if (sbCache.size > 200) sbCache.delete(sbCache.keys().next().value);
  return segments;
}

// ---- messages -------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;

  if (msg.type === 'events' && Array.isArray(msg.events)) {
    recordEvents(msg.events.slice(0, 200)).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'sb:get') {
    const id = String(msg.videoId || '');
    const cats = Array.isArray(msg.categories) ? msg.categories.filter((c) => typeof c === 'string') : [];
    if (!/^[A-Za-z0-9_-]{11}$/.test(id) || !cats.length) {
      sendResponse({ ok: false, segments: [] });
      return false;
    }
    sponsorSegments(id, cats)
      .then((segments) => sendResponse({ ok: true, segments }))
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message || e), segments: [] }));
    return true;
  }

  if (msg.type === 'stats:reset') {
    writeChain = writeChain.then(() => chrome.storage.local.set({ stats: CC.health.emptyStats() }));
    writeChain.then(() => sendResponse({ ok: true }));
    return true;
  }

  return false;
});
