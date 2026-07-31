// tabs/notes.js — Weighted RNG model analysis for note drops

ST.noteFilters = { note: 0, sources: { battle: true, elite: true, boss: true }, stack: 'all', k: 10, pow: 0.5, powK: 0.1, model: 'hn0_5' };
ST._bestOdnK = null;

ST.selectModel = function(key) {
    ST.noteFilters.model = key;
    ST.renderNotes();
};

ST.toggleNoteSource = function(src) {
    var s = ST.noteFilters.sources;
    if (s[src]) { delete s[src]; } else { s[src] = true; }
    if (Object.keys(s).length === 0) ST.noteFilters.sources = {};
    ST.renderNotes();
};

// ── Model groups ──

ST._weightFns = {};

ST._enc = function(v) { return String(v).replace('.', '_'); };

ST.modelGroups = [
    { key: 'hn',   name: 'harmoniesNotes + K', param: 'K',
        params: [0.1,0.25,0.5,0.75,1,1.25,1.5,1.75,2,2.25,2.5,2.75,3,3.25,3.5,3.75,4,4.5,5,5.5,6,7,8,10,15],
        makeKey: function(v) { return 'hn' + ST._enc(v); },
        makeName: function(v) { return 'harmoniesNotes + ' + v; },
        makeDesc: function(v) { return 'weight = harmoniesNotes[tid] + ' + v; },
        weight: function(nc, ctx, tid, v) { return ((ctx.harmoniesNotes && ctx.harmoniesNotes[tid]) || 0) + v; }
    },
    { key: 'dn',   name: 'discsNotes + K', param: 'K',
        params: [0.1,0.25,0.5,0.75,1,1.25,1.5,1.75,2,2.25,2.5,2.75,3,3.25,3.5,3.75,4,4.5,5,5.5,6,7,8,10,15],
        makeKey: function(v) { return 'dn' + ST._enc(v); },
        makeName: function(v) { return 'discsNotes + ' + v; },
        makeDesc: function(v) { return 'weight = discsNotes[tid] + ' + v; },
        weight: function(nc, ctx, tid, v) { return ((ctx.discsNotes && ctx.discsNotes[tid]) || 0) + v; }
    },
    { key: 'odn',  name: 'overallDiscNotes + K', param: 'K',
        params: [0.01,0.05,0.1,0.15,0.2,0.25,0.3,0.35,0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.8,0.9,1,1.25,1.5,2,3,4,5,7.5],
        makeKey: function(v) { return 'odn' + ST._enc(v); },
        makeName: function(v) { return 'overallDiscNotes + ' + v; },
        makeDesc: function(v) { return 'weight = overallDiscNotes[tid] + ' + v; },
        weight: function(nc, ctx, tid, v) { return ((ctx.overallDiscNotes && ctx.overallDiscNotes[tid]) || 0) + v; }
    },

    // — Composite models (odn + other terms) —
    { key: 'odnc', name: 'overallDiscNotes + count + K', param: 'K',
        params: [0.01,0.05,0.1,0.15,0.2,0.25,0.3,0.35,0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.8,0.9,1,1.25,1.5,2,3,4,5,7.5],
        makeKey: function(v) { return 'odnc' + ST._enc(v); },
        makeName: function(v) { return 'overallDiscNotes + count + ' + v; },
        makeDesc: function(v) { return 'weight = overallDiscNotes[tid] + count[tid] + ' + v; },
        weight: function(nc, ctx, tid, v) {
            return ((ctx.overallDiscNotes && ctx.overallDiscNotes[tid]) || 0) + (nc[tid] || 0) + v;
        }
    },
    { key: 'odnsc', name: 'overallDiscNotes + \u221acount + K', param: 'K',
        params: [0.01,0.05,0.1,0.15,0.2,0.25,0.3,0.35,0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.8,0.9,1,1.25,1.5,2,3,4,5,7.5],
        makeKey: function(v) { return 'odnsc' + ST._enc(v); },
        makeName: function(v) { return 'overallDiscNotes + \u221acount + ' + v; },
        makeDesc: function(v) { return 'weight = overallDiscNotes[tid] + sqrt(count[tid]) + ' + v; },
        weight: function(nc, ctx, tid, v) {
            return ((ctx.overallDiscNotes && ctx.overallDiscNotes[tid]) || 0) + Math.sqrt(nc[tid] || 0) + v;
        }
    },
    { key: 'odnsb', name: 'overallDiscNotes + \u221asuppNotes + K', param: 'K',
        params: [0.01,0.05,0.1,0.15,0.2,0.25,0.3,0.35,0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.8,0.9,1,1.25,1.5,2,3,4,5,7.5],
        makeKey: function(v) { return 'odnsb' + ST._enc(v); },
        makeName: function(v) { return 'overallDiscNotes + \u221asuppNotes + ' + v; },
        makeDesc: function(v) { return 'weight = overallDiscNotes[tid] + sqrt(startCountsBefore[tid]) + ' + v; },
        weight: function(nc, ctx, tid, v) {
            return ((ctx.overallDiscNotes && ctx.overallDiscNotes[tid]) || 0)
                 + Math.sqrt((ctx.startCountsBefore && ctx.startCountsBefore[tid]) || 0) + v;
        }
    },
    { key: 'odncsc', name: 'overallDiscNotes + count + \u221acount + K', param: 'K',
        params: [0.01,0.05,0.1,0.15,0.2,0.25,0.3,0.35,0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.8,0.9,1,1.25,1.5,2,3,4,5,7.5],
        makeKey: function(v) { return 'odncsc' + ST._enc(v); },
        makeName: function(v) { return 'overallDiscNotes + count + \u221acount + ' + v; },
        makeDesc: function(v) { return 'weight = overallDiscNotes[tid] + count[tid] + sqrt(count[tid]) + ' + v; },
        weight: function(nc, ctx, tid, v) {
            return ((ctx.overallDiscNotes && ctx.overallDiscNotes[tid]) || 0) + (nc[tid] || 0) + Math.sqrt(nc[tid] || 0) + v;
        }
    },
    { key: 'odncd', name: 'overallDiscNotes + ? + count / D', param: 'D',
        params: [0.5,1,2,3,4,5,6,7,8,9,10,12,15,20,25,30,40,50,60,80,100,150,200,300,500],
        makeKey: function(v) { return 'odncd' + ST._enc(v); },
        makeName: function(v) { return 'overallDiscNotes + ? + count / ' + v; },
        makeDesc: function(v) { return 'weight = overallDiscNotes[tid] + bestOdnK + count[tid] / ' + v + ' \u2014 odn best-K baseline with count/D'; },
        weight: function(nc, ctx, tid, v) {
            return ((ctx.overallDiscNotes && ctx.overallDiscNotes[tid]) || 0) + (nc[tid] || 0) / v + (ST._bestOdnK || 0);
        }
    },
    { key: 'odnscd', name: 'overallDiscNotes + ? + \u221acount / D', param: 'D',
        params: [0.5,1,2,3,4,5,6,7,8,9,10,12,15,20,25,30,40,50,60,80,100,150,200,300,500],
        makeKey: function(v) { return 'odnscd' + ST._enc(v); },
        makeName: function(v) { return 'overallDiscNotes + ? + \u221acount / ' + v; },
        makeDesc: function(v) { return 'weight = overallDiscNotes[tid] + bestOdnK + sqrt(count[tid]) / ' + v + ' \u2014 odn best-K with sqrt(count)/D'; },
        weight: function(nc, ctx, tid, v) {
            return ((ctx.overallDiscNotes && ctx.overallDiscNotes[tid]) || 0) + Math.sqrt(nc[tid] || 0) / v + (ST._bestOdnK || 0);
        }
    },
    { key: 'odnmc', name: '(odn + 1) \u00b7 (1 + count / D)', param: 'D',
        params: [0.5,1,2,3,4,5,6,7,8,9,10,12,15,20,25,30,40,50,60,80,100,150,200,300,500],
        makeKey: function(v) { return 'odnmc' + ST._enc(v); },
        makeName: function(v) { return '(odn + 1) \u00b7 (1 + count / ' + v + ')'; },
        makeDesc: function(v) { return 'weight = (overallDiscNotes[tid] + 1) * (1 + count[tid] / ' + v + ') \u2014 multiplicative'; },
        weight: function(nc, ctx, tid, v) {
            var odn = (ctx.overallDiscNotes && ctx.overallDiscNotes[tid]) || 0;
            return (odn + 1) * (1 + (nc[tid] || 0) / v);
        }
    },
    { key: 'odncsd', name: 'overallDiscNotes + ? + odn \u00b7 suppNotes / D', param: 'D',
        params: [0.5,1,2,3,4,5,6,7,8,9,10,12,15,20,25,30,40,50,60,80,100,150,200,300,500],
        makeKey: function(v) { return 'odncsd' + ST._enc(v); },
        makeName: function(v) { return 'overallDiscNotes + ? + odn\u00b7suppNotes / ' + v; },
        makeDesc: function(v) { return 'weight = overallDiscNotes[tid] + bestOdnK + overallDiscNotes[tid] * startCountsBefore[tid] / ' + v + ' \u2014 odn + bestK + interaction with suppNotes/D'; },
        weight: function(nc, ctx, tid, v) {
            var odn = (ctx.overallDiscNotes && ctx.overallDiscNotes[tid]) || 0;
            return odn + (ST._bestOdnK || 0) + odn * ((ctx.startCountsBefore && ctx.startCountsBefore[tid]) || 0) / v;
        }
    },
    { key: 'dnc',  name: 'discsNotes + count + K', param: 'K',
        params: [0.25,0.5,0.75,1,1.25,1.5,1.75,2,2.25,2.5,2.75,3,3.5,4,4.5,5,5.5,6,7,8,10,12,15,20,30],
        makeKey: function(v) { return 'dnc' + ST._enc(v); },
        makeName: function(v) { return 'discsNotes + count + ' + v; },
        makeDesc: function(v) { return 'weight = discsNotes[tid] + count[tid] + ' + v; },
        weight: function(nc, ctx, tid, v) {
            return ((ctx.discsNotes && ctx.discsNotes[tid]) || 0) + (nc[tid] || 0) + v;
        }
    },

    { key: 'add',  name: 'count + K', param: 'K',
        params: [1,3,5,7,10,12,15,17,20,22,25,27,30,33,35,40,45,50,55,60,70,80,100,150,200],
        makeKey: function(v) { return 'add' + ST._enc(v); },
        makeName: function(v) { return 'count + ' + v; },
        makeDesc: function(v) { return 'weight = count[tid] + ' + v; },
        weight: function(nc, ctx, tid, v) { return (nc[tid] || 0) + v; }
    },

    { key: 'uadd', name: 'uniform + count / K', param: 'K',
        params: [0.5,1,2,3,4,5,6,7,8,9,10,12,15,20,25,30,40,50,60,80,100,150,200,300,500],
        makeKey: function(v) { return 'uadd' + ST._enc(v); },
        makeName: function(v) { return '1 + count / ' + v; },
        makeDesc: function(v) { return 'weight = 1 + count[tid] / ' + v + ' \u2014 uniform baseline with weak count influence'; },
        weight: function(nc, ctx, tid, v) { return 1 + (nc[tid] || 0) / v; }
    },
    { key: 'hndn', name: 'harmoniesNotes + discsNotes + K', param: 'K',
        params: [0.25,0.5,0.75,1,1.25,1.5,1.75,2,2.25,2.5,2.75,3,3.5,4,4.5,5,5.5,6,7,8,10,12,15,20,30],
        makeKey: function(v) { return 'hndn' + ST._enc(v); },
        makeName: function(v) { return 'harmoniesNotes + discsNotes + ' + v; },
        makeDesc: function(v) { return 'weight = harmoniesNotes[tid] + discsNotes[tid] + ' + v; },
        weight: function(nc, ctx, tid, v) {
            return ((ctx.harmoniesNotes && ctx.harmoniesNotes[tid]) || 0)
                 + ((ctx.discsNotes && ctx.discsNotes[tid]) || 0) + v;
        }
    },
    { key: 'odnhn', name: 'overallDiscNotes + harmoniesNotes + K', param: 'K',
        params: [0.25,0.5,0.75,1,1.25,1.5,1.75,2,2.25,2.5,2.75,3,3.5,4,4.5,5,5.5,6,7,8,10,12,15,20,30],
        makeKey: function(v) { return 'odnhn' + ST._enc(v); },
        makeName: function(v) { return 'overallDiscNotes + harmoniesNotes + ' + v; },
        makeDesc: function(v) { return 'weight = overallDiscNotes[tid] + harmoniesNotes[tid] + ' + v; },
        weight: function(nc, ctx, tid, v) {
            return ((ctx.overallDiscNotes && ctx.overallDiscNotes[tid]) || 0)
                 + ((ctx.harmoniesNotes && ctx.harmoniesNotes[tid]) || 0) + v;
        }
    },
    { key: 'logc', name: 'log(count + 1) + K', param: 'K',
        params: [0,0.25,0.5,0.75,1,1.25,1.5,1.75,2,2.25,2.5,2.75,3,3.5,4,4.5,5,5.5,6,7,8,10,12,15,20],
        makeKey: function(v) { return 'logc' + ST._enc(v); },
        makeName: function(v) { return 'log(count + 1) + ' + v; },
        makeDesc: function(v) { return 'weight = log(count[tid] + 1) + ' + v + ' \u2014 diminishing returns on count'; },
        weight: function(nc, ctx, tid, v) { return Math.log((nc[tid] || 0) + 1) + v; }
    },

    { key: 'rank', name: 'Rank-based', param: null, params: null,
        isSpecial: true,
        makeKey: function() { return null; },
        variations: [
            { key: 'rankLin', name: 'Rank linear', desc: 'weight = N+1\u2212rank where N = note types, rank 1 = highest count \u2014 linear decay' },
            { key: 'rankExp', name: 'Rank exp', desc: 'weight = 2^(N\u22121\u2212rank) \u2014 steep exponential decay' },
        ]
    },
    { key: 'uni',  name: 'Uniform', param: null, params: null,
        makeKey: function() { return 'uniform'; },
        makeName: function() { return 'Uniform (equal)'; },
        makeDesc: function() { return 'all notes have equal weight = 1'; },
        weight: function(nc, ctx, tid) { return 1; }
    },
];

ST._buildModelDefs = function() {
    ST.modelDefs = [];
    ST._weightFns = {};
    ST.modelGroups.forEach(function(g) {
        if (g.isSpecial) {
            (g.variations || []).forEach(function(v) {
                ST.modelDefs.push({ key: v.key, name: v.name, desc: v.desc, group: g.key, groupName: g.name });
            });
            return;
        }
        if (g.params) {
            g.params.forEach(function(p) {
                var key = g.makeKey(p);
                var name = g.makeName(p);
                var desc = g.makeDesc ? g.makeDesc(p) : (g.desc || '');
                ST.modelDefs.push({ key: key, name: name, desc: desc, group: g.key, groupName: g.name, param: p });
                ST._weightFns[key] = function(nc, ctx, tid) { return g.weight(nc, ctx, tid, p); };
            });
        } else {
            var key = g.makeKey();
            ST.modelDefs.push({ key: key, name: g.makeName(), desc: g.makeDesc ? g.makeDesc() : '', group: g.key, groupName: g.name });
            if (g.weight) ST._weightFns[key] = function(nc, ctx, tid) { return g.weight(nc, ctx, tid); };
        }
    });
    // Register rank weight functions separately
    ST._weightFns.rankLin = function(nc, ctx, tid, _nids) {
        var nids = _nids || ST.NOTE_IDS;
        var sorted = nids.slice().sort(function(a, b) { return (nc[b] || 0) - (nc[a] || 0); });
        var idx = sorted.indexOf(tid);
        return nids.length + 1 - (idx + 1);
    };
    ST._weightFns.rankExp = function(nc, ctx, tid, _nids) {
        var nids = _nids || ST.NOTE_IDS;
        var sorted = nids.slice().sort(function(a, b) { return (nc[b] || 0) - (nc[a] || 0); });
        var idx = sorted.indexOf(tid);
        return Math.pow(2, nids.length - 1 - idx);
    };
};
ST._buildModelDefs();

// ── Probability engine ──

ST.computeNoteProbs = function(noteCounts, modelKey, k, context) {
    var nc = noteCounts || {};
    var nids = ST.NOTE_IDS;
    if (!nids || nids.length === 0) return {};
    var ctx = context || {};

    var weightFn = ST._weightFns[modelKey];
    if (!weightFn) {
        var probs = {};
        nids.forEach(function(tid) { probs[tid] = 1 / nids.length; });
        return probs;
    }

    var weights = {};
    var totalWeight = 0;
    if (modelKey === 'rankLin' || modelKey === 'rankExp') {
        var sorted = nids.slice().sort(function(a, b) { return (nc[b] || 0) - (nc[a] || 0); });
        sorted.forEach(function(tid, idx) {
            var rank = idx + 1;
            var w = modelKey === 'rankLin' ? (nids.length + 1 - rank) : Math.pow(2, nids.length - 1 - rank);
            weights[tid] = w; totalWeight += w;
        });
    } else {
        nids.forEach(function(tid) {
            var w = weightFn(nc, ctx, tid);
            if (w == null || isNaN(w)) w = 0;
            weights[tid] = w;
            totalWeight += w;
        });
    }

    var probs = {};
    if (totalWeight <= 0) {
        nids.forEach(function(tid) { probs[tid] = 1 / nids.length; });
    } else {
        nids.forEach(function(tid) { probs[tid] = weights[tid] / totalWeight; });
    }
    return probs;
};

ST.modelLabel = function(key) {
    for (var i = 0; i < ST.modelDefs.length; i++) {
        if (ST.modelDefs[i].key === key) return ST.modelDefs[i].name;
    }
    return key;
};

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
    var top1Correct = 0;
    var rankSum = 0;
    var perEventLoss = [];
    var calibPairs = [];

    ncEvents.forEach(function(e) {
        observed[e.tid]++;
        var probs = ST.computeNoteProbs(e.context.noteCounts, modelKey, k, e.context);
        var p = Math.max(probs[e.tid] || 0, 1e-9);
        var loss = -Math.log(p);
        ll += Math.log(p);
        perEventLoss.push(loss);

        var sorted = nids.slice().sort(function(a, b) { return (probs[b] || 0) - (probs[a] || 0); });
        if (sorted[0] === e.tid) top1Correct++;
        rankSum += sorted.indexOf(e.tid) + 1;

        nids.forEach(function(tid) {
            expected[tid] += probs[tid];
            var actual = tid === e.tid ? 1 : 0;
            var pred = probs[tid];
            brierSum += (actual - pred) * (actual - pred);
            calibPairs.push({ pred: pred, actual: actual });
        });
    });

    var brier = brierSum / (total * nNoteTypes);

    var ece = 0;
    var nPairs = calibPairs.length;
    calibPairs.sort(function(a, b) { return a.pred - b.pred; });
    var eceReliable = nPairs >= 100 && Math.abs(calibPairs[nPairs - 1].pred - calibPairs[0].pred) >= 1e-9;
    if (eceReliable) {
        var N_BINS = 10;
        var binSize = Math.floor(nPairs / N_BINS);
        for (var bi = 0; bi < N_BINS; bi++) {
            var start = bi * binSize;
            var end = bi === N_BINS - 1 ? nPairs : start + binSize;
            if (end <= start) continue;
            var sumPred = 0, sumObs = 0;
            for (var pi = start; pi < end; pi++) {
                sumPred += calibPairs[pi].pred;
                sumObs += calibPairs[pi].actual;
            }
            var nBin = end - start;
            ece += Math.abs(sumPred / nBin - sumObs / nBin) * nBin;
        }
        ece = ece / nPairs;
    } else {
        ece = 0;
    }

    var nll = -ll;
    var meanRank = rankSum / total;
    var top1Pct = (top1Correct / total) * 100;
    var nllPer = nll / total;

    return {
        logLik: ll, nll: nll, nllPer: nllPer, brier: brier, n: total,
        meanRank: meanRank, top1Pct: top1Pct, ece: ece, eceReliable: eceReliable,
        perEventLoss: perEventLoss
    };
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

ST._modelGroupOpen = {};

ST.toggleModelGroup = function(gkey) {
    ST._modelGroupOpen[gkey] = !ST._modelGroupOpen[gkey];
    ST.renderNotes();
};

ST.buildModelComparison = function(events) {
    var ncEvents = events.filter(function(e) { return e.context && e.context.noteCounts; });
    if (ncEvents.length < 5) return '';

    var results = [];
    var bestCorrectP = -Infinity, bestNll = Infinity, bestBrier = Infinity;
    var bestTop1 = -Infinity, bestRank = Infinity, bestEce = Infinity;
    var bestCorrectR = null, bestNllR = null, bestBrierR = null;
    var bestTop1R = null, bestRankR = null, bestEceR = null;

    var byGroup = {};

    // Pre-evaluate odn models to find best K
    ST._bestOdnK = null;
    var bestOdnCorrectP = -Infinity;
    ST.modelDefs.forEach(function(md) {
        if (md.group !== 'odn') return;
        var rr = ST.evalModel(events, md.key, 0);
        if (!rr) return;
        var cp = Math.exp(rr.logLik / rr.n) * 100;
        if (cp > bestOdnCorrectP) { bestOdnCorrectP = cp; ST._bestOdnK = md.param; }
    });

    ST.modelDefs.forEach(function(md) {
        var r = ST.evalModel(events, md.key, 0);
        if (!r) return;
        r.key = md.key;
        r.name = md.name;
        r.desc = md.desc;
        r.group = md.group;
        r.groupName = md.groupName;
        r.param = md.param;
        r.correctP = Math.exp(r.logLik / r.n) * 100;
        // Show actual bestK in odncd/odnscd names
        if ((r.group === 'odncd' || r.group === 'odnscd' || r.group === 'odncsd') && ST._bestOdnK !== null) {
            r.name = r.name.replace('?', String(ST._bestOdnK));
            r.desc = r.desc.replace('bestOdnK', String(ST._bestOdnK));
        }
        if (r.correctP > bestCorrectP) { bestCorrectP = r.correctP; bestCorrectR = r; }
        if (r.nll < bestNll) { bestNll = r.nll; bestNllR = r; }
        if (r.brier < bestBrier) { bestBrier = r.brier; bestBrierR = r; }
        if (r.top1Pct > bestTop1) { bestTop1 = r.top1Pct; bestTop1R = r; }
        if (r.meanRank < bestRank) { bestRank = r.meanRank; bestRankR = r; }
        if (r.eceReliable && r.ece < bestEce) { bestEce = r.ece; bestEceR = r; }
        results.push(r);
        if (!byGroup[r.group]) byGroup[r.group] = [];
        byGroup[r.group].push(r);
    });

    var selectedModel = ST.noteFilters.model || 'hn0_5';
    var totalRows = 0;

    // Build group summary rows
    var html = '<div class="chart-card"><h3>Model Comparison (' + ncEvents.length + ' events)</h3>' +
        '<div style="font-size:11px;color:#666;margin-bottom:8px;line-height:1.6">' +
            'Each group shows the <strong>best</strong> Correct P% model within its family. Click to expand and see all ' +
            'variations. Rows highlighted green = best overall across all groups for that metric.<br>' +
            'Correct P%: geometric-mean probability assigned to the dropped note (higher = better) &middot; ' +
            'NLL/n: per-event log-loss (lower = better) &middot; ' +
            'Top-1%: fraction where model\'s favorite won &middot; ' +
            'Mean Rank: avg rank model assigned to the dropped note &middot; ' +
            'ECE: calibration error (10 equal-mass bins, "—" if fewer than 100 prediction pairs) &middot; ' +
            'Brier: mean squared probability error' +
        '</div>' +
        '<div style="font-size:10px;color:#555;margin-bottom:8px;line-height:1.5">' +
            'Terms: <strong>harmoniesNotes</strong> = total harmony material copies needed across your 3 equipped discs &middot; ' +
            '<strong>discsNotes</strong> = how many of your 3 discs feature this note (0\u20133) &middot; ' +
            '<strong>overallDiscNotes</strong> = whether this note appears on any equipped disc (0/1) &middot; ' +
            '<strong>count</strong> = how many of this note type you own before the drop &middot; ' +
            '<strong>suppNotes</strong> = startCountsBefore (support discs you brought into the run) &middot; ' +
            '<strong>K, D</strong> = model parameters varied within the group' +
        '</div>' +
        '<table class="data-table"><tr><th></th><th>Model</th><th class="pct">Correct P%</th><th class="num">NLL/n</th><th class="pct">Top-1%</th><th class="num">Mean Rank</th><th class="num">ECE</th><th class="num">Brier</th></tr>';

    var groupsInOrder = ST.modelGroups.map(function(g) { return g.key; });
    groupsInOrder.forEach(function(gkey) {
        var grpResults = byGroup[gkey];
        if (!grpResults || grpResults.length === 0) return;
        var groupDef;
        for (var gi = 0; gi < ST.modelGroups.length; gi++) {
            if (ST.modelGroups[gi].key === gkey) { groupDef = ST.modelGroups[gi]; break; }
        }
        if (!groupDef) return;

        // Find best in group by Correct P%
        var best = grpResults[0];
        for (var ri = 1; ri < grpResults.length; ri++) {
            if (grpResults[ri].correctP > best.correctP) best = grpResults[ri];
        }

        var isOpen = ST._modelGroupOpen[gkey];
        var toggleArrow = isOpen ? '&#9660;' : '&#9654;';
        var displayStyle = isOpen ? '' : ' style="display:none"';
        var isSelected = best.key === selectedModel;
        var headerStyle = ' style="cursor:pointer;border-bottom:' + (isOpen ? 'none' : '1px solid #252525') + ';';
        if (isSelected) headerStyle += 'border-left:3px solid #7aba7a;background:#2a2a2a;';
        headerStyle += '"';

        var correctStyle = best === bestCorrectR ? ' style="color:#9aba8a"' : '';
        var nllStyle = best === bestNllR ? ' style="color:#9aba8a"' : '';
        var brierStyle = best === bestBrierR ? ' style="color:#9aba8a"' : '';
        var top1Style = best === bestTop1R ? ' style="color:#9aba8a"' : '';
        var rankStyle = best === bestRankR ? ' style="color:#9aba8a"' : '';
        var eceStyle = best === bestEceR ? ' style="color:#9aba8a"' : '';
        var eceCell = best.eceReliable ? best.ece.toFixed(4) : '—';

        var countLabel = grpResults.length > 1 ? ' <span style="font-size:9px;color:#555">(' + grpResults.length + ')</span>' : '';
        var groupName = groupDef.name;
        if ((gkey === 'odncd' || gkey === 'odnscd' || gkey === 'odncsd') && ST._bestOdnK !== null) {
            groupName = groupName.replace('?', String(ST._bestOdnK));
        }

        html += '<tr class="mg-header" onclick="ST.toggleModelGroup(\'' + gkey + '\')" data-mg="' + gkey + '"' + headerStyle + '>' +
            '<td class="expand-btn" style="font-size:10px">' + toggleArrow + '</td>' +
            '<td><span style="font-weight:500">' + groupName + '</span>' + countLabel + '<br><span style="font-size:9px;color:#555">' + best.name + '</span></td>' +
            '<td class="pct"' + correctStyle + '>' + best.correctP.toFixed(2) + '%</td>' +
            '<td class="num"' + nllStyle + '>' + best.nllPer.toFixed(4) + '</td>' +
            '<td class="pct"' + top1Style + '>' + best.top1Pct.toFixed(1) + '%</td>' +
            '<td class="num"' + rankStyle + '>' + best.meanRank.toFixed(2) + '</td>' +
            '<td class="num"' + eceStyle + '>' + eceCell + '</td>' +
            '<td class="num"' + brierStyle + '>' + best.brier.toFixed(4) + '</td></tr>';

        // Detail rows (all variations in the group)
        // Sort by name for easy scanning; group header still shows best Correct P%
        var sortedInGroup = grpResults.slice().sort(function(a, b) { return (a.param || 0) - (b.param || 0); });
        var subRows = '';
        sortedInGroup.forEach(function(r) {
            var isSubSelected = r.key === selectedModel;
            var selStyle = isSubSelected ? ' style="border-left:2px solid #7aba7a;background:#2a2a2a"' : '';
            var click = ' onclick="ST.selectModel(\'' + r.key + '\')"';

            var sc = r === bestCorrectR ? ' style="color:#9aba8a"' : '';
            var sn = r === bestNllR ? ' style="color:#9aba8a"' : '';
            var sb = r === bestBrierR ? ' style="color:#9aba8a"' : '';
            var st = r === bestTop1R ? ' style="color:#9aba8a"' : '';
            var sr = r === bestRankR ? ' style="color:#9aba8a"' : '';
            var se = r === bestEceR ? ' style="color:#9aba8a"' : '';
            var ec = r.eceReliable ? r.ece.toFixed(4) : '—';

            subRows += '<tr' + selStyle + click + '>' +
                '<td></td>' +
                '<td style="padding-left:20px;font-size:11px">' + r.name + '<br><span style="font-size:9px;color:#555">' + r.desc + '</span></td>' +
                '<td class="pct"' + sc + '>' + r.correctP.toFixed(2) + '%</td>' +
                '<td class="num"' + sn + '>' + r.nllPer.toFixed(4) + '</td>' +
                '<td class="pct"' + st + '>' + r.top1Pct.toFixed(1) + '%</td>' +
                '<td class="num"' + sr + '>' + r.meanRank.toFixed(2) + '</td>' +
                '<td class="num"' + se + '>' + ec + '</td>' +
                '<td class="num"' + sb + '>' + r.brier.toFixed(4) + '</td></tr>';
        });

        html += '<tr class="mg-detail" data-mg="' + gkey + '"' + displayStyle + '><td colspan="8" style="padding:0">' +
            '<table class="data-table" style="margin:0;border-top:1px solid #252525">' + subRows + '</table></td></tr>';
    });

    html += '</table></div>';
    return html;
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
    lines.push('Each event also has harmoniesNotes, discsNotes, overallDiscNotes, startCountsBefore, and startCountsAfter in its context:');
    lines.push('- harmoniesNotes = harmony material copies needed across your 3 equipped discs (from NeedSubNoteSkills)');
    lines.push('- discsNotes = how many of your 3 discs feature this note in their secondary skills (0-3)');
    lines.push('- overallDiscNotes = 1 if this note appears on any equipped disc, 0 otherwise');
    lines.push('- startCountsBefore = support discs (bag before start.infos)');
    lines.push('- startCountsAfter = support discs + free start.infos (total count at run start)');
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
    lines.push('- suppNotes + fixed K: w = suppNotes(note) + K for K in {5,10,20}');
    lines.push('- sqrt(suppNotes) + fixed K: w = sqrt(suppNotes(note)) + K for K in {5,10}');
    lines.push('- sqrt(count) + suppNotes + fixed K: w = sqrt(count) + suppNotes(note) + K for K in {5,10,20}');
    lines.push('- sqrt(count) + suppNotes + adjustable K: w = sqrt(count) + suppNotes(note) + K');
    lines.push('- suppNotes(note)^p + K: adjustable p and K');
    lines.push('- power: w = count^p + K');
    lines.push('- inverse: w = 1 / (count + K)');
    lines.push('- rank-based: linear or exponential decay by count rank');
    lines.push('- suppNotes rank: linear decay by startCountsBefore rank');
    lines.push('- inverse suppNotes: w = 1 / (suppNotes + 1)');
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

    var modelKey = ST.noteFilters.model || 'hn0_5';
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
    var modelKey = ST.noteFilters.model || 'hn0_5';
    var modelName = ST.modelLabel(modelKey);

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

    var nameLabel = '<span style="margin-left:14px;font-size:11px;color:#555">model: ' + modelName + '</span>';

    var sliderHtml = nameLabel;

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
