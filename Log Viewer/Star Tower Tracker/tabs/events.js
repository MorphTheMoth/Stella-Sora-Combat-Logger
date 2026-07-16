// tabs/events.js — NPC Event RNG analysis

ST.eventFilters = { npcId: 0, evtId: 0, result: 'all' };

ST.renderEvents = function() {
    var panel = document.getElementById('panel-events');
    if (!panel) return;

    var events = ST.allEventRng;

    var npcIds = new Set();
    var evtIds = new Set();
    events.forEach(function(e) { if (e.npcId) npcIds.add(e.npcId); if (e.evtId) evtIds.add(e.evtId); });
    var npcArr = Array.from(npcIds).sort(function(a,b){return a-b;});
    var evtArr = Array.from(evtIds).sort(function(a,b){return a-b;});
    var npcOpts = '<option value="0">All NPCs</option>';
    npcArr.forEach(function(id) {
        npcOpts += '<option value="' + id + '"' + (ST.eventFilters.npcId === id ? ' selected' : '') + '>NPC ' + id + '</option>';
    });
    var evtOpts = '<option value="0">All Events</option>';
    evtArr.forEach(function(id) {
        evtOpts += '<option value="' + id + '"' + (ST.eventFilters.evtId === id ? ' selected' : '') + '>Event ' + id + '</option>';
    });

    var html = '<div class="filters">' +
        '<select onchange="ST.eventFilters.npcId=parseInt(this.value);ST.renderEvents()">' + npcOpts + '</select>' +
        '<select onchange="ST.eventFilters.evtId=parseInt(this.value);ST.renderEvents()">' + evtOpts + '</select>' +
        '<select onchange="ST.eventFilters.result=this.value;ST.renderEvents()">' +
            '<option value="all"' + (ST.eventFilters.result === 'all' ? ' selected' : '') + '>All Results</option>' +
            '<option value="resolved"' + (ST.eventFilters.result === 'resolved' ? ' selected' : '') + '>Resolved Only</option>' +
            '<option value="unresolved"' + (ST.eventFilters.result === 'unresolved' ? ' selected' : '') + '>Unresolved Only</option>' +
            '<option value="random"' + (ST.eventFilters.result === 'random' ? ' selected' : '') + '>Random Outcomes</option>' +
        '</select>' +
    '</div><div class="scroll-panel" id="eventContent"></div>';

    panel.innerHTML = html;

    var content = document.getElementById('eventContent');
    if (!content) return;

    // Filter
    var filtered = events.filter(function(e) {
        if (ST.eventFilters.npcId > 0 && e.npcId !== ST.eventFilters.npcId) return false;
        if (ST.eventFilters.evtId > 0 && e.evtId !== ST.eventFilters.evtId) return false;
        if (ST.eventFilters.result === 'resolved' && !e.resolved) return false;
        if (ST.eventFilters.result === 'unresolved' && e.resolved) return false;
        return true;
    });

    // Group by (evtId, selectedOption, npcId)
    var groups = {};
    filtered.forEach(function(e) {
        var optVal = e.selectedIdx >= 0 && e.options ? e.options[e.selectedIdx] : -1;
        var key = 'e' + e.evtId + '_opt' + optVal + '_npc' + e.npcId;
        if (!groups[key]) {
            groups[key] = {
                evtId: e.evtId, npcId: e.npcId,
                options: e.options,
                selectedIdx: e.selectedIdx,
                selectedOption: optVal,
                occurrences: [],
            };
        }
        groups[key].occurrences.push(e);
    });

    // Detect random outcomes
    var groupArr = Object.values(groups);
    groupArr.forEach(function(g) {
        g.isRandom = false;
        if (g.occurrences.length > 1) {
            var first = g.occurrences[0];
            for (var i = 1; i < g.occurrences.length; i++) {
                var cur = g.occurrences[i];
                if (first.optionsResult !== cur.optionsResult) { g.isRandom = true; break; }
                var a1 = itemsSig(first.items);
                var a2 = itemsSig(cur.items);
                if (a1 !== a2) { g.isRandom = true; break; }
                var b1 = JSON.stringify(first.affinityChange || []);
                var b2 = JSON.stringify(cur.affinityChange || []);
                if (b1 !== b2) { g.isRandom = true; break; }
                var c1 = JSON.stringify(first.subNoteSkills || []);
                var c2 = JSON.stringify(cur.subNoteSkills || []);
                if (c1 !== c2) { g.isRandom = true; break; }
            }
        }
        g.successes = g.occurrences.filter(function(e) { return e.optionsResult === true; }).length;
        g.failures = g.occurrences.filter(function(e) { return e.optionsResult === false; }).length;
        g.unresolvedCount = g.occurrences.filter(function(e) { return e.optionsResult === null; }).length;
    });

    if (ST.eventFilters.result === 'random') {
        groupArr = groupArr.filter(function(g) { return g.isRandom; });
    }

    groupArr.sort(function(a, b) {
        if (a.evtId !== b.evtId) return a.evtId - b.evtId;
        return a.selectedOption - b.selectedOption;
    });

    var resolved = filtered.filter(function(e) { return e.resolved; }).length;
    var unresolved = filtered.filter(function(e) { return !e.resolved; }).length;
    var randomCount = groupArr.filter(function(g) { return g.isRandom; }).length;

    var stats = '<div style="padding:12px 0;font-size:12px;color:#666;">' +
        resolved + ' resolved' + (unresolved > 0 ? ' · ' + unresolved + ' unresolved' : '') +
        ' · ' + groupArr.length + ' option combos' +
        (randomCount > 0 ? ' · <span style="color:#c8a050">' + randomCount + ' have random outcomes</span>' : '') +
        '</div>';

    // Build table
    var rows = '';
    groupArr.forEach(function(g) {
        var total = g.occurrences.length;
        var rate = (g.successes / g.occurrences.length * 100).toFixed(0);
        var optStr = g.selectedOption >= 0 ? ('#' + g.selectedIdx + '=' + g.selectedOption) : '?';
        var optDesc = describeOption(g.selectedOption);
        var resultStr = '';
        if (g.unresolvedCount > 0) {
            resultStr = '<span style="color:#555">' + g.unresolvedCount + ' pending</span>';
        } else if (g.successes === total) {
            resultStr = '<span style="color:#7aba7a">all ' + total + ' success</span>';
        } else if (g.failures === total) {
            resultStr = '<span style="color:#ba7a7a">all ' + total + ' fail</span>';
        } else {
            resultStr = g.successes + ' win / ' + g.failures + ' lose (' + rate + '%)';
        }

        // Items breakdown
        var itemSummary = summarizeItems(g.occurrences);

        // Random badge
        var randomBadge = g.isRandom ? '<span class="stat-badge" style="color:#c8a050;border-color:#6a4a20" title="Same option gave different outcomes">&#9888; RANDOM</span>' : '';
        var rowKey = 'evt' + g.evtId + '_' + g.selectedOption;

        rows += '<tr onclick="ST.toggleEventDetail(\'' + rowKey + '\',this)" style="cursor:pointer">' +
            '<td>' + g.evtId + '</td>' +
            '<td>' + g.npcId + '</td>' +
            '<td><span style="color:#555;font-size:10px">[' + (g.options || []).join(',') + ']</span></td>' +
            '<td>' + optStr + '</td>' +
            '<td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + randomBadge + ' ' + resultStr + '</td>' +
            '<td style="font-size:10px;color:#666">' + itemSummary + '</td>' +
            '</tr>';

        // Detail rows
        rows += '<tr class="evt-detail" id="evt-detail-' + rowKey + '" style="display:none"><td colspan="6" style="padding:4px 16px 10px">';
        rows += '<table class="data-table" style="width:100%"><tr><th>#</th><th>Run</th><th>Floor</th><th>Result</th><th>Items</th><th>Affinity</th></tr>';
        g.occurrences.forEach(function(e, i) {
            var res = e.optionsResult === null ? 'pending' : (e.optionsResult ? 'SUCCESS' : 'FAIL');
            var resClr = e.optionsResult === null ? '#555' : (e.optionsResult ? '#7aba7a' : '#ba7a7a');
            var itemsStr = (e.items || []).map(function(it) {
                return (ST.isPotential(it.tid) ? 'Pot#' + it.tid : ST.isNote(it.tid) ? ST.noteName(it.tid) : 'TID' + it.tid) + ' x' + (it.qty || 1);
            }).join(', ') || '—';
            var affStr = (e.affinityChange || []).map(function(a) {
                return 'NPC' + a.npcId + '+' + a.affinity;
            }).join(', ') || '—';
            rows += '<tr><td>' + (i + 1) + '</td><td>' + (e.runId != null ? e.runId : '?') + '</td><td>' + (e.floor || '?') + '</td><td style="color:' + resClr + '">' + res + '</td><td style="font-size:10px">' + itemsStr + '</td><td style="font-size:10px">' + affStr + '</td></tr>';
        });
        rows += '</table></td></tr>';
    });

    var tableHtml = '<div class="chart-card"><h3>Event Outcomes by Option</h3>' +
        '<table class="data-table"><tr><th>Event</th><th>NPC</th><th>Options</th><th>Chosen</th><th>Result</th><th>Rewards</th></tr>' +
        rows + '</table></div>';

    // Unresolved table
    var unresolvedRows = '';
    filtered.filter(function(e) { return !e.resolved; }).forEach(function(e) {
        unresolvedRows += '<tr><td>' + e.evtId + '</td><td>' + e.npcId + '</td><td><span style="color:#555;font-size:10px">[' + (e.options || []).join(',') + ']</span></td><td>?</td><td style="color:#555">pending</td><td>—</td></tr>';
    });
    var unresolvedHtml = '';
    if (unresolvedRows) {
        unresolvedHtml = '<div class="chart-card"><h3>Unresolved Events</h3>' +
            '<table class="data-table"><tr><th>Event</th><th>NPC</th><th>Options</th><th>Chosen</th><th>Result</th><th>Rewards</th></tr>' +
            unresolvedRows + '</table></div>';
    }

    // ── EE Trigger Heatmap ──
    var floorRoomCounts = {};
    ST.allFloorEvents.forEach(function(fe) {
        if (!floorRoomCounts[fe.floor]) floorRoomCounts[fe.floor] = { battle: 0, choice: 0, ee: 0 };
        if (fe.roomType === 0) floorRoomCounts[fe.floor].battle++;
        if (fe.roomType === 7) floorRoomCounts[fe.floor].choice++;
    });
    events.forEach(function(ee) {
        if (!floorRoomCounts[ee.floor]) floorRoomCounts[ee.floor] = { battle: 0, choice: 0, ee: 0 };
        floorRoomCounts[ee.floor].ee++;
    });
    var eeFloors = Object.keys(floorRoomCounts).map(Number).sort(function(a,b){return a-b;});
    var eeTableHtml = '<div class="chart-card"><h3>EE Trigger Heatmap (doc: Choice=100%, Battle varies, F7=0%, F10=100%)</h3><table class="data-table"><tr><th class="num">Floor</th><th class="num">Battle</th><th class="num">Choice</th><th class="num">EE Observed</th><th class="pct">Battle Rate</th><th>Expected</th></tr>';
    var expectedRates = {7: 'Battle 0%', 10: 'Battle 100%'};
    eeFloors.forEach(function(f) {
        var info = floorRoomCounts[f];
        var battleRate = info.battle > 0 ? (info.ee / info.battle * 100).toFixed(0) + '%' : '—';
        var expected = expectedRates[f] || (info.choice > 0 ? 'Choice 100%' : 'Battle varies');
        if (info.choice > 0 && expectedRates[f]) expected += ' + Choice 100%';
        eeTableHtml += '<tr><td class="num">' + f + '</td><td class="num">' + info.battle + '</td><td class="num">' + info.choice + '</td><td class="num">' + info.ee + '</td><td class="pct">' + battleRate + '</td><td style="font-size:10px;color:#666">' + expected + '</td></tr>';
    });
    eeTableHtml += '</table></div>';

    content.innerHTML = stats + tableHtml + unresolvedHtml + eeTableHtml;
};

function itemsSig(items) {
    return JSON.stringify((items || []).map(function(i) { return i.tid + ':' + (i.qty || 0); }).sort());
}

function describeOption(opt) {
    if (opt < 0) return '';
    if (opt >= 990010 && opt <= 990099) return 'SubNote#' + (opt - 990000);
    return '';
}

function summarizeItems(occurrences) {
    var agg = {};
    occurrences.forEach(function(e) {
        (e.items || []).forEach(function(it) {
            var key = it.tid + ':' + (it.qty || 0);
            agg[key] = (agg[key] || 0) + 1;
        });
    });
    var parts = [];
    for (var k in agg) {
        var p = k.split(':');
        var tid = parseInt(p[0]);
        var name = ST.isPotential(tid) ? ('Pot#' + tid) : ST.isNote(tid) ? ST.noteName(tid) : 'TID' + tid;
        parts.push(name + ' x' + p[1] + ' (' + agg[k] + '/' + occurrences.length + ')');
    }
    return parts.join(', ') || '—';
}

ST.toggleEventDetail = function(key, btn) {
    var row = document.getElementById('evt-detail-' + key);
    if (!row) return;
    row.style.display = row.style.display === 'none' ? '' : 'none';
};
