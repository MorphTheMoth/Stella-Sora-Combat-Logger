// ─── Enum maps ────────────────────
const damageSourceNames = { 1:'Player',2:'Monster',3:'Trap',4:'Perk',5:'Fatecard' };
const damageTypeNames = { 0:'None',1:'Auto Attack',2:'Skill',3:'Ultimate',4:'Other',5:'Mark',6:'Projectile',7:'Minion' };
const elementTypeNames = { 1:'Aqua',2:'Ignis',3:'Terra',4:'Ventus',5:'Lux',6:'Umbra' };
function dsName(v){ return v!=null ? (damageSourceNames[v]||v+' (?)') : ''; }
function dtName(v){ return v!=null ? (damageTypeNames[v]||v+' (?)') : ''; }
function elName(v){ return v!=null ? (elementTypeNames[v]||v+' (?)') : ''; }
function htName(v){ return v==1?'Actor':v==2?'Weapon':v==5?'Area':'Unknown'; }
function cleanOwner(s){ return s ? s.replace(/^\[|\]$/g,'') : '?'; }

// Player-hit predicate: Source Type 1 = 'Player' (damageSourceNames above).
// Shared by the Analytics fallback, getCalcHits and the Dmg Calc char list.
function isPlayerHit(ev) {
    return ev.Type === 'Hit' && (ev.HitConfig || {}).sourceType === 1;
}

// Hit header suffix " - <skillTitle> (#<hitNum>)" — shared by the Log and Dmg
// Calc event headers and the Dmg Calc search haystack. Pass escFn (esc) when
// the string goes into HTML.
function hitSkillStr(hc, escFn) {
    const skillPart = (hc && hc.skillTitle) ? (escFn ? escFn(hc.skillTitle) : hc.skillTitle) : '';
    const hitPart = hc && hc.hitNum != null ? ` (#${hc.hitNum})` : '';
    return (skillPart || hitPart) ? ` - ${skillPart}${hitPart}` : '';
}

// Rebuild a filter <select>'s options. keepVal is restored when still present;
// a vanished value falls back to the empty option unless keepVanished re-appends
// it (so the filter can't get stuck on an invisible entry). format/sortFn/max
// control labels; a truncated label gets the full text as title.
function fillSelectOptions(sel, values, opts) {
    const o = opts || {};
    const max = o.max;
    const keep = o.keepVal != null ? String(o.keepVal) : '';
    sel.innerHTML = `<option value="">${o.emptyLabel || 'All'}</option>`;
    const addOption = (v, label) => {
        const disp = (max != null && label.length > max) ? label.slice(0, max) + '…' : label;
        const el = document.createElement('option');
        el.value = String(v);
        el.textContent = disp;
        if (max != null) el.title = label;
        sel.appendChild(el);
    };
    [...values].sort(o.sortFn || undefined).forEach(v => addOption(v, o.format ? o.format(v) : String(v)));
    if (o.keepVanished && keep && ![...sel.options].some(el => el.value === keep)) {
        addOption(keep, o.format ? o.format(keep) : keep);
    }
    sel.value = keep && [...sel.options].some(el => el.value === keep) ? keep : '';
}

function parseTimeToMs(t) {
    if (!t) return 0;
    const m = t.match(/(\d+):(\d+)\.(\d+)/);
    if (!m) return 0;
    return parseInt(m[1]) * 60000 + parseInt(m[2]) * 1000 + parseInt(m[3]);
}

// ─── Shared state ─────────────────
let allEvents = [];
let filtered = [];

// Level map: configId → { lt: levelTypeData, ld: levelData, vc: [{l, v}] }
let levelMap = new Map();

const POLL_MS = 50;
let autoClearOnRestart = localStorage.getItem('autoClearOnRestart') === 'true';
document.getElementById('autoClearBtn')?.classList.toggle('active', autoClearOnRestart);
window.toggleAutoClear = function() {
    autoClearOnRestart = !autoClearOnRestart;
    localStorage.setItem('autoClearOnRestart', autoClearOnRestart);
    document.getElementById('autoClearBtn').classList.toggle('active', autoClearOnRestart);
};

let currentSavedLog = null;
let lastFetchCount = 0;
let currentLogName = 'Live'; // display name for the log currently being served
let pendingAutoClear = false;
let serverTotal = Infinity; // server's total logical line count (from meta frames); Infinity = unknown yet
let backlogDone = false;    // true once the initial backlog has been fully received

// ─── Level map ────────────────────
// Entry kinds: effect entries (id → {lt, ld, vc:[{l,v}]} level ladder) and hit
// entries ("t":"hit", id = hitDamageId → {lt, ld, sp/sa/tp/ta/ap/pi} per-level
// value arrays written by the DLL's WriteHitDamageLevelMapEntry).
async function fetchLevelMap(savedLogName) {
    try {
        let url = '/api/levelmap';
        if (savedLogName) url += '?savedlog=' + encodeURIComponent(savedLogName);
        const res = await fetch(url, { cache: 'no-cache' });
        const data = await res.json();
        levelMap.clear();
        for (const entry of (data.entries || [])) {
            if (entry.t === 'hit') {
                levelMap.set(entry.id, {
                    t: 'hit',
                    lt: entry.lt || 0,
                    ld: entry.ld || 0,
                    sp: entry.sp || [],
                    sa: entry.sa || [],
                    tp: entry.tp || [],
                    ta: entry.ta || [],
                    ap: entry.ap || [],
                    pi: entry.pi || []
                });
                continue;
            }
            levelMap.set(entry.id, {
                lt: entry.lt || 0,
                ld: entry.ld || 0,
                vc: (entry.vc || []).map(v => ({ l: v.l, v: v.v }))
            });
        }
    } catch (e) {
        console.error('Failed to fetch level map', e);
    }
}

// ─── Saved Logs ───────────────────
async function loadSavedLogsList() {
    try {
        const res = await fetch('/savedlogslist');
        const data = await res.json();
        const logs = data.logs.sort() || [];
        const sel = document.getElementById('savedLogFilter');
        while (sel.options.length > 1) sel.remove(1);
        logs.forEach(name => {
            const o = document.createElement('option');
            o.value = name;
            o.textContent = name;
            sel.appendChild(o);
        });
    } catch(e) {
        console.error('Failed to load saved logs list', e);
    }
}

// Wipe client-side log state (used by saved-log switch, clear, cut, resync).
// This is the single invalidating path — every wipe (saved-log switch, clear,
// cut, server-truncation resync) funnels through here, so the filter state,
// search and Effect Impact toggles always reset with the log instead of
// leaking stale values into the next one.
function resetClientState() {
    // Record + dmg-calc sim state belong to the opened log — drop them so a
    // previously opened log's record never survives a swap (the Origin event
    // of the new log repopulates everything it carries on reparse).
    if (typeof resetRecordState === 'function') resetRecordState();
    // Dmg Calc sidebar simulation toggles (char/disc/quick toggles, field
    // bonuses) also belong to the opened log.
    if (typeof dcResetUiState === 'function') dcResetUiState();
    // Shared filter state + selects + search + EI toggles (filterCore.js).
    if (typeof fcResetFilters === 'function') fcResetFilters();
    allEvents = [];
    filtered = [];
    if (window.logVL) {
        window.logVL.reset();
        window.logVL.setFiltered(filtered);
    }
    foldedCount = 0;
    lastFetchCount = 0;
    backlogDone = false;
    closeSearch();
}

window.onSavedLogChange = async function() {
    pendingAutoClear = false;
    const val = document.getElementById('savedLogFilter').value;
    currentSavedLog = val || null;
    currentLogName = currentSavedLog || 'Live';
    stopLiveUpdates();

    resetClientState();
    refilterAndRender(true, true);
    await fetchLevelMap(currentSavedLog);
    startLiveUpdates();
};

// ─── Save / Clear / Fetch ─────────────────
window.saveLog = async function() {
    pendingAutoClear = false;
    const name = prompt("Enter a name for this saved log:");
    if (!name || !name.trim()) return;

    try {
        const res = await fetch('/savelog', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name.trim() })
        });
        const data = await res.json();

        if (!res.ok || !data.ok) {
            alert('Save failed: ' + (data.error || 'Unknown error'));
            return;
        }

        await loadSavedLogsList();

        const sel = document.getElementById('savedLogFilter');
        sel.value = name.trim();
        sel.dispatchEvent(new Event('change'));
        await onSavedLogChange();

    } catch (err) {
        console.error('Save log error', err);
        alert('Error saving log');
    }
};

window.clearLog = async function(skipConfirm) {
    if (!skipConfirm && !confirm('Are you sure you want to clear the log?')) return;
    try {
        let url = '/clear';
        if (currentSavedLog)
            url += '?savedlog=' + encodeURIComponent(currentSavedLog);
        const res = await fetch(url, { method: 'POST' });
        const data = await res.json();
        if (data.ok) {
            stopLiveUpdates();
            resetClientState();
            refilterAndRender(true, true);
            if (currentSavedLog) {
                loadSavedLogsList();
                currentSavedLog = null;
                currentLogName = 'Live';
            }
            startLiveUpdates();
        } else {
            alert('Clear failed');
        }
    } catch(e) {
        console.error(e);
        alert('Error clearing log');
    }
};

window.lastRun = async function() {
    const resetIndices = [];
    for (let i = 0; i < allEvents.length; i++) {
        if (allEvents[i].Type === 'Reset') {
            resetIndices.push(i);
        }
    }

    if (resetIndices.length === 0) {
        alert('No reset event found');
        return;
    }

    const lastReset = resetIndices[resetIndices.length - 1];
    let cutIdx;

    if (lastReset < allEvents.length - 1) {
        cutIdx = lastReset;
    } else {
        if (resetIndices.length < 2) {
            alert('No previous reset event to cut at');
            return;
        }
        cutIdx = resetIndices[resetIndices.length - 2];
    }

    const origIndex = allEvents[cutIdx]._origIndex;

    try {
        const res = await fetch('/cutlog?offset=' + origIndex, { method: 'POST' });
        const data = await res.json();
        if (data.ok) {
            stopLiveUpdates();
            resetClientState();
            refilterAndRender(true, true);
            startLiveUpdates();
        } else {
            alert('Cut failed: ' + (data.error || 'Unknown error'));
        }
    } catch (e) {
        console.error(e);
        alert('Error cutting log');
    }
};

let _fetching = false;
let _levelMapPollCount = 0;
let _es = null;
let _esFallbackTimer = null;
const LEVELMAP_POLL_INTERVAL = 40; // re-fetch every POLL_MS * 40 ≈ 2s (50ms tick)
const SSE_FALLBACK_MS = 4000;       // if SSE never opens, one-shot fetchLog fallback

// ─── SSE live updates ───────────────────────────────────────────────────────
function stopLiveUpdates() {
    if (_es) { try { _es.close(); } catch (e) {} _es = null; }
    if (_esFallbackTimer) { clearTimeout(_esFallbackTimer); _esFallbackTimer = null; }
}

function startLiveUpdates() {
    if (location.protocol === 'file:') return;
    stopLiveUpdates();

    // A fresh connection (after=0) starts in "initial backlog" mode until the
    // first meta frame reports a total and we've caught up to it; reconnects
    // (after>0) just continue incrementally.
    backlogDone = lastFetchCount > 0;
    serverTotal = Infinity;

    const params = ['after=' + lastFetchCount];
    if (currentSavedLog) params.push('savedlog=' + encodeURIComponent(currentSavedLog));
    const newEs = new EventSource('/events?' + params.join('&'));
    _es = newEs;

    const dot = document.getElementById('liveDot');
    newEs.onopen = () => {
        if (newEs !== _es) return;
        if (dot) { dot.style.background = '#4a8a4a'; dot.title = 'live'; }
        if (_esFallbackTimer) { clearTimeout(_esFallbackTimer); _esFallbackTimer = null; }
    };
    // Raw log-line batches. Each message is one frame of raw NDJSON lines; the
    // initial backlog arrives as several such frames streamed progressively.
    newEs.addEventListener('log', e => {
        if (newEs !== _es) return;
        if (!e.data) return;
        try {
            const { events, count } = parseRawBatch(e.data);
            handleRawBatch(events, count);
        } catch (err) { console.error('SSE parse error', err); }
    });
    // Metadata (server's total logical line count) — used to detect a
    // truncated/cleared server log and to track the end of the initial backlog.
    newEs.addEventListener('meta', e => {
        if (newEs !== _es) return;
        if (!e.data) return;
        try { handleMeta(JSON.parse(e.data)); }
        catch (err) { console.error('SSE meta parse error', err); }
    });
    newEs.onerror = () => {
        if (newEs !== _es) return;
        if (dot) { dot.style.background = '#6a3a3a'; dot.title = 'disconnected'; }
        try { newEs.close(); } catch (e) {}
        if (newEs === _es) _es = null;
        setTimeout(() => {
            if (newEs === _es) startLiveUpdates();
        }, 3000);
    };

    // If SSE never opens within a few seconds, do a one-shot fetchLog as fallback
    // so the page isn't blank if the server doesn't support SSE.
    if (lastFetchCount === 0) {
        _esFallbackTimer = setTimeout(() => {
            if (allEvents.length === 0) fetchLog(false);
        }, SSE_FALLBACK_MS);
    }
}

function appendEvents(events) {
    const startIdx = allEvents.length;
    for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        ev._origIndex = startIdx + i;
        enrichEvent(ev);
        allEvents.push(ev);
    }
}

// Splits a raw NDJSON batch (newline-joined lines, as sent by the server) into
// events. `count` is the number of logical lines (non-empty, not starting with
// '=') — this matches the server's line-offset accounting exactly, so the
// client's position stays aligned with the server's `after` offsets even when a
// malformed line is skipped.
function parseRawBatch(text) {
    const events = [];
    let count = 0;
    if (!text) return { events, count };
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line || line[0] === '=') continue;
        count++;
        try { events.push(JSON.parse(line)); }
        catch (e) { /* skip malformed line; still counted for offsets */ }
    }
    return { events, count };
}

function handleMeta(data) {
    const t = data && data.total;
    if (t == null) return;
    serverTotal = t;
    if (!backlogDone && t === lastFetchCount) {
        backlogDone = true;
        if (typeof updateStats === 'function') updateStats();
    }
    if (t < lastFetchCount) {
        // The server log was truncated/cleared externally — resync from scratch.
        resetClientState();
        lastFetchCount = 0;
        stopLiveUpdates();
        startLiveUpdates();
    }
}

function handleRawBatch(events, count) {
    const newEvents = events || [];
    const nextAfter = lastFetchCount + count;

    if (lastFetchCount === 0) {
        // Initial load (fresh page load or post-truncation resync): full render.
        if (allEvents.length > 0) resetClientState();
        if (newEvents.length > 0) {
            appendEvents(newEvents);
            filteredDirty = true;
            pendingResetOpen = true;
            scheduleLogRefresh();
        }
    } else if (newEvents.length > 0) {
        // Subsequent backlog frames and live updates: incremental fold.
        appendEvents(newEvents);
        // Auto-clear only applies to events arriving after the initial backlog
        // has been fully delivered (matches the pre-batching single-message
        // behavior, where the whole backlog arrived as one initial load).
        if (backlogDone) {
            if (autoClearOnRestart && !currentSavedLog && newEvents.some(e => e.Type === 'Reset')) {
                pendingAutoClear = true;
            } else if (pendingAutoClear && newEvents.length > 0) {
                pendingAutoClear = false;
                window.clearLog(true);
                return;
            }
        }
        scheduleLogRefresh();
    }
    lastFetchCount = nextAfter;
    if (!backlogDone && serverTotal !== Infinity && lastFetchCount >= serverTotal)
        backlogDone = true;
    if (window.dcRefreshIfVisible) window.dcRefreshIfVisible();
}

// One-shot fetchLog kept for the SSE fallback path; the batch handling is
// shared with the SSE path via handleRawBatch.
async function fetchLog(incremental = false) {
    if (_fetching) return;
    _fetching = true;
    try {
        let url = '/api/log';
        const params = [];
        if (currentSavedLog)
            params.push('savedlog=' + encodeURIComponent(currentSavedLog));
        if (incremental && lastFetchCount > 0)
            params.push('after=' + lastFetchCount);
        params.push('_=' + Date.now());

        url += '?' + params.join('&');

        const t = allEvents.length;
        const res = await fetch(url, { cache: 'no-cache' });
        const text = await res.text();
        if (allEvents.length != t) return; // another append raced the fetch

        const { events, count } = parseRawBatch(text);
        // Same initial-load vs incremental branching as the SSE path
        // (handleRawBatch keys off lastFetchCount, which is 0 until the
        // first batch is consumed — matching fetchLog's old split).
        handleRawBatch(events, count);
        if (!incremental) backlogDone = true;
    } catch (err) {
        console.error('fetch error', err);
    } finally {
        _fetching = false;
    }
}

// ─── Level map cadence ─────────────────────────────────────────────────────
function pollLevelMap() {
    _levelMapPollCount++;
    if (!currentSavedLog && _levelMapPollCount >= LEVELMAP_POLL_INTERVAL) {
        _levelMapPollCount = 0;
        fetchLevelMap(null);
    }
}

initTables().then(() => {
    fetchLevelMap(currentSavedLog);
    startLiveUpdates();
    if (typeof updateStats === 'function') updateStats();
    setInterval(pollLevelMap, POLL_MS);
    loadSavedLogsList();
});
