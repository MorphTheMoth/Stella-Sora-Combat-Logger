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

// ─── Core computation ─────────────────────────────────────────────────────────
// A skill-affix candidate affects a hit when the hit's own level scaling or a
// level-scaled effect/once-attr entry resolves through the owner char's slot
// (same resolution the effect-impact emblem-skill block uses).
function ecSkillHitAffected(b, row) {
    if (b.dead) return false;
    const ev = b.ev;
    const evChar = dcEventCharId(ev);
    const hc = ev.HitConfig || {};
    if (hc.levelTypeData === 3 && evChar === row.charId
        && dcSkillSlotFor(hc.levelData, hc.mainOrSupport) === row.actionSlot) return true;
    for (const e of eiEffectFamily(ev)) {
        if (!allowedEffectTypes.includes(e.effectType)) continue;
        const rawSlot = (e.levelTypeData === 3) ? e.levelData : dcSkillScaled.get(e.configId);
        if (rawSlot == null) continue;
        const owner = dcEffectOwnerCharId(e.configId) ?? evChar;
        if (owner === row.charId
            && dcSkillSlotFor(rawSlot, null, dcAttackerRoleSlot(owner)) === row.actionSlot) return true;
    }
    for (const dict of [ev.AttackerAttrDict, ev.DefenderAttrDict]) {
        if (!Array.isArray(dict)) continue;
        for (const e of dict) {
            const rawSlot = (e.levelTypeData === 3) ? e.levelData : dcSkillScaled.get(e.configId);
            if (rawSlot == null) continue;
            if (evChar === row.charId
                && dcSkillSlotFor(rawSlot, null, dcAttackerRoleSlot(evChar)) === row.actionSlot) return true;
        }
    }
    return false;
}

// A potential-affix candidate affects a hit when the hit scales with the
// potential (levelTypeData 1) or carries an effect/once-attr entry whose
// level source is that potential.
function ecPotHitAffected(b, potId) {
    if (b.dead) return false;
    const ev = b.ev;
    const hc = ev.HitConfig || {};
    if (hc.levelTypeData === 1 && Number(hc.levelData) === potId) return true;
    for (const e of eiEffectFamily(ev)) {
        if (e.configId != null && dcEffectPot.get(e.configId) === potId) return true;
    }
    for (const dict of [ev.AttackerAttrDict, ev.DefenderAttrDict]) {
        if (!Array.isArray(dict)) continue;
        for (const e of dict) {
            const cid = e.configId ?? e.attrId;
            if (cid != null && dcEffectPot.get(cid) === potId) return true;
        }
    }
    return false;
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
function ecComputeCharTable(charId, candidates, extDisabled, evEV, teamBaseline, teamBaseTotal) {
    const baseline = teamBaseline.filter(b => dcEventCharId(b.ev) === charId);
    const baseTotal = baseline.reduce((s, b) => s + b.dmg, 0);

    const rows = [];

    // ── Stat rows ──────────────────────────────────────────────────────────
    // Rows are grouped by (attrType, subType): one stat clone per group per
    // hit serves every candidate row sharing it, and each row is measured
    // cumulatively from the blank baseline (copy k = value × k).
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
        for (let j = 0; j < g.rows.length; j++) { /* rows share the affected set */ }
        for (let j = 0; j < baseline.length; j++) {
            if (ecAttrHitAffected(g.attrType, baseline[j], evEV)) { g.affected.push(j); affectedBase += baseline[j].dmg; }
        }
        g.affectedBase = affectedBase;
        for (const item of g.rows) {
            // bases[k] = domain-wide total BEFORE copy k+1 (bases[0] = blank baseline)
            item._bases = new Array(item.tiers.length).fill(0);
            item._gains = new Array(item.tiers.length).fill(0);
        }
    }
    for (const g of statGroups.values()) {
        const { attrType, subType } = g;
        for (const j of g.affected) {
            const b = baseline[j];
            // Copy-on-write: clone only the stat this group patches.
            const aStats = b.withOverrides.aStats.slice();
            const cur = aStats[attrType];
            const stat = cur ? Object.assign({}, cur) : { origin: 0, base: 0, pct: 0, abs: 0 };
            aStats[attrType] = stat;
            const o0 = stat.origin || 0, p0 = stat.pct || 0, a0 = stat.abs || 0;
            for (const item of g.rows) {
                let prevDmg = b.dmg;   // row's cumulative starts at the blank baseline
                for (let k = 1; k <= item.tiers.length; k++) {
                    item._bases[k - 1] += prevDmg;   // affected-hit part of the total before copy k
                    const amt = item.value * k;
                    if (subType === 1) stat.origin = o0 + amt;
                    else if (subType === 2) stat.pct = p0 + amt;
                    else stat.abs = a0 + amt;
                    const f = calcHitFields(b.ev, { aStats, dStats: b.withOverrides.dStats }, extDisabled, dcEffectLevelOverrides);
                    const dmg = calcDamage(f, dcBonus, ecCalcDisabled());
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

    // ── Skill-levelup rows: the emblem affix's full level bonus at once ────
    // The row IS the record's own emblem affix roll for that slot (e.g. +2 lv
    // Main Skill): one gain column (×1) = nothing → full bonus.
    for (const row of candidates.skillRows) {
        if (row.charId !== charId) continue;
        const st = dcSkillLevels.get(`${row.charId}:${row.actionSlot}`);
        if (!st) continue;
        let gains = null, bases = null, teamGains = null, teamBases = null;
        // Hypothetical full roll: +3 lv on EVERY skill slot (not just the ones
        // the record has an affix equipped for) — blank vs blank+3lv.
        const fullBonus = 3;
        {
            const ecKey = `ec:skill:${row.charId}:${row.actionSlot}`;
            // ── pass 1: personal domain (this char's hits only) ──
            const affected = baseline.filter(b => ecSkillHitAffected(b, row));
            if (affected.length) {
                const affectedBase = affected.reduce((s, b) => s + b.dmg, 0);
                let total = baseTotal;
                st.bonusByRow.push([ecKey, fullBonus]);
                try {
                    let aff = 0;
                    for (const b of affected) {
                        const ov = dcApplyEffectOverrides(b.ev, extDisabled, dcEffectLevelOverrides);
                        aff += calcDamage(calcHitFields(b.ev, ov, extDisabled, dcEffectLevelOverrides), dcBonus, ecCalcDisabled());
                    }
                    total = baseTotal - affectedBase + aff;
                } finally {
                    st.bonusByRow.pop();
                }
                bases = [baseTotal];
                gains = [total - baseTotal];
            }
            // ── pass 2: team domain — the affix also scales effects that ride
            // on TEAMMATES' hits (owner p:<charId> on their hit) ──
            const affectedTeam = teamBaseline.filter(b => ecSkillHitAffected(b, row));
            if (affectedTeam.length) {
                const affectedBase = affectedTeam.reduce((s, b) => s + b.dmg, 0);
                let total = teamBaseTotal;
                st.bonusByRow.push([ecKey, fullBonus]);
                try {
                    let aff = 0;
                    for (const b of affectedTeam) {
                        const ov = dcApplyEffectOverrides(b.ev, extDisabled, dcEffectLevelOverrides);
                        aff += calcDamage(calcHitFields(b.ev, ov, extDisabled, dcEffectLevelOverrides), dcBonus, ecCalcDisabled());
                    }
                    total = teamBaseTotal - affectedBase + aff;
                } finally {
                    st.bonusByRow.pop();
                }
                teamBases = [teamBaseTotal];
                teamGains = [total - teamBaseTotal];
            }
        }
        rows.push({ ...row, copies: 1, gains, bases, teamGains, teamBases, valueStr: `+${fullBonus} lv` });
    }

    // ── Potential affix rows: every potential the char owns, at +3 lv ──
    for (const row of candidates.potRows) {
        if (row.charId !== charId) continue;
        const st = dcPotLevels.get(row.potId);
        if (!st) continue;
        let gains = null, bases = null, teamGains = null, teamBases = null;
        // Hypothetical full roll: +3 lv on EVERY owned potential.
        const fullBonus = 3;
        {
            const ecKey = `ec:pot:${row.potId}`;
            const saved = { bonus: st.bonus, potKey: st.potKey };
            // ── pass 1: personal domain (this char's hits only) ──
            const affected = baseline.filter(b => ecPotHitAffected(b, row.potId));
            if (affected.length) {
                const affectedBase = affected.reduce((s, b) => s + b.dmg, 0);
                let total = baseTotal;
                st.bonus = fullBonus;
                st.potKey = ecKey;
                try {
                    let aff = 0;
                    for (const b of affected) {
                        const ov = dcApplyEffectOverrides(b.ev, extDisabled, dcEffectLevelOverrides);
                        aff += calcDamage(calcHitFields(b.ev, ov, extDisabled, dcEffectLevelOverrides), dcBonus, ecCalcDisabled());
                    }
                    total = baseTotal - affectedBase + aff;
                } finally {
                    st.bonus = saved.bonus;
                    st.potKey = saved.potKey;
                }
                bases = [baseTotal];
                gains = [total - baseTotal];
            }
            // ── pass 2: team domain — the potential's effects also ride on
            // TEAMMATES' hits (owner p:<charId> on their hit) ──
            const affectedTeam = teamBaseline.filter(b => ecPotHitAffected(b, row.potId));
            if (affectedTeam.length) {
                const affectedBase = affectedTeam.reduce((s, b) => s + b.dmg, 0);
                let total = teamBaseTotal;
                st.bonus = fullBonus;
                st.potKey = ecKey;
                try {
                    let aff = 0;
                    for (const b of affectedTeam) {
                        const ov = dcApplyEffectOverrides(b.ev, extDisabled, dcEffectLevelOverrides);
                        aff += calcDamage(calcHitFields(b.ev, ov, extDisabled, dcEffectLevelOverrides), dcBonus, ecCalcDisabled());
                    }
                    total = teamBaseTotal - affectedBase + aff;
                } finally {
                    st.bonus = saved.bonus;
                    st.potKey = saved.potKey;
                }
                teamBases = [teamBaseTotal];
                teamGains = [total - teamBaseTotal];
            }
        }
        rows.push({ ...row, copies: 1, gains, bases, teamGains, teamBases, valueStr: `+${fullBonus} lv` });
    }

    return { charId, hitCount: baseline.length, baseTotal, rows };
}

function ecComputeAll() {
    const rec = getOriginRecord();
    if (!rec || !Array.isArray(rec.chars) || !rec.chars.length) return null;

    // Rebuild the level tables from the record first — the pot/skill affix
    // candidates read them, and they are normally only rebuilt by the
    // dmg-calc effect collection (which may never have run this session).
    if (typeof dcRebuildPotLevels === 'function') dcRebuildPotLevels();
    if (typeof dcRebuildSkillLevels === 'function') dcRebuildSkillLevels();
    if (typeof dcRebuildNoteLevels === 'function') dcRebuildNoteLevels();
    if (typeof dcEnsureHitLevels === 'function') dcEnsureHitLevels();

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

    const evEV = true;   // this tab always evaluates with expected crit
    const candidates = ecBuildCandidates();

    // Shared blank baseline over ALL deployed team characters' hits, computed
    // once — the per-char tables slice their personal domain out of it and the
    // team-scope row gains are measured against the full team domain.
    const teamIds = (Array.isArray(rec.team) && rec.team.length)
        ? rec.team.map(Number)
        : rec.chars.map(c => Number(c.charId));
    const teamIdSet = new Set(teamIds);
    const teamBaseline = [];
    for (let i = 0; i < dcFiltered.length; i++) {
        if (!teamIdSet.has(dcEventCharId(dcFiltered[i]))) continue;
        const ev = dcFiltered[i];
        const withOverrides = dcApplyEffectOverrides(ev, extDisabled, dcEffectLevelOverrides);
        const dead = !!withOverrides._potentialsDisabled;
        teamBaseline.push({
            ev, withOverrides, dead,
            dmg: dead ? 0 : calcDamage(calcHitFields(ev, withOverrides, extDisabled, dcEffectLevelOverrides), dcBonus, ecCalcDisabled()),
        });
    }
    const teamBaseTotal = teamBaseline.reduce((s, b) => s + b.dmg, 0);

    // One table per deployed record character (rec.team order).
    const tables = [];
    for (const charId of teamIds) {
        if (!charId) continue;
        const t = ecComputeCharTable(charId, candidates, extDisabled, evEV, teamBaseline, teamBaseTotal);
        t.charName = (typeof resolveActorKey === 'function') ? resolveActorKey('p:' + charId) : String(charId);
        tables.push(t);
    }

    // Team baseline = sum of every table's blank baseline (for the per-table
    // Personal dmg / Team dmg scope droplist).
    const teamBase = tables.reduce((s, t) => s + t.baseTotal, 0);
    for (const t of tables) t.teamBase = teamBase;

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
                try { dcRefilterAndRender(false, false); } finally { _ecAutoLoading = false; }
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

    ecEnsureObserved(() => {
        if (seq !== _ecRenderSeq) return;   // a newer render superseded this one
        ecLastData = ecComputeAll();
        ecRenderTable();
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
