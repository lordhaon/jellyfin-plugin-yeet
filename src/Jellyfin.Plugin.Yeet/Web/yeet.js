/* YEET: adds "Yeet to device" to Jellyfin's item menus. Turns the device on (a Roku directly, others through Home Assistant), then starts playback there. */
(function () {
    'use strict';

    if (window.__yeetLoaded) {
        return;
    }
    window.__yeetLoaded = true;

    var MENU_ID = 'yeet-send';
    var PENDING_MS = 3000;
    var POLL_MS = 2000;
    var WAKE_TIMEOUT_MS = 90000;
    // Give a freshly opened app a moment to finish loading before it is told to play.
    var SETTLE_MS = 2500;
    var MAX_QUEUE = 200;
    var pending = null;

    // ---------- helpers ----------

    function client() {
        return window.ApiClient;
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function getJson(path, params) {
        var c = client();
        return c.getJSON(c.getUrl(path, params));
    }

    function post(path, params) {
        var c = client();
        return c.ajax({ type: 'POST', url: c.getUrl(path, params) });
    }

    function wait(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    function idFromLocation() {
        var m = /[?&]id=([0-9a-fA-F-]{32,36})/.exec((location.hash || '') + '&' + (location.search || ''));
        return m ? m[1] : null;
    }

    function ticksToText(ticks) {
        var s = Math.floor(ticks / 10000000);
        var h = Math.floor(s / 3600);
        var m = Math.floor((s % 3600) / 60);
        var sec = s % 60;
        return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
    }

    function errorMessage(err, fallback) {
        if (err && typeof err.json === 'function') {
            return err.json().then(function (j) { return (j && j.message) || fallback; }).catch(function () { return fallback; });
        }
        return Promise.resolve((err && err.yeetMessage) || fallback);
    }

    // ---------- work out which item a menu is for ----------

    function remember(id) {
        pending = id ? { id: id, at: Date.now() } : null;
    }

    document.addEventListener('click', function (e) {
        var t = e.target;
        if (!(t instanceof Element)) {
            return;
        }

        // The multi-select menu acts on several items; "Yeet to device" is for one.
        if (t.closest('.btnSelectionPanelOptions')) {
            remember(null);
            return;
        }

        var menuBtn = t.closest('[data-action="menu"], .btnCardOptions');
        if (menuBtn) {
            var holder = menuBtn.closest('[data-id]');
            remember(holder ? holder.getAttribute('data-id') : null);
            return;
        }

        if (t.closest('.btnMoreCommands')) {
            remember(idFromLocation());
        }
    }, true);

    // Right-click / long-press on a card opens the same menu.
    document.addEventListener('contextmenu', function (e) {
        var t = e.target;
        if (!(t instanceof Element)) {
            return;
        }
        var holder = t.closest('.card[data-id], .listItem[data-id]');
        if (holder) {
            remember(holder.getAttribute('data-id'));
        }
    }, true);

    // ---------- inject into the action sheet ----------

    function onSheetAdded(sheet) {
        if (!pending || Date.now() - pending.at > PENDING_MS) {
            return;
        }
        var id = pending.id;
        var c = client();
        if (!c || !c.getCurrentUserId()) {
            return;
        }

        var scroller = sheet.querySelector('.actionSheetScroller');
        if (!scroller || scroller.querySelector('[data-id="' + MENU_ID + '"]')) {
            return;
        }

        var template = scroller.querySelector('.actionSheetMenuItem');
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('is', 'emby-button');
        // Keep Jellyfin's own classes so it looks native and closes the sheet when clicked.
        btn.className = template ? template.className : 'listItem listItem-button actionSheetMenuItem';
        btn.classList.add('emby-button');
        btn.setAttribute('data-id', MENU_ID);

        var hasIcons = !!scroller.querySelector('.actionsheetMenuItemIcon');
        btn.innerHTML = (hasIcons ? '<span class="actionsheetMenuItemIcon listItemIcon listItemIcon-transparent material-icons cast" aria-hidden="true"></span>' : '')
            + '<div class="listItemBody actionsheetListItemBody"><div class="listItemBodyText actionSheetItemText">Yeet to device</div></div>';

        btn.addEventListener('click', function () {
            setTimeout(function () { openDialog(id); }, 150);
        });

        scroller.insertBefore(btn, scroller.firstChild);
    }

    var observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
            m.addedNodes.forEach(function (node) {
                if (!(node instanceof Element)) {
                    return;
                }
                var sheet = node.classList.contains('actionSheet') ? node : node.querySelector('.actionSheet');
                if (sheet) {
                    onSheetAdded(sheet);
                }
            });
        });
    });

    function startObserver() {
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.body) {
        startObserver();
    } else {
        document.addEventListener('DOMContentLoaded', startObserver);
    }

    // ---------- devices and sessions ----------

    function getSessions() {
        var c = client();
        return getJson('Sessions', { controllableByUserId: c.getCurrentUserId() }).then(function (sessions) {
            var own = typeof c.deviceId === 'function' ? c.deviceId() : null;
            return (sessions || []).filter(function (s) {
                return s.SupportsRemoteControl && s.DeviceId !== own;
            });
        });
    }

    function sessionFor(device, sessions) {
        var needle = (device.sessionMatch || device.name || '').toLowerCase();
        if (!needle) {
            return null;
        }
        return sessions.filter(function (s) {
            return (s.DeviceName || '').toLowerCase().indexOf(needle) !== -1;
        })[0] || null;
    }

    // Configured devices first, then any other Jellyfin app that is open right now.
    function buildTargets(devices, sessions) {
        var used = [];
        var targets = devices.map(function (d) {
            var s = sessionFor(d, sessions);
            if (s) {
                used.push(s.Id);
            }
            return { name: d.name, device: d, session: s };
        }).filter(function (t) { return t.session || t.device.canWake; });

        sessions.forEach(function (s) {
            if (used.indexOf(s.Id) === -1) {
                targets.push({ name: s.DeviceName || s.Client || 'Unknown device', device: null, session: s });
            }
        });
        return targets;
    }

    // ---------- what to play ----------

    function idsOf(result) {
        return ((result && result.Items) || []).map(function (i) { return i.Id; });
    }

    function rokuType(item) {
        var type = item && item.Type;
        return type === 'Episode' ? 'episode' : (type === 'Audio' ? 'audio' : 'movie');
    }

    function resolveQueue(item) {
        var uid = client().getCurrentUserId();

        if (item.Type === 'Series') {
            return getJson('Shows/NextUp', { seriesId: item.Id, userId: uid, limit: 1 }).then(function (next) {
                var first = next && next.Items && next.Items[0];
                var params = { userId: uid, limit: MAX_QUEUE };
                if (first) {
                    params.startItemId = first.Id;
                }
                return getJson('Shows/' + item.Id + '/Episodes', params).then(function (eps) {
                    var resume = first && first.UserData ? first.UserData.PlaybackPositionTicks : 0;
                    return { ids: idsOf(eps), resumeTicks: resume || 0, mediaType: 'episode' };
                });
            });
        }

        if (item.Type === 'Season' && item.SeriesId) {
            return getJson('Shows/' + item.SeriesId + '/Episodes', { userId: uid, seasonId: item.Id, limit: MAX_QUEUE }).then(function (eps) {
                return { ids: idsOf(eps), resumeTicks: 0, mediaType: 'episode' };
            });
        }

        if (item.Type === 'Playlist') {
            return getJson('Playlists/' + item.Id + '/Items', { userId: uid, limit: MAX_QUEUE }).then(function (res) {
                return { ids: idsOf(res), resumeTicks: 0, mediaType: rokuType(res.Items && res.Items[0]) };
            });
        }

        if (item.IsFolder) {
            return getJson('Items', {
                userId: uid,
                parentId: item.Id,
                recursive: true,
                filters: 'IsNotFolder',
                mediaTypes: 'Video,Audio',
                sortBy: 'ParentIndexNumber,IndexNumber,SortName',
                limit: MAX_QUEUE
            }).then(function (res) {
                return { ids: idsOf(res), resumeTicks: 0, mediaType: rokuType(res.Items && res.Items[0]) };
            });
        }

        return Promise.resolve({ ids: [item.Id], resumeTicks: (item.UserData && item.UserData.PlaybackPositionTicks) || 0, mediaType: rokuType(item) });
    }

    // Roku deep links carry one item, so a Roku that is off starts the first item rather than the whole queue.
    function launchDirect(device, queue, resume) {
        var params = { itemId: queue.ids[0], mediaType: queue.mediaType };
        if (resume && queue.resumeTicks > 0) {
            params.startPositionTicks = queue.resumeTicks;
        }
        return post('Yeet/Devices/' + encodeURIComponent(device.id) + '/Launch', params);
    }

    function sendPlay(session, queue, resume, choice) {
        var params = { playCommand: 'PlayNow', itemIds: queue.ids.join(',') };
        if (resume && queue.resumeTicks > 0) {
            params.startPositionTicks = queue.resumeTicks;
        }
        Object.keys(choice || {}).forEach(function (k) {
            params[k] = choice[k];
        });
        return post('Sessions/' + session.Id + '/Playing', params);
    }

    // ---------- version, audio and subtitles ----------

    function streamsOf(source, type) {
        return ((source && source.MediaStreams) || []).filter(function (st) { return st.Type === type; });
    }

    function streamLabel(st) {
        return st.DisplayTitle || st.Title || st.Language || ('Track ' + st.Index);
    }

    // What is picked on the item's own details page, so the dialog starts from the same choice.
    function pageValue(itemId, cls) {
        var here = (idFromLocation() || '').replace(/-/g, '').toLowerCase();
        if (here !== String(itemId).replace(/-/g, '').toLowerCase()) {
            return null;
        }
        var el = document.querySelector('.itemDetailPage:not(.hide) select.' + cls);
        return el && el.value !== '' ? el.value : null;
    }

    function selectValue(select, value) {
        if (value == null) {
            return;
        }
        for (var i = 0; i < select.options.length; i++) {
            if (select.options[i].value === String(value)) {
                select.value = String(value);
                return;
            }
        }
    }

    // ---------- dialog ----------

    var css = ''
        + '.yeet-overlay{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px;}'
        + '.yeet-dialog{background:#202020;color:#fff;border-radius:10px;width:100%;max-width:440px;max-height:90vh;overflow:auto;padding:20px 22px;box-shadow:0 10px 40px rgba(0,0,0,.5);font-size:15px;}'
        + '.yeet-dialog h2{margin:0 0 4px;font-size:1.3em;}'
        + '.yeet-sub{opacity:.7;margin-bottom:14px;font-size:.9em;}'
        + '.yeet-device{display:flex;align-items:center;gap:12px;width:100%;text-align:left;border:0;color:#fff;font-size:1em;padding:12px;border-radius:6px;background:rgba(255,255,255,.06);margin-bottom:8px;cursor:pointer;}'
        + '.yeet-device:hover,.yeet-device:focus{background:rgba(255,255,255,.14);}'
        + '.yeet-device small{display:block;opacity:.6;font-size:.8em;margin-top:2px;}'
        + '.yeet-dot{width:10px;height:10px;border-radius:50%;background:#777;flex:none;}'
        + '.yeet-dot.on{background:#52b54b;}'
        + '.yeet-resume{display:flex;align-items:center;gap:10px;margin:12px 0 2px;cursor:pointer;}'
        + '.yeet-resume input{accent-color:#00a4dc;width:18px;height:18px;margin:0;}'
        + '.yeet-opt{display:flex;align-items:center;gap:10px;margin:6px 0;}'
        + '.yeet-opt[hidden]{display:none;}'
        + '.yeet-opt label{width:5em;flex:none;opacity:.8;font-size:.9em;}'
        + '.yeet-opt select{flex:1;min-width:0;background:#2b2b2b;color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:6px;padding:7px 8px;font-size:.9em;}'
        + '.yeet-opts{margin-bottom:12px;}'
        + '.yeet-note{font-size:.9em;background:rgba(255,170,0,.12);border-left:3px solid #ffaa00;padding:8px 10px;margin:10px 0;border-radius:4px;}'
        + '.yeet-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:16px;}'
        + '.yeet-btn{border:0;border-radius:6px;padding:9px 16px;font-size:.95em;cursor:pointer;background:rgba(255,255,255,.1);color:#fff;}'
        + '.yeet-btn.primary{background:#00a4dc;}'
        + '.yeet-spin{width:22px;height:22px;border:3px solid rgba(255,255,255,.2);border-top-color:#00a4dc;border-radius:50%;animation:yeet-spin 1s linear infinite;flex:none;}'
        + '.yeet-status{display:flex;align-items:center;gap:12px;margin:14px 0;}'
        + '@keyframes yeet-spin{to{transform:rotate(360deg);}}';

    function ensureCss() {
        if (document.getElementById('yeet-style')) {
            return;
        }
        var style = document.createElement('style');
        style.id = 'yeet-style';
        style.textContent = css;
        document.head.appendChild(style);
    }

    function openDialog(itemId) {
        ensureCss();

        var overlay = document.createElement('div');
        overlay.className = 'yeet-overlay';
        var dlg = document.createElement('div');
        dlg.className = 'yeet-dialog';
        overlay.appendChild(dlg);
        document.body.appendChild(overlay);

        // Bumped whenever the dialog closes or a send is cancelled, so a wait in progress stops.
        var run = 0;
        function close() {
            run++;
            document.removeEventListener('keydown', onKey, true);
            overlay.remove();
        }
        function onKey(e) {
            if (e.key === 'Escape') {
                e.stopPropagation();
                close();
            }
        }
        document.addEventListener('keydown', onKey, true);
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) {
                close();
            }
        });

        function closeButton(label) {
            return '<div class="yeet-actions"><button class="yeet-btn" data-act="close">' + esc(label || 'Close') + '</button></div>';
        }
        function wireClose() {
            var b = dlg.querySelector('[data-act="close"]');
            if (b) {
                b.addEventListener('click', close);
            }
        }

        function showMessage(title, msg, retry) {
            dlg.innerHTML = '<h2>' + esc(title) + '</h2><div class="yeet-note">' + esc(msg) + '</div>'
                + '<div class="yeet-actions"><button class="yeet-btn" data-act="close">Close</button>'
                + (retry ? '<button class="yeet-btn primary" data-act="retry">Try again</button>' : '') + '</div>';
            wireClose();
            if (retry) {
                dlg.querySelector('[data-act="retry"]').addEventListener('click', retry);
            }
        }

        function showStatus(name, text) {
            dlg.innerHTML = '<h2>' + esc(name) + '</h2><div class="yeet-status"><div class="yeet-spin"></div><div data-el="text">' + esc(text) + '</div></div>'
                + closeButton('Cancel');
            wireClose();
        }

        function waitForSession(device, mine, deadline) {
            if (mine !== run) {
                return Promise.reject({ cancelled: true });
            }
            return getSessions().catch(function () { return []; }).then(function (sessions) {
                var s = sessionFor(device, sessions);
                if (s) {
                    return s;
                }
                if (Date.now() > deadline) {
                    return Promise.reject({ yeetMessage: 'Jellyfin didn\'t open on ' + device.name + ' in time. Check that the device is on and try again.' });
                }
                return wait(POLL_MS).then(function () { return waitForSession(device, mine, deadline); });
            });
        }

        function send(target, queue, resume, choice) {
            var mine = ++run;
            var ready;
            var direct = !target.session && target.device.direct;

            if (target.session) {
                showStatus(target.name, 'Starting playback…');
                ready = Promise.resolve(target.session);
            } else if (direct) {
                showStatus(target.name, 'Turning on and starting playback…');
                ready = launchDirect(target.device, queue, resume);
            } else {
                showStatus(target.name, 'Turning on and opening Jellyfin…');
                ready = post('Yeet/Devices/' + encodeURIComponent(target.device.id) + '/Wake')
                    .then(function () { return waitForSession(target.device, mine, Date.now() + WAKE_TIMEOUT_MS); })
                    .then(function (s) {
                        var text = dlg.querySelector('[data-el="text"]');
                        if (text) {
                            text.textContent = 'Starting playback…';
                        }
                        return wait(SETTLE_MS).then(function () { return s; });
                    });
            }

            ready.then(function (session) {
                if (mine !== run) {
                    return Promise.reject({ cancelled: true });
                }
                return direct ? null : sendPlay(session, queue, resume, choice);
            }).then(function () {
                if (mine !== run) {
                    return;
                }
                dlg.innerHTML = '<h2>' + esc(target.name) + '</h2><div class="yeet-sub" style="margin-top:10px;">' + (direct ? 'Sent. It should start in a few seconds.' : 'Playing now.') + '</div>' + closeButton();
                wireClose();
                setTimeout(function () {
                    if (mine === run) {
                        close();
                    }
                }, 2000);
            }).catch(function (err) {
                if (mine !== run || (err && err.cancelled)) {
                    return;
                }
                errorMessage(err, 'Couldn\'t start playback on ' + target.name + '.').then(function (msg) {
                    if (mine === run) {
                        showMessage(target.name, msg, function () { send(target, queue, resume, choice); });
                    }
                });
            });
        }

        function showPicker(item, queue, targets) {
            var title = item.SeriesName && item.Type === 'Episode' ? item.SeriesName + ' – ' + item.Name : item.Name;
            var html = '<h2>Yeet to device</h2><div class="yeet-sub">' + esc(title) + '</div>';

            // Version and track choices only make sense when a single video or song is being sent.
            var sources = queue.ids.length === 1 && queue.ids[0] === item.Id ? (item.MediaSources || []) : [];
            if (sources.length) {
                html += '<div class="yeet-opts">'
                    + '<div class="yeet-opt" data-el="source-row" hidden><label>Version</label><select data-el="source">' + sources.map(function (src) {
                        return '<option value="' + esc(src.Id) + '">' + esc(src.Name || 'Version') + '</option>';
                    }).join('') + '</select></div>'
                    + '<div class="yeet-opt" data-el="audio-row" hidden><label>Audio</label><select data-el="audio"></select></div>'
                    + '<div class="yeet-opt" data-el="subs-row" hidden><label>Subtitles</label><select data-el="subs"></select></div>'
                    + '</div>';
            }

            targets.forEach(function (t, idx) {
                var hint = t.session
                    ? (t.session.NowPlayingItem ? 'Playing ' + t.session.NowPlayingItem.Name : 'Ready')
                        + (t.session.UserName ? ' · signed in as ' + t.session.UserName : '') + (t.session.Client ? ' · ' + t.session.Client : '')
                    : 'Off – will be turned on, plays as the profile signed in there';
                html += '<button type="button" class="yeet-device" data-idx="' + idx + '"><span class="yeet-dot' + (t.session ? ' on' : '') + '"></span>'
                    + '<span>' + esc(t.name) + '<small>' + esc(hint) + '</small></span></button>';
            });

            if (queue.resumeTicks > 0) {
                html += '<label class="yeet-resume"><input type="checkbox" data-el="resume" checked><span>Resume from ' + esc(ticksToText(queue.resumeTicks)) + '</span></label>';
            }

            dlg.innerHTML = html + closeButton('Cancel');
            wireClose();

            var sourceSel = dlg.querySelector('[data-el="source"]');
            var audioSel = dlg.querySelector('[data-el="audio"]');
            var subsSel = dlg.querySelector('[data-el="subs"]');

            function currentSource() {
                return sources.filter(function (src) { return src.Id === sourceSel.value; })[0] || sources[0];
            }

            function fillStreams() {
                var src = currentSource();
                var audio = streamsOf(src, 'Audio');
                var subs = streamsOf(src, 'Subtitle');

                audioSel.innerHTML = audio.map(function (st) {
                    return '<option value="' + st.Index + '">' + esc(streamLabel(st)) + '</option>';
                }).join('');
                selectValue(audioSel, src.DefaultAudioStreamIndex);
                dlg.querySelector('[data-el="audio-row"]').hidden = audio.length < 2;

                subsSel.innerHTML = '<option value="">Device default</option><option value="-1">Off</option>' + subs.map(function (st) {
                    return '<option value="' + st.Index + '">' + esc(streamLabel(st)) + '</option>';
                }).join('');
                dlg.querySelector('[data-el="subs-row"]').hidden = !subs.length;
            }

            if (sourceSel) {
                dlg.querySelector('[data-el="source-row"]').hidden = sources.length < 2;
                selectValue(sourceSel, pageValue(item.Id, 'selectSource'));
                fillStreams();
                selectValue(audioSel, pageValue(item.Id, 'selectAudio'));
                selectValue(subsSel, pageValue(item.Id, 'selectSubtitles'));
                sourceSel.addEventListener('change', fillStreams);
            }

            function choice() {
                var c = {};
                if (!sourceSel) {
                    return c;
                }
                if (sources.length > 1) {
                    c.mediaSourceId = sourceSel.value;
                }
                if (audioSel.options.length > 1) {
                    c.audioStreamIndex = audioSel.value;
                }
                if (subsSel.value !== '') {
                    c.subtitleStreamIndex = subsSel.value;
                }
                return c;
            }

            dlg.querySelectorAll('.yeet-device').forEach(function (b) {
                b.addEventListener('click', function () {
                    var chk = dlg.querySelector('[data-el="resume"]');
                    send(targets[Number(b.getAttribute('data-idx'))], queue, !!(chk && chk.checked), choice());
                });
            });
        }

        dlg.innerHTML = '<h2>Yeet to device</h2><div class="yeet-status"><div class="yeet-spin"></div><div>Looking for devices…</div></div>' + closeButton('Cancel');
        wireClose();

        var mine = run;
        var uid = client().getCurrentUserId();
        Promise.all([
            getJson('Items/' + itemId, { userId: uid }).then(function (item) {
                return resolveQueue(item).then(function (queue) { return { item: item, queue: queue }; });
            }),
            getJson('Yeet/Devices').catch(function () { return []; }),
            getSessions().catch(function () { return []; })
        ]).then(function (r) {
            if (mine !== run) {
                return;
            }
            if (!r[0].queue.ids.length) {
                showMessage('Yeet to device', 'There is nothing to play in this item.');
                return;
            }
            var targets = buildTargets(r[1] || [], r[2]);
            if (!targets.length) {
                showMessage('Yeet to device', 'No devices are available. Open Jellyfin on the device, or ask an administrator to add it in Dashboard → Plugins → YEET.');
                return;
            }
            showPicker(r[0].item, r[0].queue, targets);
        }).catch(function () {
            if (mine === run) {
                showMessage('Yeet to device', 'Couldn\'t load this item.');
            }
        });
    }
})();
