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
// Fallback level metadata straight from the datamine (Effect.json /
// OnceAdditionalAttribute.json): configId -> { lt, ld, mos }. Consulted when
// the DLL's levelMap.txt has no entry for a config (old saved logs captured
// before the level map existed, or effects never seen live) so skill-scaled
// rows still resolve their slot. The value ladder itself is derived on demand
// via deriveLevelCandidates (dmgCalc.calc.js).
const effectLevelMetaFallback = new Map();
// Effect.json MainOrSupport flag: 1 = MAINCONTROL (authored under the main
// skill), 2 = SUPPORT (authored under the support skill — e.g. Tilia's
// 10795002 belongs to support skill 10732000 while 10793005 belongs to main
// skill 10731000). Used to pin support-authored effects to the support-skill
// level row when the owner's deployment role is unknown (no record log).
const effectMainOrSupport = new Map();

function resolveLevelMap(configId) {
    const entry = levelMap.get(configId);
    if (entry && entry.t !== 'hit') {
        return {
            levelTypeData: entry.lt,
            levelData: entry.ld,
            allValueConfigIds: (entry.vc || []).map(v => ({ level: v.l, valueConfigId: v.v }))
        };
    }
    const fb = effectLevelMetaFallback.get(configId);
    if (fb) return { levelTypeData: fb.lt, levelData: fb.ld, allValueConfigIds: [] };
    return { levelTypeData: 0, levelData: 0, allValueConfigIds: [] };
}

// Datamine hit ladder fallback — hitDamageId -> levelMap-style "hit" entry
// built from the served HitDamage.json (SkillPercentAmend & co. are the same
// per-level arrays the DLL captures live). Used when the levelMap has no hit
// entry: saved logs captured by DLL builds older than the hit-level capture
// (pre Sep 2025) never got one, so without this fallback their hits can
// never rescale. NOTE: the levelMap entries are version-accurate for the
// log they were captured with; the datamine fallback reflects the CURRENT
// game tables (acceptable for old logs — the logged value itself stays).
const hitLadderFallback = new Map();

// Looks up a hit config ("t":"hit" levelMap entry, keyed by hitDamageId).
// Returns the entry ({ lt, ld, sp, sa, tp, ta, ap, pi }) or null.
// The per-level arrays are indexed by the level the game resolved MINUS 1 for
// levelTypeData 1/2/3 (decompiled.c:3853176) — the logged DamageParams.skillLevel
// is that level + 1, so sp[skillLevel - 1] reproduces the game's pick.
function resolveHitLevelMap(hitDamageId) {
    const entry = levelMap.get(Number(hitDamageId));
    if (entry && entry.t === 'hit') return entry;
    return hitLadderFallback.get(Number(hitDamageId)) || null;
}

// Skill slot (ActionKey) display names — the slots whose levels scale hits
// (levelTypeData 3, levelData = ActionKey) and skill-scaled effects.
const SKILL_SLOT_NAMES = { 2: 'Main Skill', 3: 'Support Skill', 4: 'Ultimate', 5: 'Normal Attack' };
const SKILL_SLOT_ORDER = [5, 2, 3, 4];   // display order: Normal, Main, Support, Ultimate

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
    "Suppress", "Normal Dmg", "Skill Dmg", "Ult Dmg", "Other Dmg",
    "Rcd Normal Dmg", "Rcd Skill Dmg", "Rcd Ult Dmg", "Rcd Other Dmg",
    "Mark Dmg", "Rcd Mark Dmg", "Minion Dmg", "Rcd Minion Dmg",
    "Derivative Dmg", "Rcd Derivative Dmg", "Normal Crit Rate",
    "Skill Crit Rate", "Ult Crit Rate", "Mark Crit Rate", "Minion Crit Rate",
    "Derivative Crit Rate", "Other Crit Rate", "Normal Crit Damage",
    "Skill Crit Damage", "Ult Crit Damage", "Mark Crit Damage",
    "Minion Crit Damage", "Derivative Crit Damage", "Other Crit Damage",
    "Energy Max", "Skill Intensity", "Toughness Broken Dmg",
    "Add Shield Strengthen", "Be Add Shield Strengthen", "Normal Suppress",
    "Skill Suppress", "Ult Suppress", "Mark Suppress", "Minion Suppress",
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

// ─── Origin record (Boss Blitz record: discs/build → pseudo-effect rows) ─────
// The DLL emits one Type:"Origin" event per room (right after the Reset). It
// carries the record's team, per-disc stats (discStats), per-char base/build
// sums and equipped-gem rolls (CharGemAttrValue ids). The disc stats are
// surfaced as effect-like rows (source 'Discs') so they reuse the effects UI:
// the "Attacker Record" hit section, the effects panel and the effect-impact
// tab — all grouped under the existing Discs source.
const RECORD_SKEY_TO_ATTR = {
    Hp: 3, Atk: 1, Def: 2, CritRate: 6, CritResistance: 7, CritPower: 8,
    HitRate: 4, Evd: 5, DefPierce: 9, DefIgnore: 10,
    WEE: 17, WEP: 23, WEI: 29, WER: 11,
    FEE: 18, FEP: 24, FEI: 30, FER: 12,
    SEE: 19, SEP: 25, SEI: 31, SER: 13,
    AEE: 20, AEP: 26, AEI: 32, AER: 14,
    LEE: 21, LEP: 27, LEI: 33, LER: 15,
    DEE: 22, DEP: 28, DEI: 34, DER: 16,
    Toughness: 42, ToughnessDamageAdjust: 43, Suppress: 55,
    NORMALDMG: 56, SKILLDMG: 57, ULTRADMG: 58, OTHERDMG: 59,
    RCDNORMALDMG: 60, RCDSKILLDMG: 61, RCDULTRADMG: 62, RCDOTHERDMG: 63,
    MARKDMG: 64, SUMMONDMG: 66, PROJECTILEDMG: 68,
    GENDMG: 49, DMGPLUS: 50, FINALDMG: 51, FINALDMGPLUS: 52,
    GENDMGRCD: 53, DMGPLUSRCD: 54,
    WEERCD: 35, FEERCD: 36, SEERCD: 37, AEERCD: 38, LEERCD: 39, DEERCD: 40,
    NormalCritRate: 70, SkillCritRate: 71, UltraCritRate: 72, MarkCritRate: 73,
    SummonCritRate: 74, ProjectileCritRate: 75, OtherCritRate: 76,
    NormalCritPower: 77, SkillCritPower: 78, UltraCritPower: 79,
    MarkCritPower: 80, SummonCritPower: 81, ProjectileCritPower: 82,
    OtherCritPower: 83,
};

let originRecord = null;   // latest Origin event — carries across rooms until replaced
// Disc id -> display name, filled from the Item lang map inside initTables
// (jItemLangRoot is a local there). Disc ids appear in two forms:
// "Item.<discId>.1" (raw disc-table id, e.g. Item.214024.1) and
// "Item.21<discId>.1" (item-tid style, as used by the disc-buff decoder).
const discLangNames = new Map();
// Support-disc bonus notes (Boss Blitz): discId -> [{ noteId, count }] from
// Disc.json's SubNoteSkillGroupId + the SubNoteSkillPromoteGroup entry with
// the highest Phase (the DLL logs only the disc id — the phase ladder isn't
// logged, so the max-phase grant is used). The granted notes are part of the
// record's `notes` counts (the logged note levels equal them), so they are
// surfaced as display-only rows (buildRecordDiscNoteEffects) whose disable
// drops the grant from the note level (dcNoteLevels, dmgCalc.calc.js).
const discBonusNotesById = new Map();
// SubNoteSkill id -> display name ("Melody of Burst"), from SubNoteSkill lang
const subNoteNamesById = new Map();
// SubNoteSkill id -> first EffectId (e.g. 90013 → 90013001; the per-level
// ladder in EffectValue is configId + level*10)
const subNoteEffectIdByNote = new Map();
// Emblem (gem) parse tables — filled inside initTables:
//   gemAttrValueById: CharGemAttrValue id -> {attrType, first, second, value}
//   potentialById:    potential id  -> Potential.json row (MaxLevel/EffectGroupId/Build)
const gemAttrValueById = new Map();
const potentialById = new Map();
// potential id -> effect-id family base (Effect.json LevelData link; the
// effect-id family is NOT always <EffectGroupId> — e.g. Nazuka's potentials
// use families 13352xxx while EffectGroupId is 13329).
const potentialEffectFamily = new Map();   // potential id -> effect-id family base (hint)
const effectIdPot = new Map();             // effect configId -> potential id (exact "level source")
const potEffectIds = new Map();            // potential id -> Set of effect configIds
// potential id -> display name (from item.json root, same source buildHitTable uses)
const potentialNameById = new Map();
const EMBLEM_SLOT_NAMES = { 1: 'Emblem 70', 2: 'Emblem 80', 3: 'Emblem 90' };
const GEM_SKILL_SLOT_NAMES = { 1: 'Normal Atk', 2: 'Main Skill', 3: 'Support Skill', 4: 'Ultimate' };

function getOriginRecord() { return originRecord; }

// Full reset of record-derived viewer state — called on log swap / clear /
// cut: the Origin event and everything built from it must not leak into
// another log (Record tab, level tables, disabled rows, level overrides).
// The new log's Origin event repopulates everything it carries on reparse.
window.resetRecordState = function () {
    originRecord = null;
    if (typeof dcResetSimState === 'function') dcResetSimState();
    if (typeof eiInvalidateCache === 'function') eiInvalidateCache();
    const panel = document.getElementById('recordPanel');
    if (panel && panel.classList.contains('visible') && window.Record) window.Record.render();
};

function resolveRecordDiscName(discId) {
    const id = String(discId);
    return discLangNames.get(id) || discLangNames.get('21' + id) || `Disc ${id}`;
}

// Support-disc bonus-note grants (max Phase), discId -> [{ noteId, count }].
function discBonusNotesFor(discId) {
    return discBonusNotesById.get(Number(discId)) || [];
}

// Display name of a note (SubNoteSkill lang), e.g. 90013 → "Melody of Burst".
function subNoteName(noteId) {
    return subNoteNamesById.get(Number(noteId)) || `Note ${noteId}`;
}

// Stat label of a disc bonus-note row: the note effect's per-level stat value
// (EffectValue at the ladder's level 1 — every SubNoteSkill ladder is linear,
// verified across the datamine) × the granted notes, plus the attr/subType it
// applies to. Returns null when the note's effect has no numeric attr — the
// display then falls back to "+N notes".
function discNoteStatOf(ef) {
    if (ef._noteAdd == null || ef._notePerVal == null) return null;
    const total = ef._notePerVal * ef._noteAdd;
    const isSmall = Math.abs(total) < 15;
    const val = isSmall ? (total * 100).toFixed(2) + '%' : String(+total.toPrecision(8));
    const attr = (ef._noteAttrType != null && attrName(ef._noteAttrType) !== '?') ? attrName(ef._noteAttrType) : null;
    return { attr, val, subType: ef._noteSubType ?? 1 };
}

// Convert the origin's discStats into effect-like rows, one per changed stat:
// "[disc name] : Stat [n]". Cached on the origin event itself.
function buildRecordDiscEffects(origin) {
    if (origin._discRows) return origin._discRows;
    const rows = [];
    const ifp = origin.ifp || 1e-4;
    (origin.discStats || []).forEach((d, di) => {
        const discName = resolveRecordDiscName(d.id);
        let statIdx = 0;
        const attrs = d.attrs || {};
        for (const sKey of Object.keys(attrs)) {
            statIdx++;
            const cfg = attrs[sKey];
            const attrType = RECORD_SKEY_TO_ATTR[sKey] ?? null;
            const isPct = !!(origin.pct?.[sKey]);
            // Percent CfgValues arrive in the game's ×1e-4 domain (700 = 7%);
            // true fractions (≤ ~2) pass through. Flat values stay as-is —
            // matching the standard effect-value display formatter.
            const val = isPct ? (Math.abs(cfg) > 2 ? cfg * ifp : cfg) : cfg;
            rows.push({
                configId: 920000000 + di * 1000 + statIdx,   // synthetic, collision-free
                valueConfigId: 0,
                name: `${discName} : Stat ${statIdx}`,
                attrType,
                subType: 1,               // BASE_VALUE
                value: val,
                source: 'Discs',
                effectType: 12,           // ATTR_FIX — in allowedEffectTypes
                count: 1,
                isRecordEffect: true,
                allValueConfigIds: [],
            });
        }
    });
    origin._discRows = rows;
    return rows;
}

// Support-disc bonus notes as display-only rows (one per granted note type):
// "<disc name> : Note <note name>". The rows carry no stat — disabling one
// drops the disc's grant from the granted note's level (dcNoteLevels in
// dmgCalc.calc.js keys the row by configId, same pattern as the emblem skill
// rows). Only discs from index 3 on (the support discs) grant notes; the
// main discs' contributions are the logged Melody/Harmony buffs instead.
// The grant size comes from the max Phase SubNoteSkillPromoteGroup entry —
// the DLL logs only the disc id, so the phase ladder isn't recoverable and
// a lower-phase disc's disable over-subtracts (see discBonusNotesById).
function buildRecordDiscNoteEffects(origin) {
    if (origin._discNoteRows) return origin._discNoteRows;
    const rows = [];
    (origin.discStats || []).forEach((d, di) => {
        if (di < 3) return;   // main discs don't grant notes
        const discName = resolveRecordDiscName(d.id);
        const grants = discBonusNotesFor(d.id);
        grants.forEach((n, ni) => {
            // Stat the note's effect changes (per-level value from EffectValue's
            // level-1 ladder entry) — the row's display shows it × the grant
            // (e.g. "Ult Dmg 3.22% | +7 notes") without applying anything.
            const effId = subNoteEffectIdByNote.get(n.noteId);
            const per = effId != null ? effectValueTable.get(effId + 10) : null;
            rows.push({
                configId: 960000000 + di * 1000 + ni,   // synthetic, collision-free (dcDiscNoteRowKey)
                valueConfigId: 0,
                name: `${discName} : Note ${subNoteName(n.noteId)}`,
                attrType: null, subType: null, value: null,
                source: 'Discs', effectType: null, count: 1,
                isRecordEffect: true, displayOnly: true, allValueConfigIds: [],
                _noteAdd: n.count,
                _noteId: n.noteId,
                _noteAttrType: per?.attrType ?? null,
                _noteSubType: per?.subType ?? 1,
                _notePerVal: per?.value ?? null,
            });
        });
    });
    origin._discNoteRows = rows;
    return rows;
}

// Convert the record's build stats (GetBuildAttrBase, e.g. Atk 3136 /
// Hp 29270) into effect-like rows. The build is identical for every unit,
// so ONE shared set of rows is attached to everyone's record (a single
// toggle applies to all chars). Origin-domain flat values; attr ids come
// from the ATTR_NAMES index table ("Atk"→1, "Hp"→"Max Hp"→3).
function buildRecordBuildEffects(origin) {
    if (origin._buildRows) return origin._buildRows;
    const rows = [];
    const builds = (origin.chars || []).map(c => c.build || {}).filter(b => Object.keys(b).length);
    const build = builds[0] || {};
    // build keys are display names ("Atk", "Hp") — map to ATTR_NAMES indices
    const nameIdx = new Map(ATTR_NAMES.map((n, i) => [n.toLowerCase(), i]));
    const attrIdFor = (statName) => {
        const k = statName.toLowerCase();
        if (nameIdx.has(k)) return nameIdx.get(k);
        if (k === 'hp') return nameIdx.get('max hp');   // build key "Hp" = Max Hp
        return null;
    };
    let statIdx = 0;
    for (const [statName, val] of Object.entries(build)) {
        if (!val) continue;
        statIdx++;
        rows.push({
            configId: 910000000 + statIdx,   // synthetic, collision-free
            valueConfigId: 0,
            name: `Build : ${statName}`,
            attrType: attrIdFor(statName), subType: 1, value: val,
            source: 'Record Stats', effectType: 12, count: 1,
            isRecordEffect: true, allValueConfigIds: [],
        });
    }
    origin._buildRows = rows;
    return rows;
}

// Convert a record char's gems (emblems) into effect-like rows:
//   flat rolls  — resolved via CharGemAttrValue (Type 12; Type 37 player-attrs
//                 have no numeric attr id → attrType null)
//   percent rolls — the gem's Effect ids, resolved via effectValueTable
//   pots       — levellable rows linked to the potential's own level ladder
//                (<EffectGroupId><level><buildVariant> ids in EffectValue);
//                the ladder segment is the gem's marginal levels:
//                potBase+1 .. potBase+addLv (capped at MaxLevel). Disabling
//                the row drops the whole segment; the level buttons step it.
//   skills     — display-only rows (no numeric effect → excluded from calc)
function buildRecordEmblemEffects(origin, charId) {
    origin._emblemRows = origin._emblemRows || {};
    if (origin._emblemRows[charId]) return origin._emblemRows[charId];
    const rows = [];
    // Team index — mixed into synthetic configIds so rows from different
    // units never collide in the collector's dedupe map.
    const ci = (origin.team || []).indexOf(Number(charId));
    const ch = (origin.chars || []).find(c => String(c.charId) === String(charId));
    if (ch) {
        // Per-unit source group → the dmgcalc sidebar renders one section per
        // unit ("<char name> Emblems"), and the effect-impact chips match.
        const emblemSource = `${resolveActorKey('p:' + charId)} Emblems`;
        // Stat rolls are named after the attribute they affect ("Ventus Pen",
        // "Skill Dmg", …) via the shared ATTR_NAMES table; rolls without a
        // numeric attr id (Type 37 PLAYER_ATTR_FIX / unknown) keep "Stat N".
        const rollName = (attrType, idx) =>
            attrType != null && attrName(attrType) !== '?' ? attrName(attrType) : `Stat ${idx}`;
        const potBase = ch.potBase || {};
        (ch.gems || []).forEach((g, gi) => {
            const slot = g.slot || (gi + 1);
            const emblemName = EMBLEM_SLOT_NAMES[slot] || `Emblem Slot ${slot}`;
            let statIdx = 0;
            // flat rolls: [CharGemAttrValueId, CfgValue, rawValue]
            (g.attrs || []).forEach(roll => {
                statIdx++;
                const id = roll[0], raw = roll[2];
                const gv = gemAttrValueById.get(Number(id));
                let attrType = null, subType = 1, value = raw;
                if (gv) {
                    if (gv.attrType === 12) attrType = gv.first;   // ATTR_FIX → attr id
                    // Type 37 (PLAYER_ATTR_FIX, energy family) — no numeric attr id
                    subType = gv.second || 1;
                    value = gv.value ?? raw;
                }
                rows.push({
                    configId: 930000000 + ci * 100000 + gi * 1000 + statIdx,
                    valueConfigId: 0,
                    name: `${emblemName} : ${rollName(attrType, statIdx)}`,
                    attrType, subType, value,
                    source: emblemSource, effectType: 12, count: 1,
                    isRecordEffect: true, allValueConfigIds: [],
                    _gemLevel: gv?.Level ?? null,   // roll tier: +1/+2/+3
                    _charId: Number(charId),
                    _charName: resolveActorKey('p:' + charId),
                });
            });
            // percent rolls: Effect ids → EffectValue (Second=2 PERCENT)
            (g.effects || []).forEach(eid => {
                statIdx++;
                const ev = effectValueTable.get(Number(eid));
                rows.push({
                    configId: 930000000 + ci * 100000 + gi * 1000 + statIdx,
                    valueConfigId: 0,
                    name: `${emblemName} : ${rollName(ev?.attrType ?? null, statIdx)}`,
                    attrType: ev?.attrType ?? null,
                    subType: ev?.subType ?? 2,
                    value: ev?.value ?? null,
                    source: emblemSource, effectType: 12, count: 1,
                    isRecordEffect: true, allValueConfigIds: [],
                    _charId: Number(charId),
                    _charName: resolveActorKey('p:' + charId),
                });
            });
            // pots: [potIdx, +levels] — levellable, linked to the potential ladder
            (g.pots || []).forEach(pot => {
                const potIdx = pot[0], addLv = pot[1] || 0;
                const potId = 500000 + Number(charId) * 100 + Number(potIdx);
                const potEntry = potentialById.get(potId);
                const potName = discLangNames.get(String(potId)) || `Potential ${potIdx}`;
                // Effect-id family from the Effect.json LevelData link
                // (falls back to EffectGroupId for potentials without one).
                const gid = potentialEffectFamily.get(potId) ?? (potEntry?.EffectGroupId ? potEntry.EffectGroupId * 1000 : undefined);
                const maxLv = potEntry?.MaxLevel || 0;
                const build = potEntry?.Build || 1;
                const base = Number(potBase[String(potId)] ?? potBase[potId] ?? 0);
                // ladder variant: the potential's Build column picks the column
                // of per-level values (…<level><variant> in EffectValue). Builds
                // >2 fall back to the variant whose level-1 value is nonzero.
                let variant = 1;
                // ladder ids: <EffectGroupId>0<level><variant> (e.g. 16009012)
                const v1 = gid ? effectValueTable.get(Number(`${gid}011`)) : null;
                const v2 = gid ? effectValueTable.get(Number(`${gid}012`)) : null;
                if (v2 && v2.value && (!v1 || !v1.value || build === 2)) variant = 2;
                const ladder = [];
                for (let L = base + 1; L <= Math.min(base + addLv, maxLv); L++) {
                    const vcId = Number(`${gid}0${L}${variant}`);
                    if (effectValueTable.get(vcId)) ladder.push({ level: L - base, valueConfigId: vcId });
                }
                // Shortcut row: no stat of its own — disabling it lowers ALL
                // of the potential's effect entries by the granted levels
                // (handled in dcApplyEffectOverrides via linkPotential).
                rows.push({
                    configId: 940000000 + ci * 100000 + gi * 100 + Number(potIdx),
                    valueConfigId: 0,
                    name: `${emblemName} : ${potName}`,
                    attrType: null, subType: null, value: null,
                    count: 1, source: emblemSource, effectType: 12,
                    isRecordEffect: true, isPotRow: true,
                    linkPotential: { potId, gid, base, addLv, maxLv, variant, charId: Number(charId) },
                    allValueConfigIds: [],
                    _charId: Number(charId),
                    _charName: resolveActorKey('p:' + charId),
                });
            });
            // skills: [slot, +levels] — display-only (excluded from calc by
            // the allowedEffectTypes gate; effectType left null). The +lv lives
            // in _skillAddLv (shown as the green stat cell, like the pot rows);
            // the level table keys the row by configId (dcEmblemSkillRowKey).
            (g.skills || []).forEach(sk => {
                const slotIdx = sk[0], lv = sk[1] || 0;
                rows.push({
                    configId: 950000000 + ci * 100000 + gi * 100 + Number(slotIdx),
                    valueConfigId: 0,
                    name: `${emblemName} : ${GEM_SKILL_SLOT_NAMES[slotIdx] || ('Skill ' + slotIdx)}`,
                    attrType: null, subType: null, value: null,
                    source: emblemSource, effectType: null, count: 1,
                    isRecordEffect: true, displayOnly: true, allValueConfigIds: [],
                    _skillAddLv: Number(lv) || 0,
                    _charId: Number(charId),
                    _charName: resolveActorKey('p:' + charId),
                });
            });
        });
    }
    origin._emblemRows[charId] = rows;
    return rows;
}

function enrichEvent(ev) {
    switch (ev.Type) {
        case 'Hit':        enrichHit(ev);       break;
        case 'Buff':       enrichBuff(ev);      break;
        case 'Skill Cast': enrichSkillCast(ev); break;
        case 'Record':          // current name (DLL)
        case 'Origin':          // legacy name in older logs
            originRecord = ev;
            break;
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

    // Record disc stats: if the attacker is one of the record's characters,
    // attach the record's disc effects for the "Attacker Record" section and
    // the effects/effect-impact pipelines.
    if (originRecord?.team?.length) {
        const attackerId = parseInt((ev.Attacker || '').split(':')[1], 10);
        // Team members may be numbers or strings depending on the DLL build.
        const team = originRecord.team;
        const onTeam = team.includes(attackerId) || team.includes(String(attackerId));
        if (attackerId > 0 && onTeam) {
            // effects: discs + the attacker's OWN build stats and emblems
            // (calc path — per-hit correct; toggles only touch the attacker's
            // own contributions).
            ev.AttackerRecord = { effects: [
                ...buildRecordDiscEffects(originRecord),
                ...buildRecordDiscNoteEffects(originRecord),
                ...buildRecordBuildEffects(originRecord),
                ...buildRecordEmblemEffects(originRecord, String(attackerId)),
            ] };
        }
    }

    // Attr name injection
    padStats(ev.AttackerStats?.attrs);
    padStats(ev.DefenderStats?.attrs);
    enrichAttrList(ev.AttackerStats?.attrs);
    enrichAttrList(ev.AttackerSpecial?.specialAttrs);
    enrichAttrList(ev.DefenderSpecial?.specialAttrs);
}

// Pads an attr list so index i aligns with attr id i (fill gaps with defaults).
// Faithful to the previous splice-based loop, but O(n) instead of O(n^2):
// the splice loop kept the element at position i if it was present and its id
// was <= i, otherwise it inserted a default at i (shifting later entries right).
function padStats(attrList) {
  if (!attrList) return;
  const out = [];
  let s = 0;
  for (let i = 0; i <= 97; i++) {
    const cur = attrList[s];
    if (cur !== undefined && cur !== null && !(cur.id != null && cur.id > i)) {
      out.push(cur);
      s++;
    } else {
      out.push({origin: 0, base: 0, pct: 0, abs: 0, limPct: 0});
    }
  }
  for (; s < attrList.length; s++) out.push(attrList[s]);
  if (out.length !== attrList.length) {
    attrList.length = 0;
    for (const e of out) attrList.push(e);
  }
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
        const ei = effectTable.get(e.configId);
        if (ei) {
            e.name = (ei.charName && ei.charName !== '?')
                ? `${ei.charName} / ${ei.label}`
                : ei.label;
            e.source = ei.source ?? 'Unknown';
        } else {
            e.name = `configId=${e.configId} (unknown)`;
        }
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
    // Build a new list with push() instead of splice()-inserting extras,
    // which avoided O(n^2) array shifting on large dict lists.
    const out = [];
    for (const entry of attrDictList) {
        if (entry._dictEnriched) { out.push(entry); continue; }

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
                entry.slotNum  = s1.slotNum;
                entry._dictEnriched = true;
                out.push(entry);

                for (let sn = 1; sn < slots.length; sn++) {
                    const sx = slots[sn];
                    const extra = Object.assign({}, entry);
                    extra.attrType = sx.attrType;
                    extra.subType  = sx.subType;
                    extra.value    = sx.value;
                    extra.slotNum  = sx.slotNum;
                    extra.name     = (entry.name || String(entry.attrId || '')) + ' #' + (sn + 1);
                    extra._dictEnriched = true;
                    out.push(extra);
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
        out.push(entry);
    }
    if (out.length !== attrDictList.length) {
        attrDictList.length = 0;
        for (const e of out) attrDictList.push(e);
    }
}

// ─── Table initialisation ─────────────────────────────────────────────────────

let _dataRoot = '/api/stella-data/';

async function loadJson(path, tag) {
    try {
        const res = await fetch(path);
        if (!res.ok) {
            console.warn(`[${tag}] ${path} HTTP ${res.status}`);
            return null;
        }
        return await res.json();
    } catch (e) {
        console.warn(`[${tag}] failed to load ${path}:`, e);
        return null;
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
    hitLadderFallback.clear();

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

        // Per-level ladder fallback (same shape the DLL writes into the
        // levelMap "t":"hit" entries via WriteHitDamageLevelMapEntry).
        if (hitEntry.levelTypeData != null) {
            hitLadderFallback.set(hitId, {
                t: 'hit',
                lt: hitEntry.levelTypeData || 0,
                ld: hitEntry.LevelData || 0,
                sp: (hitEntry.SkillPercentAmend || []).map(v => parseInt(v, 10) || 0),
                sa: (hitEntry.SkillAbsAmend || []).map(v => parseInt(v, 10) || 0),
                tp: (hitEntry.TalentPercentAmend || []).map(v => parseInt(v, 10) || 0),
                ta: (hitEntry.TalentAbsAmend || []).map(v => parseInt(v, 10) || 0),
                ap: [], pi: [],
            });
        }

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
        // Mark hits: xxx000001 pattern => "<Element> Mark" (e.g. Ignis Mark) - only for DamageType 5
        if (hitEntry.DamageType === 5 && hitId % 1000000 === 1) {
            const derivedCharId = Math.trunc(hitId / 1000000);
            if (derivedCharId === charId && charName !== '?') {
                const elemMap = {1:'Aqua',2:'Ignis',3:'Terra',4:'Ventus',5:'Lux',6:'Umbra'};
                const elemName = elemMap[hitEntry.ElementType] ?? charMap[charId]?.element ?? '?';
                if (elemName !== '?') {
                    skillTitle = `${elemName} Mark`;
                    if (!hitNum) hitNum = 1;
                }
            }
        }
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
        // Marks that don't follow xxx000001 pattern or where xxx000001 is not the Mark (game calls it Dark Burn)
        // Firenze: Param3=Umbra Mark (110000000), Param4=Dark Burn (110000001) - Skill.json 11031000/11032000/11040000, character.json 110 skill/supportSkill/ultimate
        [110000000, 'Firenze', 'Umbra Mark', 1, 'Skills'],
        [110000001, 'Firenze', 'Dark Burn', 1, 'Skills'],
        // Mistique: Param3=Umbra Mark (135000000), Param4=Dark Burn (135000001) - Skill.json 13531000
        [135000000, 'Mistique', 'Umbra Mark', 1, 'Skills'],
        [135000001, 'Mistique', 'Dark Burn', 1, 'Skills'],
        // Caramel: Param5=Umbra Mark (147100000), Param6=Dark Burn (147000001) - Skill.json 14731000/14732000/14740000
        [147100000, 'Caramel', 'Umbra Mark', 1, 'Skills'],
        [147000001, 'Caramel', 'Dark Burn', 1, 'Skills'],
        // Noya: Ventus Mark is 112100000 (no 112000001 in HitDamage.json) - Skill.json 11231001/11232000/11240000
        [112100000, 'Noya', 'Ventus Mark', 1, 'Skills'],
        // Karin: Umbra Mark 157000001 via pattern, Dark Burn 157000002 via Word 4051 / BuffEffect
        [157000002, 'Karin', 'Dark Burn', 1, 'Skills'],
        // Suntide Willow: Prismatic Bubbles variants (SkillSlotType 2, PerkId 516030)
        [160530001, 'Suntide Willow', 'Prismatic Bubbles (blue)', 1, 'Potentials'],
        [160530002, 'Suntide Willow', 'Prismatic Bubbles (red)', 2, 'Potentials'],
        // Eleanor: extra jump-slam explosion from exclusive perk 513721 "Chain Detonation" (Item.json 513721, Potential.json 513721 - no HitDamage Param, only 13721011 OnceAdditionalAttributeValue)
        [137300012, 'Eleanor', 'Chain Detonation', 1, 'Potentials'],
    ];
    for (const [hitId, charName, skillTitle, hitNum, src] of hardcoded)
        hitTable.set(hitId, { charName, skillTitle, hitNum, source: `${charName} ${src}` });
}

// ─── buildEffectTable ─────────────────────────────────────────────────────────

function buildEffectTable(dataFiles) {
    effectTable.clear();

    const {
        jEffect, jItem, jItemLang, jSubNote, jSubNoteLang,
        jAffinityLevel, jAffix, jAffixLang,
        jBuff, jBuffValue, jWord, jWordLang, jTalent, jTalentLang,
        jScoreBoss, jScoreBossLang, jItemLangRoot, jItemRoot,
        jOnceAttr, jSecSkillLang, jChar, jSkill,
        jSkillLang, jPotential, jBlitz, jDiscIP
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
            // Level metadata + MainOrSupport fallback (used when the DLL's
            // levelMap lacks the entry — see resolveLevelMap).
            effectLevelMetaFallback.set(configId, {
                lt: ldt || 0,
                ld: effEntry.LevelData || 0,
            });
            if (effEntry.MainOrSupport) effectMainOrSupport.set(configId, effEntry.MainOrSupport);
            // Potential linkage: LevelData points at the potential id whose
            // levels drive this effect. Mapping is by EXACT effect id — two
            // potentials can share a ÷1000 id bucket (e.g. Nazuka's pots 31/33
            // both live in 13353xxx, told apart by the hundreds digit).
            if (effEntry.LevelData >= 500000 && effEntry.LevelData < 600000) {
                const potId = Number(effEntry.LevelData);
                potentialEffectFamily.set(potId, Math.floor(configId / 1000) * 1000);
                effectIdPot.set(configId, potId);
                if (!potEffectIds.has(potId)) potEffectIds.set(potId, new Set());
                potEffectIds.get(potId).add(configId);
            }
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
            // Level metadata fallback (no MainOrSupport on once-attr rows).
            if (configId && oaVal.levelTypeData != null) {
                effectLevelMetaFallback.set(configId, {
                    lt: oaVal.levelTypeData || 0,
                    ld: oaVal.LevelData || 0,
                });
            }
            // Potential linkage: same contract as the Effect.json loop —
            // LevelData points at the potential id whose levels drive this
            // once-attr row (e.g. Field Pull 13725001 → 513725, Shattering
            // Blow 13727001/2 → 513727). Must run before the
            // effectTable.has() skip: some rows (13353201) exist in BOTH
            // files, and without this their collected rows get no level
            // source → the ± buttons and pot-level changes never move them.
            if (configId && oaVal.levelTypeData != null
                && oaVal.LevelData >= 500000 && oaVal.LevelData < 600000) {
                const potId = Number(oaVal.LevelData);
                potentialEffectFamily.set(potId, Math.floor(configId / 1000) * 1000);
                effectIdPot.set(configId, potId);
                if (!potEffectIds.has(potId)) potEffectIds.set(potId, new Set());
                potEffectIds.get(potId).add(configId);
            }
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
    // Label format: "<disc name>: Melody|Harmony N - <melody/harmony name>"
    //   Melody name comes from DiscIP.21<discId>.2, harmony name from
    //   SecondarySkill.<discId><N>01.1
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
                const melodyName = jDiscIP?.[`DiscIP.21${discId}.2`];
                label = melodyName
                    ? `${discName}: Melody - ${melodyName}`
                    : `${discName}: Melody`;
            } else {
                const harmonyNum  = digit5;
                const secSkillKey = `SecondarySkill.${discId}${digit5}01.1`;
                let harmonyName = jSecSkillLang?.[secSkillKey];
                if (harmonyName === 'None' || harmonyName === '?') harmonyName = undefined;
                label = harmonyName
                    ? `${discName}: Harmony ${harmonyNum} - ${harmonyName}`
                    : `${discName}: Harmony ${harmonyNum}`;
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

// skillId -> { charId, role } for the character's own skills — the deployment
// role evidence used to resolve the shared ActionKey-B slot when a log has no
// record log (see dcSharedRoleSlot in dmgCalc.calc.js): a cast/hit of the
// char's `skill` (SkillId, e.g. Tilia 10731000) proves MAIN deployment,
// `supportSkill` (AssistSkillId, 10732000) proves SUPPORT deployment — the
// boot binding is PlayerAdventureActor_SetSkillBind (decompiled.c:4320783):
// B←SkillId when !isAssist, B←AssistSkillId when isAssist.
const skillRoleOwner = new Map();

function buildSkillTable(jChar, jSkill, jSkillLang) {
    skillTable.clear();
    skillRoleOwner.clear();

    const kSkillTypes = ['normalAtk', 'skill', 'supportSkill', 'ultimate'];

    // Role evidence map from the character's own skill ids
    for (const [, cval] of Object.entries(jChar)) {
        const cid = parseInt(cval.id, 10);
        if (!cid) continue;
        if (cval.skill?.id)        skillRoleOwner.set(cval.skill.id,        { charId: cid, role: 2 });
        if (cval.supportSkill?.id) skillRoleOwner.set(cval.supportSkill.id, { charId: cid, role: 3 });
    }

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

async function initTables() {
    // NOTE: the data root is fixed to the DLL server's API prefix (_dataRoot);
    // callers pass no argument (the old dataRoot parameter was never used).
    const bin  = `${_dataRoot}EN/bin/`;
    const lang = `${_dataRoot}EN/language/en_US/`;

    // Load all files in parallel
    const [
        jChar, jHit, jSkill, jSkillLang, jItemRoot,
        jEffect, jItem, jItemLang, jSubNote, jSubNoteLang,
        jAffinityLevel, jEffectValue, jAffix, jAffixLang,
        jBuff, jBuffValue, jWord, jWordLang, jTalent, jTalentLang,
        jOnceAttr, jOnceAttrValue, jScoreBoss, jScoreBossLang,
        jPotential, jMonsterSkin, jSecSkillLang, jBlitz, jDiscIP,
        jGemAttrValue, jDisc, jSubNotePromote,
    ] = await Promise.all([
        loadJson(`${_dataRoot}character.json`,               'char'),
        loadJson(`${bin}HitDamage.json`,                     'hit'),
        loadJson(`${bin}Skill.json`,                         'skill'),
        loadJson(`${lang}Skill.json`,                        'skillLang'),
        loadJson(`${_dataRoot}item.json`,                    'itemRoot'),
        loadJson(`${bin}Effect.json`,                        'effect'),
        loadJson(`${bin}Item.json`,                          'item'),
        loadJson(`${lang}Item.json`,                         'itemLang'),
        loadJson(`${bin}SubNoteSkill.json`,                  'subNote'),
        loadJson(`${lang}SubNoteSkill.json`,                 'subNoteLang'),
        loadJson(`${bin}AffinityLevel.json`,                 'affinity'),
        loadJson(`${bin}EffectValue.json`,                   'effectValue'),
        loadJson(`${bin}TravelerDuelChallengeAffix.json`,    'affix'),
        loadJson(`${lang}TravelerDuelChallengeAffix.json`,   'affixLang'),
        loadJson(`${bin}Buff.json`,                          'buff'),
        loadJson(`${bin}BuffValue.json`,                     'buffValue'),
        loadJson(`${bin}Word.json`,                          'word'),
        loadJson(`${lang}Word.json`,                         'wordLang'),
        loadJson(`${bin}Talent.json`,                        'talent'),
        loadJson(`${lang}Talent.json`,                       'talentLang'),
        loadJson(`${bin}OnceAdditionalAttribute.json`,       'onceAttr'),
        loadJson(`${bin}OnceAdditionalAttributeValue.json`,  'onceAttrValue'),
        loadJson(`${bin}ScoreBossAbility.json`,              'scoreBoss'),
        loadJson(`${lang}ScoreBossAbility.json`,             'scoreBossLang'),
        loadJson(`${bin}Potential.json`,                     'potential'),
        loadJson(`${bin}MonsterSkin.json`,                   'monsterSkin'),
        loadJson(`${lang}SecondarySkill.json`,               'secSkillLang'),
        loadJson(`${_dataRoot}blitz.json`,                   'blitz'),
        loadJson(`${lang}DiscIP.json`,                       'discIP'),
        loadJson(`${bin}CharGemAttrValue.json`,              'gemAttrValue'),
        loadJson(`${bin}Disc.json`,                          'disc'),
        loadJson(`${bin}SubNoteSkillPromoteGroup.json`,      'subNotePromote'),
    ]);

    // lang/Item.json doubles as the item-language map used by disc/potential decoding
    const jItemLangRoot = jItemLang;

    // Cache disc display names for the origin-record rows. Both key styles:
    // "Item.<discId>.1" (raw ids from the record) and "Item.21<discId>.1".
    discLangNames.clear();
    if (jItemLangRoot) {
        for (const k in jItemLangRoot) {
            const m = /^Item\.(\d+)\.1$/.exec(k);
            if (!m || typeof jItemLangRoot[k] !== 'string') continue;
            const digits = m[1];
            if (!discLangNames.has(digits)) discLangNames.set(digits, jItemLangRoot[k]);
            // 8-digit item tids carry the "21" disc prefix — also index the raw id
            if (digits.length === 8 && digits.startsWith('21') && !discLangNames.has(digits.slice(2)))
                discLangNames.set(digits.slice(2), jItemLangRoot[k]);
        }
    }

    // Support-disc bonus notes: Disc.json SubNoteSkillGroupId → the
    // SubNoteSkillPromoteGroup entry with the highest Phase → its
    // SubNoteSkills JSON ("{"90013":7,...}" — note id → granted count).
    discBonusNotesById.clear();
    if (jDisc && jSubNotePromote) {
        const maxPhaseByGroup = new Map();   // GroupId -> { phase, val }
        for (const [, val] of Object.entries(jSubNotePromote)) {
            const gid = parseInt(val.GroupId, 10);
            if (!gid) continue;
            const phase = Number(val.Phase) || 0;
            const cur = maxPhaseByGroup.get(gid);
            if (!cur || phase > cur.phase) maxPhaseByGroup.set(gid, { phase, val });
        }
        for (const [, d] of Object.entries(jDisc)) {
            const discId = parseInt(d.Id, 10);
            const gid = parseInt(d.SubNoteSkillGroupId, 10);
            if (!discId || !gid) continue;
            const best = maxPhaseByGroup.get(gid);
            if (!best) continue;
            let parsed = null;
            try { parsed = JSON.parse(best.val.SubNoteSkills || '{}'); } catch (e) { /* malformed */ }
            if (!parsed) continue;
            const list = Object.keys(parsed)
                .map(k => ({ noteId: parseInt(k, 10), count: parseInt(parsed[k], 10) || 0 }))
                .filter(n => n.noteId > 0 && n.count > 0)
                .sort((a, b) => a.noteId - b.noteId);
            if (list.length) discBonusNotesById.set(discId, list);
        }
    }
    // Note display names ("Melody of Burst") for the disc bonus-note rows
    subNoteNamesById.clear();
    subNoteEffectIdByNote.clear();
    if (jSubNote) {
        for (const [, val] of Object.entries(jSubNote)) {
            const id = parseInt(val.Id, 10);
            if (!id) continue;
            subNoteNamesById.set(id, jSubNoteLang?.[val.Name] ?? val.Name ?? '?');
            const eid = (val.EffectId ?? [])[0];
            if (eid) subNoteEffectIdByNote.set(id, Number(eid));
        }
    }

    // Emblem parse tables
    gemAttrValueById.clear();
    if (jGemAttrValue) {
        for (const [k, v] of Object.entries(jGemAttrValue)) {
            const id = parseInt(k, 10);
            if (!id || !v || v.AttrType == null) continue;
            gemAttrValueById.set(id, {
                attrType: parseInt(v.AttrType, 10),
                first:    v.AttrTypeFirstSubtype != null ? parseInt(v.AttrTypeFirstSubtype, 10) : null,
                second:   v.AttrTypeSecondSubtype != null ? parseInt(v.AttrTypeSecondSubtype, 10) : null,
                value:    v.Value != null && v.Value !== '' ? parseFloat(v.Value) : null,
            });
        }
    }
    potentialById.clear();
    if (jPotential) {
        for (const [k, v] of Object.entries(jPotential)) {
            const id = parseInt(k, 10);
            if (!id || !v) continue;
            potentialById.set(id, v);
        }
    }
    potentialNameById.clear();
    if (jPotential && jItemRoot) {
        for (const [k, v] of Object.entries(jPotential)) {
            const id = parseInt(k, 10);
            if (!id) continue;
            const nm = jItemRoot[k]?.name;
            if (nm && nm !== '?') potentialNameById.set(id, nm);
        }
    }

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
        jEffect, jItem, jItemLang, jSubNote, jSubNoteLang,
        jAffinityLevel, jAffix, jAffixLang,
        jBuff, jBuffValue, jWord, jWordLang, jTalent, jTalentLang,
        jOnceAttr, jScoreBoss, jScoreBossLang,
        jItemRoot, jItemLangRoot, jSecSkillLang,
        jChar, jSkill, jSkillLang, jPotential, jBlitz, jDiscIP
    });

    buildSkillTable(jChar, jSkill, jSkillLang);

}
