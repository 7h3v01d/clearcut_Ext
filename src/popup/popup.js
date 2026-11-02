// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Leon Priest (GitHub: 7h3v01d)

(function () {
  'use strict';

  const CC = globalThis.Clearcut;
  const $ = (id) => document.getElementById(id);

  const AD_ROWS = [
    { key: 'layerData', label: 'L1 · Strip ad data', hint: 'Removes ads from YouTube’s JSON' },
    { key: 'layerNetwork', label: 'L1 · Block ad requests', hint: 'Ad & measurement endpoints' },
    { key: 'layerCosmetic', label: 'L2 · Hide ad slots', hint: 'Anything that renders anyway' },
    { key: 'layerNeutralise', label: 'L3 · Neutralise playing ads', hint: 'Mute, 16×, auto-skip' },
    { key: 'dismissWall', label: 'Dismiss ad-blocker wall', hint: 'Removes the enforcement popup' }
  ];

  const DISTRACT_ROWS = [
    { key: 'hideShorts', label: 'Hide Shorts' },
    { key: 'hideComments', label: 'Hide comments' },
    { key: 'hideEndCards', label: 'Hide end-screen cards' },
    { key: 'hideHomeFeed', label: 'Hide home feed' },
    { key: 'hideRelated', label: 'Hide related videos' },
    { key: 'disableAutoplay', label: 'Turn off autoplay' }
  ];

  let settings = CC.defaults.mergeSettings(null);
  let stats = CC.health.emptyStats();

  function toggle(path, label, hint, extraClass) {
    const row = document.createElement('div');
    row.className = 'row' + (extraClass ? ' ' + extraClass : '');
    const lbl = document.createElement('div');
    lbl.className = 'lbl';
    const t = document.createElement('span');
    t.textContent = label;
    lbl.append(t);
    if (hint) {
      const s = document.createElement('small');
      s.textContent = hint;
      lbl.append(s);
    }
    const sw = document.createElement('label');
    sw.className = 'switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.key = path;
    sw.append(input, document.createElement('span'));
    row.append(lbl, sw);
    return row;
  }

  function buildRows() {
    for (const r of AD_ROWS) $('rows-ads').append(toggle(r.key, r.label, r.hint));
    $('rows-sb').append(toggle('sponsorSkip', 'Skip segments', 'SponsorBlock community data'));
    for (const c of CC.defaults.SB_CATEGORIES) {
      $('rows-sb').append(toggle('sbCategories.' + c.id, c.label, null, 'indent sb-cat'));
    }
    for (const r of DISTRACT_ROWS) $('rows-distract').append(toggle(r.key, r.label));
  }

  function read(path) {
    const [a, b] = path.split('.');
    return b ? settings[a][b] : settings[a];
  }

  function renderSettings() {
    document.querySelectorAll('input[data-key]').forEach((el) => { el.checked = !!read(el.dataset.key); });
    document.querySelectorAll('.sb-cat').forEach((el) => el.classList.toggle('dim', !settings.sponsorSkip));
    document.body.classList.toggle('off', !settings.enabled);
  }

  function renderStats() {
    const day = stats.days[CC.health.dayKey(Date.now())] || CC.health.emptyDay();
    $('s-l1').textContent = day.l1Items;
    $('s-l2').textContent = day.l2;
    $('s-l3').textContent = day.l3;
    $('s-walls').textContent = day.walls;
    $('s-sb').textContent = day.sb;
    $('s-saved').textContent = CC.health.formatDuration(day.savedSec);

    const st = settings.enabled
      ? CC.health.computeStatus(stats)
      : { level: 'off', title: 'Paused', detail: 'Clearcut is switched off.' };
    $('health').dataset.level = st.level;
    $('h-title').textContent = st.title;
    $('h-detail').textContent = st.detail;

    const log = $('log');
    log.replaceChildren();
    if (!stats.log.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Nothing yet.';
      log.append(li);
    }
    for (const ev of stats.log.slice(0, 40)) {
      const li = document.createElement('li');
      const time = document.createElement('time');
      time.textContent = new Date(ev.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const tag = document.createElement('span');
      tag.className = 'tag ' + ev.t;
      tag.textContent = ev.t.toUpperCase();
      const text = document.createElement('span');
      text.textContent = describe(ev);
      li.append(time, tag, text);
      log.append(li);
    }
  }

  function describe(ev) {
    switch (ev.t) {
      case 'l1':
        if (ev.kind === 'player') return `${ev.removed} ad payload(s) · ${ev.videoId || '?'}`;
        if (ev.kind === 'wall') return 'wall stripped from data';
        return `${ev.removed} feed ad(s) stripped`;
      case 'l2': return `${ev.hidden} ad slot(s) hidden`;
      case 'l3': return `ad neutralised · ${ev.videoId || '?'}`;
      case 'wall': return 'enforcement wall dismissed';
      case 'sb': return `${ev.category} · ${CC.health.formatDuration(ev.seconds)}`;
      default: return '';
    }
  }

  async function save() {
    await chrome.storage.local.set({ settings });
  }

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el.dataset || !el.dataset.key) return;
    const [a, b] = el.dataset.key.split('.');
    if (b) settings = Object.assign({}, settings, { [a]: Object.assign({}, settings[a], { [b]: el.checked }) });
    else settings = Object.assign({}, settings, { [a]: el.checked });
    renderSettings();
    renderStats();
    save();
  });

  function flash(text) {
    $('msg').textContent = text;
    setTimeout(() => { $('msg').textContent = ''; }, 1800);
  }

  $('export').addEventListener('click', async () => {
    const manifest = chrome.runtime.getManifest();
    const diag = {
      clearcut: manifest.version,
      userAgent: navigator.userAgent,
      exportedAt: new Date().toISOString(),
      status: CC.health.computeStatus(stats),
      settings,
      stats
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(diag, null, 2));
      flash('Copied.');
    } catch (_) {
      flash('Clipboard blocked.');
    }
  });

  $('reset').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'stats:reset' });
    flash('Stats cleared.');
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings) { settings = CC.defaults.mergeSettings(changes.settings.newValue); renderSettings(); }
    if (changes.stats) { stats = changes.stats.newValue || CC.health.emptyStats(); }
    renderStats();
  });

  async function init() {
    $('ver').textContent = 'v' + chrome.runtime.getManifest().version;
    buildRows();
    const r = await chrome.storage.local.get(['settings', 'stats']);
    settings = CC.defaults.mergeSettings(r.settings);
    if (r.stats && r.stats.days) stats = r.stats;
    renderSettings();
    renderStats();
  }

  init();
})();
