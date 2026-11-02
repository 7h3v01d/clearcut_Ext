# Clearcut

User-controlled YouTube ad blocking for Vivaldi and other Chromium browsers (Manifest V3).

Off-the-shelf blockers break when YouTube changes something and you wait for a filter-list update. Clearcut is built so you can make that fix yourself, quickly, and so you can *see* it breaking before you see ads.

## How it works: the fallback ladder

Each layer catches what the one above misses.

| Layer | What it does | Where |
|---|---|---|
| **L1 · Data** | Strips ad payloads (`adPlacements`, `playerAds`, `adSlots`, feed ad renderers, the enforcement wall) out of YouTube's JSON before the player or feed sees them. Hooks `JSON.parse`, `Response.json` and the `ytInitialPlayerResponse` / `ytInitialData` bootstrap globals. Hooks are Proxies and still stringify as native code. | `src/main/data-shield.js` (MAIN world) |
| **L1 · Network** | Blocks ad and ad-measurement endpoints. Never touches video streams. | `rules/ad-network.json` |
| **L2 · Cosmetic** | Hides ad slots that render anyway, one CSS rule per selector so a bad selector only drops itself. Counts leaked renderers. | `src/lib/selectors.js` |
| **L3 · Neutralise** | If an ad still plays (including server-stitched ones the player still flags): mute, 16×, seek to end, click Skip. Restores your mute state and speed afterwards. | `src/content/player-guard.js` |
| **L4 · Health** | Tracks per video which layer caught what and tells you which layer is failing. | `src/lib/health.js` |

### Reading the health status

| Status | Meaning | Where to look |
|---|---|---|
| 🟢 All layers holding | No ad reached the player in recent videos | — |
| 🟠 Layer 3 catching leaks | Ads reached the player but were neutralised | If "despite stripping": likely stitched ads |
| 🟠 Layer 1 blind | No player data intercepted, but no ads either | Hook may be bypassed; watch it |
| 🔴 Layer 1 missing ads | Player data seen with no ad keys, yet ads played | New ad key names → `AD_KEYS` / `AD_RENDERERS` |
| 🔴 Layer 1 hook broken | Ads playing and no player data intercepted at all | Delivery path changed → hooks in `data-shield.js` |

**Copy diagnostics** in the popup puts settings, status and the event log on your clipboard for debugging.

## Expansions in v0.1

- **Sponsor skipping:** uses SponsorBlock community data. Auto-skips the categories you pick and shows a toast with **Undo**; an undone segment stays un-skipped for that video. Lookups send only the first 4 hex chars of `sha256(videoId)`, never the video ID.
- **Distraction control:** hide Shorts, comments, end-screen cards, the home feed or related videos, and turn off autoplay. Autoplay is switched off once per video, so if you turn it back on, Clearcut won't fight you.

## Install (unpacked)

1. `vivaldi://extensions` (or `chrome://extensions`), then turn on **Developer mode**.
2. **Load unpacked**, then select this folder (the one containing `manifest.json`).
3. Reload any open YouTube tabs.

Vivaldi's built-in ad blocker can stay on; Clearcut works alongside it. To compare layers cleanly, turn it off for youtube.com while soak-testing.

## Tests

```bat
npm install
test.bat
```

47 tests: unit tests (pruning, selectors, SponsorBlock logic, health status), jsdom integration tests (layer 3, wall dismissal, sponsor skip/undo, a full content-script boot, the popup) and a service worker test with a stubbed `chrome` API.

`package.bat` builds `dist\clearcut-<version>.zip` containing only the extension files.

## Layout

```
manifest.json
rules/ad-network.json        L1 network rules
src/main/data-shield.js      L1 data shield (MAIN world, self-contained)
src/lib/                     defaults, selectors, sponsor, health (pure, testable)
src/content/                 player-guard (L3 + wall + autoplay), sponsor-skipper, main (wiring)
src/background/sw.js         settings, ruleset toggle, SponsorBlock fetch/cache, health writer
src/popup/                   status, counters, toggles
test/                        node:test + jsdom
```

## Known limits (v0.1)

- `www.youtube.com` only: no embeds on other sites, `m.youtube.com` or YouTube Music.
- The MAIN↔isolated bridge uses `postMessage`, which the page can observe.
- Network-rule hits aren't counted (MV3 only exposes that to unpacked dev builds).
- If YouTube ever stitches ads without flagging them in the player, layer 3 can't see them. The health check will then show "Layer 1 missing ads".

## Licence

Apache 2.0. Copyright 2026 Leon Priest ([7h3v01d](https://github.com/7h3v01d)).

SponsorBlock data is provided by the SponsorBlock project ([sponsor.ajay.app](https://sponsor.ajay.app)) under CC BY-NC-SA 4.0.
