// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Leon Priest (GitHub: 7h3v01d)
//
// Power keys on watch pages. All are keys YouTube leaves unbound:
//   ]  /  [    speed ±0.25 (0.25×–4×, past YouTube's 2× cap)
//   \          speed back to 1×
//   A          set loop start (clears any loop)
//   B          set loop end → loop A–B;  B again while looping → loop off
//   Shift+S    save the current frame as a PNG
// Ignored while typing, with Ctrl/Alt/Meta held, and while an ad is showing.

(function () {
  'use strict';

  const STEP = 0.25;
  const MIN_RATE = 0.25;
  const MAX_RATE = 4;
  const LOOP_TICK_MS = 50;
  const OSD_MS = 1400;

  function clampRate(r) {
    const stepped = Math.round(r / STEP) * STEP;
    return Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(stepped * 100) / 100));
  }

  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    const n = el.localName;
    if (n === 'textarea' || n === 'select') return true;
    if (n === 'input') return !/^(button|checkbox|radio|range|submit|reset|file|image|color)$/i.test(el.type || 'text');
    return !!(el.closest && el.closest('[contenteditable=""],[contenteditable="true"]'));
  }

  function stamp(sec) {
    const s = Math.floor(Math.max(0, sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const pad = (n) => String(n).padStart(2, '0');
    return h ? `${h}h${pad(m)}m${pad(s % 60)}s` : `${m}m${pad(s % 60)}s`;
  }

  function fileName(title, sec) {
    const base = String(title || 'YouTube').replace(/\s*-\s*YouTube\s*$/i, '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'YouTube';
    return `${base} @ ${stamp(sec)}.png`;
  }

  function createPowerKeys(opts) {
    const doc = opts.doc;
    const win = opts.win || doc.defaultView;
    const getSettings = opts.getSettings;
    const toaster = opts.toaster;
    const adShowing = opts.adShowing || (() => false);
    const isWatchPage = opts.isWatchPage || (() => /^\/(watch|live\/)/.test(win.location.pathname));
    const makeCanvas = opts.makeCanvas || (() => doc.createElement('canvas'));
    const download = opts.download || ((blob, name) => {
      const url = win.URL.createObjectURL(blob);
      const a = doc.createElement('a');
      a.href = url;
      a.download = name;
      a.style.display = 'none';
      (doc.body || doc.documentElement).appendChild(a);
      a.click();
      a.remove();
      win.setTimeout(() => win.URL.revokeObjectURL(url), 4000);
    });

    let loopA = null;
    let loopB = null;
    let loopTimer = null;
    let marks = null;

    const on = () => {
      const s = getSettings() || {};
      return !!(s.enabled && s.powerKeys);
    };

    function player() { return doc.getElementById('movie_player'); }
    function video() { const p = player(); return p && p.querySelector('video'); }

    function osd(message) {
      const p = player();
      if (p && toaster) toaster.show({ player: p, message, ms: OSD_MS });
    }

    // ---- speed -------------------------------------------------------------
    function setRate(v, r) {
      const rate = clampRate(r);
      v.playbackRate = rate;
      osd(`Speed ${rate}×`);
      return rate;
    }

    // ---- A–B loop ------------------------------------------------------------
    function drawMarks(v) {
      clearMarks();
      const bar = doc.querySelector('#movie_player .ytp-progress-bar');
      const d = v.duration;
      if (!bar || !Number.isFinite(d) || d <= 0 || loopA === null) return;
      marks = doc.createElement('div');
      marks.setAttribute('data-clearcut', 'loop-marks');
      marks.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:40';
      const end = loopB === null ? loopA : loopB;
      const span = doc.createElement('div');
      span.style.cssText = `position:absolute;top:0;bottom:0;left:${(loopA / d) * 100}%;` +
        `width:${Math.max(((end - loopA) / d) * 100, 0.2)}%;background:rgba(47,214,195,.35);` +
        'border-left:2px solid #2fd6c3;' + (loopB === null ? '' : 'border-right:2px solid #2fd6c3;');
      marks.appendChild(span);
      bar.appendChild(marks);
    }

    function clearMarks() {
      if (marks) { marks.remove(); marks = null; }
    }

    function checkLoop() {
      if (loopA === null || loopB === null) return;
      const v = video();
      if (v && !adShowing() && v.currentTime >= loopB) v.currentTime = loopA;
    }

    function stopLoop(silent) {
      if (loopTimer) { win.clearInterval(loopTimer); loopTimer = null; }
      const had = loopA !== null;
      loopA = loopB = null;
      clearMarks();
      if (had && !silent) osd('Loop off');
    }

    function setA(v) {
      stopLoop(true);
      loopA = v.currentTime;
      drawMarks(v);
      osd(`Loop start ${stamp(loopA)} · press B to set the end`);
    }

    function setB(v) {
      if (loopB !== null) { stopLoop(false); return; }
      if (loopA === null) { osd('Press A first to set the loop start'); return; }
      const t = v.currentTime;
      if (t <= loopA + 0.5) { osd('Loop end must be after the start'); return; }
      loopB = t;
      drawMarks(v);
      v.currentTime = loopA;
      loopTimer = win.setInterval(checkLoop, LOOP_TICK_MS);
      osd(`Looping ${stamp(loopA)}–${stamp(loopB)} · B to stop`);
    }

    // ---- screenshot -------------------------------------------------------------
    function shoot(v) {
      const w = v.videoWidth;
      const h = v.videoHeight;
      const canvas = makeCanvas();
      const ctx = w && h && canvas && canvas.getContext ? canvas.getContext('2d') : null;
      if (!ctx) { osd('Screenshot unavailable for this video'); return Promise.resolve(false); }
      canvas.width = w;
      canvas.height = h;
      const at = v.currentTime;
      try {
        ctx.drawImage(v, 0, 0, w, h);
      } catch (_) {
        osd('Screenshot blocked for this video');
        return Promise.resolve(false);
      }
      return new Promise((resolve) => {
        try {
          canvas.toBlob((blob) => {
            if (!blob) { osd('Screenshot failed'); resolve(false); return; }
            download(blob, fileName(doc.title, at));
            osd(`Saved frame at ${stamp(at)}`);
            resolve(true);
          }, 'image/png');
        } catch (_) {
          osd('Screenshot blocked for this video');
          resolve(false);
        }
      });
    }

    // ---- key handling -----------------------------------------------------------
    function onKey(e) {
      if (!on() || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || (e.repeat && e.key !== ']' && e.key !== '[')) return;
      const target = (e.composedPath && e.composedPath()[0]) || e.target;
      if (isEditable(target) || isEditable(doc.activeElement)) return;
      if (!isWatchPage() || adShowing()) return;
      const v = video();
      if (!v) return;

      let handled = true;
      const k = e.key;
      if (k === ']' && !e.shiftKey) setRate(v, v.playbackRate + STEP);
      else if (k === '[' && !e.shiftKey) setRate(v, v.playbackRate - STEP);
      else if (k === '\\' && !e.shiftKey) setRate(v, 1);
      else if ((k === 'a' || k === 'A') && !e.shiftKey) setA(v);
      else if ((k === 'b' || k === 'B') && !e.shiftKey) setB(v);
      else if ((k === 'S' || k === 's') && e.shiftKey) shoot(v);
      else handled = false;

      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    }

    function start() { doc.addEventListener('keydown', onKey, true); }
    function stop() { doc.removeEventListener('keydown', onKey, true); stopLoop(true); }

    return {
      start, stop, shoot,
      reset: () => stopLoop(true),               // new video
      loop: () => ({ a: loopA, b: loopB, active: loopTimer !== null })
    };
  }

  const api = { createPowerKeys, clampRate, isEditable, fileName, stamp };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (globalThis.Clearcut = globalThis.Clearcut || {}).powerKeys = api;
})();
