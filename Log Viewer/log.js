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
function refilterAndRender(resetScroll = false, resetOpen = true) {
    if (resetOpen) {
        openStates = {};
        measuredHeights = {};
        subOpenStates = {};
        content.innerHTML = '';
    }
    filtered = applyFilters();
    buildFenwick();
    buildSearchMatches();
    if (searchMatchIdx >= searchMatches.length) searchMatchIdx = searchMatches.length > 0 ? 0 : -1;
    updateSearchCount();
    document.getElementById('stats').textContent = `Showing ${filtered.length} of ${allEvents.length} events`;
    if (resetScroll || resetOpen) {
        container.scrollTop = 0;
    }
    render();
}

// ─── Body builders ──────────────────────────
function buildEventBody(ev) {
    const oi = ev._origIndex;
    if (ev.Type === 'Hit') return hitBody(ev, oi);
    if (ev.Type === 'Buff') return buffBody(ev);
    if (ev.Type === 'Skill Cast') return skillBody(ev);
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
        <div class="collapsible-content" id="aeffects-${oi}" style="${subOpenStates[`${oi}_aeffects-${oi}`] ? 'display:block' : ''}"><table><tr><th>Name</th><th>Count</th><th>ID</th></tr>`;
        const m=new Map(); ev.AttackerEffects.effects.forEach(e=>{ const id=e.configId; if(!m.has(id)) m.set(id,{name:e.name,count:0}); m.get(id).count++; });
        m.forEach((v,id)=>{ h+=`<tr><td>${esc(v.name)}</td><td>${v.count}</td><td>${id}</td></tr>`; });
        h+=`</table></div>`;
    }
    if(ev.AttackerAttrDict?.length) {
        h+=`<div class="collapsible-toggle${subOpenStates[`${oi}_aattrdict-${oi}`] ? ' open' : ''}" data-target="aattrdict-${oi}">Attacker Attr Dict (${ev.AttackerAttrDict.length})</div>
        <div class="collapsible-content" id="aattrdict-${oi}" style="${subOpenStates[`${oi}_aattrdict-${oi}`] ? 'display:block' : ''}"><table><tr><th>Name</th><th>Stacks</th><th>Value Config ID</th><th>Attr ID</th></tr>`;
        ev.AttackerAttrDict.forEach(a=>{ h+=`<tr><td>${esc(a.name||String(a.attrId))}</td><td>${a.stacks}</td><td>${a.valueConfigId}</td><td>${a.attrId}</td></tr>`; });
        h+=`</table></div>`;
    }
    if(ev.AttackerStats?.attrs?.length) {
        h+=`<div class="collapsible-toggle${subOpenStates[`${oi}_astats-${oi}`] ? ' open' : ''}" data-target="astats-${oi}">Attacker Stats</div>
        <div class="collapsible-content" id="astats-${oi}" style="${subOpenStates[`${oi}_astats-${oi}`] ? 'display:block' : ''}"><table><tr><th>Name</th><th>Origin</th><th>Base</th><th>Pct</th><th>Abs</th><th>LimPct</th></tr>`;
        ev.AttackerStats.attrs.forEach(a=>{ h+=`<tr><td>${esc(a.name||a.id)}</td><td>${a.origin!=null?a.origin:''}</td><td>${a.base!=null?a.base:''}</td><td>${a.pct!=null?a.pct:''}</td><td>${a.abs!=null?a.abs:''}</td><td>${a.limPct!=null?a.limPct:''}</td></tr>`; });
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
        <div class="collapsible-content" id="deffects-${oi}" style="${subOpenStates[`${oi}_deffects-${oi}`] ? 'display:block' : ''}"><table><tr><th>Name</th><th>Count</th><th>ID</th></tr>`;
        const m=new Map(); ev.DefenderEffects.effects.forEach(e=>{ const id=e.configId; if(!m.has(id)) m.set(id,{name:e.name,count:0}); m.get(id).count++; });
        m.forEach((v,id)=>{ h+=`<tr><td>${esc(v.name)}</td><td>${v.count}</td><td>${id}</td></tr>`; });
        h+=`</table></div>`;
    }
    if(ev.DefenderAttrDict?.length) {
        h+=`<div class="collapsible-toggle${subOpenStates[`${oi}_dattrdict-${oi}`] ? ' open' : ''}" data-target="dattrdict-${oi}">Defender Attr Dict (${ev.DefenderAttrDict.length})</div>
        <div class="collapsible-content" id="dattrdict-${oi}" style="${subOpenStates[`${oi}_dattrdict-${oi}`] ? 'display:block' : ''}"><table><tr><th>Name</th><th>Stacks</th><th>Value Config ID</th><th>Attr ID</th></tr>`;
        ev.DefenderAttrDict.forEach(a=>{ h+=`<tr><td>${esc(a.name||String(a.attrId))}</td><td>${a.stacks}</td><td>${a.valueConfigId}</td><td>${a.attrId}</td></tr>`; });
        h+=`</table></div>`;
    }
    if(ev.DefenderStats?.attrs?.length) {
        h+=`<div class="collapsible-toggle${subOpenStates[`${oi}_dstats-${oi}`] ? ' open' : ''}" data-target="dstats-${oi}">Defender Stats</div>
        <div class="collapsible-content" id="dstats-${oi}" style="${subOpenStates[`${oi}_dstats-${oi}`] ? 'display:block' : ''}"><table><tr><th>Name</th><th>Origin</th><th>Base</th><th>Pct</th><th>Abs</th><th>LimPct</th></tr>`;
        ev.DefenderStats.attrs.forEach(a=>{ h+=`<tr><td>${esc(a.name||a.id)}</td><td>${a.origin!=null?a.origin:''}</td><td>${a.base!=null?a.base:''}</td><td>${a.pct!=null?a.pct:''}</td><td>${a.abs!=null?a.abs:''}</td><td>${a.limPct!=null?a.limPct:''}</td></tr>`; });
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
    div.className = 'event' + (isOpen ? ' open' : '');
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
        desc = `${attName}${skillStr}${baseMult} - Dmg: ${Number(dp.finalDamage).toLocaleString()}`;
    } else if (ev.Type === 'Buff') {
        const owner = cleanOwner(ev.OwnerDisplay||ev.Owner||'?');
        const name = esc(ev.Name||ev.ConfigId);
        let stacks = (ev.Stacks!=null && ev.Stacks>0) ? ' x'+ev.Stacks : '';
        desc = `${owner} - ${name}${stacks}`;
    } else if (ev.Type === 'Skill Cast') {
        desc = `${esc(ev.Owner||'')} / ${esc(ev.Name||ev.SkillId)}`;
    }
    h3.innerHTML += `<span class="desc">${desc}</span>`;
    header.appendChild(h3);
    header.innerHTML += `<span class="arrow">▶</span>`;

    header.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMainEvent(oi, filteredIdx);
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
function toggleMainEvent(origIndex, filteredIdx) {
    const eventDiv = content.querySelector(`.event[data-orig-index="${origIndex}"]`);
    if (!eventDiv) return;

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

    const existing = content.querySelectorAll('.event');
    for (const el of existing) {
        const oi = parseInt(el.dataset.origIndex);
        if (neededOrig.has(oi)) {
            const fi = parseInt(el.dataset.filteredIndex);
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
        const fi = filtered.findIndex(e => e._origIndex === oi);
        if (fi === -1) continue;
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
    return parts.join(' ').toLowerCase();
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
window.filter = function(type) {
    typeFilter = type;
    document.querySelectorAll('.filters button').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    refilterAndRender(true);
};

window.onCharFilterChange = function() {
    charFilter = document.getElementById('charFilter').value;
    refilterAndRender(true);
};

window.onSkillFilterChange = function() {
    skillFilter = document.getElementById('skillFilter').value;
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
};
