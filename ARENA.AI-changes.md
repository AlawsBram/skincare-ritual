# ARENA.AI Changes — Skincare Ritual 💛

Hey! This file explains **everything I changed** in this app, step by step,
in simple words. There are two parts:

- **Part 1:** Light mode and dark mode toggle 🌙☀️
- **Part 2:** Alarms you can set + a "Test notifications" button ⏰

---

## Part 1: Dark Mode and Light Mode

### What was the problem?
The app could already go dark — but ONLY if your whole phone was in dark
mode. There was no button to switch it yourself. If your phone was in light
mode and you wanted dark mode in the app, too bad. 😅

### What I added
A **🌙 / ☀️ button in the header** (top-right, next to the 🔔 bell):

- Tap it → the whole app flips between light and dark instantly, with a
  smooth fade and a little "pop" animation on the icon.
- The app **remembers your choice**, even if you close it and come back.
- If you've never tapped it, the app just copies your phone's setting
  (like before), and even follows along if your phone auto-switches at
  sunset — until you pick manually.
- No ugly white/black "flash" when opening the app.
- Your phone's top status-bar color matches the theme too.

### How I did it (the specifics)

**`index.html`**
- Replaced the two old `theme-color` tags with one tag
  (`id="themeColorMeta"`) that JavaScript can update.
- Added a tiny script at the very top that runs BEFORE the page paints:
  it reads your saved theme from `localStorage` (key:
  `skincare-ritual-theme`), or your system setting if there's no saved
  choice, and puts it on the page as `data-theme="dark"` (or `"light"`).
  This is what kills the flash.
- Wrapped the header buttons in a `.header-actions` div and added the new
  `<button id="themeBtn">🌙</button>`.
- Fixed the "App version" line (it had a hardcoded grey color that looked
  bad in dark mode) and bumped it to v1.1.

**`style.css`**
- All colors in this app come from CSS variables (like `--bg`, `--ink`,
  `--surface`). Before, the dark values only applied inside a
  `@media (prefers-color-scheme: dark)` block (system setting only).
- Now there are explicit rules: `html[data-theme="dark"] { ...dark
  colors... }` and `html[data-theme="light"] { ...light colors... }`.
  The toggle just flips that one attribute and every color on the page
  follows. The old system-based block is kept ONLY as a fallback for the
  split-second before JavaScript loads (or if JS is off).
- The shared header-button style was renamed to `.icon-btn` so the bell
  and the moon button look identical.
- Added a `color-scheme` line so scrollbars and form controls match the
  theme, plus smooth `transition`s so the switch fades instead of snapping.

**`script.js`** (new section 2: Theme)
- `applyTheme(theme, save)` — sets `data-theme`, updates the
  `theme-color` tag, swaps the button icon (🌙 in light mode, ☀️ in dark
  mode, i.e. it always shows what you'll switch TO), and optionally saves
  to `localStorage`.
- `initTheme()` — syncs the icon on load, wires the click, and (only if
  you never picked) keeps following the phone's setting live.
- Debug helpers: `skincareDebug.theme()` and
  `skincareDebug.toggleTheme()`.

**`sw.js`** — cache version bumped `skincare-v2` → `skincare-v3`, so phones
throw away the old files and download the new ones. (If you skip this,
phones keep showing the old app forever!)

**`vercel.json`** (new file) — tells Vercel: "never cache `sw.js` and
`index.html`." This is what makes *refresh and see the update* work
reliably on your phone.

**`README.md`** — updated the features list.

### How it got to your phone
Changes were pushed on a branch → **PR #1** → merged into `main` →
Vercel auto-redeployed → refresh the link (twice if the app was already
open, so the new service worker activates).

---

## Part 2: Alarms You Can Set + "Test Notifications" Button

### What was the problem?
The alarm times (7:30 AM / 8:30 PM) were **hardcoded** — frozen inside the
code. You couldn't change them without a programmer. And there was no way
to *try out* a notification (e.g. "ping me in 10 seconds so I can see what
it looks like").

### What I added
A whole new **⏰ Reminders** card under your routine cards:

1. **Morning / Evening rows** — tap one (or tap the "Alarm: …" pill on a
   routine card) and an **iOS-style "Add Alarm" sheet** slides up, just
   like the iPhone screenshot: ✕ on the left, title in the middle, orange
   ✓ on the right, scroll-wheel drums for Hour / Minute / AM-PM, plus
   rows for Repeat (Daily), Label, Sound, Snooze (on/off switch) and
   Snooze Duration (5 / 9 / 15 min).
2. **Daily alarms in Kenyan time (EAT)** — whatever time you pick runs
   every day on Nairobi time, and you can change it anytime. A line under
   the card always shows what's next, e.g.
   *"Next: ☀️ Morning Ritual in 3h 12m (7:30 AM EAT)"*.
3. **🧪 Test notifications button** — opens the sheet in countdown mode:
   wheels for Min / Sec plus quick chips (10 sec, 30 sec, 1 min, 5 min).
   Press ✓ → a **live banner** appears at the top reading
   **"⏱ Test timer 00:10"** and counts down every second → at zero, the
   **full alarm rings**: a notification banner + a looping ringtone +
   vibration + a ringing screen with **Stop** and **Snooze** buttons.
4. **3 alarm sounds** (all generated in code, no audio files):
   *Radial* (urgent iPhone-style beeps), *Chime* (soft), *Beacon*
   (slow two-tone). Tapping the Sound row previews each one.
5. **Snooze** — hit "Snooze 9 min" on the ringing screen and it rings
   again after 9 minutes (as long as the app stays open).

### One honest warning ⚠️ (please read!)
No website — not even an installed PWA — can run timers **after it's been
fully closed**. iPhones and Androids freeze web pages to save battery.
So these alarms ring reliably when the app is **open or recently used**,
but they can NOT replace your phone's built-in Clock alarm for the
"app closed all night" case. The app says this inside the Reminders card
too. The real fix for that is a **Phase 2: a small push server**
(Vercel + Web Push) that taps your phone awake on schedule — totally
doable next, just needs backend pieces.

### How I did it (the specifics)

**`index.html`** (app version → 1.2)
- Morning/evening "Alarm: …" pills changed from plain text (`<p>`) into
  tappable `<button>`s (`morningAlarmPill`, `eveningAlarmPill`).
- New `reminders-card` section: two alarm rows, the `testNotifBtn`
  ("🧪 Test notifications"), the `nextAlarmLine`, and the honest
  limitation note.
- New `countdownBar`: the live "⏱ Test timer 00:10" banner + Cancel.
- New `alarmSheet`: the iOS-style modal — header (✕ / title / ✓), two
  picker areas (`dailyPicker` with Hour/Min/AM-PM drums, `testPicker`
  with Min/Sec drums + quick chips), and the settings rows (Alarm
  on/off, Repeat, Label textbox, Sound, Snooze switch, Snooze Duration).
- New `ringOverlay`: the ringing screen (swinging 🔔, alarm name, EAT
  clock time, Snooze + Stop buttons).

**`style.css`** (~530 new lines)
- `.reminders-card`, `.alarm-row`, `.test-btn`, `.next-alarm` styles.
- `.sheet-overlay` (dimmed backdrop) + `.sheet` (bottom sheet that slides
  up, iPhone-style, with rounded top corners and safe-area padding so the
  iPhone home-bar never covers it).
- The drums: `.wheel` columns (198px tall, scroll-snap so rows click into
  place, top/bottom fade via CSS mask like a real picker), `.wheel-item`
  rows (44px each, dimmed except the `.selected` one),
  `.wheel-window` (the highlight band behind the middle row).
- `.quick-chips` (the 10s/30s/1m/5m pills), `.sheet-rows` (grouped grey
  rows like iOS Settings), `.switch` (green iOS toggle with sliding
  knob), `.ring-overlay` + swinging-bell animation.
- Everything uses the app's CSS variables, so light/dark mode just works;
  only the countdown banner got explicit dark-mode rules (mirroring the
  existing status-bar treatment). The bell animation respects
  `prefers-reduced-motion`.

**`script.js`** (section 6 rewritten + new audio)
- *Settings:* `loadAlarmSettings()` / `saveAlarmSettings()` store each
  routine's `{hour, minute, enabled, sound, label, snooze, snoozeMin}` in
  `localStorage` (`skincare-ritual-alarms`), with validation that clamps
  garbage values back to safe defaults.
- *Kenyan time:* `msUntilEat(hour, minute)` figures out "how many
  milliseconds until this time o'clock in Nairobi" using the fixed UTC+3
  offset (Kenya has no daylight saving, so this is always right). Tested:
  alarm 2 min ahead → "in 2m"; alarm 1 min past → rolls to tomorrow
  (~1439 min). `eatClockString()` prints e.g. "7:30 AM EAT" via
  `Intl.DateTimeFormat` with `timeZone: 'Africa/Nairobi'`.
- *Scheduling:* `scheduleAlarms()` sets one `setTimeout` per enabled
  alarm (max 24h out — safely under the ~24.8-day timer limit) and
  re-arms after each ring + whenever the app becomes visible again.
  `renderAlarmUI()` + `updateNextAlarmLine()` (refreshed every 30s) keep
  the pills, rows and "Next:" line correct.
- *Ringing:* every alarm funnels through `triggerAlarm()` → banner via
  the service worker (only if permission granted) + `showRingOverlay()`
  + `startAlarmLoop(sound)`. The ringtone is synthesized with the Web
  Audio API (`alarmBurst()` plays one ~1.8s burst; the loop repeats it
  every 2.2s with `navigator.vibrate()` on Android) and auto-stops after
  60s so it can never ring forever. `snoozeRingingAlarm()` re-rings after
  N minutes.
- *Test timer:* `startTestTimer(secs)` uses a timestamp (`endAt`) + a
  4×-per-second tick so the banner stays accurate even if the phone
  stutters; `tickTestTimer()` updates the banner or fires the test alarm
  at zero; `cancelTestTimer()` clears it.
- *Drums:* `createWheel(el, items)` turns any `<div>` into a picker —
  builds the rows with spacer pads, snap-settles the scroll, paints the
  selected row, exposes `get()`/`set(value)`.
- *Sheet:* `openSheet('daily', id)` presets the drums to the saved alarm;
  `openSheet('test')` presets 10 seconds. `saveSheet()` validates (daily:
  saves + reschedules + shows e.g. "Daily alarm set — 7:30 AM EAT in
  8h 12m"; test: needs ≥ 5s, then asks for banner permission inside the ✓
  tap — which counts as the required user gesture — and starts the
  countdown). `cycleSound()` flips Radial → Chime → Beacon *and plays
  each one* so you can audition; `cycleSnoozeDur()` flips 5 → 9 → 15 min.
- *Messages:* the 🔔 bell's texts now use your actual alarm times instead
  of hardcoded ones. Alarms are scheduled even without banner permission
  (the ringing screen + sound still work on-screen).
- *Debug:* `skincareDebug.testTimer(10)`, `.alarms()`,
  `.setAlarm('morning', 8, 0)`, `.previewSound('Beacon')`,
  `.stopAlarm()`; `alarmIn(10)` now rings the FULL alarm (sound +
  overlay), and `nextAlarms()` shows EAT times.

**`sw.js`** — cache `skincare-v3` → `skincare-v4` so phones fetch the new
version.

**`README.md`** — new features + new debug helpers documented.

### How to get it to your phone
Same as Part 1: the code is committed on branch
`arena/01a0801c-skincare-ritual` — push it, open a PR to `main`, merge,
Vercel redeploys, then refresh the phone link twice. (This particular
Arena session lost its GitHub connection after PR #1 merged, so the push
needs to happen from a fresh session — one short message does it.)

---

*Written by your Arena.ai agent with 💛 — ask me anything about this file!*
