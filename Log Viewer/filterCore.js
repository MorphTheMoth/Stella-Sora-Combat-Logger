// ─── filterCore.js ────────────────────────────────────────────────────────────
// Single shared filter state + dropdown engine for the left sidebar.
//
// Previously the Log tab (log.js) and the hit-based tabs (dmgCalc.ui.js) each
// kept a private copy of the same four filters plus their own rebuild logic,
// which is where the "sidebar list doesn't update properly" bugs lived: two
// option-set caches, two reset paths (only one of which cleared the state),
// and a streaming hook that maintained only half of the Dmg Calc dropdowns.
//
// Both "domains" now derive their filtered lists and dropdown options from
// the SAME state via per-domain predicates:
//   - 'log'  — every event (Hits / Buffs / Effects / Skill Casts; Reset and
//              Record entries always pass). Character matching includes buff
//              Owner/Source. Defender auto-follow ranks by hit count.
//   - 'hits' — Type === 'Hit' events only (Dmg Calc / Effect Impact /
//              Analytics share this domain). Character = AttackerDisplay.
//              Defender auto-follow ranks by total damage.
//
// The four <select> elements are shared DOM; only their option lists differ
// per domain, so the applied filter value carries across tab switches.
//
// Invariants enforced here (the fixes for the desync bugs):
//   - a filter state value that is no longer present in the domain's option
//     set is cleared (state + select) BEFORE the filtered list is computed —
//     the invisible-filter desync can't recur;
//   - option lists are diffed against the DOM, so an unchanged list never
//     mutates the <select> (an open dropdown popup is not slammed shut).

// ─── Per-event derived fields (computed once, cached on the event) ────────────
function effType(ev) {
    if (ev._effType === undefined)
        ev._effType = (ev.Type === 'Buff' && ev.SubType === 'Effect') ? 'Effect' : ev.Type;
    return ev._effType;
}

function getChars(ev) {
    if (ev._chars !== undefined) return ev._chars;
    const s = [];
    if (ev.Type === 'Hit') { if (ev.AttackerDisplay) s.push(ev.AttackerDisplay); }
    else if (ev.Type === 'Buff') {
        if (ev.OwnerDisplay || ev.Owner) s.push(cleanOwner(ev.OwnerDisplay || ev.Owner));
        if (ev.SourceDisplay || ev.Source) s.push(cleanOwner(ev.SourceDisplay || ev.Source));
    } else if (ev.Type === 'Skill Cast') { if (ev.Owner) s.push(ev.Owner); }
    ev._chars = s;
    return s;
}

function getSkillName(ev) {
    if (ev._skillName !== undefined) return ev._skillName;
    let n = null;
    if (ev.Type === 'Hit') n = (ev.HitConfig || {}).skillTitle || null;
    else if (ev.Type === 'Buff') n = ev.Name || null;
    else if (ev.Type === 'Skill Cast') n = ev.Name || null;
    ev._skillName = n;
    return n;
}

function getDefender(ev) {
    if (ev._defenders !== undefined) return ev._defenders;
    let d = [];
    if (ev.Type === 'Hit') {
        const name = ev.DefenderDisplay || ev.Defender;
        if (name) d = [cleanOwner(name)];
    }
    ev._defenders = d;
    return d;
}

// ─── Shared filter state ─────────────────────────────────────────────────────
let typeFilter = new Set(['Hit', 'Skill Cast']);
let charFilter = '', skillFilter = '', damageTypeFilter = '', defenderFilter = '';
// Auto mode keeps the defender filter glued to the domain's top defender as
// new events stream in (log: most hits; hits: most damage). Disabled the
// moment the user picks a defender manually (either tab — the select is
// shared), re-enabled only when the opened log changes.
let defenderAuto = true;
// Free-text search shared by the Dmg Calc / Effect Impact / Analytics sidebar
// (the Log tab's Ctrl+F search is separate).
let fcSearchQuery = '';
// Set when a filter changes while the OTHER domain is active; the domain's
// refilter happens on tab entry (switchTab / the tab hooks).
let fcDirtyLog = false;
let fcDirtyHits = false;

function fcActiveDomain() {
    const hits = (typeof activeTab !== 'undefined') &&
        (activeTab === 'dmgcalc' || activeTab === 'effectimpact' || activeTab === 'analytics');
    return hits ? 'hits' : 'log';
}

// ─── Domain definitions ──────────────────────────────────────────────────────
function fcMakeOpts() {
    return { chars: new Set(), skills: new Set(), dmgTypes: new Set(), defenderWeights: new Map() };
}

const fcDomains = {
    log: {
        opts: fcMakeOpts(),
        // Option sets fold from every event (Reset/Record carry none).
        folds: () => true,
        charsOf: ev => getChars(ev),
        defendersOf: ev => getDefender(ev),
        defenderWeight: () => 1,
        matchesTypeChar(ev) {
            if (ev.Type === 'Reset' || ev.Type === 'Record') return true;
            if (typeFilter.size > 0 && !typeFilter.has(effType(ev))) return false;
            if (charFilter && !getChars(ev).includes(charFilter)) return false;
            return true;
        },
        skillOf: ev => getSkillName(ev),
        dmgTypeOf(ev) {
            if (ev.Type === 'Reset' || ev.Type === 'Record') return null;
            return (ev.HitConfig && ev.HitConfig.damageType != null)
                ? String(ev.HitConfig.damageType) : null;
        },
        matchesSkill(ev) {
            if (ev.Type === 'Reset' || ev.Type === 'Record') return true;
            return !skillFilter || getSkillName(ev) === skillFilter;
        },
        matchesDmgType(ev) {
            if (ev.Type === 'Reset' || ev.Type === 'Record') return true;
            if (!damageTypeFilter) return true;
            return !!(ev.HitConfig && ev.HitConfig.damageType != null &&
                String(ev.HitConfig.damageType) === damageTypeFilter);
        },
        matchesDefender(ev) {
            if (ev.Type === 'Reset' || ev.Type === 'Record') return true;
            if (!defenderFilter) return true;
            const d = getDefender(ev);
            return d.includes(defenderFilter) || d.length === 0;
        },
    },
    hits: {
        opts: fcMakeOpts(),
        folds: ev => ev.Type === 'Hit',
        charsOf: ev => {
            const n = ev.AttackerDisplay || ev.Attacker;
            return n ? [n] : [];
        },
        defendersOf: ev => getDefender(ev),
        defenderWeight: ev => (ev.DamageParams && ev.DamageParams.finalDamage) || 0,
        matchesTypeChar(ev) {
            return !charFilter || ((ev.AttackerDisplay || ev.Attacker || '') === charFilter);
        },
        skillOf: ev => (ev.HitConfig || {}).skillTitle || null,
        dmgTypeOf: ev => (ev.HitConfig && ev.HitConfig.damageType != null)
            ? String(ev.HitConfig.damageType) : null,
        matchesSkill(ev) {
            return !skillFilter || ((ev.HitConfig || {}).skillTitle || '') === skillFilter;
        },
        matchesDmgType(ev) {
            if (!damageTypeFilter) return true;
            return !!(ev.HitConfig && ev.HitConfig.damageType != null &&
                String(ev.HitConfig.damageType) === damageTypeFilter);
        },
        matchesDefender(ev) {
            if (!defenderFilter) return true;
            const d = getDefender(ev);
            return d.includes(defenderFilter) || d.length === 0;
        },
    },
};

// ─── Select descriptors (shared DOM, per-domain option sets) ─────────────────
function fcSortNumeric(a, b) { return Number(a) - Number(b); }

const FC_SELECTS = [
    { id: 'charFilter', values: D => D.opts.chars, emptyLabel: 'All Characters', max: 28, stateVal: () => charFilter },
    { id: 'skillFilter', values: D => D.opts.skills, emptyLabel: 'All Skills', max: 28, stateVal: () => skillFilter },
    { id: 'damageTypeFilter', values: D => D.opts.dmgTypes, emptyLabel: 'All Damage Types', format: v => dtName(v), sortFn: fcSortNumeric, max: 28, stateVal: () => damageTypeFilter },
    { id: 'defenderFilter', values: D => D.opts.defenderWeights.keys(), emptyLabel: 'All Defenders', max: 28, stateVal: () => defenderFilter },
];

function fcSyncSelect(id, val) {
    const sel = document.getElementById(id);
    if (sel) sel.value = val;
}

// Render one <select>'s options, diffing against the DOM so an unchanged list
// performs zero mutations (an open popup survives).
function fcRenderSelect(def, D) {
    const sel = document.getElementById(def.id);
    if (!sel) return;
    const items = [...def.values(D)].sort(def.sortFn);
    let html = `<option value="">${def.emptyLabel}</option>`;
    for (const v of items) {
        const text = String(def.format ? def.format(v) : v);
        const disp = text.length > def.max ? text.slice(0, def.max) + '…' : text;
        html += `<option value="${esc(String(v))}"${text.length > def.max ? ` title="${esc(text)}"` : ''}>${esc(disp)}</option>`;
    }
    // Desired options as plain triples for the diff
    const desired = [['', def.emptyLabel, '']];
    for (const v of items) {
        const text = String(def.format ? def.format(v) : v);
        desired.push([String(v), text.length > def.max ? text.slice(0, def.max) + '…' : text, text.length > def.max ? text : '']);
    }
    const curOpts = sel.options ? [...sel.options].map(o => [o.value, o.textContent, o.title || '']) : null;
    const unchanged = !!curOpts && curOpts.length === desired.length &&
        desired.every((d, i) => d[0] === curOpts[i][0] && d[1] === curOpts[i][1] && d[2] === curOpts[i][2]);
    if (!unchanged) sel.innerHTML = html;
    // Selection restore: the state value is canonicalized before the pass, so
    // it is normally present; blank on mismatch as a safety net.
    const cur = def.stateVal();
    const curStr = cur == null || cur === '' ? '' : String(cur);
    let present = curStr === '';
    if (!present && sel.options) {
        for (const o of sel.options) if (o.value === curStr) { present = true; break; }
    }
    sel.value = present ? curStr : '';
}

// Defer option-list rebuilds while the user has the dropdown focused (its
// open popup is closed by any DOM mutation); the pending rebuild runs when
// focus leaves the select.
function fcRenderSelects(domainKey, force) {
    const D = fcDomains[domainKey];
    for (const def of FC_SELECTS) {
        const sel = document.getElementById(def.id);
        if (!sel) continue;
        if (!force && typeof document !== 'undefined' && document.activeElement === sel) {
            if (!sel._fcDefer) {
                sel._fcDefer = true;
                sel.addEventListener('focusout', () => {
                    sel._fcDefer = false;
                    fcRenderSelects(fcActiveDomain(), false);
                }, { once: true });
            }
            continue;
        }
        fcRenderSelect(def, D);
    }
}

// ─── Canonicalization + full pass ────────────────────────────────────────────
// Pre-pass canonicalization: char/defender are checked against a fresh scan
// (not the cached sets) so a domain entered for the first time (empty cached
// sets) doesn't spuriously clear a value that is valid in the data.
function fcCanonicalizePre(domainKey) {
    const D = fcDomains[domainKey];
    if (charFilter) {
        let found = false;
        for (const ev of allEvents) {
            if (!D.folds(ev)) continue;
            if (D.charsOf(ev).includes(charFilter)) { found = true; break; }
        }
        if (!found) { charFilter = ''; fcSyncSelect('charFilter', ''); }
    }
    if (defenderFilter) {
        let found = false;
        for (const ev of allEvents) {
            if (!D.folds(ev)) continue;
            if (D.defendersOf(ev).includes(defenderFilter)) { found = true; break; }
        }
        if (!found) { defenderFilter = ''; fcSyncSelect('defenderFilter', ''); }
    }
}

// Cascading full pass for one domain. Skill options come from the type+char
// filtered list, damage-type options from the type+char+skill filtered list
// (preserving the original applyFilters() narrowing order). Filter state
// values that vanished from their option set are cleared mid-pass, before the
// stages that consume them, so the returned list is always consistent with
// what the selects will show.
function fcFullPass(domainKey) {
    const D = fcDomains[domainKey];
    const O = D.opts;
    O.chars.clear();
    O.dmgTypes.clear();
    O.defenderWeights.clear();
    const typeChar = [];
    for (let i = 0; i < allEvents.length; i++) {
        const ev = allEvents[i];
        if (!D.folds(ev)) continue;
        const chars = D.charsOf(ev);
        for (const c of chars) O.chars.add(c);
        const defs = D.defendersOf(ev);
        for (const d of defs)
            O.defenderWeights.set(d, (O.defenderWeights.get(d) || 0) + D.defenderWeight(ev, d));
        if (D.matchesTypeChar(ev)) typeChar.push(ev);
    }
    // Canonicalize char/defender against the freshly folded sets (before the
    // downstream passes consume them).
    if (charFilter && !O.chars.has(charFilter)) { charFilter = ''; fcSyncSelect('charFilter', ''); }
    if (defenderFilter && !O.defenderWeights.has(defenderFilter)) { defenderFilter = ''; fcSyncSelect('defenderFilter', ''); }
    O.skills.clear();
    for (const ev of typeChar) {
        const n = D.skillOf(ev);
        if (n) O.skills.add(n);
    }
    if (skillFilter && !O.skills.has(skillFilter)) { skillFilter = ''; fcSyncSelect('skillFilter', ''); }
    const out = [];
    for (const ev of typeChar) {
        if (!D.matchesSkill(ev)) continue;
        const dt = D.dmgTypeOf(ev);
        if (dt != null) O.dmgTypes.add(dt);
        if (!D.matchesDmgType(ev)) continue;
        if (!D.matchesDefender(ev)) continue;
        out.push(ev);
    }
    // Canonicalize the damage-type filter against the set the pass just
    // built (char+skill filtered). A vanished value — e.g. "Auto Attacks"
    // selected for a character that has none — is cleared and the pass
    // re-run once, so the list can't stay stuck empty behind a blank
    // dropdown (bounded: the filter is empty on the rerun, no cascade).
    if (damageTypeFilter && !O.dmgTypes.has(damageTypeFilter)) {
        damageTypeFilter = '';
        fcSyncSelect('damageTypeFilter', '');
        return fcFullPass(domainKey);
    }
    return out;
}

// Full refilter for a domain: canonicalize pre-pass (char/defender), then the
// cascade pass (skill + damage type canonicalization included).
function fcRefilterDomain(domainKey) {
    fcCanonicalizePre(domainKey);
    return fcFullPass(domainKey);
}

// ─── Defender auto-follow ────────────────────────────────────────────────────
// In auto mode, glue the defender filter to the domain's top defender (log:
// most hits; hits: most damage). Returns true when the filter changed and the
// caller must refilter.
function fcFollowAutoDefender(domainKey) {
    if (!defenderAuto) return false;
    const weights = fcDomains[domainKey].opts.defenderWeights;
    let top = '', best = 0;
    for (const [d, c] of weights) { if (c > best) { best = c; top = d; } }
    if (!top) return false;
    if (defenderFilter === top) return false;
    defenderFilter = top;
    fcSyncSelect('defenderFilter', top);
    return true;
}

// Re-enable defender auto mode (used when the opened log changes).
function reenableDefenderAuto() {
    defenderAuto = true;
    defenderFilter = '';
    fcSyncSelect('defenderFilter', '');
}

// ─── Reset ───────────────────────────────────────────────────────────────────
// Blank every filter back to its default. Called from resetClientState, which
// is the single wipe used by saved-log switch, clear, cut and resync — so no
// invalidating path can forget it.
function fcResetFilters() {
    typeFilter = new Set(['Hit', 'Skill Cast']);
    charFilter = '';
    skillFilter = '';
    damageTypeFilter = '';
    defenderFilter = '';
    defenderAuto = true;
    fcSearchQuery = '';
    fcDirtyLog = false;
    fcDirtyHits = false;
    for (const key of ['log', 'hits']) {
        const O = fcDomains[key].opts;
        O.chars.clear();
        O.skills.clear();
        O.dmgTypes.clear();
        O.defenderWeights.clear();
    }
    document.querySelectorAll('.type-filter-btn').forEach(b => {
        b.classList.toggle('active', typeFilter.has(b.dataset.type));
    });
    ['charFilter', 'skillFilter', 'damageTypeFilter', 'defenderFilter', 'eiSearchInput'].forEach(id => fcSyncSelect(id, ''));
    // Effect Impact state belongs to the opened log too.
    if (typeof eiHiddenSources !== 'undefined') eiHiddenSources.clear();
    if (typeof eiHideZeroGain !== 'undefined') eiHideZeroGain = true;
    const zb = document.getElementById('eiZeroGainBtn');
    if (zb) zb.classList.remove('ei-chip-active');
}
