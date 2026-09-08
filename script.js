/* ============================================================
   Skincare Ritual — app logic
   ------------------------------------------------------------
   Sections:
     1. Config
     2. Theme (light / dark toggle)
     3. Audio feedback (Web Audio API — no MP3 needed)
     4. Storage + midnight reset
     5. Checkbox wiring & progress
     6. Notifications / alarms / reminders (daily EAT alarms, test timer,
        iOS-style sheet, ringing overlay)
     7. PWA install
     8. Service worker
     9. Debug helpers  <-- see TESTING NOTES at the bottom
   ============================================================ */

(function () {
    'use strict';

    /* ---------- 1. Config ---------- */

    var STORAGE_KEY = 'skincare-ritual-state';
    var THEME_KEY = 'skincare-ritual-theme';
    var ALARM_SETTINGS_KEY = 'skincare-ritual-alarms';

    // Kenya is UTC+3 all year (no daylight saving), so this offset is constant.
    var EAT_OFFSET_MIN = 180;

    // Static facts about each routine. The ring *time* lives in the user's
    // alarm settings (section 6) so it can be changed anytime.
    var ROUTINES = {
        morning: { emoji: '☀️', name: 'Morning Ritual',
                   body: 'Vitamin C Cleanser → Corrector → SPF 50. Time to protect your skin.' },
        evening: { emoji: '🌙', name: 'Evening Ritual',
                   body: 'Cleanse away the day, then Charcoal Cream to renew overnight.' }
    };

    var SOUND_OPTIONS = ['Radial', 'Chime', 'Beacon'];
    var SNOOZE_OPTIONS = [5, 9, 15];   // minutes, like the iOS picker

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

    /* ----- Alarm ringtones (looped until stopped) ----- */

    var alarmLoopTimer = null;
    var alarmCutoffTimer = null;

    // One ~1.8s burst of the chosen alarm sound. Three flavours:
    // Radial = urgent iPhone-style beeps, Chime = the soft app chime,
    // Beacon = slow alternating two-tone.
    function alarmBurst(sound) {
        var ctx = getAudioContext();
        if (!ctx) return;
        var now = ctx.currentTime + 0.01;

        function beep(freq, at, dur, type, vol) {
            var osc = ctx.createOscillator();
            var gain = ctx.createGain();
            var start = now + at;
            osc.type = type;
            osc.frequency.setValueAtTime(freq, start);
            gain.gain.setValueAtTime(0.0001, start);
            gain.gain.exponentialRampToValueAtTime(vol, start + 0.015);
            gain.gain.setValueAtTime(vol, start + Math.max(0.02, dur - 0.04));
            gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(start);
            osc.stop(start + dur + 0.05);
        }

        if (sound === 'Chime') {
            beep(1046.5, 0, 0.5, 'sine', 0.25);
            beep(1568.0, 0.18, 0.6, 'sine', 0.25);
        } else if (sound === 'Beacon') {
            beep(660, 0, 0.4, 'sine', 0.28);
            beep(520, 0.5, 0.4, 'sine', 0.28);
            beep(660, 1.0, 0.4, 'sine', 0.28);
        } else {  // Radial (default): insistent square-wave beeps
            beep(940, 0, 0.14, 'square', 0.06);
            beep(940, 0.2, 0.14, 'square', 0.06);
            beep(940, 0.4, 0.14, 'square', 0.06);
            beep(1180, 0.75, 0.16, 'square', 0.06);
            beep(1180, 0.97, 0.16, 'square', 0.06);
        }
    }

    function vibrateAlarm() {
        if (navigator.vibrate) {
            try { navigator.vibrate([350, 150, 350, 150, 700]); } catch (e) {}
        }
    }

    // Loop the burst every 2.2s until stopAlarmLoop(). Cuts itself off after
    // 60s so a missed alarm never drains the battery ringing forever.
    function startAlarmLoop(sound) {
        stopAlarmLoop();
        alarmBurst(sound);
        vibrateAlarm();
        alarmLoopTimer = setInterval(function () {
            alarmBurst(sound);
            vibrateAlarm();
        }, 2200);
        alarmCutoffTimer = setTimeout(stopAlarmLoop, 60000);
    }

    function stopAlarmLoop() {
        if (alarmLoopTimer) clearInterval(alarmLoopTimer);
        if (alarmCutoffTimer) clearTimeout(alarmCutoffTimer);
        alarmLoopTimer = null;
        alarmCutoffTimer = null;
        if (navigator.vibrate) {
            try { navigator.vibrate(0); } catch (e) {}
        }
    }

    function previewSound(sound) {
        alarmBurst(sound);
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

    /* ---------- 6. Notifications / alarms / reminders ----------
       Daily alarms are stored per routine (hour/minute in Kenyan time,
       enabled, sound, label, snooze) and can be changed anytime from the
       ⏰ Reminders card. The test timer is a one-shot countdown that shows
       a live banner, then rings exactly like a real alarm. */

    var statusTimer = null;
    var alarmTimers = [];       // daily routine timers (re-armed on every schedule)
    var snoozeTimer = null;     // one-shot snooze (daily alarms + ringing overlay)
    var nextLineTimer = null;   // refreshes the "Next alarm" line

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

    /* ----- Time helpers (all daily alarms run on Kenyan time, EAT) ----- */

    // "7:30 AM" from 24h parts.
    function fmtTime12(hour, minute) {
        var ap = hour < 12 ? 'AM' : 'PM';
        var h = hour % 12;
        if (h === 0) h = 12;
        return h + ':' + String(minute).padStart(2, '0') + ' ' + ap;
    }

    // Milliseconds from now until the next occurrence of hour:minute in
    // Africa/Nairobi. Computed against EAT wall-clock so the alarm lands on
    // Kenyan time even if the device timezone is set to something else.
    function msUntilEat(hour, minute) {
        var nowMs = Date.now();
        var now = new Date(nowMs);
        // Shift "now" to what the wall clock reads in Nairobi.
        var eatNow = new Date(nowMs + (EAT_OFFSET_MIN + now.getTimezoneOffset()) * 60000);
        var target = new Date(eatNow.getTime());
        target.setHours(hour, minute, 0, 0);
        if (target <= eatNow) target.setDate(target.getDate() + 1);  // passed → tomorrow
        return target - eatNow;
    }

    // Current wall-clock time in Nairobi, e.g. "7:30 AM EAT".
    function eatClockString() {
        try {
            return new Intl.DateTimeFormat('en-US', {
                timeZone: 'Africa/Nairobi', hour: 'numeric',
                minute: '2-digit', hour12: true
            }).format(new Date()) + ' EAT';
        } catch (e) {
            var d = new Date();
            return fmtTime12(d.getHours(), d.getMinutes());
        }
    }

    // 65000ms → "01:05", 3700000ms → "1:02:00".
    function fmtCountdown(ms) {
        var s = Math.max(0, Math.ceil(ms / 1000));
        var h = Math.floor(s / 3600);
        var m = Math.floor((s % 3600) / 60);
        var sec = s % 60;
        if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
        return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
    }

    // 65000ms → "in 1m", 7200000ms → "in 2h 0m", 45000ms → "in 45s".
    function describeDelay(ms) {
        var mins = Math.round(ms / 60000);
        if (mins < 1) return 'in ' + Math.max(1, Math.round(ms / 1000)) + 's';
        if (mins < 60) return 'in ' + mins + 'm';
        var h = Math.floor(mins / 60);
        var m = mins % 60;
        return 'in ' + h + 'h ' + m + 'm';
    }

    /* ----- Alarm settings (user-adjustable, persisted) ----- */

    function defaultAlarmSettings() {
        return {
            morning: { hour: 7, minute: 30, enabled: true, sound: 'Radial',
                       label: 'Morning Ritual', snooze: true, snoozeMin: 9 },
            evening: { hour: 20, minute: 30, enabled: true, sound: 'Radial',
                       label: 'Evening Ritual', snooze: true, snoozeMin: 9 }
        };
    }

    function loadAlarmSettings() {
        var defs = defaultAlarmSettings();
        try {
            var raw = localStorage.getItem(ALARM_SETTINGS_KEY);
            if (!raw) return defs;
            var parsed = JSON.parse(raw);
            ['morning', 'evening'].forEach(function (id) {
                if (parsed[id]) {
                    var d = defs[id];
                    var p = parsed[id];
                    if (typeof p.hour === 'number') d.hour = Math.min(23, Math.max(0, p.hour));
                    if (typeof p.minute === 'number') d.minute = Math.min(59, Math.max(0, p.minute));
                    if (typeof p.enabled === 'boolean') d.enabled = p.enabled;
                    if (SOUND_OPTIONS.indexOf(p.sound) !== -1) d.sound = p.sound;
                    if (typeof p.label === 'string' && p.label.trim()) d.label = p.label.trim().slice(0, 40);
                    if (typeof p.snooze === 'boolean') d.snooze = p.snooze;
                    if (SNOOZE_OPTIONS.indexOf(p.snoozeMin) !== -1) d.snoozeMin = p.snoozeMin;
                }
            });
            return defs;
        } catch (e) {
            return defs;
        }
    }

    function saveAlarmSettings(settings) {
        try {
            localStorage.setItem(ALARM_SETTINGS_KEY, JSON.stringify(settings));
        } catch (e) { /* private mode — schedule still works for this session */ }
    }

    /* ----- Daily alarm scheduling ----- */

    function clearAlarmTimers() {
        alarmTimers.forEach(clearTimeout);
        alarmTimers = [];
    }

    function scheduleAlarms() {
        clearAlarmTimers();

        var settings = loadAlarmSettings();
        ['morning', 'evening'].forEach(function (id) {
            var alarm = settings[id];
            if (!alarm.enabled) return;

            var delay = msUntilEat(alarm.hour, alarm.minute);

            // setTimeout caps out at ~24.8 days, and our max delay is 24h,
            // so a single timer per alarm is safe here.
            var timer = setTimeout(function () {
                fireRoutineAlarm(id);
            }, delay);

            alarmTimers.push(timer);
        });

        renderAlarmUI();
    }

    function fireRoutineAlarm(id) {
        var settings = loadAlarmSettings();
        var alarm = settings[id];
        var routine = ROUTINES[id];

        triggerAlarm({
            tag: id,
            title: routine.emoji + ' ' + (alarm.label || routine.name),
            body: routine.body,
            sound: alarm.sound,
            routineId: id,
            snoozeMin: alarm.snooze ? alarm.snoozeMin : 0
        });

        scheduleAlarms();   // re-arm for tomorrow
    }

    // The single place every alarm funnels through: banner (if permitted)
    // plus the full-screen ringing overlay with looped ringtone + vibration.
    function triggerAlarm(opts) {
        if (notificationsSupported() &&
            typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            fireNotification(opts.title, opts.body, opts.tag || 'alarm');
        }
        showRingOverlay(opts);
    }

    /* ----- Ringing overlay ----- */

    var ringState = null;

    function showRingOverlay(opts) {
        ringState = opts;

        var label = document.getElementById('ringLabel');
        var time = document.getElementById('ringTime');
        var snoozeBtn = document.getElementById('ringSnooze');
        var overlay = document.getElementById('ringOverlay');
        if (!overlay) return;

        if (label) label.textContent = opts.title || 'Alarm';
        if (time) time.textContent = eatClockString();
        if (snoozeBtn) {
            if (opts.snoozeMin && opts.snoozeMin > 0) {
                snoozeBtn.classList.remove('hidden');
                snoozeBtn.textContent = 'Snooze ' + opts.snoozeMin + ' min';
            } else {
                snoozeBtn.classList.add('hidden');
            }
        }

        overlay.classList.remove('hidden');
        startAlarmLoop(opts.sound || 'Radial');
    }

    function hideRingOverlay(stopSound) {
        var overlay = document.getElementById('ringOverlay');
        if (overlay) overlay.classList.add('hidden');
        if (stopSound !== false) stopAlarmLoop();
        ringState = null;
    }

    function snoozeRingingAlarm() {
        var mins = (ringState && ringState.snoozeMin) || 9;
        var sound = (ringState && ringState.sound) || 'Radial';
        var title = (ringState && ringState.title) || 'Alarm';
        hideRingOverlay(true);

        if (snoozeTimer) clearTimeout(snoozeTimer);
        snoozeTimer = setTimeout(function () {
            snoozeTimer = null;
            triggerAlarm({
                tag: 'snooze',
                title: title,
                body: 'Snoozed alarm — time is up.',
                sound: sound,
                routineId: null,
                snoozeMin: mins
            });
        }, mins * 60000);

        showStatus('Snoozed — rings again in ' + mins + ' min (keep the app open)', 5000);
    }

    /* ----- Test timer (one-shot countdown with live banner) ----- */

    var testTimer = { interval: null, endAt: 0, sound: 'Radial' };

    function startTestTimer(totalSec, sound, label) {
        cancelTestTimer();

        testTimer.sound = sound || 'Radial';
        testTimer.endAt = Date.now() + totalSec * 1000;

        var bar = document.getElementById('countdownBar');
        var name = document.getElementById('countdownName');
        if (name) name.textContent = label || 'Test timer';
        if (bar) bar.classList.remove('hidden');

        tickTestTimer();
        testTimer.interval = setInterval(tickTestTimer, 250);
    }

    function tickTestTimer() {
        if (!testTimer.interval) return;
        var remain = testTimer.endAt - Date.now();
        if (remain <= 0) {
            var sound = testTimer.sound;
            cancelTestTimer();
            triggerAlarm({
                tag: 'test-timer',
                title: '⏱ Test timer',
                body: "Time's up! This is exactly what your daily alarm will look and sound like.",
                sound: sound,
                routineId: null,
                snoozeMin: 0
            });
            return;
        }
        var el = document.getElementById('countdownTime');
        if (el) el.textContent = fmtCountdown(remain);
    }

    function cancelTestTimer() {
        if (testTimer.interval) clearInterval(testTimer.interval);
        testTimer.interval = null;
        var bar = document.getElementById('countdownBar');
        if (bar) bar.classList.add('hidden');
    }

    /* ----- Scroll-wheel picker (iOS drum style) ----- */

    var WHEEL_ITEM_H = 44;

    // items: array of {value, label}. Returns {get, set(value)}.
    function createWheel(el, items) {
        var i, div;

        el.innerHTML = '';
        var padTop = document.createElement('div');
        padTop.className = 'wheel-pad';
        el.appendChild(padTop);

        items.forEach(function (item) {
            div = document.createElement('div');
            div.className = 'wheel-item';
            div.textContent = item.label;
            div.setAttribute('data-value', item.value);
            el.appendChild(div);
        });

        var padBottom = document.createElement('div');
        padBottom.className = 'wheel-pad';
        el.appendChild(padBottom);

        var rows = el.querySelectorAll('.wheel-item');
        var current = 0;
        var settleTimer = null;

        function paint() {
            rows.forEach(function (row, idx) {
                row.classList.toggle('selected', idx === current);
            });
        }

        function read() {
            var idx = Math.round(el.scrollTop / WHEEL_ITEM_H);
            current = Math.min(items.length - 1, Math.max(0, idx));
            paint();
            return current;
        }

        el.addEventListener('scroll', function () {
            // Wait for the scroll to settle, then snap exactly to a row.
            if (settleTimer) clearTimeout(settleTimer);
            settleTimer = setTimeout(function () {
                var idx = read();
                el.scrollTop = idx * WHEEL_ITEM_H;
            }, 90);
        });

        paint();

        return {
            get: function () { return items[read()].value; },
            set: function (value) {
                for (var k = 0; k < items.length; k++) {
                    if (items[k].value === value) {
                        current = k;
                        el.scrollTop = k * WHEEL_ITEM_H;
                        paint();
                        return;
                    }
                }
            }
        };
    }

    function numItems(count, pad) {
        var out = [];
        for (var n = 0; n < count; n++) {
            var label = pad ? String(n).padStart(2, '0') : String(n);
            out.push({ value: n, label: label });
        }
        return out;
    }

    /* ----- Alarm sheet (Add Alarm / Test Timer) ----- */

    // sheetMode is { kind: 'daily', routineId } or { kind: 'test' }.
    var sheetMode = null;
    var sheetSound = 'Radial';
    var sheetSnooze = true;
    var sheetSnoozeMin = 9;
    var sheetEnabled = true;
    var wheels = {};

    function buildWheels() {
        var hourItems = [];
        for (var h = 1; h <= 12; h++) hourItems.push({ value: h, label: String(h) });

        wheels.hour = createWheel(document.getElementById('wheelHour'), hourItems);
        wheels.minute = createWheel(document.getElementById('wheelMinute'), numItems(60, true));
        wheels.ampm = createWheel(document.getElementById('wheelAmPm'), [
            { value: 'AM', label: 'AM' }, { value: 'PM', label: 'PM' }
        ]);
        wheels.tmin = createWheel(document.getElementById('wheelTMin'), numItems(60, true));
        wheels.tsec = createWheel(document.getElementById('wheelTSec'), numItems(60, true));
    }

    function setSwitch(id, on) {
        var el = document.getElementById(id);
        if (el) {
            el.classList.toggle('on', !!on);
            el.setAttribute('aria-label', el.getAttribute('aria-label'));
        }
    }

    function openSheet(kind, routineId) {
        sheetMode = { kind: kind, routineId: routineId || null };

        var title = document.getElementById('sheetTitle');
        var dailyPicker = document.getElementById('dailyPicker');
        var testPicker = document.getElementById('testPicker');
        var enabledRow = document.getElementById('enabledRow');
        var repeat = document.getElementById('repeatValue');
        var labelInput = document.getElementById('labelInput');
        var hint = document.getElementById('sheetHint');

        if (kind === 'daily') {
            var settings = loadAlarmSettings();
            var alarm = settings[routineId];
            var routine = ROUTINES[routineId];

            if (title) title.textContent = routine.emoji + ' ' + routine.name + ' alarm';
            if (dailyPicker) dailyPicker.classList.remove('hidden');
            if (testPicker) testPicker.classList.add('hidden');
            if (enabledRow) enabledRow.classList.remove('hidden');
            if (repeat) repeat.textContent = 'Daily';
            if (labelInput) labelInput.value = alarm.label || routine.name;
            if (hint) hint.textContent = 'Rings every day at this time, in Kenyan time (EAT). Change it anytime.';

            // Preset the drums to the saved time (scrolls must happen after
            // the sheet is visible, otherwise scrollTop has no effect).
            sheetSound = alarm.sound;
            sheetSnooze = alarm.snooze;
            sheetSnoozeMin = alarm.snoozeMin;
            sheetEnabled = alarm.enabled;

            document.getElementById('alarmSheet').classList.remove('hidden');
            var h12 = alarm.hour % 12;
            if (h12 === 0) h12 = 12;
            wheels.hour.set(h12);
            wheels.minute.set(alarm.minute);
            wheels.ampm.set(alarm.hour < 12 ? 'AM' : 'PM');
        } else {
            if (title) title.textContent = '⏱ Test Timer';
            if (dailyPicker) dailyPicker.classList.add('hidden');
            if (testPicker) testPicker.classList.remove('hidden');
            if (enabledRow) enabledRow.classList.add('hidden');
            if (repeat) repeat.textContent = 'Once';
            if (labelInput) labelInput.value = 'Test timer';
            if (hint) hint.textContent = 'Pick a countdown, press ✓, and the banner will count down live.';

            sheetSound = 'Radial';
            sheetSnooze = false;
            sheetEnabled = true;

            document.getElementById('alarmSheet').classList.remove('hidden');
            wheels.tmin.set(0);
            wheels.tsec.set(10);
            markQuickChip(10);
        }

        paintSheetRows();
    }

    function closeSheet() {
        var sheet = document.getElementById('alarmSheet');
        if (sheet) sheet.classList.add('hidden');
        sheetMode = null;
    }

    function paintSheetRows() {
        var soundRow = document.getElementById('soundRow');
        var snoozeDurRow = document.getElementById('snoozeDurRow');
        if (soundRow) soundRow.textContent = sheetSound + ' ›';
        if (snoozeDurRow) snoozeDurRow.textContent = sheetSnoozeMin + ' min';
        setSwitch('enabledToggle', sheetEnabled);
        setSwitch('snoozeToggle', sheetSnooze);
    }

    function markQuickChip(secs) {
        document.querySelectorAll('#quickChips button').forEach(function (btn) {
            btn.classList.toggle('active', Number(btn.getAttribute('data-secs')) === secs);
        });
    }

    function cycleSound() {
        var i = SOUND_OPTIONS.indexOf(sheetSound);
        sheetSound = SOUND_OPTIONS[(i + 1) % SOUND_OPTIONS.length];
        paintSheetRows();
        previewSound(sheetSound);   // tap = preview, so you can audition each
    }

    function cycleSnoozeDur() {
        var i = SNOOZE_OPTIONS.indexOf(sheetSnoozeMin);
        sheetSnoozeMin = SNOOZE_OPTIONS[(i + 1) % SNOOZE_OPTIONS.length];
        paintSheetRows();
    }

    function saveSheet() {
        var labelInput = document.getElementById('labelInput');
        var label = labelInput ? labelInput.value.trim().slice(0, 40) : '';

        if (!sheetMode) return;

        if (sheetMode.kind === 'daily') {
            var h12 = wheels.hour.get();
            var minute = wheels.minute.get();
            var ampm = wheels.ampm.get();
            var hour = h12 % 12;
            if (ampm === 'PM') hour += 12;

            var settings = loadAlarmSettings();
            settings[sheetMode.routineId] = {
                hour: hour,
                minute: minute,
                enabled: sheetEnabled,
                sound: sheetSound,
                label: label || ROUTINES[sheetMode.routineId].name,
                snooze: sheetSnooze,
                snoozeMin: sheetSnoozeMin
            };
            saveAlarmSettings(settings);
            scheduleAlarms();
            closeSheet();

            var routine = ROUTINES[sheetMode.routineId || 'morning'];
            if (sheetEnabled) {
                showStatus(routine.emoji + ' Daily alarm set — ' +
                    fmtTime12(hour, minute) + ' EAT ' +
                    describeDelay(msUntilEat(hour, minute)), 5000);
            } else {
                showStatus(routine.emoji + ' Alarm saved but switched off', 4000);
            }

            // Nudge to enable banners if they haven't — without them the
            // alarm only rings visibly while the app is on screen.
            if (sheetEnabled && notificationsSupported() &&
                typeof Notification !== 'undefined' && Notification.permission === 'default') {
                setTimeout(requestNotificationPermission, 600);
            }
        } else {
            var totalSec = wheels.tmin.get() * 60 + wheels.tsec.get();
            if (totalSec < 5) {
                showStatus('Pick at least 5 seconds for a test', 3000);
                return;
            }
            closeSheet();

            // The ✓ tap counts as a user gesture, so this is a valid place
            // to ask for banner permission before the countdown starts.
            if (notificationsSupported() &&
                typeof Notification !== 'undefined' && Notification.permission === 'default') {
                Notification.requestPermission().then(function (result) {
                    if (result === 'granted') markNotificationsEnabled();
                    startTestTimer(totalSec, sheetSound, label || 'Test timer');
                });
            } else {
                startTestTimer(totalSec, sheetSound, label || 'Test timer');
            }
            showStatus('⏱ Counting down — ' + fmtCountdown(totalSec * 1000), 3000);
        }
    }

    /* ----- Reminders card UI ----- */

    function renderAlarmUI() {
        var settings = loadAlarmSettings();

        ['morning', 'evening'].forEach(function (id) {
            var alarm = settings[id];
            var timeText = fmtTime12(alarm.hour, alarm.minute);

            var pill = document.getElementById(id + 'AlarmPill');
            if (pill) {
                pill.textContent = alarm.enabled ? 'Alarm: ' + timeText : 'Alarm off';
                pill.classList.toggle('off', !alarm.enabled);
            }

            var rowTime = document.getElementById(id + 'AlarmTime');
            if (rowTime) rowTime.textContent = timeText;

            var row = document.getElementById(id + 'AlarmRow');
            if (row) row.classList.toggle('off', !alarm.enabled);
        });

        updateNextAlarmLine();
    }

    function updateNextAlarmLine() {
        var el = document.getElementById('nextAlarmLine');
        if (!el) return;

        var settings = loadAlarmSettings();
        var cands = [];
        ['morning', 'evening'].forEach(function (id) {
            var alarm = settings[id];
            if (!alarm.enabled) return;
            cands.push({ id: id, delay: msUntilEat(alarm.hour, alarm.minute) });
        });

        if (!cands.length) {
            el.textContent = 'All alarms off';
            return;
        }

        cands.sort(function (a, b) { return a.delay - b.delay; });
        var next = cands[0];
        var alarm = settings[next.id];
        var routine = ROUTINES[next.id];
        el.textContent = 'Next: ' + routine.emoji + ' ' + routine.name + ' ' +
            describeDelay(next.delay) + ' (' + fmtTime12(alarm.hour, alarm.minute) + ' EAT)';
    }

    function initReminders() {
        buildWheels();

        ['morning', 'evening'].forEach(function (id) {
            var row = document.getElementById(id + 'AlarmRow');
            if (row) row.addEventListener('click', function () { openSheet('daily', id); });
            var pill = document.getElementById(id + 'AlarmPill');
            if (pill) pill.addEventListener('click', function () { openSheet('daily', id); });
        });

        var testBtn = document.getElementById('testNotifBtn');
        if (testBtn) testBtn.addEventListener('click', function () { openSheet('test'); });

        var save = document.getElementById('sheetSave');
        if (save) save.addEventListener('click', saveSheet);
        var cancel = document.getElementById('sheetCancel');
        if (cancel) cancel.addEventListener('click', closeSheet);

        // Tapping the dimmed backdrop dismisses the sheet.
        var overlay = document.getElementById('alarmSheet');
        if (overlay) {
            overlay.addEventListener('click', function (e) {
                if (e.target === overlay) closeSheet();
            });
        }

        var soundRow = document.getElementById('soundRow');
        if (soundRow) soundRow.addEventListener('click', cycleSound);
        var snoozeDurRow = document.getElementById('snoozeDurRow');
        if (snoozeDurRow) snoozeDurRow.addEventListener('click', cycleSnoozeDur);

        var snoozeToggle = document.getElementById('snoozeToggle');
        if (snoozeToggle) {
            snoozeToggle.addEventListener('click', function () {
                sheetSnooze = !sheetSnooze;
                paintSheetRows();
            });
        }
        var enabledToggle = document.getElementById('enabledToggle');
        if (enabledToggle) {
            enabledToggle.addEventListener('click', function () {
                sheetEnabled = !sheetEnabled;
                paintSheetRows();
            });
        }

        document.querySelectorAll('#quickChips button').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var secs = Number(btn.getAttribute('data-secs'));
                wheels.tmin.set(Math.floor(secs / 60));
                wheels.tsec.set(secs % 60);
                markQuickChip(secs);
                if (navigator.vibrate) navigator.vibrate(8);
            });
        });

        var countdownCancel = document.getElementById('countdownCancel');
        if (countdownCancel) {
            countdownCancel.addEventListener('click', function () {
                cancelTestTimer();
                showStatus('Test timer cancelled');
            });
        }

        var ringStop = document.getElementById('ringStop');
        if (ringStop) {
            ringStop.addEventListener('click', function () {
                hideRingOverlay(true);
                showStatus('Alarm stopped ✓');
            });
        }
        var ringSnooze = document.getElementById('ringSnooze');
        if (ringSnooze) ringSnooze.addEventListener('click', snoozeRingingAlarm);

        renderAlarmUI();

        // Keep the "Next alarm" line fresh (it counts down in minutes).
        if (nextLineTimer) clearInterval(nextLineTimer);
        nextLineTimer = setInterval(updateNextAlarmLine, 30000);
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
            var s = loadAlarmSettings();
            fireNotification('🔔 Reminders are on',
                'Morning at ' + fmtTime12(s.morning.hour, s.morning.minute) +
                ' · Evening at ' + fmtTime12(s.evening.hour, s.evening.minute) + ' (EAT)', 'test');
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
                var s = loadAlarmSettings();
                fireNotification('🔔 Reminders are on',
                    'Morning at ' + fmtTime12(s.morning.hour, s.morning.minute) +
                    ' · Evening at ' + fmtTime12(s.evening.hour, s.evening.minute) + ' (EAT)', 'welcome');
                showStatus('Reminders enabled — ' +
                    fmtTime12(s.morning.hour, s.morning.minute) + ' & ' +
                    fmtTime12(s.evening.hour, s.evening.minute) + ' EAT');
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
        }
        // Daily alarms are scheduled regardless of banner permission: the
        // ringing overlay + ringtone still work while the app is on screen.
        scheduleAlarms();
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
        tickTestTimer();   // refresh the countdown banner if one is running
        updateNextAlarmLine();
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
        initReminders();
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

       --- Ring an alarm in 10 seconds (banner + ringtone + overlay) ---
           skincareDebug.alarmIn(10)
       This fires the full morning alarm 10 seconds from now, so you can
       confirm the exact banner, ringtone and overlay your phone will
       produce. Try it with the app in the background to see the banner.

       --- Start a test countdown with a live banner ---
           skincareDebug.testTimer(10)
       Same as the 🧪 Test notifications button: a countdown banner ticks
       down, then the test alarm rings.

       --- Inspect / change the daily alarms ---
           skincareDebug.alarms()              // settings + minutes until each
           skincareDebug.setAlarm('morning', 8, 0)   // 8:00 AM EAT daily

       --- Test the midnight reset ---
           skincareDebug.fakeYesterday()   // then reload the page
       This rewrites the saved date to yesterday. On reload every box should
       come back unchecked, exactly as it will at midnight.

       --- Inspect what's stored ---
           skincareDebug.state()

       --- Clear everything and start over ---
           skincareDebug.reset()

       --- IMPORTANT: how far these alarms actually reach ---
       Daily times are stored in Kenyan time (EAT, UTC+3, no daylight
       saving), so they land correctly even if the device timezone differs.
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
            var s = loadAlarmSettings();
            setTimeout(function () {
                triggerAlarm({
                    tag: 'debug-alarm',
                    title: ROUTINES.morning.emoji + ' ' + s.morning.label,
                    body: ROUTINES.morning.body,
                    sound: s.morning.sound,
                    routineId: null,
                    snoozeMin: s.morning.snooze ? s.morning.snoozeMin : 0
                });
            }, (seconds || 10) * 1000);
            console.log('Alarm queued for ' + (seconds || 10) + 's from now.');
        },

        testTimer: function (seconds) {
            startTestTimer(seconds || 10, 'Radial', 'Test timer');
        },

        stopAlarm: function () {
            hideRingOverlay(true);
            cancelTestTimer();
        },

        previewSound: previewSound,

        alarms: function () {
            return loadAlarmSettings();
        },

        setAlarm: function (id, hour, minute) {
            if (id !== 'morning' && id !== 'evening') {
                console.log('Use "morning" or "evening".');
                return;
            }
            var s = loadAlarmSettings();
            s[id].hour = hour;
            s[id].minute = minute;
            s[id].enabled = true;
            saveAlarmSettings(s);
            scheduleAlarms();
            console.log(id + ' alarm set to ' + fmtTime12(hour, minute) + ' EAT daily.');
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
            var s = loadAlarmSettings();
            return ['morning', 'evening'].map(function (id) {
                var a = s[id];
                if (!a.enabled) return id + ': off';
                return id + ' (' + fmtTime12(a.hour, a.minute) + ' EAT): ' +
                    Math.round(msUntilEat(a.hour, a.minute) / 60000) + ' min';
            });
        }
    };
})();
