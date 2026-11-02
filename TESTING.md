# Clearcut: real-browser soak checklist (v0.3.0)

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

## Playback (v0.2)
- [ ] Popup on a video shows **This channel** with the right channel name. Pin 1.5×, then open another video from that channel: it plays at 1.5× after any pre-roll.
- [ ] With a channel pinned, a video from a different channel uses the global default (or is left alone on "Don't change").
- [ ] Pin quality 1080p on a channel whose videos go to 4K: the video plays at 1080p (check *Stats for nerds*). With "Best available", it picks the top level.
- [ ] Change speed mid-video: the change sticks, and Clearcut doesn't set it back.
- [ ] Watch 3+ minutes of a 20-minute video, close the tab and reopen it: it resumes with the **Start over** toast, and Start over goes to 0:00.
- [ ] A link with `&t=90` starts at 1:30, not at the saved spot.
- [ ] A finished video starts from the beginning next time.
- [ ] Focus mode via <kbd>Alt+Shift+F</kbd>: theatre switches on, the sidebar, comments and guide vanish, and the top bar reappears when you hover the top edge. Pressing it again restores everything. Home and search pages are unaffected.

## Shorts (v0.3)
- [ ] Turn on **Auto-scroll Shorts** and open any Short: when it finishes, the next one starts on its own.
- [ ] With **Twice** selected, each Short plays through two times before moving on.
- [ ] Pause a Short: it stays put. Open its comments: it loops without advancing until you close them.
- [ ] Switch tabs while a Short plays: it doesn't race through the feed in the background.
- [ ] Drag a Short back to the start mid-way: it doesn't advance.
- [ ] Ad Shorts (the "Sponsored" badge) are skipped straight away, and **Recent events** shows "ad Short skipped". No real Short is skipped right after one.
- [ ] Normal watch pages are unaffected.

## Stability
- [ ] SPA navigation (click video → video → home → video) keeps working with no stuck mute or 16× playback.
- [ ] Master switch off: everything stops live (styles removed, no skipping); back on: it resumes.
- [ ] Theatre, fullscreen and miniplayer modes are unaffected; the toast is visible in fullscreen.
- [ ] Service-worker console (`vivaldi://extensions` → Clearcut → *service worker*) and page console show no Clearcut errors.

## When something leaks
1. Popup → **Copy diagnostics**.
2. Note the health title, plus whether L2 or L3 counted it.
3. Fix in the matching file (README → "Reading the health status"), then add a revert-proven test.
