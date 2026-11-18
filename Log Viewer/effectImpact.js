// ─── effectImpact.js ──────────────────────────────────────────────────────────
// "Effect Impact" tab: shows each unique effect and how much damage
// it contributes across all filtered hits in the Dmg Calc tab.

// ─── State ────────────────────────────────────────────────────────────────────
let eiSortCol   = 'pctImpact'; // 'name' | 'pctImpact' | 'hitCoverage'
let eiSortDir   = -1;           // -1 = descending, 1 = ascending
let eiLastData  = [];           // cached row data for re-sort without recompute
// Which source groups are hidden (filter-checkboxes); a few sources start
// hidden (see eiSourceHiddenByDefault below)
const eiHiddenSources = new Set();
// Talent bars the user has opened, keyed "<unit>|<talentIndex>". A character's
// arrows carry up to eleven talent rows each (the named passive + ten stat
// nodes), so they render folded into one bar per talent, closed by default.
const eiOpenTalents = new Set();
// Sources hidden by default: the per-character Emblems only. Everything else —
// potentials, skills, talents, discs, notes, record stats, affinity — is shown
// on tab entry, so the impact list starts as the whole picture and the user
// narrows it with the chips.
function eiSourceHiddenByDefault(srcKey) {
    if (typeof srcKey !== 'string') return false;
    return srcKey.endsWith('Emblems');
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
// The "Show 0% gain effects" chip in the Filters sidebar is the visible switch
// (chip lit = zero-gain effects shown). Saved in localStorage, like the two row
// options below: these are view preferences, not state of the opened log.
let eiHideZeroGain = uiPrefBool('ei.hideZeroGain', true);
// Top-bar row options: the potential's icon column (on by default) and the
// per-row hit coverage, affected / total (off by default; with the coverage on
// the gain rides the name's baseline, off it is centred across the row).
let eiShowPotImg = uiPrefBool('ei.showPotImg', true);
let eiShowCoverage = uiPrefBool('ei.showCoverage', false);
// Third row option, off by default: the unit word an effect's value carries
// (`+8.00% base`, `+3.00% pct`, `abs`, and `Origin` on record rows), which sits
// between the value and its `×N` stack count. Off, the stat cell is the number
// alone; on, the word comes back.
let eiShowUnitWord = uiPrefBool('ei.showUnitWord', false);

// Paint the sidebar chip from the flag. Called at load (the chip lives in
// index.html, not in a render) and again whenever the flag moves.
function eiSyncZeroGainChip() {
    const btn = document.getElementById('eiZeroGainBtn');
    if (btn) btn.classList.toggle('ei-chip-active', !eiHideZeroGain);
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', eiSyncZeroGainChip);
} else {
    eiSyncZeroGainChip();
}

window.eiTogglePotImg = function() {
    eiShowPotImg = !eiShowPotImg;
    uiPrefSet('ei.showPotImg', eiShowPotImg);
    eiRenderTable();
};
window.eiToggleCoverage = function() {
    eiShowCoverage = !eiShowCoverage;
    uiPrefSet('ei.showCoverage', eiShowCoverage);
    eiRenderTable();
};
window.eiToggleUnitWord = function() {
    eiShowUnitWord = !eiShowUnitWord;
    uiPrefSet('ei.showUnitWord', eiShowUnitWord);
    eiRenderTable();
};

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

// No-op: the per-hit engine baseline lives in the shared cache
// (ecGetSharedBaseline, emblemsComparison.js) keyed on the full state sig —
// invalidation is handled by its signature check, so renders must NOT nuke it
// (the Dmg Calc what-if sims reuse the same build).
function eiInvalidateCache() {}

function eiGetBaseline(prof) {
    const sig = ecSharedBaselineSig();
    if (_eiBaselineCache && _eiBaselineCache.sig === sig) return _eiBaselineCache.cache;
    // Per-hit intel (the Emblems Comparison's engine, built for THIS tab's
    // disabled set): the disable-only stat state, every level-scaled entry
    // with its ladder + baseline override, the affected sets, the resolved
    // per-configId deltas and the inherited-snapshot aggregation. Shared with
    // the Dmg Calc what-if sims — same sig, one build per state version.
    const hits = ecGetSharedBaseline(prof);
    const cache = new Array(dcFiltered.length);
    for (let i = 0; i < dcFiltered.length; i++) {
        const b = hits[i];
        cache[i] = {
            ev: b.ev,
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
    _eiBaselineCache = { sig: ecSharedBaselineSig(), cache };
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

// Per-(row, hit) contribution cache: keyed on the hit's intel OBJECT (stable
// for unaffected hits — the shared baseline reuses them across toggles) and a
// content-addressed key covering every row parameter the eval reads. WeakMap
// entries drop with rebuilt intels; content keys can't go stale.
const _eiContribCache = new WeakMap();
function eiCachedContrib(b, key, compute) {
    let m = _eiContribCache.get(b.intel);
    if (!m) { m = new Map(); _eiContribCache.set(b.intel, m); }
    let v = m.get(key);
    if (v === undefined) { v = compute(); m.set(key, v); }
    return v;
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
            totalWithout += eiCachedContrib(b, 'snap:' + ef.key, () => {
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
                return dlist.length ? ecAnalyticDamage(b.view, dlist, null) : b.withDmg;
            });
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
            totalWithout += eiCachedContrib(b, 'pot:' + potId + ':' + Lother,
                () => ecLevelNetDamage(b.view, 'pot', potId, Lother));
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
            totalWithout += eiCachedContrib(b, 'skill:' + groupKey + ':' + Lother,
                () => ecLevelNetDamage(b.view, 'skill', groupKey, Lother));
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
            totalWithout += eiCachedContrib(b, 'note:' + noteId + ':' + Lother,
                () => ecLevelNetDamage(b.view, 'note', noteId, Lother));
        }
        return { totalWith, totalWithout, hitCount, affectedHits, maxStacks: 1, isAdded };
    }

    // ── Normal stat effects: one closed-form ± patch per affected hit ───────
    // The delta comes from the per-hit index (the eiResolveEffectDelta
    // mirror); the patch slot mirrors eiPatchStats' dcApplyEffectValue
    // metadata, so element-mismatched rows resolve to a no-op exactly like
    // the stat-clone path does.
    // Wide Blade Arc coupling: toggling P8 itself patches the full
    // conversion (not the row's flat 1%), and toggling any row that writes
    // attacker Auto Attack DMG (attr 56) on a P8-active hit appends the
    // conversion shift as a second op — so AA% rows show their true impact.
    const sideNum = ef.side === 'attacker' ? 0 : 1;
    const isWbaRow = sideNum === 0 && !ef.fromAttrDict && ef.configId === WBA_EFFECT_ID;
    const deltaKey = ef.fromAttrDict
        ? ef.side + ':dict:' + ef.configId + ':' + (ef.valueConfigId ?? '') + ':' + (ef.slotNum ?? 0)
        : ef.side + ':' + ef.configId;
    const coeff = isAdded ? 1 : -1;
    for (let i = 0; i < baseline.length; i++) {
        const b = baseline[i];
        totalWith += b.withDmg;
        if (b.zeroed) continue;
        const delta = b.deltaIdx.get(deltaKey);
        if (!delta && !isWbaRow) { totalWithout += b.withDmg; continue; }
        if (delta && delta.stacks > maxStacks) maxStacks = delta.stacks;
        affectedHits++;
        // P8's own row: single conversion op from the baseline view's AA.
        if (isWbaRow) {
            const st = dcWideBladeState(b.ev, dcEffectsDisabled, false);
            const aaView = dcWideBladeAA(b.view.aStats);
            const amt = st ? dcWideBladeConv(aaView, st.ratio, st.step, st.capEff, st.threshold) : 0;
            if (amt === 0) { totalWithout += b.withDmg; continue; }
            const dmg = eiCachedContrib(b, 'wba:' + (coeff * amt),
                () => ecAnalyticDamage(b.view, [[0, WBA_DST_ATTR, 1, coeff * amt]], null));
            totalWithout += dmg;
            continue;
        }
        const meta = {
            attrType: delta.attrType, subType: delta.subType,
            effectType: ef.effectType, isRecord: ef.isRecordEffect, bySubType: !!ef.fromAttrDict,
        };
        const slot = ecOpSlot(meta, b.view.el);
        if (!slot) { totalWithout += b.withDmg; continue; }
        // Coupled conversion when an AA-writing row moves under active P8.
        let dlist = [[sideNum, slot[0], slot[1], coeff * delta.amount]];
        let ck = sideNum + ':' + slot[0] + ':' + slot[1] + ':' + (coeff * delta.amount);
        if (sideNum === 0 && slot[0] === WBA_SRC_ATTR) {
            const st = dcWideBladeState(b.ev, dcEffectsDisabled, false);
            if (st && !dcEffectsDisabled.has(st.key)) {
                const cop = dcWideBladeCoupledOp(b.view.aStats, st, slot[1], coeff * delta.amount);
                if (cop) { dlist = [dlist[0], cop]; ck += '|' + cop[3]; }
            }
        }
        // the op tuple fully determines the call given b.view — short key
        const dmg = eiCachedContrib(b, ck, () => ecAnalyticDamage(b.view, dlist, null));
        totalWithout += dmg;
    }

    return { totalWith, totalWithout, hitCount, affectedHits, maxStacks, isAdded };
}

// Build rows for all effects.
// Baseline is computed once and shared across all eiComputeEffect calls.
// Result memo: the row list is a pure function of (effect rows, baseline,
// level tables). The first two are themselves cached objects, so identity
// checks are enough; dcLevelStateVersion covers the pot / skill / note tables
// the composite rows read live. Re-opening the tab with nothing changed then
// costs two pointer compares instead of a full row pass.
let _eiRowsCache = { effects: null, baseline: null, ver: -1, rows: null };

function eiComputeAll(prof) {
    let t = performance.now();
    // The cached collector: the level-table rebuilds it performs are a side
    // effect this tab needs (eiGetBaseline reads those tables), and they run on
    // every call; only the per-hit row walk is memoized.
    const effects = dcCollectAttrFixEffectsCached();
    if (prof) t = prof(`collect effects (${effects.length} rows)`, t);
    const baseline = eiGetBaseline(prof);

    const ver = (typeof dcLevelStateVersion !== 'undefined') ? dcLevelStateVersion : 0;
    const cached = _eiRowsCache;
    if (cached.rows && cached.effects === effects && cached.baseline === baseline && cached.ver === ver) {
        if (prof) prof(`row evals (${cached.rows.length} rows) · cached`);
        return cached.rows;
    }

    let tRows = 0;
    const top = [];   // [dt, label] — slowest-row report
    const rows = effects.map(ef => {
        const s = prof ? performance.now() : 0;
        const { totalWith, totalWithout, hitCount, affectedHits, maxStacks, isAdded } = eiComputeEffect(ef, baseline);
        const baseVal  = isAdded ? totalWith    : totalWithout;
        const addedVal = isAdded ? totalWithout : totalWith;
        const dmgDelta  = addedVal - baseVal;
        const pctImpact = baseVal > 0
            ? ((addedVal / baseVal) - 1) * 100
            : (dmgDelta > 0 ? Infinity : 0);
        const hitCoverage = hitCount > 0 ? (affectedHits / hitCount) * 100 : 0;
        if (prof) {
            const dt = performance.now() - s;
            tRows += dt;
            if (dt > 5) top.push([dt, ef.name || ef.key]);
        }
        return { ef, totalWith, totalWithout, dmgDelta, pctImpact, hitCoverage, affectedHits, hitCount, maxStacks, isAdded };
    });

    if (prof) {
        t = prof.dur(`row evals (${effects.length} rows)`, tRows);
        top.sort((a, b) => b[0] - a[0]);
        for (const [dt, name] of top.slice(0, 3)) prof.dur(`  slow row: ${name}`, dt);
    }
    _eiRowsCache = { effects, baseline, ver, rows };
    return rows;
}

// ─── Render ───────────────────────────────────────────────────────────────────
// Guard against recursion: dcRefilterAndRender → dcRefreshEI → eiRender.
let _eiAutoLoading = false;

// Hook for data loading (dataLoader.js): refresh the table when the log state
// changes — saved-log swap (shows the empty panel) and initial-backlog
// completion (recomputes with the new log).
window.eiRefreshIfVisible = function() {
    const el = document.getElementById('eiPanel');
    if (el && el.classList.contains('visible') && typeof eiRender === 'function') eiRender();
};

function eiRender() {
    const panel = document.getElementById('eiPanel');
    if (!panel.classList.contains('visible')) return;

    // Crit mode is tab-derived: this tab (like the Emblems tab) prices effects
    // on the EXPECTED crit multiplier, so crit-rate / crit-damage rows show a
    // gain — see dcSyncCritModeForTab. Re-assert on every render, so a click on
    // the sidebar's Average Crit Rate row here cannot leave the tab on logged
    // per-hit crits while the Emblems tab stays averaged. The tab name is hard
    // coded: `activeTab` is only assigned by the innermost switchTab, i.e. after
    // this render ran.
    if (typeof dcSyncCritModeForTab === 'function') dcSyncCritModeForTab('effectimpact');

    if (!dcFiltered.length) {
        // Auto-load: if no filtered hits yet but hit events exist, build the
        // Dmg Calc filter list first (same as opening the Dmg Calc tab).
        if (!_eiAutoLoading && allEvents.some(e => e.Type === 'Hit')) {
            _eiAutoLoading = true;
            try {
                const _pf = _perfStart('EI');
                dcRefilterAndRender(false, false);
                _pf('auto-load filter');
            } finally { _eiAutoLoading = false; }
            // The dcRefilterAndRender chain doesn't re-invoke eiRender when the
            // Dmg Calc panel is hidden (tabs are exclusive), so the old `return`
            // stranded the empty panel — fall through and compute instead.
            if (!dcFiltered.length) {
                panel.innerHTML = `<div class="ei-empty">No hit events loaded yet — wait for combat data.</div>`;
                return;
            }
        } else {
            panel.innerHTML = `<div class="ei-empty">No hit events loaded yet — wait for combat data.</div>`;
            return;
        }
    }

    panel.innerHTML = `<div class="ei-loading">Computing effect impact…</div>`;

    // No-op since the shared baseline cache moved to a full state-signature
    // check (dcStateVersion covers dcDisabled/dcBonus/the disabled sets;
    // dcFiltered.length covers refilters) — kept so renders don't nuke the
    // cache the Dmg Calc what-if sims reuse.
    eiInvalidateCache();

    setTimeout(() => {
        const _pf = _perfStart('EI');
        eiLastData = eiComputeAll(_pf);
        const t0 = performance.now();
        eiRenderTable();
        _pf.dur('render table (dom)', performance.now() - t0);
        // innerHTML parse is synchronous; style/layout/paint land after, and
        // anything else queued before the frame (e.g. the deferred char
        // deltas) lands inside this window too — read it as an upper bound.
        requestAnimationFrame(() => requestAnimationFrame(() =>
            _pf.dur('render + queued tasks (through first paint)', performance.now() - t0)));
    }, 0);
}

function eiRenderTable() {
    const panel = document.getElementById('eiPanel');
    if (!panel || !eiLastData) return;

    let rows = [...eiLastData];

    // Free-text search (same domain as the Dmg Calc sidebar search). A talent
    // bar matches by its own title too, and then keeps ALL of that talent's
    // rows: the request is the talent ("bullets"), not one of its stat nodes,
    // so the bar opens on the whole talent.
    const q = (typeof fcSearchQuery === 'string' ? fcSearchQuery : '').trim().toLowerCase();
    if (q) rows = rows.filter(r => {
        if ((r.ef.name || '').toLowerCase().includes(q)) return true;
        const t = eiTalentInfoOf(r.ef);
        return !!(t && t.title && `talent ${t.index}: ${t.title}`.toLowerCase().includes(q));
    });

    // 0%-gain rows are hidden unless the chip in the sidebar is on.
    if (eiHideZeroGain) rows = rows.filter(r => !isFinite(r.pctImpact) || r.pctImpact !== 0);

    // Source chips live in the left sidebar; a hidden source drops its rows.
    const allSourceKeys = eiCollectSourceKeys(rows.map(r => r.ef));
    const chipsEl = document.getElementById('eiFilterChips');
    if (chipsEl) chipsEl.innerHTML = eiSourceChipsHtml(allSourceKeys);
    rows = rows.filter(r => !eiIsSourceHidden(r.ef.source ?? 'Unknown'));

    // Level-override badge: shows when a level table moved this effect off the
    // level the log recorded (same rules as the flat table had).
    const efLvlBadge = (ef) => {
        if (ef.isPotentialsGroup || !ef.allValueConfigIds || ef.currentLevelIdx < 0) return '';
        // Disc parts carry their own level chip (Copies / Harmony n) — the ladder
        // badge would guess from valueConfigId arithmetic and disagree with it.
        if (typeof dcDiscPartInfo === 'function' && dcDiscPartInfo(ef)) return '';
        const override = dcGetLevelOverride(ef, ef.side);
        if (!override) return '';
        let diff;
        const overriddenIdx = ef.allValueConfigIds.findIndex(v => v.valueConfigId === override.newValueConfigId);
        if (overriddenIdx >= 0) {
            diff = overriddenIdx - ef.currentLevelIdx;
        } else if (override.newValueConfigId != null && ef.configId != null) {
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

    // Stat sub-line: what the effect changes, in the same shapes the table used.
    // `row` is the computed impact row: the observed stack count lives there
    // (eiComputeEffect's maxStacks), not on the effect entry, so the ×N badge
    // has to read it from the row.
    const statCell = (ef, row) => {
        if (ef.isPotRow) {
            return `<span class="ei-val">${ef.linkPotential.addLv < 0 ? '' : '+'}${ef.linkPotential.addLv} lv</span>`;
        }
        if (ef.displayOnly) {
            if (ef._noteAdd != null) {
                const st = (typeof discNoteStatOf === 'function') ? discNoteStatOf(ef) : null;
                const notes = `${ef._noteAdd < 0 ? '' : '+'}${ef._noteAdd} note${ef._noteAdd !== 1 && ef._noteAdd !== -1 ? 's' : ''}`;
                return st ? `${esc(st.attr ?? '')} <b>${String(st.val).startsWith('-') ? '' : '+'}${st.val}</b> | ${notes}`
                          : `<b>${notes}</b>`;
            }
            return `<b>+${ef._skillAddLv || 0} lv</b>`;
        }
        if (ef.isPotentialsGroup) {
            const nums = [...ef.value].sort((a, b) => a - b);
            const lo = nums[0], hi = nums[nums.length - 1];
            const body = nums.length <= 5 ? nums.map(n => n + '%').join(', ')
                                          : `${lo}% – ${hi}% (${nums.length} hits)`;
            return `Hit Damage <b>${lo === hi ? lo + '%' : body}</b>`;
        }
        const override = dcGetLevelOverride(ef, ef.side);
        const eiSubTypeLabel = (subType, effectType) => {
            if (effectType === ELEMENTTYPE_ATTR_FIX) return 'base';
            if (effectType === ELEMENTTYPE_ATTR_PERCENT_FIX) return 'pct';
            if (subType === 1) return 'base';
            if (subType === 2) return 'pct';
            if (subType === 3) return 'abs';
            return '?';
        };
        const raw = override ? override.newValue : ef.value;
        const overrideSubType = override ? override.newSubType : ef.subType;
        const overrideAttrType = override ? override.newAttrType : ef.attrType;
        const unitWord = ef.isRecordEffect
            ? (overrideSubType === 1 ? 'Origin' : eiSubTypeLabel(overrideSubType, null))
            : eiSubTypeLabel(overrideSubType, ef.effectType);
        // The unit word is the row option "Show Base/Pct": off, the cell is the
        // value alone. A gem's own +lv is a number, not the word, so it stays.
        const gemTxt = ef._gemLevel ? `+${ef._gemLevel}` : '';
        const unitTxt = [eiShowUnitWord ? unitWord : '', gemTxt].filter(Boolean).join(' ');
        const attrLabel = attrName(overrideAttrType != null ? overrideAttrType : ef.attrType);
        const isSmall = raw != null && Math.abs(raw) < 15;
        const valStr = raw != null ? (isSmall ? (raw * 100).toFixed(2) + '%' : String(raw)) : '?';
        const sign = raw != null && raw < 0 ? '' : '+';
        const stacks = (row && row.maxStacks) || ef.maxStacks || 1;
        // The disc's level is on the card head (Copies / H1 / H2), so the rows
        // stay a reading of the effect: value, unit, stacks.
        return `${esc(attrLabel)} <b>${sign}${valStr}</b>` +
            (unitTxt ? ` <span class="ei-unit">${unitTxt}</span>` : '') +
            (stacks > 1 ? ` <span class="ei-stacks" title="Max stacks observed">×${stacks}</span>` : '');
    };

    const pct = r => isFinite(r.pctImpact) ? r.pctImpact : 0;
    const fPct = v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
    const cls = v => v > 0.5 ? 'ei-pos' : v < -0.5 ? 'ei-neg' : 'ei-neutral';
    const sumOf = arr => arr.reduce((a, r) => a + pct(r), 0);

    // ── Grouping: unit → section (Potentials / Skills / Talents / Emblems) ──
    const rec = (typeof getOriginRecord === 'function') ? getOriginRecord() : null;
    const nameToId = new Map();
    if (rec && rec.chars) for (const c of rec.chars) {
        const nm = (typeof resolveActorKey === 'function') ? resolveActorKey('p:' + c.charId) : null;
        if (nm) nameToId.set(String(nm).toLowerCase(), c.charId);
    }
    const TEAM = /^(Affinity|Discs|Notes|Record Stats|Boss Blitz|Unknown)$/;
    const unitOf = (r) => {
        const src = String(r.ef.source || 'Unknown');
        return TEAM.test(src) ? src : src.replace(/\s+(Emblems|Talents|Potentials|Skills)$/, '');
    };
    const subOf = (r) => {
        const m = String(r.ef.source || '').match(/\s+(Potentials|Skills|Talents|Emblems)$/);
        return m ? m[1] : 'Other';
    };
    const SUB_ORDER = ['Potentials', 'Skills', 'Talents', 'Emblems', 'Other'];

    /* "<unit>|<potential name>" -> potId, from the Record's own per-character
       potential list. Rows that do not carry their pot id (a potential's hit
       group, a fixed unlevelled effect) still belong to a named potential, so
       the icon can be resolved by the name the card shows. */
    const potIdByName = new Map();
    if (rec && Array.isArray(rec.chars) && typeof potentialNameById !== 'undefined') {
        for (const c of rec.chars) {
            const unit = (typeof resolveActorKey === 'function') ? resolveActorKey('p:' + c.charId) : null;
            if (!unit) continue;
            for (const p of (c.pots || [])) {
                const potId = Number(p && p[0]);
                const nm = potentialNameById.get(potId);
                if (!potId || !nm) continue;
                potIdByName.set(`${unit}|${String(nm).toLowerCase()}`, potId);
            }
        }
    }

    const units = new Map();
    for (const r of rows) {
        const u = unitOf(r);
        if (!units.has(u)) units.set(u, { name: u, rows: [], subs: new Map() });
        const g = units.get(u);
        g.rows.push(r);
        const s = subOf(r);
        if (!g.subs.has(s)) g.subs.set(s, []);
        g.subs.get(s).push(r);
    }
    const list = [...units.values()];
    const chars = list.filter(g => nameToId.has(g.name.toLowerCase()));
    const team = list.filter(g => !nameToId.has(g.name.toLowerCase()));
    const byGain = (a, b) => sumOf(b.rows) - sumOf(a.rows);
    /* Character cards follow the Record board's deployment order (rec.team,
       then any rec.chars it misses) — the same sequence the Record columns and
       the Emblems Comparison columns use. Ranking the cards by their summed
       gain put the same unit in a different column on every tab. */
    const deployOrder = (rec && Array.isArray(rec.team) && rec.team.length)
        ? rec.team.map(Number)
        : (rec && Array.isArray(rec.chars) ? rec.chars.map(c => Number(c.charId)) : []);
    const slotOf = (g) => {
        const idx = deployOrder.indexOf(nameToId.get(g.name.toLowerCase()));
        return idx < 0 ? deployOrder.length : idx;
    };
    const charsOrdered = [...chars].sort((a, b) => slotOf(a) - slotOf(b));

    /* Every talent's full row set (before the tab's row filters), keyed
       "<unit>|<index>". The talent header describes the TALENT — its main
       effect and the hits it covers — so it reads the unfiltered rows: the
       "0% gain" chip must not blank the main effect of a talent whose passive
       happens not to move damage in this log. */
    const talentAll = new Map();
    for (const r of eiLastData) {
        if (subOf(r) !== 'Talents') continue;
        const info = eiTalentInfoOf(r.ef);
        if (!info) continue;
        const k = `${unitOf(r)}|${info.index}`;
        if (!talentAll.has(k)) talentAll.set(k, []);
        talentAll.get(k).push(r);
    }

    /* Potential icon for a row: the potential that owns the effect — its own
       row (linkPotential), the level source the collector resolved for it
       (dcEffectPot), or the Record's potential of that name for the rows that
       carry neither. Rows that belong to no potential (skills, discs, talents)
       get no icon slot at all: their name starts right after the gain column. */
    const potIdOfRow = (ef, unit, displayName) => {
        let potId = ef?.linkPotential?.potId ?? ef?.levelSource ?? null;
        if (potId == null && displayName) {
            potId = potIdByName.get(`${unit}|${String(displayName).toLowerCase()}`) ?? null;
        }
        return potId;
    };
    const potIconHtml = (potId) => (potId == null || typeof recPotUrl !== 'function') ? '' :
        `<span class="ei-icon"><img src="${recPotUrl(potId)}" alt="" loading="lazy"` +
        ` onerror="this.classList.add('is-failed')"></span>`;

    /* One row of the impact list — shared by the unit cards and the disc cards.
       Gain on the left in its own column, the potential's icon beside it (when
       there is one), the effect's name to its right. nameOverride replaces the
       row's table name (talent rows drop the "<char> / Talent N: " prefix their
       bar shows). */
    const rowHtml = (r, nameOverride, unit) => {
        const added = r.isAdded
            ? ` <span class="ei-added-badge" title="Toggled OFF in Dmg Calc — this is what adding it back contributes">+added</span>`
            : '';
        const shown = nameOverride ?? r.ef.name;
        const icon = eiShowPotImg ? potIconHtml(potIdOfRow(r.ef, unit ?? unitOf(r), shown)) : '';
        const cov = eiShowCoverage ? `<span class="ei-ucov">${r.affectedHits}/${r.hitCount}</span>` : '';
        return `<div class="ei-urow${icon ? '' : ' is-flat'}${eiShowCoverage ? '' : ' no-cov'}">` +
            `<span class="ei-ugain ${cls(pct(r))}">${fPct(pct(r))}</span>` +
            icon +
            `<span class="ei-uname">${esc(shown)}${added}${efLvlBadge(r.ef)}</span>` +
            cov +
            `<span class="ei-ustat">${statCell(r.ef, r)}</span>` +
            `</div>`;
    };

    /* ── Talents: one foldable row per talent ──
       Every effect a talent grants lives under the same "<char> Talents" source
       and carries the talent's index, so a character's five talents produced up
       to 55 flat rows (5 named passives + 10 stat nodes each). Fold the rows by
       that index: the talent's header is ONE MORE ROW of the card's list — the
       same name/gain/two-line layout as the effect rows it contains, with the
       talent's own name in the name slot, its stats summarised on the second
       line and its whole impact on the right — and the body lists the
       individual rows one level in. Collapsed by default: five rows per
       character instead of the wall of rows. Open state lives in eiOpenTalents,
       so a re-render keeps it. */
    const talentBlock = (unit, t) => {
        const key = `${unit}|${t.index}`;
        const open = eiOpenTalents.has(key);
        const all  = talentAll.get(key) || t.rows;
        const whole = eiTalentGroupPct(unit, t.index, all);
        const total = whole != null ? whole : sumOf(all);
        const label = t.title ? `Talent ${t.index}: ${t.title}` : `Talent ${t.index}`;
        /* Second line: the talent's MAIN effect only — the named passive that
           gives the talent its title. The stat nodes underneath it are the
           sub-rows, listed when the fold is open; summarising them here too
           would repeat the body. */
        const main = t.title
            ? all.find(r => rowName(r, unit).toLowerCase() === String(t.title).toLowerCase()) || null
            : null;
        const statLine = main ? statCell(main.ef, main) : '';
        const covHits = main ? (main.affectedHits || 0)
            : all.reduce((m, r) => Math.max(m, r.affectedHits || 0), 0);
        const covAll  = all.length ? (all[0].hitCount || 0) : 0;
        return `<div class="ei-talent${open ? ' is-open' : ''}" data-ei-talent="${esc(key)}">` +
            `<button type="button" class="ei-urow is-flat ei-talent-head${eiShowCoverage ? '' : ' no-cov'}" title="${esc(label)}" aria-expanded="${open ? 'true' : 'false'}">` +
                `<span class="ei-talent-chev" aria-hidden="true">${open ? '▾' : '▸'}</span>` +
                `<span class="ei-ugain ${cls(total)}">${fPct(total)}</span>` +
                // A talent owns no potential: no icon slot, the name sits right
                // after the gain column like any other icon-less row.
                `<span class="ei-uname">${esc(label)}</span>` +
                (eiShowCoverage ? `<span class="ei-ucov">${covHits}/${covAll}</span>` : '') +
                `<span class="ei-ustat">${statLine}</span>` +
            `</button>` +
            `<div class="ei-talent-body">` +
                [...t.rows].sort((a, b) => pct(b) - pct(a))
                    .map(r => rowHtml(r, rowName(r, unit), unit)).join('') +
            `</div>` +
        `</div>`;
    };

    /* Split a character's Talents rows by talent. Rows without a resolvable
       talent index keep the old flat treatment under their own bar. */
    const talentRows = (rowsIn) => {
        const byIndex = new Map();
        const rest = [];
        for (const r of rowsIn) {
            const info = eiTalentInfoOf(r.ef);
            if (!info) { rest.push(r); continue; }
            if (!byIndex.has(info.index)) byIndex.set(info.index, { index: info.index, title: info.title, rows: [] });
            byIndex.get(info.index).rows.push(r);
        }
        return { groups: [...byIndex.values()].sort((a, b) => a.index - b.index), rest };
    };

    /* Rows repeat what the card already says: the unit name in a "<Unit> / "
       prefix, and for talents the talent number ("Talent 3: …" — the folded bar
       names it). Strip both here, for this tab only. Only strips when the text
       before the slash is the card's own unit, so a name with a slash of its own
       is left alone. */
    const stripUnitName = (nm, unit) => {
        const s = String(nm || '');
        const i = s.indexOf('/');
        if (i <= 0) return s;
        if (s.slice(0, i).trim().toLowerCase() !== String(unit || '').trim().toLowerCase()) return s;
        return s.slice(i + 1).trim() || s;
    };
    const rowName = (r, unit) => eiTalentRowName({ name: stripUnitName(r.ef.name, unit) }) + eiNoteLevelTag(r.ef);

    /* ── Potentials: one foldable row per potential ──
       A potential reaches the card as several rows, never one: each effect it
       grants is its own row (same name, one per ladder level / side) and the
       damage it deals arrives as a Potentials hit group named by the
       potential's own title. They all resolve to the same potential id — the
       row's `levelSource`, its `linkPotential`, or the Record's pot of that
       name — so the section folds them into one bar per potential, the way a
       character's rows fold per talent and a disc card's per part. */
    const potKeyOfRow = (r, unit) => {
        const shown = stripUnitName(r.ef.name, unit) || String(r.ef.name || 'Potential');
        const potId = potIdOfRow(r.ef, unit, shown);
        if (potId != null) {
            const named = (typeof potentialNameById !== 'undefined' && potentialNameById.get)
                ? potentialNameById.get(Number(potId)) : null;
            return { key: 'pot:' + potId, potId: Number(potId), label: named || shown };
        }
        // A row with no resolvable id (a fixed unlevelled effect, a hit group
        // whose title the Record does not list) still belongs to the potential
        // it is named after.
        return { key: 'potname:' + unit + '|' + shown.toLowerCase(), potId: null, label: shown };
    };

    /* A fold body row whose name is the fold's OWN title — a potential's effect
       row, a disc part's effect row — collapses to one line: the header already
       names the group, so the reading takes the name slot, and what tells these
       rows apart is the value (a level, a side, a Param), never a title. A row
       named otherwise keeps the normal two-line shape. */
    const foldReadingRow = (r, name, label, unit) => {
        if (String(name).trim().toLowerCase() !== String(label || '').trim().toLowerCase()) {
            return rowHtml(r, name, unit);
        }
        const added = r.isAdded
            ? ` <span class="ei-added-badge" title="Toggled OFF in Dmg Calc — this is what adding it back contributes">+added</span>`
            : '';
        const cov = eiShowCoverage ? `<span class="ei-ucov">${r.affectedHits}/${r.hitCount}</span>` : '';
        return `<div class="ei-urow is-flat ei-fold-child">` +
            `<span class="ei-ugain ${cls(pct(r))}">${fPct(pct(r))}</span>` +
            cov +
            `<span class="ei-uname">${statCell(r.ef, r)}${added}${efLvlBadge(r.ef)}</span>` +
        `</div>`;
    };
    const potBodyRow = (r, unit, label) => foldReadingRow(r, rowName(r, unit), label, unit);

    /* The fold itself: one bar per potential, shaped exactly like the talent
       bars (same .ei-talent wrapper, same caret in the gutter, same one-level
       step for the body) so the two folds read as one mechanism. */
    const potBlock = (unit, p) => {
        const open = eiOpenTalents.has(p.key);
        const total = p.pct != null ? p.pct : sumOf(p.rows);
        // Second line: the strongest row's stat reading, the same shape a disc
        // part's fold uses (a potential has no single "main" effect to name).
        const top = [...p.rows].sort((a, b) => pct(b) - pct(a))[0];
        const statLine = top ? statCell(top.ef, top) : '';
        const covHits = p.rows.reduce((m, r) => Math.max(m, r.affectedHits || 0), 0);
        const covAll = p.rows[0].hitCount || 0;
        // The potential's own art fills the row's icon column — this header is
        // the one row that stands for the potential itself.
        const icon = eiShowPotImg ? potIconHtml(p.potId) : '';
        return `<div class="ei-talent${open ? ' is-open' : ''}" data-ei-talent="${esc(p.key)}">` +
            `<button type="button" class="ei-urow ei-talent-head${icon ? '' : ' is-flat'}${eiShowCoverage ? '' : ' no-cov'}"` +
                ` title="${esc(p.label)}" aria-expanded="${open ? 'true' : 'false'}">` +
                `<span class="ei-talent-chev" aria-hidden="true">${open ? '▾' : '▸'}</span>` +
                `<span class="ei-ugain ${cls(total)}">${fPct(total)}</span>` +
                icon +
                `<span class="ei-uname">${esc(p.label)}</span>` +
                (eiShowCoverage ? `<span class="ei-ucov">${covHits}/${covAll}</span>` : '') +
                `<span class="ei-ustat">${statLine}</span>` +
            `</button>` +
            `<div class="ei-talent-body">` +
                [...p.rows].sort((a, b) => pct(b) - pct(a))
                    .map(r => potBodyRow(r, unit, p.label)).join('') +
            `</div>` +
        `</div>`;
    };

    /* Split a section's rows by potential. A potential with a single row has
       nothing to fold, so it keeps the plain row — its gain and stat line stay
       on the surface. Groups and singles then rank together by their own
       number: a fold bar takes its place in the gain order among the single
       rows, the way the flats always ranked, instead of a block of folds with
       the singles pushed to the bottom. */
    const potItems = (rowsIn, unit) => {
        const byKey = new Map();
        for (const r of rowsIn) {
            const id = potKeyOfRow(r, unit);
            if (!byKey.has(id.key)) {
                byKey.set(id.key, { key: id.key, potId: id.potId, label: id.label, rows: [], pct: null });
            }
            byKey.get(id.key).rows.push(r);
        }
        const items = [];
        for (const p of byKey.values()) {
            if (p.rows.length < 2) {
                items.push({ row: p.rows[0], gain: pct(p.rows[0]) });
                continue;
            }
            p.pct = eiRowGroupPct(p.key, p.rows);
            items.push({ group: p, gain: p.pct != null ? p.pct : sumOf(p.rows) });
        }
        items.sort((a, b) => b.gain - a.gain);
        return items;
    };

    const card = (g, isTeam) => {
        const cid = nameToId.get(g.name.toLowerCase()) || null;
        const meta = cid != null && typeof recCharMeta === 'function' ? recCharMeta(cid) : null;
        const tint = meta && typeof REC_ELEM_TINT !== 'undefined' ? (REC_ELEM_TINT[meta.element] || null) : null;
        /* A team-wide bucket has no character behind it, so it is a subsection —
           the app's 10px title bar with its 2px edge — not a column head. */
        const head = isTeam
            ? `<div class="rec-sec-head"><span class="rec-sec-title">${esc(g.name)}</span></div>`
            : `<header class="rec-col-head${tint ? ' has-tint' : ''}"` +
                (tint ? ` style="--rec-tint:${tint}"` : '') + `>` +
                `<span class="rec-portrait">` +
                    (cid != null && typeof recHeadUrl === 'function'
                        ? `<img src="${recHeadUrl(cid)}" alt="" width="60" height="60" onerror="this.classList.add('is-failed')">`
                        : '') +
                    `<span class="rec-portrait-fb" aria-hidden="true">${esc(typeof recInitials === 'function' ? recInitials(g.name) : '')}</span>` +
                `</span>` +
                `<span class="rec-col-id"><span class="rec-col-name"><span class="rec-col-name-t">${esc(g.name)}</span></span></span>` +
                `</header>`;
        const onlyOther = g.subs.size === 1 && g.subs.has('Other');
        /* Every sub is one .ei-fam block. Talents become one block of foldable
           rows — the talent headers read as rows of the same list, so they stay
           inside one .ei-fam (the 6px .ei-fam separator between them would cut
           the list into five sections again). */
        const parts = [];
        for (const s of SUB_ORDER.filter(s => g.subs.has(s))) {
            const subRows = [...g.subs.get(s)].sort((a, b) => pct(b) - pct(a));
            if (s === 'Potentials') {
                // Potentials fold per potential (see potBlock); a potential with
                // one row keeps the plain row, so both kinds share one gain-
                // ranked list.
                const items = potItems(subRows, g.name);
                const subHead = onlyOther ? '' :
                    `<div class="rec-sec-head"><span class="rec-sec-title">Potentials</span></div>`;
                const inner = items.map(it => it.group
                    ? potBlock(g.name, it.group)
                    : rowHtml(it.row, rowName(it.row, g.name), g.name)).join('');
                parts.push(`<div class="ei-fam">${subHead}${inner}</div>`);
                continue;
            }
            if (s === 'Talents') {
                const { groups, rest } = talentRows(subRows);
                // Same section bar Potentials / Skills / Emblems carry above them.
                const subHead = onlyOther ? '' :
                    `<div class="rec-sec-head"><span class="rec-sec-title">Talents</span></div>`;
                let inner = groups.map(t => talentBlock(g.name, t)).join('');
                // Rows whose talent the table cannot resolve stay plain rows.
                inner += rest.map(r => rowHtml(r, rowName(r, g.name), g.name)).join('');
                parts.push(`<div class="ei-fam">${subHead}${inner}</div>`);
                continue;
            }
            const subHead = onlyOther ? '' :
                `<div class="rec-sec-head"><span class="rec-sec-title">${s}</span></div>`;
            parts.push(`<div class="ei-fam">` + subHead + subRows.map(r => rowHtml(r, rowName(r, g.name), g.name)).join('') + `</div>`);
        }
        const body = parts.join('');
        return `<section class="ei-card">${head}${body}</section>`;
    };

    /* ── Discs get their own section, one card per equipped disc ──
       The Discs bucket is 30+ rows on a normal run and made one column of the
       team-wide grid three times taller than the others. Split it by disc (the
       bucket names each row `<Disc>: <effect>`, or `<Disc> : <stat>` for the
       plain stat halves) and give every disc a card headed like a unit — disc
       art in the portrait slot, disc name beside it — so the section reads as a
       row of discs instead of a wall of text. Card order is equip order from the
       origin record, the same order the Record tab lists them in. */
    const discUnit = list.find(g => /^Discs$/i.test(g.name)) || null;
    const discIdByName = new Map();
    const discSlotByName = new Map();
    if (rec && Array.isArray(rec.discStats)) {
        rec.discStats.forEach((d, i) => {
            const nm = typeof resolveRecordDiscName === 'function' ? resolveRecordDiscName(d.id) : null;
            if (!nm) return;
            const k = String(nm).toLowerCase();
            if (!discIdByName.has(k)) { discIdByName.set(k, d.id); discSlotByName.set(k, i); }
        });
    }
    const discGroups = new Map();
    if (discUnit) for (const r of discUnit.rows) {
        const nm = String(r.ef.name || '').split(':')[0].trim() || 'Disc';
        const k = nm.toLowerCase();
        if (!discGroups.has(k)) discGroups.set(k, { name: nm, rows: [] });
        discGroups.get(k).rows.push(r);
    }
    const discSlot = (d) => discSlotByName.has(d.name.toLowerCase())
        ? discSlotByName.get(d.name.toLowerCase()) : 999;
    const discList = [...discGroups.values()]
        .sort((a, b) => discSlot(a) - discSlot(b) || a.name.localeCompare(b.name));
    /* The card head already names the disc, so drop the "<Disc> : " prefix the
       effect rows carry ("Soaring Blue : Stat 1" → "Stat 1"). */
    const stripDiscPrefix = (r) => {
        const nm = String(r.ef.name || '');
        const i = nm.indexOf(':');
        if (i < 0) return r;
        const rest = nm.slice(i + 1).trim();
        return rest ? { ...r, ef: { ...r.ef, name: rest } } : r;
    };
    /* Row order inside a disc card is the disc's own parts, not gain: the two
       stats, then the melody, then harmony 1, harmony 2, and the granted notes.
       Ties (two rows of the same part) keep the strongest first. */
    const discRowRank = (name) => {
        const n = String(name || '');
        if (/^Stat\s*1\b/i.test(n)) return 0;
        if (/^Stat\s*2\b/i.test(n)) return 1;
        /* A disc's granted notes carry the SubNoteSkill title, which itself
           starts with "Melody of …" (older builds prefixed "Note "), so they
           have to be recognised before the disc's own "Melody" part. */
        if (/^Note\b/i.test(n) || /^Melody of\b/i.test(n)) return 5;
        if (/^Melody\b/i.test(n)) return 2;
        if (/^Harmony\s*1\b/i.test(n)) return 3;
        if (/^Harmony\s*2\b/i.test(n)) return 4;
        return 6;
    };
    /* A disc part that owns more than one effect (a melody or harmony applies one
       row per Param: Skill Dmg + Rcd Skill Dmg + Rcd Mark Dmg) folds into one
       header row exactly like a talent bar — same `.ei-talent` wrapper, same
       caret, same one-level step for the body — so the card lists its parts, not
       its rows. Single-effect parts stay plain rows; the stats and the granted
       notes are never folded. */
    const discPartFold = (d, g) => {
        const label = g.rows[0].ef.name;
        const key = `discpart:${d.name}|${label}`;
        const open = eiOpenTalents.has(key);
        const whole = eiRowGroupPct(key, g.rows);
        const total = whole != null ? whole : sumOf(g.rows);
        const top = [...g.rows].sort((a, b) => pct(b) - pct(a))[0];
        const statLine = top ? statCell(top.ef, top) : '';
        const covHits = g.rows.reduce((m, r) => Math.max(m, r.affectedHits || 0), 0);
        const covAll = g.rows[0].hitCount || 0;
        return `<div class="ei-talent${open ? ' is-open' : ''}" data-ei-talent="${esc(key)}">` +
            `<button type="button" class="ei-urow is-flat ei-talent-head${eiShowCoverage ? '' : ' no-cov'}"` +
                ` title="${esc(label)}" aria-expanded="${open ? 'true' : 'false'}">` +
                `<span class="ei-talent-chev" aria-hidden="true">${open ? '▾' : '▸'}</span>` +
                `<span class="ei-ugain ${cls(total)}">${fPct(total)}</span>` +
                `<span class="ei-uname">${esc(label)}</span>` +
                (eiShowCoverage ? `<span class="ei-ucov">${covHits}/${covAll}</span>` : '') +
                `<span class="ei-ustat">${statLine}</span>` +
            `</button>` +
            `<div class="ei-talent-body">${[...g.rows].sort((a, b) => pct(b) - pct(a))
                .map(r => foldReadingRow(r, r.ef.name, label, null)).join('')}</div>` +
        `</div>`;
    };
    const discCard = (d) => {
        const did = discIdByName.has(d.name.toLowerCase()) ? discIdByName.get(d.name.toLowerCase()) : null;
        /* The head's number is the disc's own toggle in the Quick Toggles
           sidebar: every effect of this disc off at once (stat rows + buffs +
           bonus notes + the level moves they cause), so both read the same. */
        const whole = eiDiscWholePct(d.name);
        const total = whole != null ? whole : sumOf(d.rows);
        const art = did != null && typeof recDiscUrl === 'function'
            ? `<img src="${recDiscUrl(did)}" alt="" width="60" height="60" onerror="this.classList.add('is-failed')">`
            : '';
        const fbTag = did != null && typeof recDiscTag === 'function'
            ? recDiscTag(did) : d.name.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase();
        /* The disc's levels, read from the same table the Record tab's steppers
           and the Dmg Calc sidebar edit: copies (Crescendo star) plus the two
           harmony layers. Chips, not controls — the editor lives in Record. */
        const recNow = (typeof getOriginRecord === 'function') ? getOriginRecord() : null;
        const lvlIdx = did != null ? (recNow?.discStats || []).findIndex(x => String(x.id) === String(did)) : -1;
        const lvlInfo = (lvlIdx >= 0 && typeof dcDiscLevelInfo === 'function') ? dcDiscLevelInfo(lvlIdx) : null;
        let lvlChips = '';
        if (lvlInfo) {
            const parts = [`Copies ${lvlInfo.copies}/${lvlInfo.copiesMax}`];
            (lvlInfo.harmony || []).forEach((h, i) => {
                // A layer the record did not run is not levellable (Record's
                // stepper is a readout too) — the chip says so instead of 0/5.
                if (h) parts.push(h.editable === false ? `H${i + 1} off` : `H${i + 1} ${h.level}/${h.max}`);
            });
            lvlChips = `<span class="ei-disc-lvls">` + parts.map(t =>
                `<span class="ei-lvl-chip">${esc(t)}</span>`).join('') + `</span>`;
        }
        return `<section class="ei-card ei-disc-card">` +
            `<header class="rec-col-head">` +
                `<span class="rec-portrait">` + art +
                    `<span class="rec-portrait-fb" aria-hidden="true">${esc(fbTag)}</span>` +
                `</span>` +
                `<span class="rec-col-id"><span class="rec-col-name"><span class="rec-col-name-t">${esc(d.name)}</span></span>` +
                    lvlChips + `</span>` +
                `<span class="ei-disc-sum ${cls(total)}">${fPct(total)}</span>` +
            `</header>` +
            `<div class="ei-fam">${(() => {
                const ordered = [...d.rows].map(stripDiscPrefix)
                    .sort((a, b) => discRowRank(a.ef.name) - discRowRank(b.ef.name) || pct(b) - pct(a));
                const groups = [];
                for (const r of ordered) {
                    const rank = discRowRank(r.ef.name);
                    const last = groups[groups.length - 1];
                    if (last && last.rank === rank) last.rows.push(r);
                    else groups.push({ rank, rows: [r] });
                }
                return groups.map(g => (g.rows.length > 1 && g.rank >= 2 && g.rank <= 4)
                    ? discPartFold(d, g)
                    : g.rows.map(r => rowHtml(r)).join('')).join('');
            })()}</div>` +
            `</section>`;
    };

    /* The row options scroll with the board: the bar lives inside the scroll
       container (and bleeds out to the panel's edges with a negative margin) so
       it goes up with the cards instead of hovering over them. */
    let html = `<div class="ei-cards">` +
        `<div class="rec-top">` +
        `<span class="rec-top-actions">` +
            `<button type="button" class="rec-btn${eiShowPotImg ? ' is-on' : ''}" onclick="eiTogglePotImg()"` +
            ` title="Show each row's potential icon (rows that belong to no potential have none)">Show Pot Img</button>` +
            `<button type="button" class="rec-btn${eiShowCoverage ? ' is-on' : ''}" onclick="eiToggleCoverage()"` +
            ` title="Show how many hits each effect affected (affected / total)">Show Coverage</button>` +
            `<button type="button" class="rec-btn${eiShowUnitWord ? ' is-on' : ''}" onclick="eiToggleUnitWord()"` +
            ` title="Show the base / pct / abs word after each effect's value (the one before the ×N stacks)">Show Base/Pct</button>` +
        `</span>` +
        `</div>`;
    if (!rows.length) {
        html += `<div class="ei-uempty">No effects found in current filter.</div>`;
    } else {
        if (chars.length) {
            html += `<div class="ei-grid">${charsOrdered.map(g => card(g, false)).join('')}</div>`;
        }
        /* The separator is the Team-wide one, with no total on it: the per-disc
           totals live on the cards below. */
        if (discList.length) {
            html += `<div class="ei-team-h">Discs</div>` +
                    `<div class="ei-pack" data-ei-pack>${discList.map(discCard).join('')}</div>`;
        }
        const others = team.filter(g => g !== discUnit);
        if (others.length) {
            /* The remaining team-wide buckets are not one-per-column: they are
               packed into three columns shortest-column-first by eiPackColumns(). */
            html += `<div class="ei-team-h">Team-wide</div>` +
                    `<div class="ei-pack" data-ei-pack>${[...others].sort(byGain).map(g => card(g, true)).join('')}</div>`;
        }
    }
    html += `</div>`;
    panel.innerHTML = html;
    eiPackColumns(panel);
}

/* Whole-group what-if totals, memoized per filter and state version.
   The number on a disc card has to be the one the Quick Toggles row for that
   disc shows. That toggle disables the whole group in a single what-if pass —
   stat rows, melody/harmony buffs, bonus notes and the level-table moves those
   imply — so the arithmetic sum of the individual row percentages (what the
   section bars used to print) lands on a different, larger number.
   The talent bars use the same measure: "talent:<unit>|<n>" is the group key
   that disables one talent (its passive and all of its stat nodes) in one pass,
   so the bar's number answers "what does this talent give me" the way the disc
   cards do. */
let _eiGroupWhole = { filt: null, ver: null, base: 0, map: new Map() };
function eiGroupWholePct(groupKey) {
    if (typeof dcFiltered === 'undefined' || !dcFiltered) return null;
    if (typeof dcCachedHitCalc !== 'function' || typeof dcSimulateGroupToggle !== 'function'
        || typeof ecGetSharedBaseline !== 'function') return null;
    const ver = typeof dcStateVersion !== 'undefined' ? dcStateVersion : 0;
    if (_eiGroupWhole.filt !== dcFiltered) {
        _eiGroupWhole = { filt: dcFiltered, ver: null, base: 0, map: new Map() };
    }
    const st = _eiGroupWhole;
    const wi = ecGetSharedBaseline();
    if (!wi || !wi.length) return null;

    // ── per-group total cache ──────────────────────────────────────────────
    // A group's what-if total is a function of the per-hit INTEL objects and
    // the group's own keys only; the incremental rebuild reuses the unchanged
    // hits' intel objects, so the sum of their build ids (ecBuildSharedHit
    // stamps `_eid`) is an exact signature — same signature means the same
    // total. Without this, toggling ANY row re-priced every disc card in the
    // panel: six full what-if passes over 2.2k hits per toggle.
    let sig = wi.length;
    for (let i = 0; i < wi.length; i++) sig += (wi[i].intel ? (wi[i].intel._eid || 0) : 0);
    const cached = st.map.get(groupKey);
    if (cached && cached.sig === sig) return cached.pct;

    // The base total (the current state) is one cached hit-calc pass; it is
    // re-read whenever the state version moved (the per-hit calc cache is
    // already warm from the formula bar by the time a panel renders).
    if (!(st.base > 0) || st.ver !== ver) {
        let base = 0;
        for (const ev of dcFiltered) base += dcCachedHitCalc(ev).d;
        st.base = base;
        st.ver = ver;
        // stale per-group entries stay in the map — their `sig` can never match
        // again, and wiping the map here would drop the entries that are still
        // valid for groups whose rows this state change did not touch.
    }
    if (!(st.base > 0)) return null;
    const totalIf = dcSimulateGroupToggle(groupKey, false, st.base, wi);
    const pct = totalIf > 0 ? ((st.base / totalIf) - 1) * 100 : null;
    st.map.set(groupKey, { sig, pct });
    return pct;
}
function eiDiscWholePct(name) {
    return eiGroupWholePct('disc:' + name);
}

/* A talent's whole impact, in one analytic pass over the shared baseline.
   Same closed form eiComputeEffect applies to a single row, but every row of
   the talent goes into the same per-hit op list, so rows that write the same
   stat interact inside one evaluation (the talent's real contribution, not the
   sum of its rows' marginals). Running the group-toggle simulation instead
   would re-evaluate every hit of the character once per talent — with five
   talents per character that is far more than the tab's whole row compute.
   Returns null when a row needs an evaluation this pass does not model (pot /
   snapshot / display-only rows — a talent never has one) or the engine is
   unavailable; the caller then falls back to summing the rows. */
let _eiTalentTotals = { sig: null, filt: null, map: new Map() };
/* Generic form: any set of rows that share one row-key namespace can be priced
   as a group. The talent bars use `<unit>|<index>`; a disc card's Melody /
   Harmony fold uses `discpart:<disc>|<part>`. Same analytic pass, same cache. */
function eiRowGroupPct(key, rows) {
    if (typeof eiGetBaseline !== 'function' || typeof ecAnalyticDamage !== 'function'
        || typeof ecOpSlot !== 'function') return null;
    const sig = (typeof ecSharedBaselineSig === 'function') ? ecSharedBaselineSig() : null;
    if (_eiTalentTotals.sig !== sig || _eiTalentTotals.filt !== dcFiltered) {
        _eiTalentTotals = { sig, filt: dcFiltered, map: new Map() };
    }
    if (_eiTalentTotals.map.has(key)) return _eiTalentTotals.map.get(key);

    const baseline = eiGetBaseline(null);
    let totalWith = 0, totalWithout = 0;
    for (let i = 0; i < baseline.length; i++) {
        const b = baseline[i];
        totalWith += b.withDmg;
        if (b.zeroed) { totalWithout += b.withDmg; continue; }
        const dlist = [];
        let unmodelled = false;
        for (const r of rows) {
            const ef = r.ef;
            // A row switched off in Dmg Calc contributes nothing right now, so
            // it is not part of what this talent gives.
            if (r.isAdded) continue;
            if (ef.isPotentialsGroup || ef.fromOwnerSnapshot || ef.isPotRow || ef.displayOnly) {
                unmodelled = true; break;
            }
            const sideNum = ef.side === 'attacker' ? 0 : 1;
            const deltaKey = ef.fromAttrDict
                ? ef.side + ':dict:' + ef.configId + ':' + (ef.valueConfigId ?? '') + ':' + (ef.slotNum ?? 0)
                : ef.side + ':' + ef.configId;
            const delta = b.deltaIdx.get(deltaKey);
            if (!delta) continue;
            const slot = ecOpSlot({
                attrType: delta.attrType, subType: delta.subType, effectType: ef.effectType,
                isRecord: ef.isRecordEffect, bySubType: !!ef.fromAttrDict,
            }, b.view.el);
            if (!slot) continue;
            dlist.push([sideNum, slot[0], slot[1], -delta.amount]);
        }
        if (unmodelled) { _eiTalentTotals.map.set(key, null); return null; }
        if (!dlist.length) { totalWithout += b.withDmg; continue; }
        totalWithout += ecAnalyticDamage(b.view, dlist, null);
    }
    const pct = totalWithout > 0 ? ((totalWith / totalWithout) - 1) * 100 : null;
    _eiTalentTotals.map.set(key, pct);
    return pct;
}

/* A talent bar's number: the same generic pass, keyed `<unit>|<index>`. */
function eiTalentGroupPct(unit, index, rows) {
    return eiRowGroupPct(`${unit}|${index}`, rows);
}

/* Which talent a row belongs to. The Talent.json pass stamps `talentIndex`
   (1..5) and the talent's own title on every effect id it labels — the named
   passive and the ten stat nodes of the same talent share both — so the rows
   fold back into one entry per talent. Rows whose effect id the table does not
   know fall back to the index in their label; with no index either, the row
   stays a plain Talents row. */
function eiTalentInfoOf(ef) {
    // One fold, three surfaces: dmgCalc.ui.js owns the talent grouping (the
    // sidebar's talent blocks and the Record tab's talent rows read it too).
    if (typeof dcTalentOfEffect === 'function') return dcTalentOfEffect(ef);
    const cid = ef?.configId;
    const ei = (cid != null && typeof effectTable !== 'undefined')
        ? effectTable.get(Number(cid)) : null;
    if (ei && ei.talentIndex != null) {
        return { index: Number(ei.talentIndex), title: ei.talentTitle || null };
    }
    const m = /Talent (\d+): /.exec(String(ef?.name || ''));
    return m ? { index: Number(m[1]), title: null } : null;
}

/* Row label inside a talent bar: the bar already names the talent, so drop the
   "<char> / Talent N: " prefix every row of it carries ("ATK Enhancement"). */
function eiTalentRowName(ef) {
    const nm = String(ef?.name || '');
    const m = /^(?:.*? \/ )?Talent \d+: /.exec(nm);
    return m ? nm.slice(m[0].length) : nm;
}

/* Note rows (SubNoteSkill effects, levelTypeData 5, levelData = note id)
   scale with the note's level table, so the row's value says nothing without
   the level it resolved at: a "Melody of Burst" row reads the same at x12 and
   x40. The suffix is written as the note's multiplier ("x40"), not "Lv 40" —
   the level IS the note's total quantity, and the effect value is the
   per-note value times it; this tab has no level control (unlike the Dmg
   Calc's n/m), so the number rides in the name. It is the same one the Record
   tab's note stepper shows (record total + enabled disc grants + edits,
   dcNoteLevels). Rows with no level-table entry (no record, note never seen)
   stay plain. */
function eiNoteLevelTag(ef) {
    if (!ef || ef.levelTypeData !== 5 || ef.levelData == null) return '';
    if (typeof dcNoteLevels === 'undefined' || typeof dcNoteEffectiveLevel !== 'function') return '';
    const st = dcNoteLevels.get(Number(ef.levelData));
    return st ? ` x${dcNoteEffectiveLevel(st)}` : '';
}

/* Three columns, shortest-column-first: drop the next card into whichever
   column currently ends highest up, so a long card does not leave a hole beside
   it the way a 3-column grid's row-bound layout does. Every [data-ei-pack] grid
   (the disc cards, the team-wide buckets) is packed. The cards are measured
   while still in the grid cells — that is their real column width — then
   re-parented into the columns, all in the same task, so only the balanced
   layout is ever painted. */
function eiPackColumns(panel) {
    if (!panel || !panel.querySelectorAll) return;
    for (const wrap of panel.querySelectorAll('[data-ei-pack]')) {
        const cards = [...wrap.children].filter(el => el.classList.contains('ei-card'));
        if (!cards.length) continue;
        const GAP = 10;
        const heights = cards.map(c => c.getBoundingClientRect().height);
        // A hidden panel measures 0 for everything: round-robin instead of greeding.
        const measured = heights.every(h => h > 0);

        const cols = [0, 1, 2].map(() => {
            const d = document.createElement('div');
            d.className = 'ei-pack-col';
            return d;
        });
        wrap.textContent = '';
        cols.forEach(c => wrap.appendChild(c));

        const acc = [0, 0, 0];
        cards.forEach((c, i) => {
            const k = measured ? acc.indexOf(Math.min(acc[0], acc[1], acc[2])) : i % 3;
            cols[k].appendChild(c);
            acc[k] += heights[i] + GAP;
        });
    }
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
    // "All" really means all: a source that is hidden by default (the character
    // Emblems) has to be opted back in explicitly, so every key in play is
    // recorded as shown instead of just clearing the hides.
    eiHiddenSources.clear();
    const keys = new Set(eiShownSources);
    if (typeof dcCollectAttrFixEffectsCached === 'function') {
        for (const ef of dcCollectAttrFixEffectsCached()) keys.add(ef.source ?? 'Unknown');
    }
    for (const el of document.querySelectorAll('#eiFilterChips [data-ei-src]')) {
        if (el.dataset.eiSrc) keys.add(el.dataset.eiSrc);
    }
    eiShownSources.clear();
    for (const k of keys) eiShownSources.add(k);
    eiRenderTable();
};

// Toggle the "0% gain effects" chip in the Filters sidebar. Active chip =
// zero-gain effects are shown (default). Toggling off filters them from the
// table using the cached eiLastData — no recompute needed.
window.eiToggleZeroGain = function() {
    eiHideZeroGain = !eiHideZeroGain;
    uiPrefSet('ei.hideZeroGain', eiHideZeroGain);
    eiSyncZeroGainChip();
    const panel = document.getElementById('eiPanel');
    if (panel && panel.classList.contains('visible') && eiLastData.length) eiRenderTable();
};

// ─── Source filter chips (shared by the EI table and the Analytics sidebar) ──
// Chip order is the board's order, not the alphabet: a character's four
// sources together first (characters in deployment order, their sources in the
// order the cards list them — Potentials, Skills, Talents, Emblems), then
// Discs, then the team-wide buckets (Affinity, Notes, Record Stats, Boss Blitz,
// Talents, Unknown). Scanning the list therefore walks the team, then the gear,
// then everything that is not owned by one unit.
const EI_CHIP_SUB_RANK = { Potentials: 0, Skills: 1, Talents: 2, Emblems: 3 };
const EI_CHIP_SRC_RE = /^(.*) (Potentials|Skills|Talents|Emblems)$/;

// "Amber Potentials" -> { tier: 0, unit: 'Amber', sub: 'Potentials' }; anything
// that is not a per-character source (Discs, Notes, Affinity, …) -> { tier: 2 }.
function eiChipSourceKind(srcKey) {
    const m = EI_CHIP_SRC_RE.exec(srcKey);
    if (!m) return { tier: 2, unit: null };
    return { tier: 0, unit: m[1], sub: m[2] };
}
// Character slot order for the chips: the Record's deployment order, then any
// record characters it misses (same sequence the cards and the Record/Emblems
// columns use). Names the record does not know sort after the ones it does.
function eiCharSlotOrder() {
    const rec = (typeof getOriginRecord === 'function') ? getOriginRecord() : null;
    const order = new Map();
    let i = 0;
    const add = (charId) => {
        const nm = (typeof resolveActorKey === 'function') ? resolveActorKey('p:' + charId) : null;
        if (nm && !order.has(String(nm))) order.set(String(nm), i++);
    };
    if (rec && Array.isArray(rec.team) && rec.team.length) for (const id of rec.team) add(Number(id));
    if (rec && Array.isArray(rec.chars)) for (const c of rec.chars) add(Number(c.charId));
    return order;
}

// Unique source keys in the tab's own order (source name only — attacker and
// defender grouped together).
function eiCollectSourceKeys(efs) {
    const seen = new Set();
    const allSourceKeys = [];
    for (const ef of efs) {
        const srcKey = ef.source ?? 'Unknown';
        if (!seen.has(srcKey)) { seen.add(srcKey); allSourceKeys.push({ srcKey, source: ef.source ?? 'Unknown' }); }
    }
    const slots = eiCharSlotOrder();
    const kindOf = new Map();
    const kind = (k) => {
        if (!kindOf.has(k)) kindOf.set(k, eiChipSourceKind(k));
        return kindOf.get(k);
    };
    // 0 = a character's own sources, 1 = Discs, 2 = the team-wide buckets.
    const tierOf = (srcKey, k) => (k.tier === 0 ? 0 : (srcKey === 'Discs' ? 1 : 2));
    allSourceKeys.sort((a, b) => {
        const ka = kind(a.srcKey), kb = kind(b.srcKey);
        const ta = tierOf(a.srcKey, ka), tb = tierOf(b.srcKey, kb);
        if (ta !== tb) return ta - tb;
        if (ta === 0) {
            const sa = slots.has(ka.unit) ? slots.get(ka.unit) : 9999;
            const sb = slots.has(kb.unit) ? slots.get(kb.unit) : 9999;
            if (sa !== sb) return sa - sb;
            if (ka.unit !== kb.unit) return ka.unit.localeCompare(kb.unit);
            return EI_CHIP_SUB_RANK[ka.sub] - EI_CHIP_SUB_RANK[kb.sub];
        }
        return a.srcKey.localeCompare(b.srcKey);
    });
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

// Talent bars (Effect Impact) expand/collapse in place: the rows are already in
// the DOM, only the body's visibility flips, so no re-render and no recompute.
// The caret is the app's own ▸/▾ pair (the same glyphs the Dmg Calc source
// groups use), swapped here to keep the closed/open state readable.
document.addEventListener('click', e => {
    const head = e.target.closest('.ei-talent-head');
    const wrap = head && head.closest('.ei-talent');
    if (!wrap) return;
    const open = !wrap.classList.contains('is-open');
    wrap.classList.toggle('is-open', open);
    head.setAttribute('aria-expanded', open ? 'true' : 'false');
    const chev = head.querySelector('.ei-talent-chev');
    if (chev) chev.textContent = open ? '▾' : '▸';
    const key = wrap.dataset.eiTalent || '';
    if (open) eiOpenTalents.add(key); else eiOpenTalents.delete(key);
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
    // The query is shared by every domain; mark the ones we do not re-render
    // below as dirty so they re-apply it on their next render (tab entry).
    fcDirtyLog = true;
    fcDirtyHits = true;
    const logVisible = !!document.getElementById('logPanel')
        && !document.getElementById('logPanel').classList.contains('hidden');
    const dcVisible = document.getElementById('dmgCalcPanel').classList.contains('visible');
    const eiVisible = document.getElementById('eiPanel').classList.contains('visible');
    const ecVisible = document.getElementById('ecPanel')?.classList.contains('visible');
    if (logVisible && typeof refilterAndRender === 'function') {
        fcDirtyLog = false;   // the log domain just recomputed
        refilterAndRender(true, false);
    }
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
    // Defensive (record.js, the outermost wrapper, already synced it): the
    // arriving tab owns the crit mode, and this tab must never compute against
    // the one the tab we just left used.
    if (typeof dcSyncCritModeForTab === 'function') dcSyncCritModeForTab(tab);
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
