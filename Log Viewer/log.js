// ─── Helpers ──────────────────────
function esc(s) {
    const m = { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' };
    return String(s).replace(/[&<>"']/g, c => m[c]);
}

function effType(ev) {
    if (ev._effType === undefined)
        ev._effType = (ev.Type === 'Buff' && ev.SubType === 'Effect') ? 'Effect' : ev.Type;
    return ev._effType;
}

// Derived fields are computed once per event and cached on it, so the filter
// passes never re-derive string ops / allocate Sets for every event per pass.
function getChars(ev) {
    if (ev._chars !== undefined) return ev._chars;
    const s = [];
    if (ev.Type==='Hit') { if(ev.AttackerDisplay) s.push(ev.AttackerDisplay); }
    else if (ev.Type==='Buff') {
        if(ev.OwnerDisplay||ev.Owner) s.push(cleanOwner(ev.OwnerDisplay||ev.Owner));
        if(ev.SourceDisplay||ev.Source) s.push(cleanOwner(ev.SourceDisplay||ev.Source));
    } else if (ev.Type==='Skill Cast') { if(ev.Owner) s.push(ev.Owner); }
    ev._chars = s;
    return s;
}
function getSkillName(ev) {
    if (ev._skillName !== undefined) return ev._skillName;
    let n = null;
    if (ev.Type==='Hit') n = (ev.HitConfig||{}).skillTitle||null;
    else if (ev.Type==='Buff') n = ev.Name||null;
    else if (ev.Type==='Skill Cast') n = ev.Name||null;
    ev._skillName = n;
    return n;
}
function getDefender(ev) {
    if (ev._defenders !== undefined) return ev._defenders;
    let d = [];
    if (ev.Type === 'Hit') {
        const name = ev.DefenderDisplay || ev.Defender;
        if (name) d = [cleanOwner(name)];
    }
    ev._defenders = d;
    return d;
}

// ─── Filter state ─────────────────
let typeFilter = new Set(['Hit', 'Skill Cast']);
let charFilter = '', skillFilter = '', damageTypeFilter = '', defenderFilter = '';
let filteredDirty = false;
let pendingResetOpen = false;
let refreshTimer = null;
// Number of allEvents entries already folded through the filter pipeline.
let foldedCount = 0;

// Cached option sets for the sidebar dropdowns (grown incrementally while
// live events stream in, recomputed wholesale when the filters change).
const charOptionsSet = new Set();
const skillOptionsSet = new Set();
const dmgTypeOptionsSet = new Set();
const defenderCounts = new Map();
let defenderCountsComputed = false;
const selectBuiltSizes = { char: -1, skill: -1, dmgtype: -1, defender: -1 };

function valueInSet(set, val) {
    if (val === undefined || val === null || val === '') return false;
    for (const v of set) if (String(v) === String(val)) return true;
    return false;
}

function rebuildSelect(selId, builtKey, opts) {
    const { set, emptyLabel, format, sortFn, MAX, currentVal } = opts;
    if (set.size === selectBuiltSizes[builtKey]) {
        const sel = document.getElementById(selId);
        if (sel && !valueInSet(set, sel.value)) sel.value = '';
        return;
    }
    selectBuiltSizes[builtKey] = set.size;
    const sel = document.getElementById(selId);
    if (!sel) return;
    let html = `<option value="">${emptyLabel}</option>`;
    const items = [...set].sort(sortFn);
    for (const v of items) {
        const text = String(format ? format(v) : v);
        const disp = text.length > MAX ? text.slice(0, MAX) + '…' : text;
        html += `<option value="${esc(String(v))}"${text.length > MAX ? ` title="${esc(text)}"` : ''}>${esc(disp)}</option>`;
    }
    sel.innerHTML = html;
    sel.value = valueInSet(set, currentVal) ? String(currentVal) : '';
}

function sortNumeric(a, b) { return Number(a) - Number(b); }

function refreshSelects(force) {
    if (force) {
        selectBuiltSizes.char = -1;
        selectBuiltSizes.skill = -1;
        selectBuiltSizes.dmgtype = -1;
        selectBuiltSizes.defender = -1;
    }
    rebuildSelect('charFilter', 'char', { set: charOptionsSet, emptyLabel: 'All Characters', MAX: 28, currentVal: charFilter });
    rebuildSelect('skillFilter', 'skill', { set: skillOptionsSet, emptyLabel: 'All Skills', MAX: 28, currentVal: skillFilter });
    rebuildSelect('damageTypeFilter', 'dmgtype', { set: dmgTypeOptionsSet, emptyLabel: 'All Damage Types', format: dtName, sortFn: sortNumeric, MAX: 28, currentVal: damageTypeFilter });
    rebuildSelect('defenderFilter', 'defender', { set: new Set(defenderCounts.keys()), emptyLabel: 'All Defenders', MAX: 28, currentVal: defenderFilter });
}

// ─── Filter predicates ──────────────────────
function matchesTypeChar(ev) {
    if (ev.Type === 'Reset') return true;
    if (typeFilter.size > 0 && !typeFilter.has(effType(ev))) return false;
    if (charFilter && !getChars(ev).includes(charFilter)) return false;
    return true;
}
function matchesSkill(ev) {
    if (ev.Type === 'Reset') return true;
    return !skillFilter || getSkillName(ev) === skillFilter;
}
function matchesDmgType(ev) {
    if (ev.Type === 'Reset') return true;
    if (!damageTypeFilter) return true;
    return !!(ev.HitConfig && ev.HitConfig.damageType != null && String(ev.HitConfig.damageType) === damageTypeFilter);
}
function matchesDefender(ev) {
    if (ev.Type === 'Reset') return true;
    if (!defenderFilter) return true;
    const d = getDefender(ev);
    return d.includes(defenderFilter) || d.length === 0;
}
function matchesFilter(ev) {
    return matchesTypeChar(ev) && matchesSkill(ev) && matchesDmgType(ev) && matchesDefender(ev);
}

function computeDefenderCounts() {
    defenderCounts.clear();
    for (let i = 0; i < allEvents.length; i++) {
        const d = getDefender(allEvents[i]);
        for (let k = 0; k < d.length; k++)
            defenderCounts.set(d[k], (defenderCounts.get(d[k]) || 0) + 1);
    }
    defenderCountsComputed = true;
}

// Auto-select the most-hit defender when the user has never chosen one
// (mirrors the old buildDefenderFilter() default). Returns true if selected.
function ensureDefenderAutoDefault() {
    if (defenderFilter !== '') return false;
    if (!defenderCountsComputed) computeDefenderCounts();
    let top = '', best = 0;
    for (const [d, c] of defenderCounts) { if (c > best) { best = c; top = d; } }
    if (!top) return false;
    defenderFilter = top;
    return true;
}

// Full filter recompute. Rebuilds the dropdown option sets from scratch,
// preserving the old applyFilters() ordering (skill options come from the
// type+char filtered list, damage-type options from the type+char+skill list).
function computeFilteredFull() {
    charOptionsSet.clear();
    dmgTypeOptionsSet.clear();
    defenderCounts.clear();
    defenderCountsComputed = true;
    const typeChar = [];
    for (let i = 0; i < allEvents.length; i++) {
        const ev = allEvents[i];
        const chars = getChars(ev);
        for (let k = 0; k < chars.length; k++) charOptionsSet.add(chars[k]);
        const defs = getDefender(ev);
        for (let k = 0; k < defs.length; k++) defenderCounts.set(defs[k], (defenderCounts.get(defs[k]) || 0) + 1);
        if (matchesTypeChar(ev)) typeChar.push(ev);
    }
    skillOptionsSet.clear();
    for (let i = 0; i < typeChar.length; i++) {
        const n = getSkillName(typeChar[i]);
        if (n) skillOptionsSet.add(n);
    }
    const out = [];
    for (let i = 0; i < typeChar.length; i++) {
        const ev = typeChar[i];
        if (!matchesSkill(ev)) continue;
        if (ev.Type === 'Hit' && ev.HitConfig && ev.HitConfig.damageType != null)
            dmgTypeOptionsSet.add(String(ev.HitConfig.damageType));
        if (matchesDmgType(ev) && matchesDefender(ev)) out.push(ev);
    }
    return out;
}

// ─── Search state ─────────────────
let searchQuery = '';
let searchMatches = [];
let searchMatchIdx = -1;

// ─── Spacer state ─────────────────
const SPACER_HEIGHT = 60;
const spacerByOrig = new Map();

const container = document.getElementById('scrollContainer');
const content = document.getElementById('scrollContent');

// ─── Filter / Rerender ──────────────────────
function updateStats() {
    document.getElementById('stats').textContent = `${filtered.length} / ${allEvents.length} events`;
}
function fixSearchIdx() {
    if (searchMatchIdx >= searchMatches.length) searchMatchIdx = searchMatches.length > 0 ? 0 : -1;
}

function refilterAndRender(resetScroll = false, resetOpen = true) {
    if (resetOpen) {
        openStates = {};
        measuredHeights = {};
        subOpenStates = {};
        content.innerHTML = '';
    }
    filtered = computeFilteredFull();
    foldedCount = allEvents.length;
    buildFenwick();
    buildSearchMatches();
    fixSearchIdx();
    updateSearchCount();
    updateStats();
    if (resetScroll || resetOpen) {
        container.scrollTop = 0;
    }
    refreshSelects(true);
    render();
}

// ─── Coalesced live updates ─────────────────
// Streaming SSE messages are folded into a single trailing-debounced pass so
// a burst of messages doesn't re-filter the whole log once per message.
function scheduleLogRefresh() {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
        refreshTimer = null;
        flushLogRefresh();
    }, 50);
}

function foldIncremental() {
    const start = foldedCount;
    if (start >= allEvents.length) { updateStats(); refreshSelects(false); return; }
    // A Fenwick can't be grown by copy after adds; grow geometrically via a full
    // rebuild from `heights` so appends stay amortized O(1). Rebuilds happen
    // before any of this batch's appends, so all adds use the new capacity.
    if (!fenwick || allEvents.length > fenwick.size)
        buildFenwick(fenwick ? Math.max(fenwick.size * 2, allEvents.length) : allEvents.length);
    const searchStartFi = filtered.length;
    for (let i = start; i < allEvents.length; i++) {
        const ev = allEvents[i];
        foldedCount = i + 1;
        const chars = getChars(ev);
        for (let k = 0; k < chars.length; k++) charOptionsSet.add(chars[k]);
        const defs = getDefender(ev);
        for (let k = 0; k < defs.length; k++) defenderCounts.set(defs[k], (defenderCounts.get(defs[k]) || 0) + 1);
        if (!matchesTypeChar(ev)) continue;
        const sn = getSkillName(ev);
        if (sn) skillOptionsSet.add(sn);
        if (!matchesSkill(ev)) continue;
        if (ev.Type === 'Hit' && ev.HitConfig && ev.HitConfig.damageType != null)
            dmgTypeOptionsSet.add(String(ev.HitConfig.damageType));
        if (!matchesDmgType(ev) || !matchesDefender(ev)) continue;
        const fi = filtered.length;
        filtered.push(ev);
        const orig = ev._origIndex;
        const eventH = (openStates[orig] && measuredHeights[orig]) ? measuredHeights[orig] : EST;
        const spacerH = spacerByOrig.get(orig) || 0;
        const h = eventH + spacerH;
        heights.push(h);
        totalHeightCached += h;
        fenwick.add(fi, h);
    }
    document.getElementById('scrollSpacer').style.height = totalHeightCached + 'px';
    if (searchQuery) {
        const q = normalizeSearch(searchQuery.toLowerCase());
        for (let fi = searchStartFi; fi < filtered.length; fi++) {
            if (normalizeSearch(getEventSearchText(filtered[fi])).includes(q)) {
                searchMatches.push(fi);
            }
        }
        fixSearchIdx();
        updateSearchCount();
    }
    updateStats();
    refreshSelects(false);
    render();
}

function flushLogRefresh() {
    const resetOpen = pendingResetOpen;
    pendingResetOpen = false;
    if (resetOpen) filteredDirty = true;
    if (ensureDefenderAutoDefault()) filteredDirty = true;
    if (filteredDirty) {
        filteredDirty = false;
        refilterAndRender(resetOpen, resetOpen);
    } else {
        foldIncremental();
        if (activeTab === 'analytics' && typeof Analytics !== 'undefined') Analytics.refresh();
    }
    // The auto defender default can only be picked once counts exist. If the
    // pass above just populated them and the user still hasn't picked one,
    // select the top defender now and re-filter once more.
    if (ensureDefenderAutoDefault()) {
        refilterAndRender(false, false);
    }
}

// ─── Body builders ──────────────────────────
function buildEventBody(ev) {
    const oi = ev._origIndex;
    if (ev.Type === 'Hit') return hitBody(ev, oi);
    if (ev.Type === 'Buff') return buffBody(ev);
    if (ev.Type === 'Skill Cast') return skillBody(ev);
    if (ev.Type === 'Reset') return '<div class="section" style="text-align:center;color:#5a3030;padding:10px 0;">battle restarted</div>';
    return `<pre>${esc(JSON.stringify(ev,null,2))}</pre>`;
}

function hitBody(ev, oi) {
    const hc=ev.HitConfig||{}, dp=ev.DamageParams||{};
    let h=`<div class="section"><h4>Hit Information</h4><table class="kv">
        <tr><th>Character</th><td>${ev.sourceType=='Player' ? esc(hc.charName||'?') : esc(ev.AttackerDisplay||ev.Attacker||'?')}</td></tr>
        <tr><th>Skill</th><td>${esc(hc.skillTitle||'?')} (ID: ${esc(hc.skillId||'')})</td></tr>
        <tr><th>Hit</th><td>#${esc(hc.hitNum||'')} (ID: ${esc(hc.hitDamageId||'')})</td></tr>
        <tr><th>Skill Level</th><td>${esc(dp.skillLevel||'')}</td></tr>
        <tr><th>Critical</th><td>${dp.isCrit?'Yes':'No'}</td></tr>
        <tr><th>Source Type</th><td>${dsName(hc.sourceType)}</td></tr>
        <tr><th>Damage Type</th><td>${dtName(hc.damageType)}</td></tr>
        <tr><th>Element Type</th><td>${elName(hc.elementType)}</td></tr>
        <tr><th>Energy Charge</th><td>${hc.energyCharge!=null?hc.energyCharge:'?'}</td></tr>
        <tr><th>Hit Type</th><td>${htName(ev.HitType)}</td></tr>
        ${ev.SnapshotAt ? `<tr><th>Snapshot Age</th><td>${((parseTimeToMs(ev.Time)-parseTimeToMs(ev.SnapshotAt))/1000).toFixed(3)}s ago</td></tr>` : ''}
        ${ev.SummonAttrType !== undefined ? `<tr><th>Summon Attr Type</th><td>${ev.UseSummonHit ? 'Live' : ev.SummonAttrType === 1 ? 'inherit' : ev.SummonAttrType === 2 ? 'inheritByInitialSnapshot' : ev.SummonAttrType}</td></tr>` : ''}
    </table></div>`;

    h+=`<div class="section"><div class="collapsible-toggle${subOpenStates[`${oi}_dmg-${oi}`] ? ' open' : ''}" data-target="dmg-${oi}">Damage Calculation</div>
    <div class="collapsible-content" id="dmg-${oi}" style="${subOpenStates[`${oi}_dmg-${oi}`] ? 'display:block' : ''}"><table class="kv">
        <tr><th>Final Damage</th><td><strong>${Number(dp.finalDamage).toLocaleString()}</strong></td></tr>
        <tr><th>Crit Ratio</th><td>${dp.critRatio!=null?dp.critRatio.toFixed(4):''}</td></tr>
        <tr><th>Base Multiplier</th><td>${dp.skillPercentAmend!=null?(dp.skillPercentAmend/10000).toFixed(2)+'%':''}</td></tr>
        <tr><th>Slot DMG Ratio</th><td>${dp.slotDmgRatio!=null?dp.slotDmgRatio.toFixed(4):''}</td></tr>
        <tr><th>Element %</th><td>${dp.fromEE!=null?dp.fromEE.toFixed(4):''}</td></tr>
        <tr><th>Perk Intensity</th><td>${dp.perkIntensityRatio!=null?dp.perkIntensityRatio.toFixed(4):''}</td></tr>
        <tr><th>Skill Intensity</th><td>${dp.skillIntensityRatio!=null?dp.skillIntensityRatio.toFixed(4):''}</td></tr>
        <tr><th>Toughness Broken</th><td>${dp.toughnessBrokenDmgRatio!=null?dp.toughnessBrokenDmgRatio.toFixed(4):''}</td></tr>
        <tr><th>DEF Amend</th><td>${dp.defAmend!=null?dp.defAmend.toFixed(4):''}</td></tr>
        <tr><th>ER Amend</th><td>${dp.erAmend!=null?dp.erAmend.toFixed(4):''}</td></tr>
        <tr><th>Env Amend</th><td>${dp.envAmendRatio!=null?dp.envAmendRatio.toFixed(4):''}</td></tr>
    </table></div></div>`;

    h+=`<div class="section"><h4>Attacker: ${esc(ev.AttackerDisplay||ev.Attacker||'?')}</h4>`;
    if(ev.AttackerBuffs?.buffs?.length) {
        h+=`<div class="collapsible-toggle${subOpenStates[`${oi}_abuffs-${oi}`] ? ' open' : ''}" data-target="abuffs-${oi}">Attacker Buffs (${ev.AttackerBuffs.buffs.length})</div>
        <div class="collapsible-content" id="abuffs-${oi}" style="${subOpenStates[`${oi}_abuffs-${oi}`] ? 'display:block' : ''}"><table><tr><th>Name</th><th>Stacks</th><th>Left</th><th>Total</th><th>ID</th></tr>`;
        ev.AttackerBuffs.buffs.forEach(b=>{ h+=`<tr><td>${esc(b.name)}</td><td>${b.stacks||'1'}</td><td>${b.leftTime!=null?b.leftTime.toFixed(1)+'s':'inf'}</td><td>${b.totalTime!=null?b.totalTime.toFixed(1)+'s':'-'}</td><td>${b.configId}</td></tr>`; });
        h+=`</table></div>`;
    }
    if(ev.AttackerEffects?.effects?.length) {
        h+=`<div class="collapsible-toggle${subOpenStates[`${oi}_aeffects-${oi}`] ? ' open' : ''}" data-target="aeffects-${oi}">Attacker Effects (${ev.AttackerEffects.effects.length})</div>
        <div class="collapsible-content" id="aeffects-${oi}" style="${subOpenStates[`${oi}_aeffects-${oi}`] ? 'display:block' : ''}"><table class="wide-name"><tr><th>Name</th><th>Count</th><th>Type</th><th>Attr</th><th>SubType</th><th>Value</th><th>ID</th></tr>`;
        const m=new Map(); ev.AttackerEffects.effects.forEach(e=>{ const id=e.configId; if(!m.has(id)) m.set(id,{e,count:0}); m.get(id).count++; });
        m.forEach((v,id)=>{ const e=v.e; const etName=e.effectType!=null?effectTypeName(e.effectType):''; const atName=e.attrType!=null?attrName(e.attrType):''; const stName=e.subType!=null?effectSubTypeName(e.subType, e.effectType):''; const raw=e.value; const val=raw!=null?(Math.abs(raw)<15?(raw*100).toFixed(2)+'%':raw):''; const inherited=e.fromOwnerSnapshot?' style="background:#2a2a2a"':''; h+=`<tr${inherited}><td>${esc(e.name)}</td><td>${v.count}</td><td>${esc(etName)}</td><td>${esc(atName)}</td><td>${esc(stName)}</td><td>${val}</td><td>${id}</td></tr>`; });
        h+=`</table></div>`;
    }
    if(ev.AttackerAttrDict?.length) {
        h+=`<div class="collapsible-toggle${subOpenStates[`${oi}_aattrdict-${oi}`] ? ' open' : ''}" data-target="aattrdict-${oi}">Attacker Attr Dict (${ev.AttackerAttrDict.length})</div>
        <div class="collapsible-content" id="aattrdict-${oi}" style="${subOpenStates[`${oi}_aattrdict-${oi}`] ? 'display:block' : ''}"><table class="wide-name"><tr><th>Name</th><th>Stacks</th><th>Attr</th><th>SubType</th><th>Value</th><th>Value Config ID</th><th>Attr ID</th></tr>`;
        ev.AttackerAttrDict.forEach(a=>{ const atName=a.attrType!=null?attrName(a.attrType):''; const stName=a.subType!=null?effectSubTypeName(a.subType):''; const raw=a.value; const val=raw!=null?(Math.abs(raw)<15?(raw*100).toFixed(2)+'%':raw):''; h+=`<tr><td>${esc(a.name||String(a.attrId))}</td><td>${a.stacks}</td><td>${esc(atName)}</td><td>${esc(stName)}</td><td>${val}</td><td>${a.valueConfigId}</td><td>${a.attrId}</td></tr>`; });
        h+=`</table></div>`;
    }
    if(ev.AttackerStats?.attrs?.length) {
        h+=`<div class="collapsible-toggle${subOpenStates[`${oi}_astats-${oi}`] ? ' open' : ''}" data-target="astats-${oi}">Attacker Stats</div>
        <div class="collapsible-content" id="astats-${oi}" style="${subOpenStates[`${oi}_astats-${oi}`] ? 'display:block' : ''}"><table><tr><th>Name</th><th>Origin</th><th>Base</th><th>Pct</th><th>Abs</th><th>LimPct</th></tr>`;
        ev.AttackerStats.attrs.forEach(a=>{ if (a.origin==null&&a.base==null&&a.pct==null&&a.abs==null&&a.limPct==null) return; h+=`<tr><td>${esc(a.name)}</td><td>${a.origin!=null?a.origin:''}</td><td>${a.base!=null?a.base:''}</td><td>${a.pct!=null?a.pct:''}</td><td>${a.abs!=null?a.abs:''}</td><td>${a.limPct!=null?a.limPct:''}</td></tr>`; });
        h+=`</table></div>`;
    }
    h+=`</div>`;

    h+=`<div class="section"><h4>Defender: ${esc(ev.DefenderDisplay||ev.Defender||'?')}</h4>`;
    if(ev.DefenderBuffs?.buffs?.length) {
        h+=`<div class="collapsible-toggle${subOpenStates[`${oi}_dbuffs-${oi}`] ? ' open' : ''}" data-target="dbuffs-${oi}">Defender Buffs (${ev.DefenderBuffs.buffs.length})</div>
        <div class="collapsible-content" id="dbuffs-${oi}" style="${subOpenStates[`${oi}_dbuffs-${oi}`] ? 'display:block' : ''}"><table><tr><th>Name</th><th>Stacks</th><th>Left</th><th>Total</th><th>ID</th></tr>`;
        ev.DefenderBuffs.buffs.forEach(b=>{ h+=`<tr><td>${esc(b.name)}</td><td>${b.stacks||'1'}</td><td>${b.leftTime!=null?b.leftTime.toFixed(1)+'s':'inf'}</td><td>${b.totalTime!=null?b.totalTime.toFixed(1)+'s':'-'}</td><td>${b.configId}</td></tr>`; });
        h+=`</table></div>`;
    }
    if(ev.DefenderEffects?.effects?.length) {
        h+=`<div class="collapsible-toggle${subOpenStates[`${oi}_deffects-${oi}`] ? ' open' : ''}" data-target="deffects-${oi}">Defender Effects (${ev.DefenderEffects.effects.length})</div>
        <div class="collapsible-content" id="deffects-${oi}" style="${subOpenStates[`${oi}_deffects-${oi}`] ? 'display:block' : ''}"><table class="wide-name"><tr><th>Name</th><th>Count</th><th>Type</th><th>Attr</th><th>SubType</th><th>Value</th><th>ID</th></tr>`;
        const m=new Map(); ev.DefenderEffects.effects.forEach(e=>{ const id=e.configId; if(!m.has(id)) m.set(id,{e,count:0}); m.get(id).count++; });
        m.forEach((v,id)=>{ const e=v.e; const etName=e.effectType!=null?effectTypeName(e.effectType):''; const atName=e.attrType!=null?attrName(e.attrType):''; const stName=e.subType!=null?effectSubTypeName(e.subType, e.effectType):''; const raw=e.value; const val=raw!=null?(Math.abs(raw)<15?(raw*100).toFixed(2)+'%':raw):''; const inherited=e.fromOwnerSnapshot?' style="background:#2a2a2a"':''; h+=`<tr${inherited}><td>${esc(e.name)}</td><td>${v.count}</td><td>${esc(etName)}</td><td>${esc(atName)}</td><td>${esc(stName)}</td><td>${val}</td><td>${id}</td></tr>`; });
        h+=`</table></div>`;
    }
    if(ev.DefenderAttrDict?.length) {
        h+=`<div class="collapsible-toggle${subOpenStates[`${oi}_dattrdict-${oi}`] ? ' open' : ''}" data-target="dattrdict-${oi}">Defender Attr Dict (${ev.DefenderAttrDict.length})</div>
        <div class="collapsible-content" id="dattrdict-${oi}" style="${subOpenStates[`${oi}_dattrdict-${oi}`] ? 'display:block' : ''}"><table class="wide-name"><tr><th>Name</th><th>Stacks</th><th>Attr</th><th>SubType</th><th>Value</th><th>Value Config ID</th><th>Attr ID</th></tr>`;
        ev.DefenderAttrDict.forEach(a=>{ const atName=a.attrType!=null?attrName(a.attrType):''; const stName=a.subType!=null?effectSubTypeName(a.subType):''; const raw=a.value; const val=raw!=null?(Math.abs(raw)<15?(raw*100).toFixed(2)+'%':raw):''; h+=`<tr><td>${esc(a.name||String(a.attrId))}</td><td>${a.stacks}</td><td>${esc(atName)}</td><td>${esc(stName)}</td><td>${val}</td><td>${a.valueConfigId}</td><td>${a.attrId}</td></tr>`; });
        h+=`</table></div>`;
    }
    if(ev.DefenderStats?.attrs?.length) {
        h+=`<div class="collapsible-toggle${subOpenStates[`${oi}_dstats-${oi}`] ? ' open' : ''}" data-target="dstats-${oi}">Defender Stats</div>
        <div class="collapsible-content" id="dstats-${oi}" style="${subOpenStates[`${oi}_dstats-${oi}`] ? 'display:block' : ''}"><table><tr><th>Name</th><th>Origin</th><th>Base</th><th>Pct</th><th>Abs</th><th>LimPct</th></tr>`;
        ev.DefenderStats.attrs.forEach(a=>{ if (a.origin==null&&a.base==null&&a.pct==null&&a.abs==null&&a.limPct==null) return; h+=`<tr><td>${esc(a.name)}</td><td>${a.origin!=null?a.origin:''}</td><td>${a.base!=null?a.base:''}</td><td>${a.pct!=null?a.pct:''}</td><td>${a.abs!=null?a.abs:''}</td><td>${a.limPct!=null?a.limPct:''}</td></tr>`; });
        h+=`</table></div>`;
    }
    h+=`</div>`;
    return h;
}

function buffBody(ev) {
    return `<div class="section"><h4>Buff / Effect Details</h4><table class="kv">
        <tr><th>Name</th><td>${esc(ev.Name||ev.ConfigId)}</td></tr>
        <tr><th>Action</th><td>${esc(ev.Action)}</td></tr>
        <tr><th>Owner</th><td>${esc(cleanOwner(ev.OwnerDisplay||ev.Owner||'?'))}</td></tr>
        ${(ev.SourceDisplay||ev.Source)?`<tr><th>Source</th><td>${esc(cleanOwner(ev.SourceDisplay||ev.Source))}</td></tr>`:''}
        ${ev.Stacks!=null?`<tr><th>Stacks</th><td>${ev.Stacks}</td></tr>`:''}
        ${ev.SubType?`<tr><th>Type</th><td>${esc(ev.SubType)}</td></tr>`:''}
        <tr><th>Config ID</th><td>${ev.ConfigId}</td></tr>
    </table></div>`;
}

function skillBody(ev) {
    return `<div class="section"><h4>Skill Cast Details</h4><table class="kv">
        <tr><th>Skill Name</th><td>${esc(ev.Name||ev.SkillId)}</td></tr>
        <tr><th>Owner</th><td>${esc(ev.Owner||'?')}</td></tr>
        ${ev.SkillType?`<tr><th>Type</th><td>${esc(ev.SkillType)}</td></tr>`:''}
        <tr><th>Skill ID</th><td>${ev.SkillId}</td></tr>
        ${ev.FCPath?`<tr><th>FC Path</th><td>${esc(ev.FCPath)}</td></tr>`:''}
    </table></div>`;
}

// ─── Create DOM element for an event ─────────
function createEventDiv(ev, filteredIdx) {
    const oi = ev._origIndex;
    const isOpen = openStates[oi] || false;
    const div = document.createElement('div');
    div.className = 'event' + (isOpen ? ' open' : '') + (ev.Type === 'Reset' ? ' event-reset' : '');
    div.style.top = fenwick.prefixSum(filteredIdx - 1) + 'px';
    div.dataset.origIndex = oi;
    div.dataset.filteredIndex = filteredIdx;

    const header = document.createElement('div');
    header.className = 'event-header';
    const h3 = document.createElement('h3');

    let typeText = ev.Type;
    if (ev.Type === 'Buff') typeText = ev.SubType === 'Effect' ? 'Effect' : (ev.Action === 'Add' ? 'Buff Add' : 'Buff Remove');
    h3.innerHTML = `<span class="time">${esc(ev.Time||'--:--')}</span> <span class="type">${esc(typeText)}</span>`;

    let desc = '';
    if (ev.Type === 'Hit') {
        const hc=ev.HitConfig||{}, dp=ev.DamageParams||{};
        const attName = esc(ev.AttackerDisplay||ev.Attacker||'?');
        const skillPart = hc.skillTitle ? esc(hc.skillTitle) : '';
        const hitPart = hc.hitNum!=null ? ` (#${hc.hitNum})` : '';
        const skillStr = (skillPart||hitPart) ? ` - ${skillPart}${hitPart}` : '';
        const baseMult = dp.skillPercentAmend!=null ? ` [${(dp.skillPercentAmend/10000).toFixed(2)}%]` : '';
        const snapAge = ev.SnapshotAt ? ` [${((parseTimeToMs(ev.Time)-parseTimeToMs(ev.SnapshotAt))/1000).toFixed(3)}s ago]` : '';
        desc = `${attName}${skillStr}${baseMult}${snapAge} - Dmg: ${Number(dp.finalDamage).toLocaleString()}`;
    } else if (ev.Type === 'Buff') {
        const owner = cleanOwner(ev.OwnerDisplay||ev.Owner||'?');
        const name = esc(ev.Name||ev.ConfigId);
        let stacks = (ev.Stacks!=null && ev.Stacks>0) ? ' x'+ev.Stacks : '';
        desc = `${owner} - ${name}${stacks}`;
    } else if (ev.Type === 'Skill Cast') {
        desc = `${esc(ev.Owner||'')} / ${esc(ev.Name||ev.SkillId)}`;
    } else if (ev.Type === 'Reset') {
        desc = 'battle restarted';
    }
    h3.innerHTML += `<span class="desc">${desc}</span>`;
    header.appendChild(h3);
    header.innerHTML += `<span class="arrow">▶</span>`;

    header.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMainEvent(oi);
    });

    const body = document.createElement('div');
    body.className = 'event-body';
    if (isOpen) {
        body.innerHTML = buildEventBody(ev);
    }

    div.appendChild(header);
    div.appendChild(body);

    const trigger = document.createElement('div');
    trigger.className = 'spacer-trigger';
    trigger.addEventListener('click', e => { e.stopPropagation(); toggleSpacer(oi); });
    div.appendChild(trigger);

    return div;
}

// ─── Toggle main event ──────────────────────
function toggleMainEvent(origIndex) {
    const eventDiv = content.querySelector(`.event[data-orig-index="${origIndex}"]`);
    if (!eventDiv) return;

    const filteredIdx = parseInt(eventDiv.dataset.filteredIndex);

    const savedScroll = container.scrollTop;
    const wasOpen = openStates[origIndex] || false;

    if (wasOpen) {
        openStates[origIndex] = false;
        const body = eventDiv.querySelector('.event-body');
        if (body) body.innerHTML = '';

        const topOfThis = fenwick.prefixSum(filteredIdx - 1);
        const relativeScroll = savedScroll - topOfThis;

        eventDiv.classList.remove('open');
        const delta = updateHeightAtIndex(filteredIdx, EST);
        delete measuredHeights[origIndex];
        shiftElementsAfter(filteredIdx, delta);

        container.scrollTop = topOfThis + relativeScroll;
    } else {
        openStates[origIndex] = true;
        const ev = allEvents[origIndex];
        const body = eventDiv.querySelector('.event-body');
        if (body) body.innerHTML = buildEventBody(ev);
        eventDiv.classList.add('open');

        requestAnimationFrame(() => {
            const actual = eventDiv.getBoundingClientRect().height;
            if (actual > 0) {
                measuredHeights[origIndex] = actual;
                const delta = updateHeightAtIndex(filteredIdx, actual);
                if (Math.abs(delta) > 0.5) {
                    shiftElementsAfter(filteredIdx, delta);
                    const maxScroll = totalHeightCached - container.clientHeight;
                    container.scrollTop = Math.min(savedScroll, Math.max(0, maxScroll));
                    render();
                }
            }
        });
    }
}

function shiftElementsAfter(startIndex, delta) {
    const events = content.querySelectorAll('.event');
    for (const ev of events) {
        const idx = parseInt(ev.dataset.filteredIndex);
        if (!isNaN(idx) && idx > startIndex) {
            ev.style.top = (parseFloat(ev.style.top) + delta) + 'px';
        }
    }
    renderSpacers();
}

// ─── Sub-section toggle ──────────────────────
content.addEventListener('click', e => {
    const toggle = e.target.closest('.collapsible-toggle');
    if (!toggle) return;
    e.stopPropagation();

    const targetId = toggle.dataset.target;
    const contentEl = document.getElementById(targetId);
    if (!contentEl) return;

    const isOpen = toggle.classList.toggle('open');
    contentEl.style.display = isOpen ? 'block' : 'none';

    const eventDiv = toggle.closest('.event');
    if (!eventDiv) return;
    const oi = parseInt(eventDiv.dataset.origIndex);
    const filteredIdx = parseInt(eventDiv.dataset.filteredIndex);
    const key = `${oi}_${targetId}`;
    subOpenStates[key] = isOpen;

    const savedScroll = container.scrollTop;
    requestAnimationFrame(() => {
        const actual = eventDiv.getBoundingClientRect().height;
        if (actual > 0 && !isNaN(filteredIdx)) {
            const delta = updateHeightAtIndex(filteredIdx, actual);
            measuredHeights[oi] = actual;
            if (Math.abs(delta) > 0.5) {
                shiftElementsAfter(filteredIdx, delta);
            }
        }
        const maxScroll = totalHeightCached - container.clientHeight;
        container.scrollTop = Math.min(savedScroll, Math.max(0, maxScroll));
    });
});

// ─── Virtual scroll render ────────────────────
function render() {
    if (!filtered.length) {
        content.innerHTML = '';
        return;
    }

    const scrollTop = container.scrollTop;
    const viewH = container.clientHeight;
    const startIdx = findIndexForOffset(scrollTop);
    let start = Math.max(0, startIdx - BUFFER);
    const endIdx = findIndexForOffset(scrollTop + viewH);
    let end = Math.min(filtered.length, endIdx + BUFFER);
    if (start >= filtered.length) start = Math.max(0, filtered.length - 1);

    const neededOrig = new Set();
    for (let i = start; i < end; i++) {
        neededOrig.add(filtered[i]._origIndex);
    }

    // Build a fresh orig→filteredIndex map so we never use stale dataset values
    const origToFi = new Map();
    for (let i = start; i < end; i++) {
        origToFi.set(filtered[i]._origIndex, i);
    }

    const existing = content.querySelectorAll('.event');
    for (const el of existing) {
        const oi = parseInt(el.dataset.origIndex);
        if (neededOrig.has(oi)) {
            const fi = origToFi.get(oi);
            el.dataset.filteredIndex = fi; // keep dataset in sync
            const newTop = fenwick.prefixSum(fi - 1);
            if (el.style.top !== newTop + 'px') {
                el.style.top = newTop + 'px';
            }
            const shouldOpen = openStates[oi] || false;
            const isOpen = el.classList.contains('open');
            if (shouldOpen !== isOpen) {
                el.classList.toggle('open', shouldOpen);
                const body = el.querySelector('.event-body');
                if (body) {
                    if (shouldOpen && body.innerHTML.trim() === '') {
                        body.innerHTML = buildEventBody(allEvents[oi]);
                    } else if (!shouldOpen) {
                        body.innerHTML = '';
                    }
                }
            }
            neededOrig.delete(oi);
        } else {
            el.remove();
        }
    }

    for (const oi of neededOrig) {
        const fi = origToFi.get(oi);
        if (fi === undefined || fi === -1) continue;
        const ev = allEvents[oi];
        const div = createEventDiv(ev, fi);
        content.appendChild(div);
    }

    if (searchQuery) {
        const matchSet = new Set(searchMatches);
        const currentFi = searchMatchIdx >= 0 ? searchMatches[searchMatchIdx] : -1;
        content.querySelectorAll('.event').forEach(el => {
            const fi = parseInt(el.dataset.filteredIndex);
            el.classList.toggle('search-match', matchSet.has(fi) && fi !== currentFi);
            el.classList.toggle('search-current', fi === currentFi);
        });
    } else {
        content.querySelectorAll('.event').forEach(el => {
            el.classList.remove('search-match', 'search-current');
        });
    }

    renderSpacers();
}

// ─── Scroll handler ────────────────────────
let scrollScheduled = false;
container.addEventListener('scroll', () => {
    if (scrollScheduled) return;
    scrollScheduled = true;
    requestAnimationFrame(() => {
        render();
        scrollScheduled = false;
    });
});

// ─── Search helpers ───────────────
function normalizeSearch(s) {
    return s.replace(/[,.]/g, '');
}

function getEventSearchText(ev) {
    if (ev._searchText !== undefined) return ev._searchText;
    let typeText = ev.Type || '';
    if (ev.Type === 'Buff') typeText = ev.SubType === 'Effect' ? 'Effect' : (ev.Action === 'Add' ? 'Buff Add' : 'Buff Remove');
    const parts = [typeText];

    if (ev.Type === 'Hit') {
        const hc = ev.HitConfig || {}, dp = ev.DamageParams || {};
        parts.push(ev.AttackerDisplay || ev.Attacker || '');
        parts.push((hc.skillTitle || '') + (hc.hitNum ? ' (#'+hc.hitNum+')' : ''));
        if (dp.skillPercentAmend != null) parts.push((dp.skillPercentAmend / 10000).toFixed(2) + '%');
        if (dp.finalDamage != null) {
            parts.push(String(dp.finalDamage));
            parts.push(Number(dp.finalDamage).toLocaleString());
        }
        parts.push('Dmg');
    } else if (ev.Type === 'Buff') {
        parts.push(ev.SubType || '');
        parts.push(cleanOwner(ev.OwnerDisplay || ev.Owner || ''));
        parts.push(ev.Name || ev.ConfigId || '');
        parts.push(ev.Action || '');
        if (ev.Stacks != null && ev.Stacks > 0) parts.push('x' + ev.Stacks);
    } else if (ev.Type === 'Skill Cast') {
        parts.push(ev.Owner || '');
        parts.push(ev.Name || ev.SkillId || '');
    }
    return ev._searchText = parts.join(' ').toLowerCase();
}

function buildSearchMatches() {
    searchMatches = [];
    if (!searchQuery) return;
    const q = normalizeSearch(searchQuery.toLowerCase());
    for (let fi = 0; fi < filtered.length; fi++) {
        if (normalizeSearch(getEventSearchText(filtered[fi])).includes(q)) {
            searchMatches.push(fi);
        }
    }
}

function updateSearchCount() {
    const el = document.getElementById('searchCount');
    if (!searchQuery) { el.textContent = ''; return; }
    if (searchMatches.length === 0) { el.textContent = 'No matches'; el.style.color = '#a04040'; return; }
    el.style.color = '#888';
    el.textContent = `${searchMatchIdx + 1} / ${searchMatches.length}`;
}

function scrollToMatch(fi) {
    const top = fenwick.prefixSum(fi - 1);
    const orig = filtered[fi]._origIndex;
    const itemH = (heights[fi] - (spacerByOrig.get(orig) || 0)) || EST;
    const viewH = container.clientHeight;
    const scrollTop = container.scrollTop;

    if (top < scrollTop) {
        container.scrollTop = top;
    } else if (top + itemH > scrollTop + viewH) {
        container.scrollTop = top + itemH - viewH;
    }

    render();
}

window.navigateSearch = function(dir) {
    if (searchMatches.length === 0) return;
    searchMatchIdx = (searchMatchIdx + dir + searchMatches.length) % searchMatches.length;
    updateSearchCount();
    scrollToMatch(searchMatches[searchMatchIdx]);
};

function openSearch() {
    document.getElementById('searchBar').classList.add('visible');
    document.getElementById('searchInput').focus();
}

window.closeSearch = function() {
    document.getElementById('searchBar').classList.remove('visible');
    searchQuery = '';
    searchMatches = [];
    searchMatchIdx = -1;
    document.getElementById('searchInput').value = '';
    updateSearchCount();
    render();
};

document.getElementById('searchInput').addEventListener('input', e => {
    searchQuery = e.target.value.trim();
    buildSearchMatches();
    searchMatchIdx = searchMatches.length > 0 ? 0 : -1;
    updateSearchCount();
    if (searchMatchIdx >= 0) scrollToMatch(searchMatches[searchMatchIdx]);
    else render();
});

document.getElementById('searchInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
        e.preventDefault();
        navigateSearch(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
        closeSearch();
    }
});

document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        openSearch();
    } else if (e.key === 'Escape' && document.getElementById('searchBar').classList.contains('visible')) {
        closeSearch();
    }
});

// ─── Spacer logic ─────────────────
function toggleSpacer(orig) {
    const fi = filtered.findIndex(e => e._origIndex === orig);
    if (fi === -1) return;

    const currentSpacerH = spacerByOrig.get(orig) || 0;
    const eventOnlyH = heights[fi] - currentSpacerH;

    if (spacerByOrig.has(orig)) {
        spacerByOrig.delete(orig);
    } else {
        spacerByOrig.set(orig, SPACER_HEIGHT);
    }

    const savedScroll = container.scrollTop;
    const delta = updateHeightAtIndex(fi, eventOnlyH);
    shiftElementsAfter(fi, delta);
    const maxScroll = totalHeightCached - container.clientHeight;
    container.scrollTop = Math.min(savedScroll, Math.max(0, maxScroll));
    render();
}

function renderSpacers() {
    content.querySelectorAll('.event-spacer').forEach(el => el.remove());
    if (spacerByOrig.size === 0) return;

    content.querySelectorAll('.event').forEach(el => {
        const oi = parseInt(el.dataset.origIndex);
        const fi = parseInt(el.dataset.filteredIndex);
        const sh = spacerByOrig.get(oi) || 0;
        if (sh === 0) return;

        const actualEventH = el.getBoundingClientRect().height;
        const topOfSlot = fenwick.prefixSum(fi - 1);
        const spacerTop = topOfSlot + actualEventH;
        const spacerBottom = topOfSlot + heights[fi];
        const renderedH = Math.max(1, spacerBottom - spacerTop);

        const sd = document.createElement('div');
        sd.className = 'event-spacer';
        sd.style.top = spacerTop + 'px';
        sd.style.height = renderedH + 'px';
        sd.addEventListener('click', () => toggleSpacer(oi));
        content.appendChild(sd);
    });
}

// ─── Filter handlers ─────────────
window.toggleTypeFilter = function(btn) {
    const type = btn.dataset.type;
    if (typeFilter.has(type)) {
        typeFilter.delete(type);
    } else {
        typeFilter.add(type);
    }
    btn.classList.toggle('active', typeFilter.has(type));
    refilterAndRender(true);
};

window.onCharFilterChange = function() {
    charFilter = document.getElementById('charFilter').value;
    skillFilter = '';
    document.getElementById('skillFilter').value = '';
    refilterAndRender(true);
};

window.onSkillFilterChange = function() {
    skillFilter = document.getElementById('skillFilter').value;
    refilterAndRender(true);
};

window.onDamageTypeFilterChange = function() {
    damageTypeFilter = document.getElementById('damageTypeFilter').value;
    refilterAndRender(true);
};

window.onDefenderFilterChange = function() {
    defenderFilter = document.getElementById('defenderFilter').value;
    refilterAndRender(true);
};

// ─── Tab switching ────────────────
let activeTab = 'log';
window.switchTab = function(tab) {
    activeTab = tab;
    document.getElementById('tabLog').classList.toggle('active', tab === 'log');
    document.getElementById('tabAnalytics').classList.toggle('active', tab === 'analytics');
    document.getElementById('logPanel').classList.toggle('hidden', tab !== 'log');
    document.getElementById('analyticsPanel').classList.toggle('visible', tab === 'analytics');
    if (tab === 'analytics') Analytics.refresh();
    // Toggle sidebar sections
    const sbFilters = document.getElementById('sidebarFilters');
    const sbDcFilters = document.getElementById('sidebarDcFilters');
    if (sbFilters) sbFilters.classList.toggle('hidden', tab !== 'log');
    if (sbDcFilters) sbDcFilters.classList.toggle('hidden', tab !== 'dmgcalc' && tab !== 'effectimpact');
    const sbEiFilters = document.getElementById('sidebarEiFilters');
    if (sbEiFilters) sbEiFilters.classList.toggle('hidden', tab !== 'effectimpact');
    const sbDcStats = document.getElementById('sidebarDcStats');
    if (sbDcStats) sbDcStats.classList.toggle('hidden', tab !== 'dmgcalc' && tab !== 'effectimpact');
};
