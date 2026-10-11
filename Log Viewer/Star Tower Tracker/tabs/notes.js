// tabs/notes.js — Weighted RNG model analysis for note drops

ST.noteFilters = { note: 0, sources: { battle: true, elite: true, boss: true }, stack: 'all', runFloor: 0, runMinFloor: 0, odn: 0, tower: 0, k: 10, pow: 0.5, powK: 0.1, model: 'hn0_5' };
ST._bestOdnK = null;
ST._seedDParams = [0.05,0.1,0.2,0.3,0.4,0.5,0.6,0.75,0.9,1,1.1,1.25,1.4,1.5,1.6,1.75,1.9,2,2.25,2.5,3,4,5,6,8,10,15,20,30,50,100];
ST._elemDParams = [2,3,4,5,6,8,10,12,15,20,25,30,40,50,75,100,150,200,300,500];

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
ST._bestOdnGroups = ['odncd', 'odncsbd', 'odned', 'odnsoft', 'seed12', 'seed123', 'seed1234', 'seed12345', 'seed123456', 'seed1234567', 'seed12345678', 'dynSeed1', 'dynSeed12', 'dynSeed123', 'odnscd', 'odncsd'];
ST._usesBestOdnK = function(group) { return ST._bestOdnGroups.indexOf(group) >= 0; };
ST._seedBonus = function(ctx, prefix, count, tid) {
    for (var i = 1; i <= count; i++) {
        if (ctx[prefix + i] === tid) return 1;
    }
    return 0;
};

ST._enc = function(v) { return String(v).replace('.', '_'); };

// ── Per-run TDN size (distinct notes needed by equipped discs) ──
// isDiscNote / harmoniesNotes / discsNotes share the same key set per
// run (see app.js _beginRun); the size = amount of different notes needed.
ST.odnSize = function(odnObj) {
    if (!odnObj) return 0;
    // Collapse element damage notes (90019-90023) into Element (90018) so
    // runs built before the app.js fix (raw keys) count the same as new runs.
    var seen = {};
    for (var k in odnObj) {
        if (!odnObj[k]) continue;
        var eff = (typeof ST._ele === 'function') ? ST._ele(parseInt(k, 10)) : k;
        seen[eff] = true;
    }
    var n = 0;
    for (var s in seen) n++;
    return n;
};

ST.runOdnSize = function(run) {
    if (!run) return 0;
    if (run._isDiscNote) return ST.odnSize(run._isDiscNote);
    if (run._harmoniesNotes) return ST.odnSize(run._harmoniesNotes);
    return 0;
};

// How many RNG rolls one recorded event represents. The server aggregates
// each gain per note type ({tid, qty}). For floor income (3-copy base
// bundles, see below) the fit uses ST.fitWeight instead; this stays as the
// fallback for event bundles (each unit a separate draw), shop and start.
ST.eventRolls = function(e) {
    if (!e || e.isStack) return 1;
    return Math.max(1, e.qty || 1);
};

ST.eventRollTotal = function(events) {
    var n = 0;
    (events || []).forEach(function(e) { n += ST.eventRolls(e); });
    return n;
};

// Floor-income grammar: base bundles of 3 copies of one rolled type, each
// base independently stackable to 9 (+6 copies, no new type draw). Validated
// against the log: every battle-action floor packet total fits these tables
// (floor total -> base count B; stacks S = (T - 3B) / 6), and per-tid
// quantities resolve uniquely via q = 3b + 6s under the floor (B, S).
// Boss single-base packets (T=3/9) occur ~120x in Star Tower data, so boss
// allows B=1 (the Monolith doc's boss minimum of 2 does not hold here).
ST.FLOOR_BASES = {
    battle: { 3: 1, 6: 2, 9: 1, 12: 2, 18: 2 },
    elite:  { 3: 1, 6: 2, 9: 1, 12: 2, 18: 2 },
    boss:   { 3: 1, 6: 2, 9: 1, 12: 2, 15: 5, 18: 2, 21: 5, 27: 5, 33: 5, 39: 5 },
};

// (bases, stacks) options for one tid holding q copies: q = 3b + 6s, s <= b.
// Ambiguous alone (e.g. 9 = stacked base OR 3 plain bases); the floor packet
// constraints pick the unique reading.
ST.decompOptions = function(q) {
    var opts = [];
    if (q <= 0 || q % 3 !== 0) return opts;
    for (var b = 0; b <= q / 3; b++) {
        var rem = q - 3 * b;
        if (rem % 6 !== 0) continue;
        var s = rem / 6;
        if (s <= b) opts.push({ b: b, s: s });
    }
    return opts;
};

// Unique per-entry (b, s) assignment for one floor packet, or null when the
// total is off-grammar or the reading is ambiguous.
ST.solveFloorDecomp = function(qtys, B, S) {
    var opts = qtys.map(ST.decompOptions);
    for (var i = 0; i < opts.length; i++) { if (opts[i].length === 0) return null; }
    var solutions = [];
    var assign = [];
    (function dfs(i, bSum, sSum) {
        if (solutions.length > 1) return;
        if (i === opts.length) {
            if (bSum === B && sSum === S) solutions.push(assign.slice());
            return;
        }
        for (var k = 0; k < opts[i].length; k++) {
            var o = opts[i][k];
            if (bSum + o.b > B || sSum + o.s > S) continue;
            assign.push(o);
            dfs(i + 1, bSum + o.b, sSum + o.s);
            assign.pop();
            if (solutions.length > 1) return;
        }
    })(0, 0, 0);
    return solutions.length === 1 ? solutions[0] : null;
};

// Split floor-income entries into base type-draws (fit input) and stack
// grants (excluded from the fit: a stack adds copies, no new type draw).
// Sets e._b (base draws this entry contributes), e._s (stack grants on it),
// or e._quarantined (off-grammar/ambiguous packet, excluded from the fit).
// MUST run on UNFILTERED entries: source/note filters can split a floor's
// packet and would fake quarantines.
ST.decomposeNoteEntries = function(events) {
    var stats = { floors: 0, draws: 0, stacks: 0, quarantinedEntries: 0, quarantinedFloors: 0 };
    var groups = {};
    (events || []).forEach(function(e) {
        delete e._b; delete e._s; delete e._quarantined;
        var isFloorIncome = (e.source === 'battle' || e.source === 'elite' || e.source === 'boss') &&
            e.action !== 'select' && e.action !== 'run';
        if (!isFloorIncome || !(e.context && e.context.noteCounts)) return;
        var k = e.runId + '|' + e.floor;
        (groups[k] = groups[k] || []).push(e);
    });
    function quarantine(g) {
        g.forEach(function(e) { e._quarantined = true; });
        stats.quarantinedEntries += g.length;
        stats.quarantinedFloors++;
    }
    Object.keys(groups).forEach(function(k) {
        var g = groups[k];
        var table = ST.FLOOR_BASES[g[0].source] || ST.FLOOR_BASES.battle;
        var T = 0;
        g.forEach(function(e) { T += Math.max(0, e.qty || 0); });
        var B = table[T];
        stats.floors++;
        if (B == null) { quarantine(g); return; }
        var S = (T - 3 * B) / 6;
        if (S !== Math.floor(S) || S < 0) { quarantine(g); return; }
        var sol = ST.solveFloorDecomp(g.map(function(e) { return e.qty; }), B, S);
        if (!sol) { quarantine(g); return; }
        g.forEach(function(e, i) {
            e._b = sol[i].b; e._s = sol[i].s;
            stats.draws += sol[i].b; stats.stacks += sol[i].s;
        });
    });
    return stats;
};

// Fit weight of one entry: decomposed base draws for floor income; qty
// expansion for event bundles/shop/start; quarantined packets contribute 0.
ST.fitWeight = function(e) {
    if (!e) return 0;
    if (e._quarantined) return 0;
    if (e._b != null) return e._b;
    return ST.eventRolls(e);
};

ST.fitTotal = function(events) {
    var n = 0;
    (events || []).forEach(function(e) { n += ST.fitWeight(e); });
    return n;
};

// Stack grants on these entries (decomposed count, else legacy flag).
ST.stackWeight = function(e) {
    if (!e) return 0;
    if (e._s != null) return e._s;
    return e.isStack ? 1 : 0;
};

ST.stackGrants = function(events) {
    var n = 0;
    (events || []).forEach(function(e) { n += ST.stackWeight(e); });
    return n;
};

// K grid for the TDN families: all below 0.5, concentrated at the very
// small end around 0.02/0.03.
ST._tdnKParams = [0.005,0.008,0.01,0.012,0.015,0.017,0.02,0.022,0.025,0.027,0.03,0.033,0.036,0.04,0.045,0.05,0.06,0.07,0.08,0.09,0.1,0.12,0.14,0.16,0.2,0.25,0.3,0.35,0.4,0.45];

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
    { key: 'odn',  name: 'isDiscNote + K', param: 'K',
        params: [0.01,0.02,0.03,0.04,0.05,0.06,0.07,0.08,0.09,0.1,0.11,0.12,0.13,0.14,0.15,0.16,0.17,0.18,0.19,0.2,0.21,0.22,0.23,0.24,0.25,0.26,0.27,0.28,0.29,0.3,0.35,0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.8,0.9,1,1.25,1.5,2,3,4,5,7.5],
        makeKey: function(v) { return 'odn' + ST._enc(v); },
        makeName: function(v) { return 'isDiscNote + ' + v; },
        makeDesc: function(v) { return 'weight = isDiscNote[tid] + ' + v; },
        weight: function(nc, ctx, tid, v) { return ((ctx.isDiscNote && ctx.isDiscNote[tid]) || 0) + v; }
    },
    { key: 'odntdn', name: 'isDiscNote/TDN + K', param: 'K',
        params: ST._tdnKParams,
        makeKey: function(v) { return 'odntdn' + ST._enc(v); },
        makeName: function(v) { return 'isDiscNote/TDN + ' + v; },
        makeDesc: function(v) { return 'weight = isDiscNote[tid]/TDN + ' + v + ' (isDiscNote = 1 when the note is needed by any equipped disc; TDN = run total disc notes needed)'; },
        weight: function(nc, ctx, tid, v) {
            var tdn = ST.odnSize(ctx.isDiscNote);
            var need = ((ctx.isDiscNote && ctx.isDiscNote[tid]) || 0) ? 1 : 0;
            return (tdn > 0 ? need / tdn : 0) + v;
        }
    },
    { key: 'odntdn2', name: 'isDiscNote/TDN/TDN + K', param: 'K',
        params: ST._tdnKParams,
        makeKey: function(v) { return 'odntdn2' + ST._enc(v); },
        makeName: function(v) { return 'isDiscNote/TDN/TDN + ' + v; },
        makeDesc: function(v) { return 'weight = isDiscNote[tid]/TDN/TDN + ' + v + ' (need bonus diluted twice by TDN)'; },
        weight: function(nc, ctx, tid, v) {
            var tdn = ST.odnSize(ctx.isDiscNote);
            var need = ((ctx.isDiscNote && ctx.isDiscNote[tid]) || 0) ? 1 : 0;
            return (tdn > 0 ? need / (tdn * tdn) : 0) + v;
        }
    },
    { key: 'odntdnkt', name: 'isDiscNote/TDN + K*TDN', param: 'K',
        params: ST._tdnKParams,
        makeKey: function(v) { return 'odntdnkt' + ST._enc(v); },
        makeName: function(v) { return 'isDiscNote/TDN + ' + v + '*TDN'; },
        makeDesc: function(v) { return 'weight = isDiscNote[tid]/TDN + ' + v + '*TDN (baseline scales up with TDN)'; },
        weight: function(nc, ctx, tid, v) {
            var tdn = ST.odnSize(ctx.isDiscNote);
            var need = ((ctx.isDiscNote && ctx.isDiscNote[tid]) || 0) ? 1 : 0;
            return (tdn > 0 ? need / tdn : 0) + v * tdn;
        }
    },
    { key: 'odnsoft', name: 'isDiscNote + ? with softcap at D', param: 'D',
        params: [20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,95,100],
        makeKey: function(v) { return 'odnsoft' + ST._enc(v); },
        makeName: function(v) { return 'isDiscNote + ? with softcap at ' + v; },
        makeDesc: function(v) { return 'weight = (isDiscNote[tid] + bestOdnK) / (1 + max(0, count[tid] - ' + v + ') / ' + v + ')'; },
        weight: function(nc, ctx, tid, v) {
            var odn = ((ctx.isDiscNote && ctx.isDiscNote[tid]) || 0) + (ST._bestOdnK || 0);
            var count = nc[tid] || 0;
            return odn / (1 + Math.max(0, count - v) / v);
        }
    },

    // — Composite models (odn + other terms) —
    { key: 'odnc', name: 'isDiscNote + count + K', param: 'K',
        params: [0.01,0.05,0.1,0.15,0.2,0.25,0.3,0.35,0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.8,0.9,1,1.25,1.5,2,3,4,5,7.5],
        makeKey: function(v) { return 'odnc' + ST._enc(v); },
        makeName: function(v) { return 'isDiscNote + count + ' + v; },
        makeDesc: function(v) { return 'weight = isDiscNote[tid] + count[tid] + ' + v; },
        weight: function(nc, ctx, tid, v) {
            return ((ctx.isDiscNote && ctx.isDiscNote[tid]) || 0) + (nc[tid] || 0) + v;
        }
    },
    { key: 'odnsc', name: 'isDiscNote + \u221acount + K', param: 'K',
        params: [0.01,0.05,0.1,0.15,0.2,0.25,0.3,0.35,0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.8,0.9,1,1.25,1.5,2,3,4,5,7.5],
        makeKey: function(v) { return 'odnsc' + ST._enc(v); },
        makeName: function(v) { return 'isDiscNote + \u221acount + ' + v; },
        makeDesc: function(v) { return 'weight = isDiscNote[tid] + sqrt(count[tid]) + ' + v; },
        weight: function(nc, ctx, tid, v) {
            return ((ctx.isDiscNote && ctx.isDiscNote[tid]) || 0) + Math.sqrt(nc[tid] || 0) + v;
        }
    },
    { key: 'odnsb', name: 'isDiscNote + \u221asuppNotes + K', param: 'K',
        params: [0.01,0.05,0.1,0.15,0.2,0.25,0.3,0.35,0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.8,0.9,1,1.25,1.5,2,3,4,5,7.5],
        makeKey: function(v) { return 'odnsb' + ST._enc(v); },
        makeName: function(v) { return 'isDiscNote + \u221asuppNotes + ' + v; },
        makeDesc: function(v) { return 'weight = isDiscNote[tid] + sqrt(startCountsBefore[tid]) + ' + v; },
        weight: function(nc, ctx, tid, v) {
            return ((ctx.isDiscNote && ctx.isDiscNote[tid]) || 0)
                 + Math.sqrt((ctx.startCountsBefore && ctx.startCountsBefore[tid]) || 0) + v;
        }
    },
    { key: 'odncsc', name: 'isDiscNote + count + \u221acount + K', param: 'K',
        params: [0.01,0.05,0.1,0.15,0.2,0.25,0.3,0.35,0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.8,0.9,1,1.25,1.5,2,3,4,5,7.5],
        makeKey: function(v) { return 'odncsc' + ST._enc(v); },
        makeName: function(v) { return 'isDiscNote + count + \u221acount + ' + v; },
        makeDesc: function(v) { return 'weight = isDiscNote[tid] + count[tid] + sqrt(count[tid]) + ' + v; },
        weight: function(nc, ctx, tid, v) {
            return ((ctx.isDiscNote && ctx.isDiscNote[tid]) || 0) + (nc[tid] || 0) + Math.sqrt(nc[tid] || 0) + v;
        }
    },
    { key: 'odncd', name: 'isDiscNote + ? + count / D', param: 'D',
        params: [1,10,25,50,100,150,200,225,250,275,300,325,350,375,400,425,450,475,500,600,750],
        makeKey: function(v) { return 'odncd' + ST._enc(v); },
        makeName: function(v) { return 'isDiscNote + ? + count / ' + v; },
        makeDesc: function(v) { return 'weight = isDiscNote[tid] + bestOdnK + count[tid] / ' + v + ' \u2014 odn best-K baseline with count/D'; },
        weight: function(nc, ctx, tid, v) {
            return ((ctx.isDiscNote && ctx.isDiscNote[tid]) || 0) + (nc[tid] || 0) / v + (ST._bestOdnK || 0);
        }
    },
    { key: 'odncsbd', name: 'isDiscNote + ? + (count - suppNotes) / D', param: 'D',
        params: [1,10,25,50,75,85,90,95,100,105,110,115,125,150,200,300,500],
        makeKey: function(v) { return 'odncsbd' + ST._enc(v); },
        makeName: function(v) { return 'isDiscNote + ? + (count - suppNotes) / ' + v; },
        makeDesc: function(v) { return 'weight = isDiscNote[tid] + bestOdnK + (count[tid] - startCountsBefore[tid]) / ' + v + ' - odn best-K baseline with count minus suppNotes/D'; },
        weight: function(nc, ctx, tid, v) {
            var suppNotes = (ctx.startCountsBefore && ctx.startCountsBefore[tid]) || 0;
            return ((ctx.isDiscNote && ctx.isDiscNote[tid]) || 0) + ((nc[tid] || 0) - suppNotes) / v + (ST._bestOdnK || 0);
        }
    },
    { key: 'odned', name: 'isDiscNote + ? + elemNote / D', param: 'D',
        params: ST._elemDParams,
        makeKey: function(v) { return 'odned' + ST._enc(v); },
        makeName: function(v) { return 'isDiscNote + ? + elemNote / ' + v; },
        makeDesc: function(v) { return 'weight = isDiscNote[tid] + bestOdnK + elemNote[tid] / ' + v; },
        weight: function(nc, ctx, tid, v) {
            return ((ctx.isDiscNote && ctx.isDiscNote[tid]) || 0) + (tid === ST.ELEMENT_ID ? 1 / v : 0) + (ST._bestOdnK || 0);
        }
    },
    { key: 'seed12', name: 'isDiscNote + ? + (seed1 + seed2) / D', param: 'D',
        params: ST._seedDParams,
        makeKey: function(v) { return 'seed12' + ST._enc(v); },
        makeName: function(v) { return 'isDiscNote + ? + (seed1 + seed2) / ' + v; },
        makeDesc: function(v) { return 'weight = isDiscNote[tid] + bestOdnK + 1/D for matching seed1 and seed2'; },
        weight: function(nc, ctx, tid, v) {
            return ((ctx.isDiscNote && ctx.isDiscNote[tid]) || 0) + (ST._bestOdnK || 0) + ST._seedBonus(ctx, 'seed', 2, tid) / v;
        }
    },
    { key: 'seed123', name: 'isDiscNote + ? + (seed1 + seed2 + seed3) / D', param: 'D',
        params: ST._seedDParams,
        makeKey: function(v) { return 'seed123' + ST._enc(v); },
        makeName: function(v) { return 'isDiscNote + ? + (seed1 + seed2 + seed3) / ' + v; },
        makeDesc: function(v) { return 'weight = isDiscNote[tid] + bestOdnK + 1/D for matching seed1, seed2, and seed3'; },
        weight: function(nc, ctx, tid, v) {
            return ((ctx.isDiscNote && ctx.isDiscNote[tid]) || 0) + (ST._bestOdnK || 0) + ST._seedBonus(ctx, 'seed', 3, tid) / v;
        }
    },
    { key: 'seed1234', name: 'isDiscNote + ? + (seed1 + seed2 + seed3 + seed4) / D', param: 'D',
        params: ST._seedDParams,
        makeKey: function(v) { return 'seed1234' + ST._enc(v); },
        makeName: function(v) { return 'isDiscNote + ? + (seed1 + seed2 + seed3 + seed4) / ' + v; },
        makeDesc: function(v) { return 'weight = isDiscNote[tid] + bestOdnK + 1/D for matching seed1 through seed4'; },
        weight: function(nc, ctx, tid, v) {
            return ((ctx.isDiscNote && ctx.isDiscNote[tid]) || 0) + (ST._bestOdnK || 0) + ST._seedBonus(ctx, 'seed', 4, tid) / v;
        }
    },
    { key: 'seed12345', name: 'isDiscNote + ? + (seed1 + seed2 + seed3 + seed4 + seed5) / D', param: 'D',
        params: ST._seedDParams,
        makeKey: function(v) { return 'seed12345' + ST._enc(v); },
        makeName: function(v) { return 'isDiscNote + ? + (seed1 + seed2 + seed3 + seed4 + seed5) / ' + v; },
        makeDesc: function(v) { return 'weight = isDiscNote[tid] + bestOdnK + 1/D for matching seed1 through seed5'; },
        weight: function(nc, ctx, tid, v) {
            return ((ctx.isDiscNote && ctx.isDiscNote[tid]) || 0) + (ST._bestOdnK || 0) + ST._seedBonus(ctx, 'seed', 5, tid) / v;
        }
    },
    { key: 'seed123456', name: 'isDiscNote + ? + (seed1 + ... + seed6) / D', param: 'D',
        params: ST._seedDParams,
        makeKey: function(v) { return 'seed123456' + ST._enc(v); },
        makeName: function(v) { return 'isDiscNote + ? + (seed1 + ... + seed6) / ' + v; },
        makeDesc: function(v) { return 'weight = isDiscNote[tid] + bestOdnK + 1/D for matching seed1 through seed6'; },
        weight: function(nc, ctx, tid, v) {
            return ((ctx.isDiscNote && ctx.isDiscNote[tid]) || 0) + (ST._bestOdnK || 0) + ST._seedBonus(ctx, 'seed', 6, tid) / v;
        }
    },
    { key: 'seed1234567', name: 'isDiscNote + ? + (seed1 + ... + seed7) / D', param: 'D',
        params: ST._seedDParams,
        makeKey: function(v) { return 'seed1234567' + ST._enc(v); },
        makeName: function(v) { return 'isDiscNote + ? + (seed1 + ... + seed7) / ' + v; },
        makeDesc: function(v) { return 'weight = isDiscNote[tid] + bestOdnK + 1/D for matching seed1 through seed7'; },
        weight: function(nc, ctx, tid, v) {
            return ((ctx.isDiscNote && ctx.isDiscNote[tid]) || 0) + (ST._bestOdnK || 0) + ST._seedBonus(ctx, 'seed', 7, tid) / v;
        }
    },
    { key: 'seed12345678', name: 'isDiscNote + ? + (seed1 + ... + seed8) / D', param: 'D',
        params: ST._seedDParams,
        makeKey: function(v) { return 'seed12345678' + ST._enc(v); },
        makeName: function(v) { return 'isDiscNote + ? + (seed1 + ... + seed8) / ' + v; },
        makeDesc: function(v) { return 'weight = isDiscNote[tid] + bestOdnK + 1/D for matching seed1 through seed8'; },
        weight: function(nc, ctx, tid, v) {
            return ((ctx.isDiscNote && ctx.isDiscNote[tid]) || 0) + (ST._bestOdnK || 0) + ST._seedBonus(ctx, 'seed', 8, tid) / v;
        }
    },
    { key: 'dynSeed1', name: 'isDiscNote + ? + dynSeed1 / D', param: 'D',
        params: ST._seedDParams,
        makeKey: function(v) { return 'dynSeed1' + ST._enc(v); },
        makeName: function(v) { return 'isDiscNote + ? + dynSeed1 / ' + v; },
        makeDesc: function(v) { return 'weight = isDiscNote[tid] + bestOdnK + 1/D for matching dynSeed1'; },
        weight: function(nc, ctx, tid, v) {
            return ((ctx.isDiscNote && ctx.isDiscNote[tid]) || 0) + (ST._bestOdnK || 0) + ST._seedBonus(ctx, 'dynSeed', 1, tid) / v;
        }
    },
    { key: 'dynSeed12', name: 'isDiscNote + ? + (dynSeed1 + dynSeed2) / D', param: 'D',
        params: ST._seedDParams,
        makeKey: function(v) { return 'dynSeed12' + ST._enc(v); },
        makeName: function(v) { return 'isDiscNote + ? + (dynSeed1 + dynSeed2) / ' + v; },
        makeDesc: function(v) { return 'weight = isDiscNote[tid] + bestOdnK + 1/D for matching dynSeed1 or dynSeed2'; },
        weight: function(nc, ctx, tid, v) {
            return ((ctx.isDiscNote && ctx.isDiscNote[tid]) || 0) + (ST._bestOdnK || 0) + ST._seedBonus(ctx, 'dynSeed', 2, tid) / v;
        }
    },
    { key: 'dynSeed123', name: 'isDiscNote + ? + (dynSeed1 + dynSeed2 + dynSeed3) / D', param: 'D',
        params: ST._seedDParams,
        makeKey: function(v) { return 'dynSeed123' + ST._enc(v); },
        makeName: function(v) { return 'isDiscNote + ? + (dynSeed1 + dynSeed2 + dynSeed3) / ' + v; },
        makeDesc: function(v) { return 'weight = isDiscNote[tid] + bestOdnK + 1/D for matching dynSeed1, dynSeed2, or dynSeed3'; },
        weight: function(nc, ctx, tid, v) {
            return ((ctx.isDiscNote && ctx.isDiscNote[tid]) || 0) + (ST._bestOdnK || 0) + ST._seedBonus(ctx, 'dynSeed', 3, tid) / v;
        }
    },
    { key: 'odnscd', name: 'isDiscNote + ? + \u221acount / D', param: 'D',
        params: [0.5,1,2,3,4,5,6,7,8,9,10,12,15,20,25,30,40,50,60,80,100,150,200,300,500],
        makeKey: function(v) { return 'odnscd' + ST._enc(v); },
        makeName: function(v) { return 'isDiscNote + ? + \u221acount / ' + v; },
        makeDesc: function(v) { return 'weight = isDiscNote[tid] + bestOdnK + sqrt(count[tid]) / ' + v + ' \u2014 odn best-K with sqrt(count)/D'; },
        weight: function(nc, ctx, tid, v) {
            return ((ctx.isDiscNote && ctx.isDiscNote[tid]) || 0) + Math.sqrt(nc[tid] || 0) / v + (ST._bestOdnK || 0);
        }
    },
    { key: 'odnmc', name: '(odn + 1) \u00b7 (1 + count / D)', param: 'D',
        params: [0.5,1,2,3,4,5,6,7,8,9,10,12,15,20,25,30,40,50,60,80,100,150,200,300,500],
        makeKey: function(v) { return 'odnmc' + ST._enc(v); },
        makeName: function(v) { return '(odn + 1) \u00b7 (1 + count / ' + v + ')'; },
        makeDesc: function(v) { return 'weight = (isDiscNote[tid] + 1) * (1 + count[tid] / ' + v + ') \u2014 multiplicative'; },
        weight: function(nc, ctx, tid, v) {
            var odn = (ctx.isDiscNote && ctx.isDiscNote[tid]) || 0;
            return (odn + 1) * (1 + (nc[tid] || 0) / v);
        }
    },
    { key: 'odncsd', name: 'isDiscNote + ? + odn \u00b7 suppNotes / D', param: 'D',
        params: [0.5,1,2,3,4,5,6,7,8,9,10,12,15,20,25,30,40,50,60,80,100,150,200,300,500],
        makeKey: function(v) { return 'odncsd' + ST._enc(v); },
        makeName: function(v) { return 'isDiscNote + ? + odn\u00b7suppNotes / ' + v; },
        makeDesc: function(v) { return 'weight = isDiscNote[tid] + bestOdnK + isDiscNote[tid] * startCountsBefore[tid] / ' + v + ' \u2014 odn + bestK + interaction with suppNotes/D'; },
        weight: function(nc, ctx, tid, v) {
            var odn = (ctx.isDiscNote && ctx.isDiscNote[tid]) || 0;
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
    { key: 'odnhn', name: 'isDiscNote + harmoniesNotes + K', param: 'K',
        params: [0.25,0.5,0.75,1,1.25,1.5,1.75,2,2.25,2.5,2.75,3,3.5,4,4.5,5,5.5,6,7,8,10,12,15,20,30],
        makeKey: function(v) { return 'odnhn' + ST._enc(v); },
        makeName: function(v) { return 'isDiscNote + harmoniesNotes + ' + v; },
        makeDesc: function(v) { return 'weight = isDiscNote[tid] + harmoniesNotes[tid] + ' + v; },
        weight: function(nc, ctx, tid, v) {
            return ((ctx.isDiscNote && ctx.isDiscNote[tid]) || 0)
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
    var nids = ST.NOTE_IDS;

    var observed = {};
    nids.forEach(function(tid) { observed[tid] = 0; });

    var ll = 0, total = 0, expected = {};
    nids.forEach(function(tid) { expected[tid] = 0; });

    var top1Correct = 0;
    var rankSum = 0;
    var calibPairs = [];

    ncEvents.forEach(function(e) {
        // One observation per base bundle (see ST.fitWeight): a 3-copy base
        // is one type draw; stack copies add no draw; event bundles expand.
        var w = ST.fitWeight(e);
        total += w;
        observed[e.tid] += w;
        var probs = ST.computeNoteProbs(e.context.noteCounts, modelKey, k, e.context);
        var p = Math.max(probs[e.tid] || 0, 1e-9);
        ll += Math.log(p) * w;

        var sorted = nids.slice().sort(function(a, b) { return (probs[b] || 0) - (probs[a] || 0); });
        if (sorted[0] === e.tid) top1Correct += w;
        rankSum += (sorted.indexOf(e.tid) + 1) * w;

        nids.forEach(function(tid) {
            expected[tid] += probs[tid] * w;
            var actual = tid === e.tid ? 1 : 0;
            for (var u = 0; u < w; u++) calibPairs.push({ pred: probs[tid], actual: actual });
        });
    });

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

    var meanRank = total === 0 ? 0 : rankSum / total;
    var top1Pct = total === 0 ? 0 : (top1Correct / total) * 100;

    if (total === 0) return null;

    return {
        logLik: ll, n: total,
        meanRank: meanRank, top1Pct: top1Pct, ece: ece, eceReliable: eceReliable,
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
ST._modelRowHidden = {};

ST.hideModelRow = function(key, button) {
    ST._modelRowHidden[key] = true;
    var row = button && button.closest ? button.closest('tr') : null;
    if (row) row.style.display = 'none';
};

ST.toggleModelGroup = function(gkey) {
    ST._modelGroupOpen[gkey] = !ST._modelGroupOpen[gkey];
    ST.renderNotes();
};

ST.buildModelComparison = function(events) {
    var ncEvents = events.filter(function(e) { return e.context && e.context.noteCounts; });
    if (ncEvents.length < 5) return '';

    var results = [];
    var bestCorrectP = -Infinity;
    var bestTop1 = -Infinity, bestRank = Infinity, bestEce = Infinity;
    var bestCorrectR = null;
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
        // Show actual bestK in best-K composite model names
        if (ST._usesBestOdnK(r.group) && ST._bestOdnK !== null) {
            r.name = r.name.replace('?', String(ST._bestOdnK));
            r.desc = r.desc.replace('bestOdnK', String(ST._bestOdnK));
        }
        if (r.correctP > bestCorrectP) { bestCorrectP = r.correctP; bestCorrectR = r; }
        if (r.top1Pct > bestTop1) { bestTop1 = r.top1Pct; bestTop1R = r; }
        if (r.meanRank < bestRank) { bestRank = r.meanRank; bestRankR = r; }
        if (r.eceReliable && r.ece < bestEce) { bestEce = r.ece; bestEceR = r; }
        results.push(r);
        if (!byGroup[r.group]) byGroup[r.group] = [];
        byGroup[r.group].push(r);
    });

    var selectedModel = ST.noteFilters.model || 'hn0_5';
    var totalRows = 0;

    var html = '<div class="chart-card"><h3>Model Comparison (' + ST.fitTotal(ncEvents) + ' base draws)</h3>' +
        '<div style="font-size:11px;color:#666;margin-bottom:8px;line-height:1.6">' +
            'Each group shows the <strong>best</strong> Correct P% model within its family. Click to expand and see all ' +
            'variations. Rows highlighted green = best overall across all groups for that metric.<br>' +
            'One observation per base bundle (a 3-copy base = 1 type draw); stack copies add no draw and ' +
            'off-grammar packets are excluded. Correct P%: geometric-mean probability assigned to the dropped note (higher = better) &middot; ' +
            'Top-1%: fraction where model\'s favorite won &middot; ' +
            'Mean Rank: avg rank model assigned to the dropped note &middot; ' +
            'Avg Error: calibration error as a percentage (10 equal-mass bins, "—" if fewer than 100 prediction pairs)' +
        '</div>' +
        '<div style="font-size:10px;color:#555;margin-bottom:8px;line-height:1.5">' +
            'Terms: <strong>harmoniesNotes</strong> = total harmony material copies needed across your 3 equipped discs &middot; ' +
            '<strong>discsNotes</strong> = how many of your 3 discs feature this note (0\u20133) &middot; ' +
            '<strong>isDiscNote</strong> = whether this note appears on any equipped disc (0/1) &middot; ' +
            '<strong>count</strong> = how many of this note type you own before the drop &middot; ' +
            '<strong>suppNotes</strong> = startCountsBefore (support discs you brought into the run) &middot; ' +
            '<strong>K, D</strong> = model parameters varied within the group' +
        '</div>' +
        '<table class="data-table"><tr><th></th><th></th><th>Model</th><th class="pct">Correct P%</th><th class="pct">Top-1%</th><th class="num">Mean Rank</th><th class="pct">Avg Error</th></tr>';

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
        var top1Style = best === bestTop1R ? ' style="color:#9aba8a"' : '';
        var rankStyle = best === bestRankR ? ' style="color:#9aba8a"' : '';
        var eceStyle = best === bestEceR ? ' style="color:#9aba8a"' : '';
        var eceCell = best.eceReliable ? (best.ece * 100).toFixed(2) + '%' : '—';

        var countLabel = grpResults.length > 1 ? ' <span style="font-size:9px;color:#555">(' + grpResults.length + ')</span>' : '';
        var groupName = groupDef.name;
        if (ST._usesBestOdnK(gkey) && ST._bestOdnK !== null) {
            groupName = groupName.replace('?', String(ST._bestOdnK));
        }

        if (!ST._modelRowHidden['group:' + gkey]) html += '<tr class="mg-header" onclick="ST.toggleModelGroup(\'' + gkey + '\')" data-mg="' + gkey + '"' + headerStyle + '>' +
            '<td><button type="button" title="Hide row" onclick="event.stopPropagation();ST.hideModelRow(\'group:' + gkey + '\',this)" style="font-size:10px;padding:0 4px;cursor:pointer">x</button></td>' +
            '<td class="expand-btn" style="font-size:10px">' + toggleArrow + '</td>' +
            '<td><span style="font-weight:500">' + groupName + '</span>' + countLabel + '<br><span style="font-size:9px;color:#555">' + best.name + '</span></td>' +
            '<td class="pct"' + correctStyle + '>' + best.correctP.toFixed(2) + '%</td>' +
            '<td class="pct"' + top1Style + '>' + best.top1Pct.toFixed(1) + '%</td>' +
            '<td class="num"' + rankStyle + '>' + best.meanRank.toFixed(2) + '</td>' +
            '<td class="num"' + eceStyle + '>' + eceCell + '</td>' +
            '</tr>';

        // Detail rows (all variations in the group)
        // Sort by name for easy scanning; group header still shows best Correct P%
        var sortedInGroup = grpResults.slice().sort(function(a, b) { return (a.param || 0) - (b.param || 0); });
        var subRows = '';
        sortedInGroup.forEach(function(r) {
            var isSubSelected = r.key === selectedModel;
            var selStyle = isSubSelected ? ' style="border-left:2px solid #7aba7a;background:#2a2a2a"' : '';
            var click = ' onclick="ST.selectModel(\'' + r.key + '\')"';

            var sc = r === bestCorrectR ? ' style="color:#9aba8a"' : '';
            var st = r === bestTop1R ? ' style="color:#9aba8a"' : '';
            var sr = r === bestRankR ? ' style="color:#9aba8a"' : '';
            var se = r === bestEceR ? ' style="color:#9aba8a"' : '';
            var ec = r.eceReliable ? (r.ece * 100).toFixed(2) + '%' : '—';

            if (ST._modelRowHidden[r.key]) return;
            subRows += '<tr' + selStyle + click + '>' +
                '<td><button type="button" title="Hide row" onclick="event.stopPropagation();ST.hideModelRow(\'' + r.key + '\',this)" style="font-size:10px;padding:0 4px;cursor:pointer">x</button></td>' +
                '<td></td>' +
                '<td style="padding-left:20px;font-size:11px">' + r.name + '<br><span style="font-size:9px;color:#555">' + r.desc + '</span></td>' +
                '<td class="pct"' + sc + '>' + r.correctP.toFixed(2) + '%</td>' +
                 '<td class="pct"' + st + '>' + r.top1Pct.toFixed(1) + '%</td>' +
                '<td class="num"' + sr + '>' + r.meanRank.toFixed(2) + '</td>' +
                 '<td class="num"' + se + '>' + ec + '</td></tr>';
        });

         html += '<tr class="mg-detail" data-mg="' + gkey + '"' + displayStyle + '><td colspan="7" style="padding:0">' +
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
        var w = ST.fitWeight(e);

        var tid = e.tid;
        drops[tid] += w;
        sumP[tid] += probs[tid] * w;
        sumRank[tid] += (sorted.indexOf(tid) + 1) * w;
        if (top3.indexOf(tid) !== -1) top3Count[tid] += w;
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

    return '<div class="chart-card"><h3>Per-Note Model Performance (' + modelName + ', ' + ST.fitTotal(ncEvents) + ' base draws)</h3>' +
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
        if (rankCounts[rank] !== undefined) rankCounts[rank] += ST.fitWeight(e);
    });

    var rollsTotal = ST.fitTotal(ncEvents);
    var rows = '', cum = 0;
    for (var r = 1; r <= nRanks; r++) {
        cum += rankCounts[r];
        var pct = (rankCounts[r] / rollsTotal * 100).toFixed(1);
        var cumPct = (cum / rollsTotal * 100).toFixed(1);
        rows += '<tr><td class="num">' + r + '</td><td class="num">' + rankCounts[r] + '</td><td class="pct">' + pct + '%</td><td class="pct">' + cumPct + '%</td></tr>';
    }

    var top1Pct = (rankCounts[1] / rollsTotal * 100).toFixed(1);
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
        var w = ST.fitWeight(e);
        var xCount = e.context.noteCounts[tid] || 0;
        var key;
        if (xCount === 0) key = '0';
        else if (xCount <= 2) key = '1-2';
        else if (xCount <= 5) key = '3-5';
        else if (xCount <= 10) key = '6-10';
        else if (xCount <= 20) key = '11-20';
        else key = '21+';

        buckets[key].events += w;
        if (e.tid === tid) buckets[key].xDropped += w;
        var probs = ST.computeNoteProbs(e.context.noteCounts, modelKey, k, e.context);
        buckets[key].sumProb += probs[tid] * w;
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
        var ll = 0, rolls = 0;
        bucketEvents.forEach(function(e) {
        var probs = ST.computeNoteProbs(e.context.noteCounts, modelKey, k, e.context);
        var p = Math.max(probs[e.tid] || 0, 1e-9);
        var w = ST.fitWeight(e);
        rolls += w;
        ll += Math.log(p) * w;
        });
        var avgP = Math.exp(ll / rolls);
        var avgDelta = (ll / rolls) - Math.log(uniformP);
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
    var nc = events.filter(function(e) { return e.context && e.context.noteCounts; });
    var grants = ST.stackGrants(nc);
    var floors = 0, maxRun = 0;
    var perRun = {};
    nc.forEach(function(e) {
        var s = ST.stackWeight(e);
        if (s > 0) {
            floors++;
            perRun[e.runId] = (perRun[e.runId] || 0) + s;
        }
    });
    Object.keys(perRun).forEach(function(r) { if (perRun[r] > maxRun) maxRun = perRun[r]; });
    var nRuns = Object.keys(perRun).length;
    return '<div class="chart-card"><h3>Stack Triggers (Note of Surprise III)</h3>' +
        '<div style="font-size:11px;color:#555;margin-bottom:8px">Stacks add +6 copies to a base bundle without a new type draw, ' +
        'so stack grants are excluded from the weight fit above (their base still counts its 1 draw). ' +
        'Theory cap is 4 triggers per run (+1 possible on Floor 0).</div>' +
        'Stack grants: ' + grants + ' on ' + floors + ' gain entries across ' + nRuns + ' runs' +
        ' (max ' + maxRun + ' in one run)</div>';
};

ST.buildLLMData = function(events) {
    var ncEvents = events.filter(function(e) { return e.context && e.context.noteCounts; });
    if (ncEvents.length === 0) return '';

    var nids = ST.NOTE_IDS;
    var label = {};
    nids.forEach(function(tid, i) { label[tid] = (i + 1) + '=' + ST.noteName(tid); });
    var labels = nids.map(function(tid, i) { return (i + 1) + '=' + ST.noteName(tid); }).join(', ');

    var ndigits = String(ST.fitTotal(ncEvents)).length;
    var lines = [];
    lines.push('=== DATA DESCRIPTION ===');
    lines.push('');
    lines.push('Below are note base-draws from "Star Tower" (a .hack//G.U. derivative).');
    lines.push('Floor income arrives in base bundles of 3 copies of one rolled type;');
    lines.push('each base is one draw (one line), no matter its copy count. Stack');
    lines.push('grants (+6 copies on a base, no new type draw) are excluded, as are');
    lines.push('off-grammar packets. Event "random note xN" bundles expand one line');
    lines.push('per unit. Note mapping: ' + labels);
    lines.push('');
    lines.push('Each event also has harmoniesNotes, discsNotes, isDiscNote, startCountsBefore, and startCountsAfter in its context:');
    lines.push('- harmoniesNotes = harmony material copies needed across your 3 equipped discs (from NeedSubNoteSkills)');
    lines.push('- discsNotes = how many of your 3 discs feature this note in their secondary skills (0-3)');
    lines.push('- isDiscNote = 1 if this note appears on any equipped disc, 0 otherwise');
    lines.push('- startCountsBefore = support discs (bag before start.infos)');
    lines.push('- startCountsAfter = support discs + free start.infos (total count at run start)');
    lines.push('These are the same for all events in a run.');
    lines.push('');
    lines.push('Format per event:');
    lines.push('  Event# Floor Source [count1 count2 ...] Won');
    lines.push('');
    lines.push('=== EVENTS ===');
    lines.push('');

    var lineNo = 0;
    ncEvents.forEach(function(e) {
        var cnts = nids.map(function(tid) { return e.context.noteCounts[tid] || 0; });
        var won = nids.indexOf(e.tid) + 1;
        var fl = e.floor !== undefined ? 'F' + e.floor : 'F?';
        var src = e.source || '?';
        var line =
            fl.padEnd(4) + ' ' +
            src.padEnd(7) + ' [' + cnts.join(' ') + '] ' + won;
        var w = ST.fitWeight(e);
        for (var u = 0; u < w; u++) {
            lineNo++;
            lines.push(
                String(lineNo).padStart(ndigits) + ' ' + line
            );
        }
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
    lines.push('Events: ' + ncEvents.length + ' (' + ST.fitTotal(ncEvents) + ' base draws, ' + ST.stackGrants(ncEvents) + ' stack grants excluded) | Notes: ' + nids.length + ' (' + labels + ')');

    var text = lines.join('\n');
    var escText = text.replace(/`/g, '\\`').replace(/\$/g, '\\$').replace(/\\/g, '\\\\');

    return '<div class="chart-card"><h3>LLM Data Export</h3>' +
        '<div style="margin-bottom:8px;display:flex;gap:6px;align-items:center">' +
        '<button class="note-src-btn" onclick="' +
        "var t=document.getElementById('llmDataPre');" +
        "navigator.clipboard.writeText(t.textContent).then(function(){t.style.outline='2px solid #5a8';setTimeout(function(){t.style.outline='none'},800)})" +
        '">Copy to Clipboard</button>' +
        '<span style="font-size:10px;color:#555">' + ST.fitTotal(ncEvents) + ' base draws (' + ncEvents.length + ' gain entries, filtered)</span></div>' +
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

ST.buildPerRunNotes = function(events, floorFilter, minFloor) {
    if (!ST.runs || ST.runs.length === 0) return '';
    var odnFilter = ST.noteFilters.odn || 0;
    var towerFilter = ST.noteFilters.tower || 0;
    var rows = '';
    ST.runs.slice().reverse().forEach(function(run) {
        if (floorFilter > 0 && run.floorReached !== floorFilter) return;
        if (minFloor > 0 && run.floorReached < minFloor) return;
        var towerId = ST.runTowerId(run);
        if (towerFilter > 0 && towerId !== towerFilter) return;
        var odn = ST.runOdnSize(run);
        if (odnFilter > 0 && odn !== odnFilter) return;
        var runEvents = events.filter(function(e) { return e.runId === run.id && e.context; });
        var totalQty = 0, correctQty = 0;
        runEvents.forEach(function(e) {
            var qty = Math.max(0, e.qty || 0);
            totalQty += qty;
            if (e.context.isDiscNote && e.context.isDiscNote[e.tid]) correctQty += qty;
        });
        var correctPct = totalQty > 0 ? (correctQty / totalQty * 100).toFixed(1) + '%' : '—';
        var chars = (run.start && run.start.data && run.start.data.chars) || [];
        var charHtml = '';
        chars.forEach(function(c) {
            if (c && c.id) charHtml += '<img loading="lazy" src="' + ST.charPortrait(c.id) + '" class="portrait-sm" title="' + ST.charName(c.id) + '" onerror="this.style.display=\'none\'">';
        });
        if (!charHtml) charHtml = '<span style="color:#555">—</span>';
        // Allowed element drops: tower pool narrowed to the lead char's
        // element when applicable (bold = lead lock, single element).
        var allowedEff = (typeof ST.runAllowedElements === 'function') ? ST.runAllowedElements(run) : (run._allowedElements || null);
        var elemCell = '<span style="color:#555">—</span>';
        if (allowedEff && allowedEff.length > 0) {
            var leadTid = (typeof ST.leadElementTid === 'function') ? ST.leadElementTid(run) : (run._leadElementTid || null);
            elemCell = allowedEff.map(function(tid) {
                var nm = (ST.ELEMENT_SHORT && ST.ELEMENT_SHORT[tid]) || String(tid);
                return (tid === leadTid && allowedEff.length === 1) ? '<strong>' + nm + '</strong>' : nm;
            }).join(' / ');
        }
        rows += '<tr><td>' + (towerId || '—') + '</td>' +
            '<td>' + elemCell + '</td>' +
            '<td><div class="char-cell">' + charHtml + '</div></td>' +
            '<td class="num">' + (run.floorReached != null ? run.floorReached : '—') + '</td>' +
            '<td class="num">' + (run.potentialCnt || 0) + '</td>' +
            '<td class="num">' + odn + '</td>' +
            '<td class="pct">' + correctPct + '</td></tr>';
    });
    return '<div class="chart-card"><h3>Overall Disc Notes by Run</h3>' +
        '<div style="margin-bottom:8px;font-size:11px">' +
        '<label>Minimum ended floor: <input type="number" min="0" step="1" value="' + (minFloor || '') + '" onchange="ST.noteFilters.runMinFloor=parseInt(this.value)||0;ST.renderNotes()" style="width:70px;margin-left:4px"></label>' +
        '</div>' +
        '<div style="font-size:11px;color:#666;margin-bottom:8px">TDN = amount of different <em>droppable</em> notes needed by your 3 equipped discs (tower pool narrowed to the lead char\'s element when applicable; needs that can never drop are excluded). Elem = allowed element drops for the run (bold = locked to lead char). Correct % = filtered note quantity whose type appears on any equipped disc.</div>' +
        '<table class="data-table"><tr><th>Tower</th><th>Elem</th><th>Characters</th><th class="num">Floor</th><th class="num">Potentials</th><th class="num">TDN</th><th class="pct">Correct %</th></tr>' + rows + '</table></div>';
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
        // The event button only ever passes RNG-rolled event drops —
        // player-chosen note picks are excluded in the filter below.
        var label = src === 'event' ? 'RNG event' : src.charAt(0).toUpperCase() + src.slice(1);
        var title = src === 'event' ? ' title="Only RNG-based event drops (10708, 10808, 114xx quiz, 1200x, 12702); player-chosen notes excluded"' : '';
        srcHtml += '<button class="note-src-btn' + active + '"' + title + ' onclick="ST.toggleNoteSource(\'' + src + '\')">' + label + '</button>';
    });

    var nameLabel = '<span style="margin-left:14px;font-size:11px;color:#555">model: ' + modelName + '</span>';
    var runFloors = {};
    ST.runs.forEach(function(run) { if (run.floorReached != null) runFloors[run.floorReached] = true; });
    var runFloorOpts = '<option value="0">All End Floors</option>';
    Object.keys(runFloors).map(Number).sort(function(a, b) { return a - b; }).forEach(function(floor) {
        runFloorOpts += '<option value="' + floor + '"' + (ST.noteFilters.runFloor === floor ? ' selected' : '') + '>Ended at Floor ' + floor + '</option>';
    });

    var events = ST.allNoteEvents || [];

    // Split floor packets into base draws / stack grants on the UNFILTERED
    // list (filters can split a floor's packet and would fake quarantines).
    var decompStats = ST.decomposeNoteEntries(events);

    var runOdnById = {};
    var odnValuesSeen = {};
    var runTowerById = {};
    var towerCounts = {};
    (ST.runs || []).forEach(function(run) {
        var n = ST.runOdnSize(run);
        runOdnById[run.id] = n;
        odnValuesSeen[n] = true;
        var t = ST.runTowerId(run);
        runTowerById[run.id] = t;
        if (t != null) towerCounts[t] = (towerCounts[t] || 0) + 1;
    });
    var odnValues = Object.keys(odnValuesSeen).map(Number).sort(function(a, b) { return a - b; });
    if (ST.noteFilters.odn > 0 && odnValues.indexOf(ST.noteFilters.odn) < 0) ST.noteFilters.odn = 0;
    var odnOpts = '<option value="0">All TDN</option>';
    odnValues.forEach(function(n) {
        odnOpts += '<option value="' + n + '"' + (ST.noteFilters.odn === n ? ' selected' : '') + '>' + n + ' TDN</option>';
    });
    var towerIds = Object.keys(towerCounts).map(Number).sort(function(a, b) { return a - b; });
    if (ST.noteFilters.tower > 0 && towerCounts[ST.noteFilters.tower] === undefined) ST.noteFilters.tower = 0;
    var towerOpts = '<option value="0">All Towers</option>';
    towerIds.forEach(function(t) {
        towerOpts += '<option value="' + t + '"' + (ST.noteFilters.tower === t ? ' selected' : '') + '>Tower ' + t + ' (' + towerCounts[t] + ')</option>';
    });

    var activeSourcesList = ST.noteFilters.sources || {};
    var srcKeys = Object.keys(activeSourcesList);
    var hasActiveSources = srcKeys.length > 0 && srcKeys.some(function(s) { return activeSourcesList[s]; });

    var filtered = events.filter(function(e) {
        if (ST.noteFilters.note > 0 && e.tid !== ST.noteFilters.note) return false;
        if (hasActiveSources && !activeSourcesList[e.source]) return false;
        // The event source only passes RNG-rolled drops: exclude gains from
        // player-chosen note options (1070x/1080x). Unattributed drops are kept.
        if (e.source === 'event' && typeof ST.isChosenEventNote === 'function' && ST.isChosenEventNote(e)) return false;
        if (ST.noteFilters.stack === 'stack' && !e.isStack) return false;
        if (ST.noteFilters.stack === 'base' && e.isStack) return false;
        if (ST.noteFilters.odn > 0 && runOdnById[e.runId] !== ST.noteFilters.odn) return false;
        if (ST.noteFilters.tower > 0 && runTowerById[e.runId] !== ST.noteFilters.tower) return false;
        return true;
    });

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
        '<select onchange="ST.noteFilters.runFloor=parseInt(this.value);ST.renderNotes()" style="margin-left:8px">' + runFloorOpts + '</select>' +
        '<select onchange="ST.noteFilters.tower=parseInt(this.value)||0;ST.renderNotes()" style="margin-left:8px" title="Filter runs by tower (each tower drops base notes plus its own 2 elements)">' + towerOpts + '</select>' +
        '<select onchange="ST.noteFilters.odn=parseInt(this.value)||0;ST.renderNotes()" style="margin-left:8px" title="Filter runs by amount of different droppable notes needed by equipped discs (tower pool narrowed to lead char element when applicable)">' + odnOpts + '</select>' +
        '<span>' + sliderHtml + '</span>' +
        '</div><div class="scroll-panel" id="noteContent"></div>';

    // Save scroll position before DOM rebuild
    var content = document.getElementById('noteContent');
    var savedScroll = content ? content.scrollTop : 0;

    panel.innerHTML = html;

    content = document.getElementById('noteContent');
    if (!content) return;

    var ncEvents = filtered.filter(function(e) { return e.context && e.context.noteCounts; });

    var fDraws = ST.fitTotal(ncEvents);
    var fStacks = ST.stackGrants(ncEvents);
    var fQuar = ncEvents.filter(function(e) { return e._quarantined; }).length;
    var out = '<div style="padding:12px 0;font-size:12px;color:#666;">' + ncEvents.length + ' gain entries' +
        ' (' + fDraws + ' base draws' +
        (fStacks > 0 ? ', ' + fStacks + ' stack grants excluded' : '') +
        (fQuar > 0 ? ', ' + fQuar + ' quarantined' : '') +
        ')' +
        (decompStats.quarantinedFloors > 0 ? ' — ' + decompStats.quarantinedFloors + ' off-grammar floor packets (all runs)' : '') +
        '</div>';

    var sections = [];
    sections.push(ST.buildModelComparison(filtered));
    sections.push(ST.buildPerRunNotes(filtered, ST.noteFilters.runFloor, ST.noteFilters.runMinFloor));
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
