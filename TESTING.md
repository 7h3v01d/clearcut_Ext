# Clearcut: real-browser soak checklist (v0.1.0)

Run on Windows + Vivaldi (and Chrome). Before each pass, open the popup and **Reset stats**.

## Ad ladder
- [ ] Home, search and watch pages show no feed ads, masthead ads or promoted results.
- [ ] 10+ videos from ad-heavy channels: no pre-roll or mid-roll is visible or audible.
- [ ] Popup shows 🟢 and **L1 stripped** rising; **L3 neutralised** stays at 0 or near it.
- [ ] Turn off **L1 · Strip ad data** and reload a video. An ad should be muted, fast-forwarded or skipped (L3), and the status should go 🟠 after a leak.
- [ ] With L1 back on, change the video speed to 1.5× before an ad (L1 off to force one). After the ad, speed is 1.5× again and mute state is unchanged.
- [ ] No "ad blockers are not allowed" wall appears. If it does, it should vanish and the video should resume, with **Walls removed** counting it.

## Sponsor skipping
- [ ] A video with known sponsor reads skips the read, shows the toast, and **Undo** returns to just before it.
- [ ] After Undo, scrubbing back into the same segment doesn't skip it again.
- [ ] Turn on a category such as Intros: skipping applies from the next video.

## Distractions
- [ ] Each toggle hides its target live, without a reload: Shorts (shelves + sidebar entry), comments, end cards, home feed (placeholder message shown), related videos.
- [ ] Turn off autoplay: the autoplay switch goes off once on a video, and if you turn it back on it stays on.

## Stability
- [ ] SPA navigation (click video → video → home → video) keeps working with no stuck mute or 16× playback.
- [ ] Master switch off: everything stops live (styles removed, no skipping); back on: it resumes.
- [ ] Theatre, fullscreen and miniplayer modes are unaffected; the toast is visible in fullscreen.
- [ ] Service-worker console (`vivaldi://extensions` → Clearcut → *service worker*) and page console show no Clearcut errors.

## When something leaks
1. Popup → **Copy diagnostics**.
2. Note the health title, plus whether L2 or L3 counted it.
3. Fix in the matching file (README → "Reading the health status"), then add a revert-proven test.
