// tabs/floors.js — Floor event probability analysis

ST.CASE_TYPE_NAMES = {
    1: 'Battle', 2: 'Door', 3: 'Potential Select', 4: 'Fate Card',
    5: 'Note Select', 6: 'NPC Event', 7: 'Special Potential',
    8: 'Recovery HP', 9: 'NPC Recovery', 10: 'Shop',
    11: 'Strengthen', 12: 'Door Danger', 13: 'Sync HP',
};

ST.floorFilters = { floor: 0 };

ST.renderFloors = function() {
    var panel = document.getElementById('panel-floors');
    if (!panel) return;

    var events = ST.allFloorEvents;

    // Collect unique floors
    var floors = [];
    events.forEach(function(e) {
        if (floors.indexOf(e.floor) < 0) floors.push(e.floor);
    });
    floors.sort(function(a,b) { return a - b; });

    var caseTypes = new Set();
    events.forEach(function(e) {
        e.caseTypes.forEach(function(t) { caseTypes.add(t); });
    });
    var ctArr = [];
    caseTypes.forEach(function(t) { ctArr.push(t); });
    ctArr.sort();

    var html = '<div class="filters">' +
        '<select onchange="ST.floorFilters.floor=parseInt(this.value);ST.renderFloors()">' +
            '<option value="0"' + (ST.floorFilters.floor===0?' selected':'') + '>All Floors</option>';
    floors.forEach(function(f) {
        html += '<option value="' + f + '"' + (ST.floorFilters.floor===f?' selected':'') + '>Floor ' + f + '</option>';
    });
    html += '</select></div><div class="scroll-panel" id="floorContent"></div>';

    panel.innerHTML = html;

    var content = document.getElementById('floorContent');
    if (!content) return;

    var filtered = events.filter(function(e) {
        if (ST.floorFilters.floor > 0 && e.floor !== ST.floorFilters.floor) return false;
        return true;
    });

    // Count floors encountered
    var floorCounts = {}; // floor → total times seen
    var floorDetails = {}; // floor → { roomTypes: {}, caseTypes: {} }
    filtered.forEach(function(e) {
        var f = e.floor;
        if (!floorCounts[f]) {
            floorCounts[f] = 0;
            floorDetails[f] = { roomTypes: {}, caseTypes: {} };
        }
        floorCounts[f]++;
        var rt = e.roomType;
        floorDetails[f].roomTypes[rt] = (floorDetails[f].roomTypes[rt] || 0) + 1;
        e.caseTypes.forEach(function(ct) {
            floorDetails[f].caseTypes[ct] = (floorDetails[f].caseTypes[ct] || 0) + 1;
        });
    });

    var floorsSorted = Object.keys(floorCounts).sort(function(a,b) { return parseInt(a)-parseInt(b); });

    var stats = '<div style="padding:12px 0;font-size:12px;color:#666;">' +
        filtered.length + ' floor entries across ' + events.length + ' total</div>';

    // Room type distribution per floor
    var rtHtml = '<div class="chart-card"><h3>Room Type Distribution Per Floor</h3><table class="data-table"><tr><th>Floor</th><th>Times</th>';
    var seenRtNames = {};
    ctArr.forEach(function(ct) { if (ct >= 0 && ct <= 15) seenRtNames[ct] = true; });
    Object.keys(seenRtNames).sort().forEach(function(rt) {
        rtHtml += '<th>' + (ST.ROOM_NAMES[parseInt(rt)] || 'Type' + rt) + '</th>';
    });
    rtHtml += '</tr>';

    floorsSorted.forEach(function(f) {
        var d = floorDetails[f];
        var total = floorCounts[f];
        rtHtml += '<tr><td>' + f + '</td><td class="num">' + total + '</td>';
        Object.keys(seenRtNames).sort().forEach(function(rt) {
            var count = d.roomTypes[parseInt(rt)] || 0;
            var pct = total > 0 ? (count / total * 100).toFixed(0) : '0';
            rtHtml += '<td class="num">' + (count > 0 ? count + ' (' + pct + '%)' : '—') + '</td>';
        });
        rtHtml += '</tr>';
    });
    rtHtml += '</table></div>';

    // Case type distribution per floor
    var ctHtml = '<div class="chart-card"><h3>Case Type Appearance Per Floor</h3><table class="data-table"><tr><th>Floor</th><th>Times</th>';
    ctArr.forEach(function(ct) {
        ctHtml += '<th>' + (ST.CASE_TYPE_NAMES[ct] || 'Case' + ct) + '</th>';
    });
    ctHtml += '</tr>';

    floorsSorted.forEach(function(f) {
        var d = floorDetails[f];
        var total = floorCounts[f];
        ctHtml += '<tr><td>' + f + '</td><td class="num">' + total + '</td>';
        ctArr.forEach(function(ct) {
            var count = d.caseTypes[ct] || 0;
            var pct = total > 0 ? (count / total * 100).toFixed(1) : '0';
            ctHtml += '<td class="num">' + (count > 0 ? count + ' (' + pct + '%)' : '—') + '</td>';
        });
        ctHtml += '</tr>';
    });
    ctHtml += '</table></div>';

    content.innerHTML = stats + rtHtml + ctHtml;
};
