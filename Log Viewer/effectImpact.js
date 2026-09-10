// ─── effectImpact.js ──────────────────────────────────────────────────────────
// "Effect Impact" tab: shows each unique effect and how much damage
// it contributes across all filtered hits in the Dmg Calc tab.

// ─── State ────────────────────────────────────────────────────────────────────
let eiSortCol   = 'pctImpact'; // 'name' | 'pctImpact' | 'hitCoverage'
let eiSortDir   = -1;           // -1 = descending, 1 = ascending
let eiLastData  = [];           // cached row data for re-sort without recompute
// Which source groups are hidden (filter-checkboxes); default all visible
const eiHiddenSources = new Set();
// Free-text search query used to filter the effect-impact rows by effect name
let eiSearchQuery = '';
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
                const override = dcEffectLevelOverrides?.get(ef.key);
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
// Only the one stat object that changes is cloned; all others are shared by reference.
// coeff: -1 to subtract (remove effect), +1 to add.
function eiPatchStats(withOverrides, ef, ev, delta, coeff) {
    const isAttacker = ef.side === 'attacker';
    const srcArr   = isAttacker ? withOverrides.aStats : withOverrides.dStats;
    const otherArr = isAttacker ? withOverrides.dStats : withOverrides.aStats;

    let found = false;
    const newArr = srcArr.map((s, idx) => {
        if (idx !== delta.attrType) return s; // share reference — no clone needed
        found = true;
        const copy = Object.assign({}, s);
        if (ef.fromAttrDict || [ATTR_FIX, HITTED_ADDITIONAL_ATTR_FIX, PLAYER_ATTR_FIX].includes(ef.effectType)) {
          if (delta.subType === 1)      { if (ef.isRecordEffect) copy.origin = (copy.origin || 0) + delta.amount * coeff; else copy.base = (copy.base || 0) + delta.amount * coeff; }
          else if (delta.subType === 2) copy.pct  = (copy.pct  || 0) + delta.amount * coeff;
          else if (delta.subType === 3) copy.abs  = (copy.abs  || 0) + delta.amount * coeff;
        } else if (ef.effectType === ELEMENTTYPE_ATTR_FIX) {
            if (ev.HitConfig.elementType === delta.subType) copy.base = (copy.base || 0) + delta.amount * coeff;
        } else if (ef.effectType === ELEMENTTYPE_ATTR_PERCENT_FIX) {
            if (ev.HitConfig.elementType === delta.subType) copy.pct  = (copy.pct  || 0) + delta.amount * coeff;
        }
        return copy;
    });

    // Stat didn't exist in the array yet — append a new entry.
    if (!found) {
        const fresh = { origin: 0, base: 0, pct: 0, abs: 0 };
        if (ef.fromAttrDict || [ATTR_FIX, HITTED_ADDITIONAL_ATTR_FIX, PLAYER_ATTR_FIX].includes(ef.effectType)) {
          if (delta.subType === 1)      { if (ef.isRecordEffect) fresh.origin = delta.amount * coeff; else fresh.base = delta.amount * coeff; }
          else if (delta.subType === 2) fresh.pct  = delta.amount * coeff;
          else if (delta.subType === 3) fresh.abs  = delta.amount * coeff;
        } else if (ef.effectType === ELEMENTTYPE_ATTR_FIX) {
            if (ev.HitConfig.elementType === delta.subType) fresh.base = delta.amount * coeff;
        } else if (ef.effectType === ELEMENTTYPE_ATTR_PERCENT_FIX) {
            if (ev.HitConfig.elementType === delta.subType) fresh.pct  = delta.amount * coeff;
        }
        newArr.push(fresh);
    }

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

function eiGetBaseline() {
    if (_eiBaselineCache) return _eiBaselineCache;

    const cache = new Array(dcFiltered.length);
    for (let i = 0; i < dcFiltered.length; i++) {
        const ev = dcFiltered[i];
        const withOverrides = dcApplyEffectOverrides(ev, dcEffectsDisabled, dcEffectLevelOverrides);
        const withFields    = calcHitFields(ev, withOverrides, null, dcEffectLevelOverrides);
        const withDmg       = calcDamage(withFields, dcBonus, dcDisabled);
        cache[i] = { ev, withOverrides, withDmg };
    }
    _eiBaselineCache = cache;
    return cache;
}

// Compute damage totals with and without a given effect across all filtered hits.
// For each affected hit: resolve the delta once, patch only the changed stat,
// then recompute. Unaffected hits reuse withDmg directly (zero extra work).
// Returns { totalWith, totalWithout, hitCount, affectedHits, maxStacks, isAdded }
function eiComputeEffect(ef, baseline) {
    let totalWith    = 0;
    let totalWithout = 0;
    let hitCount     = baseline.length;
    let affectedHits = 0;
    let maxStacks    = 1;

    const isAdded = dcEffectsDisabled.has(ef.key);

    // ── Potentials hit-group: zero matching hits rather than patching a stat ──
    if (ef.isPotentialsGroup) {
        for (let i = 0; i < baseline.length; i++) {
            const { ev, withOverrides, withDmg } = baseline[i];
            totalWith += withDmg;
            const evSrc   = ev.source ?? ev.HitConfig?.source ?? '';
            const evSkill = ev.HitConfig?.skillTitle ?? 'Unknown';
            if (evSrc.includes('Potentials') && evSkill === ef.skillTitle) {
                affectedHits++;
                if (isAdded) {
                    // Group is currently disabled — baseline already has these hits
                    // zeroed. Recompute with this group's key temporarily removed from
                    // dcEffectsDisabled so all other disabled effects are still applied.
                    const tempDisabled = new Set(dcEffectsDisabled);
                    tempDisabled.delete(ef.key);
                    const activeOverrides = dcApplyEffectOverrides(ev, tempDisabled, dcEffectLevelOverrides);
                    const fullFields = calcHitFields(ev, activeOverrides, tempDisabled, dcEffectLevelOverrides);
                    totalWithout += calcDamage(fullFields, dcBonus, dcDisabled);
                }
                // else: group is active — "without" means exclude → contribute 0
            } else {
                totalWithout += withDmg;
            }
        }
        return { totalWith, totalWithout, hitCount, affectedHits, maxStacks: 1, isAdded };
    }

    // ── Inherited snapshot effects: recompute full aggregation instead of patching ──
    // Per-effect deltas don't work because inherited effects interact non-linearly
    // through the aggregation formula: -(B*e_pct + e_base*(1+P-e_pct)).
    if (ef.fromOwnerSnapshot) {
        for (let i = 0; i < baseline.length; i++) {
            const { ev, withOverrides, withDmg } = baseline[i];
            totalWith += withDmg;
            if (withOverrides._potentialsDisabled) continue;
            affectedHits++;
            const tempDisabled = new Set(dcEffectsDisabled);
            if (isAdded) tempDisabled.delete(ef.key);
            else          tempDisabled.add(ef.key);
            const altOverrides = dcApplyEffectOverrides(ev, tempDisabled, dcEffectLevelOverrides);
            const altFields    = calcHitFields(ev, altOverrides);
            totalWithout += calcDamage(altFields, dcBonus, dcDisabled);
        }
        return { totalWith, totalWithout, hitCount, affectedHits, maxStacks: 1, isAdded };
    }

    // ── Emblem pot rows: composite impact ─────────────────────────────────
    // A pot row has no stat of its own — disabling it lowers EVERY effect
    // entry from that potential. Compute BOTH directions explicitly (pot
    // forced off vs forced on) so the delta cannot be masked by ambient
    // disabled-set state:
    //   row disabled  → totalWith = pot-off,  totalWithout = pot-on
    //   row enabled   → totalWith = pot-on,   totalWithout = pot-off
    if (ef.isPotRow && ef.linkPotential) {
        // Potential effects may sit on either side (e.g. Annihilation Echo
        // lowers the BOSS's resistance → entries in DefenderEffects). Entries
        // match by EXACT effect id (two potentials can share an id bucket).
        const hasFamily = (ev) => {
            const fam = (ev.AttackerEffects?.effects || [])
                .concat(ev.DefenderEffects?.effects || [])
                .concat(ev.AttackerRecord?.effects || []);
            return fam.some(e => e.configId != null && dcEffectPot.get(e.configId) === ef.linkPotential.potId);
        };
        // Both directions are computed with a temp disabled set: off = the pot
        // row's key added (emblem bonus excluded from the level formula),
        // on = the key removed. dcGetLevelOverride threads the set through.
        for (let i = 0; i < baseline.length; i++) {
            const { ev, withDmg } = baseline[i];
            if (!hasFamily(ev)) { totalWith += withDmg; totalWithout += withDmg; continue; }
            affectedHits++;
            const offSet = new Set(dcEffectsDisabled); offSet.add(ef.key);
            const onSet  = new Set(dcEffectsDisabled); onSet.delete(ef.key);
            const offOv = dcApplyEffectOverrides(ev, offSet, dcEffectLevelOverrides);
            const offDmg = calcDamage(calcHitFields(ev, offOv, offSet, dcEffectLevelOverrides), dcBonus, dcDisabled);
            const onOv  = dcApplyEffectOverrides(ev, onSet,  dcEffectLevelOverrides);
            const onDmg  = calcDamage(calcHitFields(ev, onOv,  onSet,  dcEffectLevelOverrides), dcBonus, dcDisabled);
            if (offDmg === onDmg && i === 0) {
                console.warn('[EI] pot row recompute flat:', ef.name,
                    '| table rows:', dcPotLevels.size, '| potKey:', ef.key,
                    '| bonus present:', !dcEffectsDisabled.has(ef.key));
            }
            if (isAdded) { totalWith += offDmg; totalWithout += onDmg; }
            else         { totalWith += onDmg;  totalWithout += offDmg; }
        }
        return { totalWith, totalWithout, hitCount, affectedHits, maxStacks: 1, isAdded };
    }

    // ── Emblem skill rows: composite impact ─────────────────────────────────
    // A skill-affix shortcut row (buildRecordEmblemEffects configId 950000000
    // + teamIdx*100000 + gemIdx*100 + gemSlot, display-only, no stat of its
    // own) removes the emblem's +lv from the skill-level table when disabled
    // (dcSkillRowBonus → dcSkillEffectiveLevel). That rescales every hit and
    // skill-scaled effect entry resolving through that char+slot, so like the
    // pot rows the impact is computed as an explicit both-directions recompute
    // (off = key added to the disabled set, on = key removed).
    if (ef.displayOnly && ef.configId >= 950000000 && ef.configId < 960000000) {
        const charId = ef._charId != null ? Number(ef._charId) : null;
        const gemSlot = (ef.configId - 950000000) % 100;
        // gem affix slot 1..4 → skillSlotType / ActionKey (5=Normal, 2=Skill,
        // 3=Assist, 4=Ult) — same mapping the level table builds with.
        const slot = (typeof GEM_SLOT_TO_ACTION !== 'undefined' ? GEM_SLOT_TO_ACTION[gemSlot]
            : ({ 1: 5, 2: 2, 3: 3, 4: 4 })[gemSlot]) ?? gemSlot;
        const slotOf = (rawSlot, owner) =>
            dcSkillSlotFor(rawSlot, null, dcAttackerRoleSlot(owner)) === slot;
        // A hit is affected when its own level scaling goes through the
        // char+slot (levelTypeData 3 hits) OR it carries a skill-scaled
        // effect/once-attr entry owned by the char whose slot resolves here —
        // the same resolution dcGetLevelOverride applies.
        const hasFamily = (ev) => {
            const evChar = dcEventCharId(ev);
            const hc = ev.HitConfig || {};
            if (hc.levelTypeData === 3 && evChar === charId
                && dcSkillSlotFor(hc.levelData, hc.mainOrSupport) === slot) return true;
            const fam = (ev.AttackerEffects?.effects || [])
                .concat(ev.DefenderEffects?.effects || [])
                .concat(ev.AttackerRecord?.effects || []);
            for (const e of fam) {
                if (!allowedEffectTypes.includes(e.effectType)) continue;
                const rawSlot = (e.levelTypeData === 3) ? e.levelData : dcSkillScaled.get(e.configId);
                if (rawSlot == null) continue;
                const owner = dcEffectOwnerCharId(e.configId) ?? evChar;
                if (owner === charId && slotOf(rawSlot, owner)) return true;
            }
            for (const dict of [ev.AttackerAttrDict, ev.DefenderAttrDict]) {
                if (!Array.isArray(dict)) continue;
                for (const e of dict) {
                    const rawSlot = (e.levelTypeData === 3) ? e.levelData : dcSkillScaled.get(e.configId);
                    if (rawSlot == null) continue;
                    // once-attr rows resolve per the hit's attacker (dcGetLevelOverride)
                    if (evChar === charId && slotOf(rawSlot, evChar)) return true;
                }
            }
            return false;
        };
        for (let i = 0; i < baseline.length; i++) {
            const { ev, withDmg } = baseline[i];
            if (!hasFamily(ev)) { totalWith += withDmg; totalWithout += withDmg; continue; }
            affectedHits++;
            const offSet = new Set(dcEffectsDisabled); offSet.add(ef.key);
            const onSet  = new Set(dcEffectsDisabled); onSet.delete(ef.key);
            const offDmg = calcDamage(calcHitFields(ev,
                dcApplyEffectOverrides(ev, offSet, dcEffectLevelOverrides),
                offSet, dcEffectLevelOverrides), dcBonus, dcDisabled);
            const onDmg  = calcDamage(calcHitFields(ev,
                dcApplyEffectOverrides(ev, onSet,  dcEffectLevelOverrides),
                onSet,  dcEffectLevelOverrides), dcBonus, dcDisabled);
            if (isAdded) { totalWith += offDmg; totalWithout += onDmg; }
            else         { totalWith += onDmg;  totalWithout += offDmg; }
        }
        return { totalWith, totalWithout, hitCount, affectedHits, maxStacks: 1, isAdded };
    }

    // coeff: subtract the effect (-1) when it's normally present; add it (+1) when it's disabled
    const coeff = isAdded ? 1 : -1;

    for (let i = 0; i < baseline.length; i++) {
        const { ev, withOverrides, withDmg } = baseline[i];

        totalWith += withDmg;

        // Hit is from a disabled Potentials group — already 0 in totalWith,
        // must also contribute 0 to totalWithout so it doesn't skew the delta.
        if (withOverrides._potentialsDisabled) {
            continue;
        }

        const delta = eiResolveEffectDelta(ev, ef);
        if (!delta) {
            totalWithout += withDmg;
            continue;
        }

        if (delta.stacks > maxStacks) maxStacks = delta.stacks;

        affectedHits++;
        const altOverrides = eiPatchStats(withOverrides, ef, ev, delta, coeff);
        const altFields    = calcHitFields(ev, altOverrides);
        const altDmg       = calcDamage(altFields, dcBonus, dcDisabled);
        totalWithout += altDmg;
    }

    return { totalWith, totalWithout, hitCount, affectedHits, maxStacks, isAdded };
}

// Build rows for all effects.
// Baseline is computed once and shared across all eiComputeEffect calls.
function eiComputeAll() {
    const t0 = performance.now();

    const effects = dcCollectAttrFixEffects(dcFiltered);

    const t1 = performance.now();
    const baseline = eiGetBaseline();
    const t2 = performance.now();

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

    const t3 = performance.now();
    console.log(
        `[EffectImpact] compute done | ` +
        `collectEffects: ${(t1 - t0).toFixed(1)}ms | ` +
        `baseline (${baseline.length} hits): ${(t2 - t1).toFixed(1)}ms | ` +
        `effects (${effects.length}): ${(t3 - t2).toFixed(1)}ms | ` +
        `total: ${(t3 - t0).toFixed(1)}ms`
    );

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

    const _eiRenderStart = performance.now();
    setTimeout(() => {
        eiLastData = eiComputeAll();
        const _eiRenderEnd = performance.now();
        console.log(`[EffectImpact] tab render total: ${(_eiRenderEnd - _eiRenderStart).toFixed(1)}ms`);
        eiRenderTable();
    }, 0);
}

function eiRenderTable() {
    const panel = document.getElementById('eiPanel');
    if (!panel) return;

    let rows = [...eiLastData];

    // Apply free-text search filter (matches effect name, case-insensitive)
    const q = eiSearchQuery.trim().toLowerCase();
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
    const allSourceKeys = [];
    const seenKeys = new Set();
    const sortedForKeys = [...rows].sort((a, b) => {
        const srcA = a.ef.source ?? 'Unknown';
        const srcB = b.ef.source ?? 'Unknown';
        return srcA.localeCompare(srcB);
    });
    for (const r of sortedForKeys) {
        const srcKey = r.ef.source ?? 'Unknown';
        if (!seenKeys.has(srcKey)) {
            seenKeys.add(srcKey);
            allSourceKeys.push({ srcKey, source: r.ef.source ?? 'Unknown' });
        }
    }

    // ── Sibling grouping (Potentials + Discs) ────────────────────────────────
    // Rows belonging to the same "chain" are sorted as one unit: forced
    // adjacent, ranked by the summed gain% when the sort column is gain%, or
    // by the member values otherwise.
    //   Potentials: same name + same source (one potential ladder).
    //   Discs:      all rows of one disc — its "<disc> : Stat n" stat rows
    //               (tableResolver.js buildRecordDiscEffects) and its
    //               "<disc>: Melody|Harmony N - ..." effect rows (disc-buff
    //               decoder) — chained by the disc name before the first ':'.
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
        if (src.includes('Potentials')) {
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
    if (chipsEl) {
        let chipsHtml = '';
        for (const { srcKey, source } of allSourceKeys) {
            const active = !eiHiddenSources.has(srcKey);
            const escapedKey = srcKey.replace(/'/g, "\\'");
            chipsHtml += `<button class="ei-src-chip ei-chip-src ${active ? 'ei-chip-active' : ''}" onclick="eiToggleSourceFilter('${escapedKey}')">${esc(source)}</button>`;
        }
        chipsHtml += `<button class="ei-chip-all" onclick="eiShowAllSources()">All</button>`;
        chipsEl.innerHTML = chipsHtml;
    }

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
        if (eiHiddenSources.has(srcKey)) {
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
                ? `<span class="ei-attr"></span><span class="ei-val">+${ef._skillAddLv || 0} lv</span>`
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
            const escapedSrcKey = srcKey.replace(/'/g, "\\'");
            const sourceCellHtml = j === i
                ? `<td class="ei-td ei-td-source" rowspan="${groupSize}" onclick="eiToggleSourceFilter('${escapedSrcKey}')"><span class="ei-source-name">${esc(ef.source ?? 'Unknown')}</span></td>`
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
    if (eiHiddenSources.has(srcKey)) eiHiddenSources.delete(srcKey);
    else eiHiddenSources.add(srcKey);
    eiRenderTable();
};

window.eiShowAllSources = function() {
    eiHiddenSources.clear();
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

// Render the effect-source filter chips into the left sidebar (used by the
// Analytics tab, which surfaces the Effect Impact source filters too).
function eiRenderSidebarChips() {
    const chipsEl = document.getElementById('eiFilterChips');
    if (!chipsEl) return;
    const effects = dcCollectAttrFixEffects(dcFiltered);
    const seen = new Set();
    const allSourceKeys = [];
    for (const ef of effects) {
        const srcKey = ef.source ?? 'Unknown';
        if (!seen.has(srcKey)) { seen.add(srcKey); allSourceKeys.push({ srcKey, source: ef.source ?? 'Unknown' }); }
    }
    let html = '';
    for (const { srcKey, source } of allSourceKeys) {
        const active = !eiHiddenSources.has(srcKey);
        const escapedKey = srcKey.replace(/'/g, "\\'");
        html += `<button class="ei-src-chip ei-chip-src ${active ? 'ei-chip-active' : ''}" onclick="eiToggleSourceFilter('${escapedKey}')">${esc(source)}</button>`;
    }
    html += `<button class="ei-chip-all" onclick="eiShowAllSources()">All</button>`;
    chipsEl.innerHTML = html;
}

window.eiOnSearchInput = function() {
    const el = document.getElementById('eiSearchInput');
    const v = el ? el.value : '';
    eiSearchQuery = v;
    dcSearchQuery = v;
    const dcVisible = document.getElementById('dmgCalcPanel').classList.contains('visible');
    const eiVisible = document.getElementById('eiPanel').classList.contains('visible');
    if (dcVisible) dcRefilterAndRender(true, false);
    if (eiVisible) eiRenderTable();
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
        eiRender();
        if (typeof renderEffectsPanel === 'function') renderEffectsPanel();
        if (typeof dcRenderTotals === 'function') dcRenderTotals();
    }
    _eiOrigSwitchTab(tab);
};
