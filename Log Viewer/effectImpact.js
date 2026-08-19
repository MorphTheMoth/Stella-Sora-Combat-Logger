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
            if (cid === ef.configId && String(vcid) === String(ef.valueConfigId ?? '')) {
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
        const sideList = ef.side === 'attacker' ? ev.AttackerEffects?.effects : ev.DefenderEffects?.effects;
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
        const override = dcEffectLevelOverrides?.get(ef.key);
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
          if (delta.subType === 1)      copy.base = (copy.base || 0) + delta.amount * coeff;
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
          if (delta.subType === 1)      fresh.base = delta.amount * coeff;
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
function eiRender() {
    const panel = document.getElementById('eiPanel');
    if (!panel.classList.contains('visible')) return;

    if (!dcFiltered.length) {
        panel.innerHTML = `<div class="ei-empty">No hits loaded — open the Dmg Calc tab first and apply filters.</div>`;
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

    const efLvlBadge = (ef) => {
        if (ef.isPotentialsGroup || !ef.allValueConfigIds || ef.currentLevelIdx < 0) return '';
        const override = dcEffectLevelOverrides?.get(ef.key);
        if (!override) return '';
        const overriddenIdx = ef.allValueConfigIds.findIndex(v => v.valueConfigId === override.newValueConfigId);
        if (overriddenIdx < 0) return '';
        const diff = overriddenIdx - ef.currentLevelIdx;
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

    // ── Sibling potentials grouping ───────────────────────────────────────────
    // Effect rows from the same potential (same name + same source) are sorted as
    // one unit: forced adjacent, ranked by the higher member's value — or by the
    // summed gain% when the sort column is gain%.
    const siblingGroups = new Map(); // key `${source}\u0000${name}` -> rows[]
    const unitOf = new Map();        // row -> its sibling group (if any)
    for (const r of rows) {
        if (r.ef.isPotentialsGroup) continue;
        const src = r.ef.source ?? '';
        if (!src.includes('Potentials')) continue;
        const key = `${src}\u0000${r.ef.name}`;
        let g = siblingGroups.get(key);
        if (!g) { g = []; siblingGroups.set(key, g); }
        g.push(r);
        unitOf.set(r, g);
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

    // Sort units: source → side → chosen column
    units.sort((a, b) => {
        const rA = a[0], rB = b[0];
        const srcA = rA.ef.source ?? 'Unknown';
        const srcB = rB.ef.source ?? 'Unknown';
        if (srcA !== srcB) return srcA.localeCompare(srcB);
        if (rA.ef.side !== rB.ef.side) return rA.ef.side === 'attacker' ? -1 : 1;
        if (eiSortCol === 'name') {
            return eiSortDir * rA.ef.name.localeCompare(rB.ef.name);
        }
        let va = unitSortVal(a);
        let vb = unitSortVal(b);
        if (!isFinite(va)) va = 1e18;
        if (!isFinite(vb)) vb = 1e18;
        return eiSortDir * (vb - va);
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

            const statCellContent = ef.isPotentialsGroup
                ? `<span class="ei-attr">Hit Damage</span><span class="ei-val">${ef.value.map(num => `${num}%`).join(', ')}</span>`
                : (() => {
                    const override = dcEffectLevelOverrides?.get(ef.key);
                    const subLabel = ef.subType === 1 ? 'base' : ef.subType === 2 ? 'pct' : ef.subType === 3 ? 'abs' : '?';
                    const attrLabel = ef.attrType != null ? attrName(ef.attrType) : '?';
                    const raw = override ? override.newValue : ef.value;
                    const overrideSubType = override ? override.newSubType : ef.subType;
                    const overrideAttrType = override ? override.newAttrType : ef.attrType;
                    const displaySubLabel = overrideSubType === 1 ? 'base' : overrideSubType === 2 ? 'pct' : overrideSubType === 3 ? 'abs' : '?';
                    const displayAttrLabel = overrideAttrType != null ? attrName(overrideAttrType) : '?';
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

window.eiOnSearchInput = function() {
    const el = document.getElementById('eiSearchInput');
    eiSearchQuery = el ? el.value : '';
    eiRenderTable();
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
