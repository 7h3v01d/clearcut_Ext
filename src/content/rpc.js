// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Leon Priest (GitHub: 7h3v01d)
//
// Isolated-world side of the player-bridge RPC (see src/main/player-bridge.js).

(function () {
  'use strict';

  const MSG_TAG = '__clearcut';

  function createRpc(opts) {
    const win = opts.win;
    const timeoutMs = opts.timeoutMs || 8000;
    const pending = new Map();
    let next = 1;

    /** @returns {Promise<{ok:boolean, data:any}>} never rejects */
    function call(cmd, payload) {
      const rpc = next++;
      return new Promise((resolve) => {
        const timer = win.setTimeout(() => {
          pending.delete(rpc);
          resolve({ ok: false, data: null, timedOut: true });
        }, timeoutMs);
        pending.set(rpc, (msg) => {
          win.clearTimeout(timer);
          resolve({ ok: !!msg.ok, data: msg.data === undefined ? null : msg.data });
        });
        win.postMessage(Object.assign({ [MSG_TAG]: 1, dir: 'down', rpc, cmd }, payload || {}), win.location.origin);
      });
    }

    /** Feed an 'up' message in; returns true if it was an RPC reply. */
    function handleReply(d) {
      if (!d || d.t !== 'reply' || typeof d.rpc !== 'number') return false;
      const fn = pending.get(d.rpc);
      if (fn) { pending.delete(d.rpc); fn(d); }
      return true;
    }

    return { call, handleReply, _pending: () => pending.size };
  }

  const api = { createRpc };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (globalThis.Clearcut = globalThis.Clearcut || {}).rpc = api;
})();
