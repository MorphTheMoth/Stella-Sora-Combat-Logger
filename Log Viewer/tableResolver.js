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

// int configId -> suppressed (boolean set, stored as Set<int>)
const suppressedIds = new Set();

// int skillId -> { ownerName, skillType, skillName, fcPath }
const skillTable    = new Map();

// Attribute index -> name string
const ATTR_NAMES = [
    'NONE','ATK','DEF','MAXHP','HITRATE','EVD','CRITRATE','CRITRESIST',
    'CRITPOWER_P','PENETRATE','DEF_IGNORE','WER','FER','SER','AER','LER',
    'DER','WEE','FEE','SEE','AEE','LEE','DEE','WEP','FEP','SEP','AEP',
    'LEP','DEP','WEI','FEI','SEI','AEI','LEI','DEI','WEERCD','FEERCD',
    'SEERCD','AEERCD','LEERCD','DEERCD','WEIGHT','TOUGHNESS_MAX',
    'TOUGHNESS_DAMAGE_ADJUST','SHIELD_MAX','[45]','MOVESPEED','ATKSPD_P',
    'INTENSITY','GENDMG','DMGPLUS','FINALDMG','FINALDMGPLUS','GENDMGRCD',
    'DMGPLUSRCD','SUPPRESS','NORMALDMG','SKILLDMG','ULTRADMG','OTHERDMG',
    'RCDNORMALDMG','RCDSKILLDMG','RCDULTRADMG','RCDOTHERDMG','MARKDMG',
    'RCDMARKDMG','SUMMONDMG','RCDSUMMONDMG','PROJECTILEDMG','RCDPROJECTILEDMG',
    'NORMALCRITRATE','SKILLCRITRATE','ULTRACRITRATE','MARKCRITRATE',
    'SUMMONCRITRATE','PROJECTILECRITRATE','OTHERCRITRATE','NORMALCRITPOWER',
    'SKILLCRITPOWER','ULTRACRITPOWER','MARKCRITPOWER','SUMMONCRITPOWER',
    'PROJECTILECRITPOWER','OTHERCRITPOWER','ENERGY_MAX','SKILL_INTENSITY',
    'TOUGHNESS_BROKEN_DMG','ADD_SHIELD_STRENGTHEN','BE_ADD_SHIELD_STRENGTHEN',
    'NORMAL_SUPPRESS','SKILL_SUPPRESS','ULTRA_SUPPRESS','MARK_SUPPRESS',
    'SUMMON_SUPPRESS','PROJECTILE_SUPPRESS','OTHER_SUPPRESS','ENV_AMEND','MAX',
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

function isSuppressed(configId) {
    return suppressedIds.has(configId);
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
        }
    }

    // Buff/effect lists — resolve names
    enrichBuffList(ev.AttackerBuffs);
    enrichBuffList(ev.DefenderBuffs);
    enrichEffectList(ev.AttackerEffects);
    enrichEffectList(ev.DefenderEffects);
    enrichAttrDictList(ev.AttackerAttrDict);
    enrichAttrDictList(ev.DefenderAttrDict);

    // Attr name injection
    enrichAttrList(ev.AttackerStats?.attrs);
    enrichAttrList(ev.AttackerSpecial?.specialAttrs);
    enrichAttrList(ev.DefenderStats?.attrs);
    enrichAttrList(ev.DefenderSpecial?.specialAttrs);
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
    }
}

function enrichAttrList(attrs) {
    if (!Array.isArray(attrs)) return;
    for (const a of attrs) {
        a.name = attrName(a.id);
    }
}

function enrichAttrDictList(attrDictList) {
    if (!Array.isArray(attrDictList)) return;
    for (const entry of attrDictList) {
        if (entry.attrId != null) {
            entry.configId = entry.attrId;
            entry.name = buffIdToName(entry.attrId);
        }
    }
}

// ─── Table initialisation ─────────────────────────────────────────────────────

let _dataRoot = 'https://raw.githubusercontent.com/AutumnVN/StellaSoraData/refs/heads/main/';

async function loadJson(path, tag) {
    try {
        const res = await fetch(path);
        if (!res.ok) { console.warn(`[${tag}] ${path} HTTP ${res.status}`); return null; }
        return await res.json();
    } catch (e) {
        console.warn(`[${tag}] failed to load ${path}:`, e);
        return null;
    }
}

// ─── Prefix helpers ──────────────────────────────────────

const BUFF_PREFIXES = [
    'Buff,LevelUp,',
    'Effect,LevelUp,',
    'EffectValue,NoLevel,',
    'BuffValue,NoLevel,',
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

function resolveLocKey(obj, field, langMap) {
    if (!(field in obj)) return '?';
    const key = obj[field];
    return langMap[key] ?? '?';
}

function charNameFromMap(charMap, charId) {
    return charMap[charId]?.name ?? '?';
}

function insertEffect(configId, charName, label, ldt, overwriteUnresolved = false) {
    const existing = effectTable.get(configId);
    if (!existing) {
        effectTable.set(configId, { charName, label, levelTypeData: ldt });
    } else if (overwriteUnresolved && existing.label === '?') {
        effectTable.set(configId, { charName, label, levelTypeData: ldt });
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
            forEachParam(sval, val => { if (val === needle) { found = true; return true; } });
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
        hitTable.set(hitId, { charName, skillTitle, hitNum });
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
                hitTable.set(hitId, { charName, skillTitle: itemName, hitNum });
            });
        }
    }
}

// ─── buildEffectTable ─────────────────────────────────────────────────────────

function buildEffectTable(dataFiles, jChar, jSkill, jSkillLang, jPotential) {
    effectTable.clear();
    suppressedIds.clear();

    const {
        jEffect, jItem, jItemLang, jMainSkill, jMainSkillLang,
        jFloorBuff, jSubNote, jAffinityLevel, jEffectValue,
        jAffix, jAffixLang, jGem, jBuffVal, jMonster,
        jBuff, jBuffValue, jWord, jWordLang, jTalent, jTalentLang,
        jSecSkill, jDisc, jScoreBoss, jScoreBossLang, jItemLangRoot,
        jOnceAttr, jSecSkillLang,
    } = dataFiles;

    const charMap = {};
    for (const [ckey, cval] of Object.entries(jChar)) {
        if (cval.name) charMap[parseInt(ckey, 10)] = cval;
    }
    const charName = (id) => charNameFromMap(charMap, id);

    // SubNoteSkill + AffinityLevel suppression
    const subNoteEffectIds  = new Set();
    const affinityEffectIds = new Set();
    if (jSubNote) {
        for (const [, val] of Object.entries(jSubNote)) {
            for (const id of (val.EffectId ?? [])) { subNoteEffectIds.add(id); suppressedIds.add(id); }
        }
    }
    if (jAffinityLevel) {
        for (const [, val] of Object.entries(jAffinityLevel)) {
            for (const id of (val.Effect ?? [])) { affinityEffectIds.add(id); suppressedIds.add(id); }
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
            effectTable.set(effId, { charName: cname, label: skillTitle, levelTypeData: 3 });
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

            if (ldt === 1 && effEntry.LevelData) {
                const iit = jItem?.[String(effEntry.LevelData)];
                if (iit) label = resolveLocKey(iit, 'Title', jItemLang ?? {});
            } else if (ldt === 3) {
                label = buffIdToSkillTitle.get(configId) ?? '?';
            }
            effectTable.set(configId, { charName: cname, label, levelTypeData: ldt });
        }
    }

    // TravelerDuelChallengeAffix pass
    if (jAffix && jAffixLang) {
        for (const [, val] of Object.entries(jAffix)) {
            const name = resolveLocKey(val, 'Name', jAffixLang);
            if (name === '?') continue;
            forEachBuffParam(val, (_prefix, effId) => {
                if (!effId || effectTable.has(effId)) return;
                effectTable.set(effId, { charName: '?', label: 'Affix: ' + name, levelTypeData: 0 });
            });
        }
    }

    // FloorBuff suppression
    if (jFloorBuff) {
        for (const [, fbVal] of Object.entries(jFloorBuff)) {
            for (const id of (fbVal.EffectId ?? [])) suppressedIds.add(id);
        }
    }

    // CharGemAttrValue suppression
    if (jGem) {
        for (const [, gval] of Object.entries(jGem)) {
            if (gval.EffectId != null) suppressedIds.add(gval.EffectId);
        }
    }

    // Monster buff suppression
    if (jBuffVal && jMonster) {
        const buffValEffects = new Map();
        for (const [bvKey, bvVal] of Object.entries(jBuffVal)) {
            if (!bvVal.Effects) continue;
            buffValEffects.set(parseInt(bvKey, 10), bvVal.Effects);
        }
        for (const [, mVal] of Object.entries(jMonster)) {
            for (const buffId of (mVal.BuffIds ?? [])) {
                const effs = buffValEffects.get(buffId);
                if (effs) for (const effId of effs) suppressedIds.add(effId);
            }
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
                    effectTable.set(buffId, { charName: cname, label, levelTypeData: -1 });
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
                effectTable.set(bvId, { charName: cname, label, levelTypeData: -1 });
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
                effectTable.set(effId, { charName: cname, label, levelTypeData: -1 });
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
                effectTable.set(effId, { charName: '?', label: 'Word: ' + name, levelTypeData: 0 });
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
            forEachBuffParam(tval, (_prefix, effId) => {
                if (!effId || effectTable.has(effId)) return;
                effectTable.set(effId, { charName: cname, label: 'Talent: ' + talentTitle, levelTypeData: 0 });
            });
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
            effectTable.set(configId, { charName: cname, label, levelTypeData: 0 });
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
                        effectTable.set(buffId, { charName: '?', label, levelTypeData: 0 });
                }
            }
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
            effectTable.set(buffId, { charName: '?', label, levelTypeData: -1 });
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
            effectTable.set(buffId, { charName: cname, label: potName, levelTypeData: -1 });
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
        [631014002, 'Enemy', 'Forbidden Beauty / Meticulously Crafted'],
        [631014022, 'Enemy', 'Forbidden Beauty / Meticulously Crafted'],
        [155310101, 'Shia',  'Electro Music'],
    ];
    for (const [id, cname, label] of hardcoded)
        effectTable.set(id, { charName: cname, label, levelTypeData: -1 });
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
        skillTable.set(skillId, { ownerName: '', skillType: '', skillName: briefDesc, fcPath });
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
        jFloorBuff, jSubNote, jAffinityLevel, jEffectValue,
        jAffix, jAffixLang, jGem, jBuffVal, jMonster,
        jBuff, jBuffValue, jWord, jWordLang, jTalent, jTalentLang,
        jSecSkill, jOnceAttr, jDisc, jScoreBoss, jScoreBossLang,
        jPotential, jMonsterSkin, jItemLangRoot, jSecSkillLang,
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
        loadJson(`${bin}AffinityLevel.json`,                 'affinity'),
        loadJson(`${bin}EffectValue.json`,                   'effectValue'),
        loadJson(`${bin}TravelerDuelChallengeAffix.json`,    'affix'),
        loadJson(`${lang}TravelerDuelChallengeAffix.json`,   'affixLang'),
        loadJson(`${bin}CharGemAttrValue.json`,              'gem'),
        loadJson(`${bin}BuffValue.json`,                     'buffVal'),
        loadJson(`${bin}Monster.json`,                       'monster'),
        loadJson(`${bin}Buff.json`,                          'buff'),
        loadJson(`${bin}BuffValue.json`,                     'buffValue'),
        loadJson(`${bin}Word.json`,                          'word'),
        loadJson(`${lang}Word.json`,                         'wordLang'),
        loadJson(`${bin}Talent.json`,                        'talent'),
        loadJson(`${lang}Talent.json`,                       'talentLang'),
        loadJson(`${bin}SecondarySkill.json`,                'secSkill'),
        loadJson(`${bin}OnceAdditionalAttribute.json`,       'onceAttr'),
        loadJson(`${_dataRoot}disc.json`,                    'disc'),
        loadJson(`${bin}ScoreBossAbility.json`,              'scoreBoss'),
        loadJson(`${lang}ScoreBossAbility.json`,             'scoreBossLang'),
        loadJson(`${bin}Potential.json`,                     'potential'),
        loadJson(`${bin}MonsterSkin.json`,                   'monsterSkin'),
        loadJson(`${lang}Item.json`,                         'itemLangRoot'),
        loadJson(`${lang}SecondarySkill.json`,                'secSkillLang'),
    ]);

    if (!jChar || !jSkill || !jSkillLang) {
        console.error('[tableResolver] Missing required data files — tables not built');
        return;
    }

    buildActorNameMap(jChar, jMonsterSkin);

    if (jHit) {
        buildHitTable(jHit, jSkill, jSkillLang, jChar, jPotential, jItemRoot);
    }

    buildEffectTable({
        jEffect, jItem, jItemLang, jMainSkill, jMainSkillLang,
        jFloorBuff, jSubNote, jAffinityLevel, jEffectValue,
        jAffix, jAffixLang, jGem, jBuffVal, jMonster,
        jBuff, jBuffValue, jWord, jWordLang, jTalent, jTalentLang,
        jSecSkill, jOnceAttr, jDisc, jScoreBoss, jScoreBossLang,
        jItemRoot, jItemLangRoot, jSecSkillLang,
    }, jChar, jSkill, jSkillLang, jPotential);

    buildSkillTable(jChar, jSkill, jSkillLang);

    console.log(`[tableResolver] Ready — actors:${actorNameMap.size} hits:${hitTable.size} effects:${effectTable.size} suppressed:${suppressedIds.size} skills:${skillTable.size}`);
}
