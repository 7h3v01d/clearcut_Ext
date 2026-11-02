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
  let channels = {};
  let channelCtx = null; // { channelId, author, rate } for the active YouTube tab

  const speedLabel = (v) => (v ? `${v}×` : 'Don’t change');
  const qualityLabel = (v) => (v ? (CC.defaults.QUALITIES.find((q) => q.id === v) || {}).label || v : 'Don’t change');
  const SPEED_OPTS = [0, ...CC.defaults.SPEEDS].map((v) => ({ value: String(v), label: speedLabel(v) }));
  const QUALITY_OPTS = [{ value: '', label: 'Don’t change' }, ...CC.defaults.QUALITIES.map((q) => ({ value: q.id, label: q.label }))];
  const RESUME_OPTS = CC.defaults.RESUME_MINUTES.map((m) => ({ value: String(m), label: m ? `${m} min +` : 'Any length' }));

  /** A labelled <select>. `bind` is either { key, num } for settings or { chan } for channel prefs. */
  function select(label, options, bind, hint) {
    const row = document.createElement('div');
    row.className = 'row';
    const lbl = document.createElement('div');
    lbl.className = 'lbl';
    const t = document.createElement('span');
    t.textContent = label;
    lbl.append(t);
    if (hint) {
      const h = document.createElement('small');
      h.textContent = hint;
      lbl.append(h);
    }
    const sel = document.createElement('select');
    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      sel.append(opt);
    }
    if (bind.key) { sel.dataset.key = bind.key; if (bind.num) sel.dataset.num = '1'; }
    if (bind.chan) sel.dataset.chan = bind.chan;
    row.append(lbl, sel);
    return row;
  }

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

    const pb = $('rows-playback');
    pb.append(select('Default speed', SPEED_OPTS, { key: 'defaultSpeed', num: true }));
    pb.append(select('Default quality', QUALITY_OPTS, { key: 'defaultQuality' }));
    pb.append(toggle('resumeEnabled', 'Resume where I left off', 'Long videos pick up from your last position'));
    pb.append(select('Remember videos', RESUME_OPTS, { key: 'resumeMinMinutes', num: true }));
    const focus = toggle('focusMode', 'Focus mode', null);
    const hint = document.createElement('small');
    hint.append('Theatre, no clutter, auto-hide top bar · ');
    const k = document.createElement('kbd');
    k.textContent = 'Alt+Shift+F';
    hint.append(k);
    focus.querySelector('.lbl').append(hint);
    pb.append(focus);
    const pk = toggle('powerKeys', 'Power keys', null);
    const legend = document.createElement('small');
    for (const [key, what] of [[']  [', 'speed'], ['\\', '1×'], ['A  B', 'loop'], ['Shift+S', 'frame']]) {
      const kb = document.createElement('kbd');
      kb.textContent = key;
      legend.append(kb, ` ${what}  `);
    }
    pk.querySelector('.lbl').append(legend);
    pb.append(pk);

    const forget = document.createElement('div');
    forget.className = 'row';
    const fl = document.createElement('span');
    fl.textContent = 'Saved positions';
    const fb = document.createElement('button');
    fb.className = 'act';
    fb.id = 'forget-resume';
    fb.textContent = 'Forget all';
    forget.append(fl, fb);
    pb.append(forget);

    const sh = $('rows-shorts');
    sh.append(toggle('shortsAutoScroll', 'Auto-scroll Shorts', 'Next Short when this one finishes'));
    sh.append(select('Play each Short', CC.defaults.SHORTS_PLAYS.map((n) => ({
      value: String(n), label: n === 1 ? 'Once' : n === 2 ? 'Twice' : `${n} times`
    })), { key: 'shortsPlays', num: true }, 'Pauses while comments are open or you pause'));

    $('rows-channel').append(select('Speed', SPEED_OPTS, { chan: 'speed' }));
    $('rows-channel').append(select('Quality', QUALITY_OPTS, { chan: 'quality' }));
  }

  function read(path) {
    const [a, b] = path.split('.');
    return b ? settings[a][b] : settings[a];
  }

  function renderSettings() {
    document.querySelectorAll('input[data-key]').forEach((el) => { el.checked = !!read(el.dataset.key); });
    document.querySelectorAll('select[data-key]').forEach((el) => { el.value = String(read(el.dataset.key)); });
    renderChannel();
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
      case 'l3': return ev.shorts ? 'ad Short skipped' : `ad neutralised · ${ev.videoId || '?'}`;
      case 'wall': return 'enforcement wall dismissed';
      case 'sb': return `${ev.category} · ${CC.health.formatDuration(ev.seconds)}`;
      default: return '';
    }
  }

  function renderChannel() {
    const box = $('channel');
    if (!channelCtx || !channelCtx.channelId) { box.hidden = true; return; }
    box.hidden = false;
    $('chan-name').textContent = channelCtx.author || channelCtx.channelId;
    const pref = channels[channelCtx.channelId] || {};
    const sp = box.querySelector('select[data-chan="speed"]');
    const q = box.querySelector('select[data-chan="quality"]');
    // The first option of each mirrors the global default.
    sp.options[0].textContent = `Default (${speedLabel(settings.defaultSpeed)})`;
    q.options[0].textContent = `Default (${qualityLabel(settings.defaultQuality)})`;
    sp.value = String(pref.speed || 0);
    q.value = pref.quality || '';
  }

  async function saveChannel(field, value) {
    const id = channelCtx && channelCtx.channelId;
    if (!id) return;
    const next = Object.assign({}, channels);
    const merged = Object.assign({ name: channelCtx.author || '' }, next[id] || {}, { [field]: value });
    const clean = CC.defaults.cleanChannelPref(merged);
    if (clean) next[id] = clean; else delete next[id];
    channels = next;
    await chrome.storage.local.set({ channels: next });
  }

  async function loadChannelCtx() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !/^https:\/\/www\.youtube\.com\/(watch|live\/)/.test(tab.url || '')) return;
      const ctx = await chrome.tabs.sendMessage(tab.id, { type: 'ctx:get' });
      if (ctx && ctx.channelId) { channelCtx = ctx; renderChannel(); }
    } catch (_) { /* no content script in this tab (e.g. opened before install) */ }
  }

  async function save() {
    await chrome.storage.local.set({ settings });
  }

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el.dataset) return;
    if (el.dataset.chan) {
      const v = el.dataset.chan === 'speed' ? Number(el.value) : el.value;
      saveChannel(el.dataset.chan, v);
      return;
    }
    if (!el.dataset.key) return;
    if (el.localName === 'select') {
      settings = Object.assign({}, settings, { [el.dataset.key]: el.dataset.num ? Number(el.value) : el.value });
      settings = CC.defaults.mergeSettings(settings);
      renderSettings();
      save();
      return;
    }
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

  document.addEventListener('click', async (e) => {
    if (e.target && e.target.id === 'forget-resume') {
      await chrome.runtime.sendMessage({ type: 'resume:clear' });
      flash('Positions forgotten.');
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
    if (changes.channels) { channels = changes.channels.newValue || {}; renderChannel(); }
    renderStats();
  });

  async function init() {
    $('ver').textContent = 'v' + chrome.runtime.getManifest().version;
    buildRows();
    const r = await chrome.storage.local.get(['settings', 'stats', 'channels']);
    settings = CC.defaults.mergeSettings(r.settings);
    if (r.stats && r.stats.days) stats = r.stats;
    if (r.channels && typeof r.channels === 'object') channels = r.channels;
    renderSettings();
    renderStats();
    loadChannelCtx();
  }

  init();
})();
