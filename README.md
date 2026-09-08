# ✨ Skincare Ritual

A minimal, installable PWA for tracking a daily morning and evening skincare routine.

## Features

- **Two routine cards** — morning (7:30 AM) and evening (8:30 PM)
- **Audio feedback** — a soft chime synthesised with the Web Audio API (no audio files to host)
- **Local storage** — remembers today's ticks, resets automatically at midnight
- **Notifications** — daily reminders at 7:30 AM and 8:30 PM
- **Offline** — works with no connection via a service worker
- **Installable** — add to your home screen on Android or iOS
- **Light / dark mode toggle** — header button switches theme, remembers your choice, defaults to your system appearance

## Files

| File | Purpose |
|---|---|
| `index.html` | Markup and PWA meta tags |
| `style.css` | Design system, layout, light/dark themes |
| `vercel.json` | Vercel headers — keeps `sw.js` / `index.html` fresh so updates reach phones |
| `script.js` | Checklist, audio, storage, alarms, install |
| `manifest.json` | PWA manifest |
| `sw.js` | Service worker — caching and notifications |
| `icon.svg`, `icon-192.png`, `icon-512.png` | App icons |
| `apple-touch-icon.png` | iOS home screen icon |

## Running locally

Notifications and service workers require `https://` or `localhost` — opening
`index.html` as a `file://` URL will not work.

```bash
python -m http.server 8000
# then open http://localhost:8000
```

## Testing

Open the browser console and use the built-in helpers:

```js
skincareDebug.chime()             // play the "done" sound
skincareDebug.testNotification()  // send a notification now
skincareDebug.alarmIn(10)         // fire the morning alarm in 10 seconds
skincareDebug.fakeYesterday()     // then reload to test the midnight reset
skincareDebug.nextAlarms()        // minutes until each alarm
skincareDebug.reset()             // clear all saved data
```

## Note on alarm reliability

The alarms run on `setTimeout` inside the page. They fire reliably while the app
is open or recently backgrounded, but phone operating systems suspend background
pages to save battery, and a suspended page cannot run a timer.

For alarms that fire even when the app has been closed for hours, you need Web
Push, which requires a server holding VAPID keys. This build has no server, so
treat the reminders as reliable-when-open rather than as a system alarm clock.
A native phone alarm remains the dependable backup.
