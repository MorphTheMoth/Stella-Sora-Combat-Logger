// ─── Enum maps ────────────────────
const damageSourceNames = { 1:'Player',2:'Monster',3:'Trap',4:'Perk',5:'Fatecard' };
const damageTypeNames = { 0:'None',1:'Auto Attack',2:'Skill',3:'Ultimate',4:'Other',5:'Mark',6:'Projectile',7:'Minion' };
const elementTypeNames = { 1:'Aqua',2:'Ignis',3:'Terra',4:'Ventus',5:'Lux',6:'Umbra' };
function dsName(v){ return v!=null ? (damageSourceNames[v]||v+' (?)') : ''; }
function dtName(v){ return v!=null ? (damageTypeNames[v]||v+' (?)') : ''; }
function elName(v){ return v!=null ? (elementTypeNames[v]||v+' (?)') : ''; }
function htName(v){ return v==1?'Actor':v==2?'Weapon':v==5?'Area':'Unknown'; }
function cleanOwner(s){ return s ? s.replace(/^\[|\]$/g,'') : '?'; }
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

const EST = 40;
const BUFFER = 20;
const POLL_MS = 50;
let autoClearOnRestart = localStorage.getItem('autoClearOnRestart') === 'true';
document.getElementById('autoClearBtn')?.classList.toggle('active', autoClearOnRestart);
window.toggleAutoClear = function() {
    autoClearOnRestart = !autoClearOnRestart;
    localStorage.setItem('autoClearOnRestart', autoClearOnRestart);
    document.getElementById('autoClearBtn').classList.toggle('active', autoClearOnRestart);
};

let openStates = {};
let measuredHeights = {};
let subOpenStates = {};
let heights = [];
let fenwick = null;
let totalHeightCached = 0;
let lastFetchCount = 0;
let currentSavedLog = null;
let currentLogName = 'Live'; // display name for the log currently being served
let pendingAutoClear = false;
let serverTotal = Infinity; // server's total logical line count (from meta frames); Infinity = unknown yet
let backlogDone = false;    // true once the initial backlog has been fully received

// ─── Level map ────────────────────
async function fetchLevelMap(savedLogName) {
    try {
        let url = '/api/levelmap';
        if (savedLogName) url += '?savedlog=' + encodeURIComponent(savedLogName);
        const res = await fetch(url, { cache: 'no-cache' });
        const data = await res.json();
        levelMap.clear();
        for (const entry of (data.entries || [])) {
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

// ─── Fenwick tree ─────────────────
class Fenwick {
    constructor(size) {
        this.size = size;
        this.tree = new Array(size + 1).fill(0);
    }
    add(idx, delta) {
        if (idx < 0 || idx >= this.size) return;
        for (let i = idx + 1; i <= this.size; i += i & -i) {
            this.tree[i] += delta;
        }
    }
    prefixSum(idx) {
        if (idx < 0) return 0;
        if (idx >= this.size) idx = this.size - 1;
        let sum = 0;
        for (let i = idx + 1; i > 0; i -= i & -i) {
            sum += this.tree[i];
        }
        return sum;
    }
}

function buildFenwick(minCapacity) {
    const spacer = document.getElementById('scrollSpacer');
    // Capacity grows geometrically (via minCapacity from the fold path) so
    // appends are amortized O(1); a Fenwick can't be "grown by copy" once it
    // has pending adds, so growth is always a full rebuild from `heights`.
    const capacity = Math.max(minCapacity || 0, allEvents.length, 1);
    fenwick = new Fenwick(capacity);
    heights = new Array(filtered.length);
    let sum = 0;
    for (let i = 0; i < filtered.length; i++) {
        const orig = filtered[i]._origIndex;
        const eventH = (openStates[orig] && measuredHeights[orig]) ? measuredHeights[orig] : EST;
        const spacerH = spacerByOrig.get(orig) || 0;
        const h = eventH + spacerH;
        heights[i] = h;
        fenwick.tree[i + 1] = h;
        sum += h;
    }
    // O(n) build: propagate children into parents across the full capacity so
    // that cells beyond `filtered.length` are consistent for later appends.
    for (let i = 1; i <= fenwick.size; i++) {
        const p = i + (i & -i);
        if (p <= fenwick.size) fenwick.tree[p] += fenwick.tree[i];
    }
    totalHeightCached = sum;
    spacer.style.height = totalHeightCached + 'px';
}

function updateHeightAtIndex(idx, newEventHeight) {
    const spacer = document.getElementById('scrollSpacer');
    const orig = filtered[idx]._origIndex;
    const spacerH = spacerByOrig.get(orig) || 0;
    const newTotal = newEventHeight + spacerH;
    const old = heights[idx];
    if (Math.abs(old - newTotal) < 0.5) return 0;
    heights[idx] = newTotal;
    const delta = newTotal - old;
    fenwick.add(idx, delta);
    totalHeightCached += delta;
    spacer.style.height = totalHeightCached + 'px';
    return delta;
}

function findIndexForOffset(target) {
    if (filtered.length === 0) return 0;
    const clamped = Math.max(0, Math.min(target, totalHeightCached));
    if (clamped <= 0) return 0;
    if (clamped >= totalHeightCached) return filtered.length - 1;

    let lo = 0, hi = filtered.length - 1, ans = 0;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (fenwick.prefixSum(mid) >= clamped) {
            ans = mid;
            hi = mid - 1;
        } else {
            lo = mid + 1;
        }
    }
    return ans;
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
function resetClientState() {
    allEvents = [];
    filtered = [];
    foldedCount = 0;
    lastFetchCount = 0;
    backlogDone = false;
    openStates = {};
    measuredHeights = {};
    subOpenStates = {};
    spacerByOrig.clear();
    document.getElementById('scrollContent').innerHTML = '';
    closeSearch();
}

window.onSavedLogChange = async function() {
    pendingAutoClear = false;
    const val = document.getElementById('savedLogFilter').value;
    currentSavedLog = val || null;
    currentLogName = currentSavedLog || 'Live';
    stopLiveUpdates();

    reenableDefenderAuto();
    resetFilters();
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
const LEVELMAP_POLL_INTERVAL = 40; // re-fetch every ~2s (40 * 50ms)
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
        console.log('Server log truncated (total ' + t + ' < ' + lastFetchCount + '), resyncing');
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

// One-shot fetchLog kept for the SSE fallback path.
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
        if (allEvents.length != t) {
            console.log("Event count mismatch after fetching, dropping new events");
            return;
        }

        const { events, count } = parseRawBatch(text);
        const nextAfter = incremental ? lastFetchCount + count : count;
        if (events.length > 0) {
            if (incremental && lastFetchCount > 0) {
                appendEvents(events);
                if (autoClearOnRestart && !currentSavedLog && events.some(e => e.Type === 'Reset')) {
                    pendingAutoClear = true;
                } else if (pendingAutoClear && events.length > 0) {
                    pendingAutoClear = false;
                    window.clearLog(true);
                    return;
                }
            } else {
                if (allEvents.length > 0) resetClientState();
                appendEvents(events);
                filteredDirty = true;
                pendingResetOpen = true;
            }
            scheduleLogRefresh();
        }
        lastFetchCount = nextAfter;
        if (!incremental) backlogDone = true;
        if (window.dcRefreshIfVisible) window.dcRefreshIfVisible();
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
    setInterval(pollLevelMap, 50);
    loadSavedLogsList();
});
