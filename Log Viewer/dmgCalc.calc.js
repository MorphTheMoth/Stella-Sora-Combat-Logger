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
// Resolved by name from the enum dump table (tableResolver.js
// EFFECT_TYPE_NAMES, mirroring docs/Enums.md) so the ids can never drift from
// the game's effectType enum — e.g. 54 is HITTED_ADDITIONAL_ELEMENTTYPE_ATTR_FIX
// while ELEMENTTYPE_ATTR_PERCENT_FIX is 56.
const EFFECT_ID_BY_NAME = {};
for (const [id, name] of Object.entries(EFFECT_TYPE_NAMES)) EFFECT_ID_BY_NAME[name] = Number(id);
const ATTR_FIX = EFFECT_ID_BY_NAME.ATTR_FIX;
const PLAYER_ATTR_FIX = EFFECT_ID_BY_NAME.PLAYER_ATTR_FIX;
const HITTED_ADDITIONAL_ATTR_FIX = EFFECT_ID_BY_NAME.HITTED_ADDITIONAL_ATTR_FIX;
const ELEMENTTYPE_ATTR_FIX = EFFECT_ID_BY_NAME.ELEMENTTYPE_ATTR_FIX;
const ELEMENTTYPE_ATTR_PERCENT_FIX = EFFECT_ID_BY_NAME.ELEMENTTYPE_ATTR_PERCENT_FIX;
// ATTR_FIX-family effectTypes: their subType is 1=Base / 2=Pct / 3=Abs.
const ATTR_FAMILY_TYPES = new Set([ATTR_FIX, HITTED_ADDITIONAL_ATTR_FIX, PLAYER_ATTR_FIX]);

// True when an effect/hit source string belongs to the Potentials family
// (buildHitTable names these "<char> Potentials"; the collector's synthetic
// groups use source "Potentials").
function dcIsPotentialsSource(src) {
    return typeof src === 'string' && src.includes('Potentials');
}
// ── Emblem-pot-driven level overrides ────────────────────────────────────────
// ─── Potential level table ────────────────────────────────────────────────────
// Single source of truth for every potential-related level:
//   effective level = recordLv (record) + bonus (emblem) + change (user ±),
// clamped to [0, 9]. Effect entries carry a "level source" (the id of the
// potential they belong to, resolved from Effect.json's LevelData link via
// dcFamilyPot); their values are live-resolved from that potential's
// EffectValue ladder at calc time — so changing a potential's level moves
// ALL of its effects together, on both attacker and defender sides.
const dcPotLevels = new Map();   // potId -> { potId, charId, recordLv, bonus, change, potKey }
const dcEffectPot = new Map();   // effect configId -> potential id (exact level source)
// Skill-scaled effect/once-attr configIds (levelTypeData 3): configId → slot
// (the config's LevelData ActionKey). Raw battle entries don't carry the
// levelType stamp, so this map (filled from the levelMap + collection)
// resolves the slot for them.
const dcSkillScaled = new Map();

// Rebuild the level table from the active record (Origin event). User changes
// survive rebuilds; rows the record doesn't list are dropped (lazy-recreated
// from logged entries when the ± buttons touch them).
function dcRebuildPotLevels() {
    const prev = new Map(dcPotLevels);
    dcPotLevels.clear();
    if (typeof effectIdPot !== 'undefined') {
        for (const [eid, potId] of effectIdPot) dcEffectPot.set(eid, potId);
    }
    const rec = (typeof getOriginRecord === 'function') ? getOriginRecord() : null;
    for (const ch of (rec?.chars || [])) {
        for (const p of (ch.pots || [])) {
            const potId = Number(p[0]);
            if (!potId || dcPotLevels.has(potId)) continue;
            const recordLv = Number(p[1]) || 0;
            const eff = Number(p[2]) || recordLv;
            const old = prev.get(potId);
            dcPotLevels.set(potId, {
                potId,
                charId: Number(ch.charId) || null,
                recordLv,
                bonus: Math.max(eff - recordLv, 0),   // emblem bonus (record's effective − record)
                change: old ? (old.change || 0) : 0,
            });
        }
    }
    // Logs without a record log: resurrect the synthetic entries created by
    // the lazy record reconstruction (dcEnsurePotLevel) — the record loop
    // only repopulates keys the real record carries, and dropping the rest
    // would destroy the user's pending ± changes on every collection.
    for (const [potId, old] of prev) {
        if (!dcPotLevels.has(potId)) dcPotLevels.set(potId, old);
    }
}

// Effective level of a potential: record + bonus + user change, clamped 0..9.
// When the potential's emblem pot row is disabled (its key in `disabledSet`)
// the emblem bonus is subtracted from the formula; the change field is not
// touched.
function dcPotEffectiveLevel(st, disabledSet) {
    const dis = disabledSet ?? dcEffectsDisabled;
    const bonus = (st.potKey && dis.has(st.potKey)) ? 0 : st.bonus;
    return Math.min(Math.max(st.recordLv + bonus + (st.change || 0), 0), 9);
}

// Bridge for record.js (separate scope): per-potential level breakdown.
window.dcPotLevelInfo = function (potId) {
    const st = dcPotLevels.get(Number(potId));
    return st ? { recordLv: st.recordLv, bonus: st.bonus, change: st.change || 0 } : null;
};

// ── Lazy record reconstruction (logs without a record log) ────────────────
// Old logs carry no Origin event, so the level tables start empty and the ±
// buttons have nothing to step. The first time a row whose level scales with
// a potential / skill slot is parsed, synthesize its level-table entry with
// the row's logged level as Record Lv (no bonus rows). Real record data
// always wins — dcRebuild* runs before collection and existing entries are
// kept as-is.
function dcEnsurePotLevel(potId, loggedL, charId) {
    if (potId == null) return null;
    let st = dcPotLevels.get(potId);
    if (!st && loggedL > 0) {
        st = { potId, charId: charId ?? null, recordLv: loggedL, bonus: 0, change: 0 };
        dcPotLevels.set(potId, st);
    }
    return st ?? null;
}

function dcEnsureSkillLevel(charId, slot, loggedL) {
    if (charId == null || slot == null) return null;
    const key = `${charId}:${slot}`;
    let st = dcSkillLevels.get(key);
    if (!st && loggedL > 0) {
        st = {
            charId, slot,
            charName: (typeof resolveActorKey === 'function') ? resolveActorKey('p:' + charId) : String(charId),
            recordLv: loggedL,
            bonusByRow: [],
            maxLv: 0,   // unknown → dcSkillMaxLevel falls back to the sim cap
            change: 0,
        };
        dcSkillLevels.set(key, st);
    }
    return st ?? null;
}

// Full reset of the dmg-calc simulation state — called on log swap / clear:
// level tables, disabled rows, and per-entry level overrides belong to the
// opened log and must not leak into another one (dcRebuild* repopulates the
// tables from the new log's record, if it has one).
window.dcResetSimState = function () {
    dcPotLevels.clear();
    dcSkillLevels.clear();
    if (typeof dcEffectsDisabled !== 'undefined') dcEffectsDisabled.clear();
    if (typeof dcEffectLevelOverrides !== 'undefined') dcEffectLevelOverrides.clear();
    // Drop cached per-hit calc results (defined in dmgCalc.ui.js).
    if (typeof dcBumpCalcVersion === 'function') dcBumpCalcVersion();
};

// Synthetic record for logs without a record log — shaped like an Origin
// event's record so record.js can render it with the same per-character pot
// / skill tables. Sources: the effect collection (potential / skill-scaled
// rows) and the hits (levelTypeData 1/3), run through the lazy
// reconstruction so the tables are populated even if the dmg-calc tab has
// never been opened. Real record data takes precedence (record.js only
// falls back to this when no Origin event exists).
window.dcSyntheticRecord = function () {
    if (typeof dcCollectAttrFixEffects === 'function' && typeof dcFiltered !== 'undefined') {
        try {
            for (const ef of dcCollectAttrFixEffects(dcFiltered)) {
                if (ef.configId == null) continue;
                const lo0 = ef.configId - (ef.configId % 1000);
                if (ef.levelSource != null && ef.valueConfigId != null && ef.valueConfigId > lo0) {
                    dcEnsurePotLevel(ef.levelSource,
                        Math.floor(((ef.valueConfigId - lo0) % 100) / 10), ef._charId);
                }
                if (ef.levelTypeData === 3 && ef.valueConfigId != null && ef.valueConfigId > ef.configId) {
                    const cid = ef.fromAttrDict ? (ef._charId ?? null)
                        : (dcEffectOwnerCharId(ef.configId) ?? ef._charId);
                    if (cid != null) {
                        dcEnsureSkillLevel(cid,
                            dcSkillSlotFor(ef.levelData, null, dcAttackerRoleSlot(cid)),
                            Math.round((ef.valueConfigId - ef.configId) / 10));
                    }
                }
            }
            for (const ev of dcFiltered) {
                const hc = ev.HitConfig;
                if (!hc || (hc.levelTypeData !== 1 && hc.levelTypeData !== 3)) continue;
                const loggedL = ev.DamageParams?.skillLevel;
                if (!(loggedL > 0)) continue;
                const cid = dcEventCharId(ev);
                if (hc.levelTypeData === 3) {
                    if (cid != null) {
                        dcEnsureSkillLevel(cid, dcSkillSlotFor(hc.levelData, hc.mainOrSupport), loggedL);
                    }
                } else if (hc.levelData != null) {
                    dcEnsurePotLevel(hc.levelData, loggedL, cid);
                }
            }
        } catch (e) { /* collection needs a loaded log — ignore */ }
    }
    if (!dcPotLevels.size && !dcSkillLevels.size) return null;
    const chars = new Map();   // "charId" -> { charId, pots: [], skills: [] }
    const charFor = (cid) => {
        const key = String(cid == null ? 0 : cid);
        let ch = chars.get(key);
        if (!ch) {
            ch = { charId: cid == null ? 0 : Number(cid), pots: [], skills: [] };
            chars.set(key, ch);
        }
        return ch;
    };
    for (const st of dcPotLevels.values()) {
        charFor(st.charId).pots.push([st.potId, st.recordLv, st.recordLv + (st.bonus || 0), 9]);
    }
    for (const st of dcSkillLevels.values()) {
        charFor(st.charId).skills.push([st.slot, st.recordLv, st.recordLv, 0]);
    }
    return { synthetic: true, team: [...chars.keys()].map(Number), chars: [...chars.values()] };
};

// e: raw effect entry or collected row (configId, valueConfigId)
// Level override resolution, by level source:
//   1. explicit user override (dcEffectLevelOverrides)
//   2. skill-scaled (levelTypeData 3, slot = the config's LevelData ActionKey):
//      value id = configId + skillLevel*10 where skillLevel is the owner's
//      skill-slot level (CommonHelper_GetValueConfigIdByLevelType,
//      decompiled.c:3616319 → GetLevelByLevelType → PlayerSkillCd_GetSkillLevel);
//      the effective level comes from the owning character's skill-level table
//   3. potential-scaled: ladder ids "<gid><P><L><V>" (L = level, V = build
//      variant, P = family's hundreds digit); the logged level decodes from
//      the entry's valueConfigId, the effective level from the potential's
//      level table.
// Returns null when the effective level coincides with the logged one.
function dcGetLevelOverride(e, side, disabledSet, charId, fromAttrDict) {
    const key = `${side}:${e.configId}:${e.valueConfigId ?? ''}`;
    const user = dcEffectLevelOverrides.get(key);
    if (user) return user;
    if (e.configId == null) return null;

    // Value table for this row kind (once-attr rows resolve in
    // OnceAdditionalAttributeValue, everything else in EffectValue).
    const isAttr = fromAttrDict ?? e.fromAttrDict ?? false;
    const vtab = isAttr ? onceAttrValueTable : effectValueTable;
    // Pull (attrType, subType, value) out of a value-table row (once-attr rows
    // hold up to 3 slots keyed by slotNum).
    const readVal = (vcId) => {
        const sv = vtab.get(vcId);
        if (!sv) return null;
        if (isAttr) {
            const slots = Array.isArray(sv) ? sv : [];
            const slot = slots.find(s => (s.slotNum ?? 1) === (e.slotNum ?? 0)) ?? slots[0];
            return slot && slot.value != null ? slot : null;
        }
        return sv.value != null ? sv : null;
    };

    // ── Skill-scaled rows (Effect/OnceAttr levelTypeData 3) ────────────────
    const rawSlot = (e.levelTypeData === 3) ? e.levelData : dcSkillScaled.get(e.configId);
    if (rawSlot != null) {
        // The game resolves the effect's value id ONCE at creation with the
        // ORIGIN actor's skill dict (ActorEffectManage_AddEffect,
        // decompiled.c:3433232 → GetValueConfigIdByLevelType(fromActor,…))
        // and copies carry the resolved id — so the level source is the
        // effect's OWNER (id-prefix char), not each hit's attacker. Once-attr
        // dict rows resolve per-holder instead (AddAttr_1 uses the receiving
        // actor, decompiled.c:3421955).
        const cid = isAttr ? (charId ?? e._charId)
            : (dcEffectOwnerCharId(e.configId) ?? charId ?? e._charId);
        if (cid == null || e.valueConfigId == null || e.valueConfigId <= e.configId) return null;
        // The slot-2 dict is role-adjusted at battle setup (main char → main
        // skill, support → support skill) — resolve by the OWNER's deployment
        // role. (The config's own MainOrSupport field is the Lua display path's
        // disambiguator, QueryLevelInfo lua:1596; combat ignores it.)
        const skillSlot = dcSkillSlotFor(rawSlot, null, dcAttackerRoleSlot(cid));
        const curL = Math.round((e.valueConfigId - e.configId) / 10);
        // Lazy record reconstruction: old logs without a record log have no
        // entry for this slot — synthesize one with the logged level as
        // Record Lv so the ± buttons have a base to step from.
        const st = dcEnsureSkillLevel(cid, skillSlot, curL);
        if (!st) return null;
        const L = dcSkillEffectiveLevel(st, disabledSet);
        if (L === curL || L <= 0) return null;
        const newVcId = e.configId + L * 10;
        const sv = readVal(newVcId);
        if (!sv) return null;                        // ladder row missing → keep logged
        const stCur = readVal(e.valueConfigId);
        return {
            newValueConfigId: newVcId,
            newValue: sv.value,
            newAttrType: stCur?.attrType ?? e.attrType,
            newSubType: stCur?.subType ?? e.subType,
        };
    }

    // ── Potential-scaled rows ────────────────────────────────────────────
    // Level source: stamped on collected rows; raw battle entries resolve
    // through the family map.
    const potId = e.levelSource != null ? e.levelSource
        : dcEffectPot.get(e.configId);
    if (potId == null) return null;
    const lo = e.configId - (e.configId % 1000);
    if (e.valueConfigId == null || e.valueConfigId <= lo) return null;
    const rel = e.valueConfigId - lo;
    const curL = Math.floor((rel % 100) / 10), V = rel % 10, P = Math.floor(rel / 100);
    const st = dcEnsurePotLevel(potId, curL, e._charId);   // lazy record reconstruction
    const L = st ? dcPotEffectiveLevel(st, disabledSet) : curL;   // no record row → logged level
    if (L === curL) return null;
    let toV = 0, newVcId = 0;
    if (L > 0) {
        newVcId = lo + P * 100 + L * 10 + V;
        // Read through readVal, not effectValueTable directly: once-attr rows
        // (OnceAdditionalAttribute LevelData → potential, e.g. Field Pull
        // 13725001 → 513725) resolve their ladder in
        // OnceAdditionalAttributeValue — a direct effectValueTable lookup
        // always misses → null override → the level indicator and value stay
        // at the logged level no matter the ± buttons.
        const sv = readVal(newVcId);
        if (!sv || sv.value == null) return null;     // ladder row missing → keep logged
        toV = sv.value;
    }
    const stCur = readVal(e.valueConfigId);
    return {
        newValueConfigId: newVcId,
        newValue: toV,
        newAttrType: stCur?.attrType ?? e.attrType,
        newSubType: stCur?.subType ?? e.subType,
    };
}

// ─── Skill level table ──────────────────────────────────────────────────
// Single source of truth for every skill-slot level (levelTypeData-3 hits
// and effects resolve into these via dcSkillSlotFor):
//   effective level = recordLv (record) + bonus (emblem/talent adds) + change
//   (user ±), clamped to [1, maxLv] for resolution (level 0 → logged value).
// The bonus mirrors the emblem-pot pattern: it is decomposed per emblem row
// (each gem's skill affix), and disabling that emblem's row in the sidebar
// drops its levels from the effective level. Any residual the record's
// effective level carries beyond the emblem rows (talent adds) is kept as a
// non-disableable null-key row so the record total still reproduces.
// Key: "<charId>:<skillSlotType>" (slotType = ActionKey: 2=Main, 3=Support,
// 4=Ultimate, 5=Normal — GAME_ENUM_DEFINE.lua:218).
const dcSkillLevels = new Map();   // "charId:slot" -> { charId, slot, charName, recordLv, bonusByRow, change, maxLv }

// Synthetic row key for an emblem skill affix — MUST stay in sync with
// buildRecordEmblemEffects (tableResolver.js): configId 950000000 + teamIdx
// *100000 + gemIdx*100 + gemSlot, collected under side 'attacker',
// valueConfigId 0. gemSlot is the gem-affix slot index 1..4 (GEM_SKILL_SLOT_NAMES).
function dcEmblemSkillRowKey(origin, charId, gemIdx, gemSlot) {
    const ci = (origin.team || []).indexOf(Number(charId));
    if (ci < 0) return null;
    return `attacker:${950000000 + ci * 100000 + gemIdx * 100 + Number(gemSlot)}:0`;
}

// Gem-affix slot (1..4, as recorded in tbSkillAffix / GEM_SKILL_SLOT_NAMES)
// → skillSlotType / ActionKey (2=Main, 3=Support, 4=Ultimate, 5=Normal).
// Same 1..4 order as GetSkillIds / the DLL collector's slotFor table.
const GEM_SLOT_TO_ACTION = { 1: 5, 2: 2, 3: 3, 4: 4 };

function dcRebuildSkillLevels() {
    const prev = new Map(dcSkillLevels);
    dcSkillLevels.clear();
    dcSkillScaled.clear();
    // Skill-scaled configs straight from the levelMap (levelTypeData 3, either
    // Effect or OnceAdditionalAttribute rows): configId → slot (LevelData
    // ActionKey). Fills before collection stamps raw battle entries, so the
    // calc paths resolve skill-scaled rows regardless of call order.
    if (typeof levelMap !== 'undefined') {
        for (const [id, e] of levelMap) {
            if (e && e.t !== 'hit' && e.lt === 3) dcSkillScaled.set(id, e.ld);
        }
    }
    const rec = (typeof getOriginRecord === 'function') ? getOriginRecord() : null;
    for (const ch of (rec?.chars || [])) {
        const charId = Number(ch.charId) || null;
        if (charId == null) continue;
        const charName = (typeof resolveActorKey === 'function') ? resolveActorKey('p:' + charId) : String(charId);
        for (const s of (ch.skills || [])) {
            const slot = Number(s[0]);
            if (!slot) continue;
            const recordLv = Number(s[1]) || 0;
            const eff = Number(s[2]) || recordLv;
            const maxLv = Number(s[3]) || 0;
            const key = `${charId}:${slot}`;
            // Per-emblem bonus rows: each gem's skill affix [slot, +levels]
            // gets its own disableable entry (same rows the sidebar shows as
            // "<emblem> : <slot> +N lv" display-only rows).
            const bonusByRow = [];
            let gemSum = 0;
            (ch.gems || []).forEach((g, gi) => {
                for (const sk of (g.skills || [])) {
                    // gem affix slots are 1..4 → map to the record's ActionKey slots
                    const gemSlot = Number(sk[0]);
                    if ((GEM_SLOT_TO_ACTION[gemSlot] ?? gemSlot) !== slot) continue;
                    const add = Number(sk[1]) || 0;
                    if (!add) continue;
                    const rowKey = rec && dcEmblemSkillRowKey(rec, charId, gi, gemSlot);
                    bonusByRow.push([rowKey, add]);
                    gemSum += add;
                }
            });
            // Residual = record's effective − record − emblem adds (talent /
            // equipment adds): not tied to an emblem row → always on.
            const residual = (eff - recordLv) - gemSum;
            if (residual > 0) bonusByRow.push([null, residual]);
            const old = prev.get(key);
            dcSkillLevels.set(key, {
                charId,
                slot,
                charName,
                recordLv,
                bonusByRow,
                maxLv,
                change: old ? (old.change || 0) : 0,
            });
        }
    }
    // Logs without a record log: resurrect the synthetic entries created by
    // the lazy record reconstruction (dcEnsureSkillLevel) — same rationale as
    // dcRebuildPotLevels above.
    for (const [key, old] of prev) {
        if (!dcSkillLevels.has(key)) dcSkillLevels.set(key, old);
    }
}

// Sum of the emblem/talent bonus rows not disabled in the sidebar.
function dcSkillRowBonus(st, disabledSet) {
    const dis = disabledSet ?? dcEffectsDisabled;
    let bonus = 0;
    for (const [rowKey, lv] of (st.bonusByRow || [])) {
        if (rowKey != null && dis && dis.has(rowKey)) continue;
        bonus += lv;
    }
    return bonus;
}

// Absolute simulation cap: the per-level ladders carry 13 entries (e.g.
// Bouquet Blast 133320001 has sp[13]), so levels up to 13 always resolve.
const DC_SKILL_LEVEL_CAP = 13;

// Level cap: the collector's maxLv is the *currently reachable* max
// (GetCharSkillMaxLevel) — emblem/talent affix adds extend it, and the
// ladder domain always allows up to DC_SKILL_LEVEL_CAP, so floor the cap
// there (that's what the ± buttons can reach for what-if simulation).
function dcSkillMaxLevel(st, disabledSet) {
    const base = st.maxLv > 0 ? st.maxLv : 99;
    return Math.max(base + dcSkillRowBonus(st, disabledSet), DC_SKILL_LEVEL_CAP);
}

// Effective skill level: record + enabled bonus + user change, clamped to the
// extended cap (base max + enabled bonus).
function dcSkillEffectiveLevel(st, disabledSet) {
    return Math.min(Math.max(st.recordLv + dcSkillRowBonus(st, disabledSet) + (st.change || 0), 0), dcSkillMaxLevel(st, disabledSet));
}

// Which tracked skill-slot state does a levelTypeData-3 config scale with?
// ActionKey 2 (B) is a SHARED slot: the caster's slot dict is role-adjusted
// at battle setup — PlayerCharData:CalCharacterAttrBattle (lua:1704) removes
// the unused skill from the level array (main char drops support, support
// char drops main) and boot binds slot B to the survivor
// (decompiled.c:4497189: Normal←v[0], B←v[1], D←v[2]; C never bound) — and
// the Lua level query disambiguates via the config's MainOrSupport flag
// (PlayerCharData.lua:1596: levelData==2 → SUPPORT ? skill[3] : skill[2]).
// 4 = ultimate, 5 and anything else (incl. 1/3) = normal attack level
// (PlayerCharData.lua:1611 fallback).
// mainOrSupport: hit configs carry it (1=MAINCONTROL, 2=SUPPORT, 0 → main);
// effect configs don't — pass roleSlot instead (the attacker's deployment
// role: 2 = record team[0] main char, 3 = support, null → main default).
function dcSkillSlotFor(levelData, mainOrSupport, roleSlot) {
    if (levelData === 4) return 4;
    if (levelData === 2) {
        if (mainOrSupport != null) return mainOrSupport === 2 ? 3 : 2;
        return roleSlot ?? 2;
    }
    return 5;
}

// Owner character of an effect — effect ids encode the owning char in their
// first three digits (e.g. 16093001 → 160 Suntide Willow; holds for all 22
// levelTypeData-3 rows in Effect.json).
function dcEffectOwnerCharId(configId) {
    const n = parseInt(String(configId ?? '').slice(0, 3), 10);
    return n > 0 ? n : null;
}

// Deployment role of a character in the active record: 2 = main char
// (team[0]), 3 = support, null = unknown/not in record.
function dcAttackerRoleSlot(charId) {
    if (charId == null) return null;
    const rec = (typeof getOriginRecord === 'function') ? getOriginRecord() : null;
    if (!rec?.team?.length) return null;
    const idx = rec.team.map(Number).indexOf(Number(charId));
    if (idx === 0) return 2;
    if (idx > 0) return 3;
    return null;
}

// Effective level the game would use for a hit scaling by hitConfig
// levelTypeData/levelData — 3 = skill slot (skill-level table), 1 = perk
// (the potential's level table). Returns null when untracked/unchanged.
function dcHitScalingLevel(hc, charId, disabledSet) {
    if (!hc) return null;
    if (hc.levelTypeData === 3) {
        if (charId == null) return null;
        const slot = dcSkillSlotFor(hc.levelData, hc.mainOrSupport);
        const st = dcSkillLevels.get(`${charId}:${slot}`);
        return st ? dcSkillEffectiveLevel(st, disabledSet) : null;
    }
    if (hc.levelTypeData === 1) {
        const st = dcPotLevels.get(hc.levelData);
        return st ? dcPotEffectiveLevel(st, disabledSet) : null;
    }
    return null;
}

// Attacker charId of a hit event ("p:<dataId>").
function dcEventCharId(ev) {
    const m = String(ev?.Attacker || '').match(/^p:(\d+)/);
    return m ? Number(m[1]) : null;
}

// Bridges for record.js (separate scope): per-skill level breakdown.
window.dcSkillLevelInfo = function (charId, slot) {
    const st = dcSkillLevels.get(`${Number(charId)}:${Number(slot)}`);
    if (!st) return null;
    let bonusTotal = 0;
    for (const [, lv] of (st.bonusByRow || [])) bonusTotal += lv;
    return {
        recordLv: st.recordLv,
        bonus: bonusTotal,
        change: st.change || 0,
        // extended cap: base max + total adds (emblem + talent)
        max: st.maxLv > 0 ? st.maxLv + bonusTotal : 99,
    };
};

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
    const s = attrs[id];
    if (!s) return 0;
    return ((s.origin || 0) + (s.base || 0)) * (1 + (s.pct || 0)) + (s.abs || 0);
}

function statBase(attrs, id) {
    const s = attrs[id];
    if (!s) return 0;
    return (s.origin || 0) + (s.base || 0);
}

function statAbs(attrs, id) {
    const s = attrs[id];
    if (!s) return 0;
    return s.abs || 0;
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
// Fallback level resolution: when the levelMap entry is missing or stale (its
// valueConfigId list doesn't contain the hit's actual valueConfigId), derive the
// level candidates directly from the value tables using the game's
// "configId + level*10" valueConfigId scheme. Returns { vc, curIdx } or null.
function deriveLevelCandidates(configId, valueConfigId, fromAttrDict) {
    if (configId == null || configId <= 0 || valueConfigId == null) return null;
    const table = fromAttrDict ? onceAttrValueTable : effectValueTable;
    const vc = [];
    let anyFound = false;
    for (let lvl = 0; lvl <= 50; lvl++) {
        const vid = configId + lvl * 10;
        if (table.has(vid)) { anyFound = true; vc.push({ level: lvl, valueConfigId: vid }); }
        else if (anyFound) break;
    }
    if (vc.length < 2) return null;
    const curIdx = vc.findIndex(v => v.valueConfigId === valueConfigId);
    if (curIdx < 0) return null;
    return { vc, curIdx };
}

// Collect unique effects across all filtered hits.
// Returns an array of { key, side, configId, valueConfigId, name, attrType, subType, value, count, source, fromAttrDict }
function dcCollectAttrFixEffects(dcFiltered) {
    const seen = new Map(); // key -> entry
    dcRebuildPotLevels();   // rebuild the potential level table from the record
    dcRebuildSkillLevels(); // rebuild the skill level table from the record
    for (const ev of dcFiltered) {
        const evCharId = dcEventCharId(ev);   // attacker charId (skill-level owner)
        const sides = [
            { side: 'attacker', list: ev.AttackerEffects?.effects, attrDict: ev.AttackerAttrDict },
            { side: 'attacker', list: ev.AttackerRecord?.effects, attrDict: null },
            { side: 'defender', list: ev.DefenderEffects?.effects, attrDict: ev.DefenderAttrDict },
        ];
        for (const { side, list, attrDict } of sides) {
            // ── effects list ──────────────────────────────────────────
            if (list?.length) {
                const countMap = new Map();
                for (const e of list) {
                    // record display/pot rows (effectType null) are admitted so
                    // they render as shortcut rows in the panel
                    if (!allowedEffectTypes.includes(e.effectType) && !e.isRecordEffect) continue;
                    const id = e.configId;
                    countMap.set(id, (countMap.get(id) || 0) + 1);
                }
                const seenInHit = new Set();
                for (const e of list) {
                    if (!allowedEffectTypes.includes(e.effectType) && !e.isRecordEffect) continue;
                    if (seenInHit.has(e.configId)) continue;
                    seenInHit.add(e.configId);
                    const key = `${side}:${e.configId}:${e.valueConfigId ?? ''}`;
                    if (!seen.has(key)) {
                        const lm = resolveLevelMap(e.configId);
                        // Skill-scaled effect (levelTypeData 3): register the
                        // configId → slot link so raw battle entries resolve too.
                        if (lm.levelTypeData === 3) dcSkillScaled.set(e.configId, lm.levelData);
                        // Record rows (emblem pots) carry their own level ladder
                        // (the potential's marginal levels) — keep it as-is.
                        let allVcIds = (e.allValueConfigIds && e.allValueConfigIds.length)
                            ? e.allValueConfigIds : lm.allValueConfigIds;
                        let curIdx = allVcIds.findIndex(v => v.valueConfigId === e.valueConfigId);
                        if (curIdx < 0 && !(e.allValueConfigIds && e.allValueConfigIds.length)) {
                            const derived = deriveLevelCandidates(e.configId, e.valueConfigId, false);
                            if (derived) { allVcIds = derived.vc; curIdx = derived.curIdx; }
                        }
                        // Level source: the potential this effect belongs to,
                        // by exact effect id (pot rows carry linkPotential.potId).
                        const levelSource = e.isPotRow
                            ? (e.linkPotential?.potId ?? null)
                            : (dcEffectPot.get(e.configId) ?? null);
                        // The pot row's key drives the bonus term of the level
                        // formula (disabled row → emblem bonus excluded).
                        if (e.isPotRow && levelSource != null) {
                            const stL = dcPotLevels.get(levelSource);
                            if (stL) stL.potKey = key;
                        }
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
                            effectType: e.effectType,
                            fromOwnerSnapshot: !!e.fromOwnerSnapshot,
                            baseStatOnSnapshot: e.baseStatOnSnapshot,
                            pctStatOnSnapshot: e.pctStatOnSnapshot,
                            allValueConfigIds: allVcIds,
                            levelTypeData: lm.levelTypeData,
                            levelData: lm.levelData,
                            currentLevelIdx: curIdx >= 0 ? curIdx : -1,
                            // record rows: keep their identity so EI labels them
                            // Origin and the pot shortcuts stay intact
                            isRecordEffect: !!e.isRecordEffect,
                            isPotRow: !!e.isPotRow,
                            linkPotential: e.linkPotential,
                            levelSource,
                            _gemLevel: e._gemLevel ?? null,
                            _skillAddLv: e._skillAddLv ?? null,
                            // owning character (attacker) — drives skill-scaled
                            // (levelTypeData 3) level resolution for this row.
                            // Record rows keep their own _charId (emblem rows are
                            // always attached to their owner's hits, but be safe).
                            _charId: e._charId ?? (side === 'attacker' ? evCharId : null),
                            displayOnly: !!e.displayOnly
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
                    const key = `${side}:dict:${cid}:${vcid}:${e.slotNum ?? 0}`;
                    if (seenInHit.has(key)) continue;
                    seenInHit.add(key);
                    const stacks = e.stacks != null ? e.stacks : 1;
                    if (!seen.has(key)) {
                        const lm = resolveLevelMap(cid);
                        if (lm.levelTypeData === 3) dcSkillScaled.set(cid, lm.levelData);
                        let allVcIds = lm.allValueConfigIds;
                        let curIdx = allVcIds.findIndex(v => v.valueConfigId === e.valueConfigId);
                        if (curIdx < 0) {
                            const derived = deriveLevelCandidates(cid, e.valueConfigId, true);
                            if (derived) { allVcIds = derived.vc; curIdx = derived.curIdx; }
                        }
                        // Drop level candidates whose value-table slot has a different
                        // attrType than this row. Cross-family disc progressions
                        // (e.g. attrId 4059111 → value 4059121 Normal/Skill Dmg, with
                        // candidate 4059131 = Skill Crit Dmg) resolve by the game's
                        // baseId + skillLevel*10 walk, but in-game leveling swaps the
                        // attrId instead — so a stat change via level buttons is never
                        // meaningful. Fewer than 2 candidates remain → no level buttons.
                        if (e.attrType != null && allVcIds.length) {
                            allVcIds = allVcIds.filter(v => {
                                const slots = onceAttrValueTable.get(v.valueConfigId);
                                if (!slots || !slots.length) return true; // unknown value id — keep
                                const slot = slots.find(s => (s.slotNum ?? 1) === (e.slotNum ?? 0)) ?? slots[0];
                                return slot.attrType === e.attrType;
                            });
                            curIdx = allVcIds.findIndex(v => v.valueConfigId === e.valueConfigId);
                        }
                        seen.set(key, {
                            key, side,
                            configId: cid,
                            valueConfigId: vcid || null,
                            slotNum: e.slotNum ?? 0,
                            name: e.name || String(cid),
                            attrType: e.attrType,
                            subType: e.subType,
                            value: e.value,
                            count: stacks,
                            source: e.source ?? 'Unknown',
                            fromAttrDict: true,
                            effectType: e.effectType,
                            allValueConfigIds: allVcIds,
                            levelTypeData: lm.levelTypeData,
                            levelData: lm.levelData,
                            currentLevelIdx: curIdx >= 0 ? curIdx : -1,
                            // Level source for once-attr rows (Effect.json's
                            // LevelData link, same as effect-list rows) — lets
                            // dcChangeEffectLevel route the ± buttons into the
                            // potential's level table instead of a per-entry
                            // override that dcGetLevelOverride can't find.
                            levelSource: dcEffectPot.get(cid) ?? null,
                            _charId: e._charId ?? (side === 'attacker' ? evCharId : null)
                        });
                    } else if (stacks > seen.get(key).count) {
                        seen.get(key).count = stacks;
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
        if (!dcIsPotentialsSource(src)) continue;
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

// ─── Effect value application (shared by all override paths) ────────────────
// Apply one effect's value contribution to a stat map keyed by attr id
// (sign: +1 adds the contribution, -1 removes it).
// eff descriptor (a raw effect entry or an override-adjusted one):
//   attrType / subType / effectType — which stat and how it applies
//   isRecord    — record rows are Origin-domain flat values → base goes to `origin`
//   bySubType   — apply by subType unconditionally, skipping the effectType
//                 family checks (attrDict rows whose effectType may be null)
//   allowUnknown — element-typed rows still match by element, everything else
//                 (incl. the ATTR_FIX family) falls through to the bySubType
//                 application (attrDict rows in the disable path)
// value is the contribution WITHOUT sign (e.g. e.value * count); when
// `overrideValue` is set it replaces it for the ATTR_FIX family only — the
// element-typed families (subType = element id) always use the logged value.
// Unknown effectTypes only apply through the bySubType fallback.
function dcApplyEffectValue(statMap, eff, value, sign, hitElementType, overrideValue) {
    const attrType = eff.attrType;
    if (attrType == null || value == null) return;
    let stat = statMap.get(attrType);
    if (!stat) { stat = { origin: 0, base: 0, pct: 0, abs: 0 }; statMap.set(attrType, stat); }
    const et = eff.effectType;
    const isRecord = eff.isRecord ?? eff.isRecordEffect;
    if (!eff.bySubType && !eff.allowUnknown && ATTR_FAMILY_TYPES.has(et)) {
        const v = overrideValue != null ? overrideValue : value;
        if (eff.subType === 1) { if (isRecord) stat.origin = (stat.origin || 0) + sign * v; else stat.base = (stat.base || 0) + sign * v; }
        else if (eff.subType === 2) stat.pct = (stat.pct || 0) + sign * v;
        else if (eff.subType === 3) stat.abs = (stat.abs || 0) + sign * v;
    } else if (!eff.bySubType && et === ELEMENTTYPE_ATTR_FIX) {
        if (hitElementType === eff.subType) stat.base = (stat.base || 0) + sign * value;
    } else if (!eff.bySubType && et === ELEMENTTYPE_ATTR_PERCENT_FIX) {
        if (hitElementType === eff.subType) stat.pct = (stat.pct || 0) + sign * value;
    } else if (eff.bySubType || eff.allowUnknown) {
        // attrDict entries and unknown effectTypes: apply by subType unconditionally
        if (eff.subType === 1) stat.base = (stat.base || 0) + sign * value;
        else if (eff.subType === 2) stat.pct = (stat.pct || 0) + sign * value;
        else if (eff.subType === 3) stat.abs = (stat.abs || 0) + sign * value;
    }
}

// ─── Effect overrides ─────────────────────────────────────────────────────────
// Apply disabled effects to a cloned copy of the stat arrays.
// dcEffectLevelOverrides: Map<key, {newValueConfigId,newValue,newAttrType,newSubType}>
// Returns { aStats, dStats } (clones with modifications applied).
function dcApplyEffectOverrides(ev, dcEffectsDisabled, dcEffectLevelOverrides) {
    const origA = ev.AttackerStats?.attrs || [];
    const origD = ev.DefenderStats?.attrs || [];
    // ── Disabled character ──────────────────────────────────────────────
    // Zero the whole hit (damage + effects) when its attacker is toggled off.
    const charName = ev.AttackerDisplay || ev.Attacker || '';
    if (charName && typeof dcCharsDisabled !== 'undefined' && dcCharsDisabled.has(charName)) {
        return { aStats: origA, dStats: origD, _potentialsDisabled: true };
    }
    if (dcEffectsDisabled.size === 0 && !(dcEffectLevelOverrides?.size) && dcPotLevels.size === 0 && dcSkillLevels.size === 0) return { aStats: origA, dStats: origD };

    // Attacker charId — owner of attacker-side skill-scaled effects
    const attackerCharId = dcEventCharId(ev);

    // ── Potentials group disable ──────────────────────────────────────────────
    // If this hit belongs to a disabled Potentials group, zero all its stats so
    // calcDamage produces 0 for this hit.
    const evSrc = ev.source ?? ev.HitConfig?.source ?? '';
    if (dcIsPotentialsSource(evSrc)) {
        const skillTitle = ev.HitConfig?.skillTitle ?? 'Unknown';
        if (dcEffectsDisabled.has(`potentials:${skillTitle}`)) {
            return { aStats: origA, dStats: origD, _potentialsDisabled: true };
        }
    }

    // Deep-clone only the stat entries we'll modify.
    // Use array index as key so {} entries don't collapse (s.id is undefined for {}).
    const aMap = new Map(origA.map((s, idx) => [idx, Object.assign({}, s)]));
    const dMap = new Map(origD.map((s, idx) => [idx, Object.assign({}, s)]));

    const sides = [
        { side: 'attacker', list: ev.AttackerEffects?.effects, attrDict: ev.AttackerAttrDict, statMap: aMap },
        { side: 'attacker', list: ev.AttackerRecord?.effects, attrDict: null, statMap: aMap },
        { side: 'defender', list: ev.DefenderEffects?.effects, attrDict: ev.DefenderAttrDict, statMap: dMap },
    ];
    for (const { side, list, attrDict, statMap } of sides) {
        // ── effects list ───────────────────────────────────────────────
        if (list?.length) {
            // ── Aggregate inherited snapshot effects ──────────────────
            // Inherited effects interact non-linearly: removing one pct effect
            // changes the base for the other effects. We must sum them first,
            // then apply a single delta per (attrType, B, P) group.
            const inheritedGroups = new Map(); // key -> { attrId, B, P, e_base, e_pct }
            const inheritedKeys = new Set();   // keys to skip in per-effect loop
            for (const e of list) {
                if (!allowedEffectTypes.includes(e.effectType)) continue;
                if (!e.fromOwnerSnapshot || e.baseStatOnSnapshot == null) continue;
                const key = `${side}:${e.configId}:${e.valueConfigId ?? ''}`;
                if (!dcEffectsDisabled.has(key)) continue;
                const attrId = e.attrType;
                if (attrId == null || e.value == null) continue;
                inheritedKeys.add(key);
                const groupKey = `${attrId}:${e.baseStatOnSnapshot}:${e.pctStatOnSnapshot ?? 0}`;
                let group = inheritedGroups.get(groupKey);
                if (!group) {
                    group = { attrId, B: e.baseStatOnSnapshot, P: e.pctStatOnSnapshot || 0, e_base: 0, e_pct: 0 };
                    inheritedGroups.set(groupKey, group);
                }
                // Use e.subType from tableResolver: 1=Base, 2=Pct
                if (e.subType === 1) group.e_base += e.value;
                else if (e.subType === 2) group.e_pct += e.value;
            }
            // Apply per-group delta: -(B * e_pct + e_base * (1 + P - e_pct))
            for (const [, group] of inheritedGroups) {
                const { attrId, B, P, e_base, e_pct } = group;
                const delta = -(B * e_pct + e_base * (1 + P - e_pct));
                let stat = statMap.get(attrId);
                if (!stat) { stat = { origin: 0, base: 0, pct: 0, abs: 0 }; statMap.set(attrId, stat); }
                stat.base = (stat.base || 0) + delta;
            }

            // ── Count non-inherited effects ────────────────────────────
            const countMap = new Map();
            for (const e of list) {
                if (!allowedEffectTypes.includes(e.effectType)) continue;
                if (e.fromOwnerSnapshot) continue;
                const key = `${side}:${e.configId}:${e.valueConfigId ?? ''}`;
                if (!dcEffectsDisabled.has(key)) continue;
                countMap.set(e.configId, (countMap.get(e.configId) || 0) + 1);
            }
            // ── Per-effect loop (non-inherited only) ───────────────────
            const seenInHit = new Set();
            for (const e of list) {
                if (!allowedEffectTypes.includes(e.effectType)) continue;
                if (e.fromOwnerSnapshot) continue;
                if (seenInHit.has(e.configId)) continue;
                seenInHit.add(e.configId);
                const key = `${side}:${e.configId}:${e.valueConfigId ?? ''}`;
                if (!dcEffectsDisabled.has(key)) continue;
                const attrId = e.attrType;
                if (attrId == null || e.value == null) continue;
                const count = countMap.get(e.configId) || 1;
                const lvlOv = dcGetLevelOverride(e, side, dcEffectsDisabled, attackerCharId);
                const disVal = lvlOv ? lvlOv.newValue : e.value;
                dcApplyEffectValue(statMap, e, e.value * count, -1, ev.HitConfig.elementType, disVal * count);
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
                const key = `${side}:dict:${cid}:${vcid}:${e.slotNum ?? 0}`;
                if (seenInHit.has(key)) continue;
                seenInHit.add(key);
                if (!dcEffectsDisabled.has(key)) continue;
                const stacks = e.stacks != null ? e.stacks : 1;
                dcApplyEffectValue(statMap, Object.assign({ allowUnknown: true }, e), e.value * stacks, -1, ev.HitConfig.elementType);
            }
        }
    }
    // ── Level overrides ──────────────────────────────────────────────
    // For effects with a level override (and not disabled), remove old
    // contribution and add the new level's contribution.
    if ((dcEffectLevelOverrides && dcEffectLevelOverrides.size > 0) || dcPotLevels.size > 0 || dcSkillLevels.size > 0) {
        for (const { side, list, attrDict, statMap } of sides) {
            // effects
            if (list?.length) {
                const countMap = new Map();
                for (const e of list) {
                    if (!allowedEffectTypes.includes(e.effectType)) continue;
                    countMap.set(e.configId, (countMap.get(e.configId) || 0) + 1);
                }
                const seenInHit = new Set();
                for (const e of list) {
                    if (!allowedEffectTypes.includes(e.effectType)) continue;
                    if (e.fromOwnerSnapshot) continue;
                    if (seenInHit.has(e.configId)) continue;
                    seenInHit.add(e.configId);
                    const key = `${side}:${e.configId}:${e.valueConfigId ?? ''}`;
                    if (dcEffectsDisabled.has(key)) continue;
                    const override = dcGetLevelOverride(e, side, dcEffectsDisabled, attackerCharId);
                    if (!override) continue;
                    const attrId = e.attrType;
                    if (attrId == null || e.value == null) continue;
                    const count = countMap.get(e.configId) || 1;

                    // Remove old contribution, add the new level's contribution
                    dcApplyEffectValue(statMap, e, e.value * count, -1, ev.HitConfig.elementType);
                    dcApplyEffectValue(statMap, {
                        attrType: override.newAttrType != null ? override.newAttrType : attrId,
                        subType: override.newSubType != null ? override.newSubType : e.subType,
                        effectType: e.effectType,
                        isRecord: e.isRecordEffect,
                    }, override.newValue * count, 1, ev.HitConfig.elementType);
                }
            }

            // attrDict
            if (Array.isArray(attrDict)) {
                const seenInHit = new Set();
                for (const e of attrDict) {
                    if (e.attrType == null || e.subType == null || e.value == null) continue;
                    const cid = e.configId ?? e.attrId;
                    if (cid == null) continue;
                    const vcid = e.valueConfigId ?? '';
                    const key = `${side}:dict:${cid}:${vcid}:${e.slotNum ?? 0}`;
                    if (seenInHit.has(key)) continue;
                    seenInHit.add(key);
                    if (dcEffectsDisabled.has(key)) continue;
                    const override = dcGetLevelOverride(e, side, dcEffectsDisabled, attackerCharId, true);
                    if (!override) continue;

                    const stacks = e.stacks != null ? e.stacks : 1;

                    // Remove old
                    dcApplyEffectValue(statMap, Object.assign({}, e, { bySubType: true }), e.value * stacks, -1, ev.HitConfig.elementType);

                    // Add new
                    dcApplyEffectValue(statMap, {
                        attrType: override.newAttrType != null ? override.newAttrType : e.attrType,
                        subType: override.newSubType != null ? override.newSubType : e.subType,
                        effectType: e.effectType,
                        bySubType: true,
                    }, override.newValue * stacks, 1, ev.HitConfig.elementType);
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
function calcHitFields(ev, statOverrides, dcEffectsDisabled, dcEffectLevelOverrides) {
    const hc  = ev.HitConfig   || {};
    const dp  = ev.DamageParams || {};
    const resolved = statOverrides || dcApplyEffectOverrides(ev, dcEffectsDisabled, dcEffectLevelOverrides);

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
    let multiplier = dp.skillPercentAmend != null ? dp.skillPercentAmend / 10000 / 100 : 0;

    // ── Hit level rescale ─────────────────────────────────────────────
    // Hits scale with a level the game resolves from levelTypeData/levelData:
    //   3 = skill slot (ActionKey 2/3/4/5 → the skill-level table)
    //   1 = perk (levelData = perkId → the potential's level table)
    // (AdventureActor skillLevelTemp, decompiled.c:3852930; the game then does
    // level-1 for types 1/2/3 before indexing — and DamageParams.skillLevel is
    // that raw level + 1, so sp[skillLevel - 1] reproduces the game's pick.)
    // When the tracked effective level differs from the logged one, re-pick
    // the multiplier from the hit's per-level array (levelMap "t":"hit"
    // entry written by WriteHitDamageLevelMapEntry). Missing entry (old logs)
    // → keep the logged value.
    {
        const charId = dcEventCharId(ev);
        const loggedL = dp.skillLevel;
        // Lazy record reconstruction (logs without a record log): the first
        // level-scaled hit parsed synthesizes its level-table entry with the
        // logged level as Record Lv (skill slot / perk potential).
        if (loggedL > 0 && hc.levelTypeData === 3 && charId != null) {
            dcEnsureSkillLevel(charId, dcSkillSlotFor(hc.levelData, hc.mainOrSupport), loggedL);
        } else if (loggedL > 0 && hc.levelTypeData === 1 && hc.levelData != null) {
            dcEnsurePotLevel(hc.levelData, loggedL, charId);
        }
        const L = dcHitScalingLevel(hc, charId, dcEffectsDisabled);
        if (L != null && loggedL != null && L !== loggedL) {
            if (L <= 0) {
                // level 0 = source disabled (perk/skill turned off) → no hit
                multiplier = 0;
            } else {
                const hm = (typeof resolveHitLevelMap === 'function') ? resolveHitLevelMap(hc.hitDamageId) : null;
                if (hm && hm.sp && hm.sp.length) {
                    const idx = Math.min(Math.max(L - 1, 0), hm.sp.length - 1);
                    const nv = hm.sp[idx];
                    if (nv != null) multiplier = nv / 10000 / 100;
                }
            }
        }
    }

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
    const defPenetrate = statValue(aStats, 9);   // DEF_Penetrate = index 9
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
    const skillIntensity  = statValue(aStats, 85) + 1;

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
    // Handle independent toggles for baseAtk / atkPct which are combined into atkMulti
    if (disabled.has('baseAtk') && disabled.has('atkPct')) {
        fields.atkMulti = 1;
    } else {
        const baseVal = disabled.has('baseAtk') ? 1 : (fields.baseAtk + (bonuses.baseAtk || 0));
        const pctVal  = disabled.has('atkPct')  ? 1 : (fields.atkPct  + (bonuses.atkPct  || 0));
        fields.atkMulti = baseVal * pctVal + fields.atkAbs;
    }

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

// Normal CDF (Abramowitz & Stegun approximation)
function _normalCdf(z) {
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const sign = z < 0 ? -1 : 1;
    const x = Math.abs(z) / 1.4142135623730951;
    const t = 1 / (1 + p * x);
    const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-x * x);
    return 0.5 * (1 + sign * y);
}

// Inverse normal CDF / quantile function (Acklam approximation)
function _normalQuantile(p) {
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    const c = [-0.007784894002430293, -0.3223964580412405, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    const pLow = 0.02425, pHigh = 1 - pLow;
    let z;
    if (p < pLow) {
        const q = Math.sqrt(-2 * Math.log(p));
        z = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else if (p <= pHigh) {
        const q = p - 0.5, r = q * q;
        z = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    } else {
        const q = Math.sqrt(-2 * Math.log(1 - p));
        z = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    return z;
}

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
