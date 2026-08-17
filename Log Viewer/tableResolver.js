// tableResolver.js
// Call initTables(dataRoot) once on startup (or after a data reload).
// Then use the resolver functions below to enrich raw log events.
//
// dataRoot is the base URL (or path prefix) where the game data files live:
//   <dataRoot>/character.json
//   <dataRoot>/item.json
//   <dataRoot>/disc.json
//   <dataRoot>/EN/bin/HitDamage.json  (etc.)
//   <dataRoot>/EN/language/en_US/Skill.json  (etc.)


// ─── tables ─────────────────────────────────────────────────────────

// int id -> string name  (players keyed by dataId, enemies by skinId)
const actorNameMap  = new Map();

// int hitDamageId -> { charName, skillTitle, hitNum }
const hitTable      = new Map();

// int configId -> { charName, label, levelTypeData }
const effectTable   = new Map();

// int configId -> { effectType, attrType, subType, value }  (from EffectValue.json)
const effectValueTable = new Map();

// int valueConfigId -> [{ attrType, subType, value }, ...]  (from OnceAdditionalAttributeValue.json)
const onceAttrValueTable = new Map();

// ─── EffectType enum ──────────────────────────────────────────────────────────
const EFFECT_TYPE_NAMES = {
    1:'STATE_CHANGE', 2:'CURRENTCD', 3:'CD', 6:'ADDBUFF', 7:'ADD_SKILL_LV',
    8:'SET_SKILL_LV', 9:'IMM_BUFF', 10:'ADDSKILLAMOUNT', 11:'RESUMSKILLAMOUNT',
    12:'ATTR_FIX', 13:'REMOVE_BUFF', 14:'EFFECT_CD_FIX', 15:'EFFECT_MAX_CD_FIX',
    16:'AMEND_NO_COST', 17:'DAMAGE_IMM_ACC', 18:'EFFECT_MUL', 19:'EFFECT_HP_RECOVRY',
    21:'KILL_IMMEDIATELY', 22:'ADD_BUFF_DURATION_EXISTING', 23:'HIT_ELEMENT_TYPE_EXTEND',
    24:'CHANGE_EFFECT_RATE', 25:'ADD_TAG', 27:'EFFECT_HP_REVERTTO', 28:'EFFECT_HP_ABSORB',
    29:'CHANGE_BUFF_LAMINATEDNUM', 30:'CHANGE_BUFF_TIME', 34:'SPECIAL_ATTR_FIX',
    35:'AMMO_FIX', 36:'MONSTER_ATTR_FIX', 37:'PLAYER_ATTR_FIX', 38:'IMMUNE_DEAD',
    39:'ENTER_TRANSPARENT', 40:'UNABLE_RECOVER_ENERGY', 41:'CLEAR_MONSTER_AI_BRANCH_CD',
    42:'ADD_SHIELD', 43:'REDUCE_HP_BY_CURRENTHP', 44:'REDUCE_HP_BY_MAXHP',
    45:'HITTED_ADDITIONAL_ATTR_FIX', 46:'ATTR_ASSIGNMENT', 47:'CAST_AREAEFFECT',
    48:'PASSIVE_SKILL', 49:'IMM_CERTAIN_HITDAMAGEID', 50:'STATE_AMOUNT',
    51:'DROP_ITEM_PICKUP_RANGE_FIX', 52:'ELEMENTTYPE_ATTR_FIX', 53:'DAMAGETYPE_ATTR_FIX',
    54:'HITTED_ADDITIONAL_ELEMENTTYPE_ATTR_FIX', 55:'HITTED_ADDITIONAL_DAMAGETYPE_ATTR_FIX',
    56:'ELEMENTTYPE_ATTR_PERCENT_FIX', 57:'DAMAGETYPE_ATTR_PERCENT_FIX',
    58:'HITTED_ADDITIONAL_ELEMENTTYPE_ATTR_PERCENT_FIX',
    59:'HITTED_ADDITIONAL_DAMAGETYPE_ATTR_PERCENT_FIX',
    60:'ELEMENTTYPE_ATTR_ASSIGNMENT', 61:'DAMAGETYPE_ATTR_ASSIGNMENT',
    62:'ELEMENTTYPE_ATTR_PERCENT_ASSIGNMENT', 63:'DAMAGETYPE_ATTR_PERCENT_ASSIGNMENT',
};
const EFFECT_SUBTYPE_NAMES = { 1:'Base', 2:'Pct', 3:'Abs' };

function effectTypeName(v) { return v != null ? (EFFECT_TYPE_NAMES[v] || v + ' (?)') : ''; }
function effectSubTypeName(v, mainType = 12) {

  if (effectTypeName(mainType).includes("ATTR") && [12, 52, 54].includes(effectTypeName(mainType)))
    console.log(`Weird effect type: ${effectTypeName(mainType)}, subType: ${v}`)
  if (mainType == 52) return 'Base';
  if (mainType == 54) return 'Pct';
  return v != null ? (EFFECT_SUBTYPE_NAMES[v] || v + ' (?)') : ''; 
}

function effectTypeHasAttr(et) {
    const name = EFFECT_TYPE_NAMES[et] || '';
    return name.includes('ATTR');
}

// ─── Level map resolution ─────────────────────────────────────────────────────
// Looks up a configId in the levelMap (populated from /api/levelmap).
// Returns { levelTypeData, levelData, allValueConfigIds } or defaults.
function resolveLevelMap(configId) {
    const entry = levelMap.get(configId);
    if (entry) {
        return {
            levelTypeData: entry.lt,
            levelData: entry.ld,
            allValueConfigIds: entry.vc.map(v => ({ level: v.l, valueConfigId: v.v }))
        };
    }
    return { levelTypeData: 0, levelData: 0, allValueConfigIds: [] };
}

// int skillId -> { ownerName, skillType, skillName, fcPath }
const skillTable    = new Map();

// Attribute index -> name string
const ATTR_NAMES = [
    "None", "Atk", "Def", "Max Hp", "Hit Rate", "Evd", "Crit Rate", "Crit Resist",
    "Crit Damage", "Penetrate", "Def Ignore", "Wer", "Fer", "Ser",
    "Aer", "Ler", "Der", "Aqua Dmg", "Ignis Dmg", "Terra Dmg", "Ventus Dmg", "Lux Dmg",
    "Umbra Dmg", "Aqua Pen", "Ignis Pen", "Terra Pen", "Ventus Pen", "Lux Pen", "Umbra Pen", "Wei",
    "Fei", "Sei", "Aei", "Lei", "Dei", "Rcd Aqua Dmg", "Rcd Ignis Dmg", 
    "Rcd Terra Dmg", "Rcd Ventus Dmg", "Rcd Lux Dmg", "Rcd Umbra Dmg", "Weight",
    "Toughness Max", "Toughness Damage Adjust", "Shield Max", "",
    "Move Speed", "Atk Spd P", "Intensity", "Gen Dmg", "Dmg Plus",
    "Final Dmg", "Final Dmg Plus", "Gen Dmg Rcd", "Dmg Plus Rcd",
    "Suppress", "Normal Dmg", "Skill Dmg", "Ultra Dmg", "Other Dmg",
    "Rcd Normal Dmg", "Rcd Skill Dmg", "Rcd Ultra Dmg", "Rcd Other Dmg",
    "Mark Dmg", "Rcd Mark Dmg", "Minion Dmg", "Rcd Minion Dmg",
    "Derivative Dmg", "Rcd Derivative Dmg", "Normal Crit Rate",
    "Skill Crit Rate", "Ultra Crit Rate", "Mark Crit Rate", "Minion Crit Rate",
    "Derivative Crit Rate", "Other Crit Rate", "Normal Crit Damage",
    "Skill Crit Damage", "Ultra Crit Damage", "Mark Crit Damage",
    "Minion Crit Damage", "Derivative Crit Damage", "Other Crit Damage",
    "Energy Max", "Skill Intensity", "Toughness Broken Dmg",
    "Add Shield Strengthen", "Be Add Shield Strengthen", "Normal Suppress",
    "Skill Suppress", "Ultra Suppress", "Mark Suppress", "Minion Suppress",
    "Derivative Suppress", "Other Suppress", "Env Amend",
];

function attrName(i) {
    return ATTR_NAMES[i] ?? '?';
}

// ─── Actor key resolution ────────────────────────────────────────────────────
// C++ now emits "p:<dataId>" for players and "e:<skinId>" for enemies.

function resolveActorKey(key) {
    if (!key || key === 'null') return '?';
    const colon = key.indexOf(':');
    if (colon === -1) return key;          // old format fallback
    const id = parseInt(key.slice(colon + 1), 10);
    const isPlayer = key[0] === 'p';
    const name = actorNameMap.get(id) ?? String(id);
    if (isPlayer) return name;
    return `${name} (skinId=${id})`;       // enemies keep id visible for debugging
}

// ─── Name helpers ─────────────────────────────────────────────────────────────

function buffIdToName(configId) {
    const ei = effectTable.get(configId);
    if (!ei) return `configId=${configId} (unknown)`;
    return (ei.charName && ei.charName !== '?')
        ? `${ei.charName} / ${ei.label}`
        : ei.label;
}

// ─── Event enrichment (called from dataLoader.js after fetch) ─────────────────
// Mutates the event object in place, adding display-friendly fields.

function enrichEvent(ev) {
    switch (ev.Type) {
        case 'Hit':        enrichHit(ev);       break;
        case 'Buff':       enrichBuff(ev);      break;
        case 'Skill Cast': enrichSkillCast(ev); break;
    }
}

function enrichHit(ev) {
    // Actor display names
    if (ev.Attacker)       ev.AttackerDisplay = resolveActorKey(ev.Attacker);
    if (ev.Defender)       ev.DefenderDisplay = resolveActorKey(ev.Defender);

    // HitConfig resolution
    const hc = ev.HitConfig;
    if (hc) {
        const h = hitTable.get(hc.hitDamageId);
        if (h) {
            hc.charName   = h.charName;
            hc.skillTitle = h.skillTitle;
            hc.hitNum     = h.hitNum;
            ev.source     = h.source;
        }
        if (hc.energyCharge != null) hc.energyCharge /= 10000;
    }

    // Buff/effect lists — resolve names
    enrichBuffList(ev.AttackerBuffs);
    enrichBuffList(ev.DefenderBuffs);
    enrichEffectList(ev.AttackerEffects);
    enrichEffectList(ev.DefenderEffects);
    enrichAttrDictList(ev.AttackerAttrDict);
    enrichAttrDictList(ev.DefenderAttrDict);

    // Attr name injection
    padStats(ev.AttackerStats?.attrs);
    padStats(ev.DefenderStats?.attrs);
    enrichAttrList(ev.AttackerStats?.attrs);
    enrichAttrList(ev.AttackerSpecial?.specialAttrs);
    enrichAttrList(ev.DefenderStats?.attrs);
    enrichAttrList(ev.DefenderSpecial?.specialAttrs);
}

function padStats(attrList) {
  if (!attrList) return;
  for (let i = 0; i <= 97; i++)
    if (!attrList[i] || (attrList[i].id != null && attrList[i].id > i))
      attrList.splice(i, 0, {origin: 0, base: 0, pct: 0, abs: 0, limPct: 0});
}

function enrichBuff(ev) {
    if (ev.Owner)  ev.OwnerDisplay  = resolveActorKey(ev.Owner);
    if (ev.Source) ev.SourceDisplay = resolveActorKey(ev.Source);

    const ei = effectTable.get(ev.ConfigId);
    if (ei) {
        ev.Name = ei.label;
        if (ei.charName && ei.charName !== '?') ev.CharName = ei.charName;
    } else {
        ev.Name = 'Unknown';
    }
}

function enrichSkillCast(ev) {
    const s = skillTable.get(ev.SkillId);
    if (s) {
        ev.Name      = s.skillName || 'Unknown';
        ev.Owner     = s.ownerName;
        ev.SkillType = s.skillType;
        ev.FCPath    = s.fcPath;
    } else {
        ev.Name = 'Unknown';
    }
}

function enrichBuffList(buffList) {
    if (!buffList?.buffs) return;
    for (const b of buffList.buffs) {
        b.name = buffIdToName(b.configId);
    }
}

function enrichEffectList(effectList) {
    if (!effectList?.effects) return;
    for (const e of effectList.effects) {
        e.name = buffIdToName(e.configId);
        const ei = effectTable.get(e.configId);
        if (ei) e.source = ei.source ?? 'Unknown';
        const ev = effectValueTable.get(e.valueConfigId);
        if (ev) {
            if (ev.attrType != null) e.effectType  = ev.effectType;
            if (ev.attrType != null) e.attrType    = ev.attrType;
            if (ev.subType  != null) e.subType     = ev.subType;
            if (ev.value    != null) e.value       = ev.value;
        }
        // Retrocompat: extract old-format level data into levelMap
        if (e.allValueConfigIds && e.configId != null && !levelMap.has(e.configId)) {
            levelMap.set(e.configId, {
                lt: e.levelTypeData || 0,
                ld: e.levelData || 0,
                vc: e.allValueConfigIds.map(v => ({ l: v.level, v: v.valueConfigId }))
            });
        }
    }
}

function enrichAttrList(attrs) {
    if (!Array.isArray(attrs)) return;
    attrs.forEach((a, i) => {
        if (!a) return;
        a.name = attrName(i);
    });
}

function enrichAttrDictList(attrDictList) {
    if (!Array.isArray(attrDictList)) return;
    let i = 0;
    while (i < attrDictList.length) {
        const entry = attrDictList[i];
        if (entry._dictEnriched) { i++; continue; }

        if (entry.attrId != null) {
            entry.configId = entry.attrId;
            entry.name = buffIdToName(entry.attrId);
            const ei = effectTable.get(entry.attrId);
            if (ei) entry.source = ei.source ?? 'Unknown';
        }
        const vcId = entry.valueConfigId != null ? parseInt(entry.valueConfigId, 10) : null;
        if (vcId) {
            const slots = onceAttrValueTable.get(vcId);
            if (slots && slots.length > 0) {
                const s1 = slots[0];
                entry.attrType = s1.attrType;
                entry.subType  = s1.subType;
                entry.value    = s1.value;
                entry._dictEnriched = true;

                for (let sn = 1; sn < slots.length; sn++) {
                    const sx = slots[sn];
                    const extra = Object.assign({}, entry);
                    extra.attrType = sx.attrType;
                    extra.subType  = sx.subType;
                    extra.value    = sx.value;
                    extra.name     = (entry.name || String(entry.attrId || '')) + ' #' + (sn + 1);
                    extra._dictEnriched = true;
                    attrDictList.splice(i + sn, 0, extra);
                }
                // Retrocompat: extract old-format level data into levelMap
                const cid0 = entry.configId ?? entry.attrId;
                if (cid0 != null && entry.allValueConfigIds && !levelMap.has(cid0)) {
                    levelMap.set(cid0, {
                        lt: entry.levelTypeData || 0,
                        ld: entry.levelData || 0,
                        vc: entry.allValueConfigIds.map(v => ({ l: v.level, v: v.valueConfigId }))
                    });
                }
                i += slots.length;
                continue;
            }
        }
        entry._dictEnriched = true;
        // Retrocompat: extract old-format level data into levelMap
        const cid = entry.configId ?? entry.attrId;
        if (cid != null && entry.allValueConfigIds && !levelMap.has(cid)) {
            levelMap.set(cid, {
                lt: entry.levelTypeData || 0,
                ld: entry.levelData || 0,
                vc: entry.allValueConfigIds.map(v => ({ l: v.level, v: v.valueConfigId }))
            });
        }
        i++;
    }
}

// ─── Table initialisation ─────────────────────────────────────────────────────

let _dataRoot = '/api/stella-data/';

const LOAD_TIMEOUT_MS = 3000;
const CACHE_NAME = 'tableResolver-v1';

async function _saveToCache(path, data, etag) {
    try {
        const cache = await caches.open(CACHE_NAME);
        const headers = { 'Content-Type': 'application/json' };
        if (etag) headers['x-cached-etag'] = etag;
        await cache.put(path, new Response(JSON.stringify(data), { headers }));
    } catch (e) {
        console.warn(`[cache] failed to save ${path}:`, e);
    }
}

async function _loadFromCache(path, tag) {
    try {
        const cache = await caches.open(CACHE_NAME);
        const res = await cache.match(path);
        if (res) {
            const etag = res.headers.get('x-cached-etag');
            return { data: await res.json(), etag };
        }
    } catch (e) {
        console.warn(`[${tag}] cache read failed for ${path}:`, e);
    }
    return { data: null, etag: null };
}

async function loadJson(path, tag) {
    const { data: cachedData, etag: cachedEtag } = await _loadFromCache(path, tag);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);

    try {
        const reqHeaders = {};
        if (cachedEtag) reqHeaders['If-None-Match'] = cachedEtag;

        const res = await fetch(path, { signal: controller.signal, headers: reqHeaders });
        clearTimeout(timer);

        if (res.status === 304) return cachedData;

        if (!res.ok) {
            console.warn(`[${tag}] ${path} HTTP ${res.status} — ${cachedData ? 'using cache' : 'no cache available'}`);
            return cachedData;
        }

        const data = await res.json();
        _saveToCache(path, data, res.headers.get('etag'));
        return data;

    } catch (e) {
        clearTimeout(timer);
        if (e.name === 'AbortError') {
            console.warn(`[${tag}] ${path} timed out — ${cachedData ? 'using cache' : 'no cache available'}`);
        } else {
            console.warn(`[${tag}] failed to load ${path}:`, e);
        }
        return cachedData;
    }
}

// ─── Prefix helpers ──────────────────────────────────────

const BUFF_PREFIXES = [
    'Buff,LevelUp,',
    'BuffValue,NoLevel,',
    'Effect,LevelUp,',
    'EffectValue,NoLevel,',
];
const ATTR_DICT_PREFIXES = [
    'OnceAdditionalAttributeValue,NoLevel,',
    'OnceAdditionalAttribute,LevelUp,',
];
const HIT_DAMAGE_PREFIX = 'HitDamage,DamageNum,';

function extractPrefixedId(param, prefix) {
    if (!param.startsWith(prefix)) return 0;
    const rest  = param.slice(prefix.length);
    const comma = rest.indexOf(',');
    const idStr = comma === -1 ? rest : rest.slice(0, comma);
    const id    = parseInt(idStr, 10);
    return isNaN(id) ? 0 : id;
}

function forEachParam(obj, visitor) {
    for (let n = 1; ; ++n) {
        const key = 'Param' + n;
        if (!(key in obj)) break;
        if (visitor(obj[key]) === true) break;
    }
}

function forEachBuffParam(obj, onMatch) {
    forEachParam(obj, param => {
        for (const prefix of BUFF_PREFIXES) {
            const id = extractPrefixedId(param, prefix);
            if (id) { onMatch(prefix, id); break; }
        }
    });
}

function forEachOnceAdditionalParam(obj, onMatch) {
    forEachParam(obj, param => {
        for (const prefix of ATTR_DICT_PREFIXES) {
            const id = extractPrefixedId(param, prefix);
            if (id) { onMatch(prefix, id); break; }
        }
    });
}

function resolveLocKey(obj, field, langMap) {
    if (!(field in obj)) return '?';
    const key = obj[field];
    return langMap[key] ?? '?';
}

function charNameFromMap(charMap, charId) {
    return charMap[charId]?.name ?? '?';
}

function insertEffect(configId, charName, label, ldt, overwriteUnresolved = false, source = 'Unknown') {
    const existing = effectTable.get(configId);
    if (!existing) {
        effectTable.set(configId, { charName, label, levelTypeData: ldt, source });
    } else if (overwriteUnresolved && existing.label === '?') {
        effectTable.set(configId, { charName, label, levelTypeData: ldt, source });
    }
}

// ─── buildActorNameMap ────────────────────────────────────────────────────────

function buildActorNameMap(jChar, jMonsterSkin) {
    actorNameMap.clear();
    // Players: dataId -> name
    for (const [ckey, cval] of Object.entries(jChar)) {
        if (!cval.name) continue;
        const id = parseInt(ckey, 10);
        if (!isNaN(id)) actorNameMap.set(id, cval.name);
    }
    // Enemies: skinId -> model basename
    if (jMonsterSkin) {
        for (const [, sval] of Object.entries(jMonsterSkin)) {
            if (!sval.Id || !sval.Model) continue;
            const skinId = sval.Id;
            const slash  = sval.Model.lastIndexOf('/');
            actorNameMap.set(skinId, slash !== -1 ? sval.Model.slice(slash + 1) : sval.Model);
        }
    }
}

// ─── buildHitTable ────────────────────────────────────────────────────────────

function buildHitTable(jHit, jSkill, jLang, jChar, jPotential, jItemRoot) {
    hitTable.clear();

    // Build char map from character.json
    const charMap = {};
    for (const [ckey, cval] of Object.entries(jChar)) {
        if (cval.name) charMap[parseInt(ckey, 10)] = cval;
    }

    // Main HitDamage loop
    for (const [key, hitEntry] of Object.entries(jHit)) {
        const hitId  = parseInt(key, 10);
        const charId = Math.trunc(hitId / 1000000);
        const charName   = charNameFromMap(charMap, charId);
        let   skillTitle = '?';
        let   hitNum     = 0;

        const needle = HIT_DAMAGE_PREFIX + hitId;
        for (const [, sval] of Object.entries(jSkill)) {
            let found = false;
            forEachParam(sval, val => {
                if (extractPrefixedId(val, HIT_DAMAGE_PREFIX) === hitId) { found = true; return true; }
            });
            if (found) {
                skillTitle = resolveLocKey(sval, 'Title', jLang);
                let idx = 0;
                forEachParam(sval, val => {
                    if (val.startsWith(HIT_DAMAGE_PREFIX)) {
                        ++idx;
                        if (parseInt(val.slice(HIT_DAMAGE_PREFIX.length), 10) === hitId) hitNum = idx;
                    }
                });
                break;
            }
        }
        const src = charName && charName !== '?' ? `${charName} Skills` : 'Skills';
        hitTable.set(hitId, { charName, skillTitle, hitNum, source: src  });
    }

    // Potential.json pass
    if (jPotential && jItemRoot) {
        for (const [potKey, potVal] of Object.entries(jPotential)) {
            const itemEntry = jItemRoot[potKey];
            const itemName  = itemEntry?.name ?? '?';
            if (itemName === '?') continue;

            const charName = potVal.CharId
                ? charNameFromMap(charMap, potVal.CharId) : '?';

            forEachParam(potVal, param => {
                const hitId = extractPrefixedId(param, HIT_DAMAGE_PREFIX);
                if (!hitId) return;
                const existing = hitTable.get(hitId);
                if (existing && existing.skillTitle !== '?') return;

                let hitNum = 0, hitIdx = 0;
                forEachParam(potVal, mv => {
                    const mvId = extractPrefixedId(mv, HIT_DAMAGE_PREFIX);
                    if (mvId) { ++hitIdx; if (mvId === hitId) hitNum = hitIdx; }
                });
                const src = charName && charName !== '?' ? `${charName} Potentials` : 'Potentials';
                hitTable.set(hitId, { charName, skillTitle: itemName, hitNum, source: src });
            });
        }
    }

    // Hardcoded Hits
    const hardcoded = [
        [155310101, 'Shia', 'Electro Music', 1, 'Potentials'],
        [159322101, 'Springseek Coronis', 'Rose Rapid Bloom', 1, 'Potentials'],
        [114310002, 'Chaton', 'Dark Mark', 1, 'Skills'],
        [114504001, 'Chaton', 'Dark Mark', 2, 'Skills'],
        [114504002, 'Chaton', 'Dark Mark', 3, 'Skills'],
        [114504003, 'Chaton', 'Dark Mark', 4, 'Skills'],
    ];
    for (const [hitId, charName, skillTitle, hitNum, src] of hardcoded)
        hitTable.set(hitId, { charName, skillTitle, hitNum, source: `${charName} ${src}` });
}

// ─── buildEffectTable ─────────────────────────────────────────────────────────

function buildEffectTable(dataFiles) {
    effectTable.clear();

    const {
        jEffect, jItem, jItemLang, jMainSkill, jMainSkillLang,
        jFloorBuff, jSubNote, jAffinityLevel, jEffectValue,
        jAffix, jAffixLang, jGem, jBuffVal, jBuff, jBuffValue, 
        jWord, jWordLang, jTalent, jTalentLang, jSecSkill, 
        jDisc, jScoreBoss, jScoreBossLang, jItemLangRoot, jItemRoot,
        jOnceAttr, jSecSkillLang, jSubNoteLang, jChar, jSkill, 
        jSkillLang, jPotential, jBlitz
    } = dataFiles;

    const charMap = {};
    for (const [ckey, cval] of Object.entries(jChar)) {
        if (cval.name) charMap[parseInt(ckey, 10)] = cval;
    }
    const charName = (id) => charNameFromMap(charMap, id);

    // SubNoteSkill: load language file and insert named effects
    const subNoteEffectIds  = new Set();
    if (jSubNote) {
        const jSubNoteLang = dataFiles.jSubNoteLang;
        for (const [, val] of Object.entries(jSubNote)) {
            const nameKey  = val.Name;                         // e.g. "SubNoteSkill.90020.1"
            const noteName = jSubNoteLang?.[nameKey] ?? nameKey ?? '?';
            const label    = `Note: ${noteName}`;
            for (const id of (val.EffectId ?? [])) {
                subNoteEffectIds.add(id);
                insertEffect(id, '?', label, -1, false, 'Notes');
            }
        }
    }

    // AffinityLevel: insert named effects
    const affinityEffectIds = new Set();
    if (jAffinityLevel) {
        for (const [, val] of Object.entries(jAffinityLevel)) {
            const level = val.AffinityLevel_ ?? '?';
            const label = `Affinity lvl ${level}`;
            for (const id of (val.Effect ?? [])) {
                affinityEffectIds.add(id);
                insertEffect(id, '?', label, -1, false, 'Affinity');
            }
        }
    }

    // buffId -> skill title (from Skill.json ParamN)
    const buffIdToSkillTitle = new Map();
    for (const [, sval] of Object.entries(jSkill)) {
        forEachBuffParam(sval, (_prefix, buffId) => {
            if (!buffIdToSkillTitle.has(buffId))
                buffIdToSkillTitle.set(buffId, resolveLocKey(sval, 'Title', jSkillLang));
        });
    }

    // Skill.json first pass
    for (const [skey, sval] of Object.entries(jSkill)) {
        const skillTitle = resolveLocKey(sval, 'Title', jSkillLang);
        const charId     = Math.trunc(parseInt(skey, 10) / 100000);
        const cname      = charName(charId);
        forEachBuffParam(sval, (_prefix, effId) => {
            if (!effId || effectTable.has(effId)) return;
            const src = cname && cname !== '?' ? `${cname} Skills` : 'Skills';
            effectTable.set(effId, { charName: cname, label: skillTitle, levelTypeData: 3, source: src });
        });
    }

    // Main Effect.json loop
    if (jEffect) {
        for (const [key, effEntry] of Object.entries(jEffect)) {
            if (!('levelTypeData' in effEntry)) continue;
            const configId = parseInt(key, 10);
            const ldt      = effEntry.levelTypeData;
            if (ldt === 5 && subNoteEffectIds.has(configId)) continue;
            if (affinityEffectIds.has(configId)) continue;

            const cname = charName(Math.trunc(configId / 100000));
            let label   = '?';

            // levelTypeData enum (see docs/Enums.md):
            //   Exclusive=1  -> LevelData points at an exclusive item (Potential / skill-strengthen)
            //   SkillSlot=3  -> a character skill buff
            let src;
            if (ldt === 1 && effEntry.LevelData) {
                const iit = jItem?.[String(effEntry.LevelData)];
                if (iit) label = resolveLocKey(iit, 'Title', jItemLang ?? {});
                // The Exclusive LevelData item type decides whether this effect is a Potential
                // or a skill: root item.json entries are typed 'Potential'/'SpecificPotential'.
                const rootItem = jItemRoot?.[String(effEntry.LevelData)];
                const isPotential = rootItem &&
                    (rootItem.type === 'Potential' || rootItem.type === 'SpecificPotential');
                src = isPotential
                    ? (cname && cname !== '?' ? `${cname} Potentials` : 'Potentials')
                    : (cname && cname !== '?' ? `${cname} Skills` : 'Skills');
            } else if (ldt === 3) {
                label = buffIdToSkillTitle.get(configId) ?? '?';
                src   = cname && cname !== '?' ? `${cname} Skills` : 'Skills';
            } else {
                src = cname && cname !== '?' ? `${cname} Skills` : 'Skills';
            }
            effectTable.set(configId, { charName: cname, label, levelTypeData: ldt, source: src });
        }
    }

    // TravelerDuelChallengeAffix pass
    if (jAffix && jAffixLang) {
        for (const [, val] of Object.entries(jAffix)) {
            const name = resolveLocKey(val, 'Name', jAffixLang);
            if (name === '?') continue;
            forEachBuffParam(val, (_prefix, effId) => {
                if (!effId || effectTable.has(effId)) return;
                effectTable.set(effId, { charName: '?', label: 'Affix: ' + name, levelTypeData: 0, source: 'Unknown' });
            });
        }
    }

    // Buff.json pass
    if (jBuff) {
        // Reverse map: buffId -> { potKey, charId } from Potential.json
        const buffIdToPotRef = new Map();
        if (jPotential) {
            const kBVPrefix = 'BuffValue,NoLevel,';
            for (const [potKey, potVal] of Object.entries(jPotential)) {
                const charId = potVal.CharId ?? 0;
                forEachParam(potVal, param => {
                    const buffId = extractPrefixedId(param, kBVPrefix);
                    if (buffId && !buffIdToPotRef.has(buffId))
                        buffIdToPotRef.set(buffId, { potKey, charId });
                });
            }
        }

        const jItemRoot = dataFiles.jItemRoot;
        for (const [bkey, bval] of Object.entries(jBuff)) {
            const buffId = parseInt(bkey, 10);
            if (!buffId || effectTable.has(buffId)) continue;

            // Path 1: Potential reverse-map
            const potRef = buffIdToPotRef.get(buffId);
            if (potRef && jItemRoot) {
                const iit = jItemRoot[potRef.potKey];
                const label = iit?.name ?? '?';
                if (label !== '?') {
                    const cname = potRef.charId ? charName(potRef.charId) : '?';
                    const src   = cname && cname !== '?' ? `${cname} Potentials` : 'Potentials';
                    effectTable.set(buffId, { charName: cname, label, levelTypeData: -1, source: src });
                    continue;
                }
            }
        }
    }

    // BuffValue.json pass (via Potential kBuffPrefixes)
    if (jBuffValue && jPotential) {
        const effectIdToPotRef = new Map();
        for (const [potKey, potVal] of Object.entries(jPotential)) {
            const charId = potVal.CharId ?? 0;
            forEachBuffParam(potVal, (_prefix, effId) => {
                if (effId && !effectIdToPotRef.has(effId))
                    effectIdToPotRef.set(effId, { potKey, charId });
            });
        }
        const jItemRoot = dataFiles.jItemRoot;
        for (const [bvKey, bvVal] of Object.entries(jBuffValue)) {
            const bvId = parseInt(bvKey, 10);
            if (!bvId || effectTable.has(bvId) || !bvVal.Effects) continue;
            for (const effId of bvVal.Effects) {
                const potRef = effectIdToPotRef.get(effId);
                if (!potRef || !jItemRoot) continue;
                const label = jItemRoot[potRef.potKey]?.name ?? '?';
                if (label === '?') continue;
                const cname = potRef.charId ? charName(potRef.charId) : '?';
                const src   = cname && cname !== '?' ? `${cname} Potentials` : 'Potentials';
                effectTable.set(bvId, { charName: cname, label, levelTypeData: -1, source: src });
                break;
            }
        }
    }

    // Potential.json pass (effect IDs in ParamN)
    if (jPotential && dataFiles.jItemRoot) {
        const jItemRoot = dataFiles.jItemRoot;
        for (const [potKey, potVal] of Object.entries(jPotential)) {
            const cname = potVal.CharId ? charName(potVal.CharId) : '?';
            forEachBuffParam(potVal, (_prefix, effId) => {
                if (!effId || effectTable.has(effId)) return;
                const label = jItemRoot[potKey]?.name ?? '?';
                const src   = cname && cname !== '?' ? `${cname} Potentials` : 'Potentials';
                effectTable.set(effId, { charName: cname, label, levelTypeData: -1, source: src });
            });
        }
    }

    // Word.json pass
    if (jWord && jWordLang) {
        for (const [, val] of Object.entries(jWord)) {
            const name = resolveLocKey(val, 'Title', jWordLang);
            if (name === '?') continue;
            forEachBuffParam(val, (_prefix, effId) => {
                if (!effId || effectTable.has(effId)) return;
                effectTable.set(effId, { charName: '?', label: 'Word: ' + name, levelTypeData: 0, source: 'Unknown' });
            });
        }
    }

    // Talent.json pass
    if (jTalent && jTalentLang) {
        for (const [tkey, tval] of Object.entries(jTalent)) {
            const talentTitle = resolveLocKey(tval, 'Title', jTalentLang);
            if (talentTitle === '?') continue;
            const charId = Math.trunc(parseInt(tkey, 10) / 10000);
            const cname  = charName(charId);
            const addTalentTable = (_prefix, effId) => {
                if (!effId || effectTable.has(effId)) return;
                const src = cname && cname !== '?' ? `${cname} Talents` : 'Talents';
                effectTable.set(effId, { charName: cname, label: 'Talent: ' + talentTitle, levelTypeData: 0, source: src });
            };
            forEachBuffParam(tval, addTalentTable);
            forEachOnceAdditionalParam(tval, addTalentTable);
        }
    }

    // OnceAdditionalAttribute.json pass
    if (jOnceAttr) {
        for (const [oaKey, oaVal] of Object.entries(jOnceAttr)) {
            const configId = parseInt(oaKey, 10);
            if (!configId || effectTable.has(configId)) continue;
            const charId = Math.trunc(configId / 100000);
            const cname  = charName(charId);
            let label = '?';
            for (let p = 1; ; ++p) {
                const paramKey = 'Param' + p;
                if (!(paramKey in oaVal)) break;
                const param = oaVal[paramKey];
                for (const prefix of ATTR_DICT_PREFIXES) {
                    const attrId = extractPrefixedId(param, prefix);
                    if (attrId) { label = 'AttrDict:' + attrId; break; }
                }
                if (label !== '?') break;
            }
            effectTable.set(configId, { charName: cname, label, levelTypeData: 0, source: 'Unknown' });
        }
    }

    // ScoreBossAbility.json pass
    if (jScoreBoss && jScoreBossLang) {
        const kSbaPrefixes = ['EffectValue,NoLevel,', 'BuffValue,NoLevel,'];
        for (const [, ability] of Object.entries(jScoreBoss)) {
            const abilityName = resolveLocKey(ability, 'Name', jScoreBossLang);
            if (abilityName === '?') continue;
            const label = 'Boss / ' + abilityName;
            for (let p = 1; p <= 10; ++p) {
                const paramKey = 'Param' + p;
                if (!(paramKey in ability)) continue;
                for (const prefix of kSbaPrefixes) {
                    const buffId = extractPrefixedId(ability[paramKey], prefix);
                    if (buffId && !effectTable.has(buffId))
                        effectTable.set(buffId, { charName: '?', label, levelTypeData: 0, source: 'Unknown' });
                }
            }
        }
    }

    // BossBlitz: effects from Effect.json starting with "63" → map to blitz.json names
    if (jBlitz && jEffect) {
        const blitzNameMap = new Map();
        for (const [, blitzEntry] of Object.entries(jBlitz)) {
            const id = parseInt(blitzEntry.id, 10);
            if (id) blitzNameMap.set(id, blitzEntry.name || '?');
        }
        for (const key of Object.keys(jEffect)) {
            if (!key.startsWith('63')) continue;
            const configId = parseInt(key, 10);
            const prefix = Math.floor(configId / 100) + 10;
            const name = blitzNameMap.get(prefix);
            effectTable.set(configId, { label: `Boss Blitz \\ ${name}`, source: 'Boss Blitz' });
        }
    }

    // Last-resort: 7-digit disc buff ID decode
    //   Digits 1-4: discId
    //   Digit 5:    0 = Melody, 1 = Harmony 1, 2 = Harmony 2
    //   Digits 6-7: ignored for naming
    if (jItemLangRoot) {
        const tryDecodeDisc = (buffId) => {
            if (buffId < 1000000 || buffId > 9999999) return false;
            const discId   = Math.trunc(buffId / 1000);
            const digit5   = Math.trunc(buffId / 100) % 10;
            if (digit5 > 2) return false;
            const discName = jItemLangRoot[`Item.21${discId}.1`];
            if (!discName) return false;
            let label;
            if (digit5 === 0) {
                label = `Disc Melody: ${discName}`;
            } else {
                const harmonyNum  = digit5;
                const secSkillKey = `SecondarySkill.${discId}${digit5}01.1`;
                const harmonyName = jSecSkillLang?.[secSkillKey];
                label = harmonyName
                    ? `Disc Harmony ${harmonyNum}: ${discName} - ${harmonyName}`
                    : `Disc Harmony ${harmonyNum}: ${discName}`;
            }
            effectTable.set(buffId, { charName: '?', label, levelTypeData: -1, source: 'Discs' });
            return true;
        };
        // Pass A: patch unresolved
        for (const [id, val] of effectTable) { if (val.label === '?') tryDecodeDisc(id); }
        // Pass B: Effect.json IDs not yet in table
        if (jEffect) {
            for (const key of Object.keys(jEffect)) {
                const configId = parseInt(key, 10);
                if (!effectTable.has(configId)) tryDecodeDisc(configId);
            }
        }
        // Pass C: Buff.json IDs not yet in table
        if (jBuff) {
            for (const key of Object.keys(jBuff)) {
                const buffId = parseInt(key, 10);
                if (!effectTable.has(buffId)) tryDecodeDisc(buffId);
            }
        }
    }

    // Last-resort: 8-digit buff ID potential decode
    if (jItemLangRoot) {
        const tryDecode = (buffId) => {
            if (buffId < 10000000 || buffId > 99999999) return false;
            const charId = Math.trunc(buffId / 100000);
            const b      = Math.trunc(buffId / 10000) % 10;
            if (b > 5) return false;
            const potNumber = b !== 5
                ? Math.trunc(buffId / 1000) % 100
                : Math.trunc(buffId / 100)  % 100;
            const potNumStr = String(potNumber).padStart(2, '0');
            const langKey   = `Item.5${charId}${potNumStr}.1`;
            const potName   = jItemLangRoot[langKey];
            if (!potName) return false;
            const cname = charName(charId);
            const src   = cname && cname !== '?' ? `${cname} Potentials` : 'Potentials';
            effectTable.set(buffId, { charName: cname, label: potName, levelTypeData: -1, source: src });
            return true;
        };
        // Pass A: patch unresolved
        for (const [id, val] of effectTable) { if (val.label === '?') tryDecode(id); }
        // Pass B: Effect.json IDs not yet in table
        if (jEffect) {
            for (const key of Object.keys(jEffect)) {
                const configId = parseInt(key, 10);
                if (!effectTable.has(configId)) tryDecode(configId);
            }
        }
        // Pass C: Buff.json IDs not yet in table
        if (jBuff) {
            for (const key of Object.keys(jBuff)) {
                const buffId = parseInt(key, 10);
                if (!effectTable.has(buffId)) tryDecode(buffId);
            }
        }
    }

    // Hardcoded effects
    const hardcoded = [
        [990050010, 'Enemy', 'Defense Broken'],
        [990050011, 'Enemy', 'Defense Broken'],
        [990050012, 'Enemy', 'Defense Broken'],
        [13295011,  'Minova', 'Astral Hex'],
        [15503011,  'Shia', 'Moongaze Stacks'],
    ];
    for (const [id, cname, label] of hardcoded)
        effectTable.set(id, { charName: cname, label, levelTypeData: -1, source: 'Unknown' });
}

// ─── buildEffectValueTable ────────────────────────────────────────────────────

function buildEffectValueTable(jEffectValue) {
    effectValueTable.clear();
    if (!jEffectValue) return;
    for (const [key, ev] of Object.entries(jEffectValue)) {
        const configId = parseInt(key, 10);
        if (!configId) continue;
        const et = ev.EffectType != null ? parseInt(ev.EffectType, 10) : null;
        const entry = { effectType: et };
        if (et != null && effectTypeHasAttr(et)) {
            entry.attrType = ev.EffectTypeFirstSubtype != null ? parseInt(ev.EffectTypeFirstSubtype, 10) : null;
            entry.subType  = ev.EffectTypeSecondSubtype != null ? parseInt(ev.EffectTypeSecondSubtype, 10) : null;
            entry.value    = ev.EffectTypeParam1 != null && ev.EffectTypeParam1 !== '' ? parseFloat(ev.EffectTypeParam1) : null;
        }
        effectValueTable.set(configId, entry);
    }
}

// ─── buildOnceAttrValueTable ──────────────────────────────────────────────────

function buildOnceAttrValueTable(jOnceAttrValue) {
    onceAttrValueTable.clear();
    if (!jOnceAttrValue) return;
    for (const [key, oa] of Object.entries(jOnceAttrValue)) {
        const vcId = parseInt(key, 10);
        if (!vcId) continue;
        const slots = [];
        for (let n = 1; n <= 3; n++) {
            const attrType = oa[`AttributeType${n}`];
            const paramType = oa[`ParameterType${n}`];
            const rawVal   = oa[`Value${n}`];
            if (!attrType && !paramType && !rawVal) continue;
            const at = attrType != null ? parseInt(attrType, 10) : null;
            const pt = paramType != null ? parseInt(paramType, 10) : null;
            const vv = rawVal != null ? rawVal / 10000 : null;
            if (!at && !pt) continue;          // truly empty slot
            slots.push({ slotNum: n, attrType: at, subType: pt, value: vv });
        }
        if (slots.length) onceAttrValueTable.set(vcId, slots);
    }
}

// ─── buildSkillTable ──────────────────────────────────────────────────────────

function buildSkillTable(jChar, jSkill, jSkillLang) {
    skillTable.clear();

    const kSkillTypes = ['normalAtk', 'skill', 'supportSkill', 'ultimate'];

    // Case 1: character skills from character.json
    for (const [, cval] of Object.entries(jChar)) {
        if (!cval.name) continue;
        for (const stype of kSkillTypes) {
            const sval = cval[stype];
            if (!sval?.id || !sval.name) continue;
            skillTable.set(sval.id, {
                ownerName: cval.name, skillType: stype,
                skillName: sval.name, fcPath: '',
            });
        }
    }

    // Case 2: fallback from Skill.json
    for (const [skey, sval] of Object.entries(jSkill)) {
        const skillId = parseInt(skey, 10);
        if (skillTable.has(skillId)) continue;
        const fcPath    = sval.FCPath ?? '';
        let   briefDesc = resolveLocKey(sval, 'BriefDesc', jSkillLang);
        if (briefDesc === '?') briefDesc = '';
        const ownerId = parseInt(skillId.toString().slice(0,3));
        skillTable.set(skillId, { ownerName: actorNameMap.get(ownerId) ?? String(ownerId), skillType: '', skillName: briefDesc, fcPath });
    }
}

// ─── Public init ─────────────────────────────────────────────────────────────

async function initTables(dataRoot) {
    const bin  = `${_dataRoot}EN/bin/`;
    const lang = `${_dataRoot}EN/language/en_US/`;

    // Load all files in parallel
    const [
        jChar, jHit, jSkill, jSkillLang, jItemRoot,
        jEffect, jItem, jItemLang, jMainSkill, jMainSkillLang,
        jFloorBuff, jSubNote, jSubNoteLang, jAffinityLevel, jEffectValue,
        jAffix, jAffixLang, jGem, jBuffVal,
        jBuff, jBuffValue, jWord, jWordLang, jTalent, jTalentLang,
        jSecSkill, jOnceAttr, jOnceAttrValue, jDisc, jScoreBoss, jScoreBossLang,
        jPotential, jMonsterSkin, jItemLangRoot, jSecSkillLang, jBlitz,
    ] = await Promise.all([
        loadJson(`${_dataRoot}character.json`,               'char'),
        loadJson(`${bin}HitDamage.json`,                     'hit'),
        loadJson(`${bin}Skill.json`,                         'skill'),
        loadJson(`${lang}Skill.json`,                        'skillLang'),
        loadJson(`${_dataRoot}item.json`,                    'itemRoot'),
        loadJson(`${bin}Effect.json`,                        'effect'),
        loadJson(`${bin}Item.json`,                          'item'),
        loadJson(`${lang}Item.json`,                         'itemLang'),
        loadJson(`${bin}MainSkill.json`,                     'mainSkill'),
        loadJson(`${lang}MainSkill.json`,                    'mainSkillLang'),
        loadJson(`${bin}FloorBuff.json`,                     'floorBuff'),
        loadJson(`${bin}SubNoteSkill.json`,                  'subNote'),
        loadJson(`${lang}SubNoteSkill.json`,                 'subNoteLang'),
        loadJson(`${bin}AffinityLevel.json`,                 'affinity'),
        loadJson(`${bin}EffectValue.json`,                   'effectValue'),
        loadJson(`${bin}TravelerDuelChallengeAffix.json`,    'affix'),
        loadJson(`${lang}TravelerDuelChallengeAffix.json`,   'affixLang'),
        loadJson(`${bin}CharGemAttrValue.json`,              'gem'),
        loadJson(`${bin}BuffValue.json`,                     'buffVal'),
        loadJson(`${bin}Buff.json`,                          'buff'),
        loadJson(`${bin}BuffValue.json`,                     'buffValue'),
        loadJson(`${bin}Word.json`,                          'word'),
        loadJson(`${lang}Word.json`,                         'wordLang'),
        loadJson(`${bin}Talent.json`,                        'talent'),
        loadJson(`${lang}Talent.json`,                       'talentLang'),
        loadJson(`${bin}SecondarySkill.json`,                'secSkill'),
        loadJson(`${bin}OnceAdditionalAttribute.json`,       'onceAttr'),
        loadJson(`${bin}OnceAdditionalAttributeValue.json`,  'onceAttrValue'),
        loadJson(`${_dataRoot}disc.json`,                    'disc'),
        loadJson(`${bin}ScoreBossAbility.json`,              'scoreBoss'),
        loadJson(`${lang}ScoreBossAbility.json`,             'scoreBossLang'),
        loadJson(`${bin}Potential.json`,                     'potential'),
        loadJson(`${bin}MonsterSkin.json`,                   'monsterSkin'),
        loadJson(`${lang}Item.json`,                         'itemLangRoot'),
        loadJson(`${lang}SecondarySkill.json`,               'secSkillLang'),
        loadJson(`${_dataRoot}blitz.json`,                   'blitz'),
    ]);

    if (!jChar || !jSkill || !jSkillLang) {
        console.error('[tableResolver] Missing required data files — tables not built');
        return;
    }

    buildEffectValueTable(jEffectValue);
    buildOnceAttrValueTable(jOnceAttrValue);

    buildActorNameMap(jChar, jMonsterSkin);

    if (jHit) {
        buildHitTable(jHit, jSkill, jSkillLang, jChar, jPotential, jItemRoot);
    }

    buildEffectTable({
        jEffect, jItem, jItemLang, jMainSkill, jMainSkillLang,
        jFloorBuff, jSubNote, jSubNoteLang, jAffinityLevel, jEffectValue,
        jAffix, jAffixLang, jGem, jBuffVal,
        jBuff, jBuffValue, jWord, jWordLang, jTalent, jTalentLang,
        jSecSkill, jOnceAttr, jDisc, jScoreBoss, jScoreBossLang,
        jItemRoot, jItemLangRoot, jSecSkillLang,
        jChar, jSkill, jSkillLang, jPotential, jBlitz
    });

    buildSkillTable(jChar, jSkill, jSkillLang);

    console.log(`[tableResolver] Ready — actors:${actorNameMap.size} hits:${hitTable.size} effects:${effectTable.size} skills:${skillTable.size}`);
}
