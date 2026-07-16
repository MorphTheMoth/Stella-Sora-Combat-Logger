// tabs/potentials.js — Potential RNG analysis

ST.potFilters = { unit: 0, status: 'all', source: 'all', boost: 'all', group: 'id' };

ST.renderPotentials = function() {
    var panel = document.getElementById('panel-potentials');
    if (!panel) return;

    var html = '<div class="filters" id="potFilters">' +
        '<select onchange="ST.potFilters.unit=parseInt(this.value);ST.renderPotentials()">' +
            '<option value="0" ' + (ST.potFilters.unit===0?'selected':'') + '>All Units</option>' +
            '<option value="1" ' + (ST.potFilters.unit===1?'selected':'') + '>Unit 1</option>' +
            '<option value="2" ' + (ST.potFilters.unit===2?'selected':'') + '>Unit 2</option>' +
            '<option value="3" ' + (ST.potFilters.unit===3?'selected':'') + '>Unit 3</option>' +
        '</select>' +
        '<select onchange="ST.potFilters.status=this.value;ST.renderPotentials()">' +
            '<option value="all" ' + (ST.potFilters.status==='all'?'selected':'') + '>All Potentials</option>' +
            '<option value="new" ' + (ST.potFilters.status==='new'?'selected':'') + '>New Only</option>' +
            '<option value="owned" ' + (ST.potFilters.status==='owned'?'selected':'') + '>Already Owned</option>' +
            '<option value="upgrade" ' + (ST.potFilters.status==='upgrade'?'selected':'') + '>Upgrades</option>' +
        '</select>' +
        '<select onchange="ST.potFilters.source=this.value;ST.renderPotentials()">' +
            '<option value="all" ' + (ST.potFilters.source==='all'?'selected':'') + '>All Sources</option>' +
            '<option value="normal" ' + (ST.potFilters.source==='normal'?'selected':'') + '>Normal Select</option>' +
            '<option value="special" ' + (ST.potFilters.source==='special'?'selected':'') + '>Special Select</option>' +
        '</select>' +
        '<select onchange="ST.potFilters.boost=this.value;ST.renderPotentials()">' +
            '<option value="all" ' + (ST.potFilters.boost==='all'?'selected':'') + '>All Boosts</option>' +
            '<option value="1" ' + (ST.potFilters.boost==='1'?'selected':'') + '>+1 (Base)</option>' +
            '<option value="2" ' + (ST.potFilters.boost==='2'?'selected':'') + '>+2 (Radiant)</option>' +
            '<option value="3" ' + (ST.potFilters.boost==='3'?'selected':'') + '>+3 (Butterflies)</option>' +
        '</select>' +
        '<select onchange="ST.potFilters.group=this.value;ST.renderPotentials()" style="margin-left:8px">' +
            '<option value="id" ' + (ST.potFilters.group==='id'?'selected':'') + '>By Potential ID</option>' +
            '<option value="char" ' + (ST.potFilters.group==='char'?'selected':'') + '>By Character</option>' +
            '<option value="main_support" ' + (ST.potFilters.group==='main_support'?'selected':'') + '>Main / Support</option>' +
            '<option value="index" ' + (ST.potFilters.group==='index'?'selected':'') + '>By Offer Slot</option>' +
        '</select>' +
    '</div><div class="scroll-panel" id="potContent"></div>';

    panel.innerHTML = html;

    var content = document.getElementById('potContent');
    if (!content) return;

    var events = ST.allPotentialEvents;

    // Determine unit→charId mapping from all events
    var unitCharIds = {};
    for (var i = 0; i < events.length && Object.keys(unitCharIds).length < 3; i++) {
        var ev = events[i];
        for (var j = 0; j < Math.min(ev.offers.length, 3); j++) {
            var o = ev.offers[j];
            if (o.charId && !unitCharIds[j+1]) unitCharIds[j+1] = o.charId;
        }
    }

    // Apply filters
    var filtered = events.filter(function(e) {
        if (ST.potFilters.source !== 'all' && e.source !== ST.potFilters.source) return false;
        return true;
    });

    // Collect all offers
    var allOffers = [];
    filtered.forEach(function(e) {
        e.offers.forEach(function(o, idx) {
            o.unitIdx = idx;
            o.event = e;
            allOffers.push(o);
        });
    });

    var total = allOffers.length || 1;

    var stats = '<div style="padding:12px 0;font-size:12px;color:#666;">' +
        filtered.length + ' events · ' + allOffers.length + ' potential offers across ' + ST.runs.length + ' runs</div>';

    // Boost distribution
    var boosts = {};
    allOffers.forEach(function(o) {
        var k = '+' + o.boost;
        boosts[k] = (boosts[k] || 0) + 1;
    });
    var boostHtml = '<div class="chart-card"><h3>Level Boost Distribution</h3>';
    if (allOffers.length === 0) {
        boostHtml += '<span style="color:#555">No data</span>';
    } else {
        Object.keys(boosts).sort().forEach(function(k) {
            var pct = ((boosts[k] / total) * 100).toFixed(1);
            boostHtml += '<span class="stat-badge' + (k === '+2' ? ' boost2' : k === '+3' ? ' boost3' : '') + '">' + k + ': ' + boosts[k] + ' (' + pct + '%)</span> ';
        });
    }
    boostHtml += '</div>';

    // New vs owned
    var newCount = 0, ownedCount = 0, upgradeCount = 0;
    allOffers.forEach(function(o) {
        if (o.isNew) newCount++;
        else if (o.isUpgrade) upgradeCount++;
        else ownedCount++;
    });
    var statusHtml = '<div class="chart-card"><h3>New vs Owned</h3>';
    if (allOffers.length === 0) {
        statusHtml += '<span style="color:#555">No data</span>';
    } else {
        statusHtml += '<span class="stat-badge new">New: ' + newCount + ' (' + ((newCount/total)*100).toFixed(1) + '%)</span> ';
        statusHtml += '<span class="stat-badge">Owned: ' + ownedCount + ' (' + ((ownedCount/total)*100).toFixed(1) + '%)</span> ';
        statusHtml += '<span class="stat-badge">Upgrade: ' + upgradeCount + ' (' + ((upgradeCount/total)*100).toFixed(1) + '%)</span>';
    }
    statusHtml += '</div>';

    // Group by selected granularity
    var groups = {}; // groupKey → { label, count, offers: [] }
    var rowLabels = {};

    allOffers.forEach(function(o) {
        // Apply unit/status/boost filters
        if (ST.potFilters.unit > 0 && unitCharIds[ST.potFilters.unit] && o.charId !== unitCharIds[ST.potFilters.unit]) return;
        if (ST.potFilters.status === 'new' && !o.isNew) return;
        if (ST.potFilters.status === 'owned' && o.isNew) return;
        if (ST.potFilters.status === 'upgrade' && !o.isUpgrade) return;
        if (ST.potFilters.boost !== 'all' && o.boost !== parseInt(ST.potFilters.boost)) return;

        var grp = ST.potFilters.group;
        var key, label;

        if (grp === 'id') {
            key = String(o.tid);
            var dec = ST.decodePotentialId(o.tid);
            var cName = dec ? ST.charName(dec.charId) : '?';
            label = o.tid + ' (' + cName + ' #' + (dec ? dec.index : '?') + ')';
        } else if (grp === 'char') {
            key = 'char_' + o.charId;
            label = ST.charName(o.charId) + ' (ID ' + o.charId + ')';
        } else if (grp === 'main_support') {
            if (o.charId === (unitCharIds[1] || 0)) {
                key = 'main';
                label = 'Main (' + ST.charName(o.charId) + ')';
            } else {
                key = 'support';
                label = 'Support (' + (ST.charName(o.charId) || '?') + ')';
            }
        } else if (grp === 'index') {
            key = 'slot_' + o.unitIdx;
            label = 'Slot ' + (o.unitIdx + 1) + ' (' + ['1st','2nd','3rd'][o.unitIdx] + ')';
        }

        if (!groups[key]) groups[key] = { label: label, count: 0 };
        groups[key].count++;
    });

    var gKeys = Object.keys(groups);
    gKeys.sort(function(a, b) { return groups[b].count - groups[a].count; });

    var tableHtml = '<div class="chart-card"><h3>Potential Distribution — ' +
        ({ id:'Potential ID', char:'Character', main_support:'Main / Support', index:'Offer Slot' }[ST.potFilters.group] || '?') +
        '</h3>';
    if (gKeys.length === 0) {
        tableHtml += '<span style="color:#555">No potentials offered yet. Filter settings may be too restrictive.</span>';
    } else {
        tableHtml += '<table class="data-table"><tr><th>Group</th><th class="num">Count</th><th class="pct">Rate</th></tr>';
        for (var i = 0; i < gKeys.length; i++) {
            var k = gKeys[i];
            var g = groups[k];
            var rate = ((g.count / total) * 100).toFixed(2);
            tableHtml += '<tr><td>' + g.label + '</td><td class="num">' + g.count + '</td><td class="pct">' + rate + '%</td></tr>';
        }
        tableHtml += '</table>';
    }
    tableHtml += '</div>';

    // Per-floor trigger analysis
    var floorOffers = {};
    events.forEach(function(e) {
        if (!floorOffers[e.floor]) floorOffers[e.floor] = { normal: 0, special: 0, total: 0 };
        if (e.source === 'special') floorOffers[e.floor].special++;
        else floorOffers[e.floor].normal++;
        floorOffers[e.floor].total++;
    });
    var floorHtml = '<div class="chart-card"><h3>Potential Offers per Floor</h3><table class="data-table"><tr><th class="num">Floor</th><th class="num">Normal</th><th class="num">Special</th><th class="num">Total</th></tr>';
    var sortedFloors = Object.keys(floorOffers).map(Number).sort(function(a,b){return a-b;});
    sortedFloors.forEach(function(f) {
        var info = floorOffers[f];
        floorHtml += '<tr><td class="num">' + f + '</td><td class="num">' + info.normal + '</td><td class="num">' + info.special + '</td><td class="num">' + info.total + '</td></tr>';
    });
    floorHtml += '</table></div>';

    content.innerHTML = stats + boostHtml + statusHtml + tableHtml + floorHtml;
};
