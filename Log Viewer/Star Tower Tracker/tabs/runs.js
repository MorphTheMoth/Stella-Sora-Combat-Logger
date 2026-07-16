// tabs/runs.js — Runs list with summaries and expandable timelines

ST.renderRuns = function() {
    var panel = document.getElementById('panel-runs');
    if (!panel) return;

    var runs = ST.runs;
    var html = '';

    if (runs.length === 0) {
        html = '<div class="no-data"><span>No runs found</span></div>';
    } else {
        html += '<div class="scroll-panel"><table class="run-table"><thead><tr>' +
            '<th></th><th>Tower</th><th>Characters</th><th>Floor</th><th>Potentials</th><th>Time</th><th>NPC</th>' +
            '</tr></thead><tbody>';

        for (var i = 0; i < runs.length; i++) {
            var run = runs[i];
            var s = run.start.data;
            var chars = s.chars || [];
            var charHtml = '';
            chars.forEach(function(c) {
                if (c && c.id) {
                    charHtml += '<img src="' + ST.charPortrait(c.id) + '" class="portrait-sm" title="' + ST.charName(c.id) + '" onerror="this.style.display=\'none\'">';
                }
            });
            if (!charHtml) charHtml = '<span style="color:#555">—</span>';

            var timeStr = '';
            if (run.totalTime != null) {
                var secs = run.totalTime;
                var min = Math.floor(secs / 60);
                timeStr = min + 'm ' + (secs % 60) + 's';
            }

            html += '<tr>' +
                '<td class="expand-btn" onclick="ST.toggleRun(' + i + ',this)">&#9654;</td>' +
                '<td>' + (s.towerId || '—') + '</td>' +
                '<td><div class="char-cell">' + charHtml + '</div></td>' +
                '<td>' + run.floorReached + '</td>' +
                '<td>' + run.potentialCnt + '</td>' +
                '<td>' + (timeStr || '—') + '</td>' +
                '<td>' + (run.npcInteraction || 0) + '</td>' +
                '</tr>';

            html += '<tr class="run-timeline" id="run-tl-' + i + '"><td colspan="7"></td></tr>';
        }
        html += '</tbody></table></div>';
    }

    panel.innerHTML = html;
};

ST.toggleRun = function(idx, btn) {
    var row = document.getElementById('run-tl-' + idx);
    if (!row) return;

    var open = row.classList.toggle('open');
    btn.innerHTML = open ? '&#9660;' : '&#9654;';

    if (open && !row.dataset.rendered) {
        row.dataset.rendered = '1';
        var run = ST.runs[idx];
        var html = '';

        // Start event
        var startEv = run.start;
        html += '<div class="tl-event"><span class="tl-type">START</span><span class="tl-detail">' +
            'Tower ' + (startEv.data.towerId || '?') + ', Coins: ' + (startEv.data.coinQty || 0) +
            ', Floor ' + (startEv.data.floor || 1) +
            '</span></div>';

        // Timeline events
        for (var i = 0; i < run.events.length; i++) {
            var ev = run.events[i];
            var detail = '';
            var evType = ev.type;

            if (ev.type === 'SEND') {
                var d = ev.data;
                var action = d.action || '';
                detail = 'msgId=' + d.msgId + ' caseId=' + (d.caseId || '—');
                if (action) detail += ' action=' + action;
                if (d.select) detail += ' idx=' + d.select.index + (d.select.reRoll ? ' reroll' : '');
                if (d.hawker) detail += ' sid=' + d.hawker.sid + (d.hawker.reRoll ? ' reroll' : '');

            } else if (ev.type === 'RECV') {
                var d = ev.data;
                var action = d.action || '';
                detail = 'caseId=' + (d.caseId || '—') + ' action=' + action;

                if (action === 'battle') {
                    detail += ' ' + (d.victory ? 'VICTORY' : d.defeat ? 'DEFEAT' : '?');
                    detail += ' exp=' + (d.exp || 0) + ' lvl=' + (d.level || '—');
                } else if (action === 'enter') {
                    var rd = d.room ? d.room.data : null;
                    if (rd) detail += ' floor=' + rd.floor + ' type=' + (ST.ROOM_NAMES[rd.roomType] || rd.roomType);
                } else if (action === 'select') {
                    var items = (d.selectResp && d.selectResp.resp) ? (d.selectResp.resp.items || []) : [];
                    if (items.length > 0) {
                        var itemStr = items.map(function(it) {
                            if (ST.isPotential(it.tid)) {
                                var dec = ST.decodePotentialId(it.tid);
                                return dec ? ('Pot ' + ST.charName(dec.charId) + ' #' + dec.index) : 'TID ' + it.tid;
                            }
                            return 'TID ' + it.tid;
                        }).join(', ');
                        detail += ' gained: ' + itemStr;
                    }
                } else if (action === 'strengthen') {
                    detail += ' success=' + (d.buySucceed ? 'Y' : 'N');
                } else if (action === 'settle') {
                    var s = d.settle || {};
                    detail += ' npc=' + (s.npcInteraction || 0) + ' pots=' +
                        ((s.build && s.build.detail && s.build.detail.potentials) ? s.build.detail.potentials.length : '?');
                }

                var notes = (d.data && d.data.infos) ? d.data.infos : [];
                if (notes.length > 0) {
                    detail += ' | notes: ';
                    notes.forEach(function(n) {
                        detail += ST.noteName(n.tid) + (n.qty > 0 ? '+' : '') + n.qty + ' ';
                    });
                }

                // Show new cases
                var cases = d.cases || [];
                if (cases.length > 0) {
                    var caseStr = cases.map(function(c) {
                        if (c.caseType === 3) return 'PotOffer(' + (c.infos || []).length + ')';
                        if (c.caseType === 7) return 'SpecPot(' + (c.ids || []).length + ')';
                        if (c.caseType === 1) return 'Battle';
                        if (c.caseType === 2) return 'Door→' + c.floor;
                        if (c.caseType === 6) return 'NPC#' + c.evtId;
                        if (c.caseType === 10) return 'Shop(' + (c.list || []).length + ')';
                        if (c.caseType === 11) return 'Strengthen';
                        if (c.caseType === 13) return 'SyncHP';
                        return 'Case' + c.caseType;
                    }).join(', ');
                    detail += ' | cases: [' + caseStr + ']';
                }
            }

            if (ev.type === 'RECV') evType = 'RECV';
            html += '<div class="tl-event"><span class="tl-type">' + evType + '</span><span class="tl-detail">' + detail + '</span></div>';
        }

        // End event
        if (run.end) {
            var ed = run.end.data;
            if (ed.action === 'settle' && ed.settle) {
                var s = ed.settle;
                html += '<div class="tl-event"><span class="tl-type">END</span><span class="tl-detail">' +
                    'Floor=' + (run.floorReached || '?') + ', Potentials=' + (run.potentialCnt || 0) +
                    ' — Cleared</span></div>';
            } else {
                var t = ed.totalTime || 0;
                html += '<div class="tl-event"><span class="tl-type">END</span><span class="tl-detail">' +
                    'Floor=' + (ed.floor || '?') + ', Potentials=' + (ed.potentialCnt || 0) +
                    ', Time=' + Math.floor(t / 60) + 'm ' + (t % 60) + 's' +
                    '</span></div>';
            }
        }

        // Economy summary
        html += ST._renderRunEconomy(run);

        row.querySelector('td').innerHTML = html;
    }
};

ST._renderRunEconomy = function(run) {
    var floorData = {};
    var currentFloor = (run.start.data.floor || 1);
    var lastEnterIdx = -1;

    // First pass: collect per-floor data from events
    for (var i = 0; i < run.events.length; i++) {
        var ev = run.events[i];
        if (ev.type !== 'RECV') continue;
        var d = ev.data;

        // Track floor changes
        if (d.action === 'enter' && d.room && d.room.data) {
            var rd = d.room.data;
            currentFloor = rd.floor;
            if (!floorData[currentFloor]) {
                floorData[currentFloor] = {
                    floor: currentFloor,
                    roomType: rd.roomType,
                    notes: [], offered: [], picked: [], npcEvents: 0, potentialOffers: 0, noteEvents: 0,
                };
            }
            lastEnterIdx = i;
        }

        if (!floorData[currentFloor]) {
            floorData[currentFloor] = {
                floor: currentFloor, roomType: null,
                notes: [], offered: [], picked: [], npcEvents: 0, potentialOffers: 0, noteEvents: 0,
            };
        }

        // Notes from infos
        var infos = (d.data && d.data.infos) || [];
        infos.forEach(function(n) {
            if (ST.isNote(n.tid) && n.qty > 0) {
                floorData[currentFloor].notes.push({ tid: n.tid, qty: n.qty });
                floorData[currentFloor].noteEvents++;
            }
        });

        // Potential offers from cases
        var cases = d.cases || [];
        cases.forEach(function(c) {
            if (c.caseType === 3 || c.caseType === 7) {
                floorData[currentFloor].potentialOffers++;
            }
        });
        if (d.room && d.room.cases) {
            d.room.cases.forEach(function(c) {
                if (c.caseType === 3 || c.caseType === 7) {
                    floorData[currentFloor].potentialOffers++;
                }
            });
        }

        // Strehgthen (enhancement) offers
        if (d.action === 'strengthen' && d.cases && d.cases[0] && d.cases[0].infos) {
            floorData[currentFloor].potentialOffers++;
        }

        // Picks from selectResp
        if (d.action === 'select' && d.selectResp && d.selectResp.resp && d.selectResp.resp.items) {
            d.selectResp.resp.items.forEach(function(it) {
                if (ST.isPotential(it.tid)) {
                    floorData[currentFloor].picked.push(it);
                }
            });
        }

        // NPC events
        if (d.cases) {
            d.cases.forEach(function(c) {
                if (c.caseType === 6) floorData[currentFloor].npcEvents++;
            });
        }
        if (d.room && d.room.cases) {
            d.room.cases.forEach(function(c) {
                if (c.caseType === 6) floorData[currentFloor].npcEvents++;
            });
        }
    }

    // Build the table
    var floors = Object.keys(floorData).map(Number).sort(function(a, b) { return a - b; });
    if (floors.length === 0) return '';

    var html = '<div class="tl-economy"><div class="tl-eco-title">Economy per Floor</div>';
    html += '<table class="eco-table"><tr>' +
        '<th class="num">Floor</th><th>Room</th><th>Notes</th><th class="num">Pot Offers</th><th class="num">Pot Picks</th><th class="num">NPC</th>' +
        '</tr>';

    var totalNotes = 0, totalOffers = 0, totalPicks = 0, totalNpc = 0;
    floors.forEach(function(f) {
        var fd = floorData[f];
        var noteList = fd.notes.map(function(n) { return ST.noteName(n.tid) + '+' + n.qty; }).join(', ');
        totalNotes += fd.notes.reduce(function(s, n) { return s + n.qty; }, 0);
        totalOffers += fd.potentialOffers;
        totalPicks += fd.picked.length;
        totalNpc += fd.npcEvents;
        html += '<tr><td>' + f + '</td><td>' + (fd.roomType != null ? (ST.ROOM_NAMES[fd.roomType] || fd.roomType) : '—') + '</td>' +
            '<td>' + (noteList || '—') + '</td><td class="num">' + fd.potentialOffers + '</td>' +
            '<td class="num">' + fd.picked.length + '</td><td class="num">' + fd.npcEvents + '</td></tr>';
    });

    html += '<tr class="eco-total"><td colspan="2"><strong>Total</strong></td><td><strong>' + totalNotes + '</strong></td>' +
        '<td class="num"><strong>' + totalOffers + '</strong></td>' +
        '<td class="num"><strong>' + totalPicks + '</strong></td>' +
        '<td class="num"><strong>' + totalNpc + '</strong></td></tr>';
    html += '</table></div>';

    return html;
};
