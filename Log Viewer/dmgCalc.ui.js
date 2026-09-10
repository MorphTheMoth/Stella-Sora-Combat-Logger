// ─── dmgCalc.ui.js ────────────────────────────────────────────────────────────
// UI layer: virtual-scroll list, formula bar, effects panel, filters, DOM events.
// Depends on dmgCalc.calc.js being loaded first.

// ─── DC shared state ──────────────────────────────────────────────────────────
let dcFiltered = [];
let dcOpenStates = {};
let dcMeasuredHeights = {};
let dcSubOpenStates = {};
let dcHeights = [];
let dcFenwick = null;
let dcTotalHeight = 0;

// Which formula fields are "disabled" (struck through)
const dcDisabled = new Set();

// ─── DC filter state ──────────────────────────────────────────────────────────
// ─── DC compare state ────────────────────────────────────────────────────────
// Each compare snapshots the Total Calc at click time; its row then shows the
// live difference between the current Total Calc and that snapshot.
let _dcCompareSeq = 0;
const dcCompares = []; // { id, name, value }
let _dcLastTotalCalc = 0;

window.dcAddCompare = function() {
    _dcCompareSeq++;
    dcCompares.push({ id: _dcCompareSeq, name: `Test ${_dcCompareSeq}`, value: _dcLastTotalCalc });
    dcRenderTotals();
};

window.dcDeleteCompare = function(id) {
    const idx = dcCompares.findIndex(c => c.id === id);
    if (idx >= 0) dcCompares.splice(idx, 1);
    dcRenderTotals();
};

// Click on the "Compare N" label → swap it for an inline text input.
// Enter/blur commits, Esc cancels.
window.dcRenameCompare = function(id) {
    const c = dcCompares.find(x => x.id === id);
    const el = document.getElementById('dcCmpName' + id);
    if (!c || !el) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = c.name;
    input.className = 'dc-compare-name-input';
    input.maxLength = 40;
    el.replaceWith(input);
    input.focus();
    input.select();
    const commit = () => {
        const v = input.value.trim();
        if (v) c.name = v;
        dcRenderTotals();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        else if (e.key === 'Escape') {
            input.removeEventListener('blur', commit);
            dcRenderTotals();
        }
    });
};

let dcCharFilter = '';
let dcSkillFilter = '';
let dcDamageTypeFilter = '';
let dcDefenderFilter = '';
let dcSearchQuery = '';

// Per-field bonus values (user-typed numbers added to all hits)
const dcBonus = {};
DC_FIELDS.forEach(f => { dcBonus[f.key] = 0; });
['genDmg','intensity','finalDmg','genDmgRcd','toughnessBroken'].forEach(k => { dcBonus[k] = 0; });

// ─── DC effects panel state ───────────────────────────────────────────────────
// Set of "side:configId:valueConfigId" keys for effects the user disabled
const dcEffectsDisabled = new Set();
// Set of attacker character names whose hits + effects are disabled
const dcCharsDisabled = new Set();
// Map<key, {newValueConfigId,newValue,newAttrType,newSubType}> for level-overridden effects
const dcEffectLevelOverrides = new Map();
// Whether the effects panel is open

// Which source sections are open; default collapsed (keys added on first toggle)
const dcSourceOpenStates = {};

// ─── Virtual scroll constants & DOM refs ─────────────────────────────────────
const DC_EST    = 60;
const DC_BUFFER = 20;

const dcContainer = document.getElementById('dcScrollContainer');
const dcContent   = document.getElementById('dcScrollContent');
const dcSpacer    = document.getElementById('dcScrollSpacer');

// ─── Fenwick tree ─────────────────────────────────────────────────────────────
class DcFenwick {
    constructor(size) { this.size = size; this.tree = new Array(size + 1).fill(0); }
    add(idx, delta) {
        for (let i = idx + 1; i <= this.size; i += i & -i) this.tree[i] += delta;
    }
    prefixSum(idx) {
        if (idx < 0) return 0;
        if (idx >= this.size) idx = this.size - 1;
        let s = 0;
        for (let i = idx + 1; i > 0; i -= i & -i) s += this.tree[i];
        return s;
    }
}

function dcBuildFenwick() {
    dcFenwick = new DcFenwick(dcFiltered.length);
    dcHeights = new Array(dcFiltered.length);
    let sum = 0;
    for (let i = 0; i < dcFiltered.length; i++) {
        const orig = dcFiltered[i]._origIndex;
        const h = (dcOpenStates[orig] && dcMeasuredHeights[orig]) ? dcMeasuredHeights[orig] : DC_EST;
        dcHeights[i] = h;
        dcFenwick.add(i, h);
        sum += h;
    }
    dcTotalHeight = sum;
    dcSpacer.style.height = dcTotalHeight + 'px';
}

function dcUpdateHeight(idx, newH) {
    const old = dcHeights[idx];
    if (Math.abs(old - newH) < 0.5) return 0;
    dcHeights[idx] = newH;
    const delta = newH - old;
    dcFenwick.add(idx, delta);
    dcTotalHeight += delta;
    dcSpacer.style.height = dcTotalHeight + 'px';
    return delta;
}

function dcFindIndex(target) {
    if (!dcFiltered.length) return 0;
    const clamped = Math.max(0, Math.min(target, dcTotalHeight));
    if (clamped <= 0) return 0;
    if (clamped >= dcTotalHeight) return dcFiltered.length - 1;
    let lo = 0, hi = dcFiltered.length - 1, ans = 0;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (dcFenwick.prefixSum(mid) >= clamped) { ans = mid; hi = mid - 1; }
        else lo = mid + 1;
    }
    return ans;
}

// ─── Effects panel render ─────────────────────────────────────────────────────
function renderEffectsPanel() {
    const panel = document.getElementById('dcEffectsPanel');
    if (!panel) return;
    const effects = dcCollectAttrFixEffects(dcFiltered);

    let html = '';
    if (effects.length === 0) {
        html += `<div class="dc-effects-body"><span class="dc-effects-empty">No effects found in current filter.</span></div>`;
    } else {
        html += `<div class="dc-effects-body"><div class="dc-effects-rows">`;

        // Group by side+source
        const groupMap = new Map();
        for (const ef of effects) {
            const gkey = `${ef.side}||${ef.source ?? 'Unknown'}`;
            if (!groupMap.has(gkey)) groupMap.set(gkey, []);
            groupMap.get(gkey).push(ef);
        }

        function renderGroup(gkey, label, groupEffects) {
            if (!groupEffects.length) return '';
            const isOpen = dcSourceOpenStates[gkey] === true;
            const escapedGkey = gkey.replace(/'/g, "\\'");
            let g = `<div class="dc-source-toggle" onclick="dcToggleSourceSection('${escapedGkey}')">
                <span class="dc-source-arrow">${isOpen ? '▾' : '▸'}</span><span>${esc(label)}</span>
                <span class="dc-source-count">${groupEffects.length}</span>
            </div>`;
            if (isOpen) {
                for (const ef of groupEffects) {
                    const disabled = dcEffectsDisabled.has(ef.key);
                    let valStr;
                    if (ef.isPotentialsGroup) {
                        valStr = `${ef.count} hit${ef.count !== 1 ? 's' : ''}`;
                    } else if (ef.isPotRow) {
                        valStr = `+${ef.linkPotential.addLv} lv`;
                    } else if (ef.displayOnly) {
                        valStr = `+${ef._skillAddLv || 0} lv`;
                    } else {
                        const override = dcGetLevelOverride(ef, ef.side);
                        const raw = override ? override.newValue : ef.value;
                        const overrideAttrType = override ? override.newAttrType : ef.attrType;
                        const overrideSubType = override ? override.newSubType : ef.subType;
                        const displayAttrLabel = overrideAttrType != null ? attrName(overrideAttrType) : '';
                        const isSmall = raw != null && Math.abs(raw) < 15;
                        const val = raw != null ? (isSmall ? (raw * 100).toFixed(2) + '%' : String(raw)) : '?';
                        const countStr = ef.count > 1 ? ` ×${ef.count}` : '';
                        const overrideMarker = override ? ' *' : '';
                        valStr = `${displayAttrLabel} ${val>=0 ? '+' : ''}${val}${countStr}${overrideMarker}`;
                    }

                    const hasLevels = !ef.isPotentialsGroup && ef.allValueConfigIds && ef.allValueConfigIds.length > 1 && ef.currentLevelIdx >= 0;
                    const escKey = ef.key.replace(/'/g, "\\'");
                    let effectiveLevelIdx = ef.currentLevelIdx;
                    if (hasLevels) {
                        const effOverride = dcGetLevelOverride(ef, ef.side);
                        if (effOverride) {
                            const overriddenIdx = ef.allValueConfigIds.findIndex(v => v.valueConfigId === effOverride.newValueConfigId);
                            if (overriddenIdx >= 0) {
                                effectiveLevelIdx = overriddenIdx;
                            } else if (ef.configId != null) {
                                // potential-ladder fallback: decode L from "<gid><P><L><V>"
                                const lo = ef.configId - (ef.configId % 1000);
                                const rel = effOverride.newValueConfigId > lo ? effOverride.newValueConfigId - lo : 0;
                                effectiveLevelIdx = rel > 0 ? Math.floor((rel % 100) / 10) - 1 : -1;   // L0 → 0/max
                            }
                        }
                    }
                    const maxLvl = hasLevels ? ef.allValueConfigIds.length - 1 : 0;

                    let levelBtns = '';
                    if (hasLevels) {
                        levelBtns = `
                            <button class="dc-lvl-btn${effectiveLevelIdx <= 0 ? ' dc-lvl-disabled' : ''}"
                                onclick="event.stopPropagation();dcChangeEffectLevel('${escKey}',-1)"
                                title="Decrease level">−</button>
                            <span class="dc-lvl-indicator">${effectiveLevelIdx + 1}/${maxLvl + 1}</span>
                            <button class="dc-lvl-btn${effectiveLevelIdx >= maxLvl ? ' dc-lvl-disabled' : ''}"
                                onclick="event.stopPropagation();dcChangeEffectLevel('${escKey}',1)"
                                title="Increase level">+</button>`;
                    }

                    g += `<div class="dc-effect-row${disabled ? ' disabled' : ''}"
                        onclick="dcToggleEffect('${ef.key}')"
                        title="${esc(ef.name)} — ${esc(valStr).replace(/"/g,'&quot;')}">
                        <span class="dc-effect-row-name">${esc(ef.name)}</span>
                        <span class="dc-effect-row-val">${valStr}</span>
                        <span class="dc-effect-row-lvl">${levelBtns}</span>
                    </div>`;
                }
            }
            return g;
        }

        // Attacker groups first, then defender, then Potentials
        for (const side of ['attacker', 'defender']) {
            const sideEntries = [...groupMap.entries()].filter(([k]) => k.startsWith(side + '||'));
            if (!sideEntries.length) continue;
            const sideLabel = side === 'attacker' ? 'Attacker' : 'Defender';
            html += `<div class="dc-effects-side-header">${sideLabel}</div>`;
            for (const [gkey, groupEffects] of sideEntries) {
                const source = gkey.slice(side.length + 2);
                html += renderGroup(gkey, source, groupEffects);
            }
        }

        // ── Potentials groups ────────────────────────────────────────────────
        const potentialsEntries = [...groupMap.entries()].filter(([k]) => k.startsWith('potentials||'));
        if (potentialsEntries.length) {
            html += `<div class="dc-effects-side-header">Potentials</div>`;
            for (const [gkey, groupEffects] of potentialsEntries) {
                const source = gkey.slice('potentials||'.length);
                html += renderGroup(gkey, source, groupEffects);
            }
        }

        // ── Skill Levels ─────────────────────────────────────────────────
        // Per-character skill-slot levels (the levels skill-scaled hits and
        // effects resolve against). Same record-lv/bonus/change model as the
        // potentials: ± steps the slot's `change`, record.js shows the full
        // breakdown, disabling an emblem skill row drops that emblem's bonus.
        html += dcRenderSkillLevels();

        html += `</div></div>`;
    }
    panel.innerHTML = html;
    dcRenderCharList();
}

// ─── Skill Levels section ─────────────────────────────────────────────────
// One collapsible group per character ("<char name> Skills"), one row per
// skill slot (Normal Attack / Main / Support / Ultimate) showing the live
// effective level with ± buttons that step the slot's user `change`.
function dcRenderSkillLevels() {
    if (dcSkillLevels.size === 0) return '';
    // Character order: record team first, then any extras in seed order.
    const byChar = new Map();   // charId -> [st]
    const seedOrder = [];
    for (const st of dcSkillLevels.values()) {
        if (!byChar.has(st.charId)) { byChar.set(st.charId, []); seedOrder.push(st.charId); }
        byChar.get(st.charId).push(st);
    }
    let charIds = seedOrder;
    const rec = (typeof getOriginRecord === 'function') ? getOriginRecord() : null;
    if (rec?.team?.length) {
        const teamIds = rec.team.map(Number).filter(id => byChar.has(id));
        const rest = seedOrder.filter(id => !teamIds.includes(id));
        charIds = [...teamIds, ...rest];
    }
    let html = `<div class="dc-effects-side-header">Skill Levels</div>`;
    for (const cid of charIds) {
        const sts = (byChar.get(cid) || []).slice()
            .sort((a, b) => SKILL_SLOT_ORDER.indexOf(a.slot) - SKILL_SLOT_ORDER.indexOf(b.slot));
        if (!sts.length) continue;
        const cname = sts[0].charName || String(cid);
        const gkey = `skilllv||${cname}`;
        // default open — initialize the shared toggle state on first sight so
        // dcToggleSourceSection's generic flip behaves
        if (!(gkey in dcSourceOpenStates)) dcSourceOpenStates[gkey] = true;
        const isOpen = dcSourceOpenStates[gkey] === true;
        const escapedGkey = gkey.replace(/'/g, "\\'");
        html += `<div class="dc-source-toggle" onclick="dcToggleSourceSection('${escapedGkey}')">`
            + `<span class="dc-source-arrow">${isOpen ? '▾' : '▸'}</span><span>${esc(cname)} Skills</span>`
            + `<span class="dc-source-count">${sts.length}</span></div>`;
        if (!isOpen) continue;
        for (const st of sts) {
            const eff = dcSkillEffectiveLevel(st);
            const bonus = dcSkillRowBonus(st);
            const max = dcSkillMaxLevel(st);
            const change = st.change || 0;
            const name = SKILL_SLOT_NAMES[st.slot] || ('Skill ' + st.slot);
            const marker = (bonus > 0 ? ` <span class="rec-bonus">+${bonus}</span>` : '')
                         + (change !== 0 ? ` <span class="rec-bonus">${change > 0 ? '+' : ''}${change}✎</span>` : '');
            const title = `Record ${st.recordLv} + bonus ${bonus} + change ${change} = ${eff} (in-game max ${st.maxLv}, sim cap ${max})`
                + ' — ± steps the user change for what-if simulation; reset on the Record page';
            html += `<div class="dc-effect-row" title="${esc(title)}">`
                + `<span class="dc-effect-row-name">${esc(name)}</span>`
                + `<span class="dc-effect-row-val">Lv ${eff}/${max}${marker}</span>`
                + `<span class="dc-effect-row-lvl">`
                + `<button class="dc-lvl-btn${eff <= 0 ? ' dc-lvl-disabled' : ''}" onclick="dcChangeSkillLevel(${cid},${st.slot},-1)" title="Decrease skill level">−</button>`
                + `<button class="dc-lvl-btn${eff >= max ? ' dc-lvl-disabled' : ''}" onclick="dcChangeSkillLevel(${cid},${st.slot},1)" title="Increase skill level">+</button>`
                + `</span></div>`;
        }
    }
    return html;
}

// ─── Per-character disable toggles ────────────────────────────────────────────
// When a character is toggled off, all effects whose source belongs to that
// character (e.g. "Tilia Skills", "Tilia Potentials") are added to
// dcEffectsDisabled, regardless of which character's hits they appear on.
const dcCharEffectKeys = new Map(); // charName -> Set<effectKey> added by this char

function dcCharOwnsSource(charName, source) {
    if (!charName || !source) return false;
    return source === charName || source.startsWith(charName + ' ');
}

// ─── Quick toggles ───────────────────────────────────────────────────────────
// Extra toggles under the character list:
//   - 'Pots Max Lvl 6' / 'Pots All Lvl 6': force Potentials-source effects to
//     level 6 via dcEffectLevelOverrides (enable-style buttons)
//   - 'Boss Blitz' / 'Talents': bulk-disable effects by source
const POT_LEVEL = 6;     // quick-toggle target level

// groupKey ('bossblitz'|'talents') -> Set<effectKey> disabled by this toggle
const dcGroupEffectKeys = new Map();
// Each pots toggle remembers the previous override state per key so it can
// revert cleanly (undefined = there was no override before)
const dcPotsMaxLvl6 = { active: false, prev: new Map() };
const dcPotsAllLvl6 = { active: false, prev: new Map() };

function dcIsPotentialSource(src) {
    return typeof src === 'string' && src.includes('Potentials');
}

function dcGroupSourceMatcher(groupKey) {
    return groupKey === 'bossblitz'
        ? (src) => src === 'Boss Blitz'
        : (src) => typeof src === 'string' && src.includes('Talents');
}

// Non-scaling / differently-capped effects in the Potentials section are
// skipped. onlyAboveMax=true clamps levels above 6 down, leaving lower levels.
// Quick toggles set every potential's effective level to 6 by writing the
// adjustment into the potential's level-table `change` (so it shows up in the
// record page's Changes column and moves every effect of that potential).
// state.prev remembers each potential's previous change so revert restores it.
function dcPotsApply(state, onlyAboveMax) {
    // only potentials that actually have effects in this log
    const activePots = new Set();
    for (const ef of dcCollectAttrFixEffects(dcFiltered)) {
        if (ef.levelSource != null) activePots.add(ef.levelSource);
    }
    for (const potId of activePots) {
        const st = dcPotLevels.get(potId);
        if (!st) continue;
        if (dcPotEffectiveLevel(st) === POT_LEVEL) continue;
        if (onlyAboveMax && dcPotEffectiveLevel(st) <= POT_LEVEL) continue;
        if (!state.prev.has(potId)) state.prev.set(potId, st.change || 0);
        st.change = POT_LEVEL - st.recordLv - st.bonus;
    }
}

function dcPotsRevert(state) {
    for (const [potId, prev] of state.prev) {
        const st = dcPotLevels.get(potId);
        if (st) st.change = prev;
    }
    state.prev.clear();
}

// Re-sync quick toggles as new effects appear (poll/refilter):
// add newly matching keys, drop vanished ones, re-apply active pots overrides.
function dcSyncQuickToggles() {
    for (const [groupKey, keys] of dcGroupEffectKeys) {
        const matcher = dcGroupSourceMatcher(groupKey);
        const newKeys = new Set();
        for (const ef of dcCollectAttrFixEffects(dcFiltered)) {
            if (matcher(ef.source)) newKeys.add(ef.key);
        }
        for (const k of newKeys) dcEffectsDisabled.add(k);
        for (const k of keys) {
            if (!newKeys.has(k)) dcEffectsDisabled.delete(k);
        }
        dcGroupEffectKeys.set(groupKey, newKeys);
    }
    if (dcPotsMaxLvl6.active) dcPotsApply(dcPotsMaxLvl6, true);
    if (dcPotsAllLvl6.active) dcPotsApply(dcPotsAllLvl6, false);
}

window.dcToggleGroupDisable = function(groupKey) {
    if (!dcGroupEffectKeys.has(groupKey)) {
        const matcher = dcGroupSourceMatcher(groupKey);
        const keys = new Set();
        for (const ef of dcCollectAttrFixEffects(dcFiltered)) {
            if (matcher(ef.source)) keys.add(ef.key);
        }
        dcGroupEffectKeys.set(groupKey, keys);
        keys.forEach(k => dcEffectsDisabled.add(k));
    } else {
        const keys = dcGroupEffectKeys.get(groupKey);
        if (keys) keys.forEach(k => dcEffectsDisabled.delete(k));
        dcGroupEffectKeys.delete(groupKey);
    }
    renderEffectsPanel();
    renderFormulaBar();
    dcRender();
    dcRefreshEI();
    dcNotifyAnalytics();
};

window.dcTogglePotsMaxLvl6 = function() {
    dcPotsMaxLvl6.active = !dcPotsMaxLvl6.active;
    if (dcPotsMaxLvl6.active) dcPotsApply(dcPotsMaxLvl6, true);
    else dcPotsRevert(dcPotsMaxLvl6);
    renderEffectsPanel();
    renderFormulaBar();
    dcRender();
    dcRefreshEI();
    dcNotifyAnalytics();
};

window.dcTogglePotsAllLvl6 = function() {
    dcPotsAllLvl6.active = !dcPotsAllLvl6.active;
    if (dcPotsAllLvl6.active) dcPotsApply(dcPotsAllLvl6, false);
    else dcPotsRevert(dcPotsAllLvl6);
    renderEffectsPanel();
    renderFormulaBar();
    dcRender();
    dcRefreshEI();
    dcNotifyAnalytics();
};

// Descriptors for the quick-toggle rows rendered under the character list
const DC_QUICK_TOGGLES = [
    {
        label: 'Pots Max Lvl 6',
        title: 'Force every Potentials above level 6 to level 6',
        enableStyle: true,           // shows 'Enable' when off
        strikeWhenActive: false,
        isActive: () => dcPotsMaxLvl6.active,
        onclick: 'dcTogglePotsMaxLvl6()',
    },
    {
        label: 'Pots All Lvl 6',
        title: 'Force every Potentials to level 6',
        enableStyle: true,
        strikeWhenActive: false,
        isActive: () => dcPotsAllLvl6.active,
        onclick: 'dcTogglePotsAllLvl6()',
    },
    {
        label: 'Boss Blitz',
        title: 'Disable all Boss Blitz effects',
        enableStyle: false,
        strikeWhenActive: true,
        isActive: () => dcGroupEffectKeys.has('bossblitz'),
        onclick: "dcToggleGroupDisable('bossblitz')",
    },
    {
        label: 'Talents',
        title: 'Disable all Talent effects',
        enableStyle: false,
        strikeWhenActive: true,
        isActive: () => dcGroupEffectKeys.has('talents'),
        onclick: "dcToggleGroupDisable('talents')",
    },
];

// Effect keys dcToggleChar would disable for this char: the memoized set if
// the char was toggled before, otherwise computed the same way (source owned
// by the char via dcCharOwnsSource).
function dcCharOwnedEffectKeys(name) {
    if (dcCharEffectKeys.has(name)) return dcCharEffectKeys.get(name);
    const keys = new Set();
    for (const ef of dcCollectAttrFixEffects(dcFiltered)) {
        if (dcCharOwnsSource(name, ef.source)) keys.add(ef.key);
    }
    return keys;
}

// For each character, compute (Total Calc) − (Total Calc with that character
// disabled), faithfully simulating dcToggleChar: the char's own hits are zeroed
// (dcCharsDisabled check in dcApplyEffectOverrides) and its owned effect keys
// are added to the disabled set, which also affects other characters' hits.
function dcComputeCharDeltas(list) {
    const deltas = {};
    let baseTotal = 0;
    list.forEach(n => { deltas[n] = 0; });
    if (!dcFiltered.length || !list.length) return { baseTotal, deltas };

    // Base pass: current Total Calc + per-attacker contribution under the
    // current state (a currently-disabled char contributes 0 here).
    const sums = new Map();
    for (const ev of dcFiltered) {
        const f = calcHitFields(ev, null, dcEffectsDisabled, dcEffectLevelOverrides);
        const d = calcDamage(f, dcBonus, dcDisabled);
        baseTotal += d;
        const att = ev.AttackerDisplay || ev.Attacker || '';
        sums.set(att, (sums.get(att) || 0) + d);
    }

    for (const name of list) {
        // Zeroing the char's own hits:
        let totalIf = baseTotal - (sums.get(name) || 0);
        // Its owned effects also get disabled (may affect other hits):
        const owned = dcCharOwnedEffectKeys(name);
        if (owned.size) {
            const merged = new Set(dcEffectsDisabled);
            for (const k of owned) merged.add(k);
            if (merged.size !== dcEffectsDisabled.size) {
                let t = 0;
                for (const ev of dcFiltered) {
                    const att = ev.AttackerDisplay || ev.Attacker || '';
                    if (att === name) continue;
                    const f = calcHitFields(ev, null, merged, dcEffectLevelOverrides);
                    t += calcDamage(f, dcBonus, dcDisabled);
                }
                totalIf = t;
            }
        }
        deltas[name] = baseTotal - totalIf;
    }
    return { baseTotal, deltas };
}

function dcSyncCharEffectKeys() {
    for (const [charName, keys] of dcCharEffectKeys) {
        const newKeys = new Set();
        for (const ef of dcCollectAttrFixEffects(dcFiltered)) {
            if (dcCharOwnsSource(charName, ef.source)) newKeys.add(ef.key);
        }
        for (const k of newKeys) dcEffectsDisabled.add(k);
        for (const k of keys) {
            if (!newKeys.has(k)) dcEffectsDisabled.delete(k);
        }
        dcCharEffectKeys.set(charName, newKeys);
    }
}

function dcRenderCharList() {
    const el = document.getElementById('dcCharsList');
    if (!el) return;
    // Only attackers that actually deal Source Type = 'Player' hits
    // (sourceType 1 == 'Player', see damageSourceNames in dataLoader.js).
    // This hides enemy/monster actors like "..._Actor (skinId=...)".
    const chars = new Set();
    allEvents.filter(e => e.Type === 'Hit' && (e.HitConfig || {}).sourceType === 1).forEach(e => {
        const n = e.AttackerDisplay || e.Attacker;
        if (n) chars.add(n);
    });
    const list = [...chars].sort();
    if (list.length === 0) {
        el.innerHTML = '<div class="dc-effects-empty">No characters loaded.</div>';
        return;
    }

    // Live per-character delta: Total Calc minus Total Calc if that row were
    // disabled (only for these character rows, not the quick toggles below),
    // shown as a % of the current Total Calc, left-aligned next to the name.
    const { baseTotal, deltas } = dcComputeCharDeltas(list);

    let html = list.map(name => {
        const off = dcCharsDisabled.has(name);
        const escName = name.replace(/'/g, "\\'");
        const delta = deltas[name] || 0;
        // Same convention as the sidebar Compare rows: how much larger the
        // current Total Calc is than the Total Calc with this char disabled.
        const pct = (baseTotal - delta) > 0 ? ((baseTotal / (baseTotal - delta)) - 1) * 100 : null;
        const deltaStr = pct != null
            ? `<span class="dc-char-delta" title="Total Calc minus Total Calc with this character disabled (its hits zeroed + its owned effects disabled): ${delta >= 0 ? '+' : ''}${Math.round(delta).toLocaleString()}">${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%</span>`
            : '';
        return `<div class="dc-char-row${off ? ' disabled' : ''}">
            <span class="dc-char-name" title="${esc(name)}">${esc(name)}</span>
            ${deltaStr}
            <span class="dc-char-spacer"></span>
            <button class="dc-char-btn${off ? ' on' : ''}" onclick="dcToggleChar('${escName}')">${off ? 'Enable' : 'Disable'}</button>
        </div>`;
    }).join('');

    // ── Quick toggles ──
    html += `<div class="dc-quick-sep"></div>`;
    for (const t of DC_QUICK_TOGGLES) {
        const active = t.isActive();
        const strike = t.strikeWhenActive && active;
        const label = t.enableStyle
            ? (active ? 'Disable' : 'Enable')
            : (active ? 'Enable' : 'Disable');
        html += `<div class="dc-char-row${strike ? ' disabled' : ''}">
            <span class="dc-char-name" title="${esc(t.title)}">${esc(t.label)}</span>
            <span class="dc-char-spacer"></span>
            <button class="dc-char-btn${active ? ' on' : ''}" onclick="${t.onclick}" title="${esc(t.title)}">${label}</button>
        </div>`;
    }
    el.innerHTML = html;
}

window.dcToggleChar = function(name) {
    const turningOff = !dcCharsDisabled.has(name);
    if (turningOff) {
        dcCharsDisabled.add(name);
        const keys = new Set();
        for (const ef of dcCollectAttrFixEffects(dcFiltered)) {
            if (dcCharOwnsSource(name, ef.source)) keys.add(ef.key);
        }
        dcCharEffectKeys.set(name, keys);
        keys.forEach(k => dcEffectsDisabled.add(k));
    } else {
        dcCharsDisabled.delete(name);
        const keys = dcCharEffectKeys.get(name);
        if (keys) {
            keys.forEach(k => dcEffectsDisabled.delete(k));
            dcCharEffectKeys.delete(name);
        }
    }
    renderEffectsPanel();
    renderFormulaBar();
    dcRender();
    dcRefreshEI();
    dcNotifyAnalytics();
};

window.dcDisableAllEffects = function() {
    const effects = dcCollectAttrFixEffects(dcFiltered);
    if (effects.length === 0) return;
    effects.forEach(ef => dcEffectsDisabled.add(ef.key));
    renderEffectsPanel();
    renderFormulaBar();
    dcRender();
    dcRefreshEI();
    dcNotifyAnalytics();
};

window.dcEnableAllEffects = function() {
    dcEffectsDisabled.clear();
    for (const keys of dcCharEffectKeys.values()) keys.forEach(k => dcEffectsDisabled.add(k));
    for (const keys of dcGroupEffectKeys.values()) keys.forEach(k => dcEffectsDisabled.add(k));
    renderEffectsPanel();
    renderFormulaBar();
    dcRender();
    dcRefreshEI();
    dcNotifyAnalytics();
};

window.dcToggleSourceSection = function(gkey) {
    dcSourceOpenStates[gkey] = !dcSourceOpenStates[gkey];
    renderEffectsPanel();
};

window.dcToggleEffect = function(key) {
    if (dcEffectsDisabled.has(key)) dcEffectsDisabled.delete(key);
    else dcEffectsDisabled.add(key);
    renderEffectsPanel();
    renderFormulaBar();
    dcRender();
    dcRefreshEI();
    dcNotifyAnalytics();
};

// Reset a potential's user change to 0 (record page click).
window.dcResetPotLevelChange = function(potId) {
    const st = dcPotLevels.get(Number(potId));
    if (!st || !st.change) return;
    st.change = 0;
    renderEffectsPanel();
    renderFormulaBar();
    dcRender();
    dcRefreshEI();
    dcNotifyAnalytics();
};

// ± a character's skill-slot level (Skill Levels section / skill-scaled
// effect rows). Steps the slot's user `change` — every skill-scaled hit
// multiplier and effect of that slot moves together.
window.dcChangeSkillLevel = function(charId, slot, direction) {
    const st = dcSkillLevels.get(`${Number(charId)}:${Number(slot)}`);
    if (!st) return;
    const max = dcSkillMaxLevel(st);
    const curL = dcSkillEffectiveLevel(st);
    const newL = Math.min(Math.max(curL + direction, 0), max);
    if (newL === curL) return;
    st.change = (st.change || 0) + (newL - curL);
    renderEffectsPanel();
    renderFormulaBar();
    dcRender();
    dcRefreshEI();
    dcNotifyAnalytics();
};

// Reset a skill's user change to 0 (record page click).
window.dcResetSkillLevelChange = function(charId, slot) {
    const st = dcSkillLevels.get(`${Number(charId)}:${Number(slot)}`);
    if (!st || !st.change) return;
    st.change = 0;
    renderEffectsPanel();
    renderFormulaBar();
    dcRender();
    dcRefreshEI();
    dcNotifyAnalytics();
};

window.dcChangeEffectLevel = function(key, direction) {
    const effects = dcCollectAttrFixEffects(dcFiltered);
    const ef = effects.find(e => e.key === key);
    if (!ef || ef.configId == null) return;

    // Skill-scaled effect (levelTypeData 3): its level lives in the owning
    // character's skill level table — resolve the shared slot 2 by the
    // attacker's deployment role, then step that slot's CHANGE so the effect
    // and its hits move together.
    if (ef.levelTypeData === 3 && ef.levelData != null) {
        // owner-based: effects scale with their owner's skill (see
        // dcGetLevelOverride); once-attr rows with the hit's attacker
        const cid = ef.fromAttrDict ? (ef._charId ?? null) : (dcEffectOwnerCharId(ef.configId) ?? ef._charId);
        if (cid != null) {
            const slot = dcSkillSlotFor(ef.levelData, null, dcAttackerRoleSlot(cid));
            dcChangeSkillLevel(cid, slot, direction);
            return;
        }
    }

    // Potential entry: its level lives in the potential's level table
    // (recordLv + bonus + change) — step the CHANGE and every effect of that
    // potential moves with it. Clamped to the ladder range 0..9.
    if (ef.levelSource != null) {
        let st = dcPotLevels.get(ef.levelSource);
        if (!st) {
            // potential not in the record — derive its base from the logged entry
            const lo0 = ef.configId - (ef.configId % 1000);
            let loggedL = 0;
            if (ef.valueConfigId != null && ef.valueConfigId > lo0) {
                loggedL = Math.floor(((ef.valueConfigId - lo0) % 100) / 10);
            }
            if (loggedL <= 0) return;
            st = { potId: ef.levelSource, charId: null, recordLv: loggedL, bonus: 0, change: 0 };
            dcPotLevels.set(ef.levelSource, st);
        }
        const curL = dcPotEffectiveLevel(st);
        const newL = Math.min(Math.max(curL + direction, 0), 9);
        if (newL === curL) return;
        st.change = (st.change || 0) + (newL - curL);
        renderEffectsPanel();
        renderFormulaBar();
        dcRender();
        dcRefreshEI();
        dcNotifyAnalytics();
        return;
    }

    // Generic entry: per-entry level override in the level-table ladder.
    const effOverride = (typeof dcGetLevelOverride === 'function') ? dcGetLevelOverride(ef, ef.side) : null;
    const baseVcId = effOverride ? effOverride.newValueConfigId : ef.valueConfigId;

    let newVcId, newValue, newAttrType, newSubType;
    {
        // Generic level-table path
        if (!ef.allValueConfigIds || ef.allValueConfigIds.length < 2) return;
        const curVcId = effOverride ? effOverride.newValueConfigId : ef.valueConfigId;
        let curIdx = ef.allValueConfigIds.findIndex(v => v.valueConfigId === curVcId);
        if (curIdx < 0) curIdx = ef.currentLevelIdx;
        if (curIdx < 0) return;
        const newIdx = curIdx + direction;
        if (newIdx < 0 || newIdx >= ef.allValueConfigIds.length) return;
        newVcId = ef.allValueConfigIds[newIdx].valueConfigId;
        const ev = effectValueTable.get(newVcId);
        if (!ev || ev.value == null) return;
        newValue = ev.value;
        newAttrType = ev.attrType != null ? ev.attrType : ef.attrType;
        newSubType  = ev.subType  != null ? ev.subType  : ef.subType;
    }

    if (newValue == null) return;

    // Write the override under the key dcGetLevelOverride looks up. For
    // attrDict rows the collected key carries the "dict:" marker and the
    // slotNum suffix, but resolution reads "<side>:<configId>:<vcid>" —
    // writing under ef.key made per-entry level overrides silently inert.
    const ovKey = ef.fromAttrDict
        ? `${ef.side}:${ef.configId}:${ef.valueConfigId ?? ''}`
        : key;

    // If overriding back to the original valueConfigId, remove the override
    if (newVcId === ef.valueConfigId) {
        dcEffectLevelOverrides.delete(ovKey);
    } else {
        dcEffectLevelOverrides.set(ovKey, {
            newValueConfigId: newVcId,
            newValue,
            newAttrType: newAttrType != null ? newAttrType : ef.attrType,
            newSubType: newSubType  != null ? newSubType  : ef.subType,
        });
    }

    renderEffectsPanel();
    renderFormulaBar();
    dcRender();
    dcRefreshEI();
    dcNotifyAnalytics();
};


// ─── Dmg Calc totals (sidebar) ────────────────────────────────────────────────
function dcRenderTotals() {
    const el = document.getElementById('dcSidebarTotals');
    if (!el) return;
    let totalCalc = 0, totalGame = 0;
    let minMs = Infinity, maxMs = -Infinity;
    dcFiltered.forEach(ev => {
        const f = calcHitFields(ev, null, dcEffectsDisabled, dcEffectLevelOverrides);
        totalCalc += calcDamage(f, dcBonus, dcDisabled);
        totalGame += f.finalDamage;
        const ms = parseTimeToMs(ev.Time);
        if (ms < minMs) minMs = ms;
        if (ms > maxMs) maxMs = ms;
    });
    const secs = (minMs !== Infinity && maxMs > minMs) ? (maxMs - minMs) / 1000 : 0;
    const dps = secs > 0 ? Math.floor(totalGame / secs) : Math.floor(totalGame);
    const overallDiff = totalGame > 0 ? ((totalCalc / totalGame) - 1) * 100 : null;
    const d1 = overallDiff != null
        ? `<span class="${Math.abs(overallDiff) < 0.05 ? 'dc-diff-close' : overallDiff < 0 ? 'dc-diff-neg' : 'dc-diff-pos'}" style="margin-left:4px">(${overallDiff >= 0 ? '+' : ''}${overallDiff.toFixed(1)}%)</span>`
        : '';
    const overallDiff2 = totalCalc > 0 ? ((totalGame / totalCalc) - 1) * 100 : null;
    const d2 = overallDiff2 != null
        ? `<span class="${Math.abs(overallDiff2) < 0.05 ? 'dc-diff-close' : overallDiff2 < 0 ? 'dc-diff-neg' : 'dc-diff-pos'}" style="margin-left:4px">(${overallDiff2 >= 0 ? '+' : ''}${overallDiff2.toFixed(1)}%)</span>`
        : '';
    _dcLastTotalCalc = totalCalc;

    // Compare rows: the snapshotted Total Calc value + its % difference vs the
    // current Total Calc, with a small ✕ on the left
    let compareRows = '';
    for (const c of dcCompares) {
        const pct = c.value > 0 ? ((totalCalc / c.value) - 1) * 100 : null;
        const pctStr = pct != null
            ? ` <span class="${Math.abs(pct) < 0.05 ? 'dc-diff-close' : pct < 0 ? 'dc-diff-neg' : 'dc-diff-pos'}" style="margin-left:4px">(${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)</span>`
            : '';
        compareRows +=
            `<span class="dc-compare-row">` +
            `<button class="dc-compare-del" onclick="dcDeleteCompare(${c.id})" title="Remove this compare">✕</button>` +
            `<span class="dc-compare-name" id="dcCmpName${c.id}" title="Click to rename" onclick="dcRenameCompare(${c.id})">${esc(c.name)}</span>` +
            `: <strong>${Math.round(c.value).toLocaleString()}</strong>${pctStr}` +
            `</span>`;
    }
    // Separator line above Total In-Game, only when compare rows are present
    const compareSep = dcCompares.length ? `<span class="dc-compare-sep"></span>` : '';

    el.innerHTML = `
        <span style="display:flex;align-items:center;justify-content:space-between"><span>Total Calc: <strong>${Math.round(totalCalc).toLocaleString()}</strong>${d1}</span><button class="dc-compare-btn" onclick="dcAddCompare()" title="Save the current Total Calc as a compare entry">Save to Compare</button></span>
        ${compareRows}
        ${compareSep}
        <span style="display:block">Total In-Game: <strong>${Math.round(totalGame).toLocaleString()}</strong>${d2}</span>
        <span style="display:block">Time: <strong>${secs.toFixed(1)}s</strong></span>
        <span style="display:block">DPS: <strong>${dps.toLocaleString()}</strong></span>
    `;
}

function dcRefreshEI() {
    const el = document.getElementById('eiPanel');
    if (el && el.classList.contains('visible') && typeof eiRender === 'function') {
        eiRender();
    }
}

// ── Shared processed hits for Analytics ────────────────────────────────────────
// Returns the dmgCalc-filtered, effect-adjusted player hits as lightweight
// records whose .DamageParams.finalDamage is replaced by the recalculated
// damage (calcDamage), so Analytics aggregates the same numbers the Dmg Calc
// tab shows. All other original fields (HitConfig, buffs, effects…) are kept by
// reference so the buff/effect charts keep working unchanged.
function getCalcHits() {
    const evs = dcApplyFilters();
    const out = [];
    for (const ev of evs) {
        const hc = ev.HitConfig || {};
        if (hc.sourceType !== 1) continue; // player hits only
        const fields = calcHitFields(ev, null, dcEffectsDisabled, dcEffectLevelOverrides);
        const calcDmg = calcDamage(fields, dcBonus, dcDisabled);
        out.push({
            ...ev,
            DamageParams: Object.assign({}, ev.DamageParams, { finalDamage: calcDmg }),
            _fields: fields,
            _calcDmg: calcDmg,
        });
    }
    return out;
}

// Refresh the Analytics tab when a dmgCalc control changes while it's visible.
function dcNotifyAnalytics() {
    if (typeof activeTab !== 'undefined' && activeTab === 'analytics' && typeof Analytics !== 'undefined') {
        Analytics.refresh();
    }
    if (typeof activeTab !== 'undefined' && activeTab === 'analytics' && typeof eiRenderSidebarChips === 'function') {
        eiRenderSidebarChips();
    }
}

// ─── Formula bar rendering ────────────────────────────────────────────────────
function renderFormulaBar() {
    const bar = document.getElementById('dcFormulaBar');
    if (!bar) return;
    dcRenderTotals();
    // Keep the per-character Total Calc deltas live (bonuses/field toggles
    // change Total Calc without going through renderEffectsPanel).
    dcRenderCharList();
    let html = `<div class="dc-formula-row">`;


    const FORMULA_DISPLAY = [
        { key: 'multiplier' }, { sep: '×' },
        { key: 'baseAtk' }, { sep: '×' },
        { key: 'atkPct' }, { sep: '×' },
        { key: 'elemPct' }, { sep: '×' },
        { key: 'elemTakenPct' }, { sep: '×' },
        { key: 'dmgTypePct' }, { sep: '×' },
        { key: 'dmgTypeTakenPct' }, { sep: '×' },
        { key: 'critRate', critRateToggle: true }, { sep: '/' },
        { key: 'critDmg' }, { sep: '×' },
        { key: 'penRes', penResCompound: true }, { sep: '×' },
        { key: 'effectiveDef', effDefDisplay: true }, { sep: '→' },
        { key: 'defAmend' }, { sep: '×' },
        { key: 'envAmend' }, { sep: '=' },
        { result: true },
    ];

    for (const item of FORMULA_DISPLAY) {
        if (item.sep) {
            html += `<span class="dc-sep">${item.sep}</span>`;
        } else if (item.result) {
            html += `<span class="dc-field dc-result-label" data-key="__result">Dmg</span>`;
        } else if (item.penResCompound) {
            const dis = dcDisabled.has('penRes');
            const penBonus = dcBonus['pen'] || 0;
            const resBonus = dcBonus['res'] || 0;
            html += `<div class="dc-field-wrap dc-penres-wrap" data-key="penRes">
                <div class="dc-penres-inputs">
                    <span class="dc-penres-label">Pen</span>
                    <input class="dc-bonus-input" type="number" step="any" placeholder="+0"
                        value="${penBonus !== 0 ? penBonus : ''}"
                        onchange="dcSetBonus('pen', this.value)"
                        onclick="event.stopPropagation()">
                    <span class="dc-penres-label">Res</span>
                    <input class="dc-bonus-input" type="number" step="any" placeholder="+0"
                        value="${resBonus !== 0 ? resBonus : ''}"
                        onchange="dcSetBonus('res', this.value)"
                        onclick="event.stopPropagation()">
                </div>
                <span class="dc-field${dis ? ' dc-disabled' : ''}"
                    data-key="penRes"
                    onclick="dcToggleField('penRes')"
                    title="${dis ? 'Click to re-enable' : 'Click to disable'}"
                >${DC_FIELDS.find(f => f.key === "penRes").label}</span>
            </div>`;
        } else if (item.critRateToggle) {
            const dis = dcDisabled.has('critRate');
            const bonus = dcBonus['critRate'] || 0;
            const titleMsg = dis
                ? 'Click to re-enable (reverts to per-hit isCrit check)\nCurrently: using CritRate×(CritDmg−1) as expected multiplier'
                : 'Click to disable per-hit crit check\nWill use CritRate×(CritDmg−1) as expected multiplier instead';
            html += `<div class="dc-field-wrap" data-key="critRate">
                <input class="dc-bonus-input" type="number" step="any" placeholder="+0"
                    value="${bonus !== 0 ? bonus : ''}"
                    data-key="critRate"
                    onchange="dcSetBonus('critRate', this.value)"
                    onclick="event.stopPropagation()">
                <span class="dc-field${dis ? ' dc-disabled' : ''}"
                    data-key="critRate"
                    onclick="dcToggleField('critRate')"
                    title="${titleMsg}"
                >CritRate</span>
            </div>`;
        } else if (item.effDefDisplay) {
            const bonus = dcBonus['effectiveDef'] || 0;
            html += `<div class="dc-field-wrap" data-key="effectiveDef">
                <input class="dc-bonus-input" type="number" step="any" placeholder="+0"
                    value="${bonus !== 0 ? bonus : ''}"
                    data-key="effectiveDef"
                    onchange="dcSetBonus('effectiveDef', this.value)"
                    onclick="event.stopPropagation()"
                    title="Adjust EffDEF — DEF multiplier recalculates live">
                <span class="dc-field dc-display-only"
                    data-key="effectiveDef"
                    title="Display only — adjust via bonus input to affect DEF multiplier"
                >EffDEF</span>
            </div>`;
        } else {
            const fd = DC_FIELDS.find(f => f.key === item.key);
            const dis = dcDisabled.has(item.key);
            const bonus = dcBonus[item.key] || 0;
            html += `<div class="dc-field-wrap" data-key="${item.key}">
                <input class="dc-bonus-input" type="number" step="any" placeholder="+0"
                    value="${bonus !== 0 ? bonus : ''}"
                    data-key="${item.key}"
                    onchange="dcSetBonus('${item.key}', this.value)"
                    onclick="event.stopPropagation()">
                <span class="dc-field${dis ? ' dc-disabled' : ''}"
                    data-key="${item.key}"
                    onclick="dcToggleField('${item.key}')"
                    title="${dis ? 'Click to re-enable' : 'Click to disable'}"
                >${esc(fd ? fd.label : item.key)}</span>
            </div>`;
        }
    }
    html += `</div>`;
    bar.innerHTML = html;
}

window.dcToggleField = function(key) {
    if (dcDisabled.has(key)) dcDisabled.delete(key);
    else dcDisabled.add(key);
    renderFormulaBar();
    dcRender();
    dcRefreshEI();
    dcNotifyAnalytics();
};

window.dcSetBonus = function(key, val) {
    const n = parseFloat(val);
    dcBonus[key] = isNaN(n) ? 0 : n;
    renderFormulaBar();
    dcRender();
    dcRefreshEI();
    dcNotifyAnalytics();
};

// ─── Per-hit event DOM ────────────────────────────────────────────────────────
const DISPLAY_ORDER = [
    'multiplier','baseAtk','atkPct','elemPct','elemTakenPct',
    'dmgTypePct','dmgTypeTakenPct','critRate','critDmg',
    'penRes','effectiveDef','defAmend','envAmend'
];

function dcCreateEventDiv(ev, fi) {
    const oi = ev._origIndex;
    const isOpen = dcOpenStates[oi] || false;
    const hc = ev.HitConfig   || {};
    const dp = ev.DamageParams || {};

    const fields   = calcHitFields(ev, null, dcEffectsDisabled, dcEffectLevelOverrides);
    const calcDmg  = calcDamage(fields, dcBonus, dcDisabled);

    const attName  = esc(ev.AttackerDisplay || ev.Attacker || '?');
    const skillPart = hc.skillTitle ? esc(hc.skillTitle) : '';
    const hitPart   = hc.hitNum != null ? ` (#${hc.hitNum})` : '';
    const skillStr  = (skillPart || hitPart) ? ` - ${skillPart}${hitPart}` : '';
    const baseMult  = dp.skillPercentAmend != null ? ` [${(dp.skillPercentAmend/10000).toFixed(2)}%]` : '';
    const snapAge = ev.SnapshotAt ? ` [${((parseTimeToMs(ev.Time)-parseTimeToMs(ev.SnapshotAt))/1000).toFixed(3)}s ago]` : '';

    const div = document.createElement('div');
    div.className = 'event dc-event' + (isOpen ? ' open' : '');
    div.style.top = dcFenwick.prefixSum(fi - 1) + 'px';
    div.dataset.origIndex     = oi;
    div.dataset.filteredIndex = fi;

    // ── Header ──
    const header = document.createElement('div');
    header.className = 'event-header dc-event-header';

    const topRow = document.createElement('div');
    topRow.className = 'dc-header-top';

    const leftDiv = document.createElement('div');
    leftDiv.className = 'dc-header-left';
    leftDiv.innerHTML = `<span class="dc-att-name">${attName}${skillStr}${baseMult}${snapAge}</span>`;

    topRow.appendChild(leftDiv);

    // Field values row
    const fvRow = document.createElement('div');
    fvRow.className = 'dc-fields-row';

    const fvs = hitFieldValues(fields, dcBonus);
    for (let i = 0; i < DISPLAY_ORDER.length; i++) {
        const key = DISPLAY_ORDER[i];
        const fvEntry = fvs.find(f => f.key === key);
        const bonus = dcBonus[key] || 0;
        const rawVal = fvEntry ? fvEntry.val : null;
        const skipBonusLabel = (key === 'effectiveDef' || key === 'defAmend');
        const dispVal = (bonus !== 0 && !skipBonusLabel)
            ? `${fmtVal(rawVal, key)} <span class="dc-bonus-label">(+${fmtVal(bonus, key)})</span>`
            : fmtVal(rawVal, key);
        const dis = dcDisabled.has(key);
        const isDisplayOnly = key === 'effectiveDef' || DC_FIELDS.find(f => f.key === key)?.display_only;
        const cell = document.createElement('div');
        cell.className = 'dc-field-cell' + (dis ? ' dc-disabled' : '') + (isDisplayOnly ? ' dc-display-only' : '');
        cell.dataset.key = key;
        cell.innerHTML = dispVal;
        fvRow.appendChild(cell);
    }

    // Result cells
    const calcCell = document.createElement('div');
    calcCell.className = 'dc-field-cell dc-result-cell';
    calcCell.innerHTML = `<span class="dc-calc">${Math.round(calcDmg).toLocaleString()}</span>`;

    const gameCell = document.createElement('div');
    gameCell.className = 'dc-field-cell dc-game-cell';
    gameCell.innerHTML = `<span class="dc-game">${Number(fields.finalDamage).toLocaleString()}</span>`;

    const diffPct = fields.finalDamage > 0
        ? ((calcDmg / fields.finalDamage - 1) * 100)
        : null;
    const diffCell = document.createElement('div');
    diffCell.className = 'dc-field-cell dc-diff-cell';
    if (diffPct != null) {
        const cls = Math.abs(diffPct) < 0.05 ? 'dc-diff-close' : diffPct < 1 ? 'dc-diff-neg' : 'dc-diff-pos';
        diffCell.innerHTML = `<span class="${cls}">${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(1)}%</span>`;
    }

    const resultStack = document.createElement('div');
    resultStack.className = 'dc-result-stack';
    resultStack.appendChild(calcCell);
    resultStack.appendChild(gameCell);
    resultStack.appendChild(diffCell);

    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.textContent = '▶';
    topRow.appendChild(arrow);

    header.appendChild(topRow);
    header.appendChild(fvRow);
    header.appendChild(resultStack);

    header.addEventListener('click', e => { e.stopPropagation(); dcToggleEvent(oi); });

    // ── Body ──
    const body = document.createElement('div');
    body.className = 'event-body';
    if (isOpen) body.innerHTML = buildEventBody(ev);

    div.appendChild(header);
    div.appendChild(body);
    return div;
}

function dcToggleEvent(origIndex) {
    const el = dcContent.querySelector(`.dc-event[data-orig-index="${origIndex}"]`);
    if (!el) return;
    const fi = parseInt(el.dataset.filteredIndex);
    const savedScroll = dcContainer.scrollTop;
    const wasOpen = dcOpenStates[origIndex] || false;

    if (wasOpen) {
        dcOpenStates[origIndex] = false;
        el.querySelector('.event-body').innerHTML = '';
        el.classList.remove('open');
        const topOfThis = dcFenwick.prefixSum(fi - 1);
        const rel = savedScroll - topOfThis;
        const delta = dcUpdateHeight(fi, DC_EST);
        delete dcMeasuredHeights[origIndex];
        dcShiftAfter(fi, delta);
        dcContainer.scrollTop = topOfThis + rel;
    } else {
        dcOpenStates[origIndex] = true;
        const body = el.querySelector('.event-body');
        body.innerHTML = buildEventBody(allEvents[origIndex]);
        el.classList.add('open');
        requestAnimationFrame(() => {
            const actual = el.getBoundingClientRect().height;
            if (actual > 0) {
                dcMeasuredHeights[origIndex] = actual;
                const delta = dcUpdateHeight(fi, actual);
                if (Math.abs(delta) > 0.5) {
                    dcShiftAfter(fi, delta);
                    const maxScroll = dcTotalHeight - dcContainer.clientHeight;
                    dcContainer.scrollTop = Math.min(savedScroll, Math.max(0, maxScroll));
                    dcRender();
                }
            }
        });
    }
}

function dcShiftAfter(startFi, delta) {
    dcContent.querySelectorAll('.dc-event').forEach(el => {
        const idx = parseInt(el.dataset.filteredIndex);
        if (!isNaN(idx) && idx > startFi) {
            el.style.top = (parseFloat(el.style.top) + delta) + 'px';
        }
    });
}

// Sub-section toggle inside dc event body
dcContent.addEventListener('click', e => {
    const toggle = e.target.closest('.collapsible-toggle');
    if (!toggle) return;
    e.stopPropagation();
    const targetId = toggle.dataset.target;
    const contentEl = document.getElementById(targetId);
    if (!contentEl) return;
    const isOpen = toggle.classList.toggle('open');
    contentEl.style.display = isOpen ? 'block' : 'none';

    const eventDiv = toggle.closest('.dc-event');
    if (!eventDiv) return;
    const oi = parseInt(eventDiv.dataset.origIndex);
    const fi = parseInt(eventDiv.dataset.filteredIndex);
    const key = `dc_${oi}_${targetId}`;
    dcSubOpenStates[key] = isOpen;

    const savedScroll = dcContainer.scrollTop;
    requestAnimationFrame(() => {
        const actual = eventDiv.getBoundingClientRect().height;
        if (actual > 0 && !isNaN(fi)) {
            const delta = dcUpdateHeight(fi, actual);
            dcMeasuredHeights[oi] = actual;
            if (Math.abs(delta) > 0.5) dcShiftAfter(fi, delta);
        }
        const maxScroll = dcTotalHeight - dcContainer.clientHeight;
        dcContainer.scrollTop = Math.min(savedScroll, Math.max(0, maxScroll));
    });
});

// ─── Virtual scroll render ────────────────────────────────────────────────────
function dcRender() {
    if (!dcFiltered.length) { dcContent.innerHTML = ''; return; }

    const scrollTop = dcContainer.scrollTop;
    const viewH = dcContainer.clientHeight;
    const startIdx = dcFindIndex(scrollTop);
    let start = Math.max(0, startIdx - DC_BUFFER);
    const endIdx = dcFindIndex(scrollTop + viewH);
    let end = Math.min(dcFiltered.length, endIdx + DC_BUFFER);
    if (start >= dcFiltered.length) start = Math.max(0, dcFiltered.length - 1);

    const neededOrig = new Set();
    const origToFi = new Map();
    for (let i = start; i < end; i++) {
        neededOrig.add(dcFiltered[i]._origIndex);
        origToFi.set(dcFiltered[i]._origIndex, i);
    }

    const existing = dcContent.querySelectorAll('.dc-event');
    for (const el of existing) {
        const oi = parseInt(el.dataset.origIndex);
        if (neededOrig.has(oi)) {
            const fi = origToFi.get(oi);
            el.dataset.filteredIndex = fi;
            const newTop = dcFenwick.prefixSum(fi - 1);
            if (el.style.top !== newTop + 'px') el.style.top = newTop + 'px';
            const shouldOpen = dcOpenStates[oi] || false;
            const isOpen = el.classList.contains('open');
            if (shouldOpen !== isOpen) {
                el.classList.toggle('open', shouldOpen);
                const body = el.querySelector('.event-body');
                if (body) {
                    if (shouldOpen && body.innerHTML.trim() === '') body.innerHTML = buildEventBody(allEvents[oi]);
                    else if (!shouldOpen) body.innerHTML = '';
                }
            }
            // Refresh calc values in header (bonuses may have changed)
            const fvRow = el.querySelector('.dc-fields-row');
            if (fvRow) {
                const ev = allEvents[oi];
                const fields  = calcHitFields(ev, null, dcEffectsDisabled, dcEffectLevelOverrides);
                const calcDmg = calcDamage(fields, dcBonus, dcDisabled);
                const fvs     = hitFieldValues(fields, dcBonus);
                const cells   = fvRow.querySelectorAll('.dc-field-cell');
                let ci = 0;
                for (const key of DISPLAY_ORDER) {
                    const cell = cells[ci++];
                    if (!cell) continue;
                    const fv = fvs.find(f => f.key === key);
                    const showBonus = dcBonus[key] || 0;
                    const rawVal = fv ? fv.val : null;
                    const skipBonusLabel = (key === 'effectiveDef' || key === 'defAmend');
                    cell.innerHTML = (showBonus !== 0 && !skipBonusLabel)
                        ? `${fmtVal(rawVal, key)} <span class="dc-bonus-label">(${fmtVal(showBonus, key) >= 0 ? '+' : ''}${fmtVal(showBonus, key)})</span>`
                        : fmtVal(rawVal, key);
                    const isDisplayOnly = key === 'effectiveDef' || DC_FIELDS.find(f => f.key === key)?.display_only;
                    cell.className = 'dc-field-cell' +
                        (dcDisabled.has(key) ? ' dc-disabled' : '') +
                        (isDisplayOnly ? ' dc-display-only' : '');
                }
                const calcCell = el.querySelector('.dc-result-cell');
                const gameCell = el.querySelector('.dc-game-cell');
                const diffCell = el.querySelector('.dc-diff-cell');
                if (calcCell) calcCell.innerHTML = `<span class="dc-calc">${Math.round(calcDmg).toLocaleString()}</span>`;
                if (gameCell) gameCell.innerHTML = `<span class="dc-game">${Number(fields.finalDamage).toLocaleString()}</span>`;
                if (diffCell) {
                    const diffPct = fields.finalDamage > 0 ? ((calcDmg / fields.finalDamage - 1) * 100) : null;
                    if (diffPct != null) {
                        const cls = Math.abs(diffPct) < 0.05 ? 'dc-diff-close' : diffPct < 1 ? 'dc-diff-neg' : 'dc-diff-pos';
                        diffCell.innerHTML = `<span class="${cls}">${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(1)}%</span>`;
                    }
                }
            }
            neededOrig.delete(oi);
        } else {
            el.remove();
        }
    }

    for (const oi of neededOrig) {
        const fi = dcFiltered.findIndex(e => e._origIndex === oi);
        if (fi === -1) continue;
        const div = dcCreateEventDiv(allEvents[oi], fi);
        dcContent.appendChild(div);
    }
}

let dcScrollScheduled = false;
dcContainer.addEventListener('scroll', () => {
    if (dcScrollScheduled) return;
    dcScrollScheduled = true;
    requestAnimationFrame(() => { dcRender(); dcScrollScheduled = false; });
});

// ─── Filter helpers ───────────────────────────────────────────────────────────
function dcBuildCharFilter() {
    const all = new Set();
    allEvents.filter(e => e.Type === 'Hit').forEach(e => {
        if (e.AttackerDisplay) all.add(e.AttackerDisplay);
    });
    const sel = document.getElementById('dcCharFilter');
    const prev = dcCharFilter;
    sel.innerHTML = '<option value="">All Characters</option>';
    [...all].sort().forEach(c => {
        const o = document.createElement('option');
        o.value = c; o.textContent = c; sel.appendChild(o);
    });
    if ([...sel.options].some(o => o.value === prev)) {
        sel.value = prev;
        dcCharFilter = prev;
    } else if (!prev) {
        sel.value = '';
        dcCharFilter = '';
    } else {
        // prev has no hits under the other active filters — keep it in the
        // list so it stays visible and can be changed back to All instead
        // of leaving the filter stuck on a value with no matching option.
        const o = document.createElement('option');
        o.value = prev; o.textContent = prev;
        sel.appendChild(o);
        sel.value = prev;
    }
}

function dcBuildSkillFilter(evs) {
    const all = new Set();
    evs.forEach(e => {
        const n = (e.HitConfig || {}).skillTitle;
        if (n) all.add(n);
    });
    const sel = document.getElementById('dcSkillFilter');
    const prev = dcSkillFilter;
    sel.innerHTML = '<option value="">All Skills</option>';
    const MAX = 28;
    [...all].sort().forEach(s => {
        const o = document.createElement('option');
        o.value = s;
        o.textContent = s.length > MAX ? s.slice(0, MAX) + '…' : s;
        o.title = s;
        sel.appendChild(o);
    });
    if ([...sel.options].some(o => o.value === prev)) {
        sel.value = prev;
        dcSkillFilter = prev;
    } else if (!prev) {
        sel.value = '';
        dcSkillFilter = '';
    } else {
        // prev skill has no hits under the other active filters (e.g. char
        // switched) — keep it in the list so it stays visible and can be
        // changed back to All instead of leaving the filter stuck.
        const o = document.createElement('option');
        o.value = prev;
        o.textContent = prev.length > MAX ? prev.slice(0, MAX) + '…' : prev;
        o.title = prev;
        sel.appendChild(o);
        sel.value = prev;
    }
}

function dcBuildDamageTypeFilter(evs) {
    const all = new Set();
    evs.forEach(e => {
        if (e.HitConfig && e.HitConfig.damageType != null) {
            all.add(e.HitConfig.damageType);
        }
    });
    const sel = document.getElementById('dcDamageTypeFilter');
    const prev = dcDamageTypeFilter;
    sel.innerHTML = '<option value="">All Damage Types</option>';
    const MAX = 28;
    [...all].sort((a, b) => a - b).forEach(dt => {
        const o = document.createElement('option');
        o.value = dt;
        const label = dtName(dt);
        o.textContent = label.length > MAX ? label.slice(0, MAX) + '…' : label;
        o.title = label;
        sel.appendChild(o);
    });
    if ([...sel.options].some(o => o.value === prev)) {
        sel.value = prev;
        dcDamageTypeFilter = prev;
    } else if (!prev) {
        sel.value = '';
        dcDamageTypeFilter = '';
    } else {
        // prev damage type has no hits under the other active filters (e.g.
        // AA picked for Chitose, then switched to a char with no AA hits) —
        // keep it in the list so it stays visible and can be changed back
        // to All instead of leaving the filter stuck.
        const o = document.createElement('option');
        o.value = prev;
        const prevLabel = dtName(prev);
        o.textContent = prevLabel.length > MAX ? prevLabel.slice(0, MAX) + '…' : prevLabel;
        o.title = prevLabel;
        sel.appendChild(o);
        sel.value = prev;
    }
}

function dcBuildDefenderFilter(autoSelect = false) {
    const dmgTotals = {};
    allEvents.filter(e => e.Type === 'Hit').forEach(e => {
        const name = e.DefenderDisplay || e.Defender;
        if (!name) return;
        const key = cleanOwner ? cleanOwner(name) : name;
        const dmg = (e.DamageParams && e.DamageParams.finalDamage) || 0;
        dmgTotals[key] = (dmgTotals[key] || 0) + dmg;
    });
    const all = Object.keys(dmgTotals);
    const sel = document.getElementById('dcDefenderFilter');
    const prev = dcDefenderFilter;
    sel.innerHTML = '<option value="">All Defenders</option>';
    const MAX = 28;
    [...all].sort().forEach(c => {
        const o = document.createElement('option');
        o.value = c;
        o.textContent = c.length > MAX ? c.slice(0, MAX) + '…' : c;
        o.title = c;
        sel.appendChild(o);
    });
    if (autoSelect) {
        const top = all.sort((a, b) => dmgTotals[b] - dmgTotals[a])[0] || '';
        sel.value = top;
        dcDefenderFilter = top;
    } else if ([...sel.options].some(o => o.value === prev)) {
        sel.value = prev;
        dcDefenderFilter = prev;
    } else if (!prev) {
        const top = all.sort((a, b) => dmgTotals[b] - dmgTotals[a])[0] || '';
        sel.value = top;
        dcDefenderFilter = top;
    }
}

// Build a haystack for a hit matching the header title shown in the list,
// e.g. "Flora - Flutter Flare (#1) [209.00%]".
function dcHitSearchText(ev) {
    const hc = ev.HitConfig || {};
    const dp = ev.DamageParams || {};
    const attName = ev.AttackerDisplay || ev.Attacker || '?';
    const skillPart = hc.skillTitle ? hc.skillTitle : '';
    const hitPart = hc.hitNum != null ? ` (#${hc.hitNum})` : '';
    const skillStr = (skillPart || hitPart) ? ` - ${skillPart}${hitPart}` : '';
    const baseMult = dp.skillPercentAmend != null ? ` [${(dp.skillPercentAmend / 10000).toFixed(2)}%]` : '';
    return `${attName}${skillStr}${baseMult}`.toLowerCase();
}

function dcApplyFilters() {
    let evs = allEvents.filter(e => e.Type === 'Hit');
    if (dcCharFilter) evs = evs.filter(e => (e.AttackerDisplay || '') === dcCharFilter);
    dcBuildSkillFilter(evs);
    if (dcSkillFilter) evs = evs.filter(e => ((e.HitConfig || {}).skillTitle || '') === dcSkillFilter);
    dcBuildDamageTypeFilter(evs);
    if (dcDamageTypeFilter) evs = evs.filter(e => e.HitConfig && String(e.HitConfig.damageType) === dcDamageTypeFilter);
    if (dcDefenderFilter) {
        evs = evs.filter(e => {
            const name = e.DefenderDisplay || e.Defender;
            if (!name) return true;
            const key = cleanOwner ? cleanOwner(name) : name;
            return key === dcDefenderFilter;
        });
    }
    const q = dcSearchQuery.trim().toLowerCase();
    if (q) {
        const cached = new Map();
        evs = evs.filter(e => {
            let hay = cached.get(e);
            if (hay === undefined) { hay = dcHitSearchText(e); cached.set(e, hay); }
            return hay.includes(q);
        });
    }
    return evs;
}

window.dcOnCharFilterChange = function() {
    dcCharFilter = document.getElementById('dcCharFilter').value;
    dcSkillFilter = '';
    document.getElementById('dcSkillFilter').value = '';
    dcRefilterAndRender(true, false);
    dcNotifyAnalytics();
};
window.dcOnSkillFilterChange = function() {
    dcSkillFilter = document.getElementById('dcSkillFilter').value;
    dcRefilterAndRender(true, false);
    dcNotifyAnalytics();
};
window.dcOnDamageTypeFilterChange = function() {
    dcDamageTypeFilter = document.getElementById('dcDamageTypeFilter').value;
    dcRefilterAndRender(true, false);
    dcNotifyAnalytics();
};

window.dcOnDefenderFilterChange = function() {
    dcDefenderFilter = document.getElementById('dcDefenderFilter').value;
    dcRefilterAndRender(true, false);
    dcNotifyAnalytics();
};

// ─── Refilter / rebuild ───────────────────────────────────────────────────────
function dcRefilterAndRender(resetScroll = false, autoSelectDefender = true) {
    dcBuildCharFilter();
    dcBuildDefenderFilter(autoSelectDefender);
    dcFiltered = dcApplyFilters();
    if (resetScroll) {
        dcOpenStates = {};
        dcMeasuredHeights = {};
        dcSubOpenStates = {};
        dcContent.innerHTML = '';
        dcContainer.scrollTop = 0;
    }
    dcBuildFenwick();
    dcSyncCharEffectKeys();
    dcSyncQuickToggles();
    renderFormulaBar();
    renderEffectsPanel();
    document.getElementById('stats').textContent = `${dcFiltered.length} hits`;
    dcRender();
    dcRefreshEI();
}

// ─── Tab hook ─────────────────────────────────────────────────────────────────
const _origSwitchTab = window.switchTab;
window.switchTab = function(tab) {
    document.getElementById('tabDmgCalc').classList.toggle('active', tab === 'dmgcalc');
    document.getElementById('dmgCalcPanel').classList.toggle('visible', tab === 'dmgcalc');
    if (tab === 'dmgcalc') {
        dcRefilterAndRender(false);
    }
    _origSwitchTab(tab);
};

let _dcLastEffectKeys = null;
// Expose a hook so data loading can trigger a refresh when new events arrive.
// Updates hit list, formula-bar totals, and the effects panel only when
// the set of unique effects actually changes (no DOM thrashing on every poll).
window.dcRefreshIfVisible = function() {
    if (document.getElementById('dmgCalcPanel').classList.contains('visible')) {
        dcFiltered = dcApplyFilters();
        dcBuildFenwick();

        // Update totals in the formula bar without rebuilding the whole thing
        let totalCalc = 0, totalGame = 0;
        dcFiltered.forEach(ev => {
            const f = calcHitFields(ev, null, dcEffectsDisabled, dcEffectLevelOverrides);
            totalCalc += calcDamage(f, dcBonus, dcDisabled);
            totalGame += f.finalDamage;
        });
        const overallDiff = totalGame > 0 ? ((totalCalc / totalGame) - 1) * 100 : null;
        const overallDiff2 = totalCalc > 0 ? ((totalGame / totalCalc) - 1) * 100 : null;
        dcRenderTotals();

        // Keep char-disabled effect keys in sync as new effects appear
        dcSyncCharEffectKeys();
        dcSyncQuickToggles();

        // Only re-render effects panel when new unique effects actually appear
        const newEffects = dcCollectAttrFixEffects(dcFiltered);
        const newKeys = new Set(newEffects.map(e => e.key));
        if (!_dcLastEffectKeys || _dcLastEffectKeys.size !== newKeys.size || ![...newKeys].every(k => _dcLastEffectKeys.has(k))) {
            _dcLastEffectKeys = newKeys;
            renderEffectsPanel();
        }

        document.getElementById('stats').textContent = `${dcFiltered.length} hits`;
        dcRender();
    } else if (typeof activeTab !== 'undefined' && (activeTab === 'analytics' || activeTab === 'effectimpact')) {
        // Keep the shared right sidebar (totals, char list, effects panel) and
        // the effect-source chips fresh while the Dmg Calc panel itself is hidden.
        dcFiltered = dcApplyFilters();
        dcRenderTotals();
        dcRenderCharList();
        const newEffects = dcCollectAttrFixEffects(dcFiltered);
        const newKeys = new Set(newEffects.map(e => e.key));
        if (!_dcLastEffectKeys || _dcLastEffectKeys.size !== newKeys.size || ![...newKeys].every(k => _dcLastEffectKeys.has(k))) {
            _dcLastEffectKeys = newKeys;
            renderEffectsPanel();
        }
        if (typeof eiRenderSidebarChips === 'function') eiRenderSidebarChips();
    }
};
