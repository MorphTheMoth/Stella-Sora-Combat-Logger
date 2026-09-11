// ─── record.js — "Record" tab ─────────────────────────────────────────────────
// Lists the potentials of the active Boss Blitz record (one Type:"Origin"
// event per room from the DLL), resolved to display names via item.json /
// Potential.json. Grouped per character, in the record's team order.

const _recordOrigSwitchTab = window.switchTab;
window.switchTab = function(tab) {
    document.getElementById('tabRecord').classList.toggle('active', tab === 'record');
    document.getElementById('recordPanel').classList.toggle('visible', tab === 'record');
    if (tab === 'record') window.Record.render();
    _recordOrigSwitchTab(tab);
};

window.Record = {
    render: recordRender,
};

function recordRender() {
    const panel = document.getElementById('recordPanel');
    if (!panel) return;

    const rec = getOriginRecord();
    if (!rec || !rec.chars || !rec.chars.length) {
        // Logs without a record log: render the record reconstructed from
        // combat (lazy level reconstruction from parsed potential/skill rows
        // and level-scaled hits).
        const syn = (typeof dcSyntheticRecord === 'function') ? dcSyntheticRecord() : null;
        if (syn) {
            renderRecordData(panel, syn, true);
            return;
        }
        panel.innerHTML = '<div class="rec-empty">No record data yet — enter a Boss Blitz room ' +
            '(the logger writes one Origin entry per room, right after the Reset).</div>';
        return;
    }
    renderRecordData(panel, rec, false);
}

function renderRecordData(panel, rec, synthetic) {
    const ifp = rec.ifp || 1e-4;
    const pctMap = rec.pct || {};

    // Shared formatting: percent values are converted out of the ×1e-4 domain,
    // float noise is trimmed (0.12000000000000001 → 0.12).
    const fmtVal = (k, v) => {
        const isPct = !!pctMap[k];
        const n = isPct && Math.abs(v) > 2 ? v * ifp : v;
        return typeof n === 'number' && !Number.isInteger(n) ? +n.toPrecision(8) : n;
    };
    // Disc stat keys are the C-side short codes (AEE, WEE, …) — display the
    // full attribute name via the shared attr table (AEE → "Ventus Dmg").
    const statName = k => {
        const idx = typeof RECORD_SKEY_TO_ATTR !== 'undefined' ? RECORD_SKEY_TO_ATTR[k] : null;
        return idx != null ? attrName(idx) : k;
    };

    // Team order first, then any chars present only in the chars array.
    const order = (rec.team && rec.team.length)
        ? rec.team.map(String)
        : rec.chars.map(c => String(c.charId));
    const byId = new Map(rec.chars.map(c => [String(c.charId), c]));
    const seq = [];
    for (const id of order) if (byId.has(id)) seq.push(byId.get(id));
    for (const c of rec.chars) {
        const k = String(c.charId);
        if (!order.includes(k)) seq.push(c);
    }

    const html = [];
    const builds = [];
    html.push('<div class="rec-scroll">');
    html.push('<div class="rec-header">' + (synthetic
        ? 'Reconstructed Record <span class="rec-mode">(from combat log — no record entry in this log)</span>'
        : 'Boss Blitz Record' + (rec.mode ? ` <span class="rec-mode">(${rec.mode})</span>` : '')) + '</div>');

    for (const ch of seq) {
        const cid = String(ch.charId);
        const charName = cid === '0' ? 'Unknown' : resolveActorKey('p:' + cid);
        const lvl = ch.level != null ? `Lv ${ch.level}` : '';
        const adv = ch.advance != null && ch.advance > 0 ? ` · Adv ${ch.advance}` : '';

        html.push(`<div class="rec-char">`);
        html.push(`<div class="rec-char-name">${charName} <span class="rec-char-sub">${lvl}${adv}</span></div>`);

        const pots = ch.pots || [];
        if (!pots.length) {
            html.push('<div class="rec-none">No potentials in this record.</div>');
        } else {
            html.push('<table class="ei-table rec-table"><thead><tr>' +
                '<th style="text-align:left">Potential</th>' +
                '<th class="rec-c">Record Lv</th><th class="rec-c">Bonus</th><th class="rec-c">Changes</th></tr></thead><tbody>');
            for (const p of pots) {
                const potId = Number(p[0]);
                const recLv = Number(p[1]) || 0;
                const effLv = Number(p[2]) || recLv;
                const bonus = effLv - recLv;
                // Live user change comes from the pot level table (dcPotLevelInfo)
                const info = window.dcPotLevelInfo ? window.dcPotLevelInfo(potId) : null;
                const change = info ? (info.change || 0) : 0;
                const nm = potentialNameById.get(potId) || `Potential ${potId}`;
                const bonusTxt = bonus > 0 ? `+${bonus}` : '';
                const bonusCls = bonus > 0 ? 'rec-bonus' : 'rec-nobonus';
                const chgTxt = change > 0 ? `+${change}` : (change < 0 ? String(change) : '');
                const chgCls = change !== 0 ? 'rec-bonus' : 'rec-nobonus';
                const chgAttr = change !== 0
                    ? ` title="Click to reset" style="cursor:pointer" onclick="dcResetPotLevelChange(${potId})"`
                    : '';
                html.push(`<tr>` +
                    `<td class="rec-name">${nm}</td>` +
                    `<td class="rec-c">${recLv}</td>` +
                    `<td class="rec-c ${bonusCls}">${bonusTxt}</td>` +
                    `<td class="rec-c ${chgCls}"${chgAttr}>${chgTxt}</td>` +
                    `</tr>`);
            }
            html.push('</tbody></table>');
        }

        // ── Skill levels (record lv / bonus / change, mirrors the pot table) ──
        // ch.skills = [skillSlotType, recordLv, effectiveLv, maxLv] from the
        // DLL collector (GetSkillLevel / GetCharSkillAddedLevel /
        // GetCharSkillMaxLevel). Live change + effective come from the
        // dmg calc's skill level table (dcSkillLevelInfo).
        const sks = ch.skills || [];
        if (sks.length) {
            html.push('<div class="rec-sub" style="margin-top:6px">Skills</div>');
            html.push('<table class="ei-table rec-table"><thead><tr>' +
                '<th style="text-align:left">Skill</th>' +
                '<th class="rec-c">Record Lv</th><th class="rec-c">Bonus</th><th class="rec-c">Changes</th></tr></thead><tbody>');
            const orderedSks = sks.slice().sort((a, b) =>
                SKILL_SLOT_ORDER.indexOf(Number(a[0])) - SKILL_SLOT_ORDER.indexOf(Number(b[0])));
            for (const s of orderedSks) {
                const slot = Number(s[0]);
                const recLv = Number(s[1]) || 0;
                const eff = Number(s[2]) || recLv;
                const bonus = eff - recLv;
                const info = window.dcSkillLevelInfo ? window.dcSkillLevelInfo(ch.charId, slot) : null;
                const change = info ? (info.change || 0) : 0;
                const nm = SKILL_SLOT_NAMES[slot] || ('Skill ' + slot);
                const bonusTxt = bonus > 0 ? `+${bonus}` : '';
                const bonusCls = bonus > 0 ? 'rec-bonus' : 'rec-nobonus';
                const chgTxt = change > 0 ? `+${change}` : (change < 0 ? String(change) : '');
                const chgCls = change !== 0 ? 'rec-bonus' : 'rec-nobonus';
                const chgAttr = change !== 0
                    ? ` title="Click to reset" style="cursor:pointer" onclick="dcResetSkillLevelChange(${ch.charId},${slot})"`
                    : '';
                html.push(`<tr>` +
                    `<td class="rec-name">${nm}</td>` +
                    `<td class="rec-c">${recLv}</td>` +
                    `<td class="rec-c ${bonusCls}">${bonusTxt}</td>` +
                    `<td class="rec-c ${chgCls}"${chgAttr}>${chgTxt}</td>` +
                    `</tr>`);
            }
            html.push('</tbody></table>');
        }

        // Per-char build stats — collected for the record-wide section below
        const build = Object.entries(ch.build || {})
            .map(([k, v]) => `${statName(k)} ${fmtVal(k, v)}`).join(', ');
        if (build) builds.push([charName, build]);

        html.push('</div>');
    }

    // Discs + build are record-wide (identical for the whole team) — render
    // once after the characters: first three discs = main, the rest = support.
    const dStats = rec.discStats || [];
    if (dStats.length) {
        const discLine = d => {
            const parts = Object.entries(d.attrs || {})
                .map(([k, v]) => `${statName(k)} ${fmtVal(k, v)}`).join(', ');
            return parts ? `${resolveRecordDiscName(d.id)}: ${parts}` : resolveRecordDiscName(d.id);
        };
        html.push('<div class="rec-char rec-discs">');
        html.push('<div class="rec-sub">Discs</div>');
        html.push('<div class="rec-sub" style="margin-top:4px">Main discs</div>');
        html.push('<ul class="rec-disc-list">' +
            dStats.slice(0, 3).map(d => `<li>${esc(discLine(d))}</li>`).join('') + '</ul>');
        if (dStats.length > 3) {
            html.push('<div class="rec-sub" style="margin-top:4px">Support discs</div>');
            html.push('<ul class="rec-disc-list">' +
                dStats.slice(3).map(d => `<li>${esc(discLine(d))}</li>`).join('') + '</ul>');
        }
        // Build stats, deduped across the team (identical in practice)
        const uniqBuilds = [];
        for (const [nm, b] of builds) {
            if (!uniqBuilds.some(x => x[1] === b)) uniqBuilds.push([nm, b]);
        }
        if (uniqBuilds.length) {
            html.push('<div class="rec-sub" style="margin-top:8px">Build</div>');
            html.push('<ul class="rec-disc-list">' + uniqBuilds.map(([nm, b]) =>
                `<li>${esc(uniqBuilds.length > 1 ? `${nm}: ${b}` : b)}</li>`).join('') + '</ul>');
        }
        html.push('</div>');
    }

    html.push('</div>');
    panel.innerHTML = html.join('');
}
