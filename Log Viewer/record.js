// ─── record.js — "Record" tab ────────────────────────────────────────────────
// The record editor: three fixed character columns (the Boss Blitz team is
// always three units), each with a level stepper on every skill and potential,
// then the record-wide discs and build below. Reads the Origin event through
// getOriginRecord() (falling back to dcSyntheticRecord()) and the dmg-calc
// level tables through dcCharLevelInfo / dcPotLevelInfo / dcSkillLevelInfo.
//
// Every edit writes the same `change` model the Dmg Calc tab uses, so one
// edit moves the recalculation everywhere. Handlers call the shared setters
// (dcSetPotLevel / dcSetSkillLevel / dcSetCharLevel); the resulting
// dcApplyAndRender calls window.RecordRefresh, which patches the rendered
// steppers in place (or re-renders when focus is outside the board).

const _recordOrigSwitchTab = window.switchTab;
window.switchTab = function(tab) {
    // This is the OUTERMOST switchTab wrapper (record.js is the last script in
    // index.html), so it runs before any other tab hook renders. The crit mode
    // is tab-derived (averaged on the Effect Impact / Emblems tabs, logged
    // per-hit crits everywhere else) — settle it first, or the arriving tab
    // computes against the tab we just left.
    if (typeof dcSyncCritModeForTab === 'function') dcSyncCritModeForTab(tab);
    document.getElementById('tabRecord').classList.toggle('active', tab === 'record');
    document.getElementById('recordPanel').classList.toggle('visible', tab === 'record');
    // Switch away first: the Dmg Calc hook rebuilds the shared hit set and the
    // level tables (the right sidebar the Record tab now shows), so the board
    // below renders from current bonuses instead of stale ones.
    _recordOrigSwitchTab(tab);
    if (tab === 'record') window.Record.render();
};

window.Record = {
    render: recordRender,
};

// Called by dcApplyAndRender after any level change — keeps the board in sync
// with edits made from the Dmg Calc sidebar too. When a control inside the
// board has focus a full re-render would steal it, so the rendered steppers
// are patched in place instead (values, "edited" wash, reset button).
window.RecordRefresh = function() {
    const panel = document.getElementById('recordPanel');
    if (!panel || !panel.classList.contains('visible')) return;
    const a = document.activeElement;
    if (a && panel.contains(a)) {
        recPatchAll(panel);
        return;
    }
    recordRender();
};

// A row's floor: the character level and a disc's copies start at 1 —
// potentials and skill slots step down to 0, and for a potential 0 is its
// disabled state (a harmony layer at 0 means the harmony is off). Every place
// that clamps or draws a stepper goes through this, so the − button's "at the
// limit" look can never disagree with what a click actually does.
function recRowMin(row) {
    if (row.kind === 'char' || row.kind === 'copies') return 1;
    return 0;
}

// How far one ± click (or an arrow key in the level field) moves a row. Notes
// are the one family counted in quantity — the level IS the note's total note
// points, and the ladder runs 0..99 — so single steps meant dozens of clicks to
// cross it; they move 5 at a time. Typing in the field still lands on any exact
// value (recSetLevel), so an off-grid level is still reachable.
function recRowStep(row) {
    return (row && row.kind === 'note') ? 5 : 1;
}

// Re-read every rendered stepper from the level tables and update its markup
// without touching the DOM structure (focus, caret and scroll survive).
function recPatchAll(panel) {
    let edited = 0;
    for (const inp of panel.querySelectorAll('.rec-step-val')) {
        const row = recFindRow(inp.dataset.row);
        if (!row) continue;
        if (row.change !== 0) edited++;
        inp.dataset.edit = row.edit;
        if (inp !== document.activeElement) inp.value = recShown(row);
        const step = inp.closest('.rec-step');
        if (step) {
            step.classList.toggle('is-changed', row.change !== 0);
            const min = recRowMin(row);
            const dec = step.querySelector('[data-act="dec"]');
            const inc = step.querySelector('[data-act="inc"]');
            if (dec) dec.classList.toggle('is-limit', row.edit <= min);
            if (inc) inc.classList.toggle('is-limit', row.edit >= row.max);
        }
        const holder = inp.closest('.rec-row, .rec-disc-lvl');
        if (holder) recPatchRowEl(holder, row);
    }
    // Rows without a stepper (fixed-level potentials — editable === false) are
    // not visited above, but their disabled wash has to follow a row click
    // too, so every rendered row is patched once more.
    for (const holder of panel.querySelectorAll('.rec-row[data-row]')) {
        const row = recFindRow(holder.dataset.row);
        if (row) recPatchRowEl(holder, row);
    }
    if (recView.rec && (recView.rec.chars || []).some(ch =>
        recEmblemIsEdited(recView.rec, ch, 1) || recEmblemIsEdited(recView.rec, ch, 2)
        || recEmblemIsEdited(recView.rec, ch, 3))) {
        edited += 1;
    }
    // A talent switched off is an edit like any other: "Reset all" has to be
    // live so the board can put it back (dcResetTalentGroups).
    if ([...dcGroupEffectKeys.keys()].some(k => k === 'talents' || k.startsWith('talent:'))) edited += 1;
    const all = panel.querySelector('[data-act="resetall"]');
    if (all) {
        all.classList.toggle('is-empty', !edited);
        all.disabled = !edited;
        if (!edited) {
            all.classList.remove('is-armed');
            all.textContent = 'Reset all';
        }
    }
    recPatchEmblems(panel);
    recPatchDiscCards(panel);
}

// The disc cards' stat lines only depend on the level tables, but a focused
// stepper means the board is patched instead of rebuilt — so the card's Atk has
// to be repainted here or it keeps the pre-edit number until focus moves.
function recPatchDiscCards(panel) {
    const rec = recView.rec;
    if (!rec || !(rec.discStats || []).length) return;
    const cards = panel.querySelectorAll('.rec-disc');
    cards.forEach((el, i) => {
        const d = rec.discStats[i];
        if (!d) return;
        const holder = el.querySelector('.rec-disc-stats');
        const html = recDiscStatsHtml(d, i);
        if (holder && holder.innerHTML !== html) holder.innerHTML = html;
    });
}

// Keep the emblem cards' per-row edited state in step without re-rendering (the
// selects may hold focus). The select values themselves are already what the
// user picked; only the row highlight and the card's reset button change.
function recPatchEmblems(panel) {
    const rec = recView.rec;
    if (!rec) return;
    for (const card of panel.querySelectorAll('.rec-emb-card')) {
        const charId = Number(card.dataset.embChar);
        const slot = Number(card.dataset.embSlot);
        const ch = (rec.chars || []).find(c => Number(c.charId) === charId);
        if (!ch) continue;
        const edited = recEmblemIsEdited(rec, ch, slot);
        card.classList.toggle('is-empty', !recEmblemGem(ch, slot));
        const logged = recEmblemLoggedRows(rec, ch, slot);
        const liveRows = [];
        card.querySelectorAll('.rec-emb-row').forEach(rowEl => {
            const stat = rowEl.querySelector('.rec-emb-stat');
            const lv = rowEl.querySelector('.rec-emb-lv');
            liveRows.push({ lineKey: stat ? stat.value : '', entryId: lv ? lv.value : '' });
        });
        const mask = recEmblemEditedRowMask(logged, liveRows);
        card.querySelectorAll('.rec-emb-row').forEach((rowEl, i) => {
            rowEl.classList.toggle('is-changed', !!mask[i]);
        });
        const btn = card.querySelector('.rec-emb-reset');
        if (edited && !btn) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'rec-emb-reset';
            b.dataset.act = 'embreset';
            b.dataset.embChar = String(charId);
            b.dataset.embSlot = String(slot);
            b.title = 'Back to the logged emblem';
            b.textContent = '↺';
            card.querySelector('.rec-emb-card-head')?.appendChild(b);
        } else if (!edited && btn) {
            btn.remove();
        }
    }
}

function recPatchRowEl(el, row) {
    const changed = row.change !== 0;
    el.classList.toggle('is-changed', changed);
    el.classList.toggle('is-disabled', recRowOff(row));
    el.title = recRowTitle(row);
    let reset = el.querySelector('.rec-row-reset');
    if (changed) {
        if (!reset || reset.classList.contains('is-empty')) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'rec-row-reset';
            btn.dataset.act = 'reset';
            btn.dataset.row = row.key;
            btn.title = 'Back to the logged level';
            btn.setAttribute('aria-label', `Reset ${row.name}`);
            btn.textContent = '↺';
            if (reset) reset.replaceWith(btn);
            else {
                // Rows carry the reset slot before the stepper; a row patched in
                // place without one goes in at the same place, not at the end.
                const step = el.querySelector('.rec-step');
                if (step) el.insertBefore(btn, step); else el.appendChild(btn);
            }
        }
    } else if (reset && !reset.classList.contains('is-empty')) {
        const span = document.createElement('span');
        span.className = 'rec-row-reset is-empty';
        span.setAttribute('aria-hidden', 'true');
        reset.replaceWith(span);
    }
}

const recView = {
    bound: false,           // panel delegation installed once
    resetTimer: null,       // "Reset all" confirm window
    rec: null,              // the record the board currently shows (rows look up here)
};

// ─── Remote art ──────────────────────────────────────────────────────────────
// Melody icons come from the Nebula Record Builder repo (raw GitHub). Character
// portraits use the _XXL heads from the ssassets bundle instead of Nebula's
// trimmed _XL copies: XXL is the 192×192 source and those only exist in
// ssassets (Nebula's data/heads is published at XL), while potential icons and
// disc art come from the same bundle. Nothing is vendored into this folder;
// every <img> degrades to a letter tile when it fails.
const REC_NEBULA = 'https://raw.githubusercontent.com/MorphTheMoth/Nebula-Record-Builder/main/data/';
const REC_ASSETS = 'https://raw.githubusercontent.com/AutumnVN/ssassets/main/';
const REC_HEAD_VARIANT = '02';

function recHeadUrl(charId) {
    return `${REC_ASSETS}export/assets/assetbundles/icon/head/` +
        `head_${charId}${REC_HEAD_VARIANT}_XXL.webp`;
}
// Used when a character has no XXL head published: a head that exists beats a
// blank slot, and it still comes from the same bundle.
function recHeadFallbackUrl(charId) {
    return `${REC_NEBULA}heads/head_${charId}${REC_HEAD_VARIANT}_XL.webp`;
}
function recPotUrl(potId) {
    return `${REC_ASSETS}potential/${potId}.webp`;
}
function recNoteUrl(noteId) {
    return `${REC_NEBULA}notes/note_${noteId}_S.webp`;
}
function recDiscUrl(discId) {
    // Disc ids arrive as "21XXXX"; the art bundle is keyed on the trailing tid.
    const s = String(discId);
    const tid = s.length === 6 && s.startsWith('21') ? s.slice(2) : s;
    return `${REC_ASSETS}export/assets/assetbundles/icon/outfit/outfit_${tid}_a.webp`;
}

// Element tints, matching Nebula's character-card washes.
const REC_ELEM_TINT = {
    Aqua: 'rgba(0, 255, 255, 0.22)',
    Ignis: 'rgba(255, 80, 40, 0.22)',
    Ventus: 'rgba(100, 200, 100, 0.22)',
    Terra: 'rgba(146, 83, 44, 0.32)',
    Lux: 'rgba(255, 230, 70, 0.28)',
    Umbra: 'rgba(120, 80, 160, 0.22)',
};

function recCharMeta(charId) {
    // Filled by tableResolver.js from the local character.json — no extra fetch.
    if (typeof charMeta !== 'undefined' && charMeta.get) return charMeta.get(Number(charId)) || null;
    return null;
}

function recInitials(name) {
    const parts = String(name).replace(/[^\p{L}\p{N} ]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

function esc2(s) {
    const m = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(s).replace(/[&<>"']/g, c => m[c]);
}

// ─── Row model ───────────────────────────────────────────────────────────────
// Every row exposes three numbers:
//   edit  — the level the stepper steps, i.e. exactly what the dmg-calc
//           setter for that row kind expects.
//   base  — the plain part of the display (`base+bonus`).
//   bonus — the "+N" suffix of the display.
//
// `mode` says how `edit` maps onto the shared dmg-calc setters:
//   'effective' — the setter takes the effective level as-is (potentials and
//                 characters). Potentials: record + emblem/talent grant +
//                 user change, which is also where "6+N" comes from.
//   'base'      — the setter takes the base level and adds the grant itself
//                 (skills: the emblem/talent adds are the visible "+N").
//
// A potential's own ladder stops at level 6; everything above it is the bonus
// level, drawn as "6+1", "6+2", … So + on 6 gives 6+1, then 6+2, 6+3 (the
// simulator caps the effective level at 9).
const REC_POT_MAX = 9;     // simulator clamp in dcPotEffectiveLevel
const REC_POT_BASE = 6;    // potential ladder tops out here; above it is 6+N

function recPotRows(ch) {
    const rows = [];
    for (const p of (ch.pots || [])) {
        const potId = Number(p[0]);
        const recordLv = Number(p[1]) || 0;
        const recordEff = Number(p[2]) || recordLv;
        const info = window.dcPotLevelInfo ? window.dcPotLevelInfo(potId) : null;
        // The level table's own grant is what dcPotEffectiveLevel applies, so
        // it wins over the record's folded difference when both exist.
        const grant = info ? (info.bonus || 0) : Math.max(recordEff - recordLv, 0);
        const change = info ? (info.change || 0) : 0;
        // Effective level, resolved exactly like the damage calc does — the
        // table value when it exists (it also accounts for a disabled emblem
        // pot row), the record's own numbers otherwise. Clamped the same way
        // (0..9) so the board can never show a level the calculator does not
        // actually use.
        const edit = Math.min(Math.max((info && info.eff != null)
            ? info.eff
            : recordLv + grant + change, 0), REC_POT_MAX);
        // Split at the ladder top: the level itself (1..6), then the bonus
        // level on top of it (+1, +2, …).
        const base = Math.min(edit, REC_POT_BASE);
        // Level a disabled potential comes back to: the record's own effective
        // level (ladder + emblem/talent grant), with the user change left out.
        const logged = Math.min(Math.max(recordLv + grant, 0), REC_POT_MAX);
        // Single-level potentials (indices 1-4 / 21-24 — Potential.json says
        // MaxLevel 1) have no levelling row in the game: the emblem affix can't
        // raise them either, so the board shows them read-only.
        const levelable = typeof dcPotLevelable === 'function' ? dcPotLevelable(potId) : true;
        rows.push({
            key: `pot-${ch.charId}-${potId}`,
            kind: 'pot',
            mode: 'effective',
            potId,
            name: (typeof potentialNameById !== 'undefined' && potentialNameById.get(potId))
                || `Potential ${potId}`,
            edit,
            base,
            bonus: edit - base,
            // The record's own emblem/talent grant (record effective − record
            // level) — part of `edit`, surfaced in the tooltip only.
            grant,
            change,
            logged,
            max: levelable ? REC_POT_MAX : 1,
            editable: levelable,
            icon: recPotUrl(potId),
        });
    }
    return rows;
}

// ─── Talents ─────────────────────────────────────────────────────────────────
// One row per talent, not one per effect: a character's five talents own up to
// eleven rows each (the named passive + the ten upgrade nodes), and they are all
// filed under the single "<unit> Talents" source. The fold is the same one the
// Effect Impact tab draws and the sidebar's talent blocks switch — the group key
// is "talent:<unit>|<n>" (dcTalentGroupKey), so a click here and a click there
// are the same switch. A talent has no level: the row is on/off only, which is
// why it carries no stepper (editable === false).
function recTalentRows(ch) {
    const unit = String(ch.charId) === '0' ? null : resolveActorKey('p:' + ch.charId);
    if (!unit || typeof dcTalentGroupsOf !== 'function') return [];
    return dcTalentGroupsOf(unit).map(g => {
        const off = typeof dcTalentOffNow === 'function' ? dcTalentOffNow(unit, g.index) : false;
        return {
            key: `talent-${ch.charId}-${g.index}`,
            kind: 'talent',
            mode: 'toggle',
            unit,
            index: g.index,
            title: g.title || null,
            name: g.title ? `Talent ${g.index}: ${g.title}` : `Talent ${g.index}`,
            count: g.effects.length,
            off,
            edit: 0, base: 0, bonus: 0, change: 0, logged: 0, max: 0,
            editable: false,
            icon: null,
        };
    });
}

// Is this row in its "off" state? The one rule the board and the sidebar share:
// a potential is off at level 0, a talent is off while its group is switched off.
function recRowOff(row) {
    if (!row) return false;
    if (row.kind === 'pot') return row.edit <= 0;
    if (row.kind === 'talent') return !!row.off;
    return false;
}

function recSkillRows(ch) {
    const out = [];
    const list = (ch.skills || []).slice().sort(
        (a, b) => SKILL_SLOT_ORDER.indexOf(Number(a[0])) - SKILL_SLOT_ORDER.indexOf(Number(b[0])));
    for (const s of list) {
        const slot = Number(s[0]);
        const recordLv = Number(s[1]) || 0;
        const recordEff = Number(s[2]) || recordLv;
        const info = window.dcSkillLevelInfo ? window.dcSkillLevelInfo(ch.charId, slot) : null;
        const grant = info ? (info.bonus || 0) : Math.max(recordEff - recordLv, 0);
        const change = info ? (info.change || 0) : 0;
        const loggedMax = Number(s[3]) || 0;
        // The character's own skill cap (GetCharSkillMaxLevel = the upgrade
        // ladder length, 10 for released characters) is where "N+N" splits:
        // the first 10 levels are the skill itself, everything past it is the
        // extra level an emblem/talent grants.
        const skillMax = (info && info.recordMax)
            || (loggedMax > 0 && loggedMax <= 15 ? loggedMax : 10);
        const eff = (info && info.eff != null) ? info.eff : recordLv + grant + change;
        const base = Math.min(eff, skillMax);
        // Effective ceiling of the ± buttons (dcSkillMaxLevel: cap + enabled
        // adds, never below the ladder's absolute 13).
        const cap = Math.max((info && info.max && info.max <= 99 ? info.max : skillMax + grant), eff);
        out.push({
            key: `skill-${ch.charId}-${slot}`,
            kind: 'skill',
            mode: 'effective',
            charId: ch.charId,
            slot,
            name: SKILL_SLOT_NAMES[slot] || ('Skill ' + slot),
            edit: eff,
            base,
            bonus: eff - base,
            grant,
            change,
            max: cap,
            editable: true,
            icon: null,
        });
    }
    return out;
}

function recCharLevelRow(ch) {
    const info = window.dcCharLevelInfo ? window.dcCharLevelInfo(ch.charId) : null;
    const cid = String(ch.charId);
    const lvl = info ? info.effLevel : (ch.level ?? 0);
    return {
        key: `char-${ch.charId}`,
        kind: 'char',
        mode: 'effective',
        charId: ch.charId,
        name: cid === '0' ? 'Unknown' : resolveActorKey('p:' + cid),
        edit: lvl,
        base: lvl,
        bonus: 0,
        grant: 0,
        change: info ? (info.change || 0) : 0,
        max: 91,
    };
}

// ─── Disc editor rows (copies / harmony layers) ──────────────────────────────
// Three independent knobs per equipped disc, one stepper each:
//   copies    — Crescendo star 0..5; melody level = star + 1, plus the disc's
//               flat Atk (DiscExtraAttribute) per star
//   Harmony 1 — SecondarySkill group 1, layer 0..5 (0 = off)
//   Harmony 2 — group 2, same (5★ discs only; 4★ have one, 3★ none)
// Where each lands in the calculation is the disc level table in
// dmgCalc.calc.js; the layer's note requirement is carried in the tooltip and
// stays available through window.dcDiscEditorMeta for a later note↔harmony link.
function recDiscLevelRows(index) {
    const info = window.dcDiscLevelInfo ? window.dcDiscLevelInfo(index) : null;
    if (!info) return [];
    const rows = [];
    const starAtk = (typeof window.dcDiscStarAtk === 'function')
        ? window.dcDiscStarAtk(info.discId, info.copies - 1) : 0;
    const melodyName = info.melody?.levels?.[Math.max(0, Math.min(info.copies, info.melody.levels.length) - 1)]?.name
        || info.melody?.levels?.[0]?.name || 'Melody';
    rows.push({
        key: `disc-${index}-copies`,
        kind: 'copies',
        discIdx: index,
        name: 'Copies',
        label: 'Copies',
        edit: info.copies,
        base: info.copies,
        bonus: 0,
        change: info.copiesChange || 0,
        max: info.copiesMax,
        editable: !!info.editable,
        title: `Crescendo copies ${info.copies}/${info.copiesMax} (logged ${info.copiesRec})` +
            (info.isMain === false
                ? ' · support slot: melody does not apply'
                : ` · ${melodyName} lv ${info.copies}`) +
            (starAtk ? ` · +${starAtk} Atk` : ''),
    });
    (info.harmony || []).forEach((h, i) => {
        if (!h) return;
        const layer = h.level > 0 ? h.layers[h.level - 1] : null;
        const need = layer?.need || {};
        const needTxt = Object.entries(need)
            .map(([nid, n]) => `${subNoteName(Number(nid))} ${n}`)
            .join(', ');
        const layerTxt = h.level > 0 ? (layer?.name || `layer ${h.level}`) : 'off';
        // A layer the record never had active is a readout, not a stepper: its
        // Effect row is trigger/condition-gated (HITTING, TRIGGER_MARK, a target
        // condition…), the viewer cannot evaluate that against a fight that never
        // ran it, and raising it would invent damage as an unattributed
        // team-wide stat. The note needs stay in the tooltip either way.
        const locked = !h.editable;
        rows.push({
            key: `disc-${index}-h${i + 1}`,
            kind: 'harmony',
            discIdx: index,
            slot: i + 1,
            name: `Harmony ${i + 1}`,
            label: `Harmony ${i + 1}`,
            edit: h.level,
            base: h.level,
            bonus: 0,
            change: h.change || 0,
            max: h.max,
            editable: !locked,
            lockedNote: locked ? 'not active in this record — cannot be levelled' : null,
            // recRowTitle appends lockedNote, so the title itself carries only
            // what the row knows (the lock reason is stated once).
            title: locked
                ? `Harmony ${i + 1}` + (needTxt ? ` · needs ${needTxt}` : '')
                : `Harmony ${i + 1} · ${layerTxt} lv ${h.level}/${h.max}` +
                  ` (record: lv ${h.rec})` +
                  (needTxt ? ` · needs ${needTxt}` : ''),
        });
    });
    return rows;
}

// One compact disc-card control line: label, reset slot, stepper. The disc card
// is a third of the board wide, so these rows are the same stepper as the
// character rows with a narrower value box (`.rec-step.is-compact`).
function recDiscLevelLine(row) {
    const reset = row.change !== 0
        ? `<button type="button" class="rec-row-reset" data-act="reset" data-row="${row.key}"` +
          ` title="Back to the logged level" aria-label="Reset ${esc2(row.name)}">↺</button>`
        : '<span class="rec-row-reset is-empty" aria-hidden="true"></span>';
    // A locked part carries no stepper (recStepper returns '' when
    // editable === false), so it prints its state where the value would sit.
    const body = row.editable === false
        ? `<span class="rec-disc-lvl-off">off</span>`
        : reset + recStepper(row);
    return `<span class="rec-disc-lvl" data-row="${row.key}" title="${esc2(recRowTitle(row))}">` +
        `<span class="rec-disc-lvl-name">${esc2(row.label)}</span>` +
        body +
        `</span>`;
}

// Note rows: the build's note totals, one stepper each. The level IS the
// quantity (Item.<note>.2: "increases … based on its total quantity") and each
// level is the next EffectValue ladder row (configId + level*10), so a step
// moves every effect of that note across the log.
function recNoteRows(rec) {
    const out = [];
    const ids = [];
    for (const entry of (rec?.notes || [])) {
        const noteId = Number(Array.isArray(entry) ? entry[0] : entry?.noteId);
        if (noteId && !ids.includes(noteId)) ids.push(noteId);
    }
    ids.sort((a, b) => a - b);
    for (const noteId of ids) {
        if (typeof window.dcNoteLevelInfo !== 'function') break;
        let info = window.dcNoteLevelInfo(noteId);
        if (!info && typeof dcEnsureNoteLevel === 'function') {
            const qty = Number((rec.notes.find(e => Number(Array.isArray(e) ? e[0] : e?.noteId) === noteId) || [])[1]) || 0;
            if (dcEnsureNoteLevel(noteId, qty)) info = window.dcNoteLevelInfo(noteId);
        }
        if (!info) continue;
        out.push({
            key: `note-${noteId}`,
            kind: 'note',
            noteId,
            name: subNoteName(noteId),
            edit: info.eff,
            base: info.eff,
            bonus: 0,
            change: info.change || 0,
            max: info.max,
            editable: true,
            icon: recNoteUrl(noteId),
            title: `${subNoteName(noteId)} lv ${info.eff}` +
                (info.bonus ? ` (${info.recordLv} + ${info.bonus} from discs)` : '') +
                (info.change ? ` · ${info.change > 0 ? '+' : ''}${info.change} edited` : ''),
        });
    }
    return out;
}


// ─── Controls ────────────────────────────────────────────────────────────────
// Idle shows the split form: the row's own ladder cap, then the bonus levels
// on top ("6+2" for a potential at 8, "10+1" for a skill at 11). Focusing the
// field swaps in the plain number the row edits (data-edit), so the suffix is
// presentation only.
function recShown(row) {
    return row.bonus > 0 ? `${row.base}+${row.bonus}` : String(row.base);
}

// "8" → 8, or "6+2" → 8 (both halves are the same level count).
function parseRecLevel(raw) {
    const s = String(raw).trim();
    let m = /^(-?\d+)\s*\+\s*(\d+)$/.exec(s);
    if (m) return parseInt(m[1], 10) + parseInt(m[2], 10);
    m = /^(-?\d+)$/.exec(s);
    return m ? parseInt(m[1], 10) : null;
}

function recStepper(row) {
    const changed = row.change !== 0;
    const cls = 'rec-step' + (changed ? ' is-changed' : '');
    const what = row.kind === 'char' ? `${row.name} level` : row.name;
    // Potentials and skills may step down to 0 — for a potential that is its
    // disabled state; only the character level has a floor of 1.
    const min = recRowMin(row);
    const atMin = row.edit <= min;
    const atMax = row.edit >= row.max;
    // Fixed-level rows (potential indices 1-4 / 21-24 — Potential.json says
    // MaxLevel 1) have no levelling row in the game, so the board shows no
    // level at all for them: no number, no ±.
    if (row.editable === false) return '';
    return `<span class="${cls}">` +
        `<button type="button" class="rec-step-btn${atMin ? ' is-limit' : ''}" data-act="dec"` +
        ` data-row="${row.key}" aria-label="Lower ${esc2(what)}">−</button>` +
        `<input class="rec-step-val" type="text" inputmode="numeric" spellcheck="false"` +
        ` autocomplete="off" data-row="${row.key}" data-edit="${row.edit}"` +
        ` aria-label="${esc2(row.kind === 'char' ? what : what + ' level')}"` +
        ` value="${esc2(recShown(row))}">` +
        `<button type="button" class="rec-step-btn${atMax ? ' is-limit' : ''}" data-act="inc"` +
        ` data-row="${row.key}" aria-label="Raise ${esc2(what)}">+</button>` +
        `</span>`;
}

function recRowTitle(row) {
    // Disc and note rows carry their own title (melody name, harmony layer, note
    // requirement…), so the generic suffixes are appended to that.
    let t = row.title || row.name;
    if (row.bonus > 0) t += ` · lv ${row.base} + ${row.bonus} bonus level${row.bonus === 1 ? '' : 's'}`;
    if (row.kind === 'note') t += ` · ±${recRowStep(row)} per step (type an exact level)`;
    if (row.editable === false) t += row.lockedNote ? ` · ${row.lockedNote}` : ' · no levelling row in the game';
    else if (row.change !== 0) t += ` · ${row.change > 0 ? '+' : ''}${row.change} edited`;
    if (row.kind === 'pot') {
        t += row.edit <= 0 ? ' · disabled — click to enable' : ' · click to disable';
    } else if (row.kind === 'talent') {
        t += ` · ${row.count} effect${row.count === 1 ? '' : 's'}`
            + (row.off ? ' · disabled — click to enable' : ' · click to disable');
    }
    return t;
}

function recRow(row) {
    const changed = row.change !== 0;
    // A potential at level 0 and a talent whose group is off are both the
    // row's disabled state: the row dims, the name is struck through, and a
    // click anywhere on it toggles it back.
    const disabled = recRowOff(row);
    const cls = 'rec-row' + (changed ? ' is-changed' : '') +
        ((row.kind === 'pot' || row.kind === 'talent') ? ' is-toggle' : '') +
        (disabled ? ' is-disabled' : '');
    // Only potentials have art. Skill rows are named in full, so they carry no
    // icon tile at all — the name simply starts at the row's left edge.
    const art = row.icon
        ? `<span class="rec-art-wrap">` +
            `<img class="rec-art" src="${row.icon}" alt="" width="20" height="26">` +
            `<span class="rec-art-fb" aria-hidden="true">${esc2(recInitials(row.name))}</span>` +
          `</span>`
        : '';
    const reset = changed
        ? `<button type="button" class="rec-row-reset" data-act="reset" data-row="${row.key}"` +
          ` title="Back to the logged level" aria-label="Reset ${esc2(row.name)}">↺</button>`
        : '<span class="rec-row-reset is-empty" aria-hidden="true"></span>';
    return `<div class="${cls}" data-row="${row.key}"` +
        ` title="${esc2(recRowTitle(row))}">` +
        art +
        `<span class="rec-row-name">${esc2(row.name)}</span>` +
        // The ↺ sits on the stepper's left: the +/- group owns the row's right
        // edge, so the column's steppers line up with the header's.
        reset +
        recStepper(row) +
        `</div>`;
}

// Section headers are labels here, not controls: the page is always fully
// expanded so every level is reachable without opening anything first.
function recSection(title, rows, extraClass) {
    if (!rows.length) {
        return `<section class="rec-sec ${extraClass || ''}">` +
            `<div class="rec-sec-head"><span class="rec-sec-title">${esc2(title)}</span></div>` +
            `<div class="rec-sec-empty">None in this record.</div></section>`;
    }
    return `<section class="rec-sec ${extraClass || ''}">` +
        `<div class="rec-sec-head"><span class="rec-sec-title">${esc2(title)}</span></div>` +
        `<div class="rec-sec-body">${rows.map(recRow).join('')}</div>` +
        `</section>`;
}

// ─── Columns ─────────────────────────────────────────────────────────────────
function recColumn(ch) {
    const cid = String(ch.charId);
    const name = cid === '0' ? 'Unknown' : resolveActorKey('p:' + cid);
    const meta = recCharMeta(ch.charId);
    const element = meta?.element || null;
    const tint = element ? (REC_ELEM_TINT[element] || null) : null;

    const lvl = recCharLevelRow(ch);
    const skills = recSkillRows(ch);
    const pots = recPotRows(ch);
    const talents = recTalentRows(ch);

    const head = `<header class="rec-col-head${tint ? ' has-tint' : ''}"` +
        (tint ? ` style="--rec-tint:${tint}"` : '') + `>` +
        `<span class="rec-portrait">` +
            `<img src="${recHeadUrl(ch.charId)}" alt="" width="60" height="60"` +
            ` data-fb="${esc2(recHeadFallbackUrl(ch.charId))}">` +
            `<span class="rec-portrait-fb" aria-hidden="true">${esc2(recInitials(name))}</span>` +
        `</span>` +
        `<span class="rec-col-id">` +
            `<span class="rec-col-name">` +
                `<span class="rec-col-name-t">${esc2(name)}</span>` +
            `</span>` +
        `</span>` +
        `<span class="rec-col-lvl">` +
            // Same lead the rows reserve for their reset button, so this
            // stepper's +/− sit on the same vertical edge as the rows' below.
            `<span class="rec-row-reset is-empty" aria-hidden="true"></span>` + recStepper(lvl) +
        `</span>` +
        `</header>`;

    return `<div class="rec-col" data-col="${esc2(cid)}">` +
        head +
        `<div class="rec-col-body">` +
            recSection('Skills', skills, 'rec-sec-skills') +
            recSection('Potentials', pots, 'rec-sec-pots') +
            // No talents in the record → no section at all: most characters have
            // none, and an empty "None in this record." line per column is noise.
            (talents.length ? recSection('Talents', talents, 'rec-sec-talents') : '') +
        `</div>` +
        `</div>`;
}

// ─── Discs + build ───────────────────────────────────────────────────────────
// Disc stat values arrive either as flat numbers (300 Atk) or as fractions of
// the 1e-4 domain already converted by fmtVal (0.078 = 7.8%). Anything under 2
// is a fraction, so it is printed as a percentage instead of "0.078".
function fmtDiscStat(v) {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return String(v);
    if (n !== 0 && Math.abs(n) < 2) {
        const pct = n * 100;
        const txt = Math.abs(pct) < 10 ? +pct.toFixed(2) : +pct.toFixed(1);
        return `${txt}%`;
    }
    return String(n);
}

// Stat naming/formatting for the record, hoisted out of renderBoard so the
// in-place patch path (a focused stepper keeps the board from re-rendering)
// prints the same text the full render would.
function recStatLabel(k) {
    const idx = typeof RECORD_SKEY_TO_ATTR !== 'undefined' ? RECORD_SKEY_TO_ATTR[k] : null;
    return idx != null ? attrName(idx) : k;
}

function recFmtStatValue(rec, k, v) {
    const ifp = rec?.ifp || 1e-4;
    const isPct = !!(rec?.pct || {})[k];
    const n = isPct && Math.abs(v) > 2 ? v * ifp : v;
    return typeof n === 'number' && !Number.isInteger(n) ? +n.toPrecision(8) : n;
}

// The flat Atk a disc carries at `copies`, from the logged row: the logged value
// already contains the star it was logged at, and DiscExtraAttribute is an
// Atk-only per-star table, so the edit is the difference between the two stars.
// (Max Hp and the rest come from the phase/level Attribute row and do not move
// with copies.) Returns null when the star table does not know the disc.
function recDiscAtkAt(d, index, copies) {
    const logged = Number((d?.attrs || {}).Atk);
    const info = window.dcDiscLevelInfo ? window.dcDiscLevelInfo(index) : null;
    if (!Number.isFinite(logged) || !info || typeof window.dcDiscStarAtk !== 'function') return null;
    const atk = c => window.dcDiscStarAtk(info.discId, Math.max(0, (c || 1) - 1)) || 0;
    return logged + (atk(copies ?? info.copies) - atk(info.copiesRec));
}

// One disc card's stat lines — the same markup for the first render and for the
// patch after a copies edit.
function recDiscStatsHtml(d, index) {
    const rec = recView.rec || (typeof getOriginRecord === 'function' ? getOriginRecord() : null);
    const atk = recDiscAtkAt(d, index);
    const loggedAtk = Number((d?.attrs || {}).Atk);
    return Object.entries(d?.attrs || {}).map(([k, v]) => {
        const isAtk = k === 'Atk';
        const val = (isAtk && atk != null) ? atk : fmtDiscStat(recFmtStatValue(rec, k, v));
        const changed = isAtk && atk != null && atk !== loggedAtk;
        return `<span class="rec-disc-stat${changed ? ' is-changed' : ''}">` +
            `<span>${esc2(recStatLabel(k))}</span><b>${esc2(val)}</b></span>`;
    }).join('');
}

function recDiscCard(d, index, statName, fmtVal) {
    const name = resolveRecordDiscName(d.id);
    const stats = recDiscStatsHtml(d, index);
    const notes = [];
    if (index >= 3 && typeof discBonusNotesFor === 'function') {
        for (const n of discBonusNotesFor(d.id)) {
            // Bare icon + count, aligned to the right of the disc's name. The
            // count stays visible even if the icon cannot load.
            notes.push(`<span class="rec-disc-note" title="${esc2(subNoteName(n.noteId))}">` +
                `<img src="${recNoteUrl(n.noteId)}" alt="" width="16" height="16">` +
                `<b>${n.count}</b></span>`);
        }
    }
    const levelLines = recDiscLevelRows(index).map(recDiscLevelLine).join('');
    return `<article class="rec-disc">` +
        `<span class="rec-disc-art">` +
            `<img src="${recDiscUrl(d.id)}" alt="" width="56" height="56">` +
            `<span class="rec-disc-art-fb" aria-hidden="true">${esc2(recDiscTag(d.id))}</span>` +
        `</span>` +
        `<span class="rec-disc-info">` +
            `<span class="rec-disc-head">` +
                `<span class="rec-disc-name">${esc2(name)}</span>` +
                (notes.length ? `<span class="rec-disc-notes">${notes.join('')}</span>` : '') +
            `</span>` +
            (stats ? `<span class="rec-disc-stats">${stats}</span>` : '') +
            (levelLines ? `<span class="rec-disc-levels">${levelLines}</span>` : '') +
        `</span>` +
        `</article>`;
}

// The four digits that identify a disc — its art's key, and a readable stand-in
// when the art cannot load.
function recDiscTag(discId) {
    const s = String(discId);
    const tid = s.length === 6 && s.startsWith('21') ? s.slice(2) : s;
    return tid.slice(-3);
}

function recDiscsBlock(rec, statName, fmtVal) {
    const all = rec.discStats || [];
    if (!all.length) return '';
    const main = all.slice(0, 3);
    const support = all.slice(3);
    const card = (d, i) => recDiscCard(d, i, statName, fmtVal);
    return `<section class="rec-block">` +
        `<h3 class="rec-block-title">Discs</h3>` +
        (main.length
            ? `<div class="rec-block-sub">Main</div><div class="rec-disc-grid">${
                main.map((d, i) => card(d, i)).join('')}</div>`
            : '') +
        (support.length
            ? `<div class="rec-block-sub">Support</div><div class="rec-disc-grid">${
                support.map((d, i) => card(d, i + 3)).join('')}</div>`
            : '') +
        `</section>`;
}

// The build's note totals as an editable block: one row per note the record
// carries, the same row language the character columns use (icon, name,
// reset slot, stepper). The level is the quantity — the note's effect rows
// resolve their value from it (EffectValue: configId + level*10) — so a ± moves
// every hit that carries that note. Untouched by the harmony layers for now
// (they are stepped independently in the disc cards).
function recNotesBlock(rec) {
    const rows = recNoteRows(rec);
    if (!rows.length) return '';
    return `<section class="rec-block">` +
        `<h3 class="rec-block-title">Notes</h3>` +
        `<div class="rec-sec-body rec-notes-body">${rows.map(recRow).join('')}</div>` +
        `</section>`;
}

function recBuildBlock(builds) {
    // Build stats are identical across the team in practice — dedupe, but keep
    // the owner's name when they genuinely differ.
    const uniq = [];
    for (const [nm, items] of builds) {
        const sig = items.map(([k, v]) => `${k}=${v}`).join('|');
        if (!uniq.some(x => x.sig === sig)) uniq.push({ nm, sig, items });
    }
    if (!uniq.length) return '';
    return `<section class="rec-block">` +
        `<h3 class="rec-block-title">Build</h3>` +
        uniq.map(b => (uniq.length > 1 ? `<div class="rec-block-sub">${esc2(b.nm)}</div>` : '') +
            `<div class="rec-build-grid">${b.items.map(([k, v]) =>
                `<div class="rec-build-row"><span>${esc2(k)}</span><b>${esc2(v)}</b></div>`).join('')}</div>`
        ).join('') +
        `</section>`;
}

// ─── Emblems ─────────────────────────────────────────────────────────────────
// The Record tab's emblem editor: one card per (character, emblem tier), each
// card holding the gem's four roll rows as (line, tier) select pairs — the same
// model Nebula-Record-Builder's buildEmblemGroups uses, seeded from the gems the
// record actually logged.
//
// Record gem shape (logger `gemOf`, Logger Dll/logging.cpp:1499):
//   { slot, attrs:[[CharGemAttrValueId, CfgValue, Value]],
//     effects:[EffectId], pots:[[potIdx, +lv]], skills:[[affixSlot, +lv]] }
// The 2×2 selects map back onto exactly those four arrays, so an edit rewrites
// the record's own gem list and the whole calc (emblem rows, potential/skill
// level tables) follows.
const REC_EMB_ROWS = 4;                 // MaxAlterNum — rolls per emblem
const REC_EMB_TIERS = [1, 2, 3];        // slot id → Lvl 70 / 80 / 90
// Logged gems per record, keyed "<charId>:<slot>" → JSON. Derived from the
// record's own `_gemsOrig` snapshot (tableResolver.snapshotRecordGems, taken
// when the Record event is parsed — the calc measures emblem edits against it),
// so the board and the calc always agree on what "logged" means.
const recEmblemOrig = new WeakMap();

function recEmblemOrigMap(rec) {
    if (!rec) return new Map();
    if (!rec._gemsOrig && typeof window.dcSnapshotRecordGems === 'function') {
        window.dcSnapshotRecordGems(rec);
    }
    // Keyed on the snapshot array itself: a re-parsed record gets a fresh
    // `_gemsOrig`, and the derived map must follow it.
    const src = rec._gemsOrig;
    const cached = recEmblemOrig.get(rec);
    if (cached && cached.src === src) return cached.map;
    const map = new Map();
    for (const c of (src || [])) {
        const gems = c.gems || [];
        for (const slot of REC_EMB_TIERS) {
            const g = gems.find(x => Number(x && x.slot) === Number(slot)) || null;
            map.set(`${c.charId}:${slot}`, JSON.stringify(g));
        }
    }
    recEmblemOrig.set(rec, { src, map });
    return map;
}

function recEmblemGem(ch, slot) {
    slot = Number(slot);
    const gems = ch.gems || [];
    // The logger writes nSlotId (1/2/3); a gem without one falls back to its
    // position in the list, exactly like buildRecordEmblemEffects does.
    return gems.find((g, i) => Number(g && g.slot) === slot
        || (!Number(g && g.slot) && i + 1 === slot)) || null;
}

// The catalog line a gem entry belongs to (percent rolls are logged as Effect
// ids, so they resolve through the reverse map).
function recEmblemLineOfAttrId(id) {
    const gv = (typeof gemAttrValueById !== 'undefined') ? gemAttrValueById.get(Number(id)) : null;
    return { gv, line: (gv && typeof emblemLineOfEntry === 'function') ? emblemLineOfEntry(gv) : null };
}

function recEmblemLineOfEffectId(eid) {
    const gv = (typeof gemAttrValueByEffectId !== 'undefined') ? gemAttrValueByEffectId.get(Number(eid)) : null;
    return { gv, line: (gv && typeof emblemLineOfEntry === 'function') ? emblemLineOfEntry(gv) : null };
}

// Resolve a logged gem into REC_EMB_ROWS { lineKey, entryId } rows, in the
// order the four attribute slots read: flat stats, percent stats, skill
// affixes, potential affixes.
function recEmblemRows(ch, slot, rec) {
    slot = Number(slot);
    const g = recEmblemGem(ch, slot);
    const lines = (typeof emblemLinesForChar === 'function')
        ? emblemLinesForChar(ch.charId, slot, rec) : [];
    const rows = [];
    const push = (line, entry) => rows.push({
        lineKey: line ? line.key : '',
        entryId: entry ? String(entry.id) : '',
    });
    if (g) {
        for (const roll of (g.attrs || [])) {
            const { gv, line } = recEmblemLineOfAttrId(roll && roll[0]);
            push(line, gv);
        }
        for (const eid of (g.effects || [])) {
            const { gv, line } = recEmblemLineOfEffectId(eid);
            push(line, gv);
        }
        for (const sk of (g.skills || [])) {
            const affix = Number(sk && sk[0]);
            const lv = Number(sk && sk[1]) || 0;
            const line = lines.find(l => l.kinds === 7 && Number(l.actionSlot) === affix)
                || ((typeof emblemLinesBySlot !== 'undefined')
                    ? [...(emblemLinesBySlot.get(slot)?.values() || [])]
                        .find(l => l.kinds === 7 && Number(l.actionSlot) === affix) : null);
            const entry = line ? (line.entries.find(e => Number(e.value) === lv) || null) : null;
            push(line, entry);
        }
        for (const p of (g.pots || [])) {
            const idx = Number(p && p[0]);
            const lv = Number(p && p[1]) || 0;
            const line = lines.find(l => l.kinds === 99 && Number(l.potIdx) === idx)
                || ((typeof emblemLinesBySlot !== 'undefined')
                    ? [...(emblemLinesBySlot.get(slot)?.values() || [])]
                        .find(l => l.kinds === 99 && Number(l.potIdx) === idx) : null);
            const entry = line ? (line.entries.find(e => Number(e.value) === lv) || null) : null;
            push(line, entry);
        }
    }
    while (rows.length < REC_EMB_ROWS) rows.push({ lineKey: '', entryId: '' });
    // An emblem can never hold more rolls than the game allows (MaxAlterNum);
    // anything beyond that in an odd log would be dropped by the write anyway.
    return rows.slice(0, REC_EMB_ROWS);
}

// Sum of the gem affixes that raise a potential / skill slot, per char.
function recEmblemTotals(ch) {
    const pots = new Map();
    const skills = new Map();
    for (const g of (ch.gems || [])) {
        for (const p of (g.pots || [])) {
            const idx = Number(p && p[0]);
            if (!idx) continue;
            pots.set(idx, (pots.get(idx) || 0) + (Number(p[1]) || 0));
        }
        for (const s of (g.skills || [])) {
            const slot = Number(s && s[0]);
            if (!slot) continue;
            skills.set(slot, (skills.get(slot) || 0) + (Number(s[1]) || 0));
        }
    }
    return { pots, skills };
}

// Rebuild one gem from the card's rows. Empty rows are simply dropped, and a
// gem with nothing left is removed from the record entirely.
function recWriteGem(ch, slot, rows) {
    slot = Number(slot);
    if (!Array.isArray(ch.gems)) ch.gems = [];
    let gi = ch.gems.findIndex((g, i) => Number(g && g.slot) === slot
        || (!Number(g && g.slot) && i + 1 === slot));
    if (gi < 0) {
        ch.gems.push({ slot, attrs: [], effects: [], pots: [], skills: [] });
        gi = ch.gems.length - 1;
    }
    const g = ch.gems[gi];
    g.slot = slot;
    g.attrs = [];
    g.effects = [];
    g.pots = [];
    g.skills = [];
    const byKey = (typeof emblemLinesBySlot !== 'undefined') ? emblemLinesBySlot.get(Number(slot)) : null;
    for (const r of rows) {
        if (!r || !r.lineKey || !r.entryId) continue;
        const line = (byKey && byKey.get(r.lineKey)) || null;
        if (!line) continue;
        const entry = line.entries.find(e => String(e.id) === String(r.entryId));
        if (!entry) continue;
        if (line.kinds === 7) {
            // skill-levelup affix: [gem affix slot (1..4), +levels]
            g.skills.push([Number(entry.first), Number(entry.value) || 0]);
        } else if (line.kinds === 99) {
            // potential-levelup affix: [potential index, +levels]
            g.pots.push([Number(entry.first), Number(entry.value) || 0]);
        } else if (line.kinds === 12 && line.subType === 2 && entry.effectId) {
            // percent stat roll: the game serializes it as an Effect id
            g.effects.push(entry.effectId);
        } else {
            // flat stat roll: [CharGemAttrValueId, CfgValue, Value] — CfgValue
            // is the ×1e4 domain (ConfigData.IntFloatPrecision = 1e-4).
            const v = Number(entry.value) || 0;
            g.attrs.push([entry.id, v * 10000, v]);
        }
    }
    if (!g.attrs.length && !g.effects.length && !g.pots.length && !g.skills.length) {
        ch.gems.splice(gi, 1);
    }
}

// Apply a gem rewrite and keep the record's own potential / skill effective
// levels in step: the logger's `pots`/`skills` arrays fold the emblem affixes
// in (eff = base + adds), so a moved affix has to move that folded level too —
// otherwise the level tables keep the old total and the edit changes nothing.
function recApplyGemChange(ch, slot, rows) {
    const before = recEmblemTotals(ch);
    recWriteGem(ch, slot, rows);
    const after = recEmblemTotals(ch);

    const potIdx = new Set([...before.pots.keys(), ...after.pots.keys()]);
    for (const idx of potIdx) {
        const d = (after.pots.get(idx) || 0) - (before.pots.get(idx) || 0);
        if (!d) continue;
        const potId = 500000 + Number(ch.charId) * 100 + idx;
        const row = (ch.pots || []).find(p => Number(p && p[0]) === potId);
        if (!row) continue;
        const base = Number(row[1]) || 0;
        const cap = (typeof dcPotLevelable === 'function' && !dcPotLevelable(potId)) ? 1 : 9;
        // eff = record base + every emblem/talent level add, so the floor is
        // the base level itself (removing an affix can never go below it).
        row[2] = Math.min(Math.max((Number(row[2]) || 0) + d, base), cap);
    }
    const gemSlots = new Set([...before.skills.keys(), ...after.skills.keys()]);
    for (const affix of gemSlots) {
        const d = (after.skills.get(affix) || 0) - (before.skills.get(affix) || 0);
        if (!d) continue;
        const action = (typeof GEM_SLOT_TO_ACTION !== 'undefined' && GEM_SLOT_TO_ACTION[affix]) || affix;
        const row = (ch.skills || []).find(s => Number(s && s[0]) === Number(action));
        if (!row) continue;
        const base = Number(row[1]) || 0;
        // No upper clamp here: the skill level tables resolve the effective
        // level through the per-level ladders and cap it themselves. Clamping
        // the folded value would make a later reset lose the levels the cap
        // swallowed.
        row[2] = Math.max((Number(row[2]) || 0) + d, base);
    }
}

// Push an emblem edit through the calc: drop the memoized emblem rows, re-stamp
// the hits that carry them, then let the shared render path rebuild everything.
// `full` forces a fresh board render — used by the reset paths, whose selects
// no longer match the record and must be rebuilt (a stat edit keeps the selects
// the user just operated, so it patches in place instead).
function recCommitEmblems(rec, full) {
    // The stat delta of the edited gems is what the calc applies on top of the
    // logged stats; pot / skill affixes move the level tables (via the folded
    // `pots` / `skills` arrays rewritten by recApplyGemChange).
    if (typeof window.dcRecomputeRecordEmblemDelta === 'function') {
        window.dcRecomputeRecordEmblemDelta(rec);
    }
    if (typeof window.dcInvalidateRecordEmblemRows === 'function') {
        window.dcInvalidateRecordEmblemRows(rec);
    }
    if (typeof window.dcRestampRecordEffects === 'function') {
        window.dcRestampRecordEffects(rec);
    }
    if (typeof window.dcApplyAndRender === 'function') window.dcApplyAndRender();
    if (full) recordRender();
    else if (typeof window.dcApplyAndRender !== 'function') recordRender();
}

// Restore every char's gems to the logged snapshot.
function recRestoreAllEmblems(rec) {
    if (!rec || !rec._gemsOrig) return false;
    const m = recEmblemOrigMap(rec);
    let touched = false;
    for (const ch of (rec.chars || [])) {
        if (!Array.isArray(ch.gems)) continue;
        const slots = new Set((ch.gems || []).map(g => Number(g.slot)));
        // slots the snapshot knows about but the live record no longer has
        for (const key of m.keys()) {
            const [cid, slot] = key.split(':');
            if (String(cid) === String(ch.charId)) slots.add(Number(slot));
        }
        for (const slot of slots) {
            const orig = m.get(`${ch.charId}:${slot}`) || 'null';
            const live = recEmblemSig(recEmblemGem(ch, slot));
            const target = JSON.parse(orig);
            if (live === recEmblemSig(target)) continue;
            const rows = target ? recEmblemRowsOfGem(ch, slot, target, rec) : [];
            recApplyGemChange(ch, slot, rows);
            touched = true;
        }
    }
    if (touched) recCommitEmblems(rec, true);
    return touched;
}

// Rows for an arbitrary gem (used by the reset path, which works from the
// snapshot instead of the live record).
function recEmblemRowsOfGem(ch, slot, gem, rec) {
    const saved = ch.gems;
    ch.gems = [gem];
    const rows = recEmblemRows(ch, slot, rec);
    ch.gems = saved;
    return rows;
}

// ─── Render ──────────────────────────────────────────────────────────────────
// Emblem cards: one per (character, tier), stacked three per character column
// so the section reads as 3 columns (characters) × 3 rows (Lvl 70/80/90).
function recEmblemLinesForCard(rec, ch, slot, rows) {
    const lines = (typeof emblemLinesForChar === 'function')
        ? emblemLinesForChar(ch.charId, slot, rec) : [];
    const out = lines.slice();
    const have = new Set(out.map(l => l.key));
    // A logged roll the filter dropped (an element line for another element, a
    // potential the record no longer lists) still gets an option, otherwise the
    // select could not show what the record rolled.
    for (const r of rows) {
        if (!r.lineKey || have.has(r.lineKey)) continue;
        const byKey = (typeof emblemLinesBySlot !== 'undefined') ? emblemLinesBySlot.get(slot) : null;
        const line = byKey && byKey.get(r.lineKey);
        if (line) { out.push(line); have.add(line.key); }
    }
    return out;
}

function recEmblemStatOptions(rec, ch, slot, rows, selectedKey) {
    let html = `<option value="">— stat —</option>`;
    for (const line of recEmblemLinesForCard(rec, ch, slot, rows)) {
        const nm = (typeof emblemLineName === 'function') ? emblemLineName(line, ch.charId) : line.name;
        const sel = line.key === selectedKey ? ' selected' : '';
        html += `<option value="${esc2(line.key)}"${sel}>${esc2(nm)}</option>`;
    }
    return html;
}

function recEmblemLevelOptions(line, selectedId) {
    let html = `<option value="">— lv —</option>`;
    if (!line) return html;
    for (const e of line.entries) {
        const sel = String(e.id) === String(selectedId) ? ' selected' : '';
        html += `<option value="${e.id}"${sel}>${esc2(emblemEntryLabel(line, e))}</option>`;
    }
    return html;
}

// Best tier the game actually rolls for a line (used when a stat is picked: the
// card jumps to the top roll, like Nebula's does). The roll-existence denylist
// from the Emblems Comparison tab skips the unreachable "cap" entries there —
// they stay selectable here, they just aren't the default.
function recEmblemBestEntry(line) {
    if (!line) return null;
    const rollable = line.entries.filter(e =>
        !(typeof EC_UNROLLABLE_IDS !== 'undefined' && EC_UNROLLABLE_IDS.has(Number(e.id))));
    const pool = rollable.length ? rollable : line.entries;
    return pool.length ? pool[pool.length - 1] : null;
}

function recEmblemIsEdited(rec, ch, slot) {
    const m = recEmblemOrigMap(rec);
    const key = `${ch.charId}:${slot}`;
    if (!m.has(key)) return false;
    const orig = JSON.parse(m.get(key));
    return recEmblemSig(recEmblemGem(ch, slot)) !== recEmblemSig(orig);
}

// The rows the record logged for one card, so each rendered row can tell
// whether IT is the one that was changed.
function recEmblemLoggedRows(rec, ch, slot) {
    const m = recEmblemOrigMap(rec);
    const raw = m.get(`${ch.charId}:${slot}`);
    const gem = raw ? JSON.parse(raw) : null;
    return gem ? recEmblemRowsOfGem(ch, slot, gem, rec) : [];
}

// Which rows of one card were changed. The gem arrays are re-derived by
// category on read (flat `attrs` first, then percent `effects`), so an edit can
// reorder the displayed rows — matching each live row against the LOGGED rows as
// a multiset marks exactly the rolls that no longer have a counterpart, instead
// of every row that shifted position.
function recEmblemEditedRowMask(loggedRows, rows) {
    const key = r => `${(r && r.lineKey) || ''}|${(r && r.entryId) || ''}`;
    const used = new Array(loggedRows.length).fill(false);
    return rows.map(r => {
        const k = key(r);
        const hit = loggedRows.findIndex((o, i) => !used[i] && key(o) === k);
        if (hit >= 0) { used[hit] = true; return false; }
        return !!(r && r.lineKey && r.entryId);
    });
}

// Order-independent identity of a gem, so "edited" compares what the emblem
// actually grants instead of the JSON key order / float formatting of the
// logged object (the editor rewrites the same numbers in the catalog's own
// precision).
function recEmblemSig(gem) {
    if (!gem) return '';
    const num = v => {
        const n = Number(v);
        return Number.isFinite(n) ? +n.toPrecision(10) : 0;
    };
    const attrs = (gem.attrs || [])
        .map(a => [Number(a && a[0]) || 0, num(a && a[2])])
        .sort((a, b) => a[0] - b[0]);
    const effects = (gem.effects || []).map(Number).sort((a, b) => a - b);
    const pots = (gem.pots || []).map(p => [Number(p && p[0]) || 0, num(p && p[1])]).sort((a, b) => a[0] - b[0]);
    const skills = (gem.skills || []).map(s => [Number(s && s[0]) || 0, num(s && s[1])]).sort((a, b) => a[0] - b[0]);
    return JSON.stringify([Number(gem.slot) || 0, attrs, effects, pots, skills]);
}

function recEmblemCard(rec, ch, slot) {
    const rows = recEmblemRows(ch, slot, rec);
    const byKey = (typeof emblemLinesBySlot !== 'undefined') ? emblemLinesBySlot.get(slot) : null;
    const edited = recEmblemIsEdited(rec, ch, slot);
    const logged = recEmblemLoggedRows(rec, ch, slot);
    const rowMask = recEmblemEditedRowMask(logged, rows);
    const empty = !recEmblemGem(ch, slot);
    const label = (typeof EMBLEM_SLOT_NAME !== 'undefined' && EMBLEM_SLOT_NAME[slot])
        || `Emblem ${slot}`;
    const body = rows.map((r, i) => {
        const line = (r.lineKey && byKey) ? byKey.get(r.lineKey) || null : null;
        // Highlight is per ROW: only the rolls that differ from the logged
        // emblem are marked, not the whole card.
        return `<div class="rec-emb-row${rowMask[i] ? ' is-changed' : ''}" data-emb-row="${i}">` +
            `<select class="rec-emb-stat" data-emb-row="${i}"` +
                ` aria-label="${esc2(label)} stat ${i + 1}">` +
                recEmblemStatOptions(rec, ch, slot, rows, r.lineKey) +
            `</select>` +
            `<select class="rec-emb-lv" data-emb-row="${i}"` +
                ` aria-label="${esc2(label)} stat ${i + 1} level">` +
                recEmblemLevelOptions(line, r.entryId) +
            `</select>` +
            `</div>`;
    }).join('');
    return `<div class="rec-emb-card${empty ? ' is-empty' : ''}"` +
        ` data-emb-char="${esc2(ch.charId)}" data-emb-slot="${slot}">` +
        `<div class="rec-emb-card-head">` +
            `<span class="rec-emb-card-label">${esc2(label)}</span>` +
            (edited
                ? `<button type="button" class="rec-emb-reset" data-act="embreset"` +
                  ` data-emb-char="${esc2(ch.charId)}" data-emb-slot="${slot}"` +
                  ` title="Back to the logged emblem" aria-label="Reset ${esc2(label)}">↺</button>`
                : '') +
        `</div>` +
        `<div class="rec-emb-rows">${body}</div>` +
        `</div>`;
}

function recEmblemsBlock(rec, seq) {
    if (!seq.length || typeof emblemLinesBySlot === 'undefined' || !emblemLinesBySlot.size) return '';
    // Three columns (the team's characters) × three rows (Lvl 70 / 80 / 90):
    // the header row names the characters, then one row per emblem tier with
    // that character's card in its own column.
    const heads = seq.map(ch => {
        const cid = String(ch.charId);
        const name = cid === '0' ? 'Unknown' : resolveActorKey('p:' + cid);
        return `<div class="rec-emb-col-head" data-col="${esc2(cid)}">${esc2(name)}</div>`;
    }).join('');
    const rows = REC_EMB_TIERS.map(slot =>
        seq.map(ch => recEmblemCard(rec, ch, slot)).join('')).join('');
    return `<section class="rec-block rec-emblems">` +
        `<h3 class="rec-block-title">Emblems</h3>` +
        `<div class="rec-emb-grid">${heads}${rows}</div>` +
        `</section>`;
}

function recordRender() {
    const panel = document.getElementById('recordPanel');
    if (!panel) return;
    bindRecordPanel(panel);

    const prevScroll = panel.querySelector('.rec-scroll');
    const scrollTop = prevScroll ? prevScroll.scrollTop : 0;
    const focus = captureFocus(panel);

    const rec = getOriginRecord();
    if (!rec || !rec.chars || !rec.chars.length) {
        // Logs without a record entry: render the record reconstructed from
        // combat (lazy level reconstruction from the parsed rows and hits).
        const syn = (typeof dcSyntheticRecord === 'function') ? dcSyntheticRecord() : null;
        if (syn && syn.chars && syn.chars.length) {
            // Reconstructed records carry no emblems at all — the section is
            // empty, so the board is rendered without it.
            renderBoard(panel, syn, true);
            restoreFocus(panel, focus, scrollTop);
            return;
        }
        panel.innerHTML = `<div class="rec-empty">` +
            `<div class="rec-empty-inner">` +
            `<div class="rec-empty-title">No record data yet</div>` +
            `<div class="rec-empty-body">Enter a Boss Blitz room — the logger writes one ` +
            `record entry per room, right after the Reset.</div></div></div>`;
        return;
    }
    renderBoard(panel, rec, false);
    restoreFocus(panel, focus, scrollTop);
}

function renderBoard(panel, rec, synthetic) {
    // Rows are looked up by key on every interaction; keep the record the board
    // was built from so a synthetic board doesn't rebuild itself per click.
    recView.rec = rec;
    const ifp = rec.ifp || 1e-4;
    const pctMap = rec.pct || {};
    const fmtVal = (k, v) => {
        const isPct = !!pctMap[k];
        const n = isPct && Math.abs(v) > 2 ? v * ifp : v;
        return typeof n === 'number' && !Number.isInteger(n) ? +n.toPrecision(8) : n;
    };
    const statName = k => {
        const idx = typeof RECORD_SKEY_TO_ATTR !== 'undefined' ? RECORD_SKEY_TO_ATTR[k] : null;
        return idx != null ? attrName(idx) : k;
    };

    // Team order, then any chars present only in the chars array.
    const order = (rec.team && rec.team.length)
        ? rec.team.map(String)
        : rec.chars.map(c => String(c.charId));
    const byId = new Map(rec.chars.map(c => [String(c.charId), c]));
    const seq = [];
    for (const id of order) if (byId.has(id)) seq.push(byId.get(id));
    for (const c of rec.chars) if (!order.includes(String(c.charId))) seq.push(c);

    // Counts for the topbar.
    let edited = 0;
    const cols = [];
    for (const ch of seq) {
        const lvl = recCharLevelRow(ch);
        const sks = recSkillRows(ch);
        const pots = recPotRows(ch);
        edited += (lvl.change !== 0 ? 1 : 0) + sks.filter(r => r.change !== 0).length +
            pots.filter(r => r.change !== 0).length;
        cols.push({ ch, lvl, sks, pots });
        if (recEmblemIsEdited(rec, ch, 1) || recEmblemIsEdited(rec, ch, 2) || recEmblemIsEdited(rec, ch, 3)) {
            edited += 1;
        }
    }
    // Disc copies / harmony layers and the note levels are record-wide edits —
    // they enable the same "Reset all".
    for (let i = 0; i < (rec.discStats || []).length; i++) {
        edited += recDiscLevelRows(i).filter(r => r.change !== 0).length;
    }
    if (typeof window.dcNoteLevelInfo === 'function') {
        edited += recNoteRows(rec).filter(r => r.change !== 0).length;
    }
    // A talent switched off is an edit like any other: it has to light the same
    // "Reset all" (dcResetTalentGroups puts it back).
    if ([...dcGroupEffectKeys.keys()].some(k => k === 'talents' || k.startsWith('talent:'))) edited += 1;
    const builds = [];
    for (const ch of seq) {
        const cid = String(ch.charId);
        const nm = cid === '0' ? 'Unknown' : resolveActorKey('p:' + cid);
        const items = Object.entries(ch.build || {}).map(([k, v]) => [statName(k), fmtVal(k, v)]);
        if (items.length) builds.push([nm, items]);
    }

    const html = [];
    // ── Topbar: only the one action the page needs, right-aligned. The record's
    // mode and team are already evident from the three columns below. ──
    html.push('<div class="rec-top">');
    if (synthetic) html.push('<span class="rec-top-note">reconstructed from combat</span>');
    html.push('<span class="rec-top-actions">');
    html.push(`<button type="button" class="rec-btn rec-btn-danger${edited ? '' : ' is-empty'}"` +
        ` data-act="resetall"${edited ? '' : ' disabled'}>Reset all</button>`);
    html.push('</span></div>');

    // ── Scroll region ──
    html.push('<div class="rec-scroll">');
    html.push('<div class="rec-board">');
    for (const c of cols) html.push(recColumn(c.ch));
    html.push('</div>');
    const emblems = synthetic ? '' : recEmblemsBlock(rec, seq);
    if (emblems) html.push(emblems);
    const discs = recDiscsBlock(rec, statName, fmtVal);
    if (discs) html.push(discs);
    const notesBlock = recNotesBlock(rec);
    if (notesBlock) html.push(notesBlock);
    const build = recBuildBlock(builds);
    if (build) html.push(build);
    html.push('</div>');

    panel.innerHTML = html.join('');
}

// ─── Focus + scroll preservation ─────────────────────────────────────────────
function captureFocus(panel) {
    const el = document.activeElement;
    if (!el || !panel.contains(el)) return null;
    const holder = el.closest('[data-row]');
    if (!holder) return null;
    const part = el.classList.contains('rec-step-val') ? 'val'
        : (el.dataset.act === 'dec' || el.dataset.act === 'inc') ? el.dataset.act
        : 'row';
    return { row: holder.dataset.row, part, caret: el.selectionStart };
}

function restoreFocus(panel, focus, scrollTop) {
    const sc = panel.querySelector('.rec-scroll');
    if (sc && scrollTop) sc.scrollTop = scrollTop;
    if (!focus) return;
    // Look the control up by its own data-row: the character-level stepper
    // lives in the column header and has no .rec-row wrapper around it.
    let target = null;
    if (focus.part === 'val') {
        target = panel.querySelector(`.rec-step-val[data-row="${focus.row}"]`);
    } else if (focus.part === 'dec' || focus.part === 'inc') {
        target = panel.querySelector(
            `.rec-step-btn[data-act="${focus.part}"][data-row="${focus.row}"]`);
    } else {
        target = panel.querySelector(`.rec-row[data-row="${focus.row}"]`)
            || panel.querySelector(`[data-row="${focus.row}"]`);
    }
    if (!target) return;
    target.focus();
    if (focus.part === 'val' && target.setSelectionRange) {
        const pos = focus.caret ?? String(target.value).length;
        try { target.setSelectionRange(pos, pos); } catch (e) { /* not a text input */ }
    }
}

// ─── Interaction ─────────────────────────────────────────────────────────────
// Disc / note rows are rebuilt from the level tables on every lookup (they carry
// no per-record state of their own), so a click, the in-place patch and the
// tooltip all read the same numbers.
function recDiscRowByKey(key) {
    const m = /^disc-(\d+)-(copies|h1|h2)$/.exec(String(key));
    if (!m) return null;
    const rows = recDiscLevelRows(Number(m[1]));
    if (m[2] === 'copies') return rows.find(r => r.kind === 'copies') || null;
    const slot = m[2] === 'h1' ? 1 : 2;
    return rows.find(r => r.kind === 'harmony' && r.slot === slot) || null;
}

function recNoteRowByKey(key) {
    const m = /^note-(\d+)$/.exec(String(key));
    if (!m) return null;
    const rec = recView.rec || getOriginRecord();
    if (!rec) return null;
    return recNoteRows(rec).find(r => r.noteId === Number(m[1])) || null;
}

function recFindRow(key) {
    const discRow = recDiscRowByKey(key);
    if (discRow) return discRow;
    const noteRow = recNoteRowByKey(key);
    if (noteRow) return noteRow;
    // Look the row up in the record the board was rendered from, so a click on
    // a reconstructed board can't be resolved against a different record.
    const rec = recView.rec
        || getOriginRecord()
        || (typeof dcSyntheticRecord === 'function' ? dcSyntheticRecord() : null);
    if (!rec || !rec.chars) return null;
    const m = /^(pot|skill|talent|char)-(\d+)-?(\d+)?$/.exec(key);
    if (!m) return null;
    const kind = m[1];
    const charId = Number(m[2]);
    const ch = rec.chars.find(c => Number(c.charId) === charId);
    if (!ch) return null;
    if (kind === 'pot') return recPotRows(ch).find(r => String(r.potId) === m[3]) || null;
    if (kind === 'skill') return recSkillRows(ch).find(r => String(r.slot) === m[3]) || null;
    if (kind === 'talent') return recTalentRows(ch).find(r => String(r.index) === m[3]) || null;
    return recCharLevelRow(ch);
}

function recApply(row, offset) {
    if (!row || row.editable === false) return;
    // Potentials and skills may step down to 0 — for a potential that is its
    // disabled state, for a skill slot the level-0 row the game has. Only the
    // character level has a floor of 1. Above the row's own ladder cap a
    // potential/skill keeps stepping — the display splits the extra into "N+M".
    // A note moves recRowStep() per click (5), so a ladder that runs to 99 is
    // reachable in a few clicks; the clamp still lands exactly on floor / cap.
    const floor = recRowMin(row);
    const next = Math.min(Math.max(row.edit + offset * recRowStep(row), floor), row.max);
    if (next === row.edit) return;
    recSetLevel(row, next);
}

// Write the row's edited value through the shared dmg-calc setter, which only
// adjusts the row's bonus level (`change`). Every row edits an effective level.
function recSetLevel(row, targetLevel) {
    let t = Math.round(Number(targetLevel));
    if (!Number.isFinite(t)) return;
    t = Math.max(t, recRowMin(row));
    if (row.kind === 'pot' && typeof window.dcSetPotLevel === 'function') {
        window.dcSetPotLevel(row.potId, t);
    } else if (row.kind === 'skill' && typeof window.dcSetSkillLevel === 'function') {
        window.dcSetSkillLevel(row.charId, row.slot, t);
    } else if (row.kind === 'char' && typeof window.dcSetCharLevel === 'function') {
        window.dcSetCharLevel(row.charId, t);
    } else if (row.kind === 'copies' && typeof window.dcSetDiscCopies === 'function') {
        window.dcSetDiscCopies(row.discIdx, t);
    } else if (row.kind === 'harmony' && typeof window.dcSetDiscHarmony === 'function') {
        window.dcSetDiscHarmony(row.discIdx, row.slot, t);
    } else if (row.kind === 'note' && typeof window.dcSetNoteLevel === 'function') {
        window.dcSetNoteLevel(row.noteId, t);
    }
}

function recResetRow(row) {
    if (!row) return;
    if (row.kind === 'pot' && typeof dcResetPotLevelChange === 'function') {
        dcResetPotLevelChange(row.potId);
    } else if (row.kind === 'skill' && typeof dcResetSkillLevelChange === 'function') {
        dcResetSkillLevelChange(row.charId, row.slot);
    } else if (row.kind === 'char' && typeof dcResetCharLevelChange === 'function') {
        dcResetCharLevelChange(row.charId);
    } else if ((row.kind === 'copies' || row.kind === 'harmony') &&
        typeof window.dcResetDiscChange === 'function') {
        window.dcResetDiscChange(row.discIdx);
    } else if (row.kind === 'note' && typeof window.dcResetNoteLevelChange === 'function') {
        window.dcResetNoteLevelChange(row.noteId);
    }
}

// Row-click dispatch for the toggle rows: a potential switches its level, a
// talent switches its group (its passive plus every node it grants). Every other
// row has no row-level toggle.
function recToggleRow(row) {
    if (!row) return false;
    if (row.kind === 'pot') return recTogglePot(row);
    if (row.kind === 'talent') return recToggleTalent(row);
    return false;
}

function recToggleTalent(row) {
    if (!row || row.kind !== 'talent') return false;
    if (typeof window.dcToggleTalent !== 'function') return false;
    return window.dcToggleTalent(row.unit, row.index);
}

// Row-click toggle for potentials: level 0 is the off state (the potential's
// level ladder resolves to 0, so every effect it grants drops out), and the
// level it had before the click is remembered so the second click lands back
// where the user was instead of on the logged level.
//
// The switch itself lives in the Dmg Calc sidebar (dcTogglePotOff): the same
// call comes back from a sidebar row click, so a potential switched off in
// either place dims the Record row and the sidebar rows together.
function recTogglePot(row) {
    if (!row || row.kind !== 'pot') return false;
    if (typeof window.dcTogglePotOff === 'function') return window.dcTogglePotOff(row.potId);
    return false;
}

// ─── Emblem interaction ──────────────────────────────────────────────────────
// A card is (char, tier); its rows are the gem's four rolls. Changing a stat
// select clears the row and repopulates the level select with that line's
// tiers (defaulting to the best one, like Nebula's emblem cards), then the gem
// is rebuilt from all four rows.
function recEmblemCardRows(cardEl) {
    const rows = [];
    for (const rowEl of cardEl.querySelectorAll('.rec-emb-row')) {
        const stat = rowEl.querySelector('.rec-emb-stat');
        const lv = rowEl.querySelector('.rec-emb-lv');
        rows.push({ lineKey: stat ? stat.value : '', entryId: lv ? lv.value : '' });
    }
    return rows;
}

function recEmblemSelect(sel) {
    const card = sel.closest('.rec-emb-card');
    if (!card) return;
    const rec = recView.rec || getOriginRecord();
    if (!rec) return;
    const charId = Number(card.dataset.embChar);
    const slot = Number(card.dataset.embSlot);
    const ch = (rec.chars || []).find(c => Number(c.charId) === charId);
    if (!ch) return;

    const rowEl = sel.closest('.rec-emb-row');
    const lvSel = rowEl ? rowEl.querySelector('.rec-emb-lv') : null;
    // Moving the line re-fills the tier list; leaving the tier untouched keeps
    // the row empty until a tier is picked (the gem drops empty rows).
    if (sel.classList.contains('rec-emb-stat') && lvSel) {
        const byKey = (typeof emblemLinesBySlot !== 'undefined') ? emblemLinesBySlot.get(slot) : null;
        const line = (byKey && sel.value) ? byKey.get(sel.value) || null : null;
        lvSel.innerHTML = recEmblemLevelOptions(line, '');
        const best = recEmblemBestEntry(line);
        if (best) lvSel.value = String(best.id);
    }
    recApplyGemChange(ch, slot, recEmblemCardRows(card));
    recCommitEmblems(rec);
}

// Reset one card to the gem the record logged.
function recResetEmblem(rec, charId, slot) {
    if (!rec) return;
    const ch = (rec.chars || []).find(c => Number(c.charId) === Number(charId));
    if (!ch) return;
    const orig = recEmblemOrigMap(rec).get(`${charId}:${slot}`);
    const target = orig ? JSON.parse(orig) : null;
    const rows = target ? recEmblemRowsOfGem(ch, slot, target, rec) : [];
    recApplyGemChange(ch, slot, rows);
    recCommitEmblems(rec, true);
}

function bindRecordPanel(panel) {
    if (recView.bound) return;
    recView.bound = true;

    // Edits commit on blur/Enter so the input keeps focus through the re-render.
    panel.addEventListener('change', e => {
        // Emblem editor: a select inside a card rewrites that card's gem.
        const sel = e.target.closest('.rec-emb-stat, .rec-emb-lv');
        if (sel) { recEmblemSelect(sel); return; }
        const inp = e.target.closest('.rec-step-val');
        if (!inp) return;
        const row = recFindRow(inp.dataset.row);
        if (!row || row.editable === false) return;
        const v = parseRecLevel(inp.value);
        if (v != null && v !== row.edit) {
            recSetLevel(row, v);
            const fresh = recFindRow(row.key) || row;
            inp.dataset.edit = fresh.edit;
            inp.value = recShown(fresh);
        } else {
            inp.value = recShown(row);
        }
    });
    panel.addEventListener('keydown', e => {
        const inp = e.target.closest('.rec-step-val');
        if (!inp) return;
        if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
        else if (e.key === 'Escape') {
            const row = recFindRow(inp.dataset.row);
            if (row) inp.value = recShown(row);
            inp.blur();
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const row = recFindRow(inp.dataset.row);
            if (!row) return;
            recApply(row, e.key === 'ArrowUp' ? 1 : -1);
            // The field is focused, so RecordRefresh left its text alone — show
            // the new plain level here (edit mode never carries the +N suffix).
            const fresh = recFindRow(row.key) || row;
            inp.dataset.edit = fresh.edit;
            inp.value = fresh.edit;
        }
    });
    panel.addEventListener('focusin', e => {
        const inp = e.target.closest('.rec-step-val');
        if (!inp) return;
        // Edit the plain effective level — the "+N" split is display only.
        inp.value = inp.dataset.edit;
        inp.select();
    });
    panel.addEventListener('focusout', e => {
        const inp = e.target.closest('.rec-step-val');
        if (!inp) return;
        const row = recFindRow(inp.dataset.row);
        if (row) inp.value = recShown(row);
    });

    panel.addEventListener('click', e => {
        const btn = e.target.closest('[data-act]');
        if (!btn) {
            // Potentials toggle on a click anywhere on their row (level 0 =
            // disabled). The stepper's own controls stop here, so ± and the
            // level field never fall through to the row toggle.
            if (e.target.closest('.rec-step, .rec-step-val, .rec-row-reset')) return;
            const holder = e.target.closest('.rec-row[data-row]');
            if (!holder) return;
            recToggleRow(recFindRow(holder.dataset.row));
            return;
        }
        const act = btn.dataset.act;

        if (act === 'dec' || act === 'inc') {
            const row = recFindRow(btn.dataset.row);
            if (row) recApply(row, act === 'inc' ? 1 : -1);
            return;
        }
        if (act === 'reset') {
            const row = recFindRow(btn.dataset.row);
            if (row) recResetRow(row);
            return;
        }
        if (act === 'embreset') {
            recResetEmblem(recView.rec || getOriginRecord(),
                btn.dataset.embChar, btn.dataset.embSlot);
            return;
        }
        if (act === 'resetall') {
            if (!btn.classList.contains('is-armed')) {
                btn.classList.add('is-armed');
                btn.textContent = 'Confirm reset';
                clearTimeout(recView.resetTimer);
                recView.resetTimer = setTimeout(() => {
                    const again = document.querySelector('#recordPanel [data-act="resetall"]');
                    if (again) {
                        again.classList.remove('is-armed');
                        again.textContent = 'Reset all';
                    }
                }, 4000);
                return;
            }
            clearTimeout(recView.resetTimer);
            // A talent switch is an edit like a level change, so it goes back too.
            if (typeof window.dcResetTalentGroups === 'function') window.dcResetTalentGroups();
            if (typeof window.dcResetAllLevelChanges === 'function') window.dcResetAllLevelChanges();
            // Emblems are part of the build too — put every gem back to the
            // logged one, then re-render once through the emblem path.
            recRestoreAllEmblems(recView.rec || getOriginRecord());
            if (!(recView.rec || getOriginRecord())) recordRender();
            return;
        }
    });

    // Image fallbacks: an XXL head that is not published falls back once to the
    // XL copy, and anything that still fails reveals the letter tile behind it.
    // (error does not bubble, but a capturing listener still sees it.)
    panel.addEventListener('error', e => {
        const img = e.target;
        if (!img || img.tagName !== 'IMG') return;
        const fb = img.dataset.fb;
        if (fb) {
            delete img.dataset.fb;
            img.src = fb;
            return;
        }
        img.classList.add('is-failed');
    }, true);
}
