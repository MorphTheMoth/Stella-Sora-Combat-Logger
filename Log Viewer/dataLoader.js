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
let pendingAutoClear = false;

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

function buildFenwick() {
    const spacer = document.getElementById('scrollSpacer');
    fenwick = new Fenwick(filtered.length);
    heights = new Array(filtered.length);
    let sum = 0;
    for (let i = 0; i < filtered.length; i++) {
        const orig = filtered[i]._origIndex;
        const eventH = (openStates[orig] && measuredHeights[orig]) ? measuredHeights[orig] : EST;
        const spacerH = spacerByOrig.get(orig) || 0;
        const h = eventH + spacerH;
        heights[i] = h;
        fenwick.add(i, h);
        sum += h;
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

window.onSavedLogChange = async function() {
    pendingAutoClear = false;
    const val = document.getElementById('savedLogFilter').value;
    currentSavedLog = val || null;
    allEvents = [];
    filtered = [];
    lastFetchCount = 0;
    _emptyPollCount = 0;
    openStates = {};
    measuredHeights = {};
    subOpenStates = {};
    spacerByOrig.clear();
    document.getElementById('scrollContent').innerHTML = '';
    closeSearch();
    refilterAndRender(true, true);
    await fetchLevelMap(currentSavedLog);
    fetchLog(false).then(() => { setTimeout(poll, POLL_MS); });
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
            allEvents = [];
            filtered = [];
            lastFetchCount = 0;
            openStates = {};
            measuredHeights = {};
            subOpenStates = {};
            spacerByOrig.clear();
            refilterAndRender(true, true);
            closeSearch();
            if (currentSavedLog) {
                loadSavedLogsList();
                currentSavedLog = null;
            }
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
            allEvents = [];
            filtered = [];
            lastFetchCount = 0;
            _emptyPollCount = 0;
            openStates = {};
            measuredHeights = {};
            subOpenStates = {};
            spacerByOrig.clear();
            document.getElementById('scrollContent').innerHTML = '';
            closeSearch();
            refilterAndRender(true, true);
            fetchLog(false).then(() => { setTimeout(poll, POLL_MS); });
        } else {
            alert('Cut failed: ' + (data.error || 'Unknown error'));
        }
    } catch (e) {
        console.error(e);
        alert('Error cutting log');
    }
};

let _fetching = false;
let _emptyPollCount = 0;
let _levelMapPollCount = 0;
const LEVELMAP_POLL_INTERVAL = 40; // re-fetch every ~2s (40 * 50ms)
const MAX_EMPTY_POLLS = 10;
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
        const data = await res.json();
        if (allEvents.length != t) {
            console.log("Event count mismatch after fetching, dropping new events");
            return;
        }

        const newEvents = data.events || [];
        const nextAfter = data.nextAfter != null ? data.nextAfter : (incremental ? lastFetchCount + newEvents.length : newEvents.length);
        if (incremental && lastFetchCount > 0) {
            if (newEvents.length > 0) {
                _emptyPollCount = 0;
                const startIdx = allEvents.length;
                newEvents.forEach((ev, i) => {
                    ev._origIndex = startIdx + i;
                    enrichEvent(ev);
                    allEvents.push(ev);
                });
                if (autoClearOnRestart && !currentSavedLog && newEvents.some(e => e.Type === 'Reset')) {
                    pendingAutoClear = true;
                } else if (pendingAutoClear && newEvents.length > 0) {
                    pendingAutoClear = false;
                    window.clearLog(true);
                    return;
                }
                refilterAndRender(false, false);
            } else {
                _emptyPollCount++;
            }
            lastFetchCount = nextAfter;
        } else {
            _emptyPollCount = 0;
            allEvents = newEvents;
            allEvents.forEach((ev, i) => { ev._origIndex = i; enrichEvent(ev); });
            lastFetchCount = nextAfter;
            refilterAndRender(true, true);
        }
        if (window.dcRefreshIfVisible) window.dcRefreshIfVisible();
        buildCharFilter();
        buildDefenderFilter();
    } catch (err) {
        console.error('fetch error', err);
    } finally {
        _fetching = false;
    }
}

function poll() {
    if (currentSavedLog && _emptyPollCount >= MAX_EMPTY_POLLS) {
        console.log('Poll stopped — saved log fully loaded');
        return;
    }
    _levelMapPollCount++;
    if (!currentSavedLog && _levelMapPollCount >= LEVELMAP_POLL_INTERVAL) {
        _levelMapPollCount = 0;
        fetchLevelMap(null);
    }
    fetchLog(true).finally(() => {
        setTimeout(poll, POLL_MS);
    });
}

initTables().then(() => {
    fetchLevelMap(null).then(() => {
        fetchLog(false).then(() => { setTimeout(poll, POLL_MS); });
    });
    loadSavedLogsList();
});
