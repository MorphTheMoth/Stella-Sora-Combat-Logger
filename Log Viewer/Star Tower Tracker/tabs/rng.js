// tabs/rng.js — RNG Validation: compare observed rates to doc's theories

ST.renderRng = function() {
    var panel = document.getElementById('panel-rng');
    if (!panel) return;
    var html = '<div class="scroll-panel">';

    // ── 1. Note Drop Quantity by Source ──
    html += '<div class="chart-card"><h3>Note Drop Batches by Source (qty distribution)</h3>';
    html += '<p style="font-size:11px;color:#666;margin-bottom:8px;">Expected (doc): Battle/Rival={3,6,9,12,18}, Boss={6,12,15,18,21,27,33,39}</p>';

    var batchQtyBySource = {};
    var runs = ST.runs;
    for (var ri = 0; ri < runs.length; ri++) {
        var run = runs[ri];
        for (var ei = 0; ei < run.events.length; ei++) {
            var ev = run.events[ei];
            if (ev.type !== 'RECV') continue;
            var d = ev.data;
            var infos = (d.data && d.data.infos) || [];
            var batchTotal = 0;
            infos.forEach(function(n) { if (ST.isNote(n.tid) && n.qty > 0) batchTotal += n.qty; });
            if (batchTotal === 0) continue;

            var roomType = ST._findFloorRoomType(run, ei, d);
            var src = ST.roomTypeSource(roomType);
            if (!batchQtyBySource[src]) batchQtyBySource[src] = {};
            batchQtyBySource[src][batchTotal] = (batchQtyBySource[src][batchTotal] || 0) + 1;
        }
    }

    html += '<table class="data-table"><tr><th>Source</th><th class="num">Qty</th><th class="num">Count</th><th class="pct">%</th></tr>';
    var srcOrder = ['battle', 'elite', 'boss', 'other'];
    srcOrder.forEach(function(src) {
        var dist = batchQtyBySource[src];
        if (!dist) return;
        var total = 0; for (var k in dist) total += dist[k];
        var sortedQtys = Object.keys(dist).map(Number).sort(function(a, b) { return a - b; });
        sortedQtys.forEach(function(qty) {
            var cnt = dist[qty];
            html += '<tr><td>' + src + '</td><td class="num">' + qty + '</td><td class="num">' + cnt + '</td><td class="pct">' + (cnt / total * 100).toFixed(1) + '%</td></tr>';
        });
    });
    html += '</table></div>';

    // ── 2. Stack Count per Run (Note of Surprise III) ──
    html += '<div class="chart-card"><h3>Note of Surprise III — Stacks per Run (doc: max 4 per run)</h3>';
    html += '<p style="font-size:11px;color:#666;margin-bottom:8px;">Doc: a stack = +6 on top of +3 base = 9 notes of one type per info entry. Luck Note III adds extra bases (larger totals), not stacks.</p>';
    var stackCounts = [];
    runs.forEach(function(run) {
        var count = 0;
        for (var ei = 0; ei < run.events.length; ei++) {
            var ev = run.events[ei];
            if (ev.type !== 'RECV') continue;
            var d = ev.data;
            var infos = (d.data && d.data.infos) || [];
            infos.forEach(function(n) {
                if (ST.isNote(n.tid) && n.qty === 9) count++;
            });
        }
        stackCounts.push({ runId: run.id, count: count });
    });

    var maxStacks = 0;
    stackCounts.forEach(function(s) { if (s.count > maxStacks) maxStacks = s.count; });
    html += '<p style="font-size:11px;color:#888;">Max stacks seen: ' + maxStacks + ' — ' +
        (maxStacks <= 4 ? '<span style="color:#8aba8a;">✓ matches theory</span>' : '<span style="color:#c86a4a;">✗ exceeds theory limit of 4</span>') + '</p>';
    html += '<table class="data-table"><tr><th class="num">Stacks</th><th class="num">Runs</th><th class="pct">%</th></tr>';
    var stackBuckets = {};
    stackCounts.forEach(function(s) {
        var b = s.count;
        stackBuckets[b] = (stackBuckets[b] || 0) + 1;
    });
    var sortedBuckets = Object.keys(stackBuckets).map(Number).sort(function(a, b) { return a - b; });
    sortedBuckets.forEach(function(b) {
        html += '<tr><td class="num">' + b + '</td><td class="num">' + stackBuckets[b] + '</td><td class="pct">' + (stackBuckets[b] / runs.length * 100).toFixed(1) + '%</td></tr>';
    });
    html += '</table></div>';

    // ── 3. Potential Offer Trigger Rate per Floor ──
    html += '<div class="chart-card"><h3>Potential Offer Trigger Rate by Floor</h3>';
    html += '<p style="font-size:11px;color:#666;margin-bottom:8px;">Expected triggers (doc): 1 on floors 3,4,6,8,13,15,17 — 2 on floors 11,18,20 — 0 elsewhere</p>';

    var potOffersByFloor = {};
    ST.allPotentialEvents.forEach(function(pe) {
        if (!potOffersByFloor[pe.floor]) potOffersByFloor[pe.floor] = { totalBattles: 0, total: 0, events: [] };
        potOffersByFloor[pe.floor].total++;
        potOffersByFloor[pe.floor].events.push(pe);
    });

    var floors = Object.keys(potOffersByFloor).map(Number).sort(function(a, b) { return a - b; });
    html += '<table class="data-table"><tr><th class="num">Floor</th><th class="num">Offers Seen</th><th class="num">Runs w/ Offer</th><th class="num">Expected</th><th>Match</th></tr>';
    var expectedTriggers = { 3:1, 4:1, 6:1, 8:1, 11:2, 13:1, 15:1, 17:1, 18:2, 20:2 };
    floors.forEach(function(f) {
        var info = potOffersByFloor[f];
        var runsWithOffer = {}; info.events.forEach(function(e) { runsWithOffer[e.runId] = true; });
        var runCount = Object.keys(runsWithOffer).length;
        var exp = expectedTriggers[f] || 0;
        var match = info.total >= exp ? '✓' : '✗';
        html += '<tr><td class="num">' + f + '</td><td class="num">' + info.total + '</td><td class="num">' + runCount + '/' + runs.length + '</td><td class="num">' + exp + '</td><td>' + match + '</td></tr>';
    });
    html += '</table></div>';

    // ── 4. Boost Distribution (Butterflies Inside III / Radiant Miracle) ──
    html += '<div class="chart-card"><h3>Potential Boost Distribution</h3>';
    html += '<p style="font-size:11px;color:#666;margin-bottom:8px;">Doc: +1 = base, +2 = Radiant Miracle (~40%), +3 = Butterflies Inside III (~30%)</p>';

    var boostCounts = {}; var totalOffers = 0;
    ST.allPotentialEvents.forEach(function(pe) {
        pe.offers.forEach(function(o) {
            var b = o.boost;
            boostCounts[b] = (boostCounts[b] || 0) + 1;
            totalOffers++;
        });
    });

    html += '<table class="data-table"><tr><th>Boost</th><th class="num">Count</th><th class="pct">Rate</th><th>Interpretation</th></tr>';
    var boosts = Object.keys(boostCounts).map(Number).sort(function(a, b) { return a - b; });
    boosts.forEach(function(b) {
        var cnt = boostCounts[b];
        var rate = cnt / totalOffers * 100;
        var interpret = b === 1 ? 'Base' : b === 2 ? 'Radiant Miracle' : b === 3 ? 'Butterflies Inside III' : b >= 4 ? 'Both / Stacked' : '';
        html += '<tr><td class="num">+' + b + '</td><td class="num">' + cnt + '</td><td class="pct">' + rate.toFixed(1) + '%</td><td>' + interpret + '</td></tr>';
    });
    html += '<tr><td colspan="4" style="font-size:10px;color:#555;">Total offers: ' + totalOffers + '</td></tr>';
    html += '</table></div>';

    // ── 5. EE Trigger Rate per Floor ──
    html += '<div class="chart-card"><h3>Employee Event Trigger Rate by Floor</h3>';
    html += '<p style="font-size:11px;color:#666;margin-bottom:8px;">Doc: Choice=100%, Battle varies, Floor 7=0%, Floor 10=100%, at least 1 in Section 3. Max 5 == random only (guaranteed: Choice, Floor 10)</p>';

    var floorRoomCounts = {};  // floor -> {battle: N, choice: N, eeTriggered: N}
    ST.allFloorEvents.forEach(function(fe) {
        if (!floorRoomCounts[fe.floor]) floorRoomCounts[fe.floor] = { battle: 0, choice: 0, eeTriggered: 0, eeGuaranteed: 0 };
        var rt = fe.roomType;
        if (rt === 0) floorRoomCounts[fe.floor].battle++;
        if (rt === 7) floorRoomCounts[fe.floor].choice++;
    });
    ST.allEventRng.forEach(function(ee) {
        if (!floorRoomCounts[ee.floor]) floorRoomCounts[ee.floor] = { battle: 0, choice: 0, eeTriggered: 0, eeGuaranteed: 0 };
        floorRoomCounts[ee.floor].eeTriggered++;
        // Guaranteed: Choice (roomType 7) or Floor 10 Battle (roomType 0)
        if (ee.roomType === 7 || (ee.floor === 10 && ee.roomType === 0)) {
            floorRoomCounts[ee.floor].eeGuaranteed++;
        }
    });

    var eeFloors = Object.keys(floorRoomCounts).map(Number).sort(function(a, b) { return a - b; });
    html += '<table class="data-table"><tr><th class="num">Floor</th><th class="num">Battle</th><th class="num">Choice</th><th class="num">EE</th><th class="pct">Battle Rate</th><th>Expected</th></tr>';
    eeFloors.forEach(function(f) {
        var info = floorRoomCounts[f];
        var battleRate = info.battle > 0 ? (info.eeTriggered / info.battle * 100).toFixed(1) + '%' : '—';
        var exp = '';
        if (info.choice > 0) exp += 'Choice=100% ';
        if (f === 7) exp += 'Battle=0%';
        else if (f === 10) exp += 'Battle=100%';
        if (!exp) exp = 'Battle varies';
        html += '<tr><td class="num">' + f + '</td><td class="num">' + info.battle + '</td><td class="num">' + info.choice + '</td><td class="num">' + info.eeTriggered + '</td><td class="pct">' + battleRate + '</td><td style="font-size:10px;">' + exp + '</td></tr>';
    });

    // Per-run EE count (guaranteed vs random)
    html += '</table><br><h3 style="font-size:11px;color:#888;margin-top:8px;">EE per Run</h3>';
    var eeTotal = {}; var eeRandom = {};
    runs.forEach(function(run) { eeTotal[run.id] = 0; eeRandom[run.id] = 0; });
    ST.allEventRng.forEach(function(ee) {
        eeTotal[ee.runId] = (eeTotal[ee.runId] || 0) + 1;
        var isGuaranteed = (ee.roomType === 7 || (ee.floor === 10 && ee.roomType === 0));
        if (!isGuaranteed) eeRandom[ee.runId] = (eeRandom[ee.runId] || 0) + 1;
    });
    var maxRandom = 0; var eeBuckets = {};
    for (var rid in eeTotal) {
        var t = eeTotal[rid];
        var r = eeRandom[rid] || 0;
        if (r > maxRandom) maxRandom = r;
        if (!eeBuckets[t]) eeBuckets[t] = { total: 0, random: 0 };
        eeBuckets[t].total++;
        eeBuckets[t].random += r;
    }
    html += '<p style="font-size:11px;color:#888;">Max random EE per run: ' + maxRandom + ' — ' +
        (maxRandom <= 5 ? '<span style="color:#8aba8a;">✓ matches doc (max 5 random)</span>' : '<span style="color:#c86a4a;">✗ exceeds doc limit of 5 random</span>') + '</p>';
    html += '<table class="data-table"><tr><th class="num">Total EE</th><th class="num">Runs</th><th class="pct">Avg Random</th></tr>';
    var sortedEE = Object.keys(eeBuckets).map(Number).sort(function(a, b) { return a - b; });
    sortedEE.forEach(function(c) {
        info = eeBuckets[c];
        var avgRandom = (info.random / info.total).toFixed(1);
        html += '<tr><td class="num">' + c + '</td><td class="num">' + info.total + '</td><td class="pct">' + avgRandom + '</td></tr>';
    });
    html += '</table></div>';

    panel.innerHTML = html + '</div>';
};

ST._findFloorRoomType = function(run, eventIdx, d) {
    if (d.room && d.room.data && d.room.data.roomType != null) return d.room.data.roomType;
    // Walk backwards to find the most recent enter
    for (var i = eventIdx - 1; i >= 0; i--) {
        var prev = run.events[i];
        if (prev.type === 'RECV' && prev.data.action === 'enter' && prev.data.room && prev.data.room.data) {
            return prev.data.room.data.roomType;
        }
    }
    return null;
};
