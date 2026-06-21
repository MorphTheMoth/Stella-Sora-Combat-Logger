// ─── Analytics module ─────────────
const Analytics = (() => {

    // ── Color system ──────────────────────────────────────────────

    // Dominant-color cache: charName → hex string (resolved once)
    const charColorCache = {};   // charName → hex  (final assigned color)
    const charDomCache   = {};   // charId   → Promise<string[]>

    function loadImg(url) {
        return new Promise((resolve, reject) => {
            const i = new Image();
            i.crossOrigin = 'anonymous';
            i.onload = () => resolve(i);
            i.onerror = reject;
            i.src = url;
        });
    }

    async function getDominantColors(charId) {
        const CROP_W = 256, CROP_H = 58;
        const base = 'https://raw.githubusercontent.com/AutumnVN/ssassets/main/export/assets/assetbundles/icon/honortitle/';
        const urls = [
            `${base}HonorTitle_Affinity_${charId}_L.webp`,
            `${base}HonorTitle_Affinity_${charId}_L_lang.webp`,
        ];

        let img = null;
        for (const url of urls) {
            try { img = await loadImg(url); break; } catch {}
        }
        if (!img) throw new Error('not found');

        const sx = Math.max(0, Math.floor((img.naturalWidth  - CROP_W) / 2));
        const sy = Math.max(0, Math.floor((img.naturalHeight - CROP_H) / 2));
        const sw = Math.min(CROP_W, img.naturalWidth);
        const sh = Math.min(CROP_H, img.naturalHeight);

        const cropCanvas = document.createElement('canvas');
        cropCanvas.width  = sw;
        cropCanvas.height = sh;
        const ctx = cropCanvas.getContext('2d');
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

        const { data } = ctx.getImageData(0, 0, sw, sh);
        const total = sw * sh;
        const step = Math.max(1, Math.floor(total / 4000));
        const pixels = [];

        for (let i = 0; i < total; i += step) {
            const idx = i * 4;
            const r = data[idx], g = data[idx+1], b = data[idx+2], a = data[idx+3];
            if (a < 128) continue;
            const max = Math.max(r,g,b), min = Math.min(r,g,b);
            const l = (max+min)/2/255*100;
            const s = max === min ? 0 : (max-min)/(255-Math.abs(max+min-255))*100;
            if (l < 5 || l > 95 || s < 5) continue;
            pixels.push([r, g, b]);
        }

        const k = 10;
        const pstep = Math.max(1, Math.floor(pixels.length / k));
        let centroids = Array.from({length:k}, (_,i) => [...pixels[Math.min(i*pstep, pixels.length-1)]]);
        let assignments = new Array(pixels.length).fill(0);

        for (let iter = 0; iter < 25; iter++) {
            let changed = false;
            for (let i = 0; i < pixels.length; i++) {
                let best = 0, bestD = Infinity;
                for (let j = 0; j < k; j++) {
                    const d = Math.sqrt((pixels[i][0]-centroids[j][0])**2+(pixels[i][1]-centroids[j][1])**2+(pixels[i][2]-centroids[j][2])**2);
                    if (d < bestD) { bestD = d; best = j; }
                }
                if (assignments[i] !== best) { assignments[i] = best; changed = true; }
            }
            const sums = Array.from({length:k}, ()=>[0,0,0,0]);
            for (let i = 0; i < pixels.length; i++) {
                const c = assignments[i];
                sums[c][0]+=pixels[i][0]; sums[c][1]+=pixels[i][1]; sums[c][2]+=pixels[i][2]; sums[c][3]++;
            }
            for (let j = 0; j < k; j++)
                if (sums[j][3] > 0) centroids[j] = [0,1,2].map(ch => Math.round(sums[j][ch]/sums[j][3]));
            if (!changed) break;
        }

        const counts = new Array(k).fill(0);
        for (const a of assignments) counts[a]++;

        return centroids
            .map((c,i) => ({ hex: '#'+c.map(v=>v.toString(16).padStart(2,'0')).join(''), count: counts[i] }))
            .filter(c => c.count > 0)
            .sort((a,b) => b.count - a.count)
            .slice(0,4);
    }

    // Extract charId from a character's hits: most common first-3-digits of hitDamageId
    function getCharId(charName) {
        const hits = getPlayerHits().filter(ev => getCharName(ev) === charName);
        const tally = {};
        for (const ev of hits) {
            const hid = (ev.HitConfig || {}).hitDamageId;
            if (!hid) continue;
            const prefix = String(hid).slice(0, 3);
            tally[prefix] = (tally[prefix] || 0) + 1;
        }
        const best = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
        return best ? best[0] : null;
    }

    const charResolveCache = {};

    async function resolveCharColors(charNames) {
        const toResolve = charNames.filter(n => !charColorCache[n] && !charResolveCache[n]);
        toResolve.forEach(name => {
            charResolveCache[name] = (async () => {
                const id = getCharId(name);
                if (!id) { console.warn(`[charColor] no charId found for "${name}"`); charColorCache[name] = '#888888'; return; }
                console.log(`[charColor] fetching colors for "${name}" (charId=${id})`);
                if (!charDomCache[id]) charDomCache[id] = getDominantColors(id).catch(e => { console.warn(`[charColor] image failed for ${id}:`, e); return []; });
                const list = await charDomCache[id];
                console.log(`[charColor] dominant colors for "${name}":`, list);
                charColorCache[name] = list.length ? list[0].hex : '#888888';
                console.log(`[charColor] assigned "${name}" → ${charColorCache[name]}`);
            })();
        });
        await Promise.all(charNames.map(n => charResolveCache[n]).filter(Boolean));
    }

    function charColor(name) {
        return charColorCache[name] || '#888888';
    }

    let chartDmgShare = null;
    let chartBuff = null;
    let dmgShareVersion = 0;
    let buffChartVersion = 0;

    // ── Shared helpers ────────────────────────────────────────────
    function getPlayerHits() {
        return allEvents.filter(ev =>
            ev.Type === 'Hit' && (ev.HitConfig || {}).sourceType === 1
        );
    }
    function getCharName(ev) {
        return (ev.HitConfig && ev.HitConfig.charName)
            ? ev.HitConfig.charName
            : (ev.AttackerDisplay || ev.Attacker || '?');
    }
    function getDmgTypeName(ev) {
        return dtName((ev.HitConfig || {}).damageType);
    }
    function getDefenderName(ev) {
        return ev.DefenderDisplay || ev.Defender || '?';
    }
    function getSkillLabel(ev) {
        const hc = ev.HitConfig || {};
        const char = getCharName(ev);
        return `${char} / ${hc.skillTitle || '?'} #${hc.hitNum ?? '?'}`;
    }

    // ── Chart 1: Damage Share ─────────────────────────────────────
    function buildSlices() {
        const groupBy     = document.getElementById('dsGroupBy').value;
        const granularity = document.getElementById('dsGranularity').value;
        const metric      = document.getElementById('dsMetric').value;
        const filterChar  = document.getElementById('dsFilterChar').value;
        const filterType  = document.getElementById('dsFilterType').value;
        const filterDef   = document.getElementById('dsFilterDefender').value;
        const sortBy      = document.getElementById('dsSort').value;

        const map = {};
        getPlayerHits().forEach(ev => {
            const hc      = ev.HitConfig || {};
            const dp      = ev.DamageParams || {};
            const char    = getCharName(ev);
            const dmgtype = getDmgTypeName(ev);
            const def     = getDefenderName(ev);

            if (filterChar && char !== filterChar) return;
            if (filterType && dmgtype !== filterType) return;
            if (filterDef  && def   !== filterDef)   return;

            const groupName = groupBy === 'char' ? char : dmgtype;

            let key;
            if (granularity === 'none') {
                key = groupName;
            } else if (granularity === 'skill') {
                key = groupBy === 'dmgtype'
                    ? `${groupName}|${char}`
                    : `${groupName}|${hc.skillTitle || '?'}`;
            } else {
                key = groupBy === 'dmgtype'
                    ? `${groupName}|${char}|${hc.skillTitle || '?'} #${hc.hitNum ?? '?'}`
                    : `${groupName}|${hc.skillTitle || '?'}|#${hc.hitNum ?? '?'}`;
            }

            if (!map[key]) map[key] = { groupName, char, dmgtype, skillTitle: hc.skillTitle || '?', value: 0 };
            const dmg  = Number(dp.finalDamage) || 0;
            const mult = dp.skillPercentAmend != null ? dp.skillPercentAmend / 10000 : 0;
            map[key].value += metric === 'dmg' ? dmg : metric === 'multiplier' ? mult : 1;
        });

        let slices = Object.entries(map).map(([key, d]) => ({
            ...d,
            label: key.split('|').join(' › ')
        }));

        if (sortBy === 'value')   slices.sort((a, b) => b.value - a.value);
        else if (sortBy === 'char')    slices.sort((a, b) => a.char.localeCompare(b.char) || b.value - a.value);
        else if (sortBy === 'dmgtype') slices.sort((a, b) => a.dmgtype.localeCompare(b.dmgtype) || b.value - a.value);
        else if (sortBy === 'skill')   slices.sort((a, b) => a.skillTitle.localeCompare(b.skillTitle) || b.value - a.value);

        return slices;
    }

    function makePieChart(canvasId, labels, values, colors, metric) {
        const isFloat = metric === 'multiplier';
        return new Chart(document.getElementById(canvasId), {
            type: 'pie',
            data: {
                labels,
                datasets: [{ data: values, backgroundColor: colors, borderColor: '#1a1a1a', borderWidth: 2 }]
            },
            options: {
                animation: false, responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label(ctx) {
                                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                                const pct = total > 0 ? (ctx.raw / total * 100).toFixed(1) : 0;
                                const val = isFloat ? ctx.raw.toFixed(2) + '%' : Number(ctx.raw).toLocaleString();
                                return ` ${val} (${pct}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    function renderLegend(tableId, labels, values, colors, metric) {
        const total = values.reduce((s, v) => s + v, 0);
        const isFloat = metric === 'multiplier';
        document.getElementById(tableId).innerHTML = labels.map((name, i) => {
            const pct = total > 0 ? (values[i] / total * 100).toFixed(1) : 0;
            const val = isFloat ? values[i].toFixed(2) + '%' : Number(values[i]).toLocaleString();
            return `<tr>
                <td><span class="leg-color" style="background:${colors[i]}"></span></td>
                <td class="leg-name" title="${esc(name)}">${esc(name)}</td>
                <td class="leg-val">${val}</td>
                <td class="leg-pct">${pct}%</td>
            </tr>`;
        }).join('');
    }

    // Darken/lighten a hex color by shifting lightness
    function tintCharColor(hex, idx, total, depth) {
        const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
        const rn = r/255, gn = g/255, bn = b/255;
        const max = Math.max(rn,gn,bn), min = Math.min(rn,gn,bn);
        let h, s, l = (max+min)/2;
        if (max === min) { h = s = 0; } else {
            const d = max - min;
            s = l > 0.5 ? d/(2-max-min) : d/(max+min);
            switch(max) {
                case rn: h = ((gn-bn)/d + (gn<bn?6:0))/6; break;
                case gn: h = ((bn-rn)/d + 2)/6; break;
                default: h = ((rn-gn)/d + 4)/6;
            }
        }
        const n = Math.max(total, 1);
        const [lMax, lMin] = depth === 1 ? [0.65, 0.35] : [0.62, 0.30];
        const newL = lMax - (idx / n) * (lMax - lMin);
        return `hsl(${Math.round(h*360)}, ${Math.round(Math.max(s,0.4)*100)}%, ${Math.round(newL*100)}%)`;
    }

    async function refreshDmgShareChart() {
        const version = ++dmgShareVersion;
        if (chartDmgShare) { chartDmgShare.destroy(); chartDmgShare = null; }

        const slices = buildSlices();
        const metric = document.getElementById('dsMetric').value;
        const granularity = document.getElementById('dsGranularity').value;
        const depth = granularity === 'none' ? 0 : granularity === 'skill' ? 1 : 2;

        if (!slices.length) {
            document.getElementById('chartDmgShare').style.display = 'none';
            document.getElementById('legendDmgShare').innerHTML =
                '<tr><td style="color:#555;font-style:italic;padding:8px">No player hit data</td></tr>';
            return;
        }

        const uniqueGroups = [...new Set(slices.map(s => s.groupName))];
        await resolveCharColors(uniqueGroups);
        if (version !== dmgShareVersion) return;

        if (chartDmgShare) { chartDmgShare.destroy(); chartDmgShare = null; }

        const groupCounts = {}, groupIdx = {};
        if (depth > 0) slices.forEach(s => { groupCounts[s.groupName] = (groupCounts[s.groupName] || 0) + 1; });

        const labels = [], values = [], colors = [];
        slices.forEach(s => {
            labels.push(s.label); values.push(s.value);
            const base = charColor(s.groupName);
            if (depth === 0) {
                colors.push(base);
            } else {
                if (groupIdx[s.groupName] === undefined) groupIdx[s.groupName] = 0;
                colors.push(tintCharColor(base, groupIdx[s.groupName]++, groupCounts[s.groupName], depth));
            }
        });

        document.getElementById('chartDmgShare').style.display = '';
        chartDmgShare = makePieChart('chartDmgShare', labels, values, colors, metric);
        renderLegend('legendDmgShare', labels, values, colors, metric);
    }

    function updateDmgShareFilters() {
        const hits = getPlayerHits();
        const chars = new Set(), types = new Set(), defs = new Set();
        const defDmg = {};
        hits.forEach(ev => {
            chars.add(getCharName(ev));
            types.add(getDmgTypeName(ev));
            const d = getDefenderName(ev);
            defs.add(d);
            defDmg[d] = (defDmg[d] || 0) + (Number((ev.DamageParams || {}).finalDamage) || 0);
        });

        const selChar = document.getElementById('dsFilterChar');
        const selType = document.getElementById('dsFilterType');
        const selDef  = document.getElementById('dsFilterDefender');
        const curChar = selChar.value, curType = selType.value, curDef = selDef.value;

        selChar.innerHTML = '<option value="">All</option>';
        [...chars].sort().forEach(n => { const o = document.createElement('option'); o.value = n; o.textContent = n; selChar.appendChild(o); });

        selType.innerHTML = '<option value="">All</option>';
        [...types].sort().forEach(n => { const o = document.createElement('option'); o.value = n; o.textContent = n; selType.appendChild(o); });

        selDef.innerHTML = '<option value="">All</option>';
        [...defs].sort().forEach(n => { const o = document.createElement('option'); o.value = n; o.textContent = n; selDef.appendChild(o); });

        if ([...selChar.options].some(o => o.value === curChar)) selChar.value = curChar;
        if ([...selType.options].some(o => o.value === curType)) selType.value = curType;

        if (!curDef && defs.size > 0) {
            const topDef = Object.entries(defDmg).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
            selDef.value = topDef;
        } else if ([...selDef.options].some(o => o.value === curDef)) {
            selDef.value = curDef;
        }
    }

    // ── Chart 2: Buff / Effect Presence ──────────────────────────

    function getActiveSrcs() {
        const srcs = [];
        document.querySelectorAll('.bp-src-btn').forEach(btn => {
            if (btn.dataset.active === '1') srcs.push(btn.dataset.src);
        });
        return srcs.length ? srcs : [];
    }

    function getBuffItems(ev, src) {
        if (src === 'attackerBuffs'  && ev.AttackerBuffs?.buffs)
            return ev.AttackerBuffs.buffs.map(b => ({ id: String(b.id ?? b.configId ?? b.name), name: b.name, stacks: Number(b.stack ?? b.stacks ?? b.count ?? 1) }));
        if (src === 'defenderBuffs'  && ev.DefenderBuffs?.buffs)
            return ev.DefenderBuffs.buffs.map(b => ({ id: String(b.id ?? b.configId ?? b.name), name: b.name, stacks: Number(b.stack ?? b.stacks ?? b.count ?? 1) }));
        if (src === 'attackerEffects' && ev.AttackerEffects?.effects) {
            const m = new Map();
            ev.AttackerEffects.effects.forEach(e => {
                const id = String(e.configId ?? e.id ?? e.name);
                if (!m.has(id)) m.set(id, { name: e.name, stacks: 0 });
                m.get(id).stacks++;
            });
            return [...m.entries()].map(([id, v]) => ({ id, name: v.name, stacks: v.stacks }));
        }
        if (src === 'defenderEffects' && ev.DefenderEffects?.effects) {
            const m = new Map();
            ev.DefenderEffects.effects.forEach(e => {
                const id = String(e.configId ?? e.id ?? e.name);
                if (!m.has(id)) m.set(id, { name: e.name, stacks: 0 });
                m.get(id).stacks++;
            });
            return [...m.entries()].map(([id, v]) => ({ id, name: v.name, stacks: v.stacks }));
        }
        if (src === 'attackerAttrDict' && ev.AttackerAttrDict?.length) {
            const m = new Map();
            ev.AttackerAttrDict.forEach(a => {
                const id = String(a.attrId);
                if (!m.has(id)) m.set(id, { name: a.name || id, stacks: 0 });
                m.get(id).stacks += a.stacks ?? 1;
            });
            return [...m.entries()].map(([id, v]) => ({ id, name: v.name, stacks: v.stacks }));
        }
        if (src === 'defenderAttrDict' && ev.DefenderAttrDict?.length) {
            const m = new Map();
            ev.DefenderAttrDict.forEach(a => {
                const id = String(a.attrId);
                if (!m.has(id)) m.set(id, { name: a.name || id, stacks: 0 });
                m.get(id).stacks += a.stacks ?? 1;
            });
            return [...m.entries()].map(([id, v]) => ({ id, name: v.name, stacks: v.stacks }));
        }
        return [];
    }

    const srcPfx    = { attackerBuffs: '[AB]', attackerEffects: '[AE]', defenderBuffs: '[DB]', defenderEffects: '[DE]', attackerAttrDict: '[AA]', defenderAttrDict: '[DA]' };
    const srcLabel  = { attackerBuffs: 'Attacker Buffs', attackerEffects: 'Attacker Effects', defenderBuffs: 'Defender Buffs', defenderEffects: 'Defender Effects', attackerAttrDict: 'Attacker Attrs', defenderAttrDict: 'Defender Attrs' };
    const srcColor  = { attackerBuffs: '#6a9fd8', attackerEffects: '#d4a84b', defenderBuffs: '#c0605a', defenderEffects: '#8c4ba0', attackerAttrDict: '#5abf8a', defenderAttrDict: '#bf855a' };

    function buffKey(src, id) { return `${srcPfx[src]}|${id}`; }

    function buildStackingSet(hits, activeSrcs) {
        const stacking = new Set();
        hits.forEach(ev => {
            activeSrcs.forEach(src => {
                getBuffItems(ev, src).forEach(item => {
                    if (item.stacks > 1) stacking.add(buffKey(src, item.id));
                });
            });
        });
        return stacking;
    }

    function updateBuffPickDropdown() {
        const viewBy = document.getElementById('bpViewBy').value;
        const activeSrcs = getActiveSrcs();

        const allHits = getPlayerHits();

        const charSel = document.getElementById('bpFilterChar');
        const curChar = charSel.value;
        const allChars = new Set(allHits.map(ev => getCharName(ev)));
        charSel.innerHTML = '<option value="">All</option>';
        [...allChars].sort().forEach(c => {
            const o = document.createElement('option');
            o.value = c; o.textContent = c; charSel.appendChild(o);
        });
        charSel.value = [...charSel.options].some(o => o.value === curChar) ? curChar : '';

        // Populate defender filter, default to defender with most hits
        const defSel = document.getElementById('bpFilterDefender');
        const curDef = defSel.value;
        const defHits = {};
        allHits.forEach(ev => {
            const d = getDefenderName(ev);
            defHits[d] = (defHits[d] || 0) + 1;
        });
        const allDefs = Object.keys(defHits).sort();
        defSel.innerHTML = '<option value="">All</option>';
        allDefs.forEach(d => {
            const o = document.createElement('option');
            o.value = d; o.textContent = d; defSel.appendChild(o);
        });
        if (!curDef && allDefs.length > 0) {
            const topDef = Object.entries(defHits).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
            defSel.value = topDef;
        } else if ([...defSel.options].some(o => o.value === curDef)) {
            defSel.value = curDef;
        }

        const defFilterVal = defSel.value;
        const hits = allHits
            .filter(ev => !charSel.value || getCharName(ev) === charSel.value)
            .filter(ev => !defFilterVal || getDefenderName(ev) === defFilterVal);

        const sel = document.getElementById('bpPick');
        const cur = sel.value;

        const counts = {};
        const displayName = {};

        hits.forEach(ev => {
            if (viewBy === 'skill') {
                const k = getSkillLabel(ev);
                counts[k] = (counts[k] || 0) + 1;
                displayName[k] = k;
            } else {
                activeSrcs.forEach(src => {
                    const seen = new Map();
                    getBuffItems(ev, src).forEach(item => { seen.set(item.id, item); });
                    seen.forEach((item, id) => {
                        const k = buffKey(src, id);
                        counts[k] = (counts[k] || 0) + 1;
                        displayName[k] = `${srcPfx[src]} ${item.name}`;
                    });
                });
            }
        });

        sel.innerHTML = '<option value="">— pick one —</option>';
        Object.entries(counts).sort((a, b) => (displayName[a[0]] || a[0]).localeCompare(displayName[b[0]] || b[0])).forEach(([k, c]) => {
            const o = document.createElement('option');
            o.value = k;
            const dn = displayName[k] || k;
            const MAX = 38;
            const display = dn.length > MAX ? dn.slice(0, MAX) + '…' : dn;
            o.textContent = `${display} (${c})`;
            o.title = `${dn} (${c} hits)`;
            sel.appendChild(o);
        });
        if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
    }

    function buildMaxStacksMap(hits) {
        const maxStacks = {};
        ['attackerBuffs','attackerEffects','defenderBuffs','defenderEffects','attackerAttrDict','defenderAttrDict'].forEach(src => {
            hits.forEach(ev => {
                getBuffItems(ev, src).forEach(item => {
                    const k = buffKey(src, item.id);
                    if (!maxStacks[k] || item.stacks > maxStacks[k]) maxStacks[k] = item.stacks;
                });
            });
        });
        return maxStacks;
    }

    async function refreshBuffChart() {
        const version = ++buffChartVersion;
        if (chartBuff) { chartBuff.destroy(); chartBuff = null; }

        const viewBy        = document.getElementById('bpViewBy').value;
        const pick          = document.getElementById('bpPick').value;
        const charFilterVal = document.getElementById('bpFilterChar').value;
        const defFilterVal  = document.getElementById('bpFilterDefender').value;
        const activeSrcs    = getActiveSrcs();

        if (!pick) return;

        const allHits = getPlayerHits();
        const hits = allHits
            .filter(ev => !charFilterVal || getCharName(ev) === charFilterVal)
            .filter(ev => !defFilterVal  || getDefenderName(ev) === defFilterVal);

        const stackingSet  = buildStackingSet(allHits, ['attackerBuffs','attackerEffects','defenderBuffs','defenderEffects','attackerAttrDict','defenderAttrDict']);
        const maxStacksMap = buildMaxStacksMap(allHits);

        let labels, datasets;
        let chartMode = 'count';

        if (viewBy === 'skill') {
            const relevant = hits.filter(ev => getSkillLabel(ev) === pick);
            const totalHits = relevant.length;

            const perSrc = {};
            activeSrcs.forEach(src => { perSrc[src] = {}; });

            relevant.forEach(ev => {
                activeSrcs.forEach(src => {
                    const seen = new Map();
                    getBuffItems(ev, src).forEach(item => { seen.set(item.id, item); });
                    seen.forEach((item, id) => {
                        if (!perSrc[src][id]) perSrc[src][id] = { name: item.name, count: 0, stackSum: 0 };
                        perSrc[src][id].count++;
                        perSrc[src][id].stackSum += item.stacks;
                    });
                });
            });

            const nonStackEntries = [], stackEntries = [];
            activeSrcs.forEach(src => {
                Object.entries(perSrc[src]).forEach(([id, d]) => {
                    const e = { src, id, ...d };
                    const k = buffKey(src, id);
                    if (stackingSet.has(k)) stackEntries.push(e);
                    else nonStackEntries.push(e);
                });
            });
            nonStackEntries.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
            stackEntries.sort((a, b) => b.stackSum - a.stackSum || a.name.localeCompare(b.name));

            if (stackEntries.length > 0 && nonStackEntries.length === 0) {
                chartMode = 'stacks';
                const globalMax = Math.max(...stackEntries.map(e => maxStacksMap[buffKey(e.src, e.id)] ?? 1));
                const avgValues = stackEntries.map(e => e.stackSum / totalHits);
                const normValues = avgValues.map(v => v / globalMax);
                labels = stackEntries.map((e, i) => `${srcPfx[e.src]} ${e.name}  ~${avgValues[i].toFixed(2)}`);
                datasets = [{
                    label: 'Avg Stacks',
                    data: normValues,
                    _avgStacks: avgValues,
                    _maxStacks: globalMax,
                    _entries: stackEntries,
                    _maxStacksMap: maxStacksMap,
                    _totalHits: totalHits,
                    backgroundColor: stackEntries.map(e => srcColor[e.src]),
                    borderColor: '#1a1a1a', borderWidth: 1
                }];
            } else if (nonStackEntries.length > 0 && stackEntries.length === 0) {
                chartMode = 'count';
                const allEntries = nonStackEntries;
                labels = allEntries.map(e => `${srcPfx[e.src]} ${e.name}`);
                datasets = activeSrcs.map(src => ({
                    label: srcLabel[src],
                    data: allEntries.map(e => e.src === src ? e.count : 0),
                    _totalHits: totalHits,
                    _entries: allEntries,
                    _stackingSet: stackingSet,
                    _maxStacksMap: maxStacksMap,
                    backgroundColor: srcColor[src],
                    borderColor: '#1a1a1a', borderWidth: 1
                }));
            } else {
                chartMode = 'count';
                const allEntries = [...nonStackEntries, ...stackEntries];
                allEntries.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
                labels = allEntries.map(e => {
                    const k = buffKey(e.src, e.id);
                    const isStk = stackingSet.has(k);
                    const suffix = isStk ? `  ~${(e.stackSum / totalHits).toFixed(2)}` : '';
                    return `${srcPfx[e.src]} ${e.name}${suffix}`;
                });
                datasets = activeSrcs.map(src => ({
                    label: srcLabel[src],
                    data: allEntries.map(e => e.src === src ? e.count : 0),
                    _totalHits: totalHits,
                    _entries: allEntries,
                    _stackingSet: stackingSet,
                    _maxStacksMap: maxStacksMap,
                    backgroundColor: srcColor[src],
                    borderColor: '#1a1a1a', borderWidth: 1
                }));
            }

        } else {
            const [pfxPart, ...idParts] = pick.split('|');
            const buffId = idParts.join('|');
            const detectedSrc = Object.entries(srcPfx).find(([, p]) => p === pfxPart)?.[0] || null;
            const isStacking = stackingSet.has(pick);
            const maxStk = maxStacksMap[pick] ?? 1;

            const skillData = {};
            const skillTotals = {};
            hits.forEach(ev => {
                const sl = getSkillLabel(ev);
                skillTotals[sl] = (skillTotals[sl] || 0) + 1;
                if (!skillData[sl]) skillData[sl] = { count: 0, stackSum: 0, char: getCharName(ev) };
                const srcsToCheck = detectedSrc ? [detectedSrc] : activeSrcs;
                srcsToCheck.forEach(src => {
                    getBuffItems(ev, src).forEach(item => {
                        if (String(item.id) === buffId) {
                            skillData[sl].count++;
                            skillData[sl].stackSum += item.stacks;
                        }
                    });
                });
            });

            const sorted = Object.entries(skillData)
                .filter(([, d]) => d.count > 0)
                .sort((a, b) => (a[1].char || '?').localeCompare(b[1].char || '?') || a[0].localeCompare(b[0]));

            const uniqueChars = [...new Set(sorted.map(([, d]) => d.char).filter(Boolean))];
            await resolveCharColors(uniqueChars);
            if (version !== buffChartVersion) return;

            const barColors = sorted.map(([, d]) => charColor(d.char || '?'));
            const pickOpt = [...document.getElementById('bpPick').options].find(o => o.value === pick);
            const pickName = pickOpt ? pickOpt.title.replace(/ \(\d+ hits\)$/, '') : pick;

            if (isStacking) {
                chartMode = 'stacks';
                const avgValues = sorted.map(([sl]) => skillData[sl].stackSum / (skillTotals[sl] || 1));
                const normValues = avgValues.map(v => v / maxStk);

                labels = sorted.map(([sl], i) => `${sl}  ~${avgValues[i].toFixed(2)}`);
                datasets = [{
                    label: pickName,
                    data: normValues,
                    _avgStacks: avgValues,
                    _maxStacks: maxStk,
                    _totalCounts: sorted.map(([sl]) => skillTotals[sl] || 0),
                    _rawCounts: sorted.map(([sl]) => skillData[sl].count),
                    backgroundColor: barColors,
                    borderColor: '#1a1a1a', borderWidth: 1
                }];
            } else {
                chartMode = 'percent';
                const pctValues = sorted.map(([sl]) => Math.round(skillData[sl].count / (skillTotals[sl] || 1) * 1000) / 10);
                labels = sorted.map(([sl], i) => `${sl}  ${pctValues[i]}%`);
                datasets = [{
                    label: pickName,
                    data: pctValues,
                    _rawCounts: sorted.map(([sl]) => skillData[sl].count),
                    _totalCounts: sorted.map(([sl]) => skillTotals[sl] || 0),
                    backgroundColor: barColors,
                    borderColor: '#1a1a1a', borderWidth: 1
                }];
            }
        }

        if (!labels.length) return;

        const rowH = 28;
        const h = Math.max(260, labels.length * rowH + 60);
        const wrap = document.getElementById('chartBuff').parentElement;
        wrap.style.height = h + 'px';

        if (chartBuff) { chartBuff.destroy(); chartBuff = null; }

        const xMax   = chartMode === 'percent' ? 100 : chartMode === 'stacks' ? 1 : undefined;
        const xStacked = chartMode === 'count';

        chartBuff = new Chart(document.getElementById('chartBuff'), {
            type: 'bar',
            data: { labels, datasets },
            options: {
                animation: false,
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        stacked: xStacked,
                        grid: { color: '#2a2a2a' },
                        ticks: {
                            color: '#888', font: { size: 11 },
                            callback: chartMode === 'percent' ? v => v + '%'
                                    : chartMode === 'stacks'  ? v => {
                                        const mx = datasets[0]?._maxStacks ?? 1;
                                        return (v * mx).toFixed(1);
                                    }
                                    : undefined
                        },
                        max: xMax
                    },
                    y: {
                        stacked: xStacked,
                        grid: { color: '#2a2a2a' },
                        ticks: { color: '#ccc', font: { size: 11 } }
                    }
                },
                plugins: {
                    legend: {
                        display: datasets.length > 1,
                        labels: { color: '#aaa', font: { size: 11 }, boxWidth: 12 }
                    },
                    tooltip: {
                        callbacks: {
                            label(ctx) {
                                const i = ctx.dataIndex;
                                if (chartMode === 'stacks') {
                                    const avg = ctx.dataset._avgStacks?.[i];
                                    if (avg !== undefined) {
                                        const max = ctx.dataset._maxStacks ?? '?';
                                        return ` ${ctx.dataset.label}: ${avg.toFixed(2)} / ${max} stacks`;
                                    }
                                    const entries = ctx.dataset._entries;
                                    const mxMap   = ctx.dataset._maxStacksMap;
                                    const totalHits = ctx.dataset._totalHits ?? 1;
                                    if (entries) {
                                        const e = entries[i];
                                        const k = buffKey(e.src, e.id);
                                        const avgE = e.stackSum / totalHits;
                                        const max  = mxMap?.[k] ?? '?';
                                        return ` ${ctx.dataset.label}: ${avgE.toFixed(2)} / ${max} stacks`;
                                    }
                                    return ` ${ctx.dataset.label}: ${ctx.raw}`;
                                }
                                if (chartMode === 'percent') {
                                    const raw   = ctx.dataset._rawCounts?.[i] ?? '?';
                                    const total = ctx.dataset._totalCounts?.[i] ?? '?';
                                    return ` ${ctx.dataset.label}: ${ctx.raw}% (${raw}/${total} hits)`;
                                }
                                const entries  = ctx.dataset._entries;
                                const stacking = ctx.dataset._stackingSet;
                                const mxMap    = ctx.dataset._maxStacksMap;
                                const totalHits= ctx.dataset._totalHits ?? '?';
                                if (entries && stacking && ctx.raw > 0) {
                                    const e = entries[i];
                                    const k = buffKey(e.src, e.id);
                                    if (stacking.has(k)) {
                                        const th = typeof totalHits === 'number' ? totalHits : 1;
                                        const avg = (e.stackSum / th).toFixed(2);
                                        const max = mxMap?.[k] ?? '?';
                                        return ` ${ctx.dataset.label}: ${ctx.raw} / ${totalHits} hits  |  ~${avg} / ${max} stacks`;
                                    }
                                }
                                return ` ${ctx.dataset.label}: ${ctx.raw} / ${totalHits} hits`;
                            }
                        }
                    }
                }
            }
        });
    }

    function onBpSrcToggle(btn) {
        const isOn = btn.dataset.active === '1';
        btn.dataset.active = isOn ? '0' : '1';
        btn.style.opacity = isOn ? '0.45' : '1';
        updateBuffPickDropdown();
        refreshBuffChart();
    }

    function onBpViewByChange() {
        updateBuffPickDropdown();
        refreshBuffChart();
    }

    // ── Full refresh ──────────────────────────────────────────────
    function refresh() {
        updateDmgShareFilters();
        updateBuffPickDropdown();
        refreshDmgShareChart();
        refreshBuffChart();
        updateCritDistFilters();
        refreshCritDist();
    }

    // ── Chart 3: Crit Distribution ─────────────────────────────────
    function updateCritDistFilters() {
        const sel = document.getElementById('cdFilterChar');
        const cur = sel.value;
        const chars = new Set(getPlayerHits().map(ev => getCharName(ev)));
        sel.innerHTML = '<option value="">All</option>';
        [...chars].sort().forEach(c => {
            const o = document.createElement('option');
            o.value = c; o.textContent = c; sel.appendChild(o);
        });
        if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
    }

    function refreshCritDist() {
        const charFilter = document.getElementById('cdFilterChar').value;
        const hits = getPlayerHits().filter(ev => !charFilter || getCharName(ev) === charFilter);
        const container = document.getElementById('critDistTable');
        if (!container) return;

        if (!hits.length) {
            container.innerHTML = '<div class="chart-empty">No player hit data</div>';
            return;
        }

        // Accumulate crit distribution stats
        let totalBaseDmg = 0;
        let expectedExtra = 0;
        let actualExtra = 0;
        let varianceSum = 0;
        let varianceSqSum = 0;
        let critHits = 0;
        const emptySet = new Set();
        const emptyBonus = { baseAtk:0, atkPct:0 };
        // Ensure all dcBonus keys exist
        DC_FIELDS.forEach(f => { emptyBonus[f.key] = 0; });
        ['genDmg','intensity','finalDmg','genDmgRcd','toughnessBroken','pen','res','effectiveDef','critRate','critDmg','defAmend','baseAtk','atkPct'].forEach(k => { emptyBonus[k] = 0; });

        for (const ev of hits) {
            const fields = calcHitFields(ev, null, emptySet);

            // Base multiplier (same as dcCalcCritLuck without dcBonus/dcDisabled)
            let bm = (fields.baseAtk + (emptyBonus.baseAtk || 0)) * (fields.atkPct + (emptyBonus.atkPct || 0)) + fields.atkAbs;
            for (const key of DC_FORMULA_KEYS) {
                if (key === 'atkMulti' || key === 'critDmg') continue;
                let val;
                if (key === 'penRes')
                    val = calcPenRes(fields._aStats, fields._dStats, fields._el, 0, 0);
                else if (key === 'defAmend') {
                    val = fields.defAmend;
                } else
                    val = fields[key] != null ? fields[key] : 1;
                bm *= val;
            }

            totalBaseDmg += bm;

            const cr = fields.critRate;
            const cd = fields.critDmg;
            const extra = bm * (cd - 1);

            expectedExtra += extra * cr;
            if (fields.isCrit) { actualExtra += extra; critHits++; }
            const p = cr, s = extra;
            const varI = p * (1 - p) * s * s;
            varianceSum += varI;
            varianceSqSum += varI * varI;
        }

        if (expectedExtra === 0) {
            container.innerHTML = '<div class="chart-empty">No crit-variable hits (crit rate is 0)</div>';
            return;
        }

        const stddev = Math.sqrt(Math.max(0, varianceSum));
        const nEff = varianceSum > 0 && varianceSqSum > 0 ? varianceSum * varianceSum / varianceSqSum : 0;
        const zScore = stddev > 0 ? (actualExtra - expectedExtra) / stddev : 0;
        const myPct = _normalCdf(zScore) * 100;

        // Practical error estimate: ~95% coverage for weighted-Bernoulli distributions
        const pracErr = nEff > 0 ? 0.15 / Math.sqrt(nEff) / (1 + zScore * zScore / 6) : 0;
        const pracErrPct = Math.min(pracErr * 100, 10);
        const pctLower = Math.max(0, myPct - pracErrPct);
        const pctUpper = Math.min(100, myPct + pracErrPct);

        const expectedTotal = totalBaseDmg + expectedExtra;
        const actualTotal = totalBaseDmg + actualExtra;

        // Build table
        const PCTS = [99, 95, 90, 75, 50, 25, 10, 5, 1];
        const myCls = myPct >= 50 ? 'ei-pos' : 'ei-neg';
        const actualVsExp = actualTotal / expectedTotal * 100;

        // Build all rows (PCTS + user) into an array, sorted by percentile descending
        const rows = [];
        for (const p of PCTS) {
            const z = _normalQuantile(p / 100);
            const totalAtP = expectedTotal + z * stddev;
            const vsExp = totalAtP / expectedTotal * 100;
            rows.push({
                sortKey: p, label: p + 'th', dmg: totalAtP,
                vs: p === 50 ? '—' : (vsExp >= 100 ? '+' : '') + (vsExp - 100).toFixed(1) + '%',
                cls: p === 50 ? '' : vsExp > 100 ? 'ei-pos' : 'ei-neg',
                isExpected: p === 50,
            });
        }
        rows.push({
            sortKey: myPct, label: 'You (' + myPct.toFixed(1) + 'th)', dmg: actualTotal,
            vs: (actualVsExp >= 100 ? '+' : '') + (actualVsExp - 100).toFixed(1) + '%',
            cls: myCls, isActual: true,
        });
        rows.sort((a, b) => b.sortKey - a.sortKey);

        const nEffInt = Math.round(nEff);
        const pctRange = pracErrPct > 0.1
            ? `<span style="color:#888"> (${pctLower.toFixed(1)}th – ${pctUpper >= 99.95 ? '99.9+' : pctUpper.toFixed(1)}th)</span>`
            : '';
        let rowsHtml = `<div class="cd-summary">
            <span class="cd-summary-item">Your total: <strong class="${myCls}">${Math.round(actualTotal).toLocaleString()}</strong></span>
            <span class="cd-summary-item">Expected (50th): <strong>${Math.round(expectedTotal).toLocaleString()}</strong></span>
            <span class="cd-summary-item">Your percentile: <strong class="${myCls}">${myPct.toFixed(1)}th</strong>${pctRange}</span>
            <span class="cd-summary-item">Eff. crit rolls: <strong title="Effective number of independent crit events (n_eff). Lower = wider Berry-Esseen range.">${nEffInt.toLocaleString()}</strong></span>
        </div>`;

        rowsHtml += `<table class="cd-table"><thead><tr>
            <th class="cd-th cd-th-pct">Percentile</th>
            <th class="cd-th cd-th-dmg">Total Damage</th>
            <th class="cd-th cd-th-vs">vs Expected</th>
        </tr></thead><tbody>`;

        for (const r of rows) {
            const extraCls = r.isExpected ? ' cd-row-expected' : r.isActual ? ' cd-row-actual' : '';
            const dmgCls = r.isExpected ? ' cd-td-expected' : '';
            rowsHtml += `<tr class="cd-row${extraCls}">
                <td class="cd-td cd-td-pct">${r.isActual ? '<strong class="' + myCls + '">' : ''}${r.label}${r.isActual ? '</strong>' : ''}</td>
                <td class="cd-td cd-td-dmg${dmgCls}">${r.isActual ? '<strong class="' + myCls + '">' : ''}${Math.round(r.dmg).toLocaleString()}${r.isActual ? '</strong>' : ''}</td>
                <td class="cd-td cd-td-vs ${r.cls}">${r.vs}</td>
            </tr>`;
        }

        rowsHtml += `</tbody></table>`;

        // Bar: visual indicator of your position
        const barPct = Math.max(2, Math.min(98, myPct));
        const barColor = myPct >= 50 ? '#4a7a55' : '#7a3838';
        rowsHtml += `<div class="cd-bar-wrap">
            <div class="cd-bar-label">0th</div>
            <div class="cd-bar-track">
                <div class="cd-bar-fill" style="width:${barPct}%;background:${barColor}"></div>
                <div class="cd-bar-marker" style="left:${barPct}%"></div>
                <div class="cd-bar-label cd-bar-label-marker" style="left:${barPct}%">${myPct.toFixed(1)}th</div>
                <div class="cd-bar-tick" style="left:25%"></div>
                <div class="cd-bar-tick" style="left:50%"></div>
                <div class="cd-bar-tick" style="left:75%"></div>
            </div>
            <div class="cd-bar-label">100th</div>
        </div>`;

        container.innerHTML = rowsHtml;
    }

    // Initialize toggle button active states (AE + DE on by default)
    (function initSrcToggles() {
        const defaults = new Set(['attackerEffects', 'defenderEffects', 'attackerAttrDict', 'defenderAttrDict']);
        document.querySelectorAll('.bp-src-btn').forEach(btn => {
            const on = defaults.has(btn.dataset.src);
            btn.dataset.active = on ? '1' : '0';
            btn.style.opacity = on ? '1' : '0.45';
        });
    })();

    return {
        refresh,
        refreshDmgShareChart,
        refreshBuffChart,
        refreshCritDist,
        onGroupByChange: refreshDmgShareChart,
        onBpViewByChange,
        onBpSrcToggle,
        refreshDamageTypeChart: refreshDmgShareChart
    };
})();

// Hook into data fetch to refresh charts if analytics tab is active
const _origRefilter = refilterAndRender;
refilterAndRender = function(...args) {
    _origRefilter(...args);
    if (activeTab === 'analytics') Analytics.refresh();
};
