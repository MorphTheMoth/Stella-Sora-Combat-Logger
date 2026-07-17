// tabs/notes.js — Weighted RNG model analysis for note drops

ST.noteFilters = { note: 0, sources: { battle: true, elite: true, boss: true }, stack: 'all', k: 10, pow: 0.5, powK: 0.1, model: 'harmoniesNotes05' };

ST.selectModel = function(key) {
    ST.noteFilters.model = key;
    ST.renderNotes();
};

ST.modelLabel = function(key) {
    for (var i = 0; i < ST.modelDefs.length; i++) {
        if (ST.modelDefs[i].key === key) return ST.modelDefs[i].name;
    }
    return key;
};

ST.toggleNoteSource = function(src) {
    var s = ST.noteFilters.sources;
    if (s[src]) { delete s[src]; } else { s[src] = true; }
    if (Object.keys(s).length === 0) ST.noteFilters.sources = {};
    ST.renderNotes();
};

// ── Probability engine ──

ST.computeNoteProbs = function(noteCounts, modelKey, k, context) {
    var nc = noteCounts || {};
    var nids = ST.NOTE_IDS;
    if (!nids || nids.length === 0) return {};
    var weights = {};
    var totalWeight = 0;
    var ctx = context || {};

    switch (modelKey) {
    case 'uniform':
        nids.forEach(function(tid) { weights[tid] = 1; totalWeight += 1; });
        break;
    case 'add1':
        nids.forEach(function(tid) { var w = (nc[tid] || 0) + 1; weights[tid] = w; totalWeight += w; });
        break;
    case 'add20':
        nids.forEach(function(tid) { var w = (nc[tid] || 0) + 20; weights[tid] = w; totalWeight += w; });
        break;
    case 'add40':
        nids.forEach(function(tid) { var w = (nc[tid] || 0) + 40; weights[tid] = w; totalWeight += w; });
        break;
    case 'baseCarry10':
        nids.forEach(function(tid) {
            var base = (ctx.startCountsBefore && ctx.startCountsBefore[tid]) || 0;
            var w = base + 10;
            weights[tid] = w; totalWeight += w;
        });
        break;
    case 'baseCarry20':
        nids.forEach(function(tid) {
            var base = (ctx.startCountsBefore && ctx.startCountsBefore[tid]) || 0;
            var w = base + 20;
            weights[tid] = w; totalWeight += w;
        });
        break;
    case 'sqrtBaseCarry10':
        nids.forEach(function(tid) {
            var base = (ctx.startCountsBefore && ctx.startCountsBefore[tid]) || 0;
            var w = Math.sqrt(base) + 10;
            weights[tid] = w; totalWeight += w;
        });
        break;
    case 'sqrtBaseAdd5':
        nids.forEach(function(tid) {
            var base = (ctx.startCountsBefore && ctx.startCountsBefore[tid]) || 0;
            var w = Math.sqrt(nc[tid] || 0) + base + 5;
            weights[tid] = w; totalWeight += w;
        });
        break;
    case 'sqrtBaseAdd10':
        nids.forEach(function(tid) {
            var base = (ctx.startCountsBefore && ctx.startCountsBefore[tid]) || 0;
            var w = Math.sqrt(nc[tid] || 0) + base + 10;
            weights[tid] = w; totalWeight += w;
        });
        break;
    case 'sqrtBaseAdd20':
        nids.forEach(function(tid) {
            var base = (ctx.startCountsBefore && ctx.startCountsBefore[tid]) || 0;
            var w = Math.sqrt(nc[tid] || 0) + base + 20;
            weights[tid] = w; totalWeight += w;
        });
        break;
    case 'invBaseCarry':
        nids.forEach(function(tid) {
            var w = 1 / (((ctx.startCountsBefore && ctx.startCountsBefore[tid]) || 0) + 1);
            weights[tid] = w; totalWeight += w;
        });
        break;
    case 'inv5':
        nids.forEach(function(tid) { var w = 1 / ((nc[tid] || 0) + 5); weights[tid] = w; totalWeight += w; });
        break;
    case 'rankLin':
    case 'rankExp':
        var sorted = nids.slice().sort(function(a, b) { return (nc[b] || 0) - (nc[a] || 0); });
        sorted.forEach(function(tid, idx) {
            var rank = idx + 1;
            var w = modelKey === 'rankLin' ? (nids.length + 1 - rank) : Math.pow(2, nids.length - 1 - rank);
            weights[tid] = w; totalWeight += w;
        });
        break;
    case 'harmoniesNotes05':
        nids.forEach(function(tid) {
            var w = ((ctx.harmoniesNotes && ctx.harmoniesNotes[tid]) || 0) + 0.5;
            weights[tid] = w; totalWeight += w;
        });
        break;
    case 'harmoniesNotes1':
        nids.forEach(function(tid) {
            var w = ((ctx.harmoniesNotes && ctx.harmoniesNotes[tid]) || 0) + 1;
            weights[tid] = w; totalWeight += w;
        });
        break;
    case 'discsNotes05':
        nids.forEach(function(tid) {
            var w = ((ctx.discsNotes && ctx.discsNotes[tid]) || 0) + 0.5;
            weights[tid] = w; totalWeight += w;
        });
        break;
    case 'discsNotes1':
        nids.forEach(function(tid) {
            var w = ((ctx.discsNotes && ctx.discsNotes[tid]) || 0) + 1;
            weights[tid] = w; totalWeight += w;
        });
        break;
    case 'overallDiscNotes05':
        nids.forEach(function(tid) {
            var w = ((ctx.overallDiscNotes && ctx.overallDiscNotes[tid]) || 0) + 0.5;
            weights[tid] = w; totalWeight += w;
        });
        break;
    case 'overallDiscNotes1':
        nids.forEach(function(tid) {
            var w = ((ctx.overallDiscNotes && ctx.overallDiscNotes[tid]) || 0) + 1;
            weights[tid] = w; totalWeight += w;
        });
        break;
    case 'harmoniesNotes15':
        nids.forEach(function(tid) {
            var w = ((ctx.harmoniesNotes && ctx.harmoniesNotes[tid]) || 0) + 1.5;
            weights[tid] = w; totalWeight += w;
        });
        break;
    case 'discsNotes15':
        nids.forEach(function(tid) {
            var w = ((ctx.discsNotes && ctx.discsNotes[tid]) || 0) + 1.5;
            weights[tid] = w; totalWeight += w;
        });
        break;
    case 'overallDiscNotes15':
        nids.forEach(function(tid) {
            var w = ((ctx.overallDiscNotes && ctx.overallDiscNotes[tid]) || 0) + 1.5;
            weights[tid] = w; totalWeight += w;
        });
        break;
    case 'hn1SC5':
        nids.forEach(function(tid) {
            var hn = (ctx.harmoniesNotes && ctx.harmoniesNotes[tid]) || 0;
            var w = hn + 1 + Math.sqrt(nc[tid] || 0) / 5;
            weights[tid] = w; totalWeight += w;
        });
        break;
    case 'hn1SC10':
        nids.forEach(function(tid) {
            var hn = (ctx.harmoniesNotes && ctx.harmoniesNotes[tid]) || 0;
            var w = hn + 1 + Math.sqrt(nc[tid] || 0) / 10;
            weights[tid] = w; totalWeight += w;
        });
        break;
    case 'hn1SC20':
        nids.forEach(function(tid) {
            var hn = (ctx.harmoniesNotes && ctx.harmoniesNotes[tid]) || 0;
            var w = hn + 1 + Math.sqrt(nc[tid] || 0) / 20;
            weights[tid] = w; totalWeight += w;
        });
        break;
    case 'hn1SB5':
        nids.forEach(function(tid) {
            var hn = (ctx.harmoniesNotes && ctx.harmoniesNotes[tid]) || 0;
            var base = (ctx.startCountsBefore && ctx.startCountsBefore[tid]) || 0;
            var w = hn + 1 + Math.sqrt(base) / 5;
            weights[tid] = w; totalWeight += w;
        });
        break;
    case 'hn1SB10':
        nids.forEach(function(tid) {
            var hn = (ctx.harmoniesNotes && ctx.harmoniesNotes[tid]) || 0;
            var base = (ctx.startCountsBefore && ctx.startCountsBefore[tid]) || 0;
            var w = hn + 1 + Math.sqrt(base) / 10;
            weights[tid] = w; totalWeight += w;
        });
        break;
    case 'hn1SB20':
        nids.forEach(function(tid) {
            var hn = (ctx.harmoniesNotes && ctx.harmoniesNotes[tid]) || 0;
            var base = (ctx.startCountsBefore && ctx.startCountsBefore[tid]) || 0;
            var w = hn + 1 + Math.sqrt(base) / 20;
            weights[tid] = w; totalWeight += w;
        });
        break;
    case 'ovd1SB10':
        nids.forEach(function(tid) {
            var ovd = (ctx.overallDiscNotes && ctx.overallDiscNotes[tid]) || 0;
            var base = (ctx.startCountsBefore && ctx.startCountsBefore[tid]) || 0;
            var w = ovd + 1 + Math.sqrt(base) / 10;
            weights[tid] = w; totalWeight += w;
        });
        break;
    case 'dn1SB10':
        nids.forEach(function(tid) {
            var dn = (ctx.discsNotes && ctx.discsNotes[tid]) || 0;
            var base = (ctx.startCountsBefore && ctx.startCountsBefore[tid]) || 0;
            var w = dn + 1 + Math.sqrt(base) / 10;
            weights[tid] = w; totalWeight += w;
        });
        break;
    case 'hn1MulSB10':
        nids.forEach(function(tid) {
            var hn = (ctx.harmoniesNotes && ctx.harmoniesNotes[tid]) || 0;
            var base = (ctx.startCountsBefore && ctx.startCountsBefore[tid]) || 0;
            var w = (hn + 1) * (1 + Math.sqrt(base) / 10);
            weights[tid] = w; totalWeight += w;
        });
        break;
    }

    var probs = {};
    if (totalWeight <= 0) {
        nids.forEach(function(tid) { probs[tid] = 1 / nids.length; });
    } else {
        nids.forEach(function(tid) { probs[tid] = weights[tid] / totalWeight; });
    }
    return probs;
};

// ── Model comparison helpers ──

ST.modelDefs = [
    { key: 'uniform', name: 'Uniform (equal)', desc: 'all notes have the same drop weight = 1', params: 0 },
    { key: 'harmoniesNotes05', name: 'harmoniesNotes + 0.5', desc: 'weight = (# of disc harmonies needing this note) + 0.5', params: 0 },
    { key: 'harmoniesNotes1', name: 'harmoniesNotes + 1', desc: 'weight = (# of disc harmonies needing this note) + 1', params: 0 },
    { key: 'harmoniesNotes15', name: 'harmoniesNotes + 1.5', desc: 'weight = (# of disc harmonies needing this note) + 1.5', params: 0 },
    { key: 'discsNotes05', name: 'discsNotes + 0.5', desc: 'weight = (# of discs needing this note) + 0.5', params: 0 },
    { key: 'discsNotes1', name: 'discsNotes + 1', desc: 'weight = (# of discs needing this note) + 1', params: 0 },
    { key: 'discsNotes15', name: 'discsNotes + 1.5', desc: 'weight = (# of discs needing this note) + 1.5', params: 0 },
    { key: 'overallDiscNotes05', name: 'overallDiscNotes + 0.5', desc: 'weight = (any disc needs this note? 1:0) + 0.5', params: 0 },
    { key: 'overallDiscNotes1', name: 'overallDiscNotes + 1', desc: 'weight = (any disc needs this note? 1:0) + 1', params: 0 },
    { key: 'overallDiscNotes15', name: 'overallDiscNotes + 1.5', desc: 'weight = (any disc needs this note? 1:0) + 1.5', params: 0 },
    { key: 'hn1SC5', name: 'harmoniesNotes + 1 + √count/5', desc: 'weight = harmony count + 1 + sqrt(runtime count) / 5', params: 0 },
    { key: 'hn1SC10', name: 'harmoniesNotes + 1 + √count/10', desc: 'weight = harmony count + 1 + sqrt(runtime count) / 10', params: 0 },
    { key: 'hn1SC20', name: 'harmoniesNotes + 1 + √count/20', desc: 'weight = harmony count + 1 + sqrt(runtime count) / 20', params: 0 },
    { key: 'hn1SB5', name: 'harmoniesNotes + 1 + √baseCarry/5', desc: 'weight = harmony count + 1 + sqrt(start-of-run baseCarry) / 5', params: 0 },
    { key: 'hn1SB10', name: 'harmoniesNotes + 1 + √baseCarry/10', desc: 'weight = harmony count + 1 + sqrt(start-of-run baseCarry) / 10', params: 0 },
    { key: 'hn1SB20', name: 'harmoniesNotes + 1 + √baseCarry/20', desc: 'weight = harmony count + 1 + sqrt(start-of-run baseCarry) / 20', params: 0 },
    { key: 'ovd1SB10', name: 'overallDiscNotes + 1 + √baseCarry/10', desc: 'weight = (any disc needs this note? 1:0) + 1 + sqrt(start-of-run baseCarry) / 10', params: 0 },
    { key: 'dn1SB10', name: 'discsNotes + 1 + √baseCarry/10', desc: 'weight = (# discs needing this note) + 1 + sqrt(start-of-run baseCarry) / 10', params: 0 },
    { key: 'hn1MulSB10', name: '(harmoniesNotes+1) · (1 + √baseCarry/10)', desc: 'weight = (harmony count + 1) * (1 + sqrt(start-of-run baseCarry) / 10) — multiplicative', params: 0 },
    { key: 'add1', name: 'count + 1', desc: 'weight = count + 1 — weak count advantage', params: 0 },
    { key: 'add20', name: 'count + 20', desc: 'weight = count + 20 — very strong base', params: 0 },
    { key: 'add40', name: 'count + 40', desc: 'weight = count + 40 — dominant base', params: 0 },
    { key: 'baseCarry10', name: 'baseCarry + 10', desc: 'weight = startCountsBefore(note) + 10', params: 0 },
    { key: 'baseCarry20', name: 'baseCarry + 20', desc: 'weight = startCountsBefore(note) + 20', params: 0 },
    { key: 'sqrtBaseCarry10', name: '√baseCarry + 10', desc: 'weight = √(startCountsBefore(note)) + 10', params: 0 },
    { key: 'sqrtBaseAdd5', name: '√count + baseCarry + 5', desc: 'weight = √(count) + startCountsBefore(note) + 5', params: 0 },
    { key: 'sqrtBaseAdd10', name: '√count + baseCarry + 10', desc: 'weight = √(count) + startCountsBefore(note) + 10', params: 0 },
    { key: 'sqrtBaseAdd20', name: '√count + baseCarry + 20', desc: 'weight = √(count) + startCountsBefore(note) + 20', params: 0 },
    { key: 'invBaseCarry', name: '1/(baseCarry+1)', desc: 'weight = 1/(startCountsBefore(note) + 1) — balancing, favors notes with less carry-over', params: 0 },
    { key: 'inv5', name: '1/(count+5)', desc: 'weight = 1/(count+5) — weak balancing', params: 0 },
    { key: 'rankLin', name: 'Rank linear', desc: 'weight = N+1−rank(r), where N = note types, rank 1 = highest count — linear decay', params: 0 },
    { key: 'rankExp', name: 'Rank exp', desc: 'weight = 2^(N−1−rank), steep exponential decay — only top-2 matter', params: 0 },
];

ST.evalModel = function(events, modelKey, k) {
    var ncEvents = events.filter(function(e) { return e.context && e.context.noteCounts; });
    if (ncEvents.length === 0) return null;
    var total = ncEvents.length;
    var nids = ST.NOTE_IDS;
    var nNoteTypes = nids.length;

    var observed = {};
    nids.forEach(function(tid) { observed[tid] = 0; });

    var ll = 0, expected = {};
    nids.forEach(function(tid) { expected[tid] = 0; });

    var brierSum = 0;

    ncEvents.forEach(function(e) {
        observed[e.tid]++;
        var probs = ST.computeNoteProbs(e.context.noteCounts, modelKey, k, e.context);
        var p = Math.max(probs[e.tid] || 0, 1e-9);
        ll += Math.log(p);

        nids.forEach(function(tid) {
            expected[tid] += probs[tid];
            var actual = tid === e.tid ? 1 : 0;
            var pred = probs[tid];
            brierSum += (actual - pred) * (actual - pred);
        });
    });

    var brier = brierSum / (total * nNoteTypes);

    var nll = -ll;

    return { logLik: ll, nll: nll, brier: brier, n: total };
};

// ── Foldable section helper ──

ST._sectionOpen = {};

ST.section = function(html) {
    if (!html) return '';
    var m = html.match(/<h3>(.*?)<\/h3>/);
    if (!m) return html;
    var title = m[1];
    var saved = ST._sectionOpen[title];
    var open = saved !== false ? ' open' : '';
    var extra = '';
    var divMatch = html.match(/<div class="chart-card"([^>]*)>/);
    if (divMatch) extra = divMatch[1] || '';
    var rest = html.replace(/<div class="chart-card"[^>]*>/, '').replace(/<h3>.*?<\/h3>/, '').replace(/<\/div>\s*$/, '').trim();
    return '<details class="chart-card"' + open + ' data-sk="' + title.replace(/"/g, '&quot;') + '">' +
        '<summary class="section-summary"><h3>' + title + '</h3></summary>' +
        '<div class="section-body"' + extra + '>' + rest + '</div></details>';
};

// ── Build tables ──

ST.buildModelComparison = function(events) {
    var ncEvents = events.filter(function(e) { return e.context && e.context.noteCounts; });
    if (ncEvents.length < 5) return '';

    var k = ST.noteFilters.k || 10;
    var results = [];
    var uniformP = 1 / ST.NOTE_IDS.length;
    var bestCorrectP = -Infinity, bestNll = Infinity, bestBrier = Infinity, bestVsRandom = -Infinity, bestAic = Infinity;
    var bestCorrectR = null, bestNllR = null, bestBrierR = null, bestVsRandomR = null, bestAicR = null;

    ST.modelDefs.forEach(function(md) {
        var usesK = md.key === 'additive' || md.key === 'sqrtBaseK';
        var r = ST.evalModel(events, md.key, usesK ? k : 0);
        if (!r) return;
        r.key = md.key;
        r.name = usesK ? md.name.replace(' + K', ' + ' + k)
            : md.key === 'powBaseCarry' ? 'baseCarry^' + (ST.noteFilters.pow || 0.5) + ' + ' + (ST.noteFilters.powK || 0.1)
            : md.name;
        r.desc = md.desc;
        r.correctP = Math.exp(r.logLik / r.n) * 100;
        r.vsRandom = r.correctP / (uniformP * 100);
        if (r.correctP > bestCorrectP) { bestCorrectP = r.correctP; bestCorrectR = r; }
        if (r.vsRandom > bestVsRandom) { bestVsRandom = r.vsRandom; bestVsRandomR = r; }
        if (r.nll < bestNll) { bestNll = r.nll; bestNllR = r; }
        r.aic = 2 * (md.params || 0) + 2 * r.nll;
        if (r.aic < bestAic) { bestAic = r.aic; bestAicR = r; }
        if (r.brier < bestBrier) { bestBrier = r.brier; bestBrierR = r; }
        results.push(r);
    });

    var selectedModel = ST.noteFilters.model || 'harmoniesNotes05';
    var rows = '';
    results.forEach(function(r) {
        var isSelected = r.key === selectedModel;
        var style = ' style="cursor:pointer;';
        if (isSelected) style += 'border-left:3px solid #7aba7a;background:#2a2a2a;';
        style += '"';
        var onclick = ' onclick="ST.selectModel(\'' + r.key + '\')"';

        var correctStyle = r === bestCorrectR ? ' style="color:#9aba8a"' : '';
        var vsRandomStyle = r === bestVsRandomR ? ' style="color:#9aba8a"' : '';
        var brierStyle = r === bestBrierR ? ' style="color:#9aba8a"' : '';
        var nllStyle = r === bestNllR ? ' style="color:#9aba8a"' : '';
        var aicStyle = r === bestAicR ? ' style="color:#9aba8a"' : '';

        rows += '<tr' + style + onclick + '><td>' + r.name + '<br><span style="font-size:9px;color:#555">' + r.desc + '</span></td>' +
            '<td class="pct"' + correctStyle + '>' + r.correctP.toFixed(2) + '%</td>' +
            '<td class="num"' + vsRandomStyle + '>' + r.vsRandom.toFixed(2) + '×</td>' +
            '<td class="num"' + brierStyle + '>' + r.brier.toFixed(4) + '</td>' +
            '<td class="num"' + nllStyle + '>' + r.nll.toFixed(2) + '</td>' +
            '<td class="num"' + aicStyle + '>' + r.aic.toFixed(1) + '</td></tr>';
    });

    return '<div class="chart-card"><h3>Model Comparison (' + ncEvents.length + ' events)</h3>' +
        '<div style="font-size:11px;color:#555;margin-bottom:8px;line-height:1.6">' +
            'Brier: 0 (perfect) to ~0.92 (random)<br>' +
            'NLL: lower is better (negative log-likelihood)<br>' +
            'AIC: NLL adjusted for model complexity (lower is better)' +
        '</div>' +
        '<table class="data-table"><tr><th>Model</th><th class="pct">Correct P%</th><th class="num">vs Random</th><th class="num">Brier</th><th class="num">NLL</th><th class="num">AIC</th></tr>' +
        rows + '</table></div>';
};

ST.buildPerNote = function(events, modelKey, k) {
    var ncEvents = events.filter(function(e) { return e.context && e.context.noteCounts; });
    if (ncEvents.length === 0) return '';
    var modelName = ST.modelLabel(modelKey);
    var nids = ST.NOTE_IDS;

    var drops = {}, sumP = {}, sumRank = {}, top3Count = {};
    nids.forEach(function(tid) {
        drops[tid] = 0; sumP[tid] = 0; sumRank[tid] = 0; top3Count[tid] = 0;
    });

    ncEvents.forEach(function(e) {
        var probs = ST.computeNoteProbs(e.context.noteCounts, modelKey, k, e.context);
        var sorted = nids.slice().sort(function(a, b) { return (probs[b] || 0) - (probs[a] || 0); });
        var top3 = sorted.slice(0, 3);

        var tid = e.tid;
        drops[tid]++;
        sumP[tid] += probs[tid];
        sumRank[tid] += sorted.indexOf(tid) + 1;
        if (top3.indexOf(tid) !== -1) top3Count[tid]++;
    });

    var uniformP = 1 / nids.length;
    var rows = '';
    nids.forEach(function(tid) {
        var n = drops[tid];
        if (n === 0) {
            rows += '<tr><td>' + ST.noteName(tid) + '</td><td class="num">0</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">—</td></tr>';
            return;
        }
        var avgP = (sumP[tid] / n * 100).toFixed(2) + '%';
        var vsRandom = (sumP[tid] / n / uniformP).toFixed(1) + '×';
        var avgRank = (sumRank[tid] / n).toFixed(2);
        var top3Pct = (top3Count[tid] / n * 100).toFixed(1) + '%';
        rows += '<tr><td>' + ST.noteName(tid) + '</td><td class="num">' + n + '</td><td class="pct">' + avgP + '</td><td class="num">' + vsRandom + '</td><td class="num">' + avgRank + '</td><td class="pct">' + top3Pct + '</td></tr>';
    });

    return '<div class="chart-card"><h3>Per-Note Model Performance (' + modelName + ', ' + ncEvents.length + ' events)</h3>' +
        '<div style="font-size:11px;color:#555;margin-bottom:8px">Avg P = model\'s probability for this note when it dropped (higher = better). vs Random = how many × uniform. Avg Rank = rank (1=most likely) when it dropped (lower = better). Top-3% = % of drops where model had note in top 3.</div>' +
        '<table class="data-table"><tr><th>Note</th><th class="num">Drops</th><th class="pct">Avg P (when hit)</th><th class="num">vs Random</th><th class="num">Avg Rank (when hit)</th><th class="pct">Top-3 Hit %</th></tr>' +
        rows + '</table></div>';
};

ST.buildRankHitRate = function(events, modelKey, k) {
    var ncEvents = events.filter(function(e) { return e.context && e.context.noteCounts; });
    if (ncEvents.length === 0) return '';
    var modelName = ST.modelLabel(modelKey);

    var nRanks = ST.NOTE_IDS.length;
    var rankCounts = {};
    for (var r = 1; r <= nRanks; r++) rankCounts[r] = 0;

    ncEvents.forEach(function(e) {
        var probs = ST.computeNoteProbs(e.context.noteCounts, modelKey, k, e.context);
        var sorted = ST.NOTE_IDS.slice().sort(function(a, b) { return (probs[b] || 0) - (probs[a] || 0); });
        var rank = sorted.indexOf(e.tid) + 1;
        if (rankCounts[rank] !== undefined) rankCounts[rank]++;
    });

    var rows = '', cum = 0;
    for (var r = 1; r <= nRanks; r++) {
        cum += rankCounts[r];
        var pct = (rankCounts[r] / ncEvents.length * 100).toFixed(1);
        var cumPct = (cum / ncEvents.length * 100).toFixed(1);
        rows += '<tr><td class="num">' + r + '</td><td class="num">' + rankCounts[r] + '</td><td class="pct">' + pct + '%</td><td class="pct">' + cumPct + '%</td></tr>';
    }

    var top1Pct = (rankCounts[1] / ncEvents.length * 100).toFixed(1);
    var uniformPct = (100 / ST.NOTE_IDS.length).toFixed(1);

    return '<div class="chart-card"><h3>Hit Rate by Weight Rank (' + modelName + ')</h3>' +
        '<div style="font-size:11px;color:#555;margin-bottom:8px">Top rank hit: <strong>' + top1Pct + '%</strong> vs ' + uniformPct + '% if random. Higher = richer notes drop more.</div>' +
        '<table class="data-table"><tr><th class="num">Rank</th><th class="num">Drops</th><th class="pct">%</th><th class="pct">Cumulative</th></tr>' +
        rows + '</table></div>';
};

ST.buildNoteBuckets = function(events, modelKey, k) {
    var tid = ST.noteFilters.note;
    if (!tid) return '';
    var modelName = ST.modelLabel(modelKey);

    var ncEvents = events.filter(function(e) { return e.context && e.context.noteCounts; });
    if (ncEvents.length === 0) return '';

    var buckets = {
        '0': { events: 0, xDropped: 0, sumProb: 0 },
        '1-2': { events: 0, xDropped: 0, sumProb: 0 },
        '3-5': { events: 0, xDropped: 0, sumProb: 0 },
        '6-10': { events: 0, xDropped: 0, sumProb: 0 },
        '11-20': { events: 0, xDropped: 0, sumProb: 0 },
        '21+': { events: 0, xDropped: 0, sumProb: 0 },
    };

    ncEvents.forEach(function(e) {
        var xCount = e.context.noteCounts[tid] || 0;
        var key;
        if (xCount === 0) key = '0';
        else if (xCount <= 2) key = '1-2';
        else if (xCount <= 5) key = '3-5';
        else if (xCount <= 10) key = '6-10';
        else if (xCount <= 20) key = '11-20';
        else key = '21+';

        buckets[key].events++;
        if (e.tid === tid) buckets[key].xDropped++;
        var probs = ST.computeNoteProbs(e.context.noteCounts, modelKey, k, e.context);
        buckets[key].sumProb += probs[tid];
    });

    var rows = '';
    Object.keys(buckets).forEach(function(key) {
        var b = buckets[key];
        if (b.events === 0) {
            rows += '<tr><td>' + key + '</td><td class="num">0</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">—</td></tr>';
            return;
        }
        var obsPct = (b.xDropped / b.events * 100).toFixed(1);
        var expPct = (b.sumProb / b.events * 100).toFixed(1);
        var diffPct = (obsPct - expPct);
        var ratio = b.sumProb > 0 ? (b.xDropped / b.sumProb).toFixed(2) : '—';
        var hl = Math.abs(obsPct - expPct) > 1.96 * Math.sqrt(expPct * (100 - expPct) / b.events) ? ' style="color:#c87050"' : '';
        rows += '<tr><td>' + key + '</td><td class="num">' + b.events + '</td><td class="num">' + b.xDropped + '</td>' +
            '<td class="pct">' + obsPct + '%</td><td class="pct">' + expPct + '%</td>' +
            '<td class="pct"' + hl + '>' + (diffPct >= 0 ? '+' : '') + diffPct.toFixed(1) + '%</td>' +
            '<td class="num">' + ratio + '</td></tr>';
    });

    var name = ST.noteName(tid).replace('Melody of ', '');
    return '<div class="chart-card"><h3>Individual Note: <strong>' + name + '</strong> (' + modelName + ')</h3>' +
        '<table class="data-table"><tr><th>Count Before</th><th class="num">Events</th><th class="num">Dropped</th><th class="pct">Obs %</th><th class="pct">Model Pred %</th><th class="pct">&#916;%</th><th class="num">Ratio</th></tr>' +
        rows + '</table></div>';
};

ST.buildTotalNotesBuckets = function(events, modelKey, k) {
    var ncEvents = events.filter(function(e) { return e.context && e.context.noteCounts; });
    if (ncEvents.length === 0) return '';
    var modelName = ST.modelLabel(modelKey);

    var buckets = {
        '0-20': { events: [] },
        '21-40': { events: [] },
        '41-60': { events: [] },
        '61-80': { events: [] },
        '81+': { events: [] },
    };

    ncEvents.forEach(function(e) {
        var tb = e.context.totalNotesBefore;
        var key;
        if (tb <= 20) key = '0-20';
        else if (tb <= 40) key = '21-40';
        else if (tb <= 60) key = '41-60';
        else if (tb <= 80) key = '61-80';
        else key = '81+';
        buckets[key].events.push(e);
    });

    var uniformP = 1 / ST.NOTE_IDS.length;
    var rows = '';
    Object.keys(buckets).forEach(function(key) {
        var bucketEvents = buckets[key].events;
        if (bucketEvents.length === 0) {
            rows += '<tr><td>' + key + '</td><td class="num">0</td><td class="num">—</td><td class="num">—</td></tr>';
            return;
        }
        var ll = 0;
        bucketEvents.forEach(function(e) {
        var probs = ST.computeNoteProbs(e.context.noteCounts, modelKey, k, e.context);
        var p = Math.max(probs[e.tid] || 0, 1e-9);
        ll += Math.log(p);
        });
        var avgP = Math.exp(ll / bucketEvents.length);
        var avgDelta = (ll / bucketEvents.length) - Math.log(uniformP);
        rows += '<tr><td>' + key + '</td><td class="num">' + bucketEvents.length + '</td>' +
            '<td class="num">' + (avgP * 100).toFixed(2) + '%</td>' +
            '<td class="num">' + (avgDelta > 0 ? '+' : '') + avgDelta.toFixed(4) + '</td></tr>';
    });

    return '<div class="chart-card"><h3>Model Performance by Total Notes Owned (' + modelName + ')</h3>' +
        '<div style="font-size:11px;color:#555;margin-bottom:8px">Avg P(dropped) = model\'s avg confidence in the note that actually dropped. Higher = better fit.</div>' +
        '<table class="data-table"><tr><th>Total Notes Before</th><th class="num">Events</th><th class="num">Avg P(dropped)</th><th class="num">Avg &#916; vs Uniform</th></tr>' +
        rows + '</table></div>';
};

ST.buildStackInfo = function(events) {
    var stackCount = events.filter(function(e) { return e.isStack; }).length;
    var pct = events.length > 0 ? (stackCount / events.length * 100).toFixed(1) : '0.0';
    return '<div class="chart-card"><h3>Stack Triggers (Note of Surprise III)</h3>' +
        'Stacks: ' + stackCount + ' / ' + events.length + ' events (' + pct + '%)</div>';
};

ST.buildLLMData = function(events) {
    var ncEvents = events.filter(function(e) { return e.context && e.context.noteCounts; });
    if (ncEvents.length === 0) return '';

    var nids = ST.NOTE_IDS;
    var label = {};
    nids.forEach(function(tid, i) { label[tid] = (i + 1) + '=' + ST.noteName(tid); });
    var labels = nids.map(function(tid, i) { return (i + 1) + '=' + ST.noteName(tid); }).join(', ');

    var ndigits = String(ncEvents.length).length;
    var lines = [];
    lines.push('=== DATA DESCRIPTION ===');
    lines.push('');
    lines.push('Below are note drop events from "Star Tower" (a .hack//G.U. derivative).');
    lines.push('Each event shows the counts of each note type BEFORE the drop and which');
    lines.push('note won. Note mapping: ' + labels);
    lines.push('');
    lines.push('Each event also has startCountsBefore and startCountsAfter in its context:');
    lines.push('- startCountsBefore = carry-over notes from prior runs (bag before start.infos)');
    lines.push('- startCountsAfter = carry-over + free start.infos (total count at run start)');
    lines.push('These are the same for all events in a run.');
    lines.push('');
    lines.push('Format per event:');
    lines.push('  Event# Floor Source [count1 count2 ...] Won');
    lines.push('');
    lines.push('=== EVENTS ===');
    lines.push('');

    ncEvents.forEach(function(e, idx) {
        var cnts = nids.map(function(tid) { return e.context.noteCounts[tid] || 0; });
        var won = nids.indexOf(e.tid) + 1;
        var fl = e.floor !== undefined ? 'F' + e.floor : 'F?';
        var src = e.source || '?';
        lines.push(
            String(idx + 1).padStart(ndigits) + ' ' +
            fl.padEnd(4) + ' ' +
            src.padEnd(7) + ' [' + cnts.join(' ') + '] ' + won
        );
    });

    lines.push('');
    lines.push('=== TASK ===');
    lines.push('');
    lines.push('Find the weight formula used for note drop selection. The game picks a');
    lines.push('note via weighted random: P(i) = w(i) / sum(w). Determine w(count, note)');
    lines.push('that best fits this data. Model families to consider:');
    lines.push('- additive: w = count + K');
    lines.push('- sqrt: w = sqrt(count) + K');
    lines.push('- baseCarry + fixed K: w = baseCarry(note) + K for K in {5,10,20}');
    lines.push('- sqrt(baseCarry) + fixed K: w = sqrt(baseCarry(note)) + K for K in {5,10}');
    lines.push('- sqrt(count) + baseCarry + fixed K: w = sqrt(count) + baseCarry(note) + K for K in {5,10,20}');
    lines.push('- sqrt(count) + baseCarry + adjustable K: w = sqrt(count) + baseCarry(note) + K');
    lines.push('- baseCarry(note)^p + K: adjustable p and K');
    lines.push('- power: w = count^p + K');
    lines.push('- inverse: w = 1 / (count + K)');
    lines.push('- rank-based: linear or exponential decay by count rank');
    lines.push('- baseCarry rank: linear decay by startCountsBefore rank');
    lines.push('- inverse baseCarry: w = 1 / (baseCarry + 1)');
    lines.push('- power: w = count^p + K');
    lines.push('- inverse: w = 1 / (count + K)');
    lines.push('- rank-based: linear or exponential decay by count rank');
    lines.push('Any other transformation is fair game.');
    lines.push('');
    lines.push('Return your best guess for the weight formula, your confidence level,');
    lines.push('and what alternative formulas come close.');
    lines.push('');
    lines.push('Events: ' + ncEvents.length + ' | Notes: ' + nids.length + ' (' + labels + ')');

    var text = lines.join('\n');
    var escText = text.replace(/`/g, '\\`').replace(/\$/g, '\\$').replace(/\\/g, '\\\\');

    return '<div class="chart-card"><h3>LLM Data Export</h3>' +
        '<div style="margin-bottom:8px;display:flex;gap:6px;align-items:center">' +
        '<button class="note-src-btn" onclick="' +
        "var t=document.getElementById('llmDataPre');" +
        "navigator.clipboard.writeText(t.textContent).then(function(){t.style.outline='2px solid #5a8';setTimeout(function(){t.style.outline='none'},800)})" +
        '">Copy to Clipboard</button>' +
        '<span style="font-size:10px;color:#555">' + ncEvents.length + ' events (filtered)</span></div>' +
        '<pre id="llmDataPre" style="font-size:11px;line-height:1.5;overflow-x:auto;white-space:pre;background:#181818;padding:10px;border-radius:4px;border:1px solid #2a2a2a;color:#aaa;max-height:500px">' +
        escText + '</pre></div>';
};

ST.buildRecentDrops = function(events, limit) {
    if (events.length === 0) return '';
    limit = limit || 50;
    var subset = events.slice(Math.max(0, events.length - limit)).reverse();
    ST._noteDropDetails = subset;
    var selectedIdx = ST._selectedNoteDropIdx;
    var rows = '';
    subset.forEach(function(e, idx) {
        var note = ST.noteName(e.tid);
        var src = e.source || '?';
        var fl = e.floor !== undefined ? 'F' + e.floor : '';
        var qty = e.qty > 1 ? ' x' + e.qty : '';
        var stack = e.isStack ? ' <span style="color:#c9a06c">&#9733;</span>' : '';
        var bg = idx === selectedIdx ? ';background:#2a3a2a' : '';
        rows += '<tr style="cursor:pointer' + bg + '" onclick="ST.showNoteDropDetail(' + idx + ')">' +
            '<td>' + note + '</td><td class="src">' + src + '</td><td class="num">' + fl + '</td><td class="num">' + qty + '</td><td class="num">' + stack + '</td></tr>';
    });
    return '<div class="chart-card" style="max-height:320px;overflow-y:auto"><h3>Recent Drops (last ' + Math.min(limit, events.length) + ')</h3>' +
        '<table class="data-table"><tr><th>Note</th><th>Source</th><th class="num">Floor</th><th class="num">Qty</th><th class="num">Stack</th></tr>' +
        rows + '</table></div>';
};

ST._selectedNoteDropIdx = null;

ST.showNoteDropDetail = function(idx) {
    if (ST._selectedNoteDropIdx === idx) {
        ST._selectedNoteDropIdx = null;
    } else {
        ST._selectedNoteDropIdx = idx;
    }
    ST.renderNotes();
};

ST.buildDropDetail = function() {
    var idx = ST._selectedNoteDropIdx;
    if (idx === null || idx === undefined) return '';
    var e = ST._noteDropDetails[idx];
    if (!e || !e.context) return '';

    var modelKey = ST.noteFilters.model || 'harmoniesNotes05';
    var k = ST.noteFilters.k || 10;
    var probs = ST.computeNoteProbs(e.context.noteCounts, modelKey, k, e.context);

    var sorted = ST.NOTE_IDS.slice().sort(function(a, b) { return (probs[b] || 0) - (probs[a] || 0); });

    var rows = '';
    sorted.forEach(function(tid, rank) {
        var count = e.context.noteCounts[tid] || 0;
        var pct = ((probs[tid] || 0) * 100).toFixed(2) + '%';
        var hl = tid === e.tid ? ' style="color:#9aba8a"' : '';
        rows += '<tr' + hl + '><td>' + ST.noteName(tid) + '</td><td class="num">' + count + '</td><td class="pct">' + pct + '</td><td class="num">' + (rank + 1) + '</td></tr>';
    });

    return '<div class="chart-card"><h3>Drop Detail: ' + ST.noteName(e.tid) +
        ' (source: ' + e.source + ', before total: ' + (e.context.totalNotesBefore || 0) + ')</h3>' +
        '<div style="font-size:11px;color:#555;margin-bottom:8px">Green row = the note that dropped.</div>' +
        '<table class="data-table"><tr><th>Note</th><th class="num">Count Before</th><th class="pct">Model Prob</th><th class="num">Rank</th></tr>' +
        rows + '</table></div>';
};

// ── Main render ──

ST.renderNotes = function() {
    var panel = document.getElementById('panel-notes');
    if (!panel) return;

    var k = ST.noteFilters.k;
    if (k === undefined || k === null) k = 10;
    var modelKey = ST.noteFilters.model || 'harmoniesNotes05';
    var isAdditive = modelKey === 'additive' || modelKey === 'sqrtBaseK';
    var isPowBase = modelKey === 'powBaseCarry';
    var modelName = ST.modelLabel(modelKey);

    var p = ST.noteFilters.pow;
    if (p === undefined || p === null) p = 0.5;
    var powK = ST.noteFilters.powK;
    if (powK === undefined || powK === null) powK = 0.1;

    var noteOpts = '<option value="0"' + (ST.noteFilters.note === 0 ? ' selected' : '') + '>All Notes</option>';
    ST.NOTE_IDS.forEach(function(tid) {
        noteOpts += '<option value="' + tid + '"' + (ST.noteFilters.note === tid ? ' selected' : '') + '>' + ST.noteName(tid) + '</option>';
    });

    var srcButtons = ['battle', 'elite', 'boss', 'start', 'shop', 'event'];
    var srcHtml = '';
    var activeSources = ST.noteFilters.sources || {};
    srcButtons.forEach(function(src) {
        var active = activeSources[src] ? ' active' : '';
        srcHtml += '<button class="note-src-btn' + active + '" onclick="ST.toggleNoteSource(\'' + src + '\')">' +
            src.charAt(0).toUpperCase() + src.slice(1) + '</button>';
    });

    var kSlider = isAdditive
        ? '<span style="margin-left:14px;font-size:11px;color:#666;white-space:nowrap">N+</span>' +
          '<input type="text" id="kInput" value="' + k + '" style="width:36px;padding:2px 4px;border:1px solid #333;border-radius:3px;background:#242424;color:#ccc;font-size:12px;text-align:center" onchange="var v=parseInt(this.value);if(!isNaN(v)&&v>=0){ST.noteFilters.k=v;ST.renderNotes()}">' +
          '<button style="padding:2px 8px;border:1px solid #333;border-radius:3px;background:#242424;color:#888;cursor:pointer;font-size:12px;line-height:1.2" onclick="ST.noteFilters.k=Math.max(0,(ST.noteFilters.k||0)-1);document.getElementById(\'kInput\').value=ST.noteFilters.k;ST.renderNotes()">−</button>' +
          '<button style="padding:2px 8px;border:1px solid #333;border-radius:3px;background:#242424;color:#888;cursor:pointer;font-size:12px;line-height:1.2" onclick="ST.noteFilters.k=Math.min(100,(ST.noteFilters.k||0)+1);document.getElementById(\'kInput\').value=ST.noteFilters.k;ST.renderNotes()">+</button>'
        : '';

    var pSlider = isPowBase
        ? '<span style="margin-left:14px;font-size:11px;color:#666;white-space:nowrap">p=</span>' +
          '<input type="text" id="pInput" value="' + p + '" style="width:36px;padding:2px 4px;border:1px solid #333;border-radius:3px;background:#242424;color:#ccc;font-size:12px;text-align:center" onchange="var v=parseFloat(this.value);if(!isNaN(v)){v=Math.max(0,Math.min(3,v));ST.noteFilters.pow=v;ST.renderNotes()}">' +
          '<button style="padding:2px 8px;border:1px solid #333;border-radius:3px;background:#242424;color:#888;cursor:pointer;font-size:12px;line-height:1.2" onclick="var v=parseFloat((ST.noteFilters.pow||0.5)-0.1);v=Math.max(0,Math.round(v*10)/10);ST.noteFilters.pow=v;document.getElementById(\'pInput\').value=v;ST.renderNotes()">−</button>' +
          '<button style="padding:2px 8px;border:1px solid #333;border-radius:3px;background:#242424;color:#888;cursor:pointer;font-size:12px;line-height:1.2" onclick="var v=parseFloat((ST.noteFilters.pow||0.5)+0.1);v=Math.min(3,Math.round(v*10)/10);ST.noteFilters.pow=v;document.getElementById(\'pInput\').value=v;ST.renderNotes()">+</button>' +
          '<span style="margin-left:14px;font-size:11px;color:#666;white-space:nowrap">K=</span>' +
          '<input type="text" id="powKInput" value="' + powK + '" style="width:40px;padding:2px 4px;border:1px solid #333;border-radius:3px;background:#242424;color:#ccc;font-size:12px;text-align:center" onchange="var v=parseFloat(this.value);if(!isNaN(v)){v=Math.max(0,v);ST.noteFilters.powK=v;ST.renderNotes()}">' +
          '<button style="padding:2px 8px;border:1px solid #333;border-radius:3px;background:#242424;color:#888;cursor:pointer;font-size:12px;line-height:1.2" onclick="var v=parseFloat((ST.noteFilters.powK||0.1)-0.1);v=Math.max(0,Math.round(v*100)/100);ST.noteFilters.powK=v;document.getElementById(\'powKInput\').value=v;ST.renderNotes()">−</button>' +
          '<button style="padding:2px 8px;border:1px solid #333;border-radius:3px;background:#242424;color:#888;cursor:pointer;font-size:12px;line-height:1.2" onclick="var v=parseFloat((ST.noteFilters.powK||0.1)+0.1);v=Math.round(v*100)/100;ST.noteFilters.powK=v;document.getElementById(\'powKInput\').value=v;ST.renderNotes()">+</button>'
        : '';

    var nameLabel = (!isAdditive && !isPowBase)
        ? '<span style="margin-left:14px;font-size:11px;color:#555">model: ' + modelName + '</span>'
        : '';

    var sliderHtml = kSlider + pSlider + nameLabel;

    var html =
        '<div class="filters" id="noteFilters">' +
        '<select onchange="ST.noteFilters.note=parseInt(this.value);ST.renderNotes()">' + noteOpts + '</select>' +
        '<span style="margin-left:4px;color:#555;font-size:10px">source:</span>' +
        srcHtml +
        '<select onchange="ST.noteFilters.stack=this.value;ST.renderNotes()" style="margin-left:8px">' +
        '<option value="all"' + (ST.noteFilters.stack === 'all' ? ' selected' : '') + '>All Drops</option>' +
        '<option value="stack"' + (ST.noteFilters.stack === 'stack' ? ' selected' : '') + '>Stacks (+9)</option>' +
        '<option value="base"' + (ST.noteFilters.stack === 'base' ? ' selected' : '') + '>Base Only</option>' +
        '</select>' +
        '<span>' + sliderHtml + '</span>' +
        '</div><div class="scroll-panel" id="noteContent"></div>';

    // Save scroll position before DOM rebuild
    var content = document.getElementById('noteContent');
    var savedScroll = content ? content.scrollTop : 0;

    panel.innerHTML = html;

    content = document.getElementById('noteContent');
    if (!content) return;

    var events = ST.allNoteEvents;

    var activeSourcesList = ST.noteFilters.sources || {};
    var srcKeys = Object.keys(activeSourcesList);
    var hasActiveSources = srcKeys.length > 0 && srcKeys.some(function(s) { return activeSourcesList[s]; });

    var filtered = events.filter(function(e) {
        if (ST.noteFilters.note > 0 && e.tid !== ST.noteFilters.note) return false;
        if (hasActiveSources && !activeSourcesList[e.source]) return false;
        if (ST.noteFilters.stack === 'stack' && !e.isStack) return false;
        if (ST.noteFilters.stack === 'base' && e.isStack) return false;
        return true;
    });

    var ncEvents = filtered.filter(function(e) { return e.context && e.context.noteCounts; });

    var out = '<div style="padding:12px 0;font-size:12px;color:#666;">' + ncEvents.length + ' note drops, </div>';

    var sections = [];
    sections.push(ST.buildModelComparison(filtered));
    sections.push(ST.buildRecentDrops(filtered));
    sections.push(ST.buildDropDetail());
    sections.push(ST.buildPerNote(filtered, modelKey, k));
    sections.push(ST.buildRankHitRate(filtered, modelKey, k));

    if (ST.noteFilters.note > 0) {
        sections.push(ST.buildNoteBuckets(filtered, modelKey, k));
    } else {
        sections.push(ST.buildTotalNotesBuckets(filtered, modelKey, k));
    }

    sections.push(ST.buildStackInfo(filtered));
    sections.push(ST.buildLLMData(filtered));

    sections.forEach(function(s) { out += ST.section(s); });

    content.innerHTML = out;
    if (savedScroll > 0) content.scrollTop = savedScroll;
    // Restore section expand/collapse states and attach toggle listeners
    content.querySelectorAll('details.chart-card').forEach(function(d) {
        var h3 = d.querySelector('h3');
        if (!h3) return;
        var key = h3.textContent;
        if (ST._sectionOpen[key] === undefined) ST._sectionOpen[key] = d.open;
        else d.open = ST._sectionOpen[key];
        d.addEventListener('toggle', function() { var h = this.querySelector('h3'); if (h) ST._sectionOpen[h.textContent] = this.open; });
    });
};
