// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Leon Priest (GitHub: 7h3v01d)
//
// One in-player toast at a time, in a closed shadow root so YouTube's styles
// can't reach it. Used by sponsor skipping and playback memory.

(function () {
  'use strict';

  const DEFAULT_MS = 5000;

  const CSS = `
    :host{all:initial}
    .t{position:absolute;right:16px;bottom:72px;z-index:70;display:flex;align-items:center;gap:12px;
       padding:8px 12px;background:#11161d;border:1px solid #1e2831;border-left:2px solid #2fd6c3;
       color:#c8d3da;font:12px "JetBrains Mono",Consolas,monospace;letter-spacing:.02em;
       box-shadow:0 4px 18px rgba(0,0,0,.45);pointer-events:auto}
    .k{color:#2fd6c3;text-transform:uppercase;font-size:10px}
    button{all:unset;cursor:pointer;color:#ffb454;padding:2px 6px;border:1px solid #1e2831}
    button:hover{background:#1e2831}
  `;

  function createToaster(opts) {
    const doc = opts.doc;
    const win = opts.win || doc.defaultView;
    let host = null;
    let timer = null;
    let current = null; // { onHide, run }

    function hide() {
      if (timer) { win.clearTimeout(timer); timer = null; }
      if (host) { host.remove(); host = null; }
      const c = current;
      current = null;
      if (c && c.onHide) { try { c.onHide(); } catch (_) { /* ignore */ } }
    }

    /**
     * @param {{player:Element, message:string, action?:{label:string, run:()=>void}, ms?:number, onHide?:()=>void}} t
     * @returns {{runAction:()=>boolean}} handle (runAction mirrors clicking the button)
     */
    function show(t) {
      hide();
      if (!t.player) return { runAction: () => false };
      const entry = { onHide: t.onHide, run: t.action ? t.action.run : null };
      current = entry;

      host = doc.createElement('div');
      host.setAttribute('data-clearcut', 'toast');
      const root = host.attachShadow({ mode: 'closed' });
      const style = doc.createElement('style');
      style.textContent = CSS;
      const box = doc.createElement('div');
      box.className = 't';
      const k = doc.createElement('span');
      k.className = 'k';
      k.textContent = 'Clearcut';
      const msg = doc.createElement('span');
      msg.textContent = t.message;
      box.append(k, msg);

      const runAction = () => {
        if (current !== entry || !entry.run) return false;
        const fn = entry.run;
        entry.run = null;
        hide();
        fn();
        return true;
      };

      if (t.action) {
        const btn = doc.createElement('button');
        btn.textContent = t.action.label;
        btn.addEventListener('click', (ev) => { ev.stopPropagation(); runAction(); });
        box.append(btn);
      }
      root.append(style, box);
      t.player.appendChild(host);
      timer = win.setTimeout(hide, t.ms || DEFAULT_MS);
      return { runAction };
    }

    return { show, hide, isShowing: () => !!host };
  }

  const api = { createToaster };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (globalThis.Clearcut = globalThis.Clearcut || {}).toast = api;
})();
