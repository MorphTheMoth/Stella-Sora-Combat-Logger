// ─── dmgCalc.ui.js ────────────────────────────────────────────────────────────
// UI layer: virtual-scroll list, formula bar, effects panel, filters, DOM events.
// Depends on dmgCalc.calc.js being loaded first.

// ─── DC shared state ──────────────────────────────────────────────────────────
let dcFiltered = [];

// Which formula fields are "disabled" (struck through)
const dcDisabled = new Set();

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

// ─── DC filter state ─────────────────────────────────────────────────────────
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

// ─── Calc caching (sidebar hot path) ──────────────────────────────────────
// Every sidebar interaction re-renders totals, char rows and the visible hit
// rows; each used to run calcHitFields/calcDamage over ALL filtered hits
// (thousands of hits × several passes = seconds of jank). Results depend only
// on the event and the calc-affecting state (dcEffectsDisabled,
// dcEffectLevelOverrides, dcCharsDisabled, the pot/skill level tables,
// dcBonus, dcDisabled), which only mutates inside the handlers below — so:
//   - dcStateVersion is bumped once per state mutation (dcApplyAndRender and
//     the direct-mutation handlers),
//   - per-hit results live in a WeakMap until the version changes,
//   - the collected effect rows are memoized per dcFiltered array.
let dcStateVersion = 1;
function dcBumpCalcVersion() { dcStateVersion++; }

// ev -> { version, f, d } : calcHitFields + calcDamage for the current state
const _dcHitCalcCache = new WeakMap();
function dcCachedHitCalc(ev) {
    let c = _dcHitCalcCache.get(ev);
    if (c && c.version === dcStateVersion) return c;
    const f = calcHitFields(ev, null, dcEffectsDisabled, dcEffectLevelOverrides);
    const d = calcDamage(f, dcBonus, dcDisabled);
    c = { version: dcStateVersion, f, d };
    _dcHitCalcCache.set(ev, c);
    return c;
}

// Memoized dcCollectAttrFixEffects: valid while dcFiltered is the same array
// (dcApplyFilters always allocates a new array, so any refilter or newly
// arrived hit invalidates it). Callers only read the returned entries.
let _dcCollectCache = { src: null, len: -1, result: null };
function dcCollectAttrFixEffectsCached() {
    if (_dcCollectCache.src === dcFiltered && _dcCollectCache.len === dcFiltered.length && _dcCollectCache.result) {
        return _dcCollectCache.result;
    }
    _dcCollectCache = { src: dcFiltered, len: dcFiltered.length, result: dcCollectAttrFixEffects(dcFiltered) };
    return _dcCollectCache.result;
}

// Player attacker names, cached per allEvents snapshot (new polls grow it).
let _dcPlayerCharsCache = { src: null, len: -1, list: null };
function dcPlayerCharNames() {
    if (_dcPlayerCharsCache.src === allEvents && _dcPlayerCharsCache.len === allEvents.length && _dcPlayerCharsCache.list) {
        return _dcPlayerCharsCache.list;
    }
    const chars = new Set();
    allEvents.filter(isPlayerHit).forEach(e => {
        const n = e.AttackerDisplay || e.Attacker;
        if (n) chars.add(n);
    });
    _dcPlayerCharsCache = { src: allEvents, len: allEvents.length, list: [...chars].sort() };
    return _dcPlayerCharsCache.list;
}

// Keys whose disabling changes a hit's *level scaling* for potentially every
// hit of a potential / skill slot (pot row keys + skill bonus-row keys) —
// including hits that don't carry the key themselves. What-if passes may
// only skip hits via candidate keys when the disabled keys contain none of
// these.
let _dcCouplingKeys = { version: -1, keys: null };
function dcLevelCouplingKeys() {
    if (_dcCouplingKeys.version === dcStateVersion && _dcCouplingKeys.keys) return _dcCouplingKeys.keys;
    const s = new Set();
    for (const st of dcPotLevels.values()) if (st.potKey) s.add(st.potKey);
    for (const st of dcSkillLevels.values()) {
        for (const [rowKey] of (st.bonusByRow || [])) if (rowKey != null) s.add(rowKey);
    }
    _dcCouplingKeys = { version: dcStateVersion, keys: s };
    return s;
}

// Effect keys a hit consults when its stat overrides are applied (its own
// effect / record / attrDict lists + its Potentials group key — same key
// formats dcApplyEffectOverrides builds). Hit data is immutable, so this is
// cached per event forever. Superset of the consulted keys, so an empty
// intersection with a set of new disabled keys guarantees the hit is
// unaffected.
const _dcHitKeyCache = new WeakMap();
function dcHitCandidateKeys(ev) {
    let s = _dcHitKeyCache.get(ev);
    if (s) return s;
    s = new Set();
    const sides = [
        { side: 'attacker', list: ev.AttackerEffects?.effects, attrDict: ev.AttackerAttrDict },
        { side: 'attacker', list: ev.AttackerRecord?.effects },
        { side: 'defender', list: ev.DefenderEffects?.effects, attrDict: ev.DefenderAttrDict },
    ];
    for (const { side, list, attrDict } of sides) {
        if (list?.length) {
            for (const e of list) s.add(`${side}:${e.configId}:${e.valueConfigId ?? ''}`);
        }
        if (Array.isArray(attrDict)) {
            for (const e of attrDict) {
                const cid = e.configId ?? e.attrId;
                if (cid == null) continue;
                s.add(`${side}:dict:${cid}:${e.valueConfigId ?? ''}:${e.slotNum ?? 0}`);
            }
        }
    }
    const evSrc = ev.source ?? ev.HitConfig?.source ?? '';
    if (dcIsPotentialsSource(evSrc)) {
        s.add(`potentials:${ev.HitConfig?.skillTitle ?? 'Unknown'}`);
    }
    _dcHitKeyCache.set(ev, s);
    return s;
}

// Which source sections are open; default collapsed (keys added on first toggle)
const dcSourceOpenStates = {};

// ─── Virtual list ─────────────────────────────────────────────────────────────
// Shared VirtList (virtlist.js) — same engine as the Log tab's list; the dc
// rows additionally refresh their computed header cells on every render.
const dcContainer = document.getElementById('dcScrollContainer');
const dcContent   = document.getElementById('dcScrollContent');
const dcSpacer    = document.getElementById('dcScrollSpacer');
const dcVL = new VirtList({
    est: 60,
    buffer: 20,
    container: dcContainer,
    content: dcContent,
    spacer: dcSpacer,
    buildBody: buildEventBody,
    createRow: dcCreateEventDiv,
    refreshRow: (el, ev) => {
        // Refresh calc values in header (bonuses may have changed)
        const fvRow = el.querySelector('.dc-fields-row');
        if (!fvRow) return;
        const c = dcCachedHitCalc(ev);
        const fields = c.f, calcDmg = c.d;
        dcFillHeader(fvRow, [
            el.querySelector('.dc-result-cell'),
            el.querySelector('.dc-game-cell'),
            el.querySelector('.dc-diff-cell'),
        ], fields, calcDmg);
    },
    subKeyPrefix: 'dc_',
});
// ─── Delegated clicks (effects panel + character list) ─────────────────────
// Rows/buttons ride on data attributes instead of inline onclick string
// interpolation, so keys/sources containing quotes can't break the markup.
const dcEffectsPanelEl = document.getElementById('dcEffectsPanel');
if (dcEffectsPanelEl) dcEffectsPanelEl.addEventListener('click', e => {
    const lvlBtn = e.target.closest('.dc-lvl-btn');
    if (lvlBtn) {
        e.stopPropagation();
        if (lvlBtn.dataset.charid != null) {
            dcChangeSkillLevel(Number(lvlBtn.dataset.charid), Number(lvlBtn.dataset.slot), Number(lvlBtn.dataset.dir));
        } else {
            const row = lvlBtn.closest('.dc-effect-row');
            if (row && row.dataset.key) dcChangeEffectLevel(row.dataset.key, Number(lvlBtn.dataset.dir));
        }
        return;
    }
    const row = e.target.closest('.dc-effect-row');
    if (row && row.dataset.key !== undefined) { dcToggleEffect(row.dataset.key); return; }
    const sec = e.target.closest('.dc-source-toggle');
    if (sec && sec.dataset.gkey !== undefined) dcToggleSourceSection(sec.dataset.gkey);
});

const dcCharsListEl = document.getElementById('dcCharsList');
if (dcCharsListEl) dcCharsListEl.addEventListener('click', e => {
    const btn = e.target.closest('.dc-char-btn');
    if (!btn) return;
    if (btn.dataset.char) dcToggleChar(btn.dataset.char);
    else if (btn.dataset.group) dcToggleGroupDisable(btn.dataset.group);
});

// ─── Effects panel render ─────────────────────────────────────────────────────
function renderEffectsPanel() {
    const panel = document.getElementById('dcEffectsPanel');
    if (!panel) return;
    const effects = dcCollectAttrFixEffectsCached();

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
            let g = `<div class="dc-source-toggle" data-gkey="${esc(gkey)}">
                <span class="dc-source-arrow">${isOpen ? '▾' : '▸'}</span><span>${esc(label)}</span>
                <span class="dc-source-count">${groupEffects.length}</span>
            </div>`;
            if (isOpen) {
                for (const ef of [...groupEffects].sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
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
                                data-dir="-1"
                                title="Decrease level">−</button>
                            <span class="dc-lvl-indicator">${effectiveLevelIdx + 1}/${maxLvl + 1}</span>
                            <button class="dc-lvl-btn${effectiveLevelIdx >= maxLvl ? ' dc-lvl-disabled' : ''}"
                                data-dir="1"
                                title="Increase level">+</button>`;
                    }

                    g += `<div class="dc-effect-row${disabled ? ' disabled' : ''}"
                        data-key="${esc(ef.key)}"
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
    // (dcRenderCharList is rendered by renderFormulaBar in the same
    // dcApplyAndRender pass — no duplicate render here.)
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
        html += `<div class="dc-source-toggle" data-gkey="${esc(gkey)}">`
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
                         + (change !== 0 ? ` <span class="rec-bonus">${change > 0 ? '+' : ''}${change}*</span>` : '');
            const title = `Record ${st.recordLv} + bonus ${bonus} + change ${change} = ${eff} (in-game max ${st.maxLv}, sim cap ${max})`
                + ' — ± steps the user change for what-if simulation; reset on the Record page';
            html += `<div class="dc-effect-row" title="${esc(title)}">`
                + `<span class="dc-effect-row-name">${esc(name)}</span>`
                + `<span class="dc-effect-row-val">Lv ${eff}/${max}${marker}</span>`
                + `<span class="dc-effect-row-lvl">`
                + `<button class="dc-lvl-btn${eff <= 0 ? ' dc-lvl-disabled' : ''}" data-charid="${cid}" data-slot="${st.slot}" data-dir="-1" title="Decrease skill level">−</button>`
                + `<button class="dc-lvl-btn${eff >= max ? ' dc-lvl-disabled' : ''}" data-charid="${cid}" data-slot="${st.slot}" data-dir="1" title="Increase skill level">+</button>`
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

// Disc name from a disc effect row's name: "<disc>: Melody|Harmony ..." and
// "<disc> : Stat n" — the part before the first ':' (same convention as the
// Effect Impact sibling grouping in effectImpact.js).
function dcDiscNameOf(name) {
    if (typeof name !== 'string') return null;
    const c = name.indexOf(':');
    return c > 0 ? name.slice(0, c).trim() : null;
}

// groupKey: 'bossblitz' / 'talents' match by source; 'disc:<name>' matches
// every Discs-source row belonging to that disc (stat rows + Melody/Harmony
// buffs). Matchers receive (source, name).
function dcGroupSourceMatcher(groupKey) {
    if (groupKey.startsWith('disc:')) {
        const disc = groupKey.slice(5);
        return (src, name) => src === 'Discs' && dcDiscNameOf(name) === disc;
    }
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
    for (const ef of dcCollectAttrFixEffectsCached()) {
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
        for (const ef of dcCollectAttrFixEffectsCached()) {
            if (matcher(ef.source, ef.name)) newKeys.add(ef.key);
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

// Re-render every Dmg Calc surface after a state change (effects panel,
// formula bar + totals, hit list, effect-impact panel, analytics).
function dcApplyAndRender() {
    // The handlers that call this just mutated calc-affecting state — bump
    // the version so the per-hit calc / char-delta caches rebuild below.
    dcBumpCalcVersion();
    renderEffectsPanel();
    renderFormulaBar();
    dcVL.render();
    dcRefreshEI();
    dcNotifyAnalytics();
}

window.dcToggleGroupDisable = function(groupKey) {
    if (!dcGroupEffectKeys.has(groupKey)) {
        const matcher = dcGroupSourceMatcher(groupKey);
        const keys = new Set();
        for (const ef of dcCollectAttrFixEffectsCached()) {
            if (matcher(ef.source, ef.name)) keys.add(ef.key);
        }
        dcGroupEffectKeys.set(groupKey, keys);
        keys.forEach(k => dcEffectsDisabled.add(k));
    } else {
        const keys = dcGroupEffectKeys.get(groupKey);
        if (keys) keys.forEach(k => dcEffectsDisabled.delete(k));
        dcGroupEffectKeys.delete(groupKey);
    }
    dcApplyAndRender();
};

window.dcTogglePotsMaxLvl6 = function() {
    dcPotsMaxLvl6.active = !dcPotsMaxLvl6.active;
    if (dcPotsMaxLvl6.active) dcPotsApply(dcPotsMaxLvl6, true);
    else dcPotsRevert(dcPotsMaxLvl6);
    dcApplyAndRender();
};

window.dcTogglePotsAllLvl6 = function() {
    dcPotsAllLvl6.active = !dcPotsAllLvl6.active;
    if (dcPotsAllLvl6.active) dcPotsApply(dcPotsAllLvl6, false);
    else dcPotsRevert(dcPotsAllLvl6);
    dcApplyAndRender();
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
        potsState: () => dcPotsMaxLvl6,      // for the delta simulation
        potsOnlyAboveMax: true,
    },
    {
        label: 'Pots All Lvl 6',
        title: 'Force every Potentials to level 6',
        enableStyle: true,
        strikeWhenActive: false,
        isActive: () => dcPotsAllLvl6.active,
        onclick: 'dcTogglePotsAllLvl6()',
        potsState: () => dcPotsAllLvl6,
        potsOnlyAboveMax: false,
    },
    {
        label: 'Boss Blitz',
        title: 'Disable all Boss Blitz effects',
        enableStyle: false,
        strikeWhenActive: true,
        isActive: () => dcGroupEffectKeys.has('bossblitz'),
        onclick: "dcToggleGroupDisable('bossblitz')",
        groupKey: 'bossblitz',
    },
    {
        label: 'Talents',
        title: 'Disable all Talent effects',
        enableStyle: false,
        strikeWhenActive: true,
        isActive: () => dcGroupEffectKeys.has('talents'),
        onclick: "dcToggleGroupDisable('talents')",
        groupKey: 'talents',
    },
];

// ── Per-disc quick toggles ────────────────────────────────────────────
// One toggle per disc that has effects/stat rows in the current filter.
// Disabling a disc removes ALL of its contributions at once: its
// "<disc> : Stat n" stat rows (tableResolver.js buildRecordDiscEffects)
// and its "<disc>: Melody|Harmony N" buff rows (disc-buff decoder), i.e.
// every effect whose source is 'Discs' and whose name starts with the
// disc name before the first ':' (dcDiscNameOf).
// Disc toggles are listed ABOVE the static quick toggles, separated by a
// divider line, and sorted by the disc's position in the origin record's
// discStats list (equipped order); discs not in the record fall back to
// alphabetical after the record ones. They only appear at all when the log
// has a record log (an Origin event) — without one there is no equipped-disc
// order to show and no disc stats to toggle.
function dcQuickToggleList() {
    const rec = (typeof getOriginRecord === 'function') ? getOriginRecord() : null;
    if (!rec) return [...DC_QUICK_TOGGLES];   // no record log → no disc toggles
    const discNames = new Set();
    for (const ef of dcCollectAttrFixEffectsCached()) {
        if (ef.source !== 'Discs') continue;
        const n = dcDiscNameOf(ef.name);
        if (n) discNames.add(n);
    }
    const recOrder = new Map();
    (rec.discStats || []).forEach((d, i) => {
        const nm = (typeof resolveRecordDiscName === 'function') ? resolveRecordDiscName(d.id) : null;
        if (nm && !recOrder.has(nm)) recOrder.set(nm, i);
    });
    const discEntries = [...discNames].sort((a, b) => {
        const ia = recOrder.has(a) ? recOrder.get(a) : Infinity;
        const ib = recOrder.has(b) ? recOrder.get(b) : Infinity;
        if (ia !== ib) return ia - ib;
        return a.localeCompare(b);
    }).map(disc => {
        const gkey = `disc:${disc}`;
        return {
            label: disc,
            title: `Disable all effects and stat changes of the disc "${disc}" (stat rows + Melody/Harmony buffs)`,
            enableStyle: false,
            strikeWhenActive: true,
            isActive: () => dcGroupEffectKeys.has(gkey),
            groupKey: gkey,
            dataGroup: true,   // routed through the delegated click handler
        };
    });
    // Disc toggles first, then a divider, then the static toggles. The
    // divider marker is skipped by the delta simulation and rendered as a
    // separator line by dcRenderCharList; with no disc toggles there is no
    // divider either.
    if (!discEntries.length) return [...DC_QUICK_TOGGLES];
    return [...discEntries, { divider: true }, ...DC_QUICK_TOGGLES];
}

// Effect keys dcToggleChar would disable for this char: the memoized set if
// the char was toggled before, otherwise computed the same way (source owned
// by the char via dcCharOwnsSource).
function dcCharOwnedEffectKeys(name) {
    if (dcCharEffectKeys.has(name)) return dcCharEffectKeys.get(name);
    const keys = new Set();
    for (const ef of dcCollectAttrFixEffectsCached()) {
        if (dcCharOwnsSource(name, ef.source)) keys.add(ef.key);
    }
    return keys;
}

// Per-char "what if disabled" deltas are expensive (one extra damage pass
// per character over the whole filter). They are shown while
// dcShowCharDeltas is on:
//   - automatically on page load / when the log renders (the flag starts
//     true, so the first char-list render computes them),
//   - recalculated when a quick toggle changes the simulation state
//     (dcApplyAndRender bumps dcStateVersion and the next char-list render
//     refreshes them),
//   - hidden when the user interacts with anything else (effect rows, char
//     rows, level ±, bonuses, filters — those handlers call
//     dcHideCharDeltas).
// The "Calculate" button above the quick toggles recomputes them on demand.
let dcShowCharDeltas = true;
let _dcCharDeltaCache = null; // { version, baseTotal, deltas, quick } | null

// Compute (Total Calc) − (Total Calc with that character disabled) for every
// character, faithfully simulating dcToggleChar: the char's own hits are
// zeroed (dcCharsDisabled check in dcApplyEffectOverrides) and its owned
// effect keys are added to the disabled set, which also affects other
// characters' hits.
function dcComputeCharDeltas(list) {
    const deltas = {};
    const quick = {};
    let baseTotal = 0;
    list.forEach(n => { deltas[n] = 0; });
    if (dcFiltered.length && list.length) {
        // Base pass: current Total Calc + per-attacker contribution under the
        // current state (per-hit results shared with the totals cache).
        const sums = new Map();
        for (const ev of dcFiltered) {
            const c = dcCachedHitCalc(ev);
            baseTotal += c.d;
            const att = ev.AttackerDisplay || ev.Attacker || '';
            sums.set(att, (sums.get(att) || 0) + c.d);
        }

        // Keys whose disabling changes hit *level scaling* globally — when a
        // char owns one of these, its what-if pass must visit every hit.
        const coupling = dcLevelCouplingKeys();

        for (const name of list) {
            // Zeroing the char's own hits:
            let totalIf = baseTotal - (sums.get(name) || 0);
            // Its owned effects also get disabled (may affect other hits):
            const owned = dcCharOwnedEffectKeys(name);
            if (owned.size) {
                const merged = new Set(dcEffectsDisabled);
                for (const k of owned) merged.add(k);
                if (merged.size !== dcEffectsDisabled.size) {
                    // Fast path: when none of the owned keys is a
                    // level-coupling key, only hits that actually carry one of
                    // the owned keys (in their own effect lists / potentials
                    // group) can change — everything else reuses the base
                    // damage computed above.
                    let needsFull = false;
                    for (const k of owned) { if (coupling.has(k)) { needsFull = true; break; } }
                    let t = 0;
                    for (const ev of dcFiltered) {
                        const att = ev.AttackerDisplay || ev.Attacker || '';
                        if (att === name) continue;
                        if (!needsFull) {
                            const cand = dcHitCandidateKeys(ev);
                            let affected = false;
                            for (const k of owned) { if (cand.has(k)) { affected = true; break; } }
                            if (!affected) { t += dcCachedHitCalc(ev).d; continue; }
                        }
                        const f = calcHitFields(ev, null, merged, dcEffectLevelOverrides);
                        t += calcDamage(f, dcBonus, dcDisabled);
                    }
                    totalIf = t;
                }
            }
            deltas[name] = baseTotal - totalIf;
        }

        // ── Quick-toggle deltas ──
        // What the Total Calc would be with each quick toggle applied (or,
        // when already active, turned off) — same convention as the char
        // rows. Pots toggles are simulated by temporarily applying the level
        // changes with DIRECT calc calls (the per-hit cache must not see the
        // mutated level tables, so no dcCachedHitCalc here and no version
        // bump — the changes are restored in `finally`). Group toggles are
        // simulated with an add/remove disabled-set pass, also direct.
        for (const t of dcQuickToggleList()) {
            if (t.divider) continue;   // separator marker — not a toggle
            let totalIf;
            if (t.potsState) {
                const st = t.potsState();
                totalIf = st.active
                    ? dcSimulatePotsRevert(st)
                    : dcSimulatePotsApply(st, t.potsOnlyAboveMax);
            } else {
                totalIf = dcSimulateGroupToggle(t.groupKey, dcGroupEffectKeys.has(t.groupKey), baseTotal);
            }
            quick[t.label] = baseTotal - totalIf;
        }
    }
    return { baseTotal, deltas, quick };
}

// Simulate applying a pots quick toggle: set the same `change` values
// dcPotsApply would write, total, then restore in `finally`.
function dcSimulatePotsApply(state, onlyAboveMax) {
    const saved = new Map();
    for (const [id, s] of dcPotLevels) saved.set(id, s.change || 0);
    try {
        const activePots = new Set();
        for (const ef of dcCollectAttrFixEffectsCached()) {
            if (ef.levelSource != null) activePots.add(ef.levelSource);
        }
        for (const potId of activePots) {
            const s = dcPotLevels.get(potId);
            if (!s) continue;
            if (dcPotEffectiveLevel(s) === POT_LEVEL) continue;
            if (onlyAboveMax && dcPotEffectiveLevel(s) <= POT_LEVEL) continue;
            s.change = POT_LEVEL - s.recordLv - s.bonus;
        }
        let t = 0;
        for (const ev of dcFiltered) {
            const f = calcHitFields(ev, null, dcEffectsDisabled, dcEffectLevelOverrides);
            t += calcDamage(f, dcBonus, dcDisabled);
        }
        return t;
    } finally {
        for (const [id, s] of dcPotLevels) if (saved.has(id)) s.change = saved.get(id);
    }
}

// Simulate turning an active pots toggle off: restore the `prev` changes it
// saved when it was applied, total, then restore in `finally`.
function dcSimulatePotsRevert(state) {
    const saved = new Map();
    for (const [id, s] of dcPotLevels) saved.set(id, s.change || 0);
    try {
        for (const [potId, prev] of state.prev) {
            const s = dcPotLevels.get(potId);
            if (s) s.change = prev;
        }
        let t = 0;
        for (const ev of dcFiltered) {
            const f = calcHitFields(ev, null, dcEffectsDisabled, dcEffectLevelOverrides);
            t += calcDamage(f, dcBonus, dcDisabled);
        }
        return t;
    } finally {
        for (const [id, s] of dcPotLevels) if (saved.has(id)) s.change = saved.get(id);
    }
}

// Simulate a group quick toggle (Boss Blitz / Talents): not active → add the
// group's effect keys to the disabled set; already active → remove them
// again. Returns the simulated Total Calc.
function dcSimulateGroupToggle(groupKey, active, baseTotal) {
    const matcher = dcGroupSourceMatcher(groupKey);
    let keys;
    if (active) {
        keys = dcGroupEffectKeys.get(groupKey) || new Set();
    } else {
        keys = new Set();
        for (const ef of dcCollectAttrFixEffectsCached()) {
            if (matcher(ef.source, ef.name)) keys.add(ef.key);
        }
    }
    const merged = new Set(dcEffectsDisabled);
    for (const k of keys) {
        if (active) merged.delete(k);
        else merged.add(k);
    }
    if (merged.size === dcEffectsDisabled.size) return baseTotal;   // toggle changes nothing
    // A toggle key that drives a level table (potential / skill-slot bonus
    // row) changes hit scaling globally — its what-if pass must visit every
    // hit, the fast path below may not skip any.
    let needsFull = false;
    for (const k of keys) { if (dcLevelCouplingKeys().has(k)) { needsFull = true; break; } }
    let t = 0;
    for (const ev of dcFiltered) {
        if (!needsFull) {
            // Fast path (same assumption as the per-char deltas): dcHitCandidateKeys
            // is a superset of the keys the hit consults, so a hit that carries none
            // of the toggle's keys is unaffected — reuse its cached base damage.
            const cand = dcHitCandidateKeys(ev);
            let affected = false;
            for (const k of keys) { if (cand.has(k)) { affected = true; break; } }
            if (!affected) { t += dcCachedHitCalc(ev).d; continue; }
        }
        const f = calcHitFields(ev, null, merged, dcEffectLevelOverrides);
        t += calcDamage(f, dcBonus, dcDisabled);
    }
    return t;
}

// Recompute the cached deltas (only when they are enabled and stale).
function dcRefreshCharDeltas() {
    if (!dcShowCharDeltas) return;
    if (_dcCharDeltaCache && _dcCharDeltaCache.version === dcStateVersion) return;
    const list = dcPlayerCharNames();
    _dcCharDeltaCache = { version: dcStateVersion, ...dcComputeCharDeltas(list) };
}

// Button: recompute the per-char deltas for the current state.
window.dcCalculateCharDeltas = function() {
    dcShowCharDeltas = true;
    dcRefreshCharDeltas();
    dcRenderCharList();
};

// Interaction handlers that change the simulation state call this so the
// stale per-char % disappear instead of being silently recomputed.
window.dcHideCharDeltas = function() {
    dcShowCharDeltas = false;
    _dcCharDeltaCache = null;
};

function dcSyncCharEffectKeys() {
    for (const [charName, keys] of dcCharEffectKeys) {
        const newKeys = new Set();
        for (const ef of dcCollectAttrFixEffectsCached()) {
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
    // (see isPlayerHit in dataLoader.js). This hides enemy/monster actors
    // like "..._Actor (skinId=...)".
    const list = dcPlayerCharNames();
    if (list.length === 0) {
        el.innerHTML = '<div class="dc-effects-empty">No characters loaded.</div>';
        return;
    }

    // Per-character deltas are shown while dcShowCharDeltas is on (page
    // load, Calculate button, quick toggles); interacting with anything else
    // hides them (dcHideCharDeltas). Refresh when stale.
    if (dcShowCharDeltas) dcRefreshCharDeltas();
    const dcD = (_dcCharDeltaCache && _dcCharDeltaCache.version === dcStateVersion) ? _dcCharDeltaCache : null;

    // ── Characters ──
    let html = list.map(name => {
        const off = dcCharsDisabled.has(name);
        const delta = dcD ? (dcD.deltas[name] || 0) : 0;
        // Same convention as the sidebar Compare rows: how much larger the
        // current Total Calc is than the Total Calc with this char disabled.
        const pct = dcD && (dcD.baseTotal - delta) > 0 ? ((dcD.baseTotal / (dcD.baseTotal - delta)) - 1) * 100 : null;
        const deltaStr = pct != null
            ? `<span class="dc-char-delta" title="Total Calc minus Total Calc with this character disabled (its hits zeroed + its owned effects disabled): ${delta >= 0 ? '+' : ''}${Math.round(delta).toLocaleString()}">${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%</span>`
            : '';
        return `<div class="dc-char-row${off ? ' disabled' : ''}">
            <span class="dc-char-name" title="${esc(name)}">${esc(name)}</span>
            ${deltaStr}
            <span class="dc-char-spacer"></span>
            <button class="dc-char-btn${off ? ' on' : ''}" data-char="${esc(name)}">${off ? 'Enable' : 'Disable'}</button>
        </div>`;
    }).join('');

    // ── Quick toggles (below the characters) ──
    // Per-disc toggles first, then a divider line, then the static
    // entries (Pots Max/All Lvl 6, Boss Blitz, Talents).
    html += `<div class="dc-quick-sep"></div>`;
    for (const t of dcQuickToggleList()) {
        if (t.divider) { html += `<div class="dc-quick-sep"></div>`; continue; }
        const active = t.isActive();
        const strike = t.strikeWhenActive && active;
        const label = t.enableStyle
            ? (active ? 'Disable' : 'Enable')
            : (active ? 'Enable' : 'Disable');
        // Same convention as the character deltas: how much larger the
        // current Total Calc is than the Total Calc with this toggle
        // applied (or, when already active, turned off).
        const qDelta = dcD && dcD.quick ? (dcD.quick[t.label] || 0) : 0;
        const qTotalIf = dcD ? dcD.baseTotal - qDelta : 0;
        const qpct = dcD && qTotalIf > 0 ? ((dcD.baseTotal / qTotalIf) - 1) * 100 : null;
        const qStr = qpct != null
            ? `<span class="dc-char-delta" title="Current Total Calc vs Total Calc with this toggle ${active ? 'turned off' : 'applied'} (delta: ${qDelta >= 0 ? '+' : ''}${Math.round(qDelta).toLocaleString()})">${qpct >= 0 ? '+' : ''}${qpct.toFixed(1)}%</span>`
            : '';
        // Disc toggles ride on data-group (delegated handler) — their names
        // can contain quotes that would break an inline onclick string.
        const btnAttrs = t.dataGroup
            ? `data-group="${esc(t.groupKey)}"`
            : `onclick="${t.onclick}"`;
        html += `<div class="dc-char-row${strike ? ' disabled' : ''}">
            <span class="dc-char-name" title="${esc(t.title)}">${esc(t.label)}</span>
            ${qStr}
            <span class="dc-char-spacer"></span>
            <button class="dc-char-btn${active ? ' on' : ''}" ${btnAttrs} title="${esc(t.title)}">${label}</button>
        </div>`;
    }
    // Calculate: recomputes the deltas shown next to the characters and
    // quick toggles.
    // (The Calculate button lives next to the static "Quick Toggles"
    // heading in index.html — no per-render button row here.)
    el.innerHTML = html;
}

window.dcToggleChar = function(name) {
    const turningOff = !dcCharsDisabled.has(name);
    if (turningOff) {
        dcCharsDisabled.add(name);
        const keys = new Set();
        for (const ef of dcCollectAttrFixEffectsCached()) {
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
    dcHideCharDeltas();
    dcApplyAndRender();
};

window.dcDisableAllEffects = function() {
    const effects = dcCollectAttrFixEffectsCached();
    if (effects.length === 0) return;
    effects.forEach(ef => dcEffectsDisabled.add(ef.key));
    dcHideCharDeltas();
    dcApplyAndRender();
};

window.dcEnableAllEffects = function() {
    dcEffectsDisabled.clear();
    for (const keys of dcCharEffectKeys.values()) keys.forEach(k => dcEffectsDisabled.add(k));
    for (const keys of dcGroupEffectKeys.values()) keys.forEach(k => dcEffectsDisabled.add(k));
    dcHideCharDeltas();
    dcApplyAndRender();
};

window.dcToggleSourceSection = function(gkey) {
    dcSourceOpenStates[gkey] = !dcSourceOpenStates[gkey];
    renderEffectsPanel();
};

window.dcToggleEffect = function(key) {
    if (dcEffectsDisabled.has(key)) dcEffectsDisabled.delete(key);
    else dcEffectsDisabled.add(key);
    dcHideCharDeltas();
    dcApplyAndRender();
};

// Reset a potential's user change to 0 (record page click).
window.dcResetPotLevelChange = function(potId) {
    const st = dcPotLevels.get(Number(potId));
    if (!st || !st.change) return;
    st.change = 0;
    dcHideCharDeltas();
    dcApplyAndRender();
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
    dcHideCharDeltas();
    dcApplyAndRender();
};

// Reset a skill's user change to 0 (record page click).
window.dcResetSkillLevelChange = function(charId, slot) {
    const st = dcSkillLevels.get(`${Number(charId)}:${Number(slot)}`);
    if (!st || !st.change) return;
    st.change = 0;
    dcHideCharDeltas();
    dcApplyAndRender();
};

window.dcChangeEffectLevel = function(key, direction) {
    const effects = dcCollectAttrFixEffectsCached();
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
            // Lazy record reconstruction (logs without a record log): make sure
            // the slot has a level-table entry before stepping it.
            dcEnsureSkillLevel(cid, slot,
                (ef.valueConfigId != null && ef.valueConfigId > ef.configId)
                    ? Math.round((ef.valueConfigId - ef.configId) / 10) : 0);
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
            // potential not in the record — synthesize an entry from the logged
            // level (lazy record reconstruction for logs without a record log)
            const lo0 = ef.configId - (ef.configId % 1000);
            const loggedL = (ef.valueConfigId != null && ef.valueConfigId > lo0)
                ? Math.floor(((ef.valueConfigId - lo0) % 100) / 10) : 0;
            st = dcEnsurePotLevel(ef.levelSource, loggedL, ef._charId);
            if (!st) return;
        }
        const curL = dcPotEffectiveLevel(st);
        const newL = Math.min(Math.max(curL + direction, 0), 9);
        if (newL === curL) return;
        st.change = (st.change || 0) + (newL - curL);
        dcHideCharDeltas();
        dcApplyAndRender();
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

    dcHideCharDeltas();
    dcApplyAndRender();
};


// ─── Dmg Calc totals (sidebar) ────────────────────────────────────────────────
function dcRenderTotals() {
    const el = document.getElementById('dcSidebarTotals');
    if (!el) return;
    let totalCalc = 0, totalGame = 0;
    let minMs = Infinity, maxMs = -Infinity;
    dcFiltered.forEach(ev => {
        const c = dcCachedHitCalc(ev);
        totalCalc += c.d;
        totalGame += c.f.finalDamage;
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
        if (!isPlayerHit(ev)) continue; // player hits only
        const c = dcCachedHitCalc(ev);
        const fields = c.f, calcDmg = c.d;
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
    dcBumpCalcVersion();
    dcHideCharDeltas();
    renderFormulaBar();
    dcVL.render();
    dcRefreshEI();
    dcNotifyAnalytics();
};

window.dcSetBonus = function(key, val) {
    const n = parseFloat(val);
    dcBonus[key] = isNaN(n) ? 0 : n;
    dcBumpCalcVersion();
    dcHideCharDeltas();
    renderFormulaBar();
    dcVL.render();
    dcRefreshEI();
    dcNotifyAnalytics();
};

// ─── Per-hit event DOM ────────────────────────────────────────────────────────
const DISPLAY_ORDER = [
    'multiplier','baseAtk','atkPct','elemPct','elemTakenPct',
    'dmgTypePct','dmgTypeTakenPct','critRate','critDmg',
    'penRes','effectiveDef','defAmend','envAmend'
];

// Fill a dc event header: the per-field value cells inside `fvRow` (children
// in DISPLAY_ORDER order) and the calc/game/diff result cells. Shared by
// dcCreateEventDiv (fresh div) and dcRender (refreshing visible rows after a
// bonus/toggle change) so the two paths can't drift apart.
function dcFillHeader(fvRow, resultCells, fields, calcDmg) {
    const fvs = hitFieldValues(fields, dcBonus);
    const cells = fvRow.querySelectorAll('.dc-field-cell');
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
        cell.dataset.key = key;
    }
    const [calcCell, gameCell, diffCell] = resultCells;
    if (calcCell) calcCell.innerHTML = `<span class="dc-calc">${Math.round(calcDmg).toLocaleString()}</span>`;
    if (gameCell) gameCell.innerHTML = `<span class="dc-game">${Number(fields.finalDamage).toLocaleString()}</span>`;
    if (diffCell) {
        const diffPct = fields.finalDamage > 0 ? ((calcDmg / fields.finalDamage - 1) * 100) : null;
        if (diffPct != null) {
            const cls = Math.abs(diffPct) < 0.05 ? 'dc-diff-close' : diffPct < 1 ? 'dc-diff-neg' : 'dc-diff-pos';
            diffCell.innerHTML = `<span class="${cls}">${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(1)}%</span>`;
        } else {
            diffCell.innerHTML = '';
        }
    }
}

function dcCreateEventDiv(ev, fi) {
    const oi = ev._origIndex;
    const isOpen = dcVL.openStates[oi] || false;
    const hc = ev.HitConfig   || {};
    const dp = ev.DamageParams || {};

    const _c       = dcCachedHitCalc(ev);
    const fields   = _c.f;
    const calcDmg  = _c.d;

    const attName  = esc(ev.AttackerDisplay || ev.Attacker || '?');
    const skillStr  = hitSkillStr(hc, esc);
    const baseMult  = dp.skillPercentAmend != null ? ` [${(dp.skillPercentAmend/10000).toFixed(2)}%]` : '';
    const snapAge = ev.SnapshotAt ? ` [${((parseTimeToMs(ev.Time)-parseTimeToMs(ev.SnapshotAt))/1000).toFixed(3)}s ago]` : '';

    const div = document.createElement('div');
    div.className = 'event dc-event' + (isOpen ? ' open' : '');
    div.style.top = dcVL.topOf(fi) + 'px';
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
    // Cells are pre-tagged with dc-field-cell so dcFillHeader's
    // querySelectorAll finds them in DISPLAY_ORDER order.
    for (let i = 0; i < DISPLAY_ORDER.length; i++) {
        const cell = document.createElement('div');
        cell.className = 'dc-field-cell';
        fvRow.appendChild(cell);
    }

    // Result cells
    const calcCell = document.createElement('div');
    calcCell.className = 'dc-field-cell dc-result-cell';
    const gameCell = document.createElement('div');
    gameCell.className = 'dc-field-cell dc-game-cell';
    const diffCell = document.createElement('div');
    diffCell.className = 'dc-field-cell dc-diff-cell';

    const resultStack = document.createElement('div');
    resultStack.className = 'dc-result-stack';
    resultStack.appendChild(calcCell);
    resultStack.appendChild(gameCell);
    resultStack.appendChild(diffCell);

    // Fill the per-field cells + result stack (shared with dcRender's refresh)
    dcFillHeader(fvRow, [calcCell, gameCell, diffCell], fields, calcDmg);

    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.textContent = '▶';
    topRow.appendChild(arrow);

    header.appendChild(topRow);
    header.appendChild(fvRow);
    header.appendChild(resultStack);

    header.addEventListener('click', e => { e.stopPropagation(); dcVL.toggleEvent(oi); });

    // ── Body ──
    const body = document.createElement('div');
    body.className = 'event-body';
    if (isOpen) body.innerHTML = buildEventBody(ev);

    div.appendChild(header);
    div.appendChild(body);
    return div;
}

// ─── Filter helpers ───────────────────────────────────────────────────────────
function dcBuildCharFilter() {
    const all = new Set();
    allEvents.filter(e => e.Type === 'Hit').forEach(e => {
        if (e.AttackerDisplay) all.add(e.AttackerDisplay);
    });
    fillSelectOptions(document.getElementById('dcCharFilter'), all,
        { emptyLabel: 'All Characters', keepVal: dcCharFilter, keepVanished: true });
}

function dcBuildSkillFilter(evs) {
    const all = new Set();
    evs.forEach(e => {
        const n = (e.HitConfig || {}).skillTitle;
        if (n) all.add(n);
    });
    fillSelectOptions(document.getElementById('dcSkillFilter'), all,
        { emptyLabel: 'All Skills', keepVal: dcSkillFilter, keepVanished: true, max: 28 });
}

function dcBuildDamageTypeFilter(evs) {
    const all = new Set();
    evs.forEach(e => {
        if (e.HitConfig && e.HitConfig.damageType != null) {
            all.add(e.HitConfig.damageType);
        }
    });
    fillSelectOptions(document.getElementById('dcDamageTypeFilter'), all,
        { emptyLabel: 'All Damage Types', keepVal: dcDamageTypeFilter, keepVanished: true,
          format: dtName, sortFn: (a, b) => a - b, max: 28 });
}

function dcBuildDefenderFilter(autoSelect = false) {
    const dmgTotals = {};
    allEvents.filter(e => e.Type === 'Hit').forEach(e => {
        const name = e.DefenderDisplay || e.Defender;
        if (!name) return;
        const key = cleanOwner(name);
        const dmg = (e.DamageParams && e.DamageParams.finalDamage) || 0;
        dmgTotals[key] = (dmgTotals[key] || 0) + dmg;
    });
    const all = Object.keys(dmgTotals);
    const sel = document.getElementById('dcDefenderFilter');
    fillSelectOptions(sel, all, { emptyLabel: 'All Defenders', keepVal: dcDefenderFilter, max: 28 });
    // No selection yet → default to the defender that took the most damage.
    const top = all.sort((a, b) => dmgTotals[b] - dmgTotals[a])[0] || '';
    if (autoSelect || (!dcDefenderFilter && top)) {
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
    const baseMult = dp.skillPercentAmend != null ? ` [${(dp.skillPercentAmend / 10000).toFixed(2)}%]` : '';
    return `${attName}${hitSkillStr(hc)}${baseMult}`.toLowerCase();
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
            const key = cleanOwner(name);
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
    dcHideCharDeltas();
    dcRefilterAndRender(true, false);
    dcNotifyAnalytics();
};
window.dcOnSkillFilterChange = function() {
    dcSkillFilter = document.getElementById('dcSkillFilter').value;
    dcHideCharDeltas();
    dcRefilterAndRender(true, false);
    dcNotifyAnalytics();
};
window.dcOnDamageTypeFilterChange = function() {
    dcDamageTypeFilter = document.getElementById('dcDamageTypeFilter').value;
    dcHideCharDeltas();
    dcRefilterAndRender(true, false);
    dcNotifyAnalytics();
};

window.dcOnDefenderFilterChange = function() {
    dcDefenderFilter = document.getElementById('dcDefenderFilter').value;
    dcHideCharDeltas();
    dcRefilterAndRender(true, false);
    dcNotifyAnalytics();
};

// ─── Refilter / rebuild ───────────────────────────────────────────────────────
function dcRefilterAndRender(resetScroll = false, autoSelectDefender = true) {
    dcBuildCharFilter();
    dcBuildDefenderFilter(autoSelectDefender);
    dcFiltered = dcApplyFilters();
    if (resetScroll) {
        dcVL.reset();
        dcContainer.scrollTop = 0;
    }
    dcVL.setFiltered(dcFiltered);
    dcVL.build();
    dcSyncCharEffectKeys();
    dcSyncQuickToggles();
    // The syncs may have mutated the disabled sets, and new filters mean new
    // what-if results — invalidate the per-hit calc + char-delta caches.
    dcBumpCalcVersion();
    renderFormulaBar();
    renderEffectsPanel();
    document.getElementById('stats').textContent = `${dcFiltered.length} hits`;
    dcVL.render();
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
    if (tab === 'effectimpact') {
        // Entering the Effect Impact page recomputes the Quick Toggles /
        // character deltas (same as the "Calculate All" button), so the
        // sidebar percentages are fresh instead of stale or hidden after a
        // recent non-toggle interaction.
        dcShowCharDeltas = true;
        dcRefreshCharDeltas();
        dcRenderCharList();
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
        dcVL.setFiltered(dcFiltered);
        dcVL.build();

        // Keep char-disabled effect keys in sync as new effects appear (the
        // syncs may mutate the disabled sets) — then invalidate the per-hit
        // calc + char-delta caches before re-rendering from them.
        dcSyncCharEffectKeys();
        dcSyncQuickToggles();
        dcBumpCalcVersion();

        dcRenderTotals();
        dcRenderCharList();

        // Only re-render effects panel when new unique effects actually appear
        const newEffects = dcCollectAttrFixEffectsCached();
        const newKeys = new Set(newEffects.map(e => e.key));
        if (!_dcLastEffectKeys || _dcLastEffectKeys.size !== newKeys.size || ![...newKeys].every(k => _dcLastEffectKeys.has(k))) {
            _dcLastEffectKeys = newKeys;
            renderEffectsPanel();
        }

        document.getElementById('stats').textContent = `${dcFiltered.length} hits`;
        dcVL.render();
    } else if (typeof activeTab !== 'undefined' && (activeTab === 'analytics' || activeTab === 'effectimpact')) {
        // Keep the shared right sidebar (totals, char list, effects panel) and
        // the effect-source chips fresh while the Dmg Calc panel itself is hidden.
        dcFiltered = dcApplyFilters();
        dcBumpCalcVersion();
        dcRenderTotals();
        dcRenderCharList();
        const newEffects = dcCollectAttrFixEffectsCached();
        const newKeys = new Set(newEffects.map(e => e.key));
        if (!_dcLastEffectKeys || _dcLastEffectKeys.size !== newKeys.size || ![...newKeys].every(k => _dcLastEffectKeys.has(k))) {
            _dcLastEffectKeys = newKeys;
            renderEffectsPanel();
        }
        if (typeof eiRenderSidebarChips === 'function') eiRenderSidebarChips();
    }
};
