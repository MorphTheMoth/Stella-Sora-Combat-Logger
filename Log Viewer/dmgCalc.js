// ─── dmgCalc.js ───────────────────────────────────────────────────────────────
// Damage Calculator tab: virtual-scroll list of Hit events with formula overlay.

// ─── Formula field definitions ────────────────────────────────────────────────
const DC_FIELDS = [
    { key: 'multiplier',      label: 'MV' },
    { key: 'baseAtk',         label: 'BaseAtk' },
    { key: 'atkPct',          label: 'Atk%' },
    { key: 'elemPct',         label: 'Elem%' },
    { key: 'elemTakenPct',    label: 'ElemR%' },
    { key: 'dmgTypePct',      label: 'Type%' },
    { key: 'dmgTypeTakenPct', label: 'TypeR%' },
    { key: 'critRate',        label: 'CritRate',   display_only: true },
    { key: 'critDmg',         label: 'CritDmg' },
    { key: 'pen',             label: 'Pen' },
    { key: 'res',             label: 'Res' },
    { key: 'penRes',          label: 'Pen' },
    { key: 'effectiveDef',    label: 'EffDEF',     display_only: true },
    { key: 'defAmend',        label: 'DEF' },
    { key: 'envAmend',        label: 'EnvAmd' },
];

// Fields that are visually shown in formula bar (multiply them)
// display_only fields are shown in the per-hit row for context but
// not multiplied in the formula directly (CritRate, Pen, Res, EffDEF)
const DC_FORMULA_KEYS = [
    'multiplier','atkMulti','elemPct','elemTakenPct',
    'dmgTypePct','dmgTypeTakenPct','critDmg','penRes','defAmend',
    'envAmend', 'genDmg','intensity','finalDmg','genDmgRcd','toughnessBroken'
];

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
let dcCharFilter = '';
let dcSkillFilter = '';
let dcDefenderFilter = '';

// Per-field bonus values (user-typed numbers added to all hits)
const dcBonus = {};
DC_FIELDS.forEach(f => { dcBonus[f.key] = 0; });
['genDmg','intensity','finalDmg','genDmgRcd','toughnessBroken'].forEach(k => { dcBonus[k] = 0; });

// ─── DC effects panel state ───────────────────────────────────────────────────
// Set of "side:configId:valueConfigId" keys for effects the user disabled
const dcEffectsDisabled = new Set();
// Whether the effects panel is open
let dcEffectsPanelOpen = true;
// Which source sections are open; default collapsed (keys added on first toggle)
const dcSourceOpenStates = {};

 // effectType values
const ATTR_FIX = 12;
const PLAYER_ATTR_FIX = 37;
const HITTED_ADDITIONAL_ATTR_FIX = 45;
const ELEMENTTYPE_ATTR_FIX = 52;
const ELEMENTTYPE_ATTR_PERCENT_FIX = 54;
const allowedEffectTypes = [ATTR_FIX, PLAYER_ATTR_FIX, HITTED_ADDITIONAL_ATTR_FIX, ELEMENTTYPE_ATTR_FIX, ELEMENTTYPE_ATTR_PERCENT_FIX];

// Collect unique effects across all filtered hits.
// Returns an array of { key, side, configId, valueConfigId, name, attrType, subType, value, count, source, fromAttrDict }
// where count = how many times this configId appears in the first matching hit that has it.
function dcCollectAttrFixEffects() {
    const seen = new Map(); // key -> entry
    for (const ev of dcFiltered) {
        const sides = [
            { side: 'attacker', list: ev.AttackerEffects?.effects, attrDict: ev.AttackerAttrDict },
            { side: 'defender', list: ev.DefenderEffects?.effects, attrDict: ev.DefenderAttrDict },
        ];
        for (const { side, list, attrDict } of sides) {
            // ── effects list ──────────────────────────────────────────
            if (list?.length) {
                const countMap = new Map();
                for (const e of list) {
                    if (!allowedEffectTypes.includes(e.effectType)) continue;
                    const id = e.configId;
                    countMap.set(id, (countMap.get(id) || 0) + 1);
                }
                const seenInHit = new Set();
                for (const e of list) {
                    if (!allowedEffectTypes.includes(e.effectType)) continue;
                    if (seenInHit.has(e.configId)) continue;
                    seenInHit.add(e.configId);
                    const key = `${side}:${e.configId}:${e.valueConfigId ?? ''}`;
                    if (!seen.has(key)) {
                        seen.set(key, {
                            key, side,
                            configId: e.configId,
                            valueConfigId: e.valueConfigId,
                            name: e.name || String(e.configId),
                            attrType: e.attrType,
                            subType: e.subType,
                            value: e.value,
                            count: countMap.get(e.configId) || 1,
                            source: e.source ?? 'Unknown',
                            fromAttrDict: false,
                            effectType: e.effectType
                        });
                    }
                }
            }

            // ── attrDict list ─────────────────────────────────────────
            if (Array.isArray(attrDict)) {
                const seenInHit = new Set();
                for (const e of attrDict) {
                    if (e.attrType == null || e.subType == null || e.value == null) continue;
                    const cid = e.configId ?? e.attrId;
                    if (cid == null) continue;
                    const vcid = e.valueConfigId ?? '';
                    // Use a distinct key namespace so attrDict entries don't collide with effects
                    const key = `${side}:dict:${cid}:${vcid}`;
                    if (seenInHit.has(key)) continue;
                    seenInHit.add(key);
                    if (!seen.has(key)) {
                        seen.set(key, {
                            key, side,
                            configId: cid,
                            valueConfigId: vcid || null,
                            name: e.name || String(cid),
                            attrType: e.attrType,
                            subType: e.subType,
                            value: e.value,
                            count: 1,
                            source: e.source ?? 'Unknown',
                            fromAttrDict: true,
                            effectType: e.effectType
                        });
                    }
                }
            }
        }
    }
    return [...seen.values()];
}

// Apply disabled effects to a cloned copy of the stat arrays.
// Returns { aStats, dStats } (clones with modifications applied).
function dcApplyEffectOverrides(ev) {
    const origA = ev.AttackerStats?.attrs || [];
    const origD = ev.DefenderStats?.attrs || [];
    if (dcEffectsDisabled.size === 0) return { aStats: origA, dStats: origD };

    // Deep-clone only the stat entries we'll modify
    const aMap = new Map(origA.map(s => [s.id, Object.assign({}, s)]));
    const dMap = new Map(origD.map(s => [s.id, Object.assign({}, s)]));

    const sides = [
        { side: 'attacker', list: ev.AttackerEffects?.effects, attrDict: ev.AttackerAttrDict, statMap: aMap },
        { side: 'defender', list: ev.DefenderEffects?.effects, attrDict: ev.DefenderAttrDict, statMap: dMap },
    ];
    for (const { side, list, attrDict, statMap } of sides) {
        // ── effects list ───────────────────────────────────────────────
        if (list?.length) {
            const countMap = new Map();
            for (const e of list) {
                if (!allowedEffectTypes.includes(e.effectType)) continue;
                countMap.set(e.configId, (countMap.get(e.configId) || 0) + 1);
            }
            const seenInHit = new Set();
            for (const e of list) {
                if (!allowedEffectTypes.includes(e.effectType)) continue;
                if (seenInHit.has(e.configId)) continue;
                seenInHit.add(e.configId);
                const key = `${side}:${e.configId}:${e.valueConfigId ?? ''}`;
                if (!dcEffectsDisabled.has(key)) continue;
                const attrId = e.attrType;
                if (attrId == null || e.value == null) continue;
                const count = countMap.get(e.configId) || 1;
                let stat = statMap.get(attrId);
                if (!stat) {
                    stat = { id: attrId, origin: 0, base: 0, pct: 0, abs: 0 };
                    statMap.set(attrId, stat);
                }
                // subType: 1=Base, 2=Pct, 3=Abs
                if ([ATTR_FIX, HITTED_ADDITIONAL_ATTR_FIX, PLAYER_ATTR_FIX].includes(e.effectType)) {
                    if (e.subType === 1) stat.base = (stat.base || 0) - e.value * count;
                    else if (e.subType === 2) stat.pct = (stat.pct || 0) - e.value * count;
                    else if (e.subType === 3) stat.abs = (stat.abs || 0) - e.value * count;
                } else if (e.effectType === ELEMENTTYPE_ATTR_FIX) {
                    if (ev.HitConfig.elementType === e.subType) stat.base = (stat.base || 0) - e.value * count;
                } else if (e.effectType === ELEMENTTYPE_ATTR_PERCENT_FIX) {
                    if (ev.HitConfig.elementType === e.subType) stat.pct = (stat.pct || 0) - e.value * count;
                }
            }
        }

        // ── attrDict list ─────────────────────────────────────────────
        if (Array.isArray(attrDict)) {
            const seenInHit = new Set();
            for (const e of attrDict) {
                if (e.attrType == null || e.subType == null || e.value == null) continue;
                const cid = e.configId ?? e.attrId;
                if (cid == null) continue;
                const vcid = e.valueConfigId ?? '';
                const key = `${side}:dict:${cid}:${vcid}`;
                if (seenInHit.has(key)) continue;
                seenInHit.add(key);
                if (!dcEffectsDisabled.has(key)) continue;
                let stat = statMap.get(e.attrType);
                if (!stat) {
                    stat = { id: e.attrType, origin: 0, base: 0, pct: 0, abs: 0 };
                    statMap.set(e.attrType, stat);
                }
                if ([ATTR_FIX, HITTED_ADDITIONAL_ATTR_FIX, PLAYER_ATTR_FIX].includes(e.effectType)) {
                    if (e.subType === 1) stat.base = (stat.base || 0) - e.value;
                    else if (e.subType === 2) stat.pct = (stat.pct || 0) - e.value;
                    else if (e.subType === 3) stat.abs = (stat.abs || 0) - e.value;
                } else if (e.effectType === ELEMENTTYPE_ATTR_FIX) {
                    if (ev.HitConfig.elementType === e.subType) stat.base = (stat.base || 0) - e.value;
                } else if (e.effectType === ELEMENTTYPE_ATTR_PERCENT_FIX) {
                    if (ev.HitConfig.elementType === e.subType) stat.pct = (stat.pct || 0) - e.value;
                }
            }
        }
    }
    return {
        aStats: [...aMap.values()],
        dStats: [...dMap.values()],
    };
}

// ─── Effects panel render ─────────────────────────────────────────────────────
function renderEffectsPanel() {
    const panel = document.getElementById('dcEffectsPanel');
    if (!panel) return;
    const effects = dcCollectAttrFixEffects();

    let html = `<div class="dc-effects-header" onclick="dcToggleEffectsPanel()">
        <span class="dc-effects-arrow${dcEffectsPanelOpen ? ' open' : ''}">▶</span>
        <span class="dc-effects-title">Stat Effects</span>
        <span class="dc-effects-count">${effects.length} unique · click to disable</span>
    </div>`;

    if (dcEffectsPanelOpen) {
        if (effects.length === 0) {
            html += `<div class="dc-effects-body"><span class="dc-effects-empty">No effects found in current filter.</span></div>`;
        } else {
            html += `<div class="dc-effects-body"><div class="dc-effects-list">`;

            // Group by side+source: collect all unique (side, source) combos in order
            const groupMap = new Map(); // `${side}||${source}` -> [effects]
            for (const ef of effects) {
                const gkey = `${ef.side}||${ef.source ?? 'Unknown'}`;
                if (!groupMap.has(gkey)) groupMap.set(gkey, []);
                groupMap.get(gkey).push(ef);
            }

            function renderGroup(gkey, label, groupEffects) {
                if (!groupEffects.length) return '';
                // Default collapsed unless explicitly opened
                const isOpen = dcSourceOpenStates[gkey] === true;
                const escapedGkey = gkey.replace(/'/g, "\\'");
                let g = `<div class="dc-effects-group-label dc-source-toggle${isOpen ? ' open' : ''}" onclick="dcToggleSourceSection('${escapedGkey}')">
                    <span class="dc-source-arrow">${isOpen ? '▾' : '▸'}</span>${esc(label)}
                    <span class="dc-source-count">${groupEffects.length}</span>
                </div>`;
                if (isOpen) {
                    g += `<div class="dc-effects-chips-wrap">`;
                    for (const ef of groupEffects) {
                        const disabled = dcEffectsDisabled.has(ef.key);
                        const subLabel = ef.subType === 1 ? 'base' : ef.subType === 2 ? 'pct' : ef.subType === 3 ? 'abs' : '?';
                        const attrLabel = ef.attrType != null ? attrName(ef.attrType) : '?';
                        const raw = ef.value;
                        const isSmall = raw != null && Math.abs(raw) < 15;
                        const valStr = raw != null ? (isSmall ? (raw * 100).toFixed(2) + '%' : String(raw)) : '?';
                        const countStr = ef.count > 1 ? ` ×${ef.count}` : '';
                        g += `<div class="dc-effect-chip${disabled ? ' dc-effect-disabled' : ''}"
                            onclick="dcToggleEffect('${ef.key}')"
                            title="${disabled ? 'Click to re-enable' : 'Click to disable'}\n${ef.side} · configId=${ef.configId}">
                            <span class="dc-effect-name">${esc(ef.name)}</span>
                            <span class="dc-effect-stat">${esc(attrLabel)} +${valStr}${countStr} [${subLabel}]</span>
                        </div>`;
                    }
                    g += `</div>`;
                }
                return g;
            }

            // Render attacker groups first, then defender
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

            html += `</div></div>`;
        }
    }
    panel.innerHTML = html;
}

window.dcToggleEffectsPanel = function() {
    dcEffectsPanelOpen = !dcEffectsPanelOpen;
    renderEffectsPanel();
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
};

const DC_EST = 60;
const DC_BUFFER = 20;

const dcContainer = document.getElementById('dcScrollContainer');
const dcContent   = document.getElementById('dcScrollContent');
const dcSpacer    = document.getElementById('dcScrollSpacer');

// ─── Fenwick (reuse same structure) ──────────────────────────────────────────
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

// ─── Stat helpers ─────────────────────────────────────────────────────────────
function statValue(attrs, id) {
    // (origin+base)*(1+pct)+abs
    return (attrs[id].origin + attrs[id].base) * (1 + attrs[id].pct) + attrs[id].abs;
}

function statBase(attrs, id) {
    return (attrs[id].origin || 0) + (attrs[id].base || 0);
}

function statAbs(attrs, id) {
    return (attrs[id].abs || 0);
}

function statCritValue(attrs, id) {
    // (origin+base)*pct+abs, raw value for crit fields
    return statValue(attrs, id);
}

// Element type → attacker stat index (17-22 → indices 17-22 in 0-based array)
const ELEM_ATK_STAT = { 1:17, 2:18, 3:19, 4:20, 5:21, 6:22 };
// Element type → defender stat index (35-40)
const ELEM_DEF_STAT = { 1:35, 2:36, 3:37, 4:38, 5:39, 6:40 };
// Element type → pen attacker (23-28), res defender (11-16)
const ELEM_PEN_STAT = { 1:23, 2:24, 3:25, 4:26, 5:27, 6:28 };
const ELEM_RES_STAT = { 1:11, 2:12, 3:13, 4:14, 5:15, 6:16 };
// Element type → ignore (resistance ignore) attacker stat — indices 29-34
const ELEM_IGN_STAT = { 1:29, 2:30, 3:31, 4:32, 5:33, 6:34 };

// DamageType → attacker dmgType stat index
function dmgTypeAtkStat(dt) {
    if (dt >= 1 && dt <= 4) return 55 + dt; // 56-59
    if (dt === 5) return 64;
    if (dt === 7) return 66;
    return null;
}
function dmgTypeDefStat(dt) {
    if (dt >= 1 && dt <= 4) return 59 + dt; // 60-63
    if (dt === 5) return 65;
    if (dt === 7) return 67;
    return null;
}

// CritRate extra stat by damage type
function critRateExtraIdx(dt) {
    if (dt >= 1 && dt <= 3) return [70, 71, 72][dt - 1];
    if (dt === 5) return 73;
    if (dt === 7) return 74;
    if (dt === 4) return 76;
    return null;
}
function critDmgExtraIdx(dt) {
    if (dt >= 1 && dt <= 3) return [77, 78, 79][dt - 1];
    if (dt === 5) return 80;
    if (dt === 7) return 81;
    if (dt === 4) return 83;
    return null;
}

function calcPenRes(aStats, dStats, el, penBonus, resBonus) {
    const penIdx = ELEM_PEN_STAT[el];
    const resIdx = ELEM_RES_STAT[el];
    const ignIdx = ELEM_IGN_STAT[el];
    const pen = (penIdx != null ? statValue(aStats, penIdx) : 0) + (penBonus || 0);
    const res = (resIdx != null ? statValue(dStats, resIdx) : 0) + (resBonus || 0);
    const ign = ignIdx != null ? statValue(aStats, ignIdx) : 0;
    const vul = statValue(aStats, 55);

    const effectiveRes = res * (1 - ign) - pen;

    if (effectiveRes <= 0) {
        const erAmend = (1 + vul * 0.1) + (vul * effectiveRes * -0.01 * 0.9);
        return erAmend;
    } else {
        let valueLower, valueUpper, amendLower, amendUpper;
        if (effectiveRes <= 250) {
            valueLower = 0;   valueUpper = 250;
            amendLower = 0;   amendUpper = 0.25;
        } else if (effectiveRes <= 750) {
            valueLower = 251; valueUpper = 750;
            amendLower = 0.35; amendUpper = 0.6;
        } else {
            valueLower = 751; valueUpper = 2000;
            amendLower = 0.9; amendUpper = 0.99;
        }
        const ratio = (effectiveRes - valueLower) / (valueUpper - valueLower);
        const erAmendQuad = amendLower + (amendUpper - amendLower) * (ratio * ratio);
        return 1 - erAmendQuad;
    }
}

// ─── Main calculation ─────────────────────────────────────────────────────────
function calcHitFields(ev, statOverrides) {
    const hc  = ev.HitConfig   || {};
    const dp  = ev.DamageParams || {};
    const { aStats, dStats } = statOverrides || dcApplyEffectOverrides(ev);

    const dt = hc.damageType;
    const el = hc.elementType;

    // Multiplier
    const multiplier = dp.skillPercentAmend != null ? dp.skillPercentAmend / 10000 / 100 : 0;

    // BaseAtk
    const baseAtk = statBase(aStats, 1);

    // Atk% = (origin+base) * pct
    const atkStat = aStats[1];
    const atkPct  = atkStat ? (1 + (atkStat.pct || 0)) : 1;
    const atkAbs  = statAbs(aStats, 1);

    // Element%
    const elemIdx = ELEM_ATK_STAT[el];
    const elemPct = elemIdx != null ? statValue(aStats, elemIdx) : 1;

    // ElementTaken%
    const elemDefIdx = ELEM_DEF_STAT[el];
    const elemTakenPct = elemDefIdx != null ? statValue(dStats, elemDefIdx) : 1;

    // DamageType%
    const dtAtkIdx = dmgTypeAtkStat(dt);
    const dmgTypePct = dtAtkIdx != null ? statValue(aStats, dtAtkIdx) : 1;

    // DamageTypeTaken%
    const dtDefIdx = dmgTypeDefStat(dt);
    const dmgTypeTakenPct = dtDefIdx != null ? statValue(dStats, dtDefIdx) : 1;

    // CritRate
    const baseCritRate = statValue(aStats, 6);
    const extraCrIdx = critRateExtraIdx(dt);
    const extraCritRate = extraCrIdx != null ? statValue(aStats, extraCrIdx) : 0;
    const critRate = baseCritRate + extraCritRate;

    // CritDmg
    const baseCritDmg = statValue(aStats, 8);
    const extraCdIdx = critDmgExtraIdx(dt);
    const extraCritDmg = extraCdIdx != null ? statValue(aStats, extraCdIdx) : 0;
    const critDmg = (baseCritDmg + extraCritDmg);

    // Pen/Res — raw values stored; penRes is computed in calcDamage so bonuses are applied correctly
    const penIdx = ELEM_PEN_STAT[el];
    const resIdx = ELEM_RES_STAT[el];
    const pen = penIdx != null ? statValue(aStats, penIdx) : 0;
    const res = resIdx != null ? statValue(dStats, resIdx) : 0;
    // penRes computed later via calcPenRes with bonuses

    // DEF
    const defIgnore    = statBase(aStats, 10);   // DEF_Ignore = index 10
    const defPenetrate = statBase(aStats, 9);    // DEF_Penetrate = index 9
    const defRaw       = statBase(dStats, 2);    // DEF = index 2
    const effectiveDef = defRaw * (1 - defIgnore) - defPenetrate;
    const defAmend     = 1 - (effectiveDef * 40) / (effectiveDef * 32 + 24000);
    // Store raw components so calcDamage can recompute defAmend with effectiveDef bonus
    const _defIgnore    = defIgnore;
    const _defPenetrate = defPenetrate;
    const _defRaw       = defRaw;

    // EnvAmend
    const envAmend = dp.envAmendRatio != null ? dp.envAmendRatio : 1;

    // Compute penRes with zero bonus for display purposes
    const penRes = calcPenRes(aStats, dStats, el, 0, 0);

    // Hidden multipliers
    const genDmg          = statValue(aStats, 49);
    const intensity       = statValue(aStats, 48);
    const finalDmg        = statValue(aStats, 51);
    const genDmgRcd       = statValue(dStats, 53);
    const toughnessBroken = statValue(dStats, 86);

    return {
        multiplier, baseAtk, atkPct, atkAbs, elemPct, elemTakenPct,
        dmgTypePct, dmgTypeTakenPct,
        critRate, critDmg,
        pen, res, penRes,
        effectiveDef, defAmend,
        _defIgnore, _defPenetrate, _defRaw,
        envAmend, genDmg, intensity, finalDmg, genDmgRcd, toughnessBroken,
        isCrit: !!dp.isCrit,
        finalDamage: dp.finalDamage || 0,
        _aStats: aStats, _dStats: dStats, _el: el,
    };
}

function calcDamage(fields, bonuses, disabled) {
    let v = 1;
    fields.atkMulti = (fields.baseAtk+bonuses.baseAtk) * (fields.atkPct+bonuses.atkPct) + fields.atkAbs;

    // Recompute defAmend live if an effectiveDef bonus is set
    const effDefBonus = bonuses['effectiveDef'] || 0;
    let liveDefAmend = fields.defAmend;
    if (effDefBonus !== 0) {
        const liveEffDef = fields.effectiveDef + effDefBonus;
        liveDefAmend = 1 - (liveEffDef * 40) / (liveEffDef * 32 + 24000);
    }

    for (const key of DC_FORMULA_KEYS) {
        // critRate disabled: use expected-value multiplier 1 + critRate*(critDmg-1)
        // instead of the binary isCrit-based critDmg
        if (disabled.has(key)) continue;

        if (key === 'critDmg') {
            if (disabled.has('critRate')){
                const cr = (fields.critRate + (bonuses['critRate'] || 0));
                const cd = (fields.critDmg + (bonuses['critDmg'] || 0));
                v *= 1 + cr * (cd - 1);
                continue;
            }
            if (!fields.isCrit) continue;
        }
        
        let val;
        if (key === 'penRes')
            val = calcPenRes(fields._aStats, fields._dStats, fields._el, bonuses['pen'] || 0, bonuses['res'] || 0);
        else if (key === 'defAmend')
            val = liveDefAmend + (bonuses['defAmend'] || 0);
        else
            val = (fields[key] != null ? fields[key] : 1) + (bonuses[key] || 0);
        v *= val;
    }
    return Math.floor(v);
}

// ─── Formula bar rendering ────────────────────────────────────────────────────
function renderFormulaBar() {
    const bar = document.getElementById('dcFormulaBar');
    if (!bar) return;

    // Compute total calculated damage across filtered hits
    const hitEvs = dcFiltered;
    let totalCalc = 0;
    let totalGame = 0;
    hitEvs.forEach(ev => {
        const f = calcHitFields(ev);
        totalCalc += calcDamage(f, dcBonus, dcDisabled);
        totalGame += f.finalDamage;
    });

    let html = `<div class="dc-formula-totals">
        <span>Total Calc: <strong>${Math.round(totalCalc).toLocaleString()}</strong></span>
        <span style="margin-left:16px">Total In-Game: <strong>${Math.round(totalGame).toLocaleString()}</strong></span>
    </div>
    <div class="dc-formula-row">`;

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
            // CritRate: toggleable — when disabled uses critRate*(critDmg-1) expected multiplier
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
            // EffDEF: display-only label; bonus input feeds live into defAmend recalc
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
};

window.dcSetBonus = function(key, val) {
    const n = parseFloat(val);
    dcBonus[key] = isNaN(n) ? 0 : n;
    renderFormulaBar();
    dcRender();
};

// ─── Per-hit row fields ────────────────────────────────────────────────────────
// Returns an array of { key, val } in same order as formula display.
// Pass bonuses to get live-recomputed values (e.g. defAmend after effectiveDef bonus).
function hitFieldValues(fields, bonuses) {
    bonuses = bonuses || dcBonus;
    // Live defAmend: recompute if effectiveDef bonus is set
    const effDefBonus = bonuses['effectiveDef'] || 0;
    const liveEffDef = fields.effectiveDef + effDefBonus;
    const liveDefAmend = effDefBonus !== 0
        ? 1 - (liveEffDef * 40) / (liveEffDef * 32 + 24000)
        : fields.defAmend;
    return [
        { key: 'multiplier',      val: fields.multiplier },
        { key: 'baseAtk',         val: fields.baseAtk },
        { key: 'atkPct',          val: fields.atkPct },
        { key: 'elemPct',         val: fields.elemPct },
        { key: 'elemTakenPct',    val: fields.elemTakenPct },
        { key: 'dmgTypePct',      val: fields.dmgTypePct },
        { key: 'dmgTypeTakenPct', val: fields.dmgTypeTakenPct },
        { key: 'critRate',        val: fields.critRate },
        { key: 'critDmg',         val: fields.critDmg },
        { key: 'penRes',          val: fields.penRes },
        { key: 'effectiveDef',    val: liveEffDef },
        { key: 'defAmend',        val: liveDefAmend },
        { key: 'envAmend',        val: fields.envAmend },
    ];
}

// Fields displayed as percentages (value * 100 + '%')
// Excludes: baseAtk, pen, res, effectiveDef, defAmend
const DC_PCT_FIELDS = new Set([
    'multiplier','atkPct','elemPct','elemTakenPct',
    'dmgTypePct','dmgTypeTakenPct','critRate','critDmg',
    'penRes','defAmend','envAmend'
]);

function fmtVal(v, key) {
    if (v == null || isNaN(v)) return '—';
    if (key && DC_PCT_FIELDS.has(key)) {
        const pct = v * 100;
        const str = Number.isInteger(pct)
            ? pct.toLocaleString()
            : parseFloat(pct.toFixed(2)).toLocaleString();
        return str + '%';
    }
    if (Number.isInteger(v)) return v.toLocaleString();
    return v.toFixed(4).replace(/\.?0+$/, '');
}

// ─── DC event DOM ─────────────────────────────────────────────────────────────
function dcCreateEventDiv(ev, fi) {
    const oi = ev._origIndex;
    const isOpen = dcOpenStates[oi] || false;
    const hc = ev.HitConfig   || {};
    const dp = ev.DamageParams || {};

    const fields = calcHitFields(ev);
    const calcDmg = calcDamage(fields, dcBonus, dcDisabled);

    const attName  = esc(ev.AttackerDisplay || ev.Attacker || '?');
    const skillPart = hc.skillTitle ? esc(hc.skillTitle) : '';
    const hitPart   = hc.hitNum != null ? ` (#${hc.hitNum})` : '';
    const skillStr  = (skillPart || hitPart) ? ` - ${skillPart}${hitPart}` : '';
    const baseMult  = dp.skillPercentAmend != null ? ` [${(dp.skillPercentAmend/10000).toFixed(2)}%]` : '';

    const div = document.createElement('div');
    div.className = 'event dc-event' + (isOpen ? ' open' : '');
    div.style.top = dcFenwick.prefixSum(fi - 1) + 'px';
    div.dataset.origIndex    = oi;
    div.dataset.filteredIndex = fi;

    // ── Header ──
    const header = document.createElement('div');
    header.className = 'event-header dc-event-header';

    // Top row: attacker info + arrow
    const topRow = document.createElement('div');
    topRow.className = 'dc-header-top';

    const leftDiv = document.createElement('div');
    leftDiv.className = 'dc-header-left';
    leftDiv.innerHTML = `<span class="dc-att-name">${attName}${skillStr}${baseMult}</span>`;

    topRow.appendChild(leftDiv);

    // Field values row — full width below the top row
    const fvRow = document.createElement('div');
    fvRow.className = 'dc-fields-row';

    const fvs = hitFieldValues(fields, dcBonus);
    // We build the same alternating separators structure as the formula bar
    // to keep column alignment
    const DISPLAY_ORDER = [
        'multiplier','baseAtk','atkPct','elemPct','elemTakenPct',
        'dmgTypePct','dmgTypeTakenPct','critRate','critDmg',
        'penRes','effectiveDef','defAmend','envAmend'
    ];

    for (let i = 0; i < DISPLAY_ORDER.length; i++) {
        const key = DISPLAY_ORDER[i];
        const fvEntry = fvs.find(f => f.key === key);
        // effectiveDef/defAmend have bonus already baked in via hitFieldValues — don't double-show
        const bonus = dcBonus[key] || 0;
        const rawVal = fvEntry ? fvEntry.val : null;
        const skipBonusLabel = (key === 'effectiveDef' || key === 'defAmend');
        const dispVal = (bonus !== 0 && !skipBonusLabel)
            ? `${fmtVal(rawVal, key)} <span class="dc-bonus-label">(+${fmtVal(bonus, key)})</span>`
            : fmtVal(rawVal, key);
        const dis = dcDisabled.has(key);
        const isDisplayOnly = key === 'effectiveDef' || DC_FIELDS.find(f=>f.key===key)?.display_only;
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
    // resultStack is appended to header (absolute positioned), not fvRow

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

// Sub-section toggle inside dc event body (reuse existing collapsible logic)
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
                const fields = calcHitFields(ev);
                const calcDmg = calcDamage(fields, dcBonus, dcDisabled);
                const fvs = hitFieldValues(fields, dcBonus);
                const DISPLAY_ORDER = [
                    'multiplier','baseAtk','atkPct','elemPct','elemTakenPct',
                    'dmgTypePct','dmgTypeTakenPct','critRate','critDmg',
                    'penRes','effectiveDef','defAmend','envAmend'
                ];
                const cells = fvRow.querySelectorAll('.dc-field-cell');
                let ci = 0;
                for (const key of DISPLAY_ORDER) {
                    const cell = cells[ci++];
                    if (!cell) continue;
                    const fv = fvs.find(f=>f.key===key);
                    // effectiveDef and defAmend already have bonus baked in via hitFieldValues
                    const showBonus = dcBonus[key] || 0;
                    const rawVal = fv ? fv.val : null;
                    // For effectiveDef/defAmend the bonus is already folded into rawVal, don't double-show
                    const skipBonusLabel = (key === 'effectiveDef' || key === 'defAmend');
                    cell.innerHTML = (showBonus !== 0 && !skipBonusLabel)
                        ? `${fmtVal(rawVal, key)} <span class="dc-bonus-label">(${fmtVal(showBonus, key) > 0 ? '+' : ''}${fmtVal(showBonus, key)})</span>`
                        : fmtVal(rawVal, key);
                    const isDisplayOnly = key === 'effectiveDef' || DC_FIELDS.find(f=>f.key===key)?.display_only;
                    cell.className = 'dc-field-cell' +
                        (dcDisabled.has(key) ? ' dc-disabled' : '') +
                        (isDisplayOnly ? ' dc-display-only' : '');
                }
                // calc, game, diff cells (inside .dc-result-stack, not direct fvRow children)
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

// ─── DC filter helpers ────────────────────────────────────────────────────────
function dcBuildCharFilter() {
    const all = new Set();
    allEvents.filter(e => e.Type === 'Hit').forEach(e => {
        if (e.AttackerDisplay) all.add(e.AttackerDisplay);
    });
    const sel = document.getElementById('dcCharFilter');
    const cur = sel.value;
    sel.innerHTML = '<option value="">All Characters</option>';
    [...all].sort().forEach(c => {
        const o = document.createElement('option');
        o.value = c; o.textContent = c; sel.appendChild(o);
    });
    sel.value = [...sel.options].some(o => o.value === cur) ? cur : '';
    dcCharFilter = sel.value;
}

function dcBuildSkillFilter(evs) {
    const all = new Set();
    evs.forEach(e => {
        const n = (e.HitConfig || {}).skillTitle;
        if (n) all.add(n);
    });
    const sel = document.getElementById('dcSkillFilter');
    const cur = sel.value;
    sel.innerHTML = '<option value="">All Skills</option>';
    const MAX = 28;
    [...all].sort().forEach(s => {
        const o = document.createElement('option');
        o.value = s;
        o.textContent = s.length > MAX ? s.slice(0, MAX) + '…' : s;
        o.title = s;
        sel.appendChild(o);
    });
    sel.value = [...sel.options].some(o => o.value === cur) ? cur : '';
    dcSkillFilter = sel.value;
}

function dcBuildDefenderFilter() {
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
    const cur = sel.value;
    sel.innerHTML = '<option value="">All Defenders</option>';
    const MAX = 28;
    [...all].sort().forEach(c => {
        const o = document.createElement('option');
        o.value = c;
        o.textContent = c.length > MAX ? c.slice(0, MAX) + '…' : c;
        o.title = c;
        sel.appendChild(o);
    });
    if (cur && [...sel.options].some(o => o.value === cur)) {
        sel.value = cur;
    } else {
        // Default to the defender with highest total damage taken
        const top = all.sort((a, b) => dmgTotals[b] - dmgTotals[a])[0] || '';
        sel.value = top;
    }
    dcDefenderFilter = sel.value;
}

function dcApplyFilters() {
    let evs = allEvents.filter(e => e.Type === 'Hit');
    if (dcCharFilter) evs = evs.filter(e => (e.AttackerDisplay || '') === dcCharFilter);
    dcBuildSkillFilter(evs);
    if (dcSkillFilter) evs = evs.filter(e => ((e.HitConfig || {}).skillTitle || '') === dcSkillFilter);
    if (dcDefenderFilter) {
        evs = evs.filter(e => {
            const name = e.DefenderDisplay || e.Defender;
            if (!name) return true;
            const key = cleanOwner ? cleanOwner(name) : name;
            return key === dcDefenderFilter;
        });
    }
    return evs;
}

window.dcOnCharFilterChange = function() {
    dcCharFilter = document.getElementById('dcCharFilter').value;
    dcRefilterAndRender(true);
};
window.dcOnSkillFilterChange = function() {
    dcSkillFilter = document.getElementById('dcSkillFilter').value;
    dcRefilterAndRender(true);
};
window.dcOnDefenderFilterChange = function() {
    dcDefenderFilter = document.getElementById('dcDefenderFilter').value;
    dcRefilterAndRender(true);
};

// ─── DC refilter / rebuild ────────────────────────────────────────────────────
function dcRefilterAndRender(resetScroll = false) {
    dcBuildCharFilter();
    dcBuildDefenderFilter();
    dcFiltered = dcApplyFilters();
    if (resetScroll) {
        dcOpenStates = {};
        dcMeasuredHeights = {};
        dcSubOpenStates = {};
        dcContent.innerHTML = '';
        dcContainer.scrollTop = 0;
    }
    dcBuildFenwick();
    renderFormulaBar();
    renderEffectsPanel();
    document.getElementById('dcStats').textContent = `${dcFiltered.length} hits`;
    dcRender();
}

// ─── Tab hook ─────────────────────────────────────────────────────────────────
// Patch switchTab to handle dmgcalc tab
const _origSwitchTab = window.switchTab;
window.switchTab = function(tab) {
    document.getElementById('tabDmgCalc').classList.toggle('active', tab === 'dmgcalc');
    document.getElementById('dmgCalcPanel').classList.toggle('visible', tab === 'dmgcalc');
    if (tab === 'dmgcalc') {
        dcRefilterAndRender(false);
    }
    _origSwitchTab(tab);
};

// Also trigger a rebuild when allEvents changes (patch fetchLog indirectly
// via a MutationObserver on dcScrollSpacer height — simpler: just expose a hook)
// We'll call dcRefilterAndRender from the polling path by monkey-patching refilterAndRender.
const _origRefilterAndRender = window.refilterAndRender || refilterAndRender;
// We can't easily override the local function, so we add a call at the end of fetchLog
// Instead, expose dcRefresh globally and call it from dataLoader if needed.
window.dcRefreshIfVisible = function() {
    if (document.getElementById('dmgCalcPanel').classList.contains('visible')) {
        dcRefilterAndRender(false);
    }
};
