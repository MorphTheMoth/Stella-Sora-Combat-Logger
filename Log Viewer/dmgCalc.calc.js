// ─── dmgCalc.calc.js ──────────────────────────────────────────────────────────
// Pure calculation logic: stat helpers, damage formula, effect overrides.
// No DOM access. Consumed by dmgCalc.ui.js.

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

// Fields multiplied together in the damage formula.
// display_only fields (CritRate, EffDEF) are shown for context but not multiplied.
const DC_FORMULA_KEYS = [
    'multiplier','atkMulti','elemPct','elemTakenPct',
    'dmgTypePct','dmgTypeTakenPct','critDmg','penRes','defAmend',
    'envAmend', 'genDmg','intensity','finalDmg','genDmgRcd','toughnessBroken',
    'skillIntensity'
];

// ─── effectType constants ─────────────────────────────────────────────────────
const ATTR_FIX = 12;
const PLAYER_ATTR_FIX = 37;
const HITTED_ADDITIONAL_ATTR_FIX = 45;
const ELEMENTTYPE_ATTR_FIX = 52;
const ELEMENTTYPE_ATTR_PERCENT_FIX = 54;
const allowedEffectTypes = [ATTR_FIX, PLAYER_ATTR_FIX, HITTED_ADDITIONAL_ATTR_FIX, ELEMENTTYPE_ATTR_FIX, ELEMENTTYPE_ATTR_PERCENT_FIX];

// ─── Stat lookup tables ───────────────────────────────────────────────────────
// Element type → attacker stat index (17-22 → indices 17-22 in 0-based array)
const ELEM_ATK_STAT = { 1:17, 2:18, 3:19, 4:20, 5:21, 6:22 };
// Element type → defender stat index (35-40)
const ELEM_DEF_STAT = { 1:35, 2:36, 3:37, 4:38, 5:39, 6:40 };
// Element type → pen attacker (23-28), res defender (11-16)
const ELEM_PEN_STAT = { 1:23, 2:24, 3:25, 4:26, 5:27, 6:28 };
const ELEM_RES_STAT = { 1:11, 2:12, 3:13, 4:14, 5:15, 6:16 };
// Element type → resistance ignore attacker stat (29-34)
const ELEM_IGN_STAT = { 1:29, 2:30, 3:31, 4:32, 5:33, 6:34 };

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

// ─── Pen/Res formula ──────────────────────────────────────────────────────────
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

// ─── Effect collection ────────────────────────────────────────────────────────
// Collect unique effects across all filtered hits.
// Returns an array of { key, side, configId, valueConfigId, name, attrType, subType, value, count, source, fromAttrDict }
function dcCollectAttrFixEffects(dcFiltered) {
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
    // ── Potentials hits ───────────────────────────────────────────────────────
    // Group hits whose .source contains "Potentials" by their skillTitle.
    // Each group becomes one toggle entry (key: `potentials:<skillTitle>`).
    const potentialsHitsGroups = new Map(); // skillTitle -> { count }
    for (const ev of dcFiltered) {
        const src = ev.source ?? ev.HitConfig?.source ?? '';
        if (!src.includes('Potentials')) continue;
        const skillTitle = ev.HitConfig?.skillTitle ?? 'Unknown';
        if (!potentialsHitsGroups.has(skillTitle)) {
            potentialsHitsGroups.set(skillTitle, { count: 0, multipliers: [], source: src });
        }
        potentialsHitsGroups.get(skillTitle).count++;
        if (!potentialsHitsGroups.get(skillTitle).multipliers.includes(ev.DamageParams.skillPercentAmend/10000))
            potentialsHitsGroups.get(skillTitle).multipliers.push(ev.DamageParams.skillPercentAmend/10000);
        
    }
    for (const [skillTitle, { count, multipliers, source }] of potentialsHitsGroups) {
        const key = `potentials:${skillTitle}`;
        seen.set(key, {
            key,
            side: 'potentials',
            configId: null,
            valueConfigId: null,
            name: skillTitle,
            attrType: null,
            subType: null,
            value: multipliers,
            count,
            source,
            fromAttrDict: false,
            effectType: null,
            isPotentialsGroup: true,
            skillTitle,
        });
    }

    return [...seen.values()];
}

// ─── Effect overrides ─────────────────────────────────────────────────────────
// Apply disabled effects to a cloned copy of the stat arrays.
// Returns { aStats, dStats } (clones with modifications applied).
function dcApplyEffectOverrides(ev, dcEffectsDisabled) {
    const origA = ev.AttackerStats?.attrs || [];
    const origD = ev.DefenderStats?.attrs || [];
    if (dcEffectsDisabled.size === 0) return { aStats: origA, dStats: origD };

    // ── Potentials group disable ──────────────────────────────────────────────
    // If this hit belongs to a disabled Potentials group, zero all its stats so
    // calcDamage produces 0 for this hit.
    const evSrc = ev.source ?? ev.HitConfig?.source ?? '';
    if (evSrc.includes('Potentials')) {
        const skillTitle = ev.HitConfig?.skillTitle ?? 'Unknown';
        if (dcEffectsDisabled.has(`potentials:${skillTitle}`)) {
            return { aStats: origA, dStats: origD, _potentialsDisabled: true };
        }
    }

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

// ─── Main hit field extraction ────────────────────────────────────────────────
function calcHitFields(ev, statOverrides, dcEffectsDisabled) {
    const hc  = ev.HitConfig   || {};
    const dp  = ev.DamageParams || {};
    const resolved = statOverrides || dcApplyEffectOverrides(ev, dcEffectsDisabled);

    // Hit belongs to a disabled Potentials group — return zeroed fields so
    // calcDamage produces 0 without touching the stat arrays.
    if (resolved._potentialsDisabled) {
        return {
            multiplier: 0, baseAtk: 0, atkPct: 1, atkAbs: 0,
            elemPct: 1, elemTakenPct: 1, dmgTypePct: 1, dmgTypeTakenPct: 1,
            critRate: 0, critDmg: 1, pen: 0, res: 0, penRes: 1,
            effectiveDef: 0, defAmend: 1,
            _defIgnore: 0, _defPenetrate: 0, _defRaw: 0,
            envAmend: 1, genDmg: 1, intensity: 1, finalDmg: 1,
            genDmgRcd: 1, toughnessBroken: 1,
            isCrit: false, finalDamage: dp.finalDamage || 0,
            _aStats: resolved.aStats, _dStats: resolved.dStats, _el: hc.elementType,
            _potentialsDisabled: true,
        };
    }

    const { aStats, dStats } = resolved;

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

    // DEF
    const defIgnore    = statBase(aStats, 10);   // DEF_Ignore = index 10
    const defPenetrate = statBase(aStats, 9);    // DEF_Penetrate = index 9
    const defRaw       = statBase(dStats, 2);    // DEF = index 2
    const effectiveDef = defRaw * (1 - defIgnore) - defPenetrate;
    const defAmend     = 1 - (effectiveDef * 40) / (effectiveDef * 32 + 24000);

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
    const skillIntensity     = statValue(aStats, 85) + 1;

    return {
        multiplier, baseAtk, atkPct, atkAbs, elemPct, elemTakenPct,
        dmgTypePct, dmgTypeTakenPct,
        critRate, critDmg,
        pen, res, penRes,
        effectiveDef, defAmend,
        _defIgnore: defIgnore, _defPenetrate: defPenetrate, _defRaw: defRaw,
        envAmend, genDmg, intensity, finalDmg, genDmgRcd, toughnessBroken, skillIntensity,
        isCrit: !!dp.isCrit,
        finalDamage: dp.finalDamage || 0,
        _aStats: aStats, _dStats: dStats, _el: el,
    };
}

// ─── Damage calculation ───────────────────────────────────────────────────────
function calcDamage(fields, bonuses, disabled) {
    let v = 1;
    fields.atkMulti = (fields.baseAtk + bonuses.baseAtk) * (fields.atkPct + bonuses.atkPct) + fields.atkAbs;

    // Recompute defAmend live if an effectiveDef bonus is set
    const effDefBonus = bonuses['effectiveDef'] || 0;
    let liveDefAmend = fields.defAmend;
    if (effDefBonus !== 0) {
        const liveEffDef = fields.effectiveDef + effDefBonus;
        liveDefAmend = 1 - (liveEffDef * 40) / (liveEffDef * 32 + 24000);
    }

    for (const key of DC_FORMULA_KEYS) {
        if (disabled.has(key)) continue;

        if (key === 'critDmg') {
            if (disabled.has('critRate')) {
                // Use expected-value multiplier: 1 + critRate*(critDmg-1)
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

// ─── Display helpers ──────────────────────────────────────────────────────────
// Fields displayed as percentages (value * 100 + '%')
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

// Returns an array of { key, val } in display order.
// Pass bonuses to get live-recomputed values (e.g. defAmend after effectiveDef bonus).
function hitFieldValues(fields, bonuses) {
    bonuses = bonuses || {};
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
        { key: 'skillIntensity',     val: fields.skillIntensity },
    ];
}
