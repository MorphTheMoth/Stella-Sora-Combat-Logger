// ─── emblemsComparison.js ─────────────────────────────────────────────────────
// "Emblems Comparison" tab — a blank-slate comparison of every emblem (gem)
// line type in CharGemAttrValue against the current record, shown as ONE
// TABLE PER RECORD CHARACTER (side by side): every hypothetical emblem line
// is applied to that table's character only.
//
// The baseline disables ALL emblem effects the record's build carries (flat
// stat rolls, percent rolls, potential affix rows and skill affix rows —
// everything buildRecordEmblemEffects emits), so every row answers "what does
// this line add to this character, starting from a build with no emblems".
//
// Rows follow the record builder's emblem model (Nebula-Record-Builder
// potentials.js buildEmblemGroups / tableResolver.js buildRecordEmblemEffects):
//   attrType 12 — stat lines, applied by CharGemAttrValue's
//                 AttrTypeFirstSubtype (attr id) + AttrTypeSecondSubtype
//                 (1 = base → stat.origin for record rows, 2 = pct).
//                 The percent HP/ATK/DEF rolls the game serializes as Effect
//                 ids (81xxx, EffectValue subType 2) have their own
//                 CharGemAttrValue entries here (same attr id, subType 2).
//   attrType 37 — Charge Eff (Main/Supp): no numeric attr id, the damage calc
//                 can't model it → gain "—".
//   attrType  7 — skill-levelup affixes (Emblem 80): +1/+2/+3 lv to a skill
//                 slot of the equipped character.
//   attrType 99 — potential-levelup affixes (Emblem 90): +1/+2/+3 lv to one
//                 of the equipped character's potentials.
//
// Emblem tiers (which emblem can roll which line) come from CharGemAttrType
// GroupId ↔ CharGemAttrGroup: groups 1-4 → slot 1 (Emblem 70), 5-8 + 11 →
// slot 2 (Emblem 80), 9 + 10 + 12 → slot 3 (Emblem 90) — verified against the
// logged GEM_REFRESH slot ids (slot 1 rolls typeIds 1-34, slot 2 rolls
// 35-38 + 60-93, slot 3 rolls 39-59 + 94-112).
//
// Existence filter: some (line, tier) entries in CharGemAttrValue are never
// rolled by the game (e.g. per-type crit rate 15%). The set of ids that DO
// appear is parsed from the emblem roll log (GEM_REFRESH RESP ids — the same
// file the Emblem Tracker reads, served at /emblems/log). Unobserved entries
// are dropped, EXCEPT the four categories the record builder's emblem model
// treats as always-rollable (rare, not absent): potential levelups (99),
// Charge Eff (37), plain Crit Rate (attr 6) and elemental Pen (attr 23-28).
//
// Gain columns ×1/×2/×3: one column PER COPY — lines that exist on several
// emblem tiers (e.g. 15% crit rate on both Emblem 70 and Emblem 80) show the
// gain from nothing → 1 copy, then 1 → 2 copies, as percentages of the
// cumulative total before that copy.

// ─── State ────────────────────────────────────────────────────────────────────
let ecLastData = null;     // { tables: [{charId, charName, hitCount, baseTotal, rows}] }
let _ecRenderSeq = 0;      // guards stale async computes
let _ecAutoLoading = false; // guards the dcRefilterAndRender auto-load re-entry
// Expected-crit mode: crit rate is display-only in the per-hit calc (the hit's
// isCrit flag decides), so crit-rate lines only gain when the whole comparison
// is evaluated with the expected multiplier 1 + critRate×(critDmg−1). This tab
// ALWAYS runs in expected-crit mode (no toggle — crit-rate lines are core
// emblem lines). Local to this tab (does not touch the global dcDisabled).
let ecExpectedCrit = true;
// Emblem tier filter (radio): 0 = all, or a single emblem tier (70/80/90).
let ecTierSel = 0;
// Gain-column visibility (×1/×2/×3 droplist) — ×1 and ×2 by default.
let ecColsSel = { 1: true, 2: true, 3: false };
let ecColsOpen = false;
// Show the 0%-gain rows (Def/MaxHp, off-element lines…) — hidden by default.
let ecShowZero = false;
let ecShowColors = false;   // tier background colors — off by default
// Damage scope per character table: 'team' (gains vs the whole deployed
// team's damage, default) or 'personal' (gains vs that char's damage).
let ecScopeByChar = {};
// Minimum emblem-stat rarity to show: 1 green / 2 blue / 3 gold / 4 rainbow
// (CharGemAttrValue.Rarity — rank 1 = green weakest … 4 = rainbow best).
// A line is shown when any of its emblem-tier entries reaches the rarity.
let ecRarityMin = 4;   // rainbow by default
// Emblem-roll existence data: CharGemAttrValue ids seen in the emblem roll
// log (http_log.txt GEM_REFRESH responses, served at /emblems/log — the same
// source the Emblem Tracker reads). null = unavailable (no filtering).
let ecObservedIds = null;
let ecObservedTried = false;

function ecResetState() {
    ecLastData = null;
    ecScopeByChar = {};
    ecRarityMin = 4;
    _ecRenderSeq++;
}

// Emblem tier (70/80/90) that can roll a CharGemAttrValue TypeId.
function ecGemTier(typeId) {
    if (typeId == null) return null;
    if (typeId <= 34) return 70;        // groups 1-4: base stat pools
    if (typeId <= 38) return 80;        // group 11: skill-levelup affixes
    if (typeId <= 59) return 90;        // group 12: potential affixes
    if (typeId <= 93) return 80;        // groups 5-8
    return 90;                          // groups 9-10
}

// Stat-column formatting: fractions (<15) render as %, flats as-is
// (mirrors the effect-impact stat cell convention).
function ecFormatStatValue(v) {
    if (v == null) return '?';
    if (Math.abs(v) < 15) {
        const pct = Math.round(v * 10000) / 100;
        return (Number.isInteger(pct) ? pct.toLocaleString() : parseFloat(pct.toFixed(2)).toLocaleString()) + '%';
    }
    return (Math.round(v * 1000) / 1000).toLocaleString();
}

// ─── Existence filter (emblem roll log) ───────────────────────────────────────
// Lines a stat category is exempt from the filter for: the record builder's
// emblem model treats these as always-rollable and they are rare rather than
// absent — potential levelups (attr 99), Charge Eff (attr 37), plain Crit
// Rate (attr 6) and elemental Pen (attr 23-28). Everything else that never
// appears in the roll log is treated as not obtainable in game (e.g. per-type
// crit rate 15% — rolled by nothing).
function ecRollExempt(gv) {
    if (gv.attrType === 99 || gv.attrType === 37) return true;
    if (gv.attrType === 12) {
        if (gv.first === 6) return true;               // Crit Rate
        if (gv.first >= 23 && gv.first <= 28) return true;   // elemental Pen
    }
    return false;
}

// Fetch + parse the emblem roll log once per session (best effort — on
// failure the existence filter is skipped entirely).
function ecEnsureObserved(done) {
    if (ecObservedTried) return done();
    ecObservedTried = true;
    fetch('/emblems/log').then(r => {
        if (!r.ok) throw new Error(String(r.status));
        return r.text();
    }).then(text => {
        const ids = new Set();
        for (const m of text.matchAll(/RESP \[([0-9, ]*)\]/g)) {
            for (const tok of m[1].split(',')) {
                const t = tok.trim();
                if (!t) continue;
                const n = parseInt(t, 10);
                if (n > 0) ids.add(n);
            }
        }
        ecObservedIds = ids;
    }).catch(() => {
        ecObservedIds = null;   // no roll data → don't filter
    }).finally(() => done());
}

// ─── Candidate list ───────────────────────────────────────────────────────────
// Built from CharGemAttrValue (gemAttrValueById), existence-filtered:
//   stat/charge rows are character-agnostic; skill/potential affix rows are
//   per record character (the affix applies to its owner's skill slots /
//   potentials, from the record's per-char lists).
// Attr rows carry `tiers: [{tier, id}]` — one entry per emblem tier that can
// roll that (stat, value) — each with the CharGemAttrValue id used for the
// existence check.
function ecBuildCandidates() {
    const rec = getOriginRecord();
    const attrRows = [];
    const skillRows = [];
    const potRows = [];
    if (!rec) return { attrRows, skillRows, potRows };

    const attrMap = new Map();   // "attrType:subType:value" → row
    for (const [idStr, gv] of gemAttrValueById) {
        if (gv.value == null) continue;
        if (gv.attrType !== 12 && gv.attrType !== 37) continue;
        const id = parseInt(idStr, 10);
        const exists = (ecObservedIds == null) || ecRollExempt(gv) || ecObservedIds.has(id);
        if (!exists) continue;
        if (gv.attrType === 12 && gv.first == null) continue;
        const attrType = gv.attrType === 12 ? gv.first : null;
        const subType  = gv.attrType === 12 ? (gv.second || 1) : null;
        const key = gv.attrType === 12 ? `${attrType}:${subType}:${gv.value}` : `charge:${gv.first ?? 0}:${gv.value}`;
        let row = attrMap.get(key);
        if (!row) {
            row = gv.attrType === 12
                ? {
                    kind: 'attr', name: attrName(attrType),
                    attrType, subType, value: gv.value,
                    valueStr: ecFormatStatValue(gv.value),
                    tiers: [],
                    // fields eiPatchStats reads when applying the patch:
                    // record rows contribute on the attacker side, ATTR_FIX
                    // family (isRecord → flat rolls go to stat.origin)
                    side: 'attacker', effectType: ATTR_FIX, isRecordEffect: true,
                }
                : {
                    // Charge Eff — no numeric attr id → not modeled by the calc
                    kind: 'charge',
                    name: `Charge Eff (${gv.first === 1 ? 'Main' : 'Supp'})`,
                    attrType: null, subType: null, value: gv.value,
                    valueStr: ecFormatStatValue(gv.value),
                    tiers: [],
                };
            attrMap.set(key, row);
        }
        const t = ecGemTier(gv.typeId);
        if (t && !row.tiers.some(e => e.tier === t)) row.tiers.push({ tier: t, id, rarity: gv.rarity ?? 1 });
    }
    for (const row of attrMap.values()) row.tiers.sort((a, b) => a.tier - b.tier);
    attrRows.push(...attrMap.values());

    // Per-stat-line rainbow availability + max grade — the rainbow rarity
    // filter keeps the max-lvl row of stats that never roll rainbow in the
    // observed data (otherwise the whole stat would vanish).
    const statAgg = new Map();   // statKey → { anyRainbow, maxLevel }
    for (const row of attrRows) {
        const statKey = row.kind === 'charge'
            ? (row.name.includes('(Main)') ? 'ch:main' : 'ch:supp')
            : `a:${row.attrType}:${row.subType}`;
        row.statKey = statKey;
        let lvl = 0;
        for (const e of row.tiers) {
            const l = gemAttrValueById.get(e.id)?.level ?? 0;
            if (l > lvl) lvl = l;
        }
        row.gradeLevel = lvl;
        let info = statAgg.get(statKey);
        if (!info) { info = { anyRainbow: false, maxLevel: 0 }; statAgg.set(statKey, info); }
        if (row.tiers.some(e => (e.rarity ?? 1) >= 4)) info.anyRainbow = true;
        if (lvl > info.maxLevel) info.maxLevel = lvl;
    }
    for (const row of attrRows) {
        const info = statAgg.get(row.statKey);
        row.statNoRainbow = !info.anyRainbow;
        row.isStatMax = row.gradeLevel === info.maxLevel;
    }

    // Skill-levelup affix rows — one per record char × skill slot, gains for
    // the roll tiers +1/+2/+3 lv (CharGemAttrValue Level / Value).
    for (const ch of (rec.chars || [])) {
        const charId = Number(ch.charId);
        if (!charId) continue;
        const charName = (typeof resolveActorKey === 'function') ? resolveActorKey('p:' + charId) : String(charId);
        for (let gemSlot = 1; gemSlot <= 4; gemSlot++) {
            const actionSlot = GEM_SLOT_TO_ACTION[gemSlot] ?? gemSlot;
            // Only slots the character actually has a level table entry for.
            if (!dcSkillLevels.get(`${charId}:${actionSlot}`)) continue;
            skillRows.push({
                kind: 'skill', charId, charName,
                gemSlot, actionSlot,
                name: `${GEM_SKILL_SLOT_NAMES[gemSlot] || ('Skill ' + gemSlot)} Lv`,
                // Skill-levelup affixes only roll on Emblem 80 lines
                // (CharGemAttrValue TypeId group 11: 35-38).
                tiers: [{ tier: 80, rarity: 4 }],
            });
        }
        // Potential affix rows — one per potential the character owns
        // (the record's per-char pot list), gains for +3 lv. Potential
        // levelup affixes only roll on Emblem 90 lines
        // (CharGemAttrValue TypeId group 12: 39-59).
        for (const p of (ch.pots || [])) {
            const potId = Number(Array.isArray(p) ? p[0] : p?.potId);
            if (!potId) continue;
            // Single-level potentials (max lvl 1 — +3 lv is meaningless):
            // pot index 1-4 and 21-24. Not built at all → never computed.
            const potIdx = potId % 100;
            if (potIdx === 1 || potIdx === 2 || potIdx === 3 || potIdx === 4
                || potIdx === 21 || potIdx === 22 || potIdx === 23 || potIdx === 24) continue;
            const name = discLangNames.get(String(potId))
                || potentialNameById.get(potId)
                || `Potential ${potId % 100}`;
            potRows.push({
                kind: 'pot', charId, charName, potId, name,
                tiers: [{ tier: 90, rarity: 4 }],
            });
        }
    }

    return { attrRows, skillRows, potRows };
}

// ─── Analytic damage engine ───────────────────────────────────────────────────
// Closed-form evaluation of the calcDamage product per hit, so a candidate
// patch costs ~15 multiplies instead of a stat-clone + calcHitFields +
// calcDamage round-trip. Math.floor is kept at the very end, and every factor
// expression mirrors calcHitFields/calcDamage/calcPenRes exactly, so results
// are identical to the patch path (the regression test cross-checks against
// ecHitDamage, the naive per-hit patch, and the profile harness diffs the full
// row set against the previous implementation).
//
// Per hit the preanalysis stores on b.intel:
//   aStats/dStats  — the DISABLE-ONLY stat state: dcApplyEffectOverrides(...,
//                    skipLevelOverrides) = raw stats minus every disabled row
//                    (snapshot aggregation included), WITHOUT the baseline
//                    level-override deltas. Candidate ops are applied on top
//                    of these in the exact order the override machinery would
//                    apply them, so the evaluated damage matches the patch
//                    path bit-for-bit.
//   baseOps        — the baseline level-override deltas (pot/skill/note
//                    effective levels under extDisabled). disableOnly +
//                    baseOps = the real baseline state the patch path uses;
//                    they are applied once to build fields/b.dmg.
//   f/fb           — factor bases (raw calcHitFields values) + bonus constants.
//   pen0/res0/ign0/vul0, defRaw0/defIg0/defPen0, cr6_0/crX_0/cd8_0/cdX_0
//   readers        — "side:attr" → factor-op list (cached per element+dtype).
//   potAff/skillAff — affected-set mirrors of ecPotHitAffected/
//                    ecSkillHitAffected, precomputed once per hit.
//   potEntries/skillEntries — candidate-relevant level-scaled entries with
//                    their ladders; potPerk/skillPerk — the hit's own
//                    level-scaling source for the multiplier re-pick.

// Factor op codes (dispatched in ecAnalyticDamage).
const EC_OP_BASE_ATK = 1, EC_OP_ATK_PCT = 2, EC_OP_ATK_ABS = 3,
    EC_OP_ELEM_PCT = 4, EC_OP_ELEM_TAKEN = 5, EC_OP_DT_PCT = 6, EC_OP_DT_TAKEN = 7,
    EC_OP_CRIT_RATE = 8, EC_OP_CRIT_DMG = 9,
    EC_OP_PEN = 10, EC_OP_RES = 11, EC_OP_IGN = 12, EC_OP_VUL = 13,
    EC_OP_DEF_RAW = 14, EC_OP_DEF_IGN = 15, EC_OP_DEF_PEN = 16,
    EC_OP_GEN_DMG = 17, EC_OP_INTENSITY = 18, EC_OP_FINAL_DMG = 19,
    EC_OP_GEN_DMG_RCD = 20, EC_OP_TOUGH = 21, EC_OP_SKILL_INT = 22;

// Which formula factors a stat id feeds, for one (element, damageType,
// expected-crit) combination. Cached: the reader map only depends on these
// three, not on the hit. Side codes: 0 = attacker, 1 = defender; map keys are
// side*128+attr.
const _ecReaderCache = new Map();
function ecReadersFor(el, dt, expected) {
    const ck = (el == null ? -1 : el) + '|' + (dt == null ? -1 : dt) + '|' + (expected ? 1 : 0);
    let m = _ecReaderCache.get(ck);
    if (m) return m;
    m = new Map();
    const add = (side, attr, op) => {
        if (attr == null) return;
        const k = side * 128 + attr;
        let a = m.get(k);
        if (!a) { a = []; m.set(k, a); }
        a.push(op);
    };
    add(0, 1, EC_OP_BASE_ATK);            // baseAtk = statBase(a,1)
    add(0, 1, EC_OP_ATK_PCT);             // atkPct = 1 + pct(a,1)
    add(0, 1, EC_OP_ATK_ABS);             // atkAbs = abs(a,1)
    const ea = ELEM_ATK_STAT[el]; if (ea != null) add(0, ea, EC_OP_ELEM_PCT);
    const ed = ELEM_DEF_STAT[el]; if (ed != null) add(1, ed, EC_OP_ELEM_TAKEN);
    const da = dmgTypeAtkStat(dt); if (da != null) add(0, da, EC_OP_DT_PCT);
    const dd = dmgTypeDefStat(dt); if (dd != null) add(1, dd, EC_OP_DT_TAKEN);
    if (expected) {
        add(0, 6, EC_OP_CRIT_RATE);       // critRate = sv(a,6) + sv(a,crExtra)
        const cre = critRateExtraIdx(dt); if (cre != null) add(0, cre, EC_OP_CRIT_RATE);
    }
    add(0, 8, EC_OP_CRIT_DMG);            // critDmg = sv(a,8) + sv(a,cdExtra)
    const cde = critDmgExtraIdx(dt); if (cde != null) add(0, cde, EC_OP_CRIT_DMG);
    const pi = ELEM_PEN_STAT[el]; if (pi != null) add(0, pi, EC_OP_PEN);
    const ri = ELEM_RES_STAT[el]; if (ri != null) add(1, ri, EC_OP_RES);
    const ii = ELEM_IGN_STAT[el]; if (ii != null) add(0, ii, EC_OP_IGN);
    add(0, 55, EC_OP_VUL);
    add(1, 2, EC_OP_DEF_RAW);             // effectiveDef = sb(d,2)*(1-sb(a,10)) - sv(a,9)
    add(0, 10, EC_OP_DEF_IGN);
    add(0, 9, EC_OP_DEF_PEN);
    add(0, 49, EC_OP_GEN_DMG);
    add(0, 48, EC_OP_INTENSITY);
    add(0, 51, EC_OP_FINAL_DMG);
    add(1, 53, EC_OP_GEN_DMG_RCD);
    add(1, 86, EC_OP_TOUGH);
    add(0, 85, EC_OP_SKILL_INT);
    _ecReaderCache.set(ck, m);
    return m;
}

// calcPenRes's body, factored to take the already-composed effectiveRes.
// MUST stay arithmetic-identical with calcPenRes (dmgCalc.calc.js) — the
// caller composes effectiveRes = res*(1-ign) - pen exactly like calcPenRes
// does, so both paths produce the same float.
function ecPenFactorOf(effectiveRes, vul) {
    if (effectiveRes <= 0) {
        return (1 + vul * 0.1) + (vul * effectiveRes * -0.01 * 0.9);
    }
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
    return 1 - (amendLower + (amendUpper - amendLower) * (ratio * ratio));
}

// statValue/statBase expressions on a (possibly patched) quadruple.
// MUST stay expression-identical with statValue/statBase (dmgCalc.calc.js).
function ecSvQuad(o, b, p, x) { return ((o || 0) + (b || 0)) * (1 + (p || 0)) + (x || 0); }
function ecSbQuad(o, b) { return (o || 0) + (b || 0); }

// Where does one dcApplyEffectValue contribution land?
// meta mirrors the descriptor the override block passes (effectType /
// attrType / subType / isRecord / bySubType); returns [attrId, kind] with
// kind 0=origin, 1=base, 2=pct, 3=abs, or null when the application is a
// no-op for this hit (unknown family, or element-typed with a different hit
// element — dcApplyEffectValue's fall-through branches).
function ecOpSlot(meta, elem) {
    if (meta.bySubType || meta.allowUnknown) {
        if (meta.subType === 1) return [meta.attrType, 1];
        if (meta.subType === 2) return [meta.attrType, 2];
        if (meta.subType === 3) return [meta.attrType, 3];
        return null;
    }
    const et = meta.effectType;
    if (et === ELEMENTTYPE_ATTR_FIX) return (meta.subType === elem) ? [meta.attrType, 1] : null;
    if (et === ELEMENTTYPE_ATTR_PERCENT_FIX) return (meta.subType === elem) ? [meta.attrType, 2] : null;
    if (ATTR_FAMILY_TYPES.has(et)) {
        if (meta.subType === 1) return [meta.attrType, (meta.isRecord ?? meta.isRecordEffect) ? 0 : 1];
        if (meta.subType === 2) return [meta.attrType, 2];
        if (meta.subType === 3) return [meta.attrType, 3];
        return null;
    }
    return null;
}

// The state ops one level-scaled entry contributes when its override value is
// ovV (null = no override under this state → the level-override block skips
// the row entirely: NO removal, state stays at the raw logged placement).
// Element-typed rows no-op on element mismatch (both branches). Returns an
// ordered op list or null (no ops).
function ecEntryOps(entry, ovV) {
    if (ovV == null) return null;
    const ops = [];
    const rSlot = ecOpSlot(entry.rMeta, entry.elem);
    if (rSlot) ops.push([entry.side, rSlot[0], rSlot[1], -(entry.remVal * entry.n)]);
    const aSlot = ecOpSlot(entry.aMeta, entry.elem);
    if (aSlot) ops.push([entry.side, aSlot[0], aSlot[1], ovV * entry.n]);
    return ops.length ? ops : null;
}

// The value the override machinery applies at effective level L for this
// entry (null = no override — keep the logged contribution). Mirrors
// dcGetLevelOverride's pot and skill branches exactly, including their
// different L<=0 handling (pot zeroes the contribution, skill keeps logged).
// The base override value is precomputed in the intel; this is called with
// candidate levels only.
function ecEntryOvValue(entry, L) {
    if (L == null || L === entry.curL) return null;
    if (entry.kind === 'note') {
        if (L <= 0) return null;                    // note branch: keep logged
        const newVcId = entry.configId + L * 10;
        const sv = entry.isAttr
            ? (() => { const slots = onceAttrValueTable.get(newVcId) || []; return slots.find(s => (s.slotNum ?? 1) === (entry.slotNum ?? 0)) ?? slots[0]; })()
            : effectValueTable.get(newVcId);
        if (!sv || sv.value == null) return null;   // ladder row missing → keep logged
        return sv.value;
    }
    if (entry.kind === 'pot') {
        if (L <= 0) return 0;   // pot branch: override with value 0
        const newVcId = entry.lo + entry.P * 100 + L * 10 + entry.V;
        const sv = entry.isAttr
            ? (() => { const slots = onceAttrValueTable.get(newVcId) || []; return slots.find(s => (s.slotNum ?? 1) === (entry.slotNum ?? 0)) ?? slots[0]; })()
            : effectValueTable.get(newVcId);
        if (!sv || sv.value == null) return null;   // ladder row missing → keep logged
        return sv.value;
    }
    // skill branch
    if (L <= 0) return null;                        // skill branch: keep logged
    const newVcId = entry.configId + L * 10;
    const sv = entry.isAttr
        ? (() => { const slots = onceAttrValueTable.get(newVcId) || []; return slots.find(s => (s.slotNum ?? 1) === (entry.slotNum ?? 0)) ?? slots[0]; })()
        : effectValueTable.get(newVcId);
    if (!sv || sv.value == null) return null;
    return sv.value;
}

// dcPotEffectiveLevel / dcSkillEffectiveLevel under a candidate's +3 bonus.
// The base levels come from the real functions (called with extDisabled);
// the candidate level replicates them with the synthetic ec row added.
function ecPotLcand(st) {
    return Math.min(Math.max(st.recordLv + 3 + (st.change || 0), 0), 9);
}
function ecSkillLcand(st) {
    let rowBonus = 0;
    for (const [rowKey, lv] of (st.bonusByRow || [])) {
        if (rowKey != null && extDisabledRef.has(rowKey)) continue;
        rowBonus += lv;
    }
    const bonus = rowBonus + 3;   // the candidate's synthetic [ecKey, 3] row
    const cap = Math.max((st.maxLv > 0 ? st.maxLv : 99) + bonus, 13);
    return Math.min(Math.max(st.recordLv + bonus + (st.change || 0), 0), cap);
}
// extDisabledRef — set by ecComputeBase while candidates compute (the
// candidate level functions need the same disabled set dcGetLevelOverride
// would see).
let extDisabledRef = new Set();

// ─── Per-hit preanalysis ──────────────────────────────────────────────────────
// Runs once per baseline hit per compute: builds the analytic descriptor plus
// the affected-set and level-scaled-entry maps. Replaces the per-candidate
// full-stat re-derivation (dcApplyEffectOverrides ×27k) with one pass.
// Numeric side code → the key string the override machinery uses
// ('attacker' / 'defender' — the collected rows' keys and the disable-set keys).
function sideStr(side) { return side === 0 ? 'attacker' : 'defender'; }

function ecPreanalyzeHit(b, extDisabled) {
    const ev = b.ev;
    const hc = ev.HitConfig || {};

    const pre = { potAff: null, skillAff: null, lv: null, baseOps: [] };
    // ── Potentials-source identity (the EI Potentials-group rows' affected
    // test) + the zeroed flag (the group's key in the disabled set)
    {
        const evSrc = ev.source ?? hc.source ?? '';
        if (dcIsPotentialsSource(evSrc)) {
            const skillTitle = hc.skillTitle ?? 'Unknown';
            pre.potGroup = skillTitle;
            pre.zeroed = (typeof dcEffectsDisabled !== 'undefined') && dcEffectsDisabled.has('potentials:' + skillTitle);
        }
    }
    {
        const dp = ev.DamageParams || {};
        pre.loggedL = dp.skillLevel != null ? dp.skillLevel : null;
        pre.logRaw = dp.skillPercentAmend != null ? dp.skillPercentAmend / 10000 / 100 : 0;
        pre.potPerk = hc.levelTypeData === 1 && hc.levelData != null ? Number(hc.levelData) : null;
        pre.skillPerk = (hc.levelTypeData === 3 && b.charId != null)
            ? b.charId + ':' + dcSkillSlotFor(hc.levelData, hc.mainOrSupport) : null;
    }

    // ── affected sets — exact mirrors of ecPotHitAffected / ecSkillHitAffected ──
    // potAff/noteAff cover family + attrDict sources (the EC affected tests);
    // potAffFam/noteAffFam are the EI hasFamily mirrors (eiEffectFamily only).
    const potAff = new Set();
    const potAffFam = new Set();
    const noteAffFam = new Set();
    const skillAff = new Set();
    if (pre.potPerk != null) { potAff.add(pre.potPerk); potAffFam.add(pre.potPerk); }
    if (pre.skillPerk != null) skillAff.add(pre.skillPerk);
    for (const e of eiEffectFamily(ev)) {
        const cid = e.configId;
        if (cid != null) {
            const pid = dcEffectPot.get(cid);
            if (pid != null) { potAff.add(pid); potAffFam.add(pid); }
            // the EI note-row hasFamily: resolveLevelMap lt 5 → LevelData
            const nlm = resolveLevelMap(cid);
            if (nlm.levelTypeData === 5 && nlm.levelData != null) noteAffFam.add(nlm.levelData);
            // ecSkillHitAffected filters by allowedEffectTypes
            if (allowedEffectTypes.includes(e.effectType)) {
                const rawSlot = (e.levelTypeData === 3) ? e.levelData : dcSkillScaled.get(cid);
                if (rawSlot != null) {
                    const owner = dcEffectOwnerCharId(cid) ?? b.charId;
                    if (owner != null) skillAff.add(owner + ':' + dcSkillSlotFor(rawSlot, null, dcAttackerRoleSlot(owner)));
                }
            }
        }
    }
    for (const dict of [ev.AttackerAttrDict, ev.DefenderAttrDict]) {
        if (!Array.isArray(dict)) continue;
        for (const e of dict) {
            const cid = e.configId ?? e.attrId;
            if (cid == null) continue;
            const pid = dcEffectPot.get(cid);
            if (pid != null) potAff.add(pid);
            const rawSlot = (e.levelTypeData === 3) ? e.levelData : dcSkillScaled.get(cid);
            if (rawSlot != null && b.charId != null) {
                skillAff.add(b.charId + ':' + dcSkillSlotFor(rawSlot, null, dcAttackerRoleSlot(b.charId)));
            }
        }
    }
    pre.potAff = potAff;
    pre.potAffFam = potAffFam;
    pre.noteAffFam = noteAffFam;
    pre.skillAff = skillAff;

    // ── inherited-snapshot index (the disable block's exact mirror): per
    // (side, list) the (attrId, B, P) groups with their occurrences in list
    // order, each tagged with its build-time disabled state. The machinery
    // builds these groups PER LIST, accumulates each group's sums over its
    // disabled occurrences in exactly this order, then applies
    // -(B*s_pct + s_base*(1+P-s_pct)) to stat.base. snapByKey maps a row's
    // toggle key to its groups in machinery application order (list order,
    // then group insertion), so the Effect Impact's snapshot rows recompute
    // the group delta for the toggled membership in closed form: one base op
    // (delta_new − delta_old) per touched group.
    // Also indexes EVERY effect row's resolved delta (the eiResolveEffectDelta
    // mirror) so the per-(effect, hit) delta lookup is O(1).
    // Per-build unit memos (shared across hits, keyed by the disabled-set
    // object): see the deltaIdx / collectEff notes below.
    let eUnits = _ecEntryUnits.get(extDisabled);
    if (!eUnits) { eUnits = new Map(); _ecEntryUnits.set(extDisabled, eUnits); }
    const snapByKey = new Map();    // rowKey → [groups]
    const deltaIdx = new Map();     // 'side:configId' / 'side:dict:...' → delta | null
    for (const blk of [
        { sideStr: 'attacker', sideNum: 0, lists: [ev.AttackerEffects?.effects, ev.AttackerRecord?.effects] },
        { sideStr: 'defender', sideNum: 1, lists: [ev.DefenderEffects?.effects] },
    ]) {
        // ── per-configId delta resolution (eiResolveEffectDelta's exact logic,
        // count/first across the concatenated lists) ──
        const counts = new Map(), firsts = new Map(), hitKeys = new Set();
        for (const list of blk.lists) {
            if (!list?.length) continue;
            for (const e of list) {
                if (e.configId == null) continue;
                counts.set(e.configId, (counts.get(e.configId) || 0) + 1);
                if (!firsts.has(e.configId)) firsts.set(e.configId, e);
                hitKeys.add(blk.sideStr + ':' + e.configId + ':' + (e.valueConfigId ?? ''));
            }
        }
        // Per-row-resolution unit memo: 152k dcGetLevelOverride calls per
        // engine build collapse to ~320 unique rows. The unit holds everything
        // count-independent; only `amount` (value × stacks) stays per-hit.
        let dUnits = _ecDeltaUnits.get(extDisabled);
        if (!dUnits) { dUnits = new Map(); _ecDeltaUnits.set(extDisabled, dUnits); }
        for (const [cid, count] of counts) {
            const first = firsts.get(cid);
            if (first.attrType == null || first.value == null) { deltaIdx.set(blk.sideStr + ':' + cid, null); continue; }
            // Level resolution mirrors dcApplyEffectOverrides' level block
            // (legacy resolve + the real dcGetLevelOverride) so sidebar level
            // moves on pot/skill/note-scaled rows land in the delta:
            // overridden → the override value replaces the logged
            // contribution in the baseline state.
            const uKey = dcLevelStateVersion + '|' + b.charId + ':' + cid + ':' + (first.valueConfigId ?? '')
                + ':' + (first.value ?? '') + ':' + (first.baseStatOnSnapshot ?? '')
                + ':' + (first.pctStatOnSnapshot ?? '') + ':' + (first.subType ?? '')
                + ':' + (first.effectType ?? '') + ':' + (first.isRecordEffect ?? '');
            let u = dUnits.get(uKey);
            if (u === undefined) {
                const erL = dcResolveLegacyEffectRow(first, b.charId, false) || first;
                const override = dcGetLevelOverride(erL, blk.sideStr, extDisabled, b.charId);
                const attrType = override?.newAttrType ?? erL.attrType;
                let subType = override?.newSubType ?? erL.subType;
                let snap = null;
                if (first.fromOwnerSnapshot && first.baseStatOnSnapshot != null) {
                    snap = { mode: first.subType === 1 ? 1 : 0,
                        B: first.baseStatOnSnapshot, P: first.pctStatOnSnapshot || 0, v: first.value };
                    subType = 1;
                }
                u = { attrType, subType, snap,
                    ovV: override ? override.newValue : null,
                    erVal: erL.value,
                    effType: first.effectType,
                    isRec: !!(erL.isRecordEffect ?? first.isRecordEffect) };
                dUnits.set(uKey, u);
            }
            // per-hit amount — identical arithmetic to the inline path
            let amount;
            if (u.snap) amount = u.snap.mode ? u.snap.v * (1 + u.snap.P) * count : u.snap.B * u.snap.v * count;
            else amount = u.ovV !== null ? u.ovV * count : u.erVal * count;
            deltaIdx.set(blk.sideStr + ':' + cid, { attrType: u.attrType, subType: u.subType, amount, stacks: count,
                effType: u.effType, isRec: u.isRec });
        }
        // ── inherited-snapshot aggregation (the disable block's first phase,
        // mirrored per list — the machinery builds its groups inside the
        // per-list loop) ──
        for (const list of blk.lists) {
            const groups = new Map();
            if (list?.length) {
                for (const e of list) {
                    if (!allowedEffectTypes.includes(e.effectType)) continue;
                    if (!e.fromOwnerSnapshot || e.baseStatOnSnapshot == null) continue;
                    const key = blk.sideStr + ':' + e.configId + ':' + (e.valueConfigId ?? '');
                    const attrId = e.attrType;
                    if (attrId == null || e.value == null) continue;
                    const B = e.baseStatOnSnapshot, P = e.pctStatOnSnapshot || 0;
                    // the machinery's group key: attrId : baseStatOnSnapshot : pctStatOnSnapshot ?? 0
                    const groupKey = attrId + ':' + B + ':' + (e.pctStatOnSnapshot ?? 0);
                    let g = groups.get(groupKey);
                    if (!g) { g = { side: blk.sideNum, attrId, B, P, occs: [] }; groups.set(groupKey, g); }
                    g.occs.push({ key, st: e.subType, v: e.value, dis: extDisabled.has(key) });
                    const arr = snapByKey.get(key);
                    if (arr) { if (arr[arr.length - 1] !== g) arr.push(g); }
                    else snapByKey.set(key, [g]);
                }
            }
        }
    }
    // ── attrDict delta resolution (eiResolveEffectDelta's dict branch) ──
    for (const blk of [
        { sideStr: 'attacker', dict: ev.AttackerAttrDict },
        { sideStr: 'defender', dict: ev.DefenderAttrDict },
    ]) {
        if (!Array.isArray(blk.dict)) continue;
        const seen = new Set();
        let duUnits = _ecDeltaUnits.get(extDisabled);
        if (!duUnits) { duUnits = new Map(); _ecDeltaUnits.set(extDisabled, duUnits); }
        for (const e of blk.dict) {
            const cid = e.configId ?? e.attrId;
            if (cid == null) continue;
            const key = blk.sideStr + ':dict:' + cid + ':' + (e.valueConfigId ?? '') + ':' + (e.slotNum ?? 0);
            if (seen.has(key)) continue;
            seen.add(key);
            if (e.attrType == null || e.subType == null || e.value == null) { deltaIdx.set(key, null); continue; }
            // Mirror the machinery's attrDict level block: dcGetLevelOverride
            // also consults the pot/skill/note level tables (a
            // dcEffectLevelOverrides-only lookup ignores sidebar level moves).
            const stacks = e.stacks || 1;
            const uKey = dcLevelStateVersion + '|' + b.charId + ':d:' + cid + ':' + (e.valueConfigId ?? '')
                + ':' + (e.slotNum ?? 0) + ':' + (e.value ?? '') + ':' + (e.attrType ?? '')
                + ':' + (e.subType ?? '') + ':' + (e.levelTypeData ?? '') + ':' + (e.levelData ?? '')
                + ':' + (e.levelSource ?? '') + ':' + stacks;
            let u = duUnits.get(uKey);
            if (u === undefined) {
                const override = dcGetLevelOverride(e, blk.sideStr, extDisabled, b.charId, true);
                u = { attrType: override?.newAttrType ?? e.attrType,
                    subType: override?.newSubType ?? e.subType,
                    ovV: override ? override.newValue : null, erVal: e.value };
                duUnits.set(uKey, u);
            }
            const amount = u.ovV !== null ? u.ovV * stacks : u.erVal * stacks;
            deltaIdx.set(key, { attrType: u.attrType, subType: u.subType, amount, stacks, isDict: true });
        }
    }
    pre.snapByKey = snapByKey;
    pre.deltaIdx = deltaIdx;

    // ── level-scaled entries + baseline override deltas ──
    // Mirrors dcApplyEffectOverrides' level-override block: branch order
    // skill (rawSlot) → note (levelTypeData 5 → unaffected by candidates) →
    // pot; eff rows filtered by allowedEffectTypes + snapshot + seen-by-
    // configId with count aggregation; dict rows seen by full key with
    // stacks; skip rows whose key is disabled (identical ops in every state).
    // Entries are collected in the block's application order (attacker eff,
    // attacker dict, attacker record, defender eff, defender dict) so the
    // candidate ops replay in the same sequence the machinery would.
    const attackerCharId = b.charId;
    const elem = hc.elementType;
    const lv = [];   // ALL level-scaled entries, in the machinery's op order
    const seenEff = new Set();
    const seenDict = new Set();
    const collectEff = (list, side) => {
        if (!list?.length) return;
        const countMap = new Map();
        for (const e of list) {
            if (!allowedEffectTypes.includes(e.effectType)) continue;
            if (e.fromOwnerSnapshot) continue;
            countMap.set(e.configId, (countMap.get(e.configId) || 0) + 1);
        }
        for (const e of list) {
            if (!allowedEffectTypes.includes(e.effectType)) continue;
            if (e.fromOwnerSnapshot) continue;
            if (seenEff.has(e.configId)) continue;
            seenEff.add(e.configId);
            const er = dcResolveLegacyEffectRow(e, attackerCharId, false) || e;
            const key = sideStr(side) + ':' + e.configId + ':' + (er.valueConfigId ?? '');
            const rowDis = extDisabled.has(key);
            const n = countMap.get(e.configId) || 1;
            // Entry unit memo: 115k ecMakeEntry calls per build collapse to
            // ~260 unique (row × count × elem) combos; entries and their
            // baseline ops are shared read-only across hits.
            const uKey = dcLevelStateVersion + '|' + attackerCharId + ':' + side + ':' + e.configId + ':'
                + (er.valueConfigId ?? '') + ':' + (e.slotNum ?? 0) + ':' + (e.levelTypeData ?? '')
                + ':' + (e.levelData ?? '') + ':' + (e.value ?? '') + ':' + (e.effectType ?? '')
                + ':' + (e.attrType ?? '') + ':' + (e.subType ?? '') + ':' + n + ':' + elem;
            let u = eUnits.get(uKey);
            if (u === undefined) {
                const entry = ecMakeEntry(e, er, side, false, n, attackerCharId, elem);
                if (!entry) u = null;
                else {
                    // baseline override value under extDisabled (the REAL
                    // function — bit-exact with what the baseline pass
                    // applied). Computed for disabled rows too: the override
                    // resolution depends on the level TABLE state
                    // (pot/skill/note keys), not the row's own disabled flag —
                    // the what-if engine needs it for re-enabled rows.
                    const baseOv = dcGetLevelOverride(er, side, extDisabled, attackerCharId, false);
                    entry.baseOvV = baseOv ? baseOv.newValue : null;
                    entry.rowDis = rowDis;
                    entry.disKey = key;
                    // the baseline state (= zero + level ops of ENABLED rows
                    // only — the machinery's level block skips disabled rows)
                    u = { entry, bops: (!rowDis && ecEntryOps(entry, entry.baseOvV)) || null };
                }
                eUnits.set(uKey, u);
            }
            if (!u) continue;
            if (!rowDis && u.bops) pre.baseOps.push(...u.bops);
            lv.push(u.entry);
        }
    };
    const collectDict = (dict, side) => {
        if (!Array.isArray(dict)) return;
        for (const e of dict) {
            if (e.attrType == null || e.subType == null || e.value == null) continue;
            const cid = e.configId ?? e.attrId;
            if (cid == null) continue;
            const key = sideStr(side) + ':dict:' + cid + ':' + (e.valueConfigId ?? '') + ':' + (e.slotNum ?? 0);
            if (seenDict.has(key)) continue;
            seenDict.add(key);
            const rowDis = extDisabled.has(key);
            const n = e.stacks != null ? e.stacks : 1;
            const uKey = dcLevelStateVersion + '|' + attackerCharId + ':d' + side + ':' + cid + ':'
                + (e.valueConfigId ?? '') + ':' + (e.slotNum ?? 0) + ':' + (e.levelTypeData ?? '')
                + ':' + (e.levelData ?? '') + ':' + (e.value ?? '') + ':' + (e.attrType ?? '')
                + ':' + (e.subType ?? '') + ':' + n + ':' + elem;
            let u = eUnits.get(uKey);
            if (u === undefined) {
                const entry = ecMakeEntry(e, e, side, true, n, attackerCharId, elem);
                if (!entry) u = null;
                else {
                    const baseOv = dcGetLevelOverride(e, side, extDisabled, attackerCharId, true);
                    entry.baseOvV = baseOv ? baseOv.newValue : null;
                    entry.rowDis = rowDis;
                    entry.disKey = key;
                    u = { entry, bops: (!rowDis && ecEntryOps(entry, entry.baseOvV)) || null };
                }
                eUnits.set(uKey, u);
            }
            if (!u) continue;
            if (!rowDis && u.bops) pre.baseOps.push(...u.bops);
            lv.push(u.entry);
        }
    };
    // dcApplyEffectOverrides' sides order: attacker(effects+dict), attacker
    // record, defender(effects+dict) — the level-override block replays the
    // same sequence.
    collectEff(ev.AttackerEffects?.effects, 0);
    collectDict(ev.AttackerAttrDict, 0);
    collectEff(ev.AttackerRecord?.effects, 0);
    collectEff(ev.DefenderEffects?.effects, 1);
    collectDict(ev.DefenderAttrDict, 1);
    pre.lv = lv;
    return pre;
}

// ── Factor bases from the baseline fields (fields computed by the caller on
//    disableOnly + baseOps) + references to the preanalysis results.
function ecBuildIntel(b, pre, ecDis, extDisabled) {
    const ev = b.ev;
    const hc = ev.HitConfig || {};
    const dp = ev.DamageParams || {};
    const bonuses = dcBonus;
    const bon = (k) => bonuses[k] || 0;
    const aStats = b.disOnly.aStats, dStats = b.disOnly.dStats;

    // Factor bases for one reference state. f = the raw calcHitFields values;
    // the component bases (pen0/res0/…, cr6_0/…) come from the same state's
    // stat arrays so phase-2 recomputations stay expression-identical.
    const factorSet = (fields, sa, sd) => ({
        f: {
            multiplier: fields.multiplier,
            baseAtk: fields.baseAtk, atkPct: fields.atkPct, atkAbs: fields.atkAbs,
            elemPct: fields.elemPct, elemTakenPct: fields.elemTakenPct,
            dmgTypePct: fields.dmgTypePct, dmgTypeTakenPct: fields.dmgTypeTakenPct,
            critRate: fields.critRate, critDmg: fields.critDmg,
            penF: calcPenRes(fields._aStats, fields._dStats, fields._el, bon('pen'), bon('res')),
            defF: (() => {
                const effDefBonus = bon('effectiveDef');
                const x = fields.effectiveDef + effDefBonus;
                const live = effDefBonus !== 0
                    ? 1 - (x * 40) / (x * 32 + 24000)
                    : fields.defAmend;
                return live + bon('defAmend');
            })(),
            envAmend: fields.envAmend,
            genDmg: fields.genDmg, intensity: fields.intensity, finalDmg: fields.finalDmg,
            genDmgRcd: fields.genDmgRcd, tough: fields.toughnessBroken,
            skillInt: fields.skillIntensity,
        },
        comp: {
            pen0: fields.pen + bon('pen'), res0: fields.res + bon('res'),
            ign0: statValue(sa, ELEM_IGN_STAT[fields._el]),
            vul0: statValue(sa, 55),
            defRaw0: fields._defRaw, defIg0: fields._defIgnore, defPen0: fields._defPenetrate,
            cr6_0: statValue(sa, 6),
            crX_0: critRateExtraIdx(hc.damageType) != null ? statValue(sa, critRateExtraIdx(hc.damageType)) : 0,
            cd8_0: statValue(sa, 8),
            cdX_0: critDmgExtraIdx(hc.damageType) != null ? statValue(sa, critDmgExtraIdx(hc.damageType)) : 0,
        },
    });

    // ── zero state (disable-only) — the LEVEL-affix evals' reference ──
    const fieldsZero = calcHitFields(ev, b.disOnly, extDisabled, dcEffectLevelOverrides);
    const zeroDmg = calcDamage(fieldsZero, dcBonus, ecDis);
    const zeroSet = factorSet(fieldsZero, aStats, dStats);

    const intel = {
        aStats, dStats,
        dis: ecDis,
        el: fieldsZero._el, dt: hc.damageType,
        expected: ecDis.has('critRate'),
        isCrit: !!dp.isCrit,
        disBA: ecDis.has('baseAtk'), disAP: ecDis.has('atkPct'),
        f: zeroSet.f,
        fb: {
            baseAtk: bon('baseAtk'), atkPct: bon('atkPct'), atkMulti: bon('atkMulti'),
            elemPct: bon('elemPct'), elemTakenPct: bon('elemTakenPct'),
            dmgTypePct: bon('dmgTypePct'), dmgTypeTakenPct: bon('dmgTypeTakenPct'),
            critRate: bon('critRate'), critDmg: bon('critDmg'),
            pen: bon('pen'), res: bon('res'), effDef: bon('effectiveDef'), defAmend: bon('defAmend'),
            multiplier: bon('multiplier'), envAmend: bon('envAmend'),
            genDmg: bon('genDmg'), intensity: bon('intensity'), finalDmg: bon('finalDmg'),
            genDmgRcd: bon('genDmgRcd'), tough: bon('toughnessBroken'), skillInt: bon('skillIntensity'),
        },
        ...zeroSet.comp,
        readers: ecReadersFor(fieldsZero._el, hc.damageType, ecDis.has('critRate')),
        zeroDmg,
        baseDmg: zeroDmg,   // overwritten below when baseline level-override ops exist
        // hit's own level scaling (multiplier re-pick source)
        loggedL: pre.loggedL,
        logRaw: pre.logRaw,
        potPerk: pre.potPerk,
        skillPerk: pre.skillPerk,
        hm: (dp.skillLevel != null) ? resolveHitLevelMap(hc.hitDamageId) : null,
        potAff: pre.potAff,
        potAffFam: pre.potAffFam,
        noteAffFam: pre.noteAffFam,
        potGroup: pre.potGroup,
        zeroed: pre.zeroed,
        skillAff: pre.skillAff,
        lv: pre.lv,
        snapByKey: pre.snapByKey,
        deltaIdx: pre.deltaIdx,
    };

    // ── baseline state = zero + the baseline level-override ops. Its damage
    // anchors the gains; its factor set backs the STAT-row patches (they
    // apply on top of withOverrides, exactly like the naive patch path).
    if (pre.baseOps.length) {
        const baseState = ecApplyOps(b.disOnly, pre.baseOps);
        const fieldsBase = calcHitFields(ev, baseState, extDisabled, dcEffectLevelOverrides);
        const baseDmg = calcDamage(fieldsBase, dcBonus, ecDis);
        const baseSet = factorSet(fieldsBase, baseState.aStats, baseState.dStats);
        b.fields = fieldsBase;
        b.dmg = baseDmg;
        intel.baseDmg = baseDmg;
        b.statIntel = Object.assign({}, intel, {
            aStats: baseState.aStats, dStats: baseState.dStats,
            f: baseSet.f, ...baseSet.comp,
            refDmg: baseDmg,   // the state the level-net-ops replay relative to
        });
        intel.refDmg = zeroDmg;   // the intel's own reference = the zero state
    } else {
        b.fields = fieldsZero;
        b.dmg = zeroDmg;
        b.statIntel = intel;   // baseline state == zero state
        intel.refDmg = zeroDmg;
    }
    return intel;
}

// Classify one level-scaled entry (dcGetLevelOverride's branch order) and
// capture everything the closed-form evaluation needs. Returns null for
// entries no candidate can move (note-scaled) or that carry no override.
function ecMakeEntry(e, er, side, isAttr, n, attackerCharId, elem) {
    const rawSlot = (e.levelTypeData === 3) ? e.levelData : dcSkillScaled.get(e.configId);
    const entry = {
        side, isAttr, n, elem,   // side numeric: 0 = attacker, 1 = defender
        rMeta: isAttr ? Object.assign({}, e, { bySubType: true }) : er,
        remVal: isAttr ? e.value : er.value,
        configId: er.configId,
        valueConfigId: er.valueConfigId,
        slotNum: e.slotNum ?? 0,
    };
    if (rawSlot != null) {
        // ── skill-scaled (dcGetLevelOverride skill branch) ──
        const cid = isAttr ? (attackerCharId ?? e._charId)
            : (dcEffectOwnerCharId(er.configId) ?? attackerCharId ?? e._charId);
        if (cid == null || er.valueConfigId == null || er.valueConfigId <= er.configId) return null;
        const skillSlot = dcEffectSkillSlot(er.configId, rawSlot, cid);
        const curL = Math.round((er.valueConfigId - er.configId) / 10);
        const st = dcEnsureSkillLevel(cid, skillSlot, curL);
        if (!st) return null;
        entry.kind = 'skill';
        entry.cand = cid + ':' + skillSlot;
        entry.groupKey = cid + ':' + skillSlot;
        entry.st = st;
        entry.curL = curL;
    } else {
        const lm = resolveLevelMap(e.configId);
        if (lm.levelTypeData === 5 && lm.levelData != null) {
            // ── note-scaled: no candidate moves note levels, but the entry's
            // baseline override (user-disabled disc-note rows) still
            // participates in every state → build with kind 'note'.
            const curL = (e.valueConfigId != null && e.valueConfigId > e.configId)
                ? Math.round((e.valueConfigId - e.configId) / 10) : 0;
            const st = dcEnsureNoteLevel(lm.levelData, curL);
            if (!st) return null;
            entry.kind = 'note';
            entry.cand = lm.levelData;   // the note id (Effect.json LevelData) — the row the note rows toggle
            entry.noteId = lm.levelData;
            entry.curL = curL;
            entry.configId = e.configId;
            if (!isAttr) {
                entry.remVal = er.value;
                entry.rMeta = er;
            }
            return ecFinishEntry(entry, e, er, isAttr);
        }
        const potId = e.levelSource != null ? e.levelSource : dcEffectPot.get(e.configId);
        if (potId == null) return null;
        const lo = e.configId - (e.configId % 1000);
        if (e.valueConfigId == null || e.valueConfigId <= lo) return null;
        const rel = e.valueConfigId - lo;
        const st = dcEnsurePotLevel(potId, Math.floor((rel % 100) / 10), e._charId);
        if (!st) return null;
        entry.kind = 'pot';
        entry.cand = potId;
        entry.potId = potId;
        entry.st = st;
        entry.curL = Math.floor((rel % 100) / 10);
        entry.lo = lo;
        entry.P = Math.floor(rel / 100);
        entry.V = rel % 10;
    }
    return ecFinishEntry(entry, e, er, isAttr);
}

// Slot metadata shared by every entry kind: the logged contribution's slot
// (remove op) and the override's slot (add op) — both resolved exactly like
// dcApplyEffectValue would from the metadata the level-override block passes.
function ecFinishEntry(entry, e, er, isAttr) {
    if (isAttr) {
        entry.baseAttr = e.attrType; entry.baseKind = (e.subType === 2) ? 2 : (e.subType === 3) ? 3 : 1;
        const stCur = ecReadValSlot(entry.valueConfigId, entry, true);
        entry.slotAttr = stCur ? (stCur.attrType != null ? stCur.attrType : e.attrType) : e.attrType;
        entry.slotSub = stCur ? (stCur.subType != null ? stCur.subType : e.subType) : e.subType;
        entry.aMeta = { attrType: entry.slotAttr, subType: entry.slotSub, effectType: e.effectType, bySubType: true };
    } else {
        entry.baseAttr = er.attrType; entry.baseKind = null;   // via ecOpSlot(er)
        const stCur = effectValueTable.get(er.valueConfigId);
        const addAttr = (stCur && stCur.attrType != null) ? stCur.attrType : er.attrType;
        const addSub = (stCur && stCur.subType != null) ? stCur.subType : er.subType;
        entry.aMeta = { attrType: addAttr, subType: addSub, effectType: er.effectType, isRecord: er.isRecordEffect };
    }
    return entry;
}

// onceAttrValueTable row for a dict entry's value id (slotNum-resolved).
function ecReadValSlot(vcId, entry, isAttr) {
    const slots = onceAttrValueTable.get(vcId) || [];
    return slots.find(s => (s.slotNum ?? 1) === (entry.slotNum ?? 0)) ?? slots[0] ?? null;
}

// ─── Closed-form damage evaluation ───────────────────────────────────────────
// dlist: ordered [side(0=a/1=d), attr, kind(0=origin/1=base/2=pct/3=abs), amt].
// multRaw: when the candidate re-picks the hit's own level multiplier, the RAW
// multiplier (bonus added here); null = keep the baseline multiplier.
// Applies the stat deltas to the disable-only quadruples in order (bit-exact
// with the override machinery's sequential mutation), then replays
// calcDamage's product in DC_FORMULA_KEYS order and floors at the end.
function ecAnalyticDamage(an, dlist, multRaw) {
    const f = an.f, fb = an.fb, dis = an.dis;
    // zero applied multiplier factor → v = 0 for any patch (all factors
    // finite, floor(0) = 0); the baseline damage is 0 in that state too.
    if (!dis.has('multiplier')) {
        const multF = (multRaw != null ? multRaw : f.multiplier) + fb.multiplier;
        if (multF === 0) return 0;
    }

    // ── phase 1: apply the ops to the stat quadruples (sequential, in order) ──
    let acc = null;
    for (let i = 0; i < dlist.length; i++) {
        const side = dlist[i][0], attr = dlist[i][1], kind = dlist[i][2], amt = dlist[i][3];
        const key = side * 128 + attr;
        if (!acc) acc = new Map();
        let st = acc.get(key);
        if (!st) {
            const s = (side === 0 ? an.aStats : an.dStats)[attr];
            st = [s ? (s.origin || 0) : 0, s ? (s.base || 0) : 0, s ? (s.pct || 0) : 0, s ? (s.abs || 0) : 0];
            acc.set(key, st);
        }
        st[kind] += amt;
    }

    // ── phase 2: recompute the factors the touched attrs feed ──
    let baseAtk = f.baseAtk, atkPct = f.atkPct, atkAbs = f.atkAbs;
    let elemPct = f.elemPct, elemTakenPct = f.elemTakenPct;
    let dmgTypePct = f.dmgTypePct, dmgTypeTakenPct = f.dmgTypeTakenPct;
    let critRate = f.critRate, critDmg = f.critDmg;
    let pen = an.pen0, res = an.res0, ign = an.ign0, vul = an.vul0;
    let defRaw = an.defRaw0, defIg = an.defIg0, defPen = an.defPen0;
    let genDmg = f.genDmg, intensity = f.intensity, finalDmg = f.finalDmg;
    let genDmgRcd = f.genDmgRcd, tough = f.tough, skillInt = f.skillInt;
    let penTouched = false, defTouched = false;
    const svOf = (side, attr) => {
        const st = acc ? acc.get(side * 128 + attr) : null;
        if (st) return ecSvQuad(st[0], st[1], st[2], st[3]);
        return ecSvQuad((side === 0 ? an.aStats : an.dStats)[attr]?.origin,
            (side === 0 ? an.aStats : an.dStats)[attr]?.base,
            (side === 0 ? an.aStats : an.dStats)[attr]?.pct,
            (side === 0 ? an.aStats : an.dStats)[attr]?.abs);
    };
    const sbOf = (side, attr) => {
        const st = acc ? acc.get(side * 128 + attr) : null;
        if (st) return ecSbQuad(st[0], st[1]);
        const s = (side === 0 ? an.aStats : an.dStats)[attr];
        return ecSbQuad(s?.origin, s?.base);
    };
    if (acc) {
        for (const key of acc.keys()) {
            const rl = an.readers.get(key);
            if (!rl) continue;
            for (const op of rl) {
                switch (op) {
                    case EC_OP_BASE_ATK: baseAtk = sbOf(0, 1); break;
                    case EC_OP_ATK_PCT: atkPct = 1 + (acc.get(1)[2] || 0); break;
                    case EC_OP_ATK_ABS: atkAbs = acc.get(1)[3] || 0; break;
                    case EC_OP_ELEM_PCT: elemPct = svOf(0, ELEM_ATK_STAT[an.el]); break;
                    case EC_OP_ELEM_TAKEN: elemTakenPct = svOf(1, ELEM_DEF_STAT[an.el]); break;
                    case EC_OP_DT_PCT: dmgTypePct = svOf(0, dmgTypeAtkStat(an.dt)); break;
                    case EC_OP_DT_TAKEN: dmgTypeTakenPct = svOf(1, dmgTypeDefStat(an.dt)); break;
                    case EC_OP_CRIT_RATE: critRate = svOf(0, 6) + svOf(0, critRateExtraIdx(an.dt)); break;
                    case EC_OP_CRIT_DMG: critDmg = svOf(0, 8) + svOf(0, critDmgExtraIdx(an.dt)); break;
                    case EC_OP_PEN: pen = svOf(0, ELEM_PEN_STAT[an.el]) + fb.pen; penTouched = true; break;
                    case EC_OP_RES: res = svOf(1, ELEM_RES_STAT[an.el]) + fb.res; penTouched = true; break;
                    case EC_OP_IGN: ign = svOf(0, ELEM_IGN_STAT[an.el]); penTouched = true; break;
                    case EC_OP_VUL: vul = svOf(0, 55); penTouched = true; break;
                    case EC_OP_DEF_RAW: defRaw = sbOf(1, 2); defTouched = true; break;
                    case EC_OP_DEF_IGN: defIg = sbOf(0, 10); defTouched = true; break;
                    case EC_OP_DEF_PEN: defPen = svOf(0, 9); defTouched = true; break;
                    case EC_OP_GEN_DMG: genDmg = svOf(0, 49); break;
                    case EC_OP_INTENSITY: intensity = svOf(0, 48); break;
                    case EC_OP_FINAL_DMG: finalDmg = svOf(0, 51); break;
                    case EC_OP_GEN_DMG_RCD: genDmgRcd = svOf(1, 53); break;
                    case EC_OP_TOUGH: tough = svOf(1, 86); break;
                    case EC_OP_SKILL_INT: skillInt = svOf(0, 85) + 1; break;   // fields.skillIntensity carries the +1
                }
            }
        }
    }
    // ── phase 3: calcDamage's product, DC_FORMULA_KEYS order ──
    let v = 1;
    if (!dis.has('multiplier')) v *= (multRaw != null ? multRaw : f.multiplier) + fb.multiplier;
    if (!dis.has('atkMulti')) {
        if (an.disBA && an.disAP) {
            v *= 1 + fb.atkMulti;
        } else {
            const bv = an.disBA ? 1 : (baseAtk + fb.baseAtk);
            const pv = an.disAP ? 1 : (atkPct + fb.atkPct);
            v *= (bv * pv + atkAbs) + fb.atkMulti;
        }
    }
    if (!dis.has('elemPct')) v *= elemPct + fb.elemPct;
    if (!dis.has('elemTakenPct')) v *= elemTakenPct + fb.elemTakenPct;
    if (!dis.has('dmgTypePct')) v *= dmgTypePct + fb.dmgTypePct;
    if (!dis.has('dmgTypeTakenPct')) v *= dmgTypeTakenPct + fb.dmgTypeTakenPct;
    if (!dis.has('critDmg')) {
        if (an.expected) {
            v *= 1 + (critRate + fb.critRate) * ((critDmg + fb.critDmg) - 1);
        } else if (an.isCrit) {
            v *= (critDmg + fb.critDmg);
        }
    }
    if (!dis.has('penRes')) {
        if (penTouched) {
            const effectiveRes = res * (1 - ign) - pen;
            v *= ecPenFactorOf(effectiveRes, vul);
        } else {
            v *= f.penF;
        }
    }
    if (!dis.has('defAmend')) {
        if (defTouched) {
            const effDef = defRaw * (1 - defIg) - defPen;
            const x = effDef + fb.effDef;
            v *= (1 - (x * 40) / (x * 32 + 24000)) + fb.defAmend;
        } else {
            v *= f.defF;
        }
    }
    if (!dis.has('envAmend')) v *= (f.envAmend + fb.envAmend);
    if (!dis.has('genDmg')) v *= genDmg + fb.genDmg;
    if (!dis.has('intensity')) v *= intensity + fb.intensity;
    if (!dis.has('finalDmg')) v *= finalDmg + fb.finalDmg;
    if (!dis.has('genDmgRcd')) v *= genDmgRcd + fb.genDmgRcd;
    if (!dis.has('toughnessBroken')) v *= tough + fb.tough;
    if (!dis.has('skillIntensity')) v *= skillInt + fb.skillInt;
    return Math.floor(v);
}

// calcDamage with this tab's expected-crit mode layered on the global
// field-disable state.
function ecCalcDisabled() {
    if (!ecExpectedCrit || dcDisabled.has('critRate')) return dcDisabled;
    const s = new Set(dcDisabled);
    s.add('critRate');
    return s;
}

// Can a patch to attacker attr `attrType` change this hit's damage at all?
// Elemental/per-type stats only feed the field matching the hit's element /
// damage type (ELEM_ATK_STAT / ELEM_PEN_STAT / dmgTypeAtkStat lookups);
// crit rate fields are display-only unless the whole comparison runs in
// expected-crit mode; Def / Max Hp never enter the damage formula.
function ecAttrHitAffected(attrType, b, evEV) {
    if (b.dead) return false;
    const ev = b.ev;
    const hc = ev.HitConfig || {};
    const el = hc.elementType, dt = hc.damageType;
    if (attrType === 1) return true;                              // Atk → baseAtk / atkPct
    if (attrType === 2 || attrType === 3) return false;           // Def / Max Hp
    if (attrType >= 17 && attrType <= 22) return ELEM_ATK_STAT[el] === attrType;
    if (attrType >= 23 && attrType <= 28) return ELEM_PEN_STAT[el] === attrType;
    if ((attrType >= 56 && attrType <= 59) || attrType === 64 || attrType === 66)
        return dmgTypeAtkStat(dt) === attrType;
    if (attrType === 6) return evEV;
    if (attrType >= 70 && attrType <= 76) return evEV && critRateExtraIdx(dt) === attrType;
    if (attrType === 8) return evEV ? true : !!ev.DamageParams?.isCrit;
    if (attrType >= 77 && attrType <= 83) {
        if (critDmgExtraIdx(dt) !== attrType) return false;
        return evEV ? true : !!ev.DamageParams?.isCrit;
    }
    return true;   // unknown attr — compute anyway (safe default)
}

// Damage of one hit under the blank baseline, with an optional patched stat.
// (Naive path — the grouped fast path in ecComputeAll does the same per
// (attrType, subType) with one stat clone; the test cross-checks both.)
function ecHitDamage(b, extDisabled, patchRow, patchAmount) {
    let overrides = b.withOverrides;
    if (patchRow) {
        overrides = eiPatchStats(b.withOverrides, patchRow, b.ev,
            { attrType: patchRow.attrType, subType: patchRow.subType, amount: patchAmount, stacks: 1 }, 1);
    }
    const fields = calcHitFields(b.ev, overrides, extDisabled, dcEffectLevelOverrides);
    return calcDamage(fields, dcBonus, ecCalcDisabled());
}

// One character's table: the blank baseline over that char's hits, plus every
// candidate line patched onto (or levelled into) that character alone.
// Every row is computed TWICE and both result sets are saved on the row:
//   gains/bases      — personal domain (this char's hits only)
//   teamGains/teamBases — team domain (ALL deployed team chars' hits); level
//     affixes (potentials/skills) scale effects that also ride on teammates'
//     hits, so their team gains differ from the personal ones. Stat lines are
//     attacker-side only → same gains, bases shifted to the team baseline.
// One character's table: the blank baseline over that char's hits, plus every
// candidate line patched onto (or levelled into) that character alone.
// Every row saves BOTH result sets:
//   gains/bases      — personal domain (this char's hits only)
//   teamGains/teamBases — team domain (ALL deployed team chars' hits)
// All evaluation runs through the analytic engine (ecAnalyticDamage): a
// candidate's ops are replayed onto the hit's disable-only stat state in the
// override machinery's exact order, so the damage is bit-identical with the
// patch path (ecHitDamage, kept as the naive reference for the regression
// test); Math.floor stays at the end of the product, as in calcDamage.
function ecComputeCharTable(charId, c) {
    const { teamBaseline, teamBaseTotal, candidates, extDisabled } = c;
    const prof = c.pf;
    let t = performance.now();

    const baseline = [];
    let baseTotal = 0;
    for (const b of teamBaseline) {
        if (b.charId === charId) { baseline.push(b); baseTotal += b.dmg; }
    }

    const rows = [];

    // ── Stat rows ──────────────────────────────────────────────────────────
    // Rows are grouped by (attrType, subType); each row is measured
    // cumulatively from the blank baseline (copy k = value × k). The grouped
    // affected-set logic is unchanged; only the per-copy evaluation is now
    // closed-form (no stat clone / calcHitFields / calcDamage).
    const statGroups = new Map();
    for (const row of candidates.attrRows) {
        const copies = row.tiers.length;
        if (row.kind === 'charge' || row.attrType == null) {
            // Charge efficiency is not modeled by the damage calc.
            rows.push({ ...row, copies, gains: row.tiers.map(() => null), bases: row.tiers.map(() => 0) });
            continue;
        }
        if (row.attrType === 2 || row.attrType === 3) {
            // Def / Max Hp never enter the damage formula — gain 0 by definition.
            rows.push({ ...row, copies, gains: row.tiers.map(() => 0), bases: row.tiers.map(() => 1) });
            continue;
        }
        const key = `${row.attrType}:${row.subType}`;
        let g = statGroups.get(key);
        if (!g) { g = { attrType: row.attrType, subType: row.subType, rows: [] }; statGroups.set(key, g); }
        g.rows.push(row);
    }
    for (const g of statGroups.values()) {
        g.affected = [];
        let affectedBase = 0;
        for (let j = 0; j < baseline.length; j++) {
            if (ecAttrHitAffected(g.attrType, baseline[j], true)) { g.affected.push(j); affectedBase += baseline[j].dmg; }
        }
        g.affectedBase = affectedBase;
        for (const item of g.rows) {
            item._bases = new Array(item.tiers.length).fill(0);
            item._gains = new Array(item.tiers.length).fill(0);
        }
    }
    for (const g of statGroups.values()) {
        const kind = g.subType === 1 ? 0 : g.subType === 2 ? 2 : 3;   // origin / pct / abs
        for (const j of g.affected) {
            const b = baseline[j];
            const an = b.statIntel;   // stat patches apply on the full baseline state (withOverrides)
            for (const item of g.rows) {
                let prevDmg = b.dmg;   // row's cumulative starts at the blank baseline
                const dlist = [[0, g.attrType, kind, 0]];
                for (let k = 1; k <= item.tiers.length; k++) {
                    item._bases[k - 1] += prevDmg;   // affected-hit part of the total before copy k
                    dlist[0][3] = item.value * k;
                    const dmg = ecAnalyticDamage(an, dlist, null);
                    item._gains[k - 1] += dmg - prevDmg;
                    prevDmg = dmg;
                }
            }
        }
        // Shift the affected-hit totals by the unaffected part of the domain
        // (baseTotal − affectedBase) so bases[k] is the full domain total.
        const off = baseTotal - g.affectedBase;
        for (const item of g.rows)
            for (let k = 0; k < item._bases.length; k++) item._bases[k] += off;
        for (const item of g.rows) {
            // Team scope: stat lines patch the char's own hits only, so the
            // team gains equal the personal ones — only the bases shift to
            // the whole team's blank baseline.
            const teamOff = teamBaseTotal - baseTotal;
            rows.push({
                ...item, copies: item.tiers.length,
                gains: item._gains, bases: item._bases,
                teamGains: item._gains,
                teamBases: item._bases.map(bv => bv + teamOff),
            });
            delete item._gains;
            delete item._bases;
        }
    }
    if (prof) t = prof('stat rows', t);

    // ── Skill-levelup rows: the emblem affix's full level bonus at once ────
    // The row IS the record's own emblem affix roll for that slot (e.g. +2 lv
    // Main Skill): one gain column (×1) = nothing → full bonus.
    for (const row of candidates.skillRows) {
        if (row.charId !== charId) continue;
        const st = dcSkillLevels.get(`${row.charId}:${row.actionSlot}`);
        if (!st) continue;
        const groupKey = `${row.charId}:${row.actionSlot}`;
        let gains = null, bases = null, teamGains = null, teamBases = null;
        // Hypothetical full roll: +3 lv on EVERY skill slot (not just the ones
        // the record has an affix equipped for) — blank vs blank+3lv.
        const fullBonus = 3;
        // Effective levels: base = the real table state under extDisabled;
        // candidate = the same +3 synthetic row ([ecKey, 3] push).
        const Lb = dcSkillEffectiveLevel(st, extDisabled);
        const Lc = ecSkillLcand(st);
        if (Lb !== Lc) {
            // ── personal domain (this char's hits only) ──
            let affSum = 0, affectedBase = 0, any = false;
            for (const b of baseline) {
                if (!b.intel || !b.intel.skillAff.has(groupKey)) continue;
                any = true;
                affectedBase += b.dmg;
                affSum += ecLevelNetDamage(b.intel, 'skill', groupKey, Lc);
            }
            if (any) { bases = [baseTotal]; gains = [affSum - affectedBase]; }
            // ── team domain — the affix also scales effects that ride on
            // TEAMMATES' hits (owner p:<charId> on their hit) ──
            let affSumT = 0, affectedBaseT = 0, anyT = false;
            for (const b of teamBaseline) {
                if (!b.intel || !b.intel.skillAff.has(groupKey)) continue;
                anyT = true;
                affectedBaseT += b.dmg;
                affSumT += ecLevelNetDamage(b.intel, 'skill', groupKey, Lc);
            }
            if (anyT) { teamBases = [teamBaseTotal]; teamGains = [affSumT - affectedBaseT]; }
        } else {
            // Level cap reached — the +3 moves nothing; the row stays visible
            // with a 0 gain when any hit is affected (the patch path would
            // recompute identical damage).
            if (baseline.some(b => b.intel && b.intel.skillAff.has(groupKey))) { bases = [baseTotal]; gains = [0]; }
            if (teamBaseline.some(b => b.intel && b.intel.skillAff.has(groupKey))) { teamBases = [teamBaseTotal]; teamGains = [0]; }
        }
        rows.push({ ...row, copies: 1, gains, bases, teamGains, teamBases, valueStr: `+${fullBonus} lv` });
    }
    if (prof) t = prof('skill rows', t);

    // ── Potential affix rows: every potential the char owns, at +3 lv ──
    for (const row of candidates.potRows) {
        if (row.charId !== charId) continue;
        const st = dcPotLevels.get(row.potId);
        if (!st) continue;
        let gains = null, bases = null, teamGains = null, teamBases = null;
        // Hypothetical full roll: +3 lv on EVERY owned potential.
        const fullBonus = 3;
        const Lb = dcPotEffectiveLevel(st, extDisabled);
        const Lc = ecPotLcand(st);
        if (Lb !== Lc) {
            // ── personal domain (this char's hits only) ──
            let affSum = 0, affectedBase = 0, any = false;
            for (const b of baseline) {
                if (!b.intel || !b.intel.potAff.has(row.potId)) continue;
                any = true;
                affectedBase += b.dmg;
                affSum += ecLevelNetDamage(b.intel, 'pot', row.potId, Lc);
            }
            if (any) { bases = [baseTotal]; gains = [affSum - affectedBase]; }
            // ── team domain — the potential's effects also ride on
            // TEAMMATES' hits (owner p:<charId> on their hit) ──
            let affSumT = 0, affectedBaseT = 0, anyT = false;
            for (const b of teamBaseline) {
                if (!b.intel || !b.intel.potAff.has(row.potId)) continue;
                anyT = true;
                affectedBaseT += b.dmg;
                affSumT += ecLevelNetDamage(b.intel, 'pot', row.potId, Lc);
            }
            if (anyT) { teamBases = [teamBaseTotal]; teamGains = [affSumT - affectedBaseT]; }
        } else {
            if (baseline.some(b => b.intel && b.intel.potAff.has(row.potId))) { bases = [baseTotal]; gains = [0]; }
            if (teamBaseline.some(b => b.intel && b.intel.potAff.has(row.potId))) { teamBases = [teamBaseTotal]; teamGains = [0]; }
        }
        rows.push({ ...row, copies: 1, gains, bases, teamGains, teamBases, valueStr: `+${fullBonus} lv` });
    }
    if (prof) prof('pot rows', t);

    return { charId, hitCount: baseline.length, baseTotal, rows };
}

// One hit's damage under a level-affix candidate (pot or skill). The
// candidate state relative to the disable-only state replays EVERY
// level-scaled entry's ops in the machinery's order: candidate-level ops for
// entries the candidate moves, baseline ops for every other one (their table
// state is unchanged → same override value as the baseline). If no relevant
// entry's override value changes and the hit's own multiplier doesn't
// re-pick, the state is identical to the baseline → return the baseline
// damage unchanged.
// One hit's damage when one level-affix source moves from its reference level
// (every entry's baseOvV) to level `Lc`. Shared by the Emblems Comparison
// (candidate +3 levels vs the blank-baseline reference) and Effect Impact
// (emblem pot/skill/note rows toggled vs the current-state reference): both
// pass an intel VIEW whose f/comp bases and aStats/dStats describe the
// reference state, whose baseDmg is that state's damage and whose refDmg is
// the damage of the state the ops replay relative to.
function ecLevelNetDamage(an, kind, key, Lc) {
    const dmg = ecLevelMovesNetDamage(an, new Map([[kind + ':' + key, Lc]]));
    return dmg !== null ? dmg : an.baseDmg;
}

// Generalization of the single-source eval above: evaluate the hit under a
// SET of level-source moves at once (the Dmg Calc's pots quick toggles move
// every non-cap potential). `changes` maps '<kind>:<cand>' → candidate level
// (e.g. 'pot:513332' → 6, 'skill:160:5' → 9, 'note:12345' → 4); entries not
// in the map replay their baseline override ops. Returns null when no entry's
// value and no hit-scaling multiplier changes (state identical to the
// baseline — the caller keeps its cached damage).
function ecLevelMovesNetDamage(an, changes) {
    const dlist = [];
    let changed = false;
    for (const entry of an.lv) {
        // Disabled rows contribute no level ops in the intel's baseline state
        // (they were absent from lv before the what-if engine needed them;
        // replaying their ops would corrupt the EI/EC evals)
        if (entry.rowDis) continue;
        const Lc = changes.get(entry.kind + ':' + entry.cand);
        const relevant = Lc !== undefined;
        const ovV = relevant ? ecEntryOvValue(entry, Lc) : entry.baseOvV;
        if (relevant && ovV !== entry.baseOvV) changed = true;
        const ops = ecEntryOps(entry, ovV);
        if (ops) for (const op of ops) dlist.push(op);
    }
    let multRaw = null;
    if (an.skillPerk != null && changes.has('skill:' + an.skillPerk)) {
        multRaw = ecMultiplierFor(an, changes.get('skill:' + an.skillPerk));   // null = unchanged
        if (multRaw != null) changed = true;
    } else if (an.potPerk != null && changes.has('pot:' + an.potPerk)) {
        multRaw = ecMultiplierFor(an, changes.get('pot:' + an.potPerk));
        if (multRaw != null) changed = true;
    }
    if (!changed) return null;
    if (!dlist.length && multRaw == null) return an.refDmg;   // state = the reference exactly
    return ecAnalyticDamage(an, dlist, multRaw);
}

// The raw multiplier calcHitFields would pick at effective level Lcand for
// this hit (mirrors the rescale block: candidate == logged → keep logged;
// ≤0 → 0; else re-pick from the hit's per-level array). Returns null when it
// equals the baseline multiplier (no change).
function ecMultiplierFor(an, Lcand) {
    if (Lcand == null) return null;
    let mult;
    const loggedL = an.loggedL;
    if (loggedL == null || Lcand === loggedL) {
        mult = an.logRaw;
    } else if (Lcand <= 0) {
        mult = 0;
    } else {
        const hm = an.hm;
        if (hm && hm.sp && hm.sp.length) {
            const idx = Math.min(Math.max(Lcand - 1, 0), hm.sp.length - 1);
            const nv = hm.sp[idx];
            mult = nv != null ? nv / 10000 / 100 : an.logRaw;
        } else {
            mult = an.logRaw;
        }
    }
    return (mult === an.f.multiplier) ? null : mult;
}

// ─── Dmg Calc what-if engine ──────────────────────────────────────────────
// The Dmg Calc's sidebar what-ifs (char deltas, quick toggles) re-simulate a
// full stat state per hit per toggle. This engine shares the Emblems
// Comparison's per-hit preanalysis: one intel per hit per state version,
// built under the LIVE sim state (dcEffectsDisabled / dcBonus / dcDisabled),
// then every hypothetical is evaluated in closed form instead of a full
// stat re-sim per hit.
//
// The intel's aStats/dStats describe the ZERO state (disable-block only, no
// level-override ops — b.disOnly), so a what-if state is reached by applying
// its DIFF against that state:
//   - level moves replay ALL entries' ops (candidate values for moved
//     sources, baseline baseOvV for the rest) — ecLevelMovesNetDamage;
//   - row enable/disable diffs compose from the per-hit deltaIdx amounts and
//     the snapshot group closed-forms — ecWhatIfRowOps.
// The two never mix in practice (toggles move rows OR tables), and unchanged
// hits reuse the per-hit damage cache (dcCachedHitCalc) — the caller's
// contract: null return = state identical to the baseline.
// Preanalysis unit memos, keyed by the disabled-set object (WeakMap):
// transient what-if sets drop their entries with the Set; persistent sets
// (setMinusPot / dcEffectsDisabled) accumulate per dcLevelStateVersion key —
// stale keys are never hit, just dead weight. _ecEntryUnits: level-scaled
// entries + their baseline ops; _ecDeltaUnits: resolved per-row deltas.
const _ecEntryUnits = new WeakMap();
const _ecDeltaUnits = new WeakMap();

// Shared per-hit engine baseline: built once per (state version, filtered
// hits, disabled set), consumed by BOTH the Effect Impact tab (eiGetBaseline)
// and the Dmg Calc what-if sims (ecGetWhatIfIntel). Built under setMinusPot
// (the EI semantics: the 'potentials:*' group keys stripped) — for non-dead
// hits the two consumers' states are identical (group keys never match row
// keys); for dead hits only the machinery's early return differs, which the
// what-if callers bypass via b.dead (never reading the intel).
// b.dead mirrors the machinery's early return: the attacker char toggled off,
// or the hit's potentials group disabled.
const _ecSharedBase = { sig: null, hits: null, lastChange: undefined };
function ecSharedBaselineSig() {
    return dcStateVersion + '|' + dcFiltered.length + '|'
        + [...dcEffectsDisabled].sort().join(',');
}
// Change hint from the live toggle paths: a Set of disabled keys that just
// changed, or null when anything may have changed globally (field edits,
// level ±, bonuses). Enables the incremental per-hit rebuild below.
function ecNoteSharedChange(keys) { _ecSharedBase.lastChange = keys; }
// One hit's engine build (the shared unit of work).
function ecBuildSharedHit(ev, setMinusPot, prof, acc) {
    const b = { ev, disOnly: null, dead: false, charId: dcEventCharId(ev), intel: null, dmg: 0, fields: null, statIntel: null };
    let s = (prof && acc) ? performance.now() : 0;
    b.disOnly = dcApplyEffectOverrides(ev, setMinusPot, dcEffectLevelOverrides, true);
    if (prof && acc) acc.tDis += performance.now() - s;
    if (prof && acc) s = performance.now();
    const pre = ecPreanalyzeHit(b, setMinusPot);
    if (prof && acc) acc.tPre += performance.now() - s;
    if (prof && acc) s = performance.now();
    b.intel = ecBuildIntel(b, pre, dcDisabled, setMinusPot);
    if (prof && acc) acc.tIntel += performance.now() - s;
    const charName = ev.AttackerDisplay || ev.Attacker || '';
    b.dead = (charName && typeof dcCharsDisabled !== 'undefined' && dcCharsDisabled.has(charName))
        || !!b.intel.zeroed;
    return b;
}
function ecPublishShared(hits, sig, prof, acc) {
    if (prof && acc) {
        prof.dur(`baseline · dcApplyEffectOverrides (${dcFiltered.length} hits)`, acc.tDis);
        prof.dur(`baseline · ecPreanalyzeHit`, acc.tPre);
        prof.dur(`baseline · ecBuildIntel`, acc.tIntel);
    }
    _ecSharedBase.sig = sig;
    _ecSharedBase.hits = hits;
    return hits;
}
// Incremental rebuild: only hits carrying one of the changed keys (and not
// protected by a level-coupling key) can change — everything else reuses its
// previous b. Returns the hits array or null when the incremental path
// doesn't apply.
function ecSharedIncremental(sig, setMinusPot, prof) {
    const change = _ecSharedBase.lastChange;   // a Set of changed keys, or null
    _ecSharedBase.lastChange = null;
    const prev = _ecSharedBase.hits;
    if (!(change instanceof Set) || !change.size || !prev || prev.length !== dcFiltered.length) return null;
    const lk = dcLevelCouplingKeys();
    for (const k of change) if (lk.has(k)) return null;   // level scaling moved globally
    const hits = new Array(dcFiltered.length);
    const acc = { tDis: 0, tPre: 0, tIntel: 0 };
    for (let i = 0; i < dcFiltered.length; i++) {
        const ev = dcFiltered[i];
        const old = prev[i];
        if (old && old.ev === ev) {
            const cand = dcHitCandidateKeys(ev);
            let aff = false;
            for (const k of change) { if (cand.has(k)) { aff = true; break; } }
            if (!aff) { hits[i] = old; continue; }
        }
        hits[i] = ecBuildSharedHit(ev, setMinusPot, prof, acc);
    }
    return ecPublishShared(hits, sig, prof, acc);
}
function ecGetSharedBaseline(prof) {
    const sig = ecSharedBaselineSig();
    if (_ecSharedBase.sig === sig && _ecSharedBase.hits) return _ecSharedBase.hits;
    const setMinusPot = new Set();
    for (const k of dcEffectsDisabled) if (!k.startsWith('potentials:')) setMinusPot.add(k);

    if (_ecSharedBase.hits && _ecSharedBase.lastChange) {
        const inc = ecSharedIncremental(sig, setMinusPot, prof);
        if (inc) return inc;
    }
    _ecSharedBase.lastChange = null;
    const hits = new Array(dcFiltered.length);
    const acc = { tDis: 0, tPre: 0, tIntel: 0 };
    for (let i = 0; i < dcFiltered.length; i++) {
        hits[i] = ecBuildSharedHit(dcFiltered[i], setMinusPot, prof, acc);
    }
    return ecPublishShared(hits, sig, prof, acc);
}

// Chunked variant for background builds: slices the per-hit loop into
// ~50 ms chunks with a frame yield between them; the caller's isAborted()
// runs after every yield (a stale run must not publish its result). The
// shared cache is only assigned when the build completes.
function _ecYieldFrame() {
    return new Promise(r => (typeof requestAnimationFrame === 'function')
        ? requestAnimationFrame(() => r()) : setTimeout(r, 0));
}
async function ecGetSharedBaselineChunked(prof, isAborted) {
    const sig = ecSharedBaselineSig();
    if (_ecSharedBase.sig === sig && _ecSharedBase.hits) return _ecSharedBase.hits;
    const setMinusPot = new Set();
    for (const k of dcEffectsDisabled) if (!k.startsWith('potentials:')) setMinusPot.add(k);

    if (_ecSharedBase.hits && _ecSharedBase.lastChange) {
        const inc = ecSharedIncremental(sig, setMinusPot, prof);
        if (inc) return inc;
    }
    _ecSharedBase.lastChange = null;
    const hits = new Array(dcFiltered.length);
    const acc = { tDis: 0, tPre: 0, tIntel: 0 };
    let sliceStart = performance.now();
    for (let i = 0; i < dcFiltered.length; i++) {
        hits[i] = ecBuildSharedHit(dcFiltered[i], setMinusPot, prof, acc);
        if (performance.now() - sliceStart > 50) {
            await _ecYieldFrame();
            if (isAborted()) return null;
            sliceStart = performance.now();
        }
    }
    return ecPublishShared(hits, sig, prof, acc);
}

function ecGetWhatIfIntel() {
    return ecGetSharedBaseline();
}

const EC_EMPTY_SET = new Set();   // shared no-diff set for the what-if calls

// Does the hit reference a moved level-table source (its effect rows, or its
// own hit scaling through the source)?
function ecWhatIfSrcAffects(b, src) {
    const c = src.indexOf(':');
    const kind = src.slice(0, c), id = src.slice(c + 1);
    if (kind === 'pot') return b.intel.potAff.has(Number(id));
    if (kind === 'skill') return b.intel.skillAff.has(id);
    return b.intel.noteAffFam.has(Number(id));
}

// Row enable/disable ops for one hit under a what-if disabled-set diff,
// composed onto the ZERO-state intel. Machinery order: per side block
// (attacker effects, attacker record, defender effects — each with its
// attrDict) the snapshot-group deltas first, then the seen-by-configId row
// removals, then the dict removals — the same accumulation order the
// machinery's disable block uses.
//
// Per-row delta semantics vs the zero state:
//   disable → −(logged value × count) at the logged placement. The raw stats
//     carry the row at its logged level; the zero state (row enabled) keeps
//     it; the what-if removes it. Level-override values never appear (the
//     level block only touches enabled rows): for level-scaled rows the
//     logged value is the lv entry's remVal, for the rest deltaIdx.amount
//     (no level table can attach an override to a non-level-scaled row).
//   enable → +(the row's net contribution under the base tables, i.e. the
//     override-aware deltaIdx amount). The zero state holds the row at
//     raw−removal(=0 when it was disabled, =raw when enabled)… in both cases
//     the what-if's net (override value, or the raw logged value) minus the
//     zero-state content equals the deltaIdx amount.
//   inherited snapshot rows → per-group closed form with the MERGED
//     membership (the s_base·s_pct cross term), one base op per touched
//     group.
function ecWhatIfRowOps(b, dis, en) {
    if (!dis.size && !en.size) return null;
    const intel = b.intel;
    const dlist = [];

    // level-scaled entries of this hit, by 'side:configId' (lazy — the map
    // is cached on the intel, which lives one state version)
    let lvByKey = intel._lvByKey;
    if (!lvByKey) {
        lvByKey = new Map();
        for (const entry of intel.lv) {
            if (!entry.isAttr) lvByKey.set(sideStr(entry.side) + ':' + entry.configId, entry);
        }
        intel._lvByKey = lvByKey;
    }

    for (const blk of [
        { sideNum: 0, list: b.ev.AttackerEffects?.effects, dict: b.ev.AttackerAttrDict },
        { sideNum: 0, list: b.ev.AttackerRecord?.effects, dict: null },
        { sideNum: 1, list: b.ev.DefenderEffects?.effects, dict: b.ev.DefenderAttrDict },
    ]) {
        // ── snapshot groups of THIS list (first-appearance order) ──
        if (blk.list?.length) {
            const listGroups = [];
            const seenG = new Set();
            for (const e of blk.list) {
                if (!allowedEffectTypes.includes(e.effectType)) continue;
                if (!e.fromOwnerSnapshot || e.baseStatOnSnapshot == null) continue;
                const key = sideStr(blk.sideNum) + ':' + e.configId + ':' + (e.valueConfigId ?? '');
                if (!(dis.has(key) || en.has(key))) continue;
                const gs = intel.snapByKey.get(key);
                if (!gs) continue;
                for (const g of gs) if (!seenG.has(g)) { seenG.add(g); listGroups.push(g); }
            }
            for (const g of listGroups) {
                let oldB = 0, oldP = 0, newB = 0, newP = 0;
                let anyOld = false, anyNew = false;
                for (let oi = 0; oi < g.occs.length; oi++) {
                    const occ = g.occs[oi];
                    const flipped = dis.has(occ.key) || en.has(occ.key);
                    const eff = flipped ? !occ.dis : occ.dis;
                    if (occ.dis) {
                        anyOld = true;
                        if (occ.st === 1) oldB += occ.v; else if (occ.st === 2) oldP += occ.v;
                    }
                    if (eff) {
                        anyNew = true;
                        if (occ.st === 1) newB += occ.v; else if (occ.st === 2) newP += occ.v;
                    }
                }
                const dOld = anyOld ? -(g.B * oldP + oldB * (1 + g.P - oldP)) : 0;
                const dNew = anyNew ? -(g.B * newP + newB * (1 + g.P - newP)) : 0;
                const amt = dNew - dOld;
                if (amt !== 0) dlist.push([g.side, g.attrId, 1, amt]);
            }
        }

        // ── non-snapshot eff rows (seen by configId, legacy-resolved key —
        // the disable block's per-effect loop order and key format) ──
        if (blk.list?.length) {
            const seen = new Set();
            for (const e of blk.list) {
                if (!allowedEffectTypes.includes(e.effectType)) continue;
                if (e.fromOwnerSnapshot) continue;   // handled by the group phase
                if (e.configId == null || seen.has(e.configId)) continue;
                seen.add(e.configId);
                const er = dcResolveLegacyEffectRow(e, b.charId, false) || e;
                const key = sideStr(blk.sideNum) + ':' + e.configId + ':' + (er.valueConfigId ?? '');
                const toDis = dis.has(key), toEn = en.has(key);
                if (!toDis && !toEn) continue;
                if (toDis) {
                    const entry = lvByKey.get(sideStr(blk.sideNum) + ':' + e.configId);
                    if (entry) {
                        // level-scaled: the disable removes the logged value
                        // (the lv entry's remVal), never the override value
                        const slot = ecOpSlot(entry.rMeta, entry.elem);
                        if (slot) dlist.push([blk.sideNum, slot[0], slot[1], -(entry.remVal * entry.n)]);
                    } else {
                        const delta = intel.deltaIdx.get(sideStr(blk.sideNum) + ':' + e.configId);
                        if (delta) {
                            const meta = { attrType: delta.attrType, subType: delta.subType,
                                effectType: delta.effType, isRecord: delta.isRec };
                            const slot = ecOpSlot(meta, intel.el);
                            if (slot) dlist.push([blk.sideNum, slot[0], slot[1], -delta.amount]);
                        }
                    }
                } else {
                    // enable: the row's net contribution under the base tables
                    const delta = intel.deltaIdx.get(sideStr(blk.sideNum) + ':' + e.configId);
                    if (delta) {
                        const meta = { attrType: delta.attrType, subType: delta.subType,
                            effectType: delta.effType, isRecord: delta.isRec };
                        const slot = ecOpSlot(meta, intel.el);
                        if (slot) dlist.push([blk.sideNum, slot[0], slot[1], delta.amount]);
                    }
                }
            }
        }

        // ── dict rows (seen by configId, stacks — the disable block's dict
        // loop; the what-if keys use the collector's format) ──
        if (Array.isArray(blk.dict)) {
            const seen = new Set();
            for (const e of blk.dict) {
                if (e.attrType == null || e.subType == null || e.value == null) continue;
                const cid = e.configId ?? e.attrId;
                if (cid == null || seen.has(cid)) continue;
                seen.add(cid);
                const key = sideStr(blk.sideNum) + ':dict:' + cid + ':' + (e.valueConfigId ?? '') + ':' + (e.slotNum ?? 0);
                const toDis = dis.has(key), toEn = en.has(key);
                if (!toDis && !toEn) continue;
                const delta = intel.deltaIdx.get(key);
                if (!delta) continue;
                const stacks = e.stacks != null ? e.stacks : 1;
                if (toDis) dlist.push([blk.sideNum, delta.attrType, delta.subType, -(e.value * stacks)]);
                else       dlist.push([blk.sideNum, delta.attrType, delta.subType, delta.amount]);
            }
        }
    }
    return dlist.length ? dlist : null;
}

// One hit's damage under a general what-if state. `dis`/`en` = the disabled-
// set diffs vs the live state (disable / enable these row keys); `lvlLc`
// (optional) = Map '<kind>:<source>' → the what-if state's effective level
// for level-table sources whose level moved (computed by the caller from the
// merged level tables — the REAL effective-level functions under the merged
// disabled set, so coupling keys like disc note rows are covered). The two
// compose:
//   - row diffs → the disable-block removals / enable additions
//     (ecWhatIfRowOps),
//   - level moves → the level-override ops replay: every entry ENABLED in
//     the what-if state gets its ops at the what-if override value; rows
//     newly disabled are handled by the row phase (−logged) and skipped
//     here; rows re-enabled from the base's disabled set are subsumed by
//     their row-phase +net op (the machinery nets the same: the raw and its
//     removal cancel inside every state).
// Returns the damage, or null when the state is identical to the baseline
// (the caller keeps its cached per-hit damage). Zeroed hits (disabled char
// or Potentials group) never reach here — the what-if sets never touch group
// keys or char toggles, so their damage is 0 in every state.
function ecWhatIfHitDamage(b, dis, en, lvlLc) {
    const intel = b.intel;
    const rowOps = ecWhatIfRowOps(b, dis, en);
    const dlist = rowOps ? rowOps.slice() : [];
    let changed = rowOps != null;
    for (const entry of intel.lv) {
        if (entry.rowDis) continue;              // still/re-enabled rows: the row phase covers them
        if (dis.has(entry.disKey)) continue;     // newly disabled: the row phase's −logged replaces the ops
        const Lc = lvlLc ? lvlLc.get(entry.kind + ':' + entry.cand) : undefined;
        const ovV = Lc !== undefined ? ecEntryOvValue(entry, Lc) : entry.baseOvV;
        if (ovV !== entry.baseOvV) changed = true;
        const ops = ecEntryOps(entry, ovV);
        if (ops) for (const op of ops) dlist.push(op);
    }
    // hit's own level scaling (pot/skill perk) under the what-if tables
    let multRaw = null;
    if (lvlLc) {
        if (intel.skillPerk != null) {
            const Lc = lvlLc.get('skill:' + intel.skillPerk);
            if (Lc !== undefined) {
                multRaw = ecMultiplierFor(intel, Lc);
                if (multRaw != null) changed = true;
            }
        } else if (intel.potPerk != null) {
            const Lc = lvlLc.get('pot:' + intel.potPerk);
            if (Lc !== undefined) {
                multRaw = ecMultiplierFor(intel, Lc);
                if (multRaw != null) changed = true;
            }
        }
    }
    if (!changed) return null;
    if (!dlist.length && multRaw == null) return intel.refDmg;   // state = the zero state exactly
    return ecAnalyticDamage(intel, dlist, multRaw);
}

// Effective levels of every level-table source under a hypothetical disabled
// set, for the sources whose level actually moved vs the live state. The
// REAL effective-level functions under the merged set — exactly what the
// machinery's dcGetLevelOverride / dcHitScalingLevel would resolve.
function ecWhatIfLevelChanges(merged) {
    const m = new Map();
    for (const [potId, st] of dcPotLevels) {
        const Lc = dcPotEffectiveLevel(st, merged);
        if (Lc !== dcPotEffectiveLevel(st, dcEffectsDisabled)) m.set('pot:' + potId, Lc);
    }
    for (const [skey, st] of dcSkillLevels) {
        const Lc = dcSkillEffectiveLevel(st, merged);
        if (Lc !== dcSkillEffectiveLevel(st, dcEffectsDisabled)) m.set('skill:' + skey, Lc);
    }
    for (const [noteId, st] of dcNoteLevels) {
        const Lc = dcNoteEffectiveLevel(st, merged);
        if (Lc !== dcNoteEffectiveLevel(st, dcEffectsDisabled)) m.set('note:' + noteId, Lc);
    }
    return m;
}

// ─── Compute driver ───────────────────────────────────────────────────────
// Shared per-compute context: level tables, blank-baseline domain (with the
// per-hit preanalysis), candidate list. ecComputeAll() = base + all tables
// (synchronous — used by the regression tests); the tab's render path drives
// ecComputeBase + ecComputeCharTable per character with yields between
// tables so the UI never freezes for the whole compute.

function ecComputeBase(prof) {
    let t = performance.now();
    const rec = getOriginRecord();
    if (!rec || !Array.isArray(rec.chars) || !rec.chars.length) return null;

    // Rebuild the level tables from the record first — the pot/skill affix
    // candidates read them, and they are normally only rebuilt by the
    // dmg-calc effect collection (which may never have run this session).
    if (typeof dcRebuildPotLevels === 'function') dcRebuildPotLevels();
    if (typeof dcRebuildSkillLevels === 'function') dcRebuildSkillLevels();
    if (typeof dcRebuildNoteLevels === 'function') dcRebuildNoteLevels();
    if (typeof dcEnsureHitLevels === 'function') dcEnsureHitLevels();
    if (prof) t = prof('level tables', t);

    // ── Blank baseline: disable every emblem row the record carries ──
    // Emblem rows attach to their owner's hits only, so disabling them all
    // blanks every record char; each char's table then patches the
    // hypothetical lines onto THAT character alone.
    const emblemKeys = new Set();
    for (const ch of rec.chars) {
        const cid = String(ch.charId ?? '');
        if (!cid) continue;
        for (const r of buildRecordEmblemEffects(rec, cid)) {
            emblemKeys.add(`attacker:${r.configId}:0`);
            // dcRebuildPotLevels cleared the pot rows' disable-key wiring
            // (the dmg-calc collection normally re-wires it from its pot rows;
            // replicate that here from the record rows themselves).
            if (r.isPotRow && r.linkPotential) {
                const stL = dcPotLevels.get(Number(r.linkPotential.potId));
                if (stL) stL.potKey = `attacker:${r.configId}:0`;
            }
        }
    }
    const extDisabled = new Set(dcEffectsDisabled);
    for (const k of emblemKeys) extDisabled.add(k);
    extDisabledRef = extDisabled;   // ecSkillLcand reads it

    const ecDis = ecCalcDisabled();   // constant for the whole compute
    const candidates = ecBuildCandidates();
    if (prof) t = prof(`candidates (${candidates.attrRows.length} stat + ${candidates.skillRows.length} skill + ${candidates.potRows.length} pot)`, t);

    // Shared blank baseline over ALL deployed team characters' hits, computed
    // once — the per-char tables slice their personal domain out of it and the
    // team-scope row gains are measured against the full team domain.
    const teamIds = (Array.isArray(rec.team) && rec.team.length)
        ? rec.team.map(Number)
        : rec.chars.map(c => Number(c.charId));
    const teamIdSet = new Set(teamIds);
    const teamBaseline = [];
    let tDis = 0, tPre = 0, tIntel = 0, hitCount = 0;
    for (let i = 0; i < dcFiltered.length; i++) {
        const ev = dcFiltered[i];
        const charId = dcEventCharId(ev);
        if (!teamIdSet.has(charId)) continue;
        hitCount++;
        // disable-only stat state (raw − every disabled row, snapshot
        // aggregation included, NO level-override deltas) — the analytic
        // engine's patch base and the baseline fields' base.
        let s = 0;
        if (prof) s = performance.now();
        const disOnly = dcApplyEffectOverrides(ev, extDisabled, dcEffectLevelOverrides, true);
        if (prof) tDis += performance.now() - s;
        const dead = !!disOnly._potentialsDisabled;
        const b = { ev, disOnly, dead, charId, intel: null, dmg: 0, fields: null, statIntel: null };
        if (!dead) {
            // ── preanalysis: affected sets + every level-scaled entry (with
            // its baseline override) + the baseline level-override ops ──
            if (prof) s = performance.now();
            const pre = ecPreanalyzeHit(b, extDisabled);
            if (prof) tPre += performance.now() - s;
            if (prof) s = performance.now();
            b.intel = ecBuildIntel(b, pre, ecDis, extDisabled);
            if (prof) tIntel += performance.now() - s;
        }
        teamBaseline.push(b);
    }
    if (prof) {
        prof.dur(`baseline · dcApplyEffectOverrides (${hitCount} hits)`, tDis);
        prof.dur(`baseline · ecPreanalyzeHit`, tPre);
        prof.dur(`baseline · ecBuildIntel`, tIntel);
    }
    const teamBaseTotal = teamBaseline.reduce((s, b) => s + b.dmg, 0);

    return { rec, teamIds, teamBaseline, teamBaseTotal, candidates, extDisabled, ecDis, pf: prof };
}

// Apply ordered stat ops to a state (copy-on-write per touched attr,
// sequential in op order = the override machinery's mutation order).
function ecApplyOps(state, ops) {
    const aMap = new Map(state.aStats.map((s, i) => [i, s]));
    const dMap = new Map(state.dStats.map((s, i) => [i, s]));
    for (const op of ops) {
        const side = op[0], attr = op[1], kind = op[2], amt = op[3];
        const map = side === 0 ? aMap : dMap;
        const cur = map.get(attr);
        const st = {
            origin: cur ? (cur.origin || 0) : 0,
            base: cur ? (cur.base || 0) : 0,
            pct: cur ? (cur.pct || 0) : 0,
            abs: cur ? (cur.abs || 0) : 0,
        };
        if (kind === 0) st.origin += amt;
        else if (kind === 1) st.base += amt;
        else if (kind === 2) st.pct += amt;
        else st.abs += amt;
        map.set(attr, st);
    }
    return {
        aStats: [...aMap.values()],
        dStats: [...dMap.values()],
        _potentialsDisabled: state._potentialsDisabled,
    };
}

function ecComputeAll(prof) {
    const c = ecComputeBase(prof);
    if (!c) return null;

    // One table per deployed record character (rec.team order).
    const tables = [];
    for (const charId of c.teamIds) {
        if (!charId) continue;
        const t = ecComputeCharTable(charId, c);
        t.charName = (typeof resolveActorKey === 'function') ? resolveActorKey('p:' + charId) : String(charId);
        tables.push(t);
    }

    // Team baseline = the shared blank domain total (for the per-table
    // Personal dmg / Team dmg scope droplist) — equals the sum of the tables'
    // blank baselines, since the team baseline covers exactly the team's hits.
    for (const t of tables) t.teamBase = c.teamBaseTotal;

    return { tables };
}

// ─── Render ───────────────────────────────────────────────────────────────────
function ecRender() {
    const panel = document.getElementById('ecPanel');
    if (!panel.classList.contains('visible')) return;

    const rec = getOriginRecord();
    if (!rec || !Array.isArray(rec.chars) || !rec.chars.length) {
        panel.innerHTML = `<div class="ei-empty">This log doesn't have a record log — the emblems comparison needs a record (Origin) event.</div>`;
        return;
    }

    if (!dcFiltered.length) {
        // Auto-load: if no filtered hits yet but hit events exist, build the
        // Dmg Calc filter list first (same as the Effect Impact tab).
        if (!_ecAutoLoading && allEvents.some(e => e.Type === 'Hit')) {
            if (typeof dcRefilterAndRender === 'function') {
                _ecAutoLoading = true;
                try {
                    const _pf = _perfStart('EC');
                    dcRefilterAndRender(false, false);
                    _pf('auto-load filter');
                } finally { _ecAutoLoading = false; }
                if (typeof fcDirtyHits !== 'undefined') fcDirtyHits = false;
                return; // dcRefilterAndRender → dcRefreshEI → ecRender with hits loaded
            }
        }
        panel.innerHTML = `<div class="ei-empty">No hit events loaded yet — wait for combat data.</div>`;
        return;
    }

    panel.innerHTML = `<div class="ei-loading">Computing emblems comparison…</div>`;
    const seq = ++_ecRenderSeq;
    ecLastData = null;

    ecEnsureObserved(async () => {
        if (seq !== _ecRenderSeq) return;   // a newer render superseded this one
        // Chunked compute: the shared baseline + preanalysis runs first, then
        // one character table per task with a yield between each — every table
        // renders as soon as it is ready, so the panel paints progressively
        // and the UI thread is never blocked for the whole compute.
        const _pf = _perfStart('EC');
        const c = ecComputeBase(_pf);
        if (!c) { ecLastData = null; ecRenderTable(); return; }
        ecLastData = { tables: [], teamBaseTotal: c.teamBaseTotal };
        for (const charId of c.teamIds) {
            if (!charId) continue;
            const t = ecComputeCharTable(charId, c);
            t.charName = (typeof resolveActorKey === 'function') ? resolveActorKey('p:' + charId) : String(charId);
            t.teamBase = c.teamBaseTotal;
            ecLastData.tables.push(t);
            if (seq !== _ecRenderSeq) return;   // superseded mid-compute
            await new Promise(r => setTimeout(r, 0));   // yield to the UI
            if (seq !== _ecRenderSeq) return;
            const t0 = performance.now();
            ecRenderTable();
            _pf.dur(`render table ${t.charName} (dom)`, performance.now() - t0);
            requestAnimationFrame(() => requestAnimationFrame(() =>
                _pf(`render table ${t.charName} (through first paint)`, t0)));
        }
    });
}

// Sort rows by the ×1 column (gain % of the blank baseline, best first);
// ties fall back to the effect name. Sorting is fixed — the headers are static.
// When the table's scope droplist is on Team dmg, the team-scope gains sort.
function ecSortRows(rows, team) {
    const pctOf = (r) => {
        const g = team ? (r.teamGains ?? r.gains) : r.gains;
        const b = team ? (r.teamBases ?? r.bases) : r.bases;
        return (g && g[0] != null && b && b[0] > 0) ? (g[0] / b[0]) * 100 : -Infinity;
    };
    rows.sort((a, b) => {
        const va = pctOf(a), vb = pctOf(b);
        if (!isFinite(va) && !isFinite(vb)) return (a.name || '').localeCompare(b.name || '');
        if (!isFinite(va)) return 1;
        if (!isFinite(vb)) return -1;
        return vb - va;
    });
}

function ecRenderTable() {
    const panel = document.getElementById('ecPanel');
    if (!panel || !ecLastData) return;
    const { tables } = ecLastData;

    // Shared free-text search (same domain as the Dmg Calc sidebar search)
    const q = (typeof fcSearchQuery === 'string' ? fcSearchQuery : '').trim().toLowerCase();

    const pctOf = (g, base) => (base > 0) ? (g / base) * 100 : (g > 0 ? Infinity : 0);
    const fmtGain = (g, base) => {
        if (base == null) return '—';
        const p = pctOf(g, base);
        if (!isFinite(p)) return g > 0 ? '∞%' : '0';
        return Math.abs(p) < 0.05 ? '0' : p.toFixed(1) + '%';
    };

    // Visible gain columns (×1/×2/×3 droplist) + active emblem tier (radio).
    const visCols = [1, 2, 3].filter(k => ecColsSel[k]);
    const activeTiers = ecTierSel ? [ecTierSel] : [];
    // Gain columns are auto-sized (flex to their content, white-space:nowrap);
    // the Effect column has width:100% and absorbs the remaining space.


    let html = `
    <div class="ei-header-bar">
        ${[70, 80, 90].map(tier => `<button class="ei-src-chip ei-chip-src ${ecTierSel === tier ? 'ei-chip-active' : ''}" onclick="ecSetTier(${tier})" title="${ecTierSel === tier ? 'Click again to show all emblem tiers' : 'Show only lines from Emblem ' + tier}">${tier}</button>`).join('')}
        <select class="ec-rarity-sel" onchange="ecSetRarity(this.value)" title="Minimum rarity of the emblem stat to show (CharGemAttrValue.Rarity: 1 green, 2 blue, 3 gold, 4 rainbow)">
            <option value="1" ${ecRarityMin <= 1 ? 'selected' : ''}>green+</option>
            <option value="2" ${ecRarityMin === 2 ? 'selected' : ''}>blue+</option>
            <option value="3" ${ecRarityMin === 3 ? 'selected' : ''}>gold+</option>
            <option value="4" ${ecRarityMin >= 4 ? 'selected' : ''}>rainbow</option>
        </select>
        <span class="ec-cols-wrap">
            <button class="ei-src-chip ei-chip-src ${ecShowZero ? 'ei-chip-active' : ''}" onclick="ecToggleShowZero()" title="Also show lines with a 0% gain (Def/MaxHp, off-element lines, display-only stats) and Charge Eff rows (energy regen only, no per-hit damage) — hidden by default">Show 0%</button>
            <button class="ei-src-chip ei-chip-src ${ecShowColors ? 'ei-chip-active' : ''}" onclick="ecToggleShowColors()" title="Apply the tier background colors (Emblem-80 / Emblem-90 lines) to the table rows">Show colors</button>
            <button class="ei-src-chip ei-chip-src" onclick="ecToggleColsDropdown(event)" title="Show or hide the gain columns">Columns ▾</button>
            <div class="ec-cols-menu" id="ecColsMenu" style="display:${ecColsOpen ? 'block' : 'none'}">
                ${[1, 2, 3].map(k => `<label><input type="checkbox" ${ecColsSel[k] ? 'checked' : ''} onchange="ecSetCol(${k}, this.checked)"> ×${k}</label>`).join('')}
            </div>
        </span>
    </div>
    <div class="ei-scroll-wrap"><div class="ec-tables">`;

    for (const t of tables) {
        let rows = [...t.rows];
        if (q) rows = rows.filter(r => (r.name || '').toLowerCase().includes(q));
        // Tier (radio) + rarity filters apply to ALL rows — stat lines by the
        // tiers they can roll on, affix rows by the emblem slot they came from.
        if (activeTiers.length) {
            rows = rows.filter(r => (!r.tiers || !r.tiers.length
                || r.tiers.some(e => activeTiers.includes(e.tier) && (e.rarity ?? 1) >= ecRarityMin)
                // rainbow: stats that never roll rainbow keep their max-lvl
                // row visible (within the selected emblem tier)
                || (ecRarityMin >= 4 && r.statNoRainbow && r.isStatMax
                    && r.tiers.some(e => activeTiers.includes(e.tier)))));
        } else if (ecRarityMin > 1) {
            rows = rows.filter(r => (!r.tiers || !r.tiers.length
                || r.tiers.some(e => (e.rarity ?? 1) >= ecRarityMin)
                // rainbow: stats that never roll rainbow keep their max-lvl row
                || (ecRarityMin >= 4 && r.statNoRainbow && r.isStatMax)));
        }
        const scope = ecScopeByChar[t.charId] || 'team';
        const useTeam = scope === 'team';
        if (!ecShowZero) {
            // Hide rows that show nothing measurable in the visible gain
            // columns: 0% gains (Def/MaxHp, off-element lines…) AND "—"
            // rows (Charge Eff rows, affix rows whose effects never ride a
            // hit in the active scope). Show 0% brings everything back.
            const isZeroish = (g, b) => (g != null && b != null) ? (pctOf(g, b) < 0.05) : false;
            rows = rows.filter(r => {
                if (r.kind === 'charge') return false;
                const gArr = useTeam ? (r.teamGains ?? r.gains) : r.gains;
                const bArr = useTeam ? (r.teamBases ?? r.bases) : r.bases;
                if (!gArr || !gArr.length) return false;      // all "—"
                return visCols.some(k => {
                    const g = gArr[k - 1];
                    return g != null && !isZeroish(g, bArr ? bArr[k - 1] : null);
                });
            });
        }
        ecSortRows(rows, useTeam);

        const ths = visCols.length
            ? `<th class="ei-th ei-th-name" style="width:100%">Effect</th>`
            + visCols.map(k => `<th class="ei-th ei-th-num">×${k}</th>`).join('')
            : `<th class="ei-th ei-th-name" style="width:100%">Effect</th>`;

        html += `
        <div class="ec-table-col">
            <div class="ec-char-title">
                <span class="ec-char-name">${esc(t.charName || ('Char ' + t.charId))}</span>
                <button class="ec-scope-btn" onclick="ecToggleScope(${t.charId})" title="Click to switch — Team dmg: gains measured against the whole deployed team's damage · Personal dmg: against this character's damage only">${useTeam ? 'Team dmg' : 'Personal dmg'}</button>
            </div>
            <table class="ei-table ec-table">
                <thead>
                    <tr>${ths}</tr>
                </thead>
                <tbody>`;

        for (const row of rows) {
            // badges removed — tier / owner info lives in the row tooltip

            // Gain cells: one per visible copy column (×1/×2/×3); rows with
            // fewer copies leave the remaining columns empty.
            let cells = '';
            for (const k of visCols) {
                const gArr = useTeam ? (row.teamGains ?? row.gains) : row.gains;
                const bArr = useTeam ? (row.teamBases ?? row.bases) : row.bases;
                if (!gArr || k - 1 >= gArr.length) { cells += `<td class="ei-td ei-td-num"></td>`; continue; }
                const g = gArr[k - 1];
                const base = bArr ? bArr[k - 1] : null;
                if (g == null || base == null) {
                    cells += `<td class="ei-td ei-td-num"><span class="ei-muted" title="Not measurable — no damage-relevant effect of this line appears in this character's filtered hits">—</span></td>`;
                    continue;
                }
                const p = pctOf(g, base);
                // Gray out anything under 1% — only meaningful gains get color.
                const cls = Math.abs(p) < 1 ? 'ei-neutral' : (p > 0 ? 'ei-pos' : 'ei-neg');
                const absStr = Math.round(g).toLocaleString();
                const isLv = row.kind === 'skill' || row.kind === 'pot';
                const tip = isLv
                    ? `Damage gain from nothing to the emblem affix's +${(row.valueStr || '').replace('+', '')} (absolute): ${absStr} dmg`
                    : `Damage gain when adding copy ${k} (${k === 1 ? 'nothing → 1 copy' : k - 1 + ' → ' + k + ' copies'}): ${absStr} dmg${scope === 'team' ? ' · vs team baseline' : ''}`;
                cells += `<td class="ei-td ei-td-num"><span class="${cls} ei-bold" title="${esc(tip)}">${fmtGain(g, base)}</span></td>`;
            }

            const tierTip = (row.tiers && row.tiers.length && row.kind !== 'skill' && row.kind !== 'pot')
                ? ` · Emblem ${row.tiers.map(e => e.tier).join('/')}` : '';
            const ownerTip = (row.kind === 'skill' || row.kind === 'pot') && row.charName
                ? ` · ${esc(row.charName)}'s emblem affix` : '';
            // Stat value rides inline after the effect name (green); long
            // names wrap instead of ellipsizing.
            // '+3 lv' → '+3' inline (the lv suffix stays in tooltips/tests)
            const inlineVal = row.kind === 'charge'
                ? `<span class="ei-val">${esc(row.valueStr)}</span> <span class="ec-note" title="Charge efficiency affects energy regeneration, not per-hit damage">n/m</span>`
                : `<span class="ei-val">${esc((row.valueStr || '').replace(/\s*lv$/, ''))}</span>`;
            // Subtle background tint by the line's lowest emblem tier:
            // 80 slightly lighter, 90 slightly less so (closest to the base
            // bg, since 90 lines are the most common).
            const lowTier = (row.tiers && row.tiers.length) ? Math.min(...row.tiers.map(e => e.tier)) : 0;
            const rowCls = ecShowColors ? (lowTier === 80 ? ' ec-tier-80' : lowTier === 90 ? ' ec-tier-90' : '') : '';
            html += `<tr class="ei-row${rowCls}">
                <td class="ei-td ei-td-name" title="${esc(row.name)}${row.attrType != null ? ' · attr ' + row.attrType : ''}${tierTip}${ownerTip}">${esc(row.name)} ${inlineVal}</td>
                ${cells}
            </tr>`;
        }

        if (rows.length === 0) {
            html += `<tr><td colspan="${1 + visCols.length}" class="ei-empty-row">No emblem lines match the current search.</td></tr>`;
        }

        html += `</tbody></table></div>`;
    }

    html += `</div></div>`;
    panel.innerHTML = html;
}

window.ecSetRarity = function(val) {
    const n = parseInt(val, 10);
    ecRarityMin = (n >= 1 && n <= 4) ? n : 1;
    ecRenderTable();
};

// Tier tint colors (picked in the header bar). Applied as CSS custom
// properties; the row classes mix them over the dark base at a fixed
window.ecSetTier = function(tier) {
    ecTierSel = (ecTierSel === tier) ? 0 : tier;   // radio: click again → all tiers
    ecRenderTable();
};

window.ecSetCol = function(k, on) {
    ecColsSel[k] = !!on;
    ecColsOpen = true;   // keep the dropdown open while toggling
    ecRenderTable();
};

window.ecToggleColsDropdown = function(ev) {
    if (ev && ev.stopPropagation) ev.stopPropagation();
    ecColsOpen = !ecColsOpen;
    const menu = document.getElementById('ecColsMenu');
    if (menu) menu.style.display = ecColsOpen ? 'block' : 'none';
};

// Close the columns dropdown when clicking anywhere else.
document.addEventListener('click', (e) => {
    if (!ecColsOpen) return;
    const wrap = e.target && e.target.closest ? e.target.closest('.ec-cols-wrap') : null;
    if (!wrap) {
        ecColsOpen = false;
        const menu = document.getElementById('ecColsMenu');
        if (menu) menu.style.display = 'none';
    }
});

window.ecToggleScope = function(charId) {
    const cur = ecScopeByChar[charId] || 'team';   // unset default = team
    ecScopeByChar[charId] = (cur === 'team') ? 'personal' : 'team';
    ecRenderTable();
};

window.ecToggleShowZero = function() {
    ecShowZero = !ecShowZero;
    ecRenderTable();
};

window.ecToggleShowColors = function() {
    ecShowColors = !ecShowColors;
    ecRenderTable();
};

// Refresh hook — called by dcRefreshEI (dmgCalc.calc state changes) and by
// switchTab. Only recomputes when the panel is actually visible.
function ecRefreshIfVisible() {
    const el = document.getElementById('ecPanel');
    if (el && el.classList.contains('visible')) ecRender();
}

// ─── Tab hook ─────────────────────────────────────────────────────────────────
const _ecOrigSwitchTab = window.switchTab;
window.switchTab = function(tab) {
    const tabBtn = document.getElementById('tabEmblemsComp');
    const panel = document.getElementById('ecPanel');
    if (tabBtn) tabBtn.classList.toggle('active', tab === 'emblemscomp');
    if (panel) panel.classList.toggle('visible', tab === 'emblemscomp');
    if (tab === 'emblemscomp') {
        // Build the shared hits domain first (same as the Dmg Calc / Effect
        // Impact tabs) so the shared filters and right sidebar are live.
        if (typeof dcApplyFilters === 'function') dcFiltered = dcApplyFilters();
        if (typeof fcDirtyHits !== 'undefined') fcDirtyHits = false;
        if (typeof renderEffectsPanel === 'function') renderEffectsPanel();
        if (typeof dcRenderTotals === 'function') dcRenderTotals();
        if (typeof eiRenderSidebarChips === 'function') eiRenderSidebarChips();
        ecRender();
    }
    _ecOrigSwitchTab(tab);
};
