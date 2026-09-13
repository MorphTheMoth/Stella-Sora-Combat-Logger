// ─── effectImpact.js ──────────────────────────────────────────────────────────
// "Effect Impact" tab: shows each unique effect and how much damage
// it contributes across all filtered hits in the Dmg Calc tab.

// ─── State ────────────────────────────────────────────────────────────────────
let eiSortCol   = 'pctImpact'; // 'name' | 'pctImpact' | 'hitCoverage'
let eiSortDir   = -1;           // -1 = descending, 1 = ascending
let eiLastData  = [];           // cached row data for re-sort without recompute
// Which source groups are hidden (filter-checkboxes); some sources start hidden
// (see eiSourceHiddenByDefault below)
const eiHiddenSources = new Set();
// Sources hidden by default: Affinity, every "<char> Emblems", every
// "<char> Talents" (or "Talents"), Discs (stat rows + Melody/Harmony buffs +
// bonus-note rows), Notes (SubNoteSkill effects) and Record Stats.
// Emblem/Talent sources are per-character, so they're matched by suffix/substring.
function eiSourceHiddenByDefault(srcKey) {
    if (typeof srcKey !== 'string') return false;
    return srcKey === 'Affinity' || srcKey.endsWith(' Emblems')
        || srcKey.includes('Talents') || srcKey === 'Discs'
        || srcKey === 'Notes' || srcKey === 'Record Stats';
}
// User override for default-hidden sources: a chip click on one of them
// records it here so it stays visible even though the default says hidden.
const eiShownSources = new Set();
// Effective hidden check: an explicit chip-hide always hides; a default-hidden
// source is shown only when the user explicitly re-enabled it.
function eiIsSourceHidden(srcKey) {
    if (eiShownSources.has(srcKey)) return false;
    return eiHiddenSources.has(srcKey) || eiSourceHiddenByDefault(srcKey);
}
// Free-text search query used to filter the effect-impact rows by effect
// name — SHARED with the Dmg Calc sidebar search (fcSearchQuery in
// filterCore.js; the same #eiSearchInput drives both domains).
// When true, effects whose dmg gain is exactly 0% are hidden from the table.
// Default true = the "Show 0% gain effects" chip in the Filters sidebar starts
// off (dimmed), so zero-gain effects are hidden until the chip is enabled.
let eiHideZeroGain = true;

// ─── Core computation ─────────────────────────────────────────────────────────

// Resolve the stat delta for one effect on one hit.
// Returns { attrType, subType, amount, stacks } or null if the effect is absent.
function eiResolveEffectDelta(ev, ef) {
    if (ef.fromAttrDict) {
        const attrDict = ef.side === 'attacker' ? ev.AttackerAttrDict : ev.DefenderAttrDict;
        if (!Array.isArray(attrDict)) return null;
        for (const e of attrDict) {
            const cid  = e.configId ?? e.attrId;
            const vcid = e.valueConfigId ?? '';
            if (cid === ef.configId && String(vcid) === String(ef.valueConfigId ?? '')
                && (e.slotNum ?? 0) === (ef.slotNum ?? 0)) {
                if (e.attrType == null || e.value == null) return null;
                const stacks = e.stacks || 1;
                // Read the override under the key dcGetLevelOverride
                // writes/reads (no "dict:" marker / slotNum suffix — matches
                // dcChangeEffectLevel's normalized ovKey).
                const ovKey = `${ef.side}:${ef.configId}:${ef.valueConfigId ?? ''}`;
                const override = dcEffectLevelOverrides?.get(ovKey);
                const attrType = override?.newAttrType ?? e.attrType;
                const subType  = override?.newSubType  ?? e.subType;
                const amount   = override ? override.newValue * stacks : e.value * stacks;
                return { attrType, subType, amount, stacks };
            }
        }
        return null;
    } else {
        // Record disc effects (Boss Blitz record) live in ev.AttackerRecord —
        // merge them so their deltas resolve like any other effect row.
        const sideList = ef.side === 'attacker'
            ? (ev.AttackerEffects?.effects || []).concat(ev.AttackerRecord?.effects || [])
            : ev.DefenderEffects?.effects;
        if (!sideList?.length) return null;
        let count = 0;
        let first = null;
        for (const e of sideList) {
            if (e.configId === ef.configId) {
                count++;
                if (first === null) first = e;
            }
        }
        if (!first || first.attrType == null || first.value == null) return null;
        const override = dcGetLevelOverride(first, ef.side);
        const attrType = override?.newAttrType ?? first.attrType;
        let subType  = override?.newSubType  ?? first.subType;
        let amount   = override ? override.newValue * count : first.value * count;
        // Inherited snapshot effects: the stats are collapsed into base,
        // so compute the effective base contribution
        if (first.fromOwnerSnapshot && first.baseStatOnSnapshot != null) {
            const B = first.baseStatOnSnapshot;
            const P = first.pctStatOnSnapshot || 0;
            const v = first.value;
            if (first.subType === 1) {
                // Base effect: contribution = v * (1 + P)
                amount = v * (1 + P) * count;
            } else {
                // Pct effect: contribution = B * v
                amount = B * v * count;
            }
            subType = 1; // apply to stat.base
        }
        return { attrType, subType, amount, stacks: count };
    }
}

// Build a patched { aStats, dStats } that applies `delta` to withOverrides.
// statMap entries are shared by reference except the one stat that changes,
// which is cloned (copy-on-write) before dcApplyEffectValue mutates it.
// coeff: -1 to subtract (remove effect), +1 to add.
function eiPatchStats(withOverrides, ef, ev, delta, coeff) {
    const isAttacker = ef.side === 'attacker';
    const srcArr   = isAttacker ? withOverrides.aStats : withOverrides.dStats;
    const otherArr = isAttacker ? withOverrides.dStats : withOverrides.aStats;

    const statMap = new Map(srcArr.map((s, idx) => [idx, s]));
    const target = statMap.get(delta.attrType);
    if (target) statMap.set(delta.attrType, Object.assign({}, target));
    dcApplyEffectValue(statMap, {
        attrType: delta.attrType,
        subType: delta.subType,
        effectType: ef.effectType,
        isRecord: ef.isRecordEffect,
        bySubType: !!ef.fromAttrDict,
    }, delta.amount, coeff, ev.HitConfig.elementType);

    const newArr = [...statMap.values()];

    return isAttacker
        ? { aStats: newArr, dStats: otherArr, _potentialsDisabled: withOverrides._potentialsDisabled }
        : { aStats: otherArr, dStats: newArr, _potentialsDisabled: withOverrides._potentialsDisabled };
}

// ─── Baseline cache ───────────────────────────────────────────────────────────
// Pre-computes per-hit baseline damage + overrides once for the whole tab load.
// Structure: Array of { withDmg, withOverrides, ev }
let _eiBaselineCache = null;

function eiInvalidateCache() {
    _eiBaselineCache = null;
}

// The intel baseline is only valid while the calc state it was built from is
// unchanged: the disabled-effect set (eiInvalidateCache runs on every render,
// but direct eiComputeEffect callers bypass it) and the calc version (field
// toggles / bonuses bump dcStateVersion). Checked on every eiGetBaseline.
function eiBaselineSig() {
    return dcStateVersion + '#' + [...dcEffectsDisabled].sort().join('|');
}

function eiGetBaseline() {
    const sig = eiBaselineSig();
    if (_eiBaselineCache && _eiBaselineCache.sig === sig) return _eiBaselineCache.cache;

    // Per-hit intel (the Emblems Comparison's engine, built for THIS tab's
    // disabled set): the disable-only stat state, every level-scaled entry
    // with its ladder + baseline override, the affected sets, the resolved
    // per-configId deltas and the inherited-snapshot aggregation. The
    // 'potentials:*' group keys are stripped for the machinery pass so
    // zeroed Potentials hits still get a full intel (their enabled-state
    // damage = intel.baseDmg) — the group keys are not effect keys, so the
    // disable removals and the level resolution are identical either way.
    const setMinusPot = new Set();
    for (const k of dcEffectsDisabled) if (!k.startsWith('potentials:')) setMinusPot.add(k);

    const cache = new Array(dcFiltered.length);
    for (let i = 0; i < dcFiltered.length; i++) {
        const ev = dcFiltered[i];
        const b = { ev, disOnly: null, dead: false, charId: dcEventCharId(ev), intel: null, dmg: 0, fields: null, statIntel: null };
        b.disOnly = dcApplyEffectOverrides(ev, setMinusPot, dcEffectLevelOverrides, true);
        const pre = ecPreanalyzeHit(b, setMinusPot);
        b.intel = ecBuildIntel(b, pre, dcDisabled, setMinusPot);
        cache[i] = {
            ev,
            // the naive withDmg: zeroed Potentials hits contribute 0
            withDmg: b.intel.zeroed ? 0 : b.dmg,
            // the baseline-state view (factors + stat arrays) for the
            // closed-form evaluations
            view: b.statIntel,
            intel: b.intel,
            zeroed: !!b.intel.zeroed,
            potGroup: b.intel.potGroup ?? null,
            deltaIdx: b.intel.deltaIdx,
        };
    }
    _eiBaselineCache = { sig, cache };
    return cache;
}

// Compute damage totals with and without a given effect across all filtered hits.
// For each affected hit: resolve the delta once, patch only the changed stat,
// then recompute. Unaffected hits reuse withDmg directly (zero extra work).
// Returns { totalWith, totalWithout, hitCount, affectedHits, maxStacks, isAdded }
// All effect entries a hit carries — attacker + defender + attacker record.
// Composite rows match against this whole family (potential effects can sit on
// either side, e.g. Annihilation Echo lowers the boss's resistance).
// Memoized on the event: the three source lists are attached once at enrich
// time and never mutated afterwards, so the concat result is stable. The
// Emblems Comparison's preanalysis walks this per hit — without the cache it
// re-allocates the merged array for every hit of every pass (×58k concats in
// one compute on the profile log).
function eiEffectFamily(ev) {
    let fam = ev._eiEffectFamily;
    if (fam) return fam;
    fam = (ev.AttackerEffects?.effects || [])
        .concat(ev.DefenderEffects?.effects || [])
        .concat(ev.AttackerRecord?.effects || []);
    ev._eiEffectFamily = fam;
    return fam;
}

function eiComputeEffect(ef, baseline) {
    let totalWith = 0;
    let totalWithout = 0;
    const hitCount = baseline.length;
    let affectedHits = 0;
    let maxStacks = 1;

    const isAdded = dcEffectsDisabled.has(ef.key);

    // ── Potentials hit-group: zero matching hits rather than patching a stat ──
    // The zeroed direction contributes 0; the enabled direction is the
    // machinery state (disable-only + level-override ops) = intel.baseDmg,
    // precomputed per hit — no recompute needed.
    if (ef.isPotentialsGroup) {
        for (let i = 0; i < baseline.length; i++) {
            const b = baseline[i];
            totalWith += b.withDmg;
            if (b.potGroup === ef.skillTitle) {
                affectedHits++;
                if (isAdded) totalWithout += b.intel.baseDmg;
                // else: group is active — "without" means exclude → contribute 0
            } else {
                totalWithout += b.withDmg;
            }
        }
        return { totalWith, totalWithout, hitCount, affectedHits, maxStacks: 1, isAdded };
    }

    // ── Inherited snapshot effects: closed-form group-delta toggle ──────────
    // The disable machinery removes inherited rows through the per-(list,
    // attrType, B, P) group delta -(B*s_pct + s_base*(1+P-s_pct)), with the
    // sums over the DISABLED occurrences — the marginal contribution of one
    // row depends on the rest of the disabled set (the s_base*s_pct cross
    // term), so a constant per-row op would be wrong. The intel's snapByKey
    // mirror stores each group's occurrences (with their build-time disabled
    // flags) in machinery accumulation order, so the toggled delta recomputes
    // exactly: one base op (delta_new − delta_old) per touched group. Hits
    // not carrying the row's key are unchanged (the key matches no
    // occurrence) and reuse withDmg.
    if (ef.fromOwnerSnapshot) {
        for (let i = 0; i < baseline.length; i++) {
            const b = baseline[i];
            totalWith += b.withDmg;
            if (b.zeroed) continue;
            affectedHits++;
            const groups = b.intel.snapByKey && b.intel.snapByKey.get(ef.key);
            if (!groups) { totalWithout += b.withDmg; continue; }
            const dlist = [];
            for (let gi = 0; gi < groups.length; gi++) {
                const g = groups[gi];
                let oldB = 0, oldP = 0, newB = 0, newP = 0;
                let anyOld = false, anyNew = false;
                for (let oi = 0; oi < g.occs.length; oi++) {
                    const occ = g.occs[oi];
                    const hit = occ.key === ef.key;
                    if (occ.dis) {
                        anyOld = true;
                        if (occ.st === 1) oldB += occ.v; else if (occ.st === 2) oldP += occ.v;
                    }
                    if (hit ? !occ.dis : occ.dis) {
                        anyNew = true;
                        if (occ.st === 1) newB += occ.v; else if (occ.st === 2) newP += occ.v;
                    }
                }
                // the machinery only creates a group when ≥1 occurrence is
                // disabled, so its baseline delta is 0 for empty groups;
                // the delta expressions mirror dcApplyEffectOverrides exactly
                const dOld = anyOld ? -(g.B * oldP + oldB * (1 + g.P - oldP)) : 0;
                const dNew = anyNew ? -(g.B * newP + newB * (1 + g.P - newP)) : 0;
                const amt = dNew - dOld;
                if (amt !== 0) dlist.push([g.side, g.attrId, 1, amt]);
            }
            if (!dlist.length) { totalWithout += b.withDmg; continue; }
            totalWithout += ecAnalyticDamage(b.view, dlist, null);
        }
        return { totalWith, totalWithout, hitCount, affectedHits, maxStacks: 1, isAdded };
    }

    // ── Emblem pot rows: composite impact (both directions) ────────────────
    // A pot row has no stat of its own — disabling it lowers EVERY effect
    // entry from that potential. One direction is the hit's current state
    // (= withDmg); the other is a level move of the potential's level table,
    // evaluated in closed form (ecLevelNetDamage) like the Emblems
    // Comparison's candidate rows.
    if (ef.isPotRow && ef.linkPotential) {
        const potId = ef.linkPotential.potId;
        const st = dcPotLevels.get(potId);
        const rec = st ? st.recordLv : 0;
        const bonus = st ? st.bonus : 0;
        const change = st ? (st.change || 0) : 0;
        for (let i = 0; i < baseline.length; i++) {
            const b = baseline[i];
            // hasFamily mirror: the EI pot-row test scans eiEffectFamily only
            if (!b.intel.potAffFam.has(potId)) { totalWith += b.withDmg; totalWithout += b.withDmg; continue; }
            affectedHits++;
            // zeroed Potentials hits: bothDirections recomputes under a set
            // that still carries the group key → both directions are 0
            if (b.zeroed) continue;
            totalWith += b.withDmg;
            // the row's level table toggled: on = the bonus active, off = dropped
            const Lother = isAdded
                ? Math.min(Math.max(rec + bonus + change, 0), 9)
                : Math.min(Math.max(rec + change, 0), 9);
            totalWithout += ecLevelNetDamage(b.view, 'pot', potId, Lother);
        }
        return { totalWith, totalWithout, hitCount, affectedHits, maxStacks: 1, isAdded };
    }

    // ── Emblem skill rows: composite impact ─────────────────────────────────
    // A skill-affix shortcut row (configId 950000000 + teamIdx*100000 +
    // gemIdx*100 + gemSlot) removes the emblem's +lv from the skill-level
    // table when disabled. The toggle is a level move of the char+slot's
    // skill table → closed form.
    if (ef.displayOnly && ef.configId >= 950000000 && ef.configId < 960000000) {
        const charId = ef._charId != null ? Number(ef._charId) : null;
        const gemSlot = (ef.configId - 950000000) % 100;
        const slot = (typeof GEM_SLOT_TO_ACTION !== 'undefined' ? GEM_SLOT_TO_ACTION[gemSlot]
            : ({ 1: 5, 2: 2, 3: 3, 4: 4 })[gemSlot]) ?? gemSlot;
        const groupKey = charId + ':' + slot;
        const st = dcSkillLevels.get(groupKey);
        // the row's bonusByRow lv, and the other rows' bonus excluding the row
        let rowLv = 0, rowBonusRef = 0;
        if (st) for (const [rk, lv] of (st.bonusByRow || [])) {
            if (rk === ef.key) { rowLv = lv; continue; }
            if (rk != null && dcEffectsDisabled.has(rk)) continue;
            rowBonusRef += lv;
        }
        const maxLv = st && st.maxLv > 0 ? st.maxLv : 99;
        const rec = st ? st.recordLv : 0;
        const change = st ? (st.change || 0) : 0;
        for (let i = 0; i < baseline.length; i++) {
            const b = baseline[i];
            // hasFamily mirror: the hit's own slot scaling + family + attrDict
            if (!b.intel.skillAff.has(groupKey)) { totalWith += b.withDmg; totalWithout += b.withDmg; continue; }
            affectedHits++;
            if (b.zeroed) continue;
            totalWith += b.withDmg;
            const Lother = isAdded
                ? Math.min(Math.max(rec + rowBonusRef + rowLv + change, 0), Math.max(maxLv + rowBonusRef + rowLv, 13))
                : Math.min(Math.max(rec + rowBonusRef + change, 0), Math.max(maxLv + rowBonusRef, 13));
            totalWithout += ecLevelNetDamage(b.view, 'skill', groupKey, Lother);
        }
        return { totalWith, totalWithout, hitCount, affectedHits, maxStacks: 1, isAdded };
    }

    // ── Disc bonus-note rows: composite impact ──────────────────────────────
    // A disc-note shortcut row (configId 960000000 + discStatsIdx*1000 +
    // noteIdx) removes the disc's granted notes from the note level table
    // when disabled → a level move of the note's level table → closed form.
    if (ef.displayOnly && ef.configId >= 960000000 && ef.configId < 961000000 && ef._noteId != null) {
        const noteId = Number(ef._noteId);
        const st = dcNoteLevels.get(noteId);
        let grant = 0, rowBonusRef = 0;
        if (st) for (const [rk, lv] of (st.bonusByRow || [])) {
            if (rk === ef.key) { grant = lv; continue; }
            if (rk != null && dcEffectsDisabled.has(rk)) continue;
            rowBonusRef += lv;
        }
        const rec = st ? st.recordLv : 0;
        const change = st ? (st.change || 0) : 0;
        for (let i = 0; i < baseline.length; i++) {
            const b = baseline[i];
            // hasFamily mirror: the EI note-row test scans eiEffectFamily only
            if (!b.intel.noteAffFam.has(noteId)) { totalWith += b.withDmg; totalWithout += b.withDmg; continue; }
            affectedHits++;
            if (b.zeroed) continue;
            totalWith += b.withDmg;
            const Lother = isAdded
                ? Math.min(Math.max(rec + rowBonusRef + grant + change, 0), 99)
                : Math.min(Math.max(rec + rowBonusRef + change, 0), 99);
            totalWithout += ecLevelNetDamage(b.view, 'note', noteId, Lother);
        }
        return { totalWith, totalWithout, hitCount, affectedHits, maxStacks: 1, isAdded };
    }

    // ── Normal stat effects: one closed-form ± patch per affected hit ───────
    // The delta comes from the per-hit index (the eiResolveEffectDelta
    // mirror); the patch slot mirrors eiPatchStats' dcApplyEffectValue
    // metadata, so element-mismatched rows resolve to a no-op exactly like
    // the stat-clone path does.
    const sideNum = ef.side === 'attacker' ? 0 : 1;
    const deltaKey = ef.fromAttrDict
        ? ef.side + ':dict:' + ef.configId + ':' + (ef.valueConfigId ?? '') + ':' + (ef.slotNum ?? 0)
        : ef.side + ':' + ef.configId;
    const coeff = isAdded ? 1 : -1;
    for (let i = 0; i < baseline.length; i++) {
        const b = baseline[i];
        totalWith += b.withDmg;
        if (b.zeroed) continue;
        const delta = b.deltaIdx.get(deltaKey);
        if (!delta) { totalWithout += b.withDmg; continue; }
        if (delta.stacks > maxStacks) maxStacks = delta.stacks;
        affectedHits++;
        const meta = {
            attrType: delta.attrType, subType: delta.subType,
            effectType: ef.effectType, isRecord: ef.isRecordEffect, bySubType: !!ef.fromAttrDict,
        };
        const slot = ecOpSlot(meta, b.view.el);
        if (!slot) { totalWithout += b.withDmg; continue; }
        const dmg = ecAnalyticDamage(b.view, [[sideNum, slot[0], slot[1], coeff * delta.amount]], null);
        totalWithout += dmg;
    }

    return { totalWith, totalWithout, hitCount, affectedHits, maxStacks, isAdded };
}

// Build rows for all effects.
// Baseline is computed once and shared across all eiComputeEffect calls.
function eiComputeAll() {
    const effects = dcCollectAttrFixEffects(dcFiltered);
    const baseline = eiGetBaseline();

    const rows = effects.map(ef => {
        const { totalWith, totalWithout, hitCount, affectedHits, maxStacks, isAdded } = eiComputeEffect(ef, baseline);
        const baseVal  = isAdded ? totalWith    : totalWithout;
        const addedVal = isAdded ? totalWithout : totalWith;
        const dmgDelta  = addedVal - baseVal;
        const pctImpact = baseVal > 0
            ? ((addedVal / baseVal) - 1) * 100
            : (dmgDelta > 0 ? Infinity : 0);
        const hitCoverage = hitCount > 0 ? (affectedHits / hitCount) * 100 : 0;
        return { ef, totalWith, totalWithout, dmgDelta, pctImpact, hitCoverage, affectedHits, hitCount, maxStacks, isAdded };
    });


    return rows;
}

// ─── Render ───────────────────────────────────────────────────────────────────
// Guard against recursion: dcRefilterAndRender → dcRefreshEI → eiRender.
let _eiAutoLoading = false;

function eiRender() {
    const panel = document.getElementById('eiPanel');
    if (!panel.classList.contains('visible')) return;

    if (!dcFiltered.length) {
        // Auto-load: if no filtered hits yet but hit events exist, build the
        // Dmg Calc filter list first (same as opening the Dmg Calc tab).
        if (!_eiAutoLoading && allEvents.some(e => e.Type === 'Hit')) {
            _eiAutoLoading = true;
            try { dcRefilterAndRender(false, false); } finally { _eiAutoLoading = false; }
            return; // dcRefilterAndRender → dcRefreshEI → eiRender with hits loaded
        }
        panel.innerHTML = `<div class="ei-empty">No hit events loaded yet — wait for combat data.</div>`;
        return;
    }

    panel.innerHTML = `<div class="ei-loading">Computing effect impact…</div>`;

    // Invalidate the cache whenever we do a fresh render so that changes to
    // dcFiltered / dcBonus / dcDisabled / dcEffectsDisabled are always picked up.
    eiInvalidateCache();

    setTimeout(() => {
        eiLastData = eiComputeAll();
        eiRenderTable();
    }, 0);
}

function eiRenderTable() {
    const panel = document.getElementById('eiPanel');
    if (!panel) return;

    let rows = [...eiLastData];

    // Apply free-text search filter (matches effect name, case-insensitive)
    const q = fcSearchQuery.trim().toLowerCase();
    if (q) {
        rows = rows.filter(r => (r.ef.name || '').toLowerCase().includes(q));
    }

    // Hide effects that contribute exactly 0% damage gain when toggled off.
    // (+∞ and negative gains are always kept; baseVal=0 rows resolve to 0 here.)
    if (eiHideZeroGain) {
        rows = rows.filter(r => r.pctImpact !== 0);
    }

    const efLvlBadge = (ef) => {
        if (ef.isPotentialsGroup || !ef.allValueConfigIds || ef.currentLevelIdx < 0) return '';
        const override = dcGetLevelOverride(ef, ef.side);
        if (!override) return '';
        let diff;
        const overriddenIdx = ef.allValueConfigIds.findIndex(v => v.valueConfigId === override.newValueConfigId);
        if (overriddenIdx >= 0) {
            diff = overriddenIdx - ef.currentLevelIdx;
        } else if (override.newValueConfigId != null && ef.configId != null) {
            // potential-ladder fallback: decode levels from "<gid><P><L><V>"
            const lo = ef.configId - (ef.configId % 1000);
            const relCur = ef.valueConfigId > lo ? ef.valueConfigId - lo : 0;
            const relNew = override.newValueConfigId > lo ? override.newValueConfigId - lo : 0;
            const curL = relCur > 0 ? Math.floor((relCur % 100) / 10) : 0;
            const newL = relNew > 0 ? Math.floor((relNew % 100) / 10) : 0;
            diff = newL - curL;
        } else {
            return '';
        }
        if (diff === 0) return '';
        const cls = diff > 0 ? 'ei-lvl-up' : 'ei-lvl-down';
        return ` <span class="ei-lvl-badge ${cls}" title="Level overridden: original Lv.${ef.currentLevelIdx + 1} → Lv.${overriddenIdx + 1}">lvl ${diff > 0 ? '+' : ''}${diff}</span>`;
    };

    // Collect all unique source keys (source name only — groups attacker+defender together)
    const allSourceKeys = eiCollectSourceKeys(rows.map(r => r.ef));

    // ── Sibling grouping (Potentials + Discs) ────────────────────────────────
    // Rows belonging to the same "chain" are sorted as one unit: forced
    // adjacent, ranked by the summed gain% when the sort column is gain%, or
    // by the member values otherwise.
    //   Potentials: same name + same source (one potential ladder).
    //   Discs:      all rows of one disc — its "<disc> : Stat n" stat rows
    //               (tableResolver.js buildRecordDiscEffects), its
    //               "<disc>: Melody|Harmony N - ..." effect rows (disc-buff
    //               decoder) and its "<disc> : Note <name>" bonus-note rows
    //               (buildRecordDiscNoteEffects) — chained by the disc name
    //               before the first ':'.
    const siblingGroups = new Map(); // key `${source}\u0000${chainName}` -> rows[]
    const unitOf = new Map();        // row -> its sibling group (if any)
    const addToSiblingGroup = (key, r) => {
        let g = siblingGroups.get(key);
        if (!g) { g = []; siblingGroups.set(key, g); }
        g.push(r);
        unitOf.set(r, g);
    };
    for (const r of rows) {
        if (r.ef.isPotentialsGroup) continue;
        const src = r.ef.source ?? '';
        if (dcIsPotentialsSource(src)) {
            addToSiblingGroup(`${src}\u0000${r.ef.name}`, r);
        } else if (src === 'Discs') {
            const nm = r.ef.name ?? '';
            const c = nm.indexOf(':');
            if (c > 0) addToSiblingGroup(`${src}\u0000${nm.slice(0, c).trim()}`, r);
        }
    }

    const unitSortVal = (unit) => {
        if (eiSortCol === 'pctImpact') {
            let sum = 0, hasInf = false;
            for (const r of unit) {
                if (!isFinite(r.pctImpact)) hasInf = true;
                else sum += r.pctImpact;
            }
            return hasInf ? Infinity : sum;
        }
        let v = -Infinity;
        for (const r of unit) {
            let x = r[eiSortCol] ?? 0;
            if (!isFinite(x)) x = 1e18;
            if (x > v) v = x;
        }
        return v;
    };

    // Collapse sibling groups into units, then flatten back into rows for render.
    const units = [];
    const used = new Set();
    for (const r of rows) {
        if (used.has(r)) continue;
        const g = unitOf.get(r);
        if (g) {
            for (const m of g) used.add(m);
            units.push(g);
        } else {
            units.push([r]);
        }
    }

    // Sort units: source → chosen column (side/ATK-DEF is ignored for ordering)
    units.sort((a, b) => {
        const rA = a[0], rB = b[0];
        const srcA = rA.ef.source ?? 'Unknown';
        const srcB = rB.ef.source ?? 'Unknown';
        if (srcA !== srcB) return srcA.localeCompare(srcB);
        if (eiSortCol === 'name') {
            return eiSortDir * rA.ef.name.localeCompare(rB.ef.name);
        }
        let va = unitSortVal(a);
        let vb = unitSortVal(b);
        if (!isFinite(va)) va = 1e18;
        if (!isFinite(vb)) vb = 1e18;
        // eiSortDir=-1 means descending (largest gain first), so negate:
        // -(-1) * (vb - va) = vb - va → bigger values sort first.
        return -eiSortDir * (vb - va);
    });

    const sortedRows = [];
    for (const unit of units) sortedRows.push(...unit);
    rows = sortedRows;

    const hitCountSample = rows[0]?.hitCount ?? 0;

    function sortArrow(col) {
        if (eiSortCol !== col) return `<span class="ei-sort-arrow ei-sort-inactive">↕</span>`;
        return `<span class="ei-sort-arrow">${eiSortDir === -1 ? '↓' : '↑'}</span>`;
    }
    function thClick(col) {
        return `onclick="eiSetSort('${col}')"`;
    }

    // Render source filter chips into sidebar
    const chipsEl = document.getElementById('eiFilterChips');
    if (chipsEl) chipsEl.innerHTML = eiSourceChipsHtml(allSourceKeys);

    let html = `
    <div class="ei-header-bar">
        <span class="ei-subtitle">${hitCountSample} hits · ${rows.length} unique effects</span>
        <button class="ei-refresh-btn" onclick="eiRender()">↻ Refresh</button>
    </div>
    <div class="ei-scroll-wrap">
    <table class="ei-table">
        <thead>
            <tr>
                <th class="ei-th ei-th-source">Source</th>
                <th class="ei-th ei-th-side"></th>
                <th class="ei-th ei-th-num" ${thClick('pctImpact')}>Gain% ${sortArrow('pctImpact')}</th>
                <th class="ei-th ei-th-name" ${thClick('name')}>Effect ${sortArrow('name')}</th>
                <th class="ei-th ei-th-stat">Stat</th>
                <th class="ei-th ei-th-num" ${thClick('hitCoverage')}>Coverage ${sortArrow('hitCoverage')}</th>
                <th class="ei-th ei-th-num">w/ Effect</th>
                <th class="ei-th ei-th-num">w/o Effect</th>
            </tr>
        </thead>
        <tbody>`;

    // Render rows, grouped for source column spanning
    let i = 0;
    while (i < rows.length) {
        const row = rows[i];
        const srcKey = row.ef.source ?? 'Unknown';

        // Skip entire source group if filtered out
        if (eiIsSourceHidden(srcKey)) {
            i++;
            while (i < rows.length && (rows[i].ef.source ?? 'Unknown') === srcKey) i++;
            continue;
        }

        // Count rows in this source group
        let groupEnd = i + 1;
        while (groupEnd < rows.length && (rows[groupEnd].ef.source ?? 'Unknown') === srcKey) groupEnd++;
        const groupSize = groupEnd - i;

        // Render each row in the group
        for (let j = i; j < groupEnd; j++) {
            const { ef, totalWith, totalWithout, dmgDelta, pctImpact, hitCoverage, affectedHits, hitCount, maxStacks, isAdded } = rows[j];

            const sideLabel = ef.side === 'attacker' ? 'ATK' : ef.side === 'defender' ? 'DEF' : 'POT';
            const sideClass = ef.side === 'attacker' ? 'ei-side-atk' : ef.side === 'defender' ? 'ei-side-def' : 'ei-side-pot';

            const statCellContent = ef.isPotRow
                // the actual change the emblem grants (record gems "pots": [[potIdx, +levels]])
                ? `<span class="ei-attr"></span><span class="ei-val">+${ef.linkPotential.addLv} lv</span>`
                : ef.displayOnly
                ? (ef._noteAdd != null
                    // disc bonus-note row: the note effect's stat × grant, in the
                    // same white-attr + value form as the stat entries, with the
                    // notes kept as a suffix ("Ult Dmg  +3.22% | +7 notes")
                    ? (() => {
                        const st = (typeof discNoteStatOf === 'function') ? discNoteStatOf(ef) : null;
                        const notes = `+${ef._noteAdd} note${ef._noteAdd !== 1 ? 's' : ''}`;
                        const valPart = st ? `+${st.val} | ${notes}` : notes;
                        return `<span class="ei-attr">${esc(st?.attr ?? '')}</span><span class="ei-val">${valPart}</span>`;
                    })()
                    : `<span class="ei-attr"></span><span class="ei-val">+${ef._skillAddLv || 0} lv</span>`)
                : ef.isPotentialsGroup
                ? `<span class="ei-attr">Hit Damage</span><span class="ei-val">${ef.value.map(num => `${num}%`).join(', ')}</span>`
                : (() => {
                    const override = dcGetLevelOverride(ef, ef.side);
                    // For ATTR_FIX effects subType is 1/2/3 (base/pct/abs); for
                    // ELEMENTTYPE_*_FIX effects subType is the element id, so the
                    // base/pct split is determined by effectType instead.
                    const eiSubTypeLabel = (subType, effectType) => {
                        if (effectType === ELEMENTTYPE_ATTR_FIX) return 'base';
                        if (effectType === ELEMENTTYPE_ATTR_PERCENT_FIX) return 'pct';
                        if (subType === 1) return 'base';
                        if (subType === 2) return 'pct';
                        if (subType === 3) return 'abs';
                        return '?';
                    };
                    const attrLabel = ef.attrType != null ? attrName(ef.attrType) : '?';
                    const raw = override ? override.newValue : ef.value;
                    const overrideSubType = override ? override.newSubType : ef.subType;
                    const overrideAttrType = override ? override.newAttrType : ef.attrType;
                    // Emblem stat rolls show their tier (+1/+2/+3) from
                    // CharGemAttrValue.Level
                    let displaySubLabel = ef.isRecordEffect
                        ? (overrideSubType === 1 ? 'Origin' : eiSubTypeLabel(overrideSubType, null))
                        : eiSubTypeLabel(overrideSubType, ef.effectType);
                    if (ef._gemLevel) displaySubLabel = `${displaySubLabel} +${ef._gemLevel}`;
                    const displayAttrLabel = overrideAttrType != null ? attrName(overrideAttrType) : attrName(ef.attrType);
                    const isSmall = raw != null && Math.abs(raw) < 15;
                    const valStr = raw != null ? (isSmall ? (raw * 100).toFixed(2) + '%' : String(raw)) : '?';
                    const maxStacksStr = maxStacks > 1 ? ` <span class="ei-stacks" title="Max stacks observed">×${maxStacks}</span>` : '';
                    const overrideMarker = override ? ' *' : '';
                    return `<span class="ei-attr">${esc(displayAttrLabel)}</span><span class="ei-val">+${valStr} [${displaySubLabel}]${maxStacksStr}${overrideMarker}</span>`;
                })();

            const pctStr  = isFinite(pctImpact) ? (pctImpact >= 0 ? '+' : '') + pctImpact.toFixed(2) + '%' : '+∞%';
            const pctClass = pctImpact > 0.5 ? 'ei-pos' : pctImpact < -0.5 ? 'ei-neg' : 'ei-neutral';

            const covBar = Math.round(hitCoverage);

            // For added effects: totalWith = baseline (effect off), totalWithout = w/ effect summed in.
            const colBase  = isAdded ? totalWithout : totalWith;
            const colAdded = isAdded ? totalWith    : totalWithout;

            const addedBadge = isAdded
                ? ` <span class="ei-added-badge" title="This effect is toggled OFF in Dmg Calc — showing what adding it back contributes">+added</span>`
                : '';

            // First row in group gets the rowspan source cell
            const sourceCellHtml = j === i
                ? `<td class="ei-td ei-td-source" rowspan="${groupSize}" data-ei-src="${esc(srcKey)}"><span class="ei-source-name">${esc(ef.source ?? 'Unknown')}</span></td>`
                : '';

            html += `<tr class="ei-row">
                ${sourceCellHtml}
                <td class="ei-td ei-td-side"><span class="ei-side-badge ${sideClass}">${sideLabel}</span></td>
                <td class="ei-td ei-td-num"><span class="${pctClass} ei-bold">${pctStr}</span></td>
                <td class="ei-td ei-td-name" title="configId=${ef.configId}">${esc(ef.name)}${addedBadge}${efLvlBadge(ef)}</td>
                <td class="ei-td ei-td-stat">
                    ${statCellContent}
                </td>
                <td class="ei-td ei-td-num">
                    <div class="ei-cov-wrap">
                        <span class="ei-cov-hits">${affectedHits}/${hitCount}</span></span>
                        <div class="ei-cov-bar-bg"><div class="ei-cov-bar-fill" style="width:${covBar}%"></div></div>
                    </div>
                </td>
                <td class="ei-td ei-td-num ei-muted">${Math.round(colBase).toLocaleString()}</td>
                <td class="ei-td ei-td-num ei-muted">${Math.round(colAdded).toLocaleString()}</td>
            </tr>`;
        }
        i = groupEnd;
    }

    if (rows.length === 0) {
        html += `<tr><td colspan="8" class="ei-empty-row">No effects found in current filter.</td></tr>`;
    }

    html += `</tbody></table></div>`;
    panel.innerHTML = html;
}

window.eiToggleSourceFilter = function(srcKey) {
    if (eiIsSourceHidden(srcKey)) {
        // Show: drop any explicit hide and remember the override when the
        // source is hidden by default.
        eiHiddenSources.delete(srcKey);
        if (eiSourceHiddenByDefault(srcKey)) eiShownSources.add(srcKey);
    } else {
        eiHiddenSources.add(srcKey);
        eiShownSources.delete(srcKey);
    }
    eiRenderTable();
};

window.eiShowAllSources = function() {
    eiHiddenSources.clear();
    eiShownSources.clear();
    eiRenderTable();
};

// Toggle the "0% gain effects" chip in the Filters sidebar. Active chip =
// zero-gain effects are shown (default). Toggling off filters them from the
// table using the cached eiLastData — no recompute needed.
window.eiToggleZeroGain = function() {
    eiHideZeroGain = !eiHideZeroGain;
    const btn = document.getElementById('eiZeroGainBtn');
    if (btn) btn.classList.toggle('ei-chip-active', !eiHideZeroGain);
    const panel = document.getElementById('eiPanel');
    if (panel && panel.classList.contains('visible') && eiLastData.length) eiRenderTable();
};

// ─── Source filter chips (shared by the EI table and the Analytics sidebar) ──
// Unique source keys in sorted order (source name only — attacker+defender
// grouped together).
function eiCollectSourceKeys(efs) {
    const seen = new Set();
    const allSourceKeys = [];
    for (const ef of efs) {
        const srcKey = ef.source ?? 'Unknown';
        if (!seen.has(srcKey)) { seen.add(srcKey); allSourceKeys.push({ srcKey, source: ef.source ?? 'Unknown' }); }
    }
    allSourceKeys.sort((a, b) => a.srcKey.localeCompare(b.srcKey));
    return allSourceKeys;
}

function eiSourceChipsHtml(sourceKeys) {
    let html = '';
    for (const { srcKey, source } of sourceKeys) {
        const active = !eiIsSourceHidden(srcKey);
        html += `<button class="ei-src-chip ei-chip-src ${active ? 'ei-chip-active' : ''}" data-ei-src="${esc(srcKey)}">${esc(source)}</button>`;
    }
    return html + `<button class="ei-chip-all" onclick="eiShowAllSources()">All</button>`;
}

// Delegated clicks for the chip rows and the table's rowspan source cells
// (data-ei-src replaces the old inline eiToggleSourceFilter('…') strings,
// which broke on source names containing a quote).
document.addEventListener('click', e => {
    const el = e.target.closest('[data-ei-src]');
    if (el) eiToggleSourceFilter(el.dataset.eiSrc);
});

// Render the effect-source filter chips into the left sidebar (used by the
// Analytics tab, which surfaces the Effect Impact source filters too).
function eiRenderSidebarChips() {
    const chipsEl = document.getElementById('eiFilterChips');
    if (!chipsEl) return;
    // Cached collector: this runs on every switch to the Dmg Calc / Effect
    // Impact / Emblems Comparison tabs — the uncached call cost ~145 ms per
    // switch on the profile log (the cached variant reuses the result while
    // dcFiltered is the same array, exactly like renderEffectsPanel).
    const effects = dcCollectAttrFixEffectsCached();
    chipsEl.innerHTML = eiSourceChipsHtml(eiCollectSourceKeys(effects));
}

window.eiOnSearchInput = function() {
    const el = document.getElementById('eiSearchInput');
    const v = el ? el.value : '';
    fcSearchQuery = v;
    const dcVisible = document.getElementById('dmgCalcPanel').classList.contains('visible');
    const eiVisible = document.getElementById('eiPanel').classList.contains('visible');
    const ecVisible = document.getElementById('ecPanel')?.classList.contains('visible');
    if (dcVisible) dcRefilterAndRender(true);
    if (eiVisible) eiRenderTable();
    if (ecVisible && typeof ecRenderTable === 'function') ecRenderTable();
    if (typeof activeTab !== 'undefined' && activeTab === 'analytics' && typeof Analytics !== 'undefined') Analytics.refresh();
};

window.eiSetSort = function(col) {
    if (eiSortCol === col) eiSortDir = -eiSortDir;
    else { eiSortCol = col; eiSortDir = -1; }
    eiRenderTable();
};

// ─── Tab hook ─────────────────────────────────────────────────────────────────
const _eiOrigSwitchTab = window.switchTab;
window.switchTab = function(tab) {
    document.getElementById('tabEffectImpact').classList.toggle('active', tab === 'effectimpact');
    document.getElementById('eiPanel').classList.toggle('visible', tab === 'effectimpact');
    if (tab === 'effectimpact') {
        // Recompute the shared hits-domain filtered list first (the shared
        // filters may have changed while another tab was active), then the
        // shared right sidebar surfaces.
        if (typeof dcApplyFilters === 'function') dcFiltered = dcApplyFilters();
        if (typeof fcDirtyHits !== 'undefined') fcDirtyHits = false;   // just recomputed
        eiRender();
        if (typeof renderEffectsPanel === 'function') renderEffectsPanel();
        if (typeof dcRenderTotals === 'function') dcRenderTotals();
    }
    _eiOrigSwitchTab(tab);
};
