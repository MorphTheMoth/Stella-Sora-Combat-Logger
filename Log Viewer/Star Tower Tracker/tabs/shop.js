// tabs/shop.js — Shop RNG analysis

ST.shopFilters = { floor: 0, type: 'all', discount: 'all' };

ST.itemFinalPrice = function(item) {
    return item.discount > 0 ? item.discount : item.price;
};

ST.itemDiscountPct = function(item) {
    if (item.discount <= 0 || item.price <= 0) return 0;
    return Math.round((1 - item.discount / item.price) * 100);
};

ST.renderShop = function() {
    var panel = document.getElementById('panel-shop');
    if (!panel) return;

    var floors = new Set();
    ST.allShopOffers.forEach(function(s) { floors.add(s.floor); });
    var floorOpts = '<option value="0">All Floors</option>';
    floors.forEach(function(f) { floorOpts += '<option value="' + f + '"' + (ST.shopFilters.floor === f ? ' selected' : '') + '>Floor ' + f + '</option>'; });

    var html = '<div class="filters">' +
        '<select onchange="ST.shopFilters.floor=parseInt(this.value);ST.renderShop()">' + floorOpts + '</select>' +
        '<select onchange="ST.shopFilters.type=this.value;ST.renderShop()">' +
            '<option value="all"' + (ST.shopFilters.type==='all'?' selected':'') + '>All Types</option>' +
            '<option value="potential"' + (ST.shopFilters.type==='potential'?' selected':'') + '>Potentials</option>' +
            '<option value="note"' + (ST.shopFilters.type==='note'?' selected':'') + '>Notes</option>' +
        '</select>' +
        '<select onchange="ST.shopFilters.discount=this.value;ST.renderShop()">' +
            '<option value="all"' + (ST.shopFilters.discount==='all'?' selected':'') + '>All Prices</option>' +
            '<option value="none"' + (ST.shopFilters.discount==='none'?' selected':'') + '>Full Price</option>' +
            '<option value="20"' + (ST.shopFilters.discount==='20'?' selected':'') + '>20% Off</option>' +
            '<option value="50"' + (ST.shopFilters.discount==='50'?' selected':'') + '>50% Off</option>' +
        '</select>' +
    '</div><div class="scroll-panel" id="shopContent"></div>';

    panel.innerHTML = html;

    var content = document.getElementById('shopContent');
    if (!content) return;

    var allItems = ST.allShopItems;

    var filtered = allItems.filter(function(item) {
        if (ST.shopFilters.floor > 0 && item.floor !== ST.shopFilters.floor) return false;
        if (ST.shopFilters.type !== 'all' && item.type !== ST.shopFilters.type) return false;
        var dpct = ST.itemDiscountPct(item);
        if (ST.shopFilters.discount === 'none' && dpct > 0) return false;
        if (ST.shopFilters.discount === '20' && dpct !== 20) return false;
        if (ST.shopFilters.discount === '50' && dpct !== 50) return false;
        return true;
    });

    var stats = '<div style="padding:12px 0;font-size:12px;color:#666;">' +
        ST.allShopOffers.length + ' shops · ' + filtered.length + ' items filtered</div>';

    // Type distribution per floor
    var floorAgg = {};
    allItems.forEach(function(item) {
        var f = item.floor;
        if (!floorAgg[f]) floorAgg[f] = { potential: 0, note: 0 };
        if (item.type === 'potential') floorAgg[f].potential++;
        else floorAgg[f].note++;
    });

    var floorTable = '<table class="data-table"><tr><th>Floor</th><th>Potentials</th><th>Notes</th><th>Pot/Note</th></tr>';
    Object.keys(floorAgg).sort(function(a,b) { return parseInt(a)-parseInt(b); }).forEach(function(f) {
        var a = floorAgg[f];
        var total = a.potential + a.note;
        var pct = total > 0 ? (a.potential / total * 100).toFixed(0) : '0';
        floorTable += '<tr><td>' + f + '</td><td class="num">' + a.potential + '</td><td class="num">' + a.note + '</td><td class="pct">' + pct + '%</td></tr>';
    });
    floorTable += '</table>';

    // Price distribution — use final price
    var pricesPotential = {};
    var pricesNote = {};
    allItems.forEach(function(item) {
        var fp = ST.itemFinalPrice(item);
        if (item.type === 'potential') {
            pricesPotential[fp] = (pricesPotential[fp] || 0) + 1;
        } else {
            pricesNote[fp] = (pricesNote[fp] || 0) + 1;
        }
    });

    var priceHtml = '<table class="data-table"><tr><th colspan="3">Potential Prices (final)</th></tr>';
    var pKeys = Object.keys(pricesPotential).sort(function(a,b){return parseInt(a)-parseInt(b);});
    if (pKeys.length === 0) priceHtml += '<tr><td style="color:#555">—</td></tr>';
    else pKeys.forEach(function(k) { priceHtml += '<tr><td>' + k + '</td><td class="num">' + pricesPotential[k] + '</td></tr>'; });
    priceHtml += '</table><br><table class="data-table"><tr><th colspan="3">Note Prices (final)</th></tr>';
    var nKeys = Object.keys(pricesNote).sort(function(a,b){return parseInt(a)-parseInt(b);});
    if (nKeys.length === 0) priceHtml += '<tr><td style="color:#555">—</td></tr>';
    else nKeys.forEach(function(k) { priceHtml += '<tr><td>' + k + '</td><td class="num">' + pricesNote[k] + '</td></tr>'; });
    priceHtml += '</table>';

    // Discount distribution
    var totalItems = allItems.length;
    var d50 = allItems.filter(function(i) { return ST.itemDiscountPct(i) === 50; }).length;
    var d20 = allItems.filter(function(i) { return ST.itemDiscountPct(i) === 20; }).length;
    var none = totalItems - d50 - d20;

    var discountHtml = '<div class="chart-card"><h3>Discount Distribution</h3>';
    discountHtml += '<span class="stat-badge">50% off: ' + d50 + ' (' + ((d50/totalItems)*100).toFixed(1) + '%)</span> ';
    discountHtml += '<span class="stat-badge">20% off: ' + d20 + ' (' + ((d20/totalItems)*100).toFixed(1) + '%)</span> ';
    discountHtml += '<span class="stat-badge">Full: ' + none + ' (' + ((none/totalItems)*100).toFixed(1) + '%)</span>';
    discountHtml += '</div>';

    // Early vs late shop comparison
    var earlyFloors = new Set();
    var lateFloors = new Set();
    allItems.forEach(function(item) {
        if (item.floor <= 12) earlyFloors.add(item.floor);
        else lateFloors.add(item.floor);
    });
    var earlyItems = allItems.filter(function(i) { return i.floor <= 12; });
    var lateItems = allItems.filter(function(i) { return i.floor > 12; });
    var earlyPct = earlyItems.length > 0 ? (earlyItems.filter(function(i){return i.type==='potential';}).length / earlyItems.length * 100).toFixed(0) : '0';
    var latePct = lateItems.length > 0 ? (lateItems.filter(function(i){return i.type==='potential';}).length / lateItems.length * 100).toFixed(0) : '0';

    var compareHtml = '<div class="chart-card"><h3>Early vs Late Shops</h3>';
    compareHtml += '<span class="stat-badge">Early (≤12): ' + earlyItems.length + ' items, ' + earlyPct + '% potentials</span> ';
    compareHtml += '<span class="stat-badge">Late (>12): ' + lateItems.length + ' items, ' + latePct + '% potentials</span>';
    compareHtml += '</div>';

    content.innerHTML = stats +
        discountHtml + compareHtml +
        '<div class="chart-card"><h3>Type Distribution Per Floor</h3>' + floorTable + '</div>' +
        '<div class="chart-card"><h3>Price Distribution (final price)</h3>' + priceHtml + '</div>';
};
