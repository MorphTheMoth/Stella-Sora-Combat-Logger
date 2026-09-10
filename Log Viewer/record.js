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
        panel.innerHTML = '<div class="rec-empty">No record data yet — enter a Boss Blitz room ' +
            '(the logger writes one Origin entry per room, right after the Reset).</div>';
        return;
    }

    const ifp = rec.ifp || 1e-4;
    const pctMap = rec.pct || {};

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
    html.push('<div class="rec-scroll">');
    html.push('<div class="rec-header">Boss Blitz Record' +
        (rec.mode ? ` <span class="rec-mode">(${rec.mode})</span>` : '') + '</div>');

    for (const ch of seq) {
        const cid = String(ch.charId);
        const charName = resolveActorKey('p:' + cid);
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
                '<th>Record Lv</th><th>Effective Lv</th><th>Bonus</th><th>Changes</th></tr></thead><tbody>');
            for (const p of pots) {
                const potId = Number(p[0]);
                const recLv = Number(p[1]) || 0;
                const effLv = Number(p[2]) || recLv;
                const bonus = effLv - recLv;
                // Live level-table state (recordLv + bonus + user change, clamped 0..9)
                const info = window.dcPotLevelInfo ? window.dcPotLevelInfo(potId) : null;
                const change = info ? (info.change || 0) : 0;
                const liveLv = info ? Math.min(Math.max(recLv + bonus + change, 0), 9) : effLv;
                const nm = potentialNameById.get(potId) || `Potential ${potId}`;
                const bonusTxt = bonus > 0 ? `+${bonus}` : '—';
                const bonusCls = bonus > 0 ? 'rec-bonus' : 'rec-nobonus';
                const effTxt = liveLv !== recLv
                    ? `<strong>${liveLv}</strong>`
                    : String(liveLv);
                const chgTxt = change > 0 ? `+${change}` : (change < 0 ? String(change) : '—');
                const chgCls = change !== 0 ? 'rec-bonus' : 'rec-nobonus';
                const chgAttr = change !== 0
                    ? ` title="Click to reset" style="cursor:pointer" onclick="dcResetPotLevelChange(${potId})"`
                    : '';
                html.push(`<tr>` +
                    `<td class="rec-name">${nm}</td>` +
                    `<td>${recLv}</td>` +
                    `<td>${effTxt}</td>` +
                    `<td class="${bonusCls}">${bonusTxt}</td>` +
                    `<td class="${chgCls}"${chgAttr}>${chgTxt}</td>` +
                    `</tr>`);
            }
            html.push('</tbody></table>');
        }

        // Compact record context: per-disc stats + build (flat, origin-domain)
        const ctx = [];
        const fmtVal = (k, v) => {
            const isPct = !!pctMap[k];
            return isPct && Math.abs(v) > 2 ? v * ifp : v;
        };
        (rec.discStats || []).forEach((d, i) => {
            const parts = Object.entries(d.attrs || {})
                .map(([k, v]) => `${k} ${fmtVal(k, v)}`).join(', ');
            if (parts) ctx.push(`${resolveRecordDiscName(d.id)}: ${parts}`);
        });
        const build = Object.entries(ch.build || {})
            .map(([k, v]) => `${k} ${fmtVal(k, v)}`).join(', ');
        if (build) ctx.push(`Build: ${build}`);
        if (ctx.length) {
            html.push(`<div class="rec-ctx">${ctx.map(s => escapeHtml(s)).join(' · ')}</div>`);
        }

        html.push('</div>');
    }

    html.push('</div>');
    panel.innerHTML = html.join('');
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, m =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
