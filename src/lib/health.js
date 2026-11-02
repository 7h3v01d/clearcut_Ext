// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Leon Priest (GitHub: 7h3v01d)
//
// Layer 4 — self-diagnosis. Aggregates events from the other layers and works
// out which layer is holding and which is leaking, so a YouTube change shows
// up as "Layer 1 degraded" before it shows up as ads.

(function () {
  'use strict';

  const KEEP_DAYS = 14;
  const KEEP_VIDEOS = 30;
  const KEEP_LOG = 150;
  const WINDOW = 20; // recent videos considered for status

  function emptyStats() {
    return { days: {}, videos: [], log: [] };
  }

  function dayKey(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function emptyDay() {
    return { l1Player: 0, l1Items: 0, l2: 0, l3: 0, walls: 0, sb: 0, savedSec: 0 };
  }

  function touchVideo(stats, id, ts) {
    if (!id) return null;
    let v = stats.videos.find((x) => x.id === id);
    if (!v) {
      v = { id, ts, l1Seen: false, l1Removed: 0, l3: 0 };
      stats.videos.push(v);
    }
    v.ts = ts;
    stats.videos.sort((a, b) => b.ts - a.ts);
    if (stats.videos.length > KEEP_VIDEOS) stats.videos.length = KEEP_VIDEOS;
    return v;
  }

  /** Apply one event. Mutates and returns `stats`. */
  function applyEvent(stats, ev, now) {
    if (!ev || typeof ev !== 'object') return stats;
    const ts = typeof now === 'number' ? now : Date.now();
    const key = dayKey(ts);
    const day = stats.days[key] || (stats.days[key] = emptyDay());
    let logIt = true;

    switch (ev.t) {
      case 'l1': {
        const n = Math.max(0, Number(ev.removed) || 0);
        if (ev.kind === 'player') {
          const v = touchVideo(stats, ev.videoId, ts);
          if (v) { v.l1Seen = true; v.l1Removed += n; }
          if (n > 0) day.l1Player++;
          else logIt = false; // a clean player response isn't news
        } else if (ev.kind === 'wall') {
          day.walls += n;
        }
        day.l1Items += n;
        break;
      }
      case 'l2':
        day.l2 += Math.max(0, Number(ev.hidden) || 0);
        break;
      case 'l3': {
        day.l3++;
        day.savedSec += Math.max(0, Number(ev.seconds) || 0);
        const v = touchVideo(stats, ev.videoId, ts);
        if (v) v.l3++;
        break;
      }
      case 'wall':
        day.walls++;
        break;
      case 'sb':
        day.sb++;
        day.savedSec += Math.max(0, Number(ev.seconds) || 0);
        break;
      case 'video':
        touchVideo(stats, ev.videoId, ts);
        logIt = false;
        break;
      default:
        return stats;
    }

    if (logIt) {
      stats.log.unshift(Object.assign({ ts }, ev));
      if (stats.log.length > KEEP_LOG) stats.log.length = KEEP_LOG;
    }

    const keys = Object.keys(stats.days).sort();
    while (keys.length > KEEP_DAYS) delete stats.days[keys.shift()];
    return stats;
  }

  /**
   * Status over the most recent videos.
   *   ok    — no ad reached the player
   *   warn  — ads reached the player; layer 3 caught them
   *   bad   — layer 1 isn't seeing player data at all while ads play
   */
  function computeStatus(stats) {
    const recent = (stats && stats.videos ? stats.videos : []).slice(0, WINDOW);
    if (recent.length === 0) {
      return { level: 'idle', title: 'Waiting for a video', detail: 'Open a YouTube video to start the health check.' };
    }
    const leaks = recent.filter((v) => v.l3 > 0);
    const unseen = recent.filter((v) => !v.l1Seen);

    if (leaks.length === 0) {
      if (unseen.length === recent.length && recent.length >= 3) {
        return {
          level: 'warn',
          title: 'Layer 1 blind',
          detail: `No player data intercepted in the last ${recent.length} videos, but no ads played either.`
        };
      }
      return { level: 'ok', title: 'All layers holding', detail: `No ads reached the player in the last ${recent.length} videos.` };
    }

    const blindLeaks = leaks.filter((v) => !v.l1Seen);
    if (blindLeaks.length >= 2) {
      return {
        level: 'bad',
        title: 'Layer 1 hook broken',
        detail: `${blindLeaks.length} of ${recent.length} recent videos played ads with no player data intercepted. YouTube likely changed how it delivers the player response.`
      };
    }
    const strippedLeaks = leaks.filter((v) => v.l1Seen && v.l1Removed > 0);
    const cleanLeaks = leaks.filter((v) => v.l1Seen && v.l1Removed === 0);
    if (cleanLeaks.length >= 2) {
      return {
        level: 'bad',
        title: 'Layer 1 missing ads',
        detail: `${cleanLeaks.length} videos had player data with no ad keys, yet ads played. Likely new ad keys or server-stitched ads; layer 3 is carrying it.`
      };
    }
    return {
      level: 'warn',
      title: 'Layer 3 catching leaks',
      detail: `${leaks.length} of ${recent.length} recent videos had an ad reach the player` +
        (strippedLeaks.length ? ' despite stripping (possible stitched ads).' : '.') +
        ' Neutralised automatically.'
    };
  }

  function formatDuration(sec) {
    const s = Math.round(Math.max(0, sec));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
    return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
  }

  const api = { emptyStats, emptyDay, dayKey, applyEvent, computeStatus, formatDuration };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (globalThis.Clearcut = globalThis.Clearcut || {}).health = api;
})();
