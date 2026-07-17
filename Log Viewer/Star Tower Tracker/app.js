// app.js — Core data loading, log parsing, state tracking, tab switching

window.ST = window.ST || {};

// ── Data stores ──
ST.charNames = {};
ST.noteNames = {};
ST.characterData = {}; // charId -> { id, name, portrait }
ST.runs = [];
ST.allPotentialEvents = [];
ST.allNoteEvents = [];
ST.allEventRng = [];
ST.allShopOffers = [];
ST.allShopItems = [];
ST.allFloorEvents = [];
ST.allStrengthenEvents = [];

// ── Constants ──
ST.NOTE_IDS = [90011, 90012, 90013, 90014, 90015, 90016, 90017, 90018];
ST.ELEMENT_DMG_NOTES = [90018, 90019, 90020, 90021, 90022, 90023];
ST.ELEMENT_ID = 90018;
ST._ele = function(tid) { return ST.ELEMENT_DMG_NOTES.indexOf(tid) >= 0 ? ST.ELEMENT_ID : tid; };
ST._collapseNoteCounts = function(counts) {
    var out = Object.assign({}, counts);
    var sum = 0;
    ST.ELEMENT_DMG_NOTES.forEach(function(eid) {
        if (out[eid]) { sum += out[eid]; delete out[eid]; }
    });
    if (sum > 0) out[ST.ELEMENT_ID] = (out[ST.ELEMENT_ID] || 0) + sum;
    return out;
};
ST.ROOM_NAMES = ['Battle','Elite','Boss','Final Boss','Danger','Horror','Shop','Event','','','','','','','','Unify'];

ST.charPortrait = function(charId) {
    return `https://raw.githubusercontent.com/AutumnVN/ssassets/main/export/assets/assetbundles/icon/head/head_${charId}02_XXL.webp`;
};

ST.isNote = function(tid) { return tid >= 90011 && tid <= 90023; };
ST.isPotential = function(tid) { return String(tid)[0] === '5'; };

ST.decodePotentialId = function(tid) {
    var s = String(tid);
    if (s.length < 5 || s[0] !== '5') return null;
    return { charId: parseInt(s.slice(1, 4)), index: parseInt(s.slice(4)) };
};

ST.noteName = function(tid) { 
    if (tid === ST.ELEMENT_ID) return 'Element';
    return ST.noteNames[tid] || ('Note ' + tid); 
};
ST.charName = function(charId) { return ST.charNames[charId] || ('Char ' + charId); };

ST.roomTypeSource = function(rt) {
    if (rt === 0) return 'battle';
    if (rt === 1) return 'elite';
    if (rt === 2 || rt === 3) return 'boss';
    if (rt === 6) return 'shop';
    if (rt === 7) return 'event';
    return 'other';
};

ST.detectStacks = function(infos) {
    if (!infos || infos.length === 0) return [];
    var total = 0;
    infos.forEach(function(i) { total += i.qty; });
    var results = [];
    infos.forEach(function(i) {
        results.push({
            tid: i.tid, qty: i.qty, lucky: i.luckyLevel || 0, new: i.new,
            isStack: (i.qty >= 9 && total === 9),
            isBase: (i.qty >= 3),
        });
    });
    return results;
};

// ── Data loading ──

ST.fetchCharNames = function() {
    return fetch('https://raw.githubusercontent.com/AutumnVN/StellaSoraData/refs/heads/main/EN/language/en_US/Character.json')
        .then(function(r) { return r.json(); })
        .then(function(data) {
            ST.charNames = {};
            for (var key in data) {
                var m = key.match(/^Character\.(\d+)\.1$/);
                if (m) ST.charNames[parseInt(m[1])] = data[key];
            }
            document.getElementById('dataStatus').textContent = Object.keys(ST.charNames).length + ' chars';
            document.getElementById('dataStatus').style.color = '#4a6a4a';
        })
        .catch(function(err) {
            document.getElementById('dataStatus').textContent = 'char data failed';
            document.getElementById('dataStatus').style.color = '#7a3a3a';
        });
};

ST.fetchNoteNames = function() {
    return fetch('https://raw.githubusercontent.com/AutumnVN/StellaSoraData/refs/heads/main/EN/language/en_US/Item.json')
        .then(function(r) { return r.json(); })
        .then(function(data) {
            ST.noteNames = {};
            ST.NOTE_IDS.forEach(function(tid) {
                var key = 'Item.' + tid + '.1';
                if (data[key]) ST.noteNames[tid] = data[key];
            });
        });
};

ST.fetchDiscData = function() {
    return fetch('https://raw.githubusercontent.com/AutumnVN/StellaSoraData/refs/heads/main/EN/bin/Disc.json')
        .then(function(r) { return r.json(); })
        .then(function(discData) {
            return fetch('https://raw.githubusercontent.com/AutumnVN/StellaSoraData/refs/heads/main/EN/bin/SecondarySkill.json')
                .then(function(r) { return r.json(); })
                .then(function(secData) {
                    ST._buildDiscNoteLookup(discData, secData);
                });
        })
        .catch(function(err) {
            console.error('disc data failed', err);
        });
};

ST._buildDiscNoteLookup = function(discData, secData) {
    ST.discNoteNeeds = {};
    for (var discId in discData) {
        var disc = discData[discId];
        var notes = {};
        var harmonyCounts = {};
        [disc.SecondarySkillGroupId1, disc.SecondarySkillGroupId2].forEach(function(groupId) {
            if (!groupId) return;
            var key = String(groupId) + '01';
            var secSkill = secData[key];
            if (!secSkill || !secSkill.NeedSubNoteSkills) return;
            var needed = JSON.parse(secSkill.NeedSubNoteSkills);
            for (var noteId in needed) {
                notes[noteId] = true;
                harmonyCounts[noteId] = (harmonyCounts[noteId] || 0) + 1;
            }
        });
        ST.discNoteNeeds[discId] = {
            notes: Object.keys(notes),
            harmonyCounts: harmonyCounts,
        };
    }
    console.log('discNoteNeeds loaded: ' + Object.keys(ST.discNoteNeeds).length + ' discs');
};

// ── Log parsing ──

ST.parseLog = function(text) {
    var lines = text.split('\n');
    var events = [];

    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line || line.startsWith('===')) continue;

        var space = line.indexOf(' ');
        if (space < 0) continue;

        var prefix = line.substring(0, space);
        var jsonStr = line.substring(space + 1);

        try {
            var data = JSON.parse(jsonStr);
        } catch(e) {
            continue;
        }

        events.push({ type: prefix, data: data, index: i });
    }

    return events;
};

// ── State tracking ──

ST.processRuns = function(events) {
    ST.runs = [];
    ST.allPotentialEvents = [];
    ST.allNoteEvents = [];
    ST.allEventRng = [];
    ST.allShopOffers = [];
ST.allShopItems = [];
    ST.allFloorEvents = [];
    ST.allStrengthenEvents = [];
 
     var currentRun = null;
    var runIdx = 0;

    for (var i = 0; i < events.length; i++) {
        var ev = events[i];

        if (ev.type === 'RUN') {
            if (currentRun && !currentRun.end) {
                // State update mid-run — don't fragment
            } else {
                currentRun = { id: runIdx++, start: ev, events: [], end: null };
                ST.runs.push(currentRun);
            }
        } else if (ev.type === 'END') {
            if (currentRun) currentRun.end = ev;
        } else if (currentRun) {
            currentRun.events.push(ev);
            // settle sub-message means the run ended (won tower) — no GiveUpResp follows
            if (ev.type === 'RECV' && ev.data && ev.data.action === 'settle') {
                currentRun.end = ev;
                currentRun = null;
            }
        }
    }

    for (var r = 0; r < ST.runs.length; r++) {
        ST._processRun(ST.runs[r], r);
    }

    ST._rebuildFilters();
};

ST._processRun = function(run, runIdx) {
    var start = run.start.data;

    // Compute disc note need counts from first 3 disc IDs
    run._harmoniesNotes = {};
    run._discsNotes = {};
    run._overallDiscNotes = {};
    [0, 1, 2].forEach(function(i) {
        var discId = start.discs && start.discs[i] ? String(start.discs[i].id) : null;
        if (!discId) return;
        var need = ST.discNoteNeeds && ST.discNoteNeeds[discId];
        if (!need) return;
        for (var noteId in need.harmonyCounts) {
            run._harmoniesNotes[noteId] = (run._harmoniesNotes[noteId] || 0) + need.harmonyCounts[noteId];
        }
        need.notes.forEach(function(noteId) {
            run._discsNotes[noteId] = (run._discsNotes[noteId] || 0) + 1;
            run._overallDiscNotes[noteId] = 1;
        });
    });

    var state = {
        floor: start.floor || 1,
        roomType: start.roomType || 0,
        teamLevel: start.teamLevel || 1,
        chars: (start.chars || []).map(function(c) {
            return { id: c.id, level: c.level, advance: c.advance, affinityLevel: c.affinityLevel, name: ST.charName(c.id) };
        }),
        bag: { notes: {}, potentials: {}, res: {}, secondaries: (start.activeSecondaryIds || []).slice() },
        towerId: start.towerId,
    };

    // Init bag from RUN info
    var info = start.info || {};
    var bag = info.bag || {};
    (bag.items || []).forEach(function(it) {
        if (ST.isNote(it.tid)) state.bag.notes[it.tid] = (state.bag.notes[it.tid] || 0) + Math.max(0, it.qty);
    });
    (bag.potentials || []).forEach(function(p) {
        state.bag.potentials[p.tid] = p.level;
    });
    (bag.res || []).forEach(function(r) {
        state.bag.res[r.tid] = (state.bag.res[r.tid] || 0) + Math.max(0, r.qty);
        if (ST.isNote(r.tid)) {
            state.bag.notes[r.tid] = (state.bag.notes[r.tid] || 0) + Math.max(0, r.qty);
        }
    });

    // Capture start-of-run note counts (after bag init, before start.infos subtraction)
    run._startCountsAfter = ST._collapseNoteCounts(state.bag.notes);

    // Process start-of-run note grants from RUN event's infos
    // bag.res already includes these, so subtract to get the "before" state
    var startNoteGains = [];
    (start.infos || []).forEach(function(info) {
        if (ST.isNote(info.tid)) {
            var qty = Math.max(0, info.qty || 0);
            if (qty > 0) {
                var effectiveTid = ST._ele(info.tid);
                var before;
                if (effectiveTid !== info.tid) {
                    // Element note: before = collapsed element total - qty
                    var collapsed = ST._collapseNoteCounts(state.bag.notes);
                    before = Math.max(0, (collapsed[effectiveTid] || 0) - qty);
                } else {
                    before = Math.max(0, (state.bag.notes[info.tid] || 0) - qty);
                }
                startNoteGains.push({ tid: effectiveTid, qty: qty, before: before, isNew: before === 0 });
            }
        }
    });

    run._startCountsBefore = ST._collapseNoteCounts(state.bag.notes);
    if (startNoteGains.length > 0) {
        var startNoteCountsBefore = ST._collapseNoteCounts(state.bag.notes);
        startNoteGains.forEach(function(g) { startNoteCountsBefore[g.tid] = g.before; });
        run._startCountsBefore = JSON.parse(JSON.stringify(startNoteCountsBefore));
        var startTotalBefore = 0;
        Object.keys(startNoteCountsBefore).forEach(function(k) { startTotalBefore += startNoteCountsBefore[k]; });

        startNoteGains.forEach(function(g) {
            ST.allNoteEvents.push({
                runId: run.id,
                floor: start.floor || 1,
                roomType: start.roomType || 0,
                source: 'start',
                action: 'run',
                tid: g.tid,
                qty: g.qty,
                lucky: 0,
                isNew: g.isNew,
                isStack: false,
                context: {
                    sameNoteBefore: g.before,
                    totalNotesBefore: startTotalBefore,
                    teamLevel: start.teamLevel || 1,
                    noteCounts: startNoteCountsBefore,
                    startCountsBefore: run._startCountsBefore,
                    startCountsAfter: run._startCountsAfter,
                    harmoniesNotes: run._harmoniesNotes,
                    discsNotes: run._discsNotes,
                    overallDiscNotes: run._overallDiscNotes,
                },
            });
        });
    }

    // Process initial room cases from RUN
    var pendingNpcEvents = {};
    var initCases = (start.info && start.info.room && start.info.room.cases) ? start.info.room.cases : [];
    if (initCases.length > 0) {
        ST._processCases(run, state, pendingNpcEvents, initCases);
    }
    // Walk through timeline
    for (var i = 0; i < run.events.length; i++) {
        ST._processEvent(run, run.events[i], state, pendingNpcEvents);
    }

    // Summary from END (must run AFTER events loop so state is fully built)
    if (run.end) {
        if (run.end.data.action === 'settle' && run.end.data.settle) {
            var s = run.end.data.settle;
            run.floorReached = state.floor;
            run.potentialCnt = s.build && s.build.detail && s.build.detail.potentials
                ? s.build.detail.potentials.reduce(function(sum, p) { return sum + p.level; }, 0) : 0;
            run.totalTime = null;
            run.npcInteraction = s.npcInteraction || 0;
        } else {
            run.floorReached = run.end.data.floor || state.floor;
            run.potentialCnt = run.end.data.potentialCnt || 0;
            run.totalTime = run.end.data.totalTime || 0;
            run.npcInteraction = run.end.data.npcInteraction || 0;
        }
    } else {
        run.floorReached = state.floor;
        run.potentialCnt = Object.keys(state.bag.potentials).reduce(function(sum, tid) { return sum + state.bag.potentials[tid]; }, 0);
        run.totalTime = 0;
        run.npcInteraction = 0;
    }

    // Flush unresolved
    for (var caseId in pendingNpcEvents) {
        ST.allEventRng.push(pendingNpcEvents[caseId]);
    }
};

ST._processEvent = function(run, ev, state, pendingNpcEvents) {
    var json = ev.data;

    // ── SEND: record NPC event selection ──
    if (ev.type === 'SEND' && json.action === 'select' && json.caseId) {
        var pend = pendingNpcEvents[json.caseId];
        if (pend) {
            pend.selectedIdx = (json.select && json.select.index != null) ? json.select.index : -1;
            pend.reRollUsed = !!(json.select && json.select.reRoll);
        }
    }

    // ── SEND: track hawker (shop) purchases ──
    if (ev.type === 'SEND' && json.action === 'hawker') {
        state._shopPending = true;
    }

    // Update floor from enter
    if (json.action === 'enter' && json.room && json.room.data) {
        var rd = json.room.data;
        if (rd.floor !== undefined) state.floor = rd.floor;
        if (rd.roomType !== undefined) state.roomType = rd.roomType;
        // Record floor events
        var floorCaseTypes = (json.room.cases || []).map(function(c) { return c.caseType; }).filter(function(t) { return t != null; });
        ST.allFloorEvents.push({
            runId: run.id,
            floor: rd.floor,
            roomType: rd.roomType,
            caseTypes: floorCaseTypes,
        });
    }

    // Update team level from battle
    if (json.action === 'battle' && json.level !== undefined) {
        state.teamLevel = json.level;
    }

    // Apply data.infos (sub-note skill changes)
    var noteCountsSnapshot = ST._collapseNoteCounts(state.bag.notes);
    var infos = (json.data && json.data.infos) ? json.data.infos : [];
    var noteGains = [];
    infos.forEach(function(info) {
        var tid = ST._ele(info.tid);
        var qty = info.qty || 0;
        if (ST.isNote(info.tid)) {
            var before = state.bag.notes[tid] || 0;
            state.bag.notes[tid] = before + Math.max(0, qty);
            if (qty > 0) noteGains.push({ tid: tid, qty: qty, before: before, lucky: info.luckyLevel || 0, isNew: info.new });
            else if (qty < 0) noteGains.push({ tid: tid, qty: qty, before: before, lost: true });
        }
    });

    // Apply secondaries
    var secondaries = (json.data && json.data.secondaries) ? json.data.secondaries : [];
    secondaries.forEach(function(sec) {
        var idx = state.bag.secondaries.indexOf(sec.secondaryId);
        if (sec.active && idx < 0) state.bag.secondaries.push(sec.secondaryId);
        else if (!sec.active && idx >= 0) state.bag.secondaries.splice(idx, 1);
    });

    // Apply select result
    if (json.action === 'select' && json.selectResp && json.selectResp.resp) {
        var resp = json.selectResp.resp;
        var selCaseId = json.caseId;
        var selectNoteGains = [];
        var selectNoteCountsBefore = ST._collapseNoteCounts(state.bag.notes);
        var selectTotalBefore = 0;
        Object.keys(selectNoteCountsBefore).forEach(function(k) { selectTotalBefore += selectNoteCountsBefore[k]; });

        // Apply state changes
        (resp.items || []).forEach(function(item) {
            if (ST.isPotential(item.tid)) {
                var prev = state.bag.potentials[item.tid] || 0;
                state.bag.potentials[item.tid] = prev + (item.qty || 1);
            } else if (ST.isNote(item.tid)) {
                var tid = ST._ele(item.tid);
                var before = selectNoteCountsBefore[tid] || 0;
                var qty = Math.max(0, item.qty || 1);
                state.bag.notes[tid] = (state.bag.notes[tid] || 0) + qty;
                if (qty > 0) selectNoteGains.push({ tid: tid, qty: qty, before: before });
            }
        });
        (resp.subNoteSkills || []).forEach(function(sn) {
            if (ST.isNote(sn.tid)) {
                var tid = ST._ele(sn.tid);
                var before = selectNoteCountsBefore[tid] || 0;
                var qty = Math.max(0, sn.qty);
                state.bag.notes[tid] = (state.bag.notes[tid] || 0) + qty;
                if (qty > 0) selectNoteGains.push({ tid: tid, qty: qty, before: before });
            }
        });

        // Record select note gains (after battle drops are already in state.bag.notes)
        selectNoteGains.forEach(function(g) {
            if (g.qty > 0) {
                ST.allNoteEvents.push({
                    runId: run.id,
                    floor: state.floor,
                    roomType: state.roomType,
                    source: ST.roomTypeSource(state.roomType),
                    action: json.action,
                    tid: g.tid,
                    qty: g.qty,
                    lucky: 0,
                    isNew: false,
                    isStack: false,
                    context: {
                        sameNoteBefore: g.before,
                        totalNotesBefore: selectTotalBefore,
                        teamLevel: state.teamLevel,
                        noteCounts: selectNoteCountsBefore,
                        startCountsBefore: run._startCountsBefore,
                        startCountsAfter: run._startCountsAfter,
                        harmoniesNotes: run._harmoniesNotes,
                        discsNotes: run._discsNotes,
                        overallDiscNotes: run._overallDiscNotes,
                    },
                });
            }
        });

        // Resolve pending NPC event
        var pend = pendingNpcEvents[selCaseId];
        if (pend && !pend.resolved) {
            pend.optionsResult = resp.optionsResult;
            pend.items = resp.items || [];
            pend.affinityChange = resp.affinityChange || [];
            pend.subNoteSkills = resp.subNoteSkills || [];
            pend.resolved = true;
            ST.allEventRng.push(pend);
        }
    }

    // Track strengthen events (Enhancement Machine)
    if (json.action === 'strengthen') {
        var offers = (json.cases || [])[0];
        if (offers && offers.infos) {
            var luckies = offers.luckyIds || [];
            ST.allStrengthenEvents.push({
                runId: run.id,
                floor: state.floor,
                attemptId: offers.id,
                caseId: json.caseId,
                offers: offers.infos.map(function(p) {
                    return { tid: p.tid, level: p.level, lucky: luckies.indexOf(p.tid) >= 0 };
                }),
                success: json.buySucceed,
            });
            // Update state: potential enhanced
            var picked = (json.change && json.change.props && json.change.props.length > 0);
            if (picked && offers.infos.length > 0) {
                // Something was enhanced — update bag
            }
        }
    }

    // ── Extract RNG events from room cases ──
    ST._processCases(run, state, pendingNpcEvents, json.cases || []);
    if (json.room && json.room.cases) {
        ST._processCases(run, state, pendingNpcEvents, json.room.cases);
    }

    // Record note drop events from battle/npc
    if (noteGains.length > 0) {
        var totalBefore = 0;
        Object.keys(noteCountsSnapshot).forEach(function(k) { totalBefore += noteCountsSnapshot[k]; });

        var src = ST.roomTypeSource(state.roomType);
        if (state._shopPending) { src = 'shop'; state._shopPending = false; }

        noteGains.forEach(function(g) {
            if (g.qty > 0) {
                var stack = ST.detectStacks([{tid: g.tid, qty: g.qty, luckyLevel: g.lucky, new: g.isNew}]);
                ST.allNoteEvents.push({
                    runId: run.id,
                    floor: state.floor,
                    roomType: state.roomType,
                    source: src,
                    action: json.action,
                    tid: g.tid,
                    qty: g.qty,
                    lucky: g.lucky,
                    isNew: g.isNew,
                    isStack: stack[0] ? stack[0].isStack : false,
                    context: {
                        sameNoteBefore: g.before,
                        totalNotesBefore: totalBefore,
                        teamLevel: state.teamLevel,
                        noteCounts: noteCountsSnapshot,
                        startCountsBefore: run._startCountsBefore,
                        startCountsAfter: run._startCountsAfter,
                        harmoniesNotes: run._harmoniesNotes,
                        discsNotes: run._discsNotes,
                        overallDiscNotes: run._overallDiscNotes,
                    },
                });
            }
        });
    }
};

ST._processCases = function(run, state, pendingNpcEvents, cases) {
    cases.forEach(function(c) {
        if (c.caseType === 3 || c.caseType === 7) {
            var offers = [];
            var decode = ST.decodePotentialId;
            if (c.caseType === 3) {
                (c.infos || []).forEach(function(p) {
                    var d = decode(p.tid);
                    offers.push({ tid: p.tid, level: p.level, charId: d ? d.charId : 0, index: d ? d.index : 0 });
                });
            } else if (c.caseType === 7) {
                (c.ids || []).forEach(function(tid) {
                    var d = decode(tid);
                    offers.push({ tid: tid, level: 1, charId: d ? d.charId : 0, index: d ? d.index : 0 });
                });
            }
            var boostTotal = 0;
            offers.forEach(function(o) {
                var prevLevel = state.bag.potentials[o.tid] || 0;
                o.isNew = prevLevel === 0;
                o.isUpgrade = prevLevel > 0 && o.level > prevLevel;
                o.boost = o.isNew ? o.level : Math.max(0, o.level - prevLevel);
                boostTotal += o.boost;
            });
            var potCountsByUnit = {};
            Object.keys(state.bag.potentials).forEach(function(ptid) {
                var d = decode(parseInt(ptid));
                if (d) potCountsByUnit[d.charId] = (potCountsByUnit[d.charId] || 0) + 1;
            });
            ST.allPotentialEvents.push({
                runId: run.id, floor: state.floor, roomType: state.roomType,
                teamLevel: state.teamLevel,
                source: c.caseType === 7 ? 'special' : 'normal',
                caseId: c.id, offers: offers,
                luckyIds: c.luckyIds || [], newIds: c.newIds || [],
                canReRoll: c.canReRoll || false, boostTotal: boostTotal,
                context: {
                    totalPotentials: Object.keys(state.bag.potentials).length,
                    potentialsByUnit: potCountsByUnit,
                    teamLevel: state.teamLevel,
                },
            });
        }

        if (c.caseType === 6) {
            pendingNpcEvents[c.id] = {
                runId: run.id, floor: state.floor, roomType: state.roomType,
                npcId: c.npcId, evtId: c.evtId,
                options: c.options || [], failedIdxes: c.failedIdxes || [],
                done: c.done || false, npcs: c.npcs || [],
                selectedIdx: -1, optionsResult: null,
                items: [], affinityChange: [], subNoteSkills: [],
                reRollUsed: false, resolved: false,
            };
        }

        if (c.caseType === 10) {
            var shopFloor = state.floor;
            (c.list || []).forEach(function(item) {
                ST.allShopItems.push({
                    runId: run.id, floor: shopFloor,
                    sid: item.sid, type: item.type === 1 ? 'potential' : 'note',
                    goodsId: item.goodsId, price: item.price,
                    discount: item.discount || 0, charPos: item.charPos,
                    idx: item.idx, tag: item.tag,
                });
            });
            ST.allShopOffers.push({
                runId: run.id, floor: shopFloor,
                items: c.list || [],
                purchase: c.purchase || [],
                canReRoll: c.canReRoll,
                reRollPrice: c.reRollPrice,
                reRollTimes: c.reRollTimes,
            });
        }
    });
};

// ── Filter rebuild ──

ST._rebuildFilters = function() {
    // Called after data is loaded to populate filter dropdowns
    // Tabs have their own filter renderers
};

// ── Tab switching ──

ST.activeTab = 'runs';

ST.switchTab = function(tab) {
    ST.activeTab = tab;
    document.querySelectorAll('.tab-btn').forEach(function(b) {
        b.classList.toggle('active', b.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-panel').forEach(function(p) {
        p.classList.toggle('active', p.id === 'panel-' + tab);
    });

    if (tab === 'runs' && typeof ST.renderRuns === 'function') ST.renderRuns();
    if (tab === 'potentials' && typeof ST.renderPotentials === 'function') ST.renderPotentials();
    if (tab === 'notes' && typeof ST.renderNotes === 'function') ST.renderNotes();
    if (tab === 'events' && typeof ST.renderEvents === 'function') ST.renderEvents();
    if (tab === 'shop' && typeof ST.renderShop === 'function') ST.renderShop();
    if (tab === 'floors' && typeof ST.renderFloors === 'function') ST.renderFloors();
    if (tab === 'rng' && typeof ST.renderRng === 'function') ST.renderRng();
    if (tab === 'enhance' && typeof ST.renderEnhance === 'function') ST.renderEnhance();
};

// ── Fetch log ──

ST.fetchLog = function() {
    return fetch('log')
        .then(function(r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.text();
        })
        .then(function(text) {
            ST._sseAcc = text;
            var events = ST.parseLog(text);
            ST.processRuns(events);
            var stats = document.getElementById('runStats');
            stats.textContent = ST.runs.length + ' runs';
            ST.switchTab(ST.activeTab);
        })
        .catch(function(err) {
            console.error('fetch error', err);
        });
};

// ── Live reload ──

ST.startLiveReload = function() {
    if (location.protocol === 'file:') return;
    var es = new EventSource('events');
    var dot = document.getElementById('liveDot');
    var errTimer = null;

    es.onopen = function() {
        if (dot) { dot.style.background = '#4a8a4a'; dot.title = 'live'; }
        if (errTimer) { clearTimeout(errTimer); errTimer = null; }
    };
    es.onmessage = function(e) {
        if (!e.data) return;
        ST._sseAcc = (ST._sseAcc || '') + e.data + '\n';
        var events = ST.parseLog(ST._sseAcc);
        ST.processRuns(events);
        var stats = document.getElementById('runStats');
        stats.textContent = ST.runs.length + ' runs';
        ST.switchTab(ST.activeTab);
    };
    es.onerror = function() {
        if (dot) { dot.style.background = '#6a3a3a'; dot.title = 'disconnected'; }
        es.close();
        if (!errTimer) errTimer = setTimeout(ST.startLiveReload, 3000);
    };
};

// ── Init ──

document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.tab-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            ST.switchTab(btn.dataset.tab);
        });
    });

    Promise.all([ST.fetchCharNames(), ST.fetchNoteNames(), ST.fetchDiscData()]).then(function() {
        if (ST.runs.length === 0) ST.fetchLog();
    }).finally(function() {
        ST.startLiveReload();
    });
});
