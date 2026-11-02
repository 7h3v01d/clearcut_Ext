// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Leon Priest (GitHub: 7h3v01d)
//
// SponsorBlock helpers. Pure logic so it's testable without a browser.
// Lookups use the privacy-preserving hash-prefix endpoint: only the first
// 4 hex chars of sha256(videoId) leave the machine, never the video ID.

(function () {
  'use strict';

  const API_BASE = 'https://sponsor.ajay.app/api/skipSegments/';
  const MIN_SEGMENT = 1.0;   // ignore slivers shorter than this (seconds)
  const END_GUARD = 0.35;    // don't trigger in the last fraction of a segment

  async function hashPrefix(videoId, subtle) {
    const s = subtle || (globalThis.crypto && globalThis.crypto.subtle);
    const buf = await s.digest('SHA-256', new TextEncoder().encode(videoId));
    const hex = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
    return hex.slice(0, 4);
  }

  function buildUrl(prefix, categories) {
    const cats = encodeURIComponent(JSON.stringify(categories));
    const actions = encodeURIComponent(JSON.stringify(['skip']));
    return `${API_BASE}${prefix}?categories=${cats}&actionTypes=${actions}`;
  }

  /** Pick this video's usable skip segments out of a hash-prefix response. */
  function parseSegments(json, videoId, categories) {
    if (!Array.isArray(json)) return [];
    const entry = json.find((e) => e && e.videoID === videoId);
    if (!entry || !Array.isArray(entry.segments)) return [];
    const wanted = new Set(categories);
    const out = [];
    for (const s of entry.segments) {
      if (!s || !Array.isArray(s.segment) || s.segment.length !== 2) continue;
      const [start, end] = s.segment.map(Number);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < MIN_SEGMENT || start < 0) continue;
      if (s.actionType && s.actionType !== 'skip') continue;
      if (!wanted.has(s.category)) continue;
      out.push({ uuid: String(s.UUID || `${start}-${end}`), category: s.category, start, end });
    }
    out.sort((a, b) => a.start - b.start);
    return out;
  }

  /**
   * Which segment (if any) should be skipped at `t`?
   * Overlapping segments are chained: we jump to the furthest end that is
   * contiguous with the current position.
   */
  function pickSkip(segments, t, done) {
    for (const s of segments) {
      if (done && done.has(s.uuid)) continue;
      if (t >= s.start && t < s.end - END_GUARD) {
        let end = s.end;
        const chain = [s.uuid];
        for (const o of segments) {
          if (o === s || (done && done.has(o.uuid))) continue;
          if (o.start <= end + 0.5 && o.end > end) { end = o.end; chain.push(o.uuid); }
        }
        return { segment: s, to: end, uuids: chain };
      }
    }
    return null;
  }

  function enabledCategories(sbCategories) {
    return Object.entries(sbCategories || {}).filter(([, on]) => on).map(([c]) => c);
  }

  /** Extract the watch-page video ID from a URL, or null. */
  function videoIdFromUrl(href) {
    try {
      const u = new URL(href);
      if (u.pathname === '/watch') {
        const v = u.searchParams.get('v');
        return v && /^[A-Za-z0-9_-]{11}$/.test(v) ? v : null;
      }
      const m = u.pathname.match(/^\/live\/([A-Za-z0-9_-]{11})/);
      return m ? m[1] : null;
    } catch (_) {
      return null;
    }
  }

  const api = { API_BASE, hashPrefix, buildUrl, parseSegments, pickSkip, enabledCategories, videoIdFromUrl };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (globalThis.Clearcut = globalThis.Clearcut || {}).sponsor = api;
})();
