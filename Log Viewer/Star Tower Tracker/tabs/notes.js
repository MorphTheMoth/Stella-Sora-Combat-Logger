// tabs/notes.js — Notes RNG analysis

ST.noteFilters = { note: 0, source: 'all', stack: 'all', corr: 'all' };

ST.renderNotes = function() {
    var panel = document.getElementById('panel-notes');
    if (!panel) return;

    var noteOpts = '<option value="0"' + (ST.noteFilters.note===0?' selected':'') + '>All Notes</option>';
    ST.NOTE_IDS.forEach(function(tid) {
        noteOpts += '<option value="' + tid + '"' + (ST.noteFilters.note===tid?' selected':'') + '>' + ST.noteName(tid) + '</option>';
    });

    var html = '<div class="filters" id="noteFilters">' +
        '<select onchange="ST.noteFilters.note=parseInt(this.value);ST.renderNotes()">' + noteOpts + '</select>' +
        '<select onchange="ST.noteFilters.source=this.value;ST.renderNotes()">' +
            '<option value="all"' + (ST.noteFilters.source==='all'?' selected':'') + '>All Sources</option>' +
            '<option value="battle"' + (ST.noteFilters.source==='battle'?' selected':'') + '>Battle</option>' +
            '<option value="elite"' + (ST.noteFilters.source==='elite'?' selected':'') + '>Elite</option>' +
            '<option value="boss"' + (ST.noteFilters.source==='boss'?' selected':'') + '>Boss</option>' +
        '</select>' +
        '<select onchange="ST.noteFilters.stack=this.value;ST.renderNotes()">' +
            '<option value="all"' + (ST.noteFilters.stack==='all'?' selected':'') + '>All Drops</option>' +
            '<option value="stack"' + (ST.noteFilters.stack==='stack'?' selected':'') + '>Stacks (+9)</option>' +
            '<option value="base"' + (ST.noteFilters.stack==='base'?' selected':'') + '>Base Only</option>' +
        '</select>' +
        '<select onchange="ST.noteFilters.corr=this.value;ST.renderNotes()" style="margin-left:8px">' +
            '<option value="all"' + (ST.noteFilters.corr==='all'?' selected':'') + '>All Events</option>' +
            '<option value="low"' + (ST.noteFilters.corr==='low'?' selected':'') + '>Same Note: Low (0-5)</option>' +
            '<option value="mid"' + (ST.noteFilters.corr==='mid'?' selected':'') + '>Same Note: Mid (6-15)</option>' +
            '<option value="high"' + (ST.noteFilters.corr==='high'?' selected':'') + '>Same Note: High (16+)</option>' +
        '</select>' +
    '</div><div class="scroll-panel" id="noteContent"></div>';

    panel.innerHTML = html;

    var content = document.getElementById('noteContent');
    if (!content) return;

    var events = ST.allNoteEvents;

    // Apply filters
    var filtered = events.filter(function(e) {
        if (ST.noteFilters.note > 0 && e.tid !== ST.noteFilters.note) return false;
        if (ST.noteFilters.source !== 'all' && e.source !== ST.noteFilters.source) return false;
        if (ST.noteFilters.stack === 'stack' && !e.isStack) return false;
        if (ST.noteFilters.stack === 'base' && e.isStack) return false;
        if (ST.noteFilters.corr === 'low' && (e.context.sameNoteBefore < 0 || e.context.sameNoteBefore > 5)) return false;
        if (ST.noteFilters.corr === 'mid' && (e.context.sameNoteBefore < 6 || e.context.sameNoteBefore > 15)) return false;
        if (ST.noteFilters.corr === 'high' && e.context.sameNoteBefore < 16) return false;
        return true;
    });

    var totalFiltered = filtered.length || 1;

    var stats = '<div style="padding:12px 0;font-size:12px;color:#666;">' +
        filtered.length + ' note drops across ' + ST.runs.length + ' runs</div>';

    // Per-note stats
    var noteCounts = {};
    filtered.forEach(function(e) {
        noteCounts[e.tid] = (noteCounts[e.tid] || 0) + 1;
    });

    var keys = Object.keys(noteCounts).sort(function(a, b) { return noteCounts[b] - noteCounts[a]; });

    var tableHtml = '<div class="chart-card"><h3>Per-Note Rates</h3><table class="data-table"><tr><th>Note</th><th class="num">Count</th><th class="pct">Rate</th><th class="num">Avg Same-Before</th></tr>';
    for (var i = 0; i < keys.length; i++) {
        var tid = parseInt(keys[i]);
        var count = noteCounts[keys[i]];
        var rate = ((count / totalFiltered) * 100).toFixed(2);
        var sameEvents = filtered.filter(function(ev) { return ev.tid === tid; });
        var avgBefore = 0;
        if (sameEvents.length > 0) {
            var sum = 0;
            for (var j = 0; j < sameEvents.length; j++) sum += sameEvents[j].context.sameNoteBefore;
            avgBefore = sum / sameEvents.length;
        }
        tableHtml += '<tr><td>' + ST.noteName(tid) + '</td><td class="num">' + count + '</td><td class="pct">' + rate + '%</td><td class="num">' + avgBefore.toFixed(1) + '</td></tr>';
    }
    tableHtml += '</table></div>';

    // ── Correlation: current same-note count vs drop quantity ──
    var corrBuckets = { '0-5': {}, '6-10': {}, '11-15': {}, '16-25': {}, '26+': {} };
    filtered.forEach(function(e) {
        var before = e.context.sameNoteBefore;
        var bucket;
        if (before <= 5) bucket = '0-5';
        else if (before <= 10) bucket = '6-10';
        else if (before <= 15) bucket = '11-15';
        else if (before <= 25) bucket = '16-25';
        else bucket = '26+';

        if (!corrBuckets[bucket][e.tid]) corrBuckets[bucket][e.tid] = { count: 0, qty: 0, events: 0 };
        corrBuckets[bucket][e.tid].count++;
        corrBuckets[bucket][e.tid].qty += e.qty;
        corrBuckets[bucket][e.tid].events++;
    });

    var corrHtml = '<div class="chart-card"><h3>Drop Rate by Current Same-Note Count</h3>';
    corrHtml += '<table class="data-table"><tr><th>Same-Note Before</th><th>Events</th><th>Avg Drop Qty</th><th>Notes Dropped</th></tr>';
    Object.keys(corrBuckets).forEach(function(bucket) {
        var b = corrBuckets[bucket];
        var totalEvents = 0, totalQty = 0, totalEntries = 0;
        Object.keys(b).forEach(function(tid) {
            totalEvents += b[tid].events;
            totalQty += b[tid].qty;
            totalEntries += b[tid].count;
        });
        var avgQty = totalEvents > 0 ? (totalQty / totalEvents).toFixed(1) : '—';
        corrHtml += '<tr><td>' + bucket + '</td><td class="num">' + totalEvents + '</td><td class="num">' + avgQty + '</td><td class="num">' + totalQty + '</td></tr>';
    });
    corrHtml += '</table></div>';

    // ── Correlation: total notes vs note type composition ──
    var totBuckets = { '0-20': {}, '21-40': {}, '41-60': {}, '61-80': {}, '81+': {} };
    filtered.forEach(function(e) {
        var tb = e.context.totalNotesBefore;
        var bucket;
        if (tb <= 20) bucket = '0-20';
        else if (tb <= 40) bucket = '21-40';
        else if (tb <= 60) bucket = '41-60';
        else if (tb <= 80) bucket = '61-80';
        else bucket = '81+';

        if (!totBuckets[bucket][e.tid]) totBuckets[bucket][e.tid] = 0;
        totBuckets[bucket][e.tid]++;
    });

    var totHtml = '<div class="chart-card"><h3>Drop Composition by Total Notes Owned</h3>';
    totHtml += '<table class="data-table"><tr><th>Total Notes Before</th>';
    for (var i = 0; i < keys.length; i++) { totHtml += '<th class="num" style="font-size:9px">' + ST.noteName(parseInt(keys[i])).replace('Melody of ','').slice(0,6) + '</th>'; }
    totHtml += '<th class="num">Total</th></tr>';

    Object.keys(totBuckets).forEach(function(bucket) {
        var b = totBuckets[bucket];
        var rowTotal = 0;
        totHtml += '<tr><td>' + bucket + '</td>';
        for (var i = 0; i < keys.length; i++) {
            var tid = parseInt(keys[i]);
            var cnt = b[tid] || 0;
            rowTotal += cnt;
            totHtml += '<td class="num">' + (cnt > 0 ? cnt : '—') + '</td>';
        }
        totHtml += '<td class="num">' + rowTotal + '</td></tr>';
    });
    totHtml += '</table></div>';

    // ── Self-rate: does the dropped note tend to be the one you already have the most of? ──
    var selfMatches = 0;
    var selfTotal = 0;
    filtered.forEach(function(e) {
        var ncs = e.context.noteCounts;
        if (!ncs) return;
        var maxCount = 0, maxNote = null;
        Object.keys(ncs).forEach(function(tid) {
            if (ncs[tid] > maxCount) { maxCount = ncs[tid]; maxNote = parseInt(tid); }
        });
        if (maxNote && maxCount > 0) {
            selfTotal++;
            if (maxNote === e.tid) selfMatches++;
        }
    });

    var selfHtml = '<div class="chart-card"><h3>Self-Correlation: Is the drop the note you already have the most of?</h3>';
    if (selfTotal > 0) {
        var pct = (selfMatches / selfTotal * 100).toFixed(1);
        var expected = (1 / (keys.length || 1) * 100).toFixed(1);
        selfHtml += 'Matches: ' + selfMatches + ' / ' + selfTotal + ' (' + pct + '%) — ' +
            'vs expected ' + expected + '% if random<br>';
        if (parseFloat(pct) > parseFloat(expected) * 1.5) {
            selfHtml += '<span style="color:#c8a050">&#9888; Notes you own more of drop more often (streak effect)</span>';
        } else if (parseFloat(pct) < parseFloat(expected) * 0.5) {
            selfHtml += '<span style="color:#7aba7a">&#8595; Notes you own less of drop more often (balancing)</span>';
        } else {
            selfHtml += '<span style="color:#555">No strong correlation detected</span>';
        }
    }
    selfHtml += '</div>';

    // Stack detection stats
    var stackCount = events.filter(function(e) { return e.isStack; }).length;
    var stackHtml = '<div class="chart-card"><h3>Stack Triggers (Note of Surprise III)</h3>';
    stackHtml += 'Stacks detected: ' + stackCount + ' / ' + events.length + ' events (' + ((stackCount/events.length)*100).toFixed(1) + '%)';
    stackHtml += '</div>';

    content.innerHTML = stats + stackHtml + selfHtml + corrHtml + totHtml + tableHtml;
};
