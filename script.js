/* ============================================================
   Skincare Ritual — app logic
   ------------------------------------------------------------
   Sections:
     1. Config
     2. Theme (light / dark toggle)
     3. Audio feedback (Web Audio API — no MP3 needed)
     4. Storage + midnight reset
     5. Checkbox wiring & progress
     6. Notifications / alarms
     7. PWA install
     8. Service worker
     9. Debug helpers  <-- see TESTING NOTES at the bottom
   ============================================================ */

(function () {
    'use strict';

    /* ---------- 1. Config ---------- */

    var STORAGE_KEY = 'skincare-ritual-state';
    var THEME_KEY = 'skincare-ritual-theme';

    var ALARMS = [
        { id: 'morning', hour: 7,  minute: 30, title: '☀️ Morning Ritual',
          body: 'Vitamin C Cleanser → Corrector → SPF 50. Time to protect your skin.' },
        { id: 'evening', hour: 20, minute: 30, title: '🌙 Evening Ritual',
          body: 'Cleanse away the day, then Charcoal Cream to renew overnight.' }
    ];

    var alarmTimers = [];

    /* ---------- 2. Theme (light / dark toggle) ---------- */

    // System preference at load time. Used when the user has never toggled.
    function systemTheme() {
        return (window.matchMedia &&
                window.matchMedia('(prefers-color-scheme: dark)').matches)
            ? 'dark'
            : 'light';
    }

    function currentTheme() {
        return document.documentElement.getAttribute('data-theme') || systemTheme();
    }

    // Apply a theme: swap the CSS variables (via data-theme), keep the
    // browser chrome (status bar / task switcher) matching via theme-color,
    // and update the toggle button's icon.
    function applyTheme(theme, save) {
        theme = theme === 'dark' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', theme);

        var meta = document.getElementById('themeColorMeta');
        if (meta) meta.setAttribute('content', theme === 'dark' ? '#100f0e' : '#f7f6f3');

        var btn = document.getElementById('themeBtn');
        if (btn) {
            // Show the mode you'll switch TO: sun in dark mode, moon in light.
            var icon = theme === 'dark' ? '☀️' : '🌙';
            if (btn.textContent.trim() !== icon) {
                btn.textContent = icon;
                // Re-trigger the pop animation on each swap
                btn.classList.remove('swap');
                void btn.offsetWidth;
                btn.classList.add('swap');
            }
            btn.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
            btn.setAttribute('aria-label', btn.title);
        }

        if (save) {
            try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
        }
    }

    function initTheme() {
        // The inline script in <head> already set data-theme before first
        // paint — here we just sync the button icon and wire up the toggle.
        applyTheme(currentTheme(), false);

        var btn = document.getElementById('themeBtn');
        if (btn) {
            btn.addEventListener('click', function () {
                applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', true);
            });
        }

        // No saved choice yet → keep following the OS if it changes
        // (e.g. automatic sunset/sunrise appearance on the phone).
        try {
            if (!localStorage.getItem(THEME_KEY) && window.matchMedia) {
                var mq = window.matchMedia('(prefers-color-scheme: dark)');
                var onChange = function (e) { applyTheme(e.matches ? 'dark' : 'light', false); };
                if (mq.addEventListener) mq.addEventListener('change', onChange);
                else if (mq.addListener) mq.addListener(onChange);  // older Safari
            }
        } catch (e) {}
    }

    /* ---------- 3. Audio feedback ---------- */

    var audioCtx = null;

    // Browsers only allow audio to start from a user gesture, so the context is
    // created lazily on the first tap and reused (and resumed) after that.
    function getAudioContext() {
        var Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        if (!audioCtx) audioCtx = new Ctx();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return audioCtx;
    }

    // A soft two-note chime: a fifth (C6 → G6) with a quick attack and a long,
    // gentle exponential decay. Sine waves keep it warm rather than piercing.
    function playChime() {
        var ctx = getAudioContext();
        if (!ctx) return;

        var now = ctx.currentTime;
        var master = ctx.createGain();
        master.gain.value = 0.13;          // keep it subtle
        master.connect(ctx.destination);

        [{ freq: 1046.5, at: 0 }, { freq: 1568.0, at: 0.09 }].forEach(function (note) {
            var osc = ctx.createOscillator();
            var gain = ctx.createGain();
            var start = now + note.at;

            osc.type = 'sine';
            osc.frequency.setValueAtTime(note.freq, start);

            gain.gain.setValueAtTime(0.0001, start);
            gain.gain.exponentialRampToValueAtTime(1, start + 0.012);  // attack
            gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.9); // decay

            osc.connect(gain);
            gain.connect(master);
            osc.start(start);
            osc.stop(start + 1);
        });
    }

    // A lower, single note for un-checking — reads as "undone" without a buzz.
    function playUncheck() {
        var ctx = getAudioContext();
        if (!ctx) return;

        var now = ctx.currentTime;
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, now);

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.06, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.3);
    }

    // Slightly richer arpeggio when a whole routine is finished.
    function playComplete() {
        var ctx = getAudioContext();
        if (!ctx) return;

        var now = ctx.currentTime;
        [1046.5, 1318.5, 1568.0, 2093.0].forEach(function (freq, i) {
            var osc = ctx.createOscillator();
            var gain = ctx.createGain();
            var start = now + i * 0.075;

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, start);

            gain.gain.setValueAtTime(0.0001, start);
            gain.gain.exponentialRampToValueAtTime(0.09, start + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.7);

            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(start);
            osc.stop(start + 0.8);
        });
    }

    /* ---------- 4. Storage + midnight reset ---------- */

    // Local calendar date, e.g. "2026-08-04". Using local time (not toISOString,
    // which is UTC) is what makes the reset land at *your* midnight.
    function todayKey() {
        var d = new Date();
        return d.getFullYear() + '-' +
               String(d.getMonth() + 1).padStart(2, '0') + '-' +
               String(d.getDate()).padStart(2, '0');
    }

    function loadState() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return { date: todayKey(), checked: [] };
            var parsed = JSON.parse(raw);
            // Stale day → start fresh. This is the midnight reset: it fires
            // whenever the app is opened on a new calendar day.
            if (parsed.date !== todayKey()) return { date: todayKey(), checked: [] };
            return { date: parsed.date, checked: parsed.checked || [] };
        } catch (e) {
            return { date: todayKey(), checked: [] };
        }
    }

    function saveState() {
        var checked = [];
        document.querySelectorAll('.checklist input[type="checkbox"]').forEach(function (box) {
            if (box.checked) checked.push(boxId(box));
        });
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                date: todayKey(),
                checked: checked
            }));
        } catch (e) {
            /* private mode / quota — the UI still works, it just won't persist */
        }
    }

    // Stable identifier per step, e.g. "morning:Vitamin C Cleanser".
    // Needed because the cleanser appears in both routines.
    function boxId(box) {
        var routine = box.classList.contains('morning-checkbox') ? 'morning' : 'evening';
        return routine + ':' + box.dataset.product;
    }

    // If the app is left open overnight, wipe the checkboxes exactly at 00:00.
    function scheduleMidnightReset() {
        var now = new Date();
        var midnight = new Date(now);
        midnight.setHours(24, 0, 0, 0);      // start of tomorrow
        setTimeout(function () {
            document.querySelectorAll('.checklist input[type="checkbox"]')
                .forEach(function (box) { box.checked = false; });
            saveState();
            updateProgress('morning');
            updateProgress('evening');
            showStatus('New day — routine reset ✨');
            scheduleMidnightReset();          // chain to the next midnight
        }, midnight - now + 1000);            // +1s of slack
    }

    /* ---------- 5. Checkbox wiring & progress ---------- */

    function updateProgress(routine) {
        var boxes = document.querySelectorAll('.' + routine + '-checkbox');
        var done = 0;
        boxes.forEach(function (b) { if (b.checked) done++; });

        var pct = boxes.length ? (done / boxes.length) * 100 : 0;
        var fill = document.getElementById(routine + 'Progress');
        var text = document.getElementById(routine + 'Status');
        var card = document.querySelector('.' + routine + '-card');

        if (fill) fill.style.width = pct + '%';
        if (text) {
            text.textContent = done === boxes.length
                ? 'Complete ✓'
                : done + '/' + boxes.length + ' complete';
        }
        if (card) card.classList.toggle('complete', done === boxes.length);

        return { done: done, total: boxes.length };
    }

    function initCheckboxes() {
        var state = loadState();

        document.querySelectorAll('.checklist input[type="checkbox"]').forEach(function (box) {
            // Restore today's saved ticks
            box.checked = state.checked.indexOf(boxId(box)) !== -1;

            box.addEventListener('change', function () {
                var routine = box.classList.contains('morning-checkbox') ? 'morning' : 'evening';
                var progress = updateProgress(routine);

                if (box.checked) {
                    // Whole routine just finished → arpeggio, otherwise the chime
                    if (progress.done === progress.total) playComplete();
                    else playChime();
                    // A short haptic tick on Android; iOS ignores this silently.
                    if (navigator.vibrate) navigator.vibrate(12);
                } else {
                    playUncheck();
                }

                saveState();
            });
        });

        updateProgress('morning');
        updateProgress('evening');
    }

    /* ---------- 6. Notifications / alarms ---------- */

    var statusTimer = null;

    function showStatus(message, ms) {
        var bar = document.getElementById('statusBar');
        var msg = document.getElementById('statusMessage');
        if (!bar || !msg) return;

        msg.textContent = message;
        bar.classList.remove('hidden');

        clearTimeout(statusTimer);
        statusTimer = setTimeout(function () {
            bar.classList.add('hidden');
        }, ms || 3600);
    }

    function notificationsSupported() {
        return 'Notification' in window;
    }

    // Fire a notification through the service worker when possible. On iOS the
    // SW path is the *only* one that works for an installed PWA — plain
    // `new Notification()` throws there.
    function fireNotification(title, body, tag) {
        var options = {
            body: body,
            tag: tag,
            icon: 'icon.svg',
            badge: 'icon.svg',
            requireInteraction: false,
            data: { url: './' }
        };

        if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
            navigator.serviceWorker.ready.then(function (reg) {
                reg.showNotification(title, options);
            }).catch(function () {
                try { new Notification(title, options); } catch (e) {}
            });
        } else {
            try { new Notification(title, options); } catch (e) {}
        }
    }

    // Milliseconds from now until the next occurrence of hour:minute local time.
    function msUntil(hour, minute) {
        var now = new Date();
        var next = new Date();
        next.setHours(hour, minute, 0, 0);
        if (next <= now) next.setDate(next.getDate() + 1);   // already passed → tomorrow
        return next - now;
    }

    function scheduleAlarms() {
        // Clear any previously scheduled timers before re-scheduling
        alarmTimers.forEach(clearTimeout);
        alarmTimers = [];

        if (!notificationsSupported() || Notification.permission !== 'granted') return;

        ALARMS.forEach(function (alarm) {
            var delay = msUntil(alarm.hour, alarm.minute);

            // setTimeout caps out at ~24.8 days, and our max delay is 24h, so a
            // single timer is safe here.
            var timer = setTimeout(function () {
                fireNotification(alarm.title, alarm.body, alarm.id);
                scheduleAlarms();            // re-arm for tomorrow
            }, delay);

            alarmTimers.push(timer);
        });
    }

    function requestNotificationPermission() {
        if (!notificationsSupported()) {
            // iOS hides the Notification API entirely inside a Safari tab — it
            // only appears once the app runs from the Home Screen. So "missing
            // API" on an iPhone usually means "not installed yet", NOT
            // "unsupported". Say the thing that actually helps.
            if (isIOS() && !isStandalone()) {
                showStatus('On iPhone: tap Share ↑ → "Add to Home Screen", then open the app from that icon and tap 🔔 again', 9000);
            } else if (isIOS()) {
                // Installed but still no API → the OS is too old.
                showStatus('Notifications need iOS 16.4 or later. Check Settings → General → Software Update', 8000);
            } else {
                showStatus('Notifications are not supported in this browser', 5000);
            }
            return;
        }

        if (Notification.permission === 'granted') {
            // Already on — send a sample so you can confirm it reaches the phone
            fireNotification('🔔 Reminders are on',
                'Morning at 7:30 AM · Evening at 8:30 PM', 'test');
            showStatus('Test notification sent');
            return;
        }

        if (Notification.permission === 'denied') {
            showStatus('Notifications blocked — enable them in your device settings', 5500);
            return;
        }

        Notification.requestPermission().then(function (result) {
            if (result === 'granted') {
                markNotificationsEnabled();
                scheduleAlarms();
                fireNotification('🔔 Reminders are on',
                    'Morning at 7:30 AM · Evening at 8:30 PM', 'welcome');
                showStatus('Reminders enabled — 7:30 AM & 8:30 PM');
            } else {
                showStatus('Reminders not enabled');
            }
        });
    }

    function markNotificationsEnabled() {
        var btn = document.getElementById('notificationBtn');
        if (btn) {
            btn.classList.add('enabled');
            btn.title = 'Reminders on — tap to send a test notification';
        }
    }

    function initNotifications() {
        var btn = document.getElementById('notificationBtn');
        if (btn) btn.addEventListener('click', requestNotificationPermission);

        if (notificationsSupported() && Notification.permission === 'granted') {
            markNotificationsEnabled();
            scheduleAlarms();
        }
    }

    // Timers are unreliable when a tab is backgrounded or the phone sleeps, so
    // re-arm every time the app becomes visible again. This also catches the
    // case where the device clock jumped (travel, DST).
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible') return;

        // A new day may have started while the app was hidden. loadState()
        // returns an empty list once the stored date goes stale, so an empty
        // list here means "nothing should be ticked" either way.
        var state = loadState();
        if (state.checked.length === 0) {
            document.querySelectorAll('.checklist input[type="checkbox"]')
                .forEach(function (box) { box.checked = false; });
            saveState();                  // stamp today's date so it stops re-running
            updateProgress('morning');
            updateProgress('evening');
        }

        scheduleAlarms();
    });

    /* ---------- 7. PWA install ---------- */

    var deferredPrompt = null;

    function isStandalone() {
        return window.matchMedia('(display-mode: standalone)').matches ||
               window.navigator.standalone === true;
    }

    function isIOS() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
               // iPadOS 13+ reports as a Mac, so check for touch as well
               (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }

    function initInstall() {
        var prompt = document.getElementById('installPrompt');
        var installBtn = document.getElementById('installBtn');
        var dismissBtn = document.getElementById('dismissBtn');

        if (!prompt) return;
        if (isStandalone()) return;                                  // already installed
        if (localStorage.getItem('install-dismissed') === '1') return;

        // Chrome / Edge / Android: the browser hands us an install event
        window.addEventListener('beforeinstallprompt', function (e) {
            e.preventDefault();
            deferredPrompt = e;
            prompt.classList.remove('hidden');
        });

        // iOS Safari never fires beforeinstallprompt — Add to Home Screen is
        // manual, so show instructions instead of an install button.
        if (isIOS()) {
            var text = prompt.querySelector('p');
            if (text) text.textContent = 'Install: tap Share ↑ then "Add to Home Screen"';
            if (installBtn) installBtn.classList.add('hidden');
            if (dismissBtn) dismissBtn.textContent = 'Got it';
            setTimeout(function () { prompt.classList.remove('hidden'); }, 2500);
        }

        if (installBtn) {
            installBtn.addEventListener('click', function () {
                if (!deferredPrompt) return;
                deferredPrompt.prompt();
                deferredPrompt.userChoice.then(function () {
                    deferredPrompt = null;
                    prompt.classList.add('hidden');
                });
            });
        }

        if (dismissBtn) {
            dismissBtn.addEventListener('click', function () {
                prompt.classList.add('hidden');
                localStorage.setItem('install-dismissed', '1');
            });
        }

        window.addEventListener('appinstalled', function () {
            prompt.classList.add('hidden');
            deferredPrompt = null;
        });
    }

    /* ---------- 8. Service worker ---------- */

    function initServiceWorker() {
        if (!('serviceWorker' in navigator)) return;
        window.addEventListener('load', function () {
            navigator.serviceWorker.register('sw.js').catch(function (err) {
                console.warn('Service worker registration failed:', err);
            });
        });
    }

    /* ---------- Boot ---------- */

    function init() {
        initTheme();
        initCheckboxes();
        initNotifications();
        initInstall();
        initServiceWorker();
        scheduleMidnightReset();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    /* ============================================================
       9. TESTING NOTES — open the browser console and run these
       ============================================================

       Everything below is exposed on `window.skincareDebug`.

       --- Test the chime without tapping a box ---
           skincareDebug.chime()          // the "done" ding
           skincareDebug.complete()       // the routine-finished arpeggio

       --- Test a notification right now ---
           skincareDebug.testNotification()
       If nothing appears, check `Notification.permission` — it must be
       "granted". Tap the 🔔 button in the header to request it. Note that
       permission can ONLY be requested from a tap, never from the console.

       --- Test an alarm firing in 10 seconds instead of at 7:30 AM ---
           skincareDebug.alarmIn(10)
       This queues the real morning notification 10 seconds from now, so you
       can confirm the exact text and sound your phone will produce. Try it
       with the app in the background to see it arrive as a banner.

       --- Test the midnight reset ---
           skincareDebug.fakeYesterday()   // then reload the page
       This rewrites the saved date to yesterday. On reload every box should
       come back unchecked, exactly as it will at midnight.

       --- Inspect what's stored ---
           skincareDebug.state()

       --- Clear everything and start over ---
           skincareDebug.reset()

       --- IMPORTANT: how far these alarms actually reach ---
       These alarms run on setTimeout inside the page. That means they fire
       reliably while the app is open or recently backgrounded, but the phone
       OS will eventually suspend the app to save battery — and a suspended
       page cannot run a timer. For an alarm that ALWAYS fires even when the
       app has been closed for hours, you need Web Push, which requires a
       server holding VAPID keys to send the push. This build has no server,
       so treat the alarms as reliable-when-open rather than as a system alarm
       clock. If you want the always-on version later, that's the piece to add.
       ============================================================ */

    window.skincareDebug = {
        chime: playChime,
        complete: playComplete,
        theme: currentTheme,
        toggleTheme: function () {
            applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', true);
        },

        testNotification: function () {
            fireNotification('🧪 Test', 'If you can read this, notifications work.', 'test');
        },

        alarmIn: function (seconds) {
            setTimeout(function () {
                fireNotification(ALARMS[0].title, ALARMS[0].body, 'debug-alarm');
            }, (seconds || 10) * 1000);
            console.log('Alarm queued for ' + (seconds || 10) + 's from now.');
        },

        fakeYesterday: function () {
            var s = loadState();
            s.date = '2000-01-01';
            localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
            console.log('Saved date set to the past. Reload to see the reset.');
        },

        state: function () {
            return loadState();
        },

        reset: function () {
            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem('install-dismissed');
            location.reload();
        },

        // Minutes until each alarm, so you can sanity-check the schedule
        nextAlarms: function () {
            return ALARMS.map(function (a) {
                return a.id + ': ' + Math.round(msUntil(a.hour, a.minute) / 60000) + ' min';
            });
        }
    };
})();
