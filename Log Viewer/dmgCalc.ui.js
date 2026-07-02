// ─── dmgCalc.ui.js ────────────────────────────────────────────────────────────
// UI layer: virtual-scroll list, formula bar, effects panel, filters, DOM events.
// Depends on dmgCalc.calc.js being loaded first.

// ─── DC shared state ──────────────────────────────────────────────────────────
let dcFiltered = [];
let dcOpenStates = {};
let dcMeasuredHeights = {};
let dcSubOpenStates = {};
let dcHeights = [];
let dcFenwick = null;
let dcTotalHeight = 0;

// Which formula fields are "disabled" (struck through)
const dcDisabled = new Set();

// ─── DC filter state ──────────────────────────────────────────────────────────
let dcCharFilter = '';
let dcSkillFilter = '';
let dcDefenderFilter = '';

// Per-field bonus values (user-typed numbers added to all hits)
const dcBonus = {};
DC_FIELDS.forEach(f => { dcBonus[f.key] = 0; });
['genDmg','intensity','finalDmg','genDmgRcd','toughnessBroken'].forEach(k => { dcBonus[k] = 0; });

// ─── DC effects panel state ───────────────────────────────────────────────────
// Set of "side:configId:valueConfigId" keys for effects the user disabled
const dcEffectsDisabled = new Set();
// Map<key, {newValueConfigId,newValue,newAttrType,newSubType}> for level-overridden effects
const dcEffectLevelOverrides = new Map();
// Whether the effects panel is open
let dcEffectsPanelOpen = true;
// Which source sections are open; default collapsed (keys added on first toggle)
const dcSourceOpenStates = {};

// ─── Virtual scroll constants & DOM refs ─────────────────────────────────────
const DC_EST    = 60;
const DC_BUFFER = 20;

const dcContainer = document.getElementById('dcScrollContainer');
const dcContent   = document.getElementById('dcScrollContent');
const dcSpacer    = document.getElementById('dcScrollSpacer');

// ─── Fenwick tree ─────────────────────────────────────────────────────────────
class DcFenwick {
    constructor(size) { this.size = size; this.tree = new Array(size + 1).fill(0); }
    add(idx, delta) {
        for (let i = idx + 1; i <= this.size; i += i & -i) this.tree[i] += delta;
    }
    prefixSum(idx) {
        if (idx < 0) return 0;
        if (idx >= this.size) idx = this.size - 1;
        let s = 0;
        for (let i = idx + 1; i > 0; i -= i & -i) s += this.tree[i];
        return s;
    }
}

function dcBuildFenwick() {
    dcFenwick = new DcFenwick(dcFiltered.length);
    dcHeights = new Array(dcFiltered.length);
    let sum = 0;
    for (let i = 0; i < dcFiltered.length; i++) {
        const orig = dcFiltered[i]._origIndex;
        const h = (dcOpenStates[orig] && dcMeasuredHeights[orig]) ? dcMeasuredHeights[orig] : DC_EST;
        dcHeights[i] = h;
        dcFenwick.add(i, h);
        sum += h;
    }
    dcTotalHeight = sum;
    dcSpacer.style.height = dcTotalHeight + 'px';
}

function dcUpdateHeight(idx, newH) {
    const old = dcHeights[idx];
    if (Math.abs(old - newH) < 0.5) return 0;
    dcHeights[idx] = newH;
    const delta = newH - old;
    dcFenwick.add(idx, delta);
    dcTotalHeight += delta;
    dcSpacer.style.height = dcTotalHeight + 'px';
    return delta;
}

function dcFindIndex(target) {
    if (!dcFiltered.length) return 0;
    const clamped = Math.max(0, Math.min(target, dcTotalHeight));
    if (clamped <= 0) return 0;
    if (clamped >= dcTotalHeight) return dcFiltered.length - 1;
    let lo = 0, hi = dcFiltered.length - 1, ans = 0;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (dcFenwick.prefixSum(mid) >= clamped) { ans = mid; hi = mid - 1; }
        else lo = mid + 1;
    }
    return ans;
}

// ─── Effects panel render ─────────────────────────────────────────────────────
function renderEffectsPanel() {
    const panel = document.getElementById('dcEffectsPanel');
    if (!panel) return;
    const effects = dcCollectAttrFixEffects(dcFiltered);

    let html = `<div class="dc-effects-header" onclick="dcToggleEffectsPanel()">
        <span class="dc-effects-arrow${dcEffectsPanelOpen ? ' open' : ''}">▶</span>
        <span class="dc-effects-title">Stat Effects</span>
        <span class="dc-effects-count">${effects.length} unique · click to disable</span>
    </div>`;

    if (dcEffectsPanelOpen) {
        if (effects.length === 0) {
            html += `<div class="dc-effects-body"><span class="dc-effects-empty">No effects found in current filter.</span></div>`;
        } else {
            html += `<div class="dc-effects-body"><div class="dc-effects-list">`;

            // Group by side+source
            const groupMap = new Map(); // `${side}||${source}` -> [effects]
            for (const ef of effects) {
                const gkey = `${ef.side}||${ef.source ?? 'Unknown'}`;
                if (!groupMap.has(gkey)) groupMap.set(gkey, []);
                groupMap.get(gkey).push(ef);
            }

            function renderGroup(gkey, label, groupEffects) {
                if (!groupEffects.length) return '';
                const isOpen = dcSourceOpenStates[gkey] === true;
                const escapedGkey = gkey.replace(/'/g, "\\'");
                let g = `<div class="dc-effects-group-label dc-source-toggle${isOpen ? ' open' : ''}" onclick="dcToggleSourceSection('${escapedGkey}')">
                    <span class="dc-source-arrow">${isOpen ? '▾' : '▸'}</span>${esc(label)}
                    <span class="dc-source-count">${groupEffects.length}</span>
                </div>`;
                if (isOpen) {
                    g += `<div class="dc-effects-chips-wrap">`;
                    for (const ef of groupEffects) {
                        const disabled = dcEffectsDisabled.has(ef.key);
                        let statLine;
                        if (ef.isPotentialsGroup) {
                            statLine = `${ef.count} hit${ef.count !== 1 ? 's' : ''} · zeroed when disabled`;
                        } else {
                            const override = dcEffectLevelOverrides.get(ef.key);
                            const subLabel = ef.subType === 1 ? 'base' : ef.subType === 2 ? 'pct' : ef.subType === 3 ? 'abs' : '?';
                            const attrLabel = ef.attrType != null ? attrName(ef.attrType) : '?';
                            const raw = override ? override.newValue : ef.value;
                            const overrideSubType = override ? override.newSubType : ef.subType;
                            const overrideAttrType = override ? override.newAttrType : ef.attrType;
                            const displaySubLabel = overrideSubType === 1 ? 'base' : overrideSubType === 2 ? 'pct' : overrideSubType === 3 ? 'abs' : '?';
                            const displayAttrLabel = overrideAttrType != null ? attrName(overrideAttrType) : '?';
                            const isSmall = raw != null && Math.abs(raw) < 15;
                            const valStr = raw != null ? (isSmall ? (raw * 100).toFixed(2) + '%' : String(raw)) : '?';
                            const countStr = ef.count > 1 ? ` ×${ef.count}` : '';
                            const overrideMarker = override ? ' *' : '';
                            statLine = `${esc(displayAttrLabel)} ${valStr>=0 ? '+' : ''}${valStr}${countStr} [${displaySubLabel}]${overrideMarker}`;
                        }
                        const titleExtra = ef.isPotentialsGroup
                            ? `potentials · skillTitle=${ef.skillTitle}`
                            : `${ef.side} · configId=${ef.configId}`;

                        // Level buttons for multi-level effects — compute effective level from override
                        const hasLevels = !ef.isPotentialsGroup && ef.allValueConfigIds && ef.allValueConfigIds.length > 1 && ef.currentLevelIdx >= 0;
                        const escKey = ef.key.replace(/'/g, "\\'");
                        let effectiveLevelIdx = ef.currentLevelIdx;
                        if (hasLevels) {
                            const existingOverride = dcEffectLevelOverrides.get(ef.key);
                            if (existingOverride) {
                                const overriddenIdx = ef.allValueConfigIds.findIndex(v => v.valueConfigId === existingOverride.newValueConfigId);
                                if (overriddenIdx >= 0) effectiveLevelIdx = overriddenIdx;
                            }
                        }
                        const maxLvl = hasLevels ? ef.allValueConfigIds.length - 1 : 0;

                        let levelBtns = '';
                        if (hasLevels) {
                            levelBtns = `
                                <button class="dc-lvl-btn dc-lvl-minus${effectiveLevelIdx <= 0 ? ' dc-lvl-disabled' : ''}"
                                    onclick="event.stopPropagation();dcChangeEffectLevel('${escKey}',-1)"
                                    title="Decrease level">−</button>
                                <span class="dc-lvl-indicator">Lv.${effectiveLevelIdx + 1}/${maxLvl + 1}</span>
                                <button class="dc-lvl-btn dc-lvl-plus${effectiveLevelIdx >= maxLvl ? ' dc-lvl-disabled' : ''}"
                                    onclick="event.stopPropagation();dcChangeEffectLevel('${escKey}',1)"
                                    title="Increase level">+</button>`;
                        }

                        g += `<div class="dc-effect-chip${disabled ? ' dc-effect-disabled' : ''}"
                            onclick="dcToggleEffect('${ef.key}')"
                            title="${disabled ? 'Click to re-enable' : 'Click to disable'}\n${titleExtra}">
                            <span class="dc-effect-name">${levelBtns}${esc(ef.name)}</span>
                            <span class="dc-effect-stat">${statLine}</span>
                        </div>`;
                    }
                    g += `</div>`;
                }
                return g;
            }

            // Attacker groups first, then defender, then Potentials
            for (const side of ['attacker', 'defender']) {
                const sideEntries = [...groupMap.entries()].filter(([k]) => k.startsWith(side + '||'));
                if (!sideEntries.length) continue;
                const sideLabel = side === 'attacker' ? 'Attacker' : 'Defender';
                html += `<div class="dc-effects-side-header">${sideLabel}</div>`;
                for (const [gkey, groupEffects] of sideEntries) {
                    const source = gkey.slice(side.length + 2);
                    html += renderGroup(gkey, source, groupEffects);
                }
            }

            // ── Potentials groups ────────────────────────────────────────────
            const potentialsEntries = [...groupMap.entries()].filter(([k]) => k.startsWith('potentials||'));
            if (potentialsEntries.length) {
                html += `<div class="dc-effects-side-header">Potentials</div>`;
                for (const [gkey, groupEffects] of potentialsEntries) {
                    const source = gkey.slice('potentials||'.length);
                    html += renderGroup(gkey, source, groupEffects);
                }
            }

            html += `</div></div>`;
        }
    }
    panel.innerHTML = html;
}

window.dcToggleEffectsPanel = function() {
    dcEffectsPanelOpen = !dcEffectsPanelOpen;
    renderEffectsPanel();
};

window.dcToggleSourceSection = function(gkey) {
    dcSourceOpenStates[gkey] = !dcSourceOpenStates[gkey];
    renderEffectsPanel();
};

window.dcToggleEffect = function(key) {
    if (dcEffectsDisabled.has(key)) dcEffectsDisabled.delete(key);
    else dcEffectsDisabled.add(key);
    renderEffectsPanel();
    renderFormulaBar();
    dcRender();
};

window.dcChangeEffectLevel = function(key, direction) {
    const effects = dcCollectAttrFixEffects(dcFiltered);
    const ef = effects.find(e => e.key === key);
    if (!ef || !ef.allValueConfigIds || ef.allValueConfigIds.length < 2) return;

    // Determine current level index: use override's valueConfigId if present,
    // otherwise use the original currentLevelIdx from the raw data
    const existingOverride = dcEffectLevelOverrides.get(key);
    const curVcId = existingOverride ? existingOverride.newValueConfigId : ef.valueConfigId;
    let curIdx = ef.allValueConfigIds.findIndex(v => v.valueConfigId === curVcId);
    if (curIdx < 0) curIdx = ef.currentLevelIdx;
    if (curIdx < 0) return;

    const newIdx = curIdx + direction;
    if (newIdx < 0 || newIdx >= ef.allValueConfigIds.length) return;
    const newEntry = ef.allValueConfigIds[newIdx];
    const newVcId = newEntry.valueConfigId;

    let newValue, newAttrType, newSubType;
    if (ef.fromAttrDict) {
        const slots = onceAttrValueTable.get(newVcId);
        if (slots && slots.length > 0) {
            newAttrType = slots[0].attrType;
            newSubType  = slots[0].subType;
            newValue    = slots[0].value;
        } else {
            return;
        }
    } else {
        const ev = effectValueTable.get(newVcId);
        if (ev && ev.value != null) {
            newAttrType = ev.attrType != null ? ev.attrType : ef.attrType;
            newSubType  = ev.subType  != null ? ev.subType  : ef.subType;
            newValue    = ev.value;
        } else {
            return;
        }
    }

    if (newValue == null) return;

    // If overriding back to the original valueConfigId, remove the override
    if (newVcId === ef.valueConfigId) {
        dcEffectLevelOverrides.delete(key);
    } else {
        dcEffectLevelOverrides.set(key, {
            newValueConfigId: newVcId,
            newValue,
            newAttrType: newAttrType != null ? newAttrType : ef.attrType,
            newSubType: newSubType  != null ? newSubType  : ef.subType,
        });
    }

    renderEffectsPanel();
    renderFormulaBar();
    dcRender();
};

// ─── Formula bar rendering ────────────────────────────────────────────────────
function renderFormulaBar() {
    const bar = document.getElementById('dcFormulaBar');
    if (!bar) return;

    // Compute total calculated vs in-game damage across filtered hits
    let totalCalc = 0;
    let totalGame = 0;
    dcFiltered.forEach(ev => {
        const f = calcHitFields(ev, null, dcEffectsDisabled, dcEffectLevelOverrides);
        totalCalc += calcDamage(f, dcBonus, dcDisabled);
        totalGame += f.finalDamage;
    });

    const overallDiff = totalGame > 0 ? ((totalCalc / totalGame) - 1) * 100 : null;
    let diffHtml = '';
    if (overallDiff != null) {
        const cls = Math.abs(overallDiff) < 0.05 ? 'dc-diff-close' : overallDiff < 0 ? 'dc-diff-neg' : 'dc-diff-pos';
        diffHtml = ` <span class="${cls}" style="margin-left:4px">(${overallDiff >= 0 ? '+' : ''}${overallDiff.toFixed(1)}%)</span>`;
    }

    // Percentage relative to Calc (swapped numbers)
    const overallDiff2 = totalCalc > 0 ? ((totalGame / totalCalc) - 1) * 100 : null;
    let diffHtml2 = '';
    if (overallDiff2 != null) {
        const cls2 = Math.abs(overallDiff2) < 0.05 ? 'dc-diff-close' : overallDiff2 < 0 ? 'dc-diff-neg' : 'dc-diff-pos';
        diffHtml2 = ` <span class="${cls2}" style="margin-left:4px">(${overallDiff2 >= 0 ? '+' : ''}${overallDiff2.toFixed(1)}%)</span>`;
    }

    let html = `<div class="dc-formula-totals">
        <span>Total Calc: <strong>${Math.round(totalCalc).toLocaleString()}</strong>${diffHtml}</span>
        <span style="margin-left:16px">Total In-Game: <strong>${Math.round(totalGame).toLocaleString()}</strong>${diffHtml2}</span>
    </div>
    <div class="dc-formula-row">`;


    const FORMULA_DISPLAY = [
        { key: 'multiplier' }, { sep: '×' },
        { key: 'baseAtk' }, { sep: '×' },
        { key: 'atkPct' }, { sep: '×' },
        { key: 'elemPct' }, { sep: '×' },
        { key: 'elemTakenPct' }, { sep: '×' },
        { key: 'dmgTypePct' }, { sep: '×' },
        { key: 'dmgTypeTakenPct' }, { sep: '×' },
        { key: 'critRate', critRateToggle: true }, { sep: '/' },
        { key: 'critDmg' }, { sep: '×' },
        { key: 'penRes', penResCompound: true }, { sep: '×' },
        { key: 'effectiveDef', effDefDisplay: true }, { sep: '→' },
        { key: 'defAmend' }, { sep: '×' },
        { key: 'envAmend' }, { sep: '=' },
        { result: true },
    ];

    for (const item of FORMULA_DISPLAY) {
        if (item.sep) {
            html += `<span class="dc-sep">${item.sep}</span>`;
        } else if (item.result) {
            html += `<span class="dc-field dc-result-label" data-key="__result">Dmg</span>`;
        } else if (item.penResCompound) {
            const dis = dcDisabled.has('penRes');
            const penBonus = dcBonus['pen'] || 0;
            const resBonus = dcBonus['res'] || 0;
            html += `<div class="dc-field-wrap dc-penres-wrap" data-key="penRes">
                <div class="dc-penres-inputs">
                    <span class="dc-penres-label">Pen</span>
                    <input class="dc-bonus-input" type="number" step="any" placeholder="+0"
                        value="${penBonus !== 0 ? penBonus : ''}"
                        onchange="dcSetBonus('pen', this.value)"
                        onclick="event.stopPropagation()">
                    <span class="dc-penres-label">Res</span>
                    <input class="dc-bonus-input" type="number" step="any" placeholder="+0"
                        value="${resBonus !== 0 ? resBonus : ''}"
                        onchange="dcSetBonus('res', this.value)"
                        onclick="event.stopPropagation()">
                </div>
                <span class="dc-field${dis ? ' dc-disabled' : ''}"
                    data-key="penRes"
                    onclick="dcToggleField('penRes')"
                    title="${dis ? 'Click to re-enable' : 'Click to disable'}"
                >${DC_FIELDS.find(f => f.key === "penRes").label}</span>
            </div>`;
        } else if (item.critRateToggle) {
            const dis = dcDisabled.has('critRate');
            const bonus = dcBonus['critRate'] || 0;
            const titleMsg = dis
                ? 'Click to re-enable (reverts to per-hit isCrit check)\nCurrently: using CritRate×(CritDmg−1) as expected multiplier'
                : 'Click to disable per-hit crit check\nWill use CritRate×(CritDmg−1) as expected multiplier instead';
            html += `<div class="dc-field-wrap" data-key="critRate">
                <input class="dc-bonus-input" type="number" step="any" placeholder="+0"
                    value="${bonus !== 0 ? bonus : ''}"
                    data-key="critRate"
                    onchange="dcSetBonus('critRate', this.value)"
                    onclick="event.stopPropagation()">
                <span class="dc-field${dis ? ' dc-disabled' : ''}"
                    data-key="critRate"
                    onclick="dcToggleField('critRate')"
                    title="${titleMsg}"
                >CritRate</span>
            </div>`;
        } else if (item.effDefDisplay) {
            const bonus = dcBonus['effectiveDef'] || 0;
            html += `<div class="dc-field-wrap" data-key="effectiveDef">
                <input class="dc-bonus-input" type="number" step="any" placeholder="+0"
                    value="${bonus !== 0 ? bonus : ''}"
                    data-key="effectiveDef"
                    onchange="dcSetBonus('effectiveDef', this.value)"
                    onclick="event.stopPropagation()"
                    title="Adjust EffDEF — DEF multiplier recalculates live">
                <span class="dc-field dc-display-only"
                    data-key="effectiveDef"
                    title="Display only — adjust via bonus input to affect DEF multiplier"
                >EffDEF</span>
            </div>`;
        } else {
            const fd = DC_FIELDS.find(f => f.key === item.key);
            const dis = dcDisabled.has(item.key);
            const bonus = dcBonus[item.key] || 0;
            html += `<div class="dc-field-wrap" data-key="${item.key}">
                <input class="dc-bonus-input" type="number" step="any" placeholder="+0"
                    value="${bonus !== 0 ? bonus : ''}"
                    data-key="${item.key}"
                    onchange="dcSetBonus('${item.key}', this.value)"
                    onclick="event.stopPropagation()">
                <span class="dc-field${dis ? ' dc-disabled' : ''}"
                    data-key="${item.key}"
                    onclick="dcToggleField('${item.key}')"
                    title="${dis ? 'Click to re-enable' : 'Click to disable'}"
                >${esc(fd ? fd.label : item.key)}</span>
            </div>`;
        }
    }
    html += `</div>`;
    bar.innerHTML = html;
}

window.dcToggleField = function(key) {
    if (dcDisabled.has(key)) dcDisabled.delete(key);
    else dcDisabled.add(key);
    renderFormulaBar();
    dcRender();
};

window.dcSetBonus = function(key, val) {
    const n = parseFloat(val);
    dcBonus[key] = isNaN(n) ? 0 : n;
    renderFormulaBar();
    dcRender();
};

// ─── Per-hit event DOM ────────────────────────────────────────────────────────
const DISPLAY_ORDER = [
    'multiplier','baseAtk','atkPct','elemPct','elemTakenPct',
    'dmgTypePct','dmgTypeTakenPct','critRate','critDmg',
    'penRes','effectiveDef','defAmend','envAmend'
];

function dcCreateEventDiv(ev, fi) {
    const oi = ev._origIndex;
    const isOpen = dcOpenStates[oi] || false;
    const hc = ev.HitConfig   || {};
    const dp = ev.DamageParams || {};

    const fields   = calcHitFields(ev, null, dcEffectsDisabled, dcEffectLevelOverrides);
    const calcDmg  = calcDamage(fields, dcBonus, dcDisabled);

    const attName  = esc(ev.AttackerDisplay || ev.Attacker || '?');
    const skillPart = hc.skillTitle ? esc(hc.skillTitle) : '';
    const hitPart   = hc.hitNum != null ? ` (#${hc.hitNum})` : '';
    const skillStr  = (skillPart || hitPart) ? ` - ${skillPart}${hitPart}` : '';
    const baseMult  = dp.skillPercentAmend != null ? ` [${(dp.skillPercentAmend/10000).toFixed(2)}%]` : '';
    const snapAge = ev.SnapshotAt ? ` [${((parseTimeToMs(ev.Time)-parseTimeToMs(ev.SnapshotAt))/1000).toFixed(3)}s ago]` : '';

    const div = document.createElement('div');
    div.className = 'event dc-event' + (isOpen ? ' open' : '');
    div.style.top = dcFenwick.prefixSum(fi - 1) + 'px';
    div.dataset.origIndex     = oi;
    div.dataset.filteredIndex = fi;

    // ── Header ──
    const header = document.createElement('div');
    header.className = 'event-header dc-event-header';

    const topRow = document.createElement('div');
    topRow.className = 'dc-header-top';

    const leftDiv = document.createElement('div');
    leftDiv.className = 'dc-header-left';
    leftDiv.innerHTML = `<span class="dc-att-name">${attName}${skillStr}${baseMult}${snapAge}</span>`;

    topRow.appendChild(leftDiv);

    // Field values row
    const fvRow = document.createElement('div');
    fvRow.className = 'dc-fields-row';

    const fvs = hitFieldValues(fields, dcBonus);
    for (let i = 0; i < DISPLAY_ORDER.length; i++) {
        const key = DISPLAY_ORDER[i];
        const fvEntry = fvs.find(f => f.key === key);
        const bonus = dcBonus[key] || 0;
        const rawVal = fvEntry ? fvEntry.val : null;
        const skipBonusLabel = (key === 'effectiveDef' || key === 'defAmend');
        const dispVal = (bonus !== 0 && !skipBonusLabel)
            ? `${fmtVal(rawVal, key)} <span class="dc-bonus-label">(+${fmtVal(bonus, key)})</span>`
            : fmtVal(rawVal, key);
        const dis = dcDisabled.has(key);
        const isDisplayOnly = key === 'effectiveDef' || DC_FIELDS.find(f => f.key === key)?.display_only;
        const cell = document.createElement('div');
        cell.className = 'dc-field-cell' + (dis ? ' dc-disabled' : '') + (isDisplayOnly ? ' dc-display-only' : '');
        cell.dataset.key = key;
        cell.innerHTML = dispVal;
        fvRow.appendChild(cell);
    }

    // Result cells
    const calcCell = document.createElement('div');
    calcCell.className = 'dc-field-cell dc-result-cell';
    calcCell.innerHTML = `<span class="dc-calc">${Math.round(calcDmg).toLocaleString()}</span>`;

    const gameCell = document.createElement('div');
    gameCell.className = 'dc-field-cell dc-game-cell';
    gameCell.innerHTML = `<span class="dc-game">${Number(fields.finalDamage).toLocaleString()}</span>`;

    const diffPct = fields.finalDamage > 0
        ? ((calcDmg / fields.finalDamage - 1) * 100)
        : null;
    const diffCell = document.createElement('div');
    diffCell.className = 'dc-field-cell dc-diff-cell';
    if (diffPct != null) {
        const cls = Math.abs(diffPct) < 0.05 ? 'dc-diff-close' : diffPct < 1 ? 'dc-diff-neg' : 'dc-diff-pos';
        diffCell.innerHTML = `<span class="${cls}">${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(1)}%</span>`;
    }

    const resultStack = document.createElement('div');
    resultStack.className = 'dc-result-stack';
    resultStack.appendChild(calcCell);
    resultStack.appendChild(gameCell);
    resultStack.appendChild(diffCell);

    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.textContent = '▶';
    topRow.appendChild(arrow);

    header.appendChild(topRow);
    header.appendChild(fvRow);
    header.appendChild(resultStack);

    header.addEventListener('click', e => { e.stopPropagation(); dcToggleEvent(oi); });

    // ── Body ──
    const body = document.createElement('div');
    body.className = 'event-body';
    if (isOpen) body.innerHTML = buildEventBody(ev);

    div.appendChild(header);
    div.appendChild(body);
    return div;
}

function dcToggleEvent(origIndex) {
    const el = dcContent.querySelector(`.dc-event[data-orig-index="${origIndex}"]`);
    if (!el) return;
    const fi = parseInt(el.dataset.filteredIndex);
    const savedScroll = dcContainer.scrollTop;
    const wasOpen = dcOpenStates[origIndex] || false;

    if (wasOpen) {
        dcOpenStates[origIndex] = false;
        el.querySelector('.event-body').innerHTML = '';
        el.classList.remove('open');
        const topOfThis = dcFenwick.prefixSum(fi - 1);
        const rel = savedScroll - topOfThis;
        const delta = dcUpdateHeight(fi, DC_EST);
        delete dcMeasuredHeights[origIndex];
        dcShiftAfter(fi, delta);
        dcContainer.scrollTop = topOfThis + rel;
    } else {
        dcOpenStates[origIndex] = true;
        const body = el.querySelector('.event-body');
        body.innerHTML = buildEventBody(allEvents[origIndex]);
        el.classList.add('open');
        requestAnimationFrame(() => {
            const actual = el.getBoundingClientRect().height;
            if (actual > 0) {
                dcMeasuredHeights[origIndex] = actual;
                const delta = dcUpdateHeight(fi, actual);
                if (Math.abs(delta) > 0.5) {
                    dcShiftAfter(fi, delta);
                    const maxScroll = dcTotalHeight - dcContainer.clientHeight;
                    dcContainer.scrollTop = Math.min(savedScroll, Math.max(0, maxScroll));
                    dcRender();
                }
            }
        });
    }
}

function dcShiftAfter(startFi, delta) {
    dcContent.querySelectorAll('.dc-event').forEach(el => {
        const idx = parseInt(el.dataset.filteredIndex);
        if (!isNaN(idx) && idx > startFi) {
            el.style.top = (parseFloat(el.style.top) + delta) + 'px';
        }
    });
}

// Sub-section toggle inside dc event body
dcContent.addEventListener('click', e => {
    const toggle = e.target.closest('.collapsible-toggle');
    if (!toggle) return;
    e.stopPropagation();
    const targetId = toggle.dataset.target;
    const contentEl = document.getElementById(targetId);
    if (!contentEl) return;
    const isOpen = toggle.classList.toggle('open');
    contentEl.style.display = isOpen ? 'block' : 'none';

    const eventDiv = toggle.closest('.dc-event');
    if (!eventDiv) return;
    const oi = parseInt(eventDiv.dataset.origIndex);
    const fi = parseInt(eventDiv.dataset.filteredIndex);
    const key = `dc_${oi}_${targetId}`;
    dcSubOpenStates[key] = isOpen;

    const savedScroll = dcContainer.scrollTop;
    requestAnimationFrame(() => {
        const actual = eventDiv.getBoundingClientRect().height;
        if (actual > 0 && !isNaN(fi)) {
            const delta = dcUpdateHeight(fi, actual);
            dcMeasuredHeights[oi] = actual;
            if (Math.abs(delta) > 0.5) dcShiftAfter(fi, delta);
        }
        const maxScroll = dcTotalHeight - dcContainer.clientHeight;
        dcContainer.scrollTop = Math.min(savedScroll, Math.max(0, maxScroll));
    });
});

// ─── Virtual scroll render ────────────────────────────────────────────────────
function dcRender() {
    if (!dcFiltered.length) { dcContent.innerHTML = ''; return; }

    const scrollTop = dcContainer.scrollTop;
    const viewH = dcContainer.clientHeight;
    const startIdx = dcFindIndex(scrollTop);
    let start = Math.max(0, startIdx - DC_BUFFER);
    const endIdx = dcFindIndex(scrollTop + viewH);
    let end = Math.min(dcFiltered.length, endIdx + DC_BUFFER);
    if (start >= dcFiltered.length) start = Math.max(0, dcFiltered.length - 1);

    const neededOrig = new Set();
    const origToFi = new Map();
    for (let i = start; i < end; i++) {
        neededOrig.add(dcFiltered[i]._origIndex);
        origToFi.set(dcFiltered[i]._origIndex, i);
    }

    const existing = dcContent.querySelectorAll('.dc-event');
    for (const el of existing) {
        const oi = parseInt(el.dataset.origIndex);
        if (neededOrig.has(oi)) {
            const fi = origToFi.get(oi);
            el.dataset.filteredIndex = fi;
            const newTop = dcFenwick.prefixSum(fi - 1);
            if (el.style.top !== newTop + 'px') el.style.top = newTop + 'px';
            const shouldOpen = dcOpenStates[oi] || false;
            const isOpen = el.classList.contains('open');
            if (shouldOpen !== isOpen) {
                el.classList.toggle('open', shouldOpen);
                const body = el.querySelector('.event-body');
                if (body) {
                    if (shouldOpen && body.innerHTML.trim() === '') body.innerHTML = buildEventBody(allEvents[oi]);
                    else if (!shouldOpen) body.innerHTML = '';
                }
            }
            // Refresh calc values in header (bonuses may have changed)
            const fvRow = el.querySelector('.dc-fields-row');
            if (fvRow) {
                const ev = allEvents[oi];
                const fields  = calcHitFields(ev, null, dcEffectsDisabled, dcEffectLevelOverrides);
                const calcDmg = calcDamage(fields, dcBonus, dcDisabled);
                const fvs     = hitFieldValues(fields, dcBonus);
                const cells   = fvRow.querySelectorAll('.dc-field-cell');
                let ci = 0;
                for (const key of DISPLAY_ORDER) {
                    const cell = cells[ci++];
                    if (!cell) continue;
                    const fv = fvs.find(f => f.key === key);
                    const showBonus = dcBonus[key] || 0;
                    const rawVal = fv ? fv.val : null;
                    const skipBonusLabel = (key === 'effectiveDef' || key === 'defAmend');
                    cell.innerHTML = (showBonus !== 0 && !skipBonusLabel)
                        ? `${fmtVal(rawVal, key)} <span class="dc-bonus-label">(${fmtVal(showBonus, key) >= 0 ? '+' : ''}${fmtVal(showBonus, key)})</span>`
                        : fmtVal(rawVal, key);
                    const isDisplayOnly = key === 'effectiveDef' || DC_FIELDS.find(f => f.key === key)?.display_only;
                    cell.className = 'dc-field-cell' +
                        (dcDisabled.has(key) ? ' dc-disabled' : '') +
                        (isDisplayOnly ? ' dc-display-only' : '');
                }
                const calcCell = el.querySelector('.dc-result-cell');
                const gameCell = el.querySelector('.dc-game-cell');
                const diffCell = el.querySelector('.dc-diff-cell');
                if (calcCell) calcCell.innerHTML = `<span class="dc-calc">${Math.round(calcDmg).toLocaleString()}</span>`;
                if (gameCell) gameCell.innerHTML = `<span class="dc-game">${Number(fields.finalDamage).toLocaleString()}</span>`;
                if (diffCell) {
                    const diffPct = fields.finalDamage > 0 ? ((calcDmg / fields.finalDamage - 1) * 100) : null;
                    if (diffPct != null) {
                        const cls = Math.abs(diffPct) < 0.05 ? 'dc-diff-close' : diffPct < 1 ? 'dc-diff-neg' : 'dc-diff-pos';
                        diffCell.innerHTML = `<span class="${cls}">${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(1)}%</span>`;
                    }
                }
            }
            neededOrig.delete(oi);
        } else {
            el.remove();
        }
    }

    for (const oi of neededOrig) {
        const fi = dcFiltered.findIndex(e => e._origIndex === oi);
        if (fi === -1) continue;
        const div = dcCreateEventDiv(allEvents[oi], fi);
        dcContent.appendChild(div);
    }
}

let dcScrollScheduled = false;
dcContainer.addEventListener('scroll', () => {
    if (dcScrollScheduled) return;
    dcScrollScheduled = true;
    requestAnimationFrame(() => { dcRender(); dcScrollScheduled = false; });
});

// ─── Filter helpers ───────────────────────────────────────────────────────────
function dcBuildCharFilter() {
    const all = new Set();
    allEvents.filter(e => e.Type === 'Hit').forEach(e => {
        if (e.AttackerDisplay) all.add(e.AttackerDisplay);
    });
    const sel = document.getElementById('dcCharFilter');
    const cur = sel.value;
    sel.innerHTML = '<option value="">All Characters</option>';
    [...all].sort().forEach(c => {
        const o = document.createElement('option');
        o.value = c; o.textContent = c; sel.appendChild(o);
    });
    sel.value = [...sel.options].some(o => o.value === cur) ? cur : '';
    dcCharFilter = sel.value;
}

function dcBuildSkillFilter(evs) {
    const all = new Set();
    evs.forEach(e => {
        const n = (e.HitConfig || {}).skillTitle;
        if (n) all.add(n);
    });
    const sel = document.getElementById('dcSkillFilter');
    const cur = sel.value;
    sel.innerHTML = '<option value="">All Skills</option>';
    const MAX = 28;
    [...all].sort().forEach(s => {
        const o = document.createElement('option');
        o.value = s;
        o.textContent = s.length > MAX ? s.slice(0, MAX) + '…' : s;
        o.title = s;
        sel.appendChild(o);
    });
    sel.value = [...sel.options].some(o => o.value === cur) ? cur : '';
    dcSkillFilter = sel.value;
}

function dcBuildDefenderFilter(autoSelect = false) {
    const dmgTotals = {};
    allEvents.filter(e => e.Type === 'Hit').forEach(e => {
        const name = e.DefenderDisplay || e.Defender;
        if (!name) return;
        const key = cleanOwner ? cleanOwner(name) : name;
        const dmg = (e.DamageParams && e.DamageParams.finalDamage) || 0;
        dmgTotals[key] = (dmgTotals[key] || 0) + dmg;
    });
    const all = Object.keys(dmgTotals);
    const sel = document.getElementById('dcDefenderFilter');
    const cur = sel.value;
    sel.innerHTML = '<option value="">All Defenders</option>';
    const MAX = 28;
    [...all].sort().forEach(c => {
        const o = document.createElement('option');
        o.value = c;
        o.textContent = c.length > MAX ? c.slice(0, MAX) + '…' : c;
        o.title = c;
        sel.appendChild(o);
    });
    if (autoSelect) {
        const top = all.sort((a, b) => dmgTotals[b] - dmgTotals[a])[0] || '';
        sel.value = top;
    } else if ([...sel.options].some(o => o.value === cur)) {
        sel.value = cur;
    } else {
        const top = all.sort((a, b) => dmgTotals[b] - dmgTotals[a])[0] || '';
        sel.value = top;
    }
    dcDefenderFilter = sel.value;
}

function dcApplyFilters() {
    let evs = allEvents.filter(e => e.Type === 'Hit');
    if (dcCharFilter) evs = evs.filter(e => (e.AttackerDisplay || '') === dcCharFilter);
    dcBuildSkillFilter(evs);
    if (dcSkillFilter) evs = evs.filter(e => ((e.HitConfig || {}).skillTitle || '') === dcSkillFilter);
    if (dcDefenderFilter) {
        evs = evs.filter(e => {
            const name = e.DefenderDisplay || e.Defender;
            if (!name) return true;
            const key = cleanOwner ? cleanOwner(name) : name;
            return key === dcDefenderFilter;
        });
    }
    return evs;
}

window.dcOnCharFilterChange = function() {
    dcCharFilter = document.getElementById('dcCharFilter').value;
    dcRefilterAndRender(true, false);
};
window.dcOnSkillFilterChange = function() {
    dcSkillFilter = document.getElementById('dcSkillFilter').value;
    dcRefilterAndRender(true, false);
};
window.dcOnDefenderFilterChange = function() {
    dcDefenderFilter = document.getElementById('dcDefenderFilter').value;
    dcRefilterAndRender(true, false);
};

// ─── Refilter / rebuild ───────────────────────────────────────────────────────
function dcRefilterAndRender(resetScroll = false, autoSelectDefender = true) {
    dcBuildCharFilter();
    dcBuildDefenderFilter(autoSelectDefender);
    dcFiltered = dcApplyFilters();
    if (resetScroll) {
        dcOpenStates = {};
        dcMeasuredHeights = {};
        dcSubOpenStates = {};
        dcContent.innerHTML = '';
        dcContainer.scrollTop = 0;
    }
    dcBuildFenwick();
    renderFormulaBar();
    renderEffectsPanel();
    document.getElementById('dcStats').textContent = `${dcFiltered.length} hits`;
    dcRender();
}

// ─── Tab hook ─────────────────────────────────────────────────────────────────
const _origSwitchTab = window.switchTab;
window.switchTab = function(tab) {
    document.getElementById('tabDmgCalc').classList.toggle('active', tab === 'dmgcalc');
    document.getElementById('dmgCalcPanel').classList.toggle('visible', tab === 'dmgcalc');
    if (tab === 'dmgcalc') {
        dcRefilterAndRender(false);
    }
    _origSwitchTab(tab);
};

let _dcLastEffectKeys = null;
// Expose a hook so data loading can trigger a refresh when new events arrive.
// Updates hit list, formula-bar totals, and the effects panel only when
// the set of unique effects actually changes (no DOM thrashing on every poll).
window.dcRefreshIfVisible = function() {
    if (document.getElementById('dmgCalcPanel').classList.contains('visible')) {
        dcFiltered = dcApplyFilters();
        dcBuildFenwick();

        // Update totals in the formula bar without rebuilding the whole thing
        let totalCalc = 0, totalGame = 0;
        dcFiltered.forEach(ev => {
            const f = calcHitFields(ev, null, dcEffectsDisabled, dcEffectLevelOverrides);
            totalCalc += calcDamage(f, dcBonus, dcDisabled);
            totalGame += f.finalDamage;
        });
        const overallDiff = totalGame > 0 ? ((totalCalc / totalGame) - 1) * 100 : null;
        const overallDiff2 = totalCalc > 0 ? ((totalGame / totalCalc) - 1) * 100 : null;
        const bar = document.getElementById('dcFormulaBar');
        if (bar) {
            const totalsEl = bar.querySelector('.dc-formula-totals');
            if (totalsEl) {
                const d1 = overallDiff != null
                    ? `<span class="${Math.abs(overallDiff) < 0.05 ? 'dc-diff-close' : overallDiff < 0 ? 'dc-diff-neg' : 'dc-diff-pos'}" style="margin-left:4px">(${overallDiff >= 0 ? '+' : ''}${overallDiff.toFixed(1)}%)</span>`
                    : '';
                const d2 = overallDiff2 != null
                    ? `<span class="${Math.abs(overallDiff2) < 0.05 ? 'dc-diff-close' : overallDiff2 < 0 ? 'dc-diff-neg' : 'dc-diff-pos'}" style="margin-left:4px">(${overallDiff2 >= 0 ? '+' : ''}${overallDiff2.toFixed(1)}%)</span>`
                    : '';
                totalsEl.innerHTML = `
                    <span>Total Calc: <strong>${Math.round(totalCalc).toLocaleString()}</strong>${d1}</span>
                    <span style="margin-left:16px">Total In-Game: <strong>${Math.round(totalGame).toLocaleString()}</strong>${d2}</span>
                `;
            }
        }

        // Only re-render effects panel when new unique effects actually appear
        const newEffects = dcCollectAttrFixEffects(dcFiltered);
        const newKeys = new Set(newEffects.map(e => e.key));
        if (!_dcLastEffectKeys || _dcLastEffectKeys.size !== newKeys.size || ![...newKeys].every(k => _dcLastEffectKeys.has(k))) {
            _dcLastEffectKeys = newKeys;
            renderEffectsPanel();
        }

        document.getElementById('dcStats').textContent = `${dcFiltered.length} hits`;
        dcRender();
    }
};
