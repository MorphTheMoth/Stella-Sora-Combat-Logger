// tabs/stats.js — Ascension run stats: team pie chart + floor bar chart

ST._statsCharts = { team: null, floor: null };

ST._statsPalette = [
    '#6a9fd8', '#c06a8a', '#6abf7a', '#d8b45a', '#8a6ad8',
    '#d87a5a', '#5ad8c0', '#d85a9f', '#8ad85a', '#5a8ad8',
    '#bf6a5a', '#5abf8a', '#8a5abf', '#bf8a5a', '#5abfbf',
];

ST._statsColor = function(idx) {
    if (idx < ST._statsPalette.length) return ST._statsPalette[idx];
    var hue = (idx * 47) % 360;
    return 'hsl(' + hue + ',55%,60%)';
};

ST._statsDestroy = function() {
    if (ST._statsCharts.team) { try { ST._statsCharts.team.destroy(); } catch(e) {} ST._statsCharts.team = null; }
    if (ST._statsCharts.floor) { try { ST._statsCharts.floor.destroy(); } catch(e) {} ST._statsCharts.floor = null; }
};

ST._statsNormalizedTeam = function(chars) {
    if (!chars || chars.length === 0) return { key: 'unknown', label: '—', ids: [], ordered: [] };
    // First char is anchor (slot 1), rest sorted alphabetically by char name
    var first = chars[0];
    var rest = chars.slice(1);
    rest.sort(function(a, b) {
        var na = ST.charName(a.id) || String(a.id);
        var nb = ST.charName(b.id) || String(b.id);
        return na.localeCompare(nb);
    });
    var ordered = [first].concat(rest);
    var ids = ordered.map(function(c) { return c.id; });
    var key = ids.join('|');
    var firstName = ST.charName(first.id) || ('Char ' + first.id);
    var restNames = rest.map(function(c) { return ST.charName(c.id) || ('Char ' + c.id); });
    var label = restNames.length > 0 ? firstName + ' + ' + restNames.join(', ') : firstName;
    return { key: key, label: label, ids: ids, ordered: ordered };
};

ST.renderStats = function() {
    var panel = document.getElementById('panel-stats');
    if (!panel) return;

    var runs = ST.runs || [];
    if (runs.length === 0) {
        ST._statsDestroy();
        panel.innerHTML = '<div class="no-data"><span>No runs found</span></div>';
        return;
    }

    // — Build data —
    // Team distribution — with floor-bucket breakdown (0-3, 4-5, 6-19, 20)
    var bucketDefs = [
        { label: '0–3',  min: 0, max: 3 },
        { label: '4–5',  min: 4, max: 5 },
        { label: '6–19', min: 6, max: 19 },
        { label: '20',   min: 20, max: 20 },
    ];
    function bucketIdxFor(floor) {
        if (floor == null) floor = 0;
        for (var bi = 0; bi < bucketDefs.length; bi++) {
            if (floor >= bucketDefs[bi].min && floor <= bucketDefs[bi].max) return bi;
        }
        // floors beyond 20 (if any) count as last bucket
        return bucketDefs.length - 1;
    }
    var teamMap = {}; // key -> { count, label, ids, ordered, buckets: [n0,n1,n2,n3], coinWon, coinLost }
    var runIdToTeamKey = {};
    runs.forEach(function(run) {
        var chars = (run.start && run.start.data && run.start.data.chars) ? run.start.data.chars : [];
        // Filter out empty char entries
        var valid = chars.filter(function(c) { return c && c.id; });
        var t = ST._statsNormalizedTeam(valid);
        runIdToTeamKey[run.id] = t.key;
        if (!teamMap[t.key]) {
            teamMap[t.key] = { count: 0, label: t.label, ids: t.ids.slice(), ordered: t.ordered.slice(), buckets: [0,0,0,0], coinWon: 0, coinLost: 0 };
        }
        teamMap[t.key].count++;
        var f = run.floorReached;
        var bi = bucketIdxFor(f);
        teamMap[t.key].buckets[bi]++;
    });

    // — 650 coin gamble per-team W/L (evtId 105, option 10502 at idx 1) —
    // The classic "650 coin" NPC gamble: evtId 105, option 10502 (second choice).
    // optionsResult is always true for this event (so it cannot distinguish win/loss).
    // Real outcome is in resp.items: win = {tid:11, qty:650}, loss = {tid:11, qty:-200} (negative).
    (ST.allEventRng || []).forEach(function(ev) {
        if (!ev || ev.evtId !== 105) return;
        var opt = ev.options && ev.selectedIdx >= 0 ? ev.options[ev.selectedIdx] : null;
        var isGamble = (opt === 10502) || (ev.selectedIdx === 1 && ev.options && ev.options.length === 3 && ev.options[0] === 10501);
        if (!isGamble) return;
        if (!ev.resolved) return;
        var key = runIdToTeamKey[ev.runId];
        if (!key || !teamMap[key]) return;
        var items = ev.items || [];
        var won = false, lost = false;
        for (var ii = 0; ii < items.length; ii++) {
            var it = items[ii];
            if (it.tid === 11) {
                if (it.qty === 650) won = true;
                else if (it.qty < 0) lost = true;
            }
        }
        // Fallback: if items empty but optionsResult present, treat true as won (legacy)
        if (!won && !lost) {
            if (ev.optionsResult === true) won = true;
            else if (ev.optionsResult === false) lost = true;
        }
        if (won) teamMap[key].coinWon++;
        else if (lost) teamMap[key].coinLost++;
    });

    var teamEntries = Object.values(teamMap);
    teamEntries.sort(function(a, b) { return b.count - a.count; });

    // Floor distribution
    var floorMap = {}; // floor -> count
    runs.forEach(function(run) {
        var f = run.floorReached;
        if (f == null) f = 0;
        floorMap[f] = (floorMap[f] || 0) + 1;
    });
    var floorKeys = Object.keys(floorMap).map(Number).sort(function(a, b) { return a - b; });
    var floorCounts = floorKeys.map(function(k) { return floorMap[k]; });

    var totalRuns = runs.length;

    // — Build HTML shell —
    var html = '<div class="scroll-panel">' +
        '<div style="padding:4px 0 12px;font-size:12px;color:#666;">' + totalRuns + ' ascension runs</div>';

    // Team pie
    html += '<div class="chart-card"><h3>Teams Used — ' + totalRuns + ' runs, ' + teamEntries.length + ' unique teams</h3>' +
        '<div class="chart-wrap" style="height:320px"><canvas id="statsTeamPie"></canvas></div>' +
        '<table class="data-table" id="statsTeamTable"></table></div>';

    // Floor bar
    html += '<div class="chart-card"><h3>Runs Ending at Floor X</h3>' +
        '<div class="chart-wrap" style="height:280px"><canvas id="statsFloorBar"></canvas></div>' +
        '<table class="data-table" id="statsFloorTable"></table></div>';

    html += '</div>';
    panel.innerHTML = html;

    // Fill tables
    var teamTable = document.getElementById('statsTeamTable');
    if (teamTable) {
        var th = '<tr><th>Team (slot 1 + sorted 2,3)</th><th class="num">Runs</th><th class="pct">Share</th>' +
            '<th class="num" title="Runs ending at floor 0–3">0–3</th>' +
            '<th class="num" title="Runs ending at floor 4–5">4–5</th>' +
            '<th class="num" title="Runs ending at floor 6–19">6–19</th>' +
            '<th class="num" title="Runs ending at floor 20 (cleared)">20</th>' +
            '<th class="num" title="650 coin gamble (evt 105 option 10502) — won / lost">650c W/L</th></tr>';
        var rows = '';
        teamEntries.forEach(function(te, idx) {
            var color = ST._statsColor(idx);
            var pct = (te.count / totalRuns * 100).toFixed(1);
            // Show portraits if available
            var portraits = '';
            if (te.ordered && te.ordered.length > 0) {
                portraits = te.ordered.map(function(c) {
                    return '<img src="' + ST.charPortrait(c.id) + '" class="portrait-sm" title="' + ST.charName(c.id) + '" onerror="this.style.display=\'none\'" style="margin-right:3px">';
                }).join('');
            }
            var dot = '<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + color + ';margin-right:6px;vertical-align:middle"></span>';
            var coinCell = te.coinWon + '/' + te.coinLost;
            // faint if never seen the gamble
            var coinStyle = (te.coinWon + te.coinLost === 0) ? ' style="color:#555"' : '';
            rows += '<tr><td>' + portraits + dot + te.label + '</td><td class="num">' + te.count + '</td><td class="pct">' + pct + '%</td>' +
                '<td class="num">' + te.buckets[0] + '</td>' +
                '<td class="num">' + te.buckets[1] + '</td>' +
                '<td class="num">' + te.buckets[2] + '</td>' +
                '<td class="num">' + te.buckets[3] + '</td>' +
                '<td class="num"' + coinStyle + '>' + coinCell + '</td></tr>';
        });
        teamTable.innerHTML = th + rows;
    }

    var floorTable = document.getElementById('statsFloorTable');
    if (floorTable) {
        var th2 = '<tr><th class="num">Floor</th><th class="num">Runs</th><th class="pct">Share</th></tr>';
        var rows2 = '';
        floorKeys.forEach(function(f) {
            var cnt = floorMap[f];
            var pct = (cnt / totalRuns * 100).toFixed(1);
            rows2 += '<tr><td class="num">' + f + '</td><td class="num">' + cnt + '</td><td class="pct">' + pct + '%</td></tr>';
        });
        floorTable.innerHTML = th2 + rows2;
    }

    // — Render charts (next frame to ensure canvas is in DOM) —
    ST._statsDestroy();
    requestAnimationFrame(function() {
        // Team pie
        var pieCanvas = document.getElementById('statsTeamPie');
        if (pieCanvas && teamEntries.length > 0 && typeof Chart !== 'undefined') {
            var pieLabels = teamEntries.map(function(te) { return te.label; });
            var pieData = teamEntries.map(function(te) { return te.count; });
            var pieColors = teamEntries.map(function(_, idx) { return ST._statsColor(idx); });
            ST._statsCharts.team = new Chart(pieCanvas, {
                type: 'pie',
                data: {
                    labels: pieLabels,
                    datasets: [{ data: pieData, backgroundColor: pieColors, borderColor: '#222', borderWidth: 1 }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: true, position: 'right', labels: { color: '#888', font: { size: 11 }, boxWidth: 14, padding: 12 } },
                        tooltip: {
                            callbacks: {
                                label: function(ctx) {
                                    var v = ctx.parsed;
                                    var pct = (v / totalRuns * 100).toFixed(1);
                                    return ' ' + ctx.label + ': ' + v + ' (' + pct + '%)';
                                }
                            }
                        }
                    }
                }
            });
        }

        // Floor bar
        var barCanvas = document.getElementById('statsFloorBar');
        if (barCanvas && floorKeys.length > 0 && typeof Chart !== 'undefined') {
            var barLabels = floorKeys.map(function(f) { return 'F' + f; });
            ST._statsCharts.floor = new Chart(barCanvas, {
                type: 'bar',
                data: {
                    labels: barLabels,
                    datasets: [{
                        label: 'Runs',
                        data: floorCounts,
                        backgroundColor: '#6a9fd8',
                        borderColor: '#4a7aaa',
                        borderWidth: 1,
                        borderRadius: 3,
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: function(ctx) {
                                    var v = ctx.parsed.y;
                                    var pct = (v / totalRuns * 100).toFixed(1);
                                    return ' ' + v + ' runs (' + pct + '%)';
                                }
                            }
                        }
                    },
                    scales: {
                        x: { ticks: { color: '#888', font: { size: 11 } }, grid: { color: '#252525' }, title: { display: true, text: 'Floor reached', color: '#666', font: { size: 11 } } },
                        y: { beginAtZero: true, ticks: { color: '#888', precision: 0 }, grid: { color: '#252525' }, title: { display: true, text: 'Runs', color: '#666', font: { size: 11 } } }
                    }
                }
            });
        }
    });
};
