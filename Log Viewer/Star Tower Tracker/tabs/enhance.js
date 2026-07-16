// tabs/enhance.js — Enhancement Machine usage analysis

ST.renderEnhance = function() {
    var panel = document.getElementById('panel-enhance');
    if (!panel) return;
    var html = '<div class="scroll-panel">';

    var data = ST.allStrengthenEvents;
    if (data.length === 0) {
        html += '<div class="chart-card"><h3>Enhancement Machine</h3><div class="no-data"><span>No enhancement data found</span></div></div>';
        panel.innerHTML = html;
        return;
    }

    var totalUses = data.length;
    var luckyCount = 0;
    var offersExpanded = [];
    data.forEach(function(s) {
        s.offers.forEach(function(o) {
            offersExpanded.push(o);
            if (o.lucky) luckyCount++;
        });
    });

    // ── Summary Stats ──
    html += '<div class="chart-card"><h3>Enhancement Machine Summary</h3>';
    html += '<p style="font-size:11px;color:#888;">' + totalUses + ' total enhancement events across all runs</p>';
    html += '<table class="data-table"><tr><th>Metric</th><th>Value</th></tr>';
    html += '<tr><td>Total offers seen</td><td>' + offersExpanded.length + '</td></tr>';
    html += '<tr><td>+2 (Lucky / Potential Boost III) offers</td><td>' + luckyCount + ' (' + (luckyCount / offersExpanded.length * 100).toFixed(1) + '%)</td></tr>';
    html += '<tr><td>+1 (Base) offers</td><td>' + (offersExpanded.length - luckyCount) + ' (' + ((offersExpanded.length - luckyCount) / offersExpanded.length * 100).toFixed(1) + '%)</td></tr>';
    html += '</table></div>';

    // ── Usage per Floor ──
    html += '<div class="chart-card"><h3>Usage per Floor</h3>';
    html += '<p style="font-size:11px;color:#666;margin-bottom:8px;">Doc: 4 Enhancement Machines (floors 5,12,19,20), cost 60→120→180→...</p>';
    var floorCounts = {}; var floorLucky = {};
    data.forEach(function(s) {
        floorCounts[s.floor] = (floorCounts[s.floor] || 0) + 1;
        s.offers.forEach(function(o) { if (o.lucky) floorLucky[s.floor] = (floorLucky[s.floor] || 0) + 1; });
    });

    var floors = Object.keys(floorCounts).map(Number).sort(function(a, b) { return a - b; });
    html += '<table class="data-table"><tr><th class="num">Floor</th><th class="num">Uses</th><th class="num">+2 Offers</th><th class="pct">+2 Rate</th></tr>';
    floors.forEach(function(f) {
        var uses = floorCounts[f];
        var luckyOnFloor = floorLucky[f] || 0;
        html += '<tr><td class="num">' + f + '</td><td class="num">' + uses + '</td><td class="num">' + luckyOnFloor + '</td><td class="pct">' + (luckyOnFloor / (uses * 3) * 100).toFixed(1) + '%</td></tr>';
    });
    html += '</table></div>';

    // ── Per-Run Usage ──
    html += '<div class="chart-card"><h3>Enhancements per Run</h3>';
    var runCounts = {};
    data.forEach(function(s) { runCounts[s.runId] = (runCounts[s.runId] || 0) + 1; });
    html += '<table class="data-table"><tr><th class="num">Run</th><th class="num">Uses</th><th>Floors</th></tr>';
    var totalRuns = ST.runs.length;
    var maxEnhanceRun = 0;
    for (var ri = 0; ri < totalRuns; ri++) {
        var cnt = runCounts[ri] || 0;
        if (cnt > maxEnhanceRun) maxEnhanceRun = cnt;
        var runFloors = data.filter(function(s) { return s.runId === ri; }).map(function(s) { return s.floor; });
        var floorStr = runFloors.length > 0 ? runFloors.join(', ') : '—';
        html += '<tr><td class="num">' + (ri + 1) + '</td><td class="num">' + cnt + '</td><td>' + floorStr + '</td></tr>';
    }
    html += '</table>';
    html += '<p style="font-size:11px;color:#888;margin-top:4px;">Max enhancements in one run: ' + maxEnhanceRun + '</p>';
    html += '</div>';

    // ── Detailed Event Log ──
    html += '<div class="chart-card"><h3>All Enhancement Events</h3>';
    html += '<table class="data-table"><tr><th class="num">Run</th><th class="num">Floor</th><th class="num">Attempt</th><th>Offers</th><th class="num">Lucky</th></tr>';
    data.forEach(function(s) {
        var offerStr = s.offers.map(function(o) {
            var name = ST.decodePotentialId(o.tid) ? ST.charName(ST.decodePotentialId(o.tid).charId) + ' #' + ST.decodePotentialId(o.tid).index : 'TID ' + o.tid;
            return name + ' +' + o.level + (o.lucky ? '*' : '');
        }).join(', ');
        var luckyStr = s.offers.filter(function(o) { return o.lucky; }).length + '/' + s.offers.length;
        html += '<tr><td class="num">' + (s.runId + 1) + '</td><td class="num">' + s.floor + '</td><td class="num">' + s.attemptId + '</td><td>' + offerStr + '</td><td>' + luckyStr + '</td></tr>';
    });
    html += '</table></div>';

    panel.innerHTML = html + '</div>';
};
