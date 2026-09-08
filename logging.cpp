#pragma GCC diagnostic ignored "-Wattributes"

#include "game_structs.h"
#include "logging.h"

#include <windows.h>
#include <cstdio>
#include <cstdarg>
#include <cerrno>
#include <shlobj.h>
#include <knownfolders.h>
#include <combaseapi.h>
#include <cmath>
#include <unordered_map>



// =============================================================================
//  GLOBAL DEFINITIONS
// =============================================================================
FILE*               g_Log     = nullptr;
FILE*               g_JsonLog = nullptr;
std::mutex          g_Mutex;
LogConfig           g_Cfg;
std::atomic<int64_t>          g_CombatStartTimeFP{0};
std::atomic<int64_t>          g_GameTimeFP{0};
std::atomic<int64_t>          g_CombatStartWallMs{0};
static std::atomic<int64_t>   g_LastLogicTickWallMs{0};

// Level map: configId → {levelTypeData, levelData, allValueConfigIds}
// Written once per unique configId to a sidecar file to avoid repeating
// these deterministic values in every hit event.
static std::string                  g_LevelMapPath;
static std::unordered_set<int32_t>  g_LevelMapKnown;

// =============================================================================
//  GAME TIME
// =============================================================================
static constexpr int64_t FP_ONE  = 4294967296LL;  // 2^32
static constexpr int64_t FDP_ONE = 16777216LL;     // 2^24

std::string gameTime() {
    int64_t wallBase = g_CombatStartWallMs.load(std::memory_order_relaxed);
    int64_t totalMs;
    if (wallBase != 0) {
        // Fallback clock: game-time accumulation is not advancing in this mode,
        // so measure elapsed real time since the first combat event.
        totalMs = (int64_t)GetTickCount64() - wallBase;
    } else {
        int64_t lockstepTime = g_GameTimeFP.load(std::memory_order_relaxed);
        int64_t combatStart  = g_CombatStartTimeFP.load(std::memory_order_relaxed);
        int64_t elapsedFP = combatStart != 0 ? lockstepTime - combatStart : 0;
        totalMs = (elapsedFP * 1000LL) / FP_ONE;
    }
    int     ms       = (int)(totalMs % 1000);
    int64_t totalSec = totalMs / 1000;
    int     sec      = (int)(totalSec % 60);
    int     min      = (int)(totalSec / 60);
    char buf[32];
    snprintf(buf, sizeof(buf), "%02d:%02d.%03d", min, sec, ms);
    return buf;
}

// Called on the first combat event (skill cast / hit) of a battle.  Seeds the
// combat-start baseline when ActorEffectManage$$OnBattleStart never fires —
// some special modes (e.g. Forbidden Echoing) drive the battle through a
// different controller, so the usual BattleStart hook is never reached while
// every other hook (spawn-skill, buff, damage) still fires.
void OnCombatEvent() {
    if (g_CombatStartTimeFP.load(std::memory_order_relaxed) != 0) return;   // already started (game-time mode)
    if (g_CombatStartWallMs.load(std::memory_order_relaxed) != 0) return;    // already on fallback clock

    // Game time counts as live only if UpdateLogic has ticked within the last 2s.
    // (A plain "fired once this session" flag would mis-seed from a stale frozen
    // g_GameTimeFP after switching modes mid-session.)
    int64_t lastTick = g_LastLogicTickWallMs.load(std::memory_order_relaxed);
    if (lastTick != 0 && (int64_t)GetTickCount64() - lastTick < 2000) {
        // Game time IS advancing (UpdateLogic fires) but BattleStart didn't —
        // baseline at the current lockstep time so elapsed counts from here.
        g_CombatStartTimeFP.store(g_GameTimeFP.load(std::memory_order_relaxed), std::memory_order_relaxed);
        log("[time] OnBattleStart never fired; seeded combat start from game time at %s", gameTime().c_str());
    } else {
        // Neither UpdateLogic nor BattleStart is firing — use wall-clock fallback.
        g_CombatStartWallMs.store((int64_t)GetTickCount64(), std::memory_order_relaxed);
        log("[time] no live game-time source (UpdateLogic/BattleStart hooks silent) — using wall clock");
    }
}

// Called from AdventureLevelController$$UpdateLogic every logic tick (before the
// delta is accumulated).  If the wall-clock fallback was seeded earlier in this
// session, hand off to game time seamlessly so timestamps stay continuous.
void OnUpdateLogicTick() {
    int64_t nowMs = (int64_t)GetTickCount64();
    g_LastLogicTickWallMs.store(nowMs, std::memory_order_relaxed);

    int64_t wallBase = g_CombatStartWallMs.load(std::memory_order_relaxed);
    if (wallBase != 0 && g_CombatStartTimeFP.load(std::memory_order_relaxed) == 0) {
        int64_t elapsedMs = nowMs - wallBase;
        int64_t nowFP     = g_GameTimeFP.load(std::memory_order_relaxed);
        g_CombatStartTimeFP.store(nowFP - (elapsedMs * FP_ONE) / 1000LL, std::memory_order_relaxed);
        g_CombatStartWallMs.store(0, std::memory_order_relaxed);
        log("[time] game-time source resumed; switched from wall clock at %s", gameTime().c_str());
    }
}

void OnBattleStart() {
    g_CombatStartWallMs.store(0, std::memory_order_relaxed);
    g_CombatStartTimeFP.store(g_GameTimeFP.load(std::memory_order_relaxed), std::memory_order_relaxed);
    log("[time] OnBattleStart fired; combat start=%s", gameTime().c_str());
}

void OnResetTime() {
    g_CombatStartTimeFP.store(0, std::memory_order_relaxed);
    g_CombatStartWallMs.store(0, std::memory_order_relaxed);
    log("[time] combat time reset");
}

static inline double Round(double v, int decimals = 6) {
    if (decimals < 0) return v;
    double mult = std::pow(10.0, decimals);
    return std::round(v * mult) / mult;
}

// =============================================================================
//  LOGGING
// =============================================================================
void log(const char* fmt, ...) {
    if (!g_Log) return;
    std::string ts = gameTime();
    std::lock_guard<std::mutex> lk(g_Mutex);
    fprintf(g_Log, "[%s] ", ts.c_str());
    va_list args;
    va_start(args, fmt);
    vfprintf(g_Log, fmt, args);
    va_end(args);
    fputc('\n', g_Log);
    fflush(g_Log);
}

void logJson(const json& j) {
    if (!g_JsonLog || j.empty()) return;
    std::lock_guard<std::mutex> lk(g_Mutex);
    fprintf(g_JsonLog, "%s\n", j.dump().c_str());
    fflush(g_JsonLog);
}

// =============================================================================
//  LEVEL MAP
// =============================================================================
// Write a new entry to the levelMap file as a proper JSON array.
// Reads the existing file, appends the entry, and rewrites.

void WriteLevelMapEntry(int32_t configId, int32_t levelTypeData, int32_t levelData, const json& allValueConfigIds) {
    if (configId <= 0) return;
    if (g_LevelMapKnown.count(configId)) return;
    g_LevelMapKnown.insert(configId);

    // Read existing JSON array from file
    json arr = json::array();
    {
        FILE* f = fopen(g_LevelMapPath.c_str(), "r");
        if (f) {
            fseek(f, 0, SEEK_END);
            long sz = ftell(f);
            if (sz > 0) {
                rewind(f);
                std::string buf(sz, '\0');
                size_t read = fread(&buf[0], 1, sz, f);
                buf.resize(read);
                try { arr = json::parse(buf); } catch (...) {}
            }
            fclose(f);
        }
    }

    // Append new entry
    json entry;
    entry["id"]  = configId;
    entry["lt"]  = levelTypeData;
    entry["ld"]  = levelData;
    entry["vc"]  = allValueConfigIds;
    arr.push_back(entry);

    // Rewrite file
    FILE* f = fopen(g_LevelMapPath.c_str(), "w");
    if (f) {
        fprintf(f, "%s", arr.dump().c_str());
        fclose(f);
    }
}

// =============================================================================
//  CONFIG LOADING
// =============================================================================
void loadConfig(const std::string& dir) {
    std::string path = dir + "\\log_config.json";

    FILE* f = fopen(path.c_str(), "r");
    if (!f) {
        f = fopen(path.c_str(), "w");
        if (f) {
            fprintf(f,
                "{\n"
                "  \"buffs\":                          true,\n"
                "  \"effects\":                        true,\n"
                "  \"damage\":                         true,\n"
                "  \"skill_casts\":                    true,\n"
                "  \"on_hit_attacker_stats\":          true,\n"
                "  \"on_hit_defender_stats\":          true,\n"
                "  \"on_hit_buff_list\":               true,\n"
                "  \"on_hit_effect_list\":             true,\n"
                "  \"on_hit_effect_list_information\": true,\n"
                "  \"on_hit_attacker_attr_dict\":      true,\n"
                "  \"on_hit_defender_attr_dict\":      true,\n"
                "  \"player_gizmo\":                   false,\n"
                "  \"monster_gizmo\":                  false,\n"
                "  \"bullet_gizmo\":                   false,\n"
                "  \"hitbox_gizmo\":                   false,\n"
                "  \"hearing_gizmo_for_player\":       false,\n"
                "  \"hearing_gizmo_for_monster\":      false,\n"
                "  \"vision_gizmo_for_player\":        false,\n"
                "  \"vision_gizmo_for_monster\":       false,\n"
                "  \"input_and_vision_gizmo\":         false,\n"
                "  \"monster_path_gizmo\":             false,\n"
                "  \"player_path_gizmo\":              false,\n"
                "  \"camera_gizmo\":                   false,\n"
                "  \"monster_dummy_mode\":             false\n"
                "}\n");
            fclose(f);
            log("[config] log_config.json not found — wrote defaults to %s", path.c_str());
        }
        g_Cfg.buffs                          = true;
        g_Cfg.effects                        = true;
        g_Cfg.damage                         = true;
        g_Cfg.skill_casts                    = true;
        g_Cfg.on_hit_attacker_stats          = true;
        g_Cfg.on_hit_defender_stats          = true;
        g_Cfg.on_hit_buff_list               = true;
        g_Cfg.on_hit_effect_list             = true;
        g_Cfg.on_hit_effect_list_information = true;
        g_Cfg.on_hit_attacker_attr_dict      = true;
        g_Cfg.on_hit_defender_attr_dict      = true;
        return;
    }

    fseek(f, 0, SEEK_END);
    long sz = ftell(f);
    rewind(f);
    std::string buf(sz, '\0');
    fread(&buf[0], 1, sz, f);
    fclose(f);

    try {
        json j = json::parse(buf);
        auto get = [&](const char* key, bool def) -> bool {
            return j.contains(key) ? j[key].get<bool>() : def;
        };
        g_Cfg.buffs                          = get("buffs",                          true);
        g_Cfg.effects                        = get("effects",                        true);
        g_Cfg.damage                         = get("damage",                         true);
        g_Cfg.skill_casts                    = get("skill_casts",                    true);
        g_Cfg.on_hit_attacker_stats          = get("on_hit_attacker_stats",          true);
        g_Cfg.on_hit_defender_stats          = get("on_hit_defender_stats",          true);
        g_Cfg.on_hit_buff_list               = get("on_hit_buff_list",               true);
        g_Cfg.on_hit_effect_list             = get("on_hit_effect_list",             true);
        g_Cfg.on_hit_effect_list_information = get("on_hit_effect_list_information", true);
        g_Cfg.on_hit_attacker_attr_dict      = get("on_hit_attacker_attr_dict",      true);
        g_Cfg.on_hit_defender_attr_dict      = get("on_hit_defender_attr_dict",      true);
        g_Cfg.player_gizmo                   = get("player_gizmo",                   false);
        g_Cfg.monster_gizmo                  = get("monster_gizmo",                  false);
        g_Cfg.bullet_gizmo                   = get("bullet_gizmo",                   false);
        g_Cfg.hitbox_gizmo                   = get("hitbox_gizmo",                   false);
        g_Cfg.hearing_gizmo_for_player       = get("hearing_gizmo_for_player",       false);
        g_Cfg.hearing_gizmo_for_monster      = get("hearing_gizmo_for_monster",      false);
        g_Cfg.vision_gizmo_for_player        = get("vision_gizmo_for_player",        false);
        g_Cfg.vision_gizmo_for_monster       = get("vision_gizmo_for_monster",       false);
        g_Cfg.input_and_vision_gizmo         = get("input_and_vision_gizmo",         false);
        g_Cfg.monster_path_gizmo             = get("monster_path_gizmo",             false);
        g_Cfg.player_path_gizmo              = get("player_path_gizmo",              false);
        g_Cfg.camera_gizmo                   = get("camera_gizmo",                   false);
        g_Cfg.monster_dummy_mode             = get("monster_dummy_mode",             false);

        // Check if config is missing new fields and update it
        if (!j.contains("player_gizmo") || !j.contains("monster_gizmo") ||
            !j.contains("bullet_gizmo") || !j.contains("hitbox_gizmo") ||
            !j.contains("hearing_gizmo_for_player") || !j.contains("hearing_gizmo_for_monster") ||
            !j.contains("vision_gizmo_for_player") || !j.contains("vision_gizmo_for_monster") ||
            !j.contains("input_and_vision_gizmo") || !j.contains("monster_path_gizmo") ||
            !j.contains("player_path_gizmo") || !j.contains("camera_gizmo") ||
            !j.contains("on_hit_attacker_attr_dict") || !j.contains("on_hit_defender_attr_dict") ||
            !j.contains("monster_dummy_mode")) {
            j["player_gizmo"] = false;
            j["monster_gizmo"] = false;
            j["bullet_gizmo"] = false;
            j["hitbox_gizmo"] = false;
            j["hearing_gizmo_for_player"] = false;
            j["hearing_gizmo_for_monster"] = false;
            j["vision_gizmo_for_player"] = false;
            j["vision_gizmo_for_monster"] = false;
            j["input_and_vision_gizmo"] = false;
            j["monster_path_gizmo"] = false;
            j["player_path_gizmo"] = false;
            j["camera_gizmo"] = false;
            j["on_hit_attacker_attr_dict"] = true;
            j["on_hit_defender_attr_dict"] = true;
            j["monster_dummy_mode"] = false;
            FILE* f = fopen(path.c_str(), "w");
            if (f) {
                fprintf(f, "%s", j.dump(2).c_str());
                fclose(f);
                log("[config] Updated log_config.json with new options");
            }
        }
        log("[config] Loaded log_config.json");
        log("[config] Gizmo flags: player=%d monster=%d bullet=%d hitbox=%d "
            "hearing_p=%d hearing_m=%d vision_p=%d vision_m=%d "
            "input_vision=%d monster_path=%d player_path=%d camera=%d dummy=%d",
            g_Cfg.player_gizmo, g_Cfg.monster_gizmo, g_Cfg.bullet_gizmo, g_Cfg.hitbox_gizmo,
            g_Cfg.hearing_gizmo_for_player, g_Cfg.hearing_gizmo_for_monster,
            g_Cfg.vision_gizmo_for_player, g_Cfg.vision_gizmo_for_monster,
            g_Cfg.input_and_vision_gizmo, g_Cfg.monster_path_gizmo,
            g_Cfg.player_path_gizmo, g_Cfg.camera_gizmo, g_Cfg.monster_dummy_mode);
    } catch (...) {
        log("[config] Failed to parse log_config.json — using defaults");
    }
}

// =============================================================================
//  Il2CppString helper
// =============================================================================
std::string Il2CppStringToStd(System_String_o* strObj) {
    if (!strObj) return "?";
    int len = strObj->fields._stringLength;
    if (len <= 0 || len >= 1024) return "zero";
    const uint16_t* chars = &strObj->fields._firstChar;
    std::string out(len, '\0');
    for (int i = 0; i < len; ++i)
        out[i] = (char)chars[i];
    return out;
}

const char* AttrName(int i) {
    static const char* names[] = {
        "NONE","ATK","DEF","MAXHP","HITRATE","EVD","CRITRATE","CRITRESIST",
        "CRITPOWER_P","PENETRATE","DEF_IGNORE","WER","FER","SER","AER","LER",
        "DER","WEE","FEE","SEE","AEE","LEE","DEE","WEP","FEP","SEP","AEP",
        "LEP","DEP","WEI","FEI","SEI","AEI","LEI","DEI","WEERCD","FEERCD",
        "SEERCD","AEERCD","LEERCD","DEERCD","WEIGHT","TOUGHNESS_MAX",
        "TOUGHNESS_DAMAGE_ADJUST","SHIELD_MAX","[45]","MOVESPEED","ATKSPD_P",
        "INTENSITY","GENDMG","DMGPLUS","FINALDMG","FINALDMGPLUS","GENDMGRCD",
        "DMGPLUSRCD","SUPPRESS","NORMALDMG","SKILLDMG","ULTRADMG","OTHERDMG",
        "RCDNORMALDMG","RCDSKILLDMG","RCDULTRADMG","RCDOTHERDMG","MARKDMG",
        "RCDMARKDMG","SUMMONDMG","RCDSUMMONDMG","PROJECTILEDMG","RCDPROJECTILEDMG",
        "NORMALCRITRATE","SKILLCRITRATE","ULTRACRITRATE","MARKCRITRATE",
        "SUMMONCRITRATE","PROJECTILECRITRATE","OTHERCRITRATE","NORMALCRITPOWER",
        "SKILLCRITPOWER","ULTRACRITPOWER","MARKCRITPOWER","SUMMONCRITPOWER",
        "PROJECTILECRITPOWER","OTHERCRITPOWER","ENERGY_MAX","SKILL_INTENSITY",
        "TOUGHNESS_BROKEN_DMG","ADD_SHIELD_STRENGTHEN","BE_ADD_SHIELD_STRENGTHEN",
        "NORMAL_SUPPRESS","SKILL_SUPPRESS","ULTRA_SUPPRESS","MARK_SUPPRESS",
        "SUMMON_SUPPRESS","PROJECTILE_SUPPRESS","OTHER_SUPPRESS","ENV_AMEND","MAX"
    };
    if (i < 0 || i >= (int)(sizeof(names)/sizeof(names[0]))) return "?";
    return names[i];
}

// =============================================================================
//  Effect activation gate
// =============================================================================// The game only ever executes an effect when its Effect config's trigger
// conditions pass (AdventureEffect$$PreExecute, decompiled.c:3635284) and its
// take-effect conditions pass (AdventureEffect$$TakeConditionExcute,
// decompiled.c:3635442). The dump below lists registered / stacked effects
// regardless of that gate, so dormant effects leak into the log — e.g.
// "Daylight Garden" (4028003/4028023, +19.6% Normal/Skill Dmg to the main
// Ventus Trekker) is gated on 'owner element == Ventus (4)' AND 'owner is main
// control' yet stays registered on every team member while inactive.
//
// EvalEffectCondition mirrors AdventureEffect$$ExecuteCondition
// (decompiled.c:3632929) for the condition types that are pure actor state —
// they need no skill/hit/buff event info, which the dump does not have:
//   0 / 1 / 29  NONE / DEFAULT / TIME_INTERVAL → true (decompiled.c:3633139)
//   10  ACTORELEMENTTYPE    → element == param1, else hitElementTypeExtension
//                             contains param1 (decompiled.c:3633298)
//   18  HAVE_SHIELD         → actorShield._shieldValue > 0 (decompiled.c:3633430)
//   19  NO_SHIELD           → actorShield._shieldValue < 1 (decompiled.c:3633446)
//   41  SELF_BE_MIANCONTROL → effect owner's isAssist == false (decompiled.c:3634069)
//   42  SELF_BE_ASSISTANT   → effect owner's isAssist == true  (decompiled.c:3634080)
//   52  BE_MIANCONTROL      → impact actor's isAssist == false (decompiled.c:3634317)
//   53  BE_ASSISTANT        → impact actor's isAssist == true  (decompiled.c:3634326)
// Any other condition type depends on event info → unknown (-1): the entry is
// kept, matching the previous behaviour.
static bool TryParseIntParam(System_String_o* s, bool allowEmpty, int32_t& out) {    // Mirrors AdventureEffect$$TryParseStringParamToInt: empty parses to 0 when
    // allowEmpty; otherwise a strict full-string int parse (like int.TryParse —
    // "0.196" and other non-integers fail).
    if (!s) { if (allowEmpty) { out = 0; return true; } return false; }
    int32_t len = s->fields._stringLength;
    if (len <= 0) { if (allowEmpty) { out = 0; return true; } return false; }
    const uint16_t* chars = &s->fields._firstChar;
    int i = 0;
    bool neg = false;
    if (chars[0] == u'-') { neg = true; i = 1; }
    else if (chars[0] == u'+') { i = 1; }
    if (i >= len) return false;
    int64_t acc = 0;
    for (; i < len; ++i) {
        uint16_t c = chars[i];
        if (c < u'0' || c > u'9') return false;
        acc = acc * 10 + (c - u'0');
        if (acc > 2147483647LL) return false;
    }
    out = (int32_t)(neg ? -acc : acc);
    return true;
}

static bool ActorIsA(const void* klass, const char* className) {
    // Walk the il2cpp parent chain comparing class names. Il2CppClass starts
    // with Il2CppClass_1 (name / namespaze / parent, game_structs.h:38).
    const Il2CppClass_1* k = reinterpret_cast<const Il2CppClass_1*>(klass);
    while (k) {
        if (k->name && strcmp(k->name, className) == 0) return true;
        k = reinterpret_cast<const Il2CppClass_1*>(k->parent);
    }
    return false;
}

// Returns 1 = pass, 0 = definitively fail (inactive), -1 = unknown.
static int EvalEffectCondition(AdventureActor_o* impact, AdventureActor_o* owner,
                               int32_t cond, System_String_o* p1, System_String_o* p2) {
    switch (cond) {
    case 0:
    case 1:
    case 29:
        return 1;
    case 10: {  // ACTORELEMENTTYPE
        int32_t v;
        if (!TryParseIntParam(p1, false, v)) return 0;
        if (!impact) return 0;
        auto* ei = impact->fields.actorElementInfo;
        if (!ei) return 0;
        if (ei->fields._elementType_k__BackingField == v) return 1;
        auto* ext = ei->fields.hitElementTypeExtension;
        if (!ext || !ext->fields._items) return 0;
        int32_t n = ext->fields._size;
        if (n > (int32_t)ext->fields._items->max_length) n = (int32_t)ext->fields._items->max_length;
        for (int32_t i = 0; i < n; ++i)
            if (ext->fields._items->m_Items[i] == v) return 1;
        return 0;
    }
    case 18: {  // HAVE_SHIELD
        if (!impact) return 0;
        auto* sh = impact->fields.actorShield;
        if (!sh) return 0;
        return sh->fields._shieldValue > 0 ? 1 : 0;
    }
    case 19: {  // NO_SHIELD
        if (!impact) return 0;
        auto* sh = impact->fields.actorShield;
        if (!sh) return 0;
        return sh->fields._shieldValue < 1 ? 1 : 0;
    }
    case 41: {  // SELF_BE_MIANCONTROL — the effect owner must be main control
        if (!owner) return 0;
        if (!ActorIsA(owner->klass, "PlayerAdventureActor")) return 0;
        return !reinterpret_cast<PlayerAdventureActor_o*>(owner)->fields.isAssist ? 1 : 0;
    }
    case 42: {  // SELF_BE_ASSISTANT
        if (!owner) return 0;
        if (!ActorIsA(owner->klass, "PlayerAdventureActor")) return 0;
        return reinterpret_cast<PlayerAdventureActor_o*>(owner)->fields.isAssist ? 1 : 0;
    }
    case 52: {  // BE_MIANCONTROL — the impact actor must be main control
        if (!impact) return 0;
        if (!ActorIsA(impact->klass, "PlayerAdventureActor")) return 0;
        return !reinterpret_cast<PlayerAdventureActor_o*>(impact)->fields.isAssist ? 1 : 0;
    }
    case 53: {  // BE_ASSISTANT
        if (!impact) return 0;
        if (!ActorIsA(impact->klass, "PlayerAdventureActor")) return 0;
        return reinterpret_cast<PlayerAdventureActor_o*>(impact)->fields.isAssist ? 1 : 0;
    }
    default:
        return -1;
    }
}

// One condition group. Target 0 → pass (AdventureEffect$$CheckCondition,
// decompiled.c:3632790). Target 1 = self → the effect owner (GetGoals case 1,
// decompiled.c:3634640); other goals (enemy / all players / faction) need
// actor enumeration the dump cannot do → unknown. Every impact actor must
// pass (decompiled.c:3632800 loop).
static int EvalConditionGroup(AdventureActor_o* owner, int32_t target, int32_t cond,
                              System_String_o* p1, System_String_o* p2,
                              System_String_o* p3, System_String_o* p4) {
    if (target == 0) return 1;
    if (target != 1) return -1;
    if (!owner) return 0;   // null impact actor throws in-game → treated as fail
    (void)p3; (void)p4;
    return EvalEffectCondition(owner, owner, cond, p1, p2);
}

// Combine two groups with a logic type: 1 = AND, 2 = OR; any other value fails
// in the game itself (decompiled.c:3635305 trigger / 3635516 take-effect).
static int CombineConditionGroups(int g1, int g2, int32_t logicType) {
    if (logicType == 1) {  // AND
        if (g1 == 0 || g2 == 0) return 0;
        if (g1 == 1 && g2 == 1) return 1;
        return -1;
    }
    if (logicType == 2) {  // OR
        if (g1 == 1 || g2 == 1) return 1;
        if (g1 == 0 && g2 == 0) return 0;
        return -1;
    }
    return 0;
}

// Full activation gate for a live AdventureEffect: trigger conditions AND
// take-effect conditions must both pass. Returns 1 = active, 0 = definitively
// inactive (skip in the dump), -1 = unknown (keep, previous behaviour).
static int EffectActivationGate(const AdventureEffect_o* effect) {
    if (!effect) return -1;
    auto* cfg = effect->fields._effectConfig_k__BackingField;
    if (!cfg) return -1;
    AdventureActor_o* owner = effect->fields._owner;

    int trig = CombineConditionGroups(
        EvalConditionGroup(owner, cfg->fields.triggerTarget_, cfg->fields.triggerCondition1_,
                           cfg->fields.triggerParam1_, cfg->fields.triggerParam2_,
                           cfg->fields.triggerParam3_, cfg->fields.triggerParam4_),
        EvalConditionGroup(owner, cfg->fields.triggerTarget2_, cfg->fields.triggerCondition2_,
                           cfg->fields.trigger2Param1_, cfg->fields.trigger2Param2_,
                           cfg->fields.trigger2Param3_, cfg->fields.trigger2Param4_),
        cfg->fields.triggerLogicType_);
    int take = CombineConditionGroups(
        EvalConditionGroup(owner, cfg->fields.takeEffectTarget1_, cfg->fields.takeEffectCondition1_,
                           cfg->fields.takeEffectParam1_, cfg->fields.takeEffectParam2_,
                           cfg->fields.takeEffectParam3_, cfg->fields.takeEffectParam4_),
        EvalConditionGroup(owner, cfg->fields.takeEffectTarget2_, cfg->fields.takeEffectCondition2_,
                           cfg->fields.takeEffect2Param1_, cfg->fields.takeEffect2Param2_,
                           cfg->fields.takeEffect2Param3_, cfg->fields.takeEffect2Param4_),
        cfg->fields.takeEffectLogicType_);

    if (trig == 0 || take == 0) return 0;
    if (trig == 1 && take == 1) return 1;
    return -1;
}

// =============================================================================
//  Actor logging utilities
// =============================================================================

std::string adventureActorId(AdventureActor_o* actor) {
    if (!actor) return "null";

    int32_t dataId = actor->fields._dataID_k__BackingField;
    int32_t skinId = actor->fields._skinID_k__BackingField;

    bool isBelongToPlayer = false;
    auto* attrList = actor->fields.attributeList;
    if (attrList)
        isBelongToPlayer = attrList->fields.isBelongToPlayer;

    // Return a compact string: "p:<dataId>" for players, "e:<skinId>" for enemies.
    // JS will resolve these to display names using the same game data files.
    char buf[32];
    if (isBelongToPlayer)
        snprintf(buf, sizeof(buf), "p:%d", dataId);
    else
        snprintf(buf, sizeof(buf), "e:%d", skinId);
    return buf;
}

std::string adventureActorDisplay(AdventureActor_o* actor) {
    // Display is now resolved in JS; emit the same key as adventureActorId.
    return adventureActorId(actor);
}

// overlay is optional — when provided, its amendments are added on top of the
// live AttributeList values at serialization time (no mutation of game memory).
json logAdventureActorAttrsJson(AttributeList_o* attrList, const std::vector<ElemDictEntry>* overlay) {
    json j;
    if (!attrList) return j;
    auto* entries = attrList->fields.entries;
    if (!entries) return j;

    int32_t count = (int32_t)entries->max_length;
    json attrs = json::array();

    for (int i = 0; i < count && i < 98; ++i) {
        const auto& e = entries->m_Items[i].fields;
        double origin = (double)e.origin / FDP_ONE;
        double base_  = (double)e.baseAmend / FDP_ONE;
        double pct    = (double)e.percentAmend / FDP_ONE;
        double abs_   = (double)e.absAmend / FDP_ONE;

        if (overlay) {
            for (const auto& ov : *overlay) {
                if (ov.attributeType != i) continue;
                switch (ov.mode) {
                    case 0: base_ += ov.value; break;
                    case 1: abs_  += ov.value; log("attributeType=assign ??"); break; // assign treated as abs
                    case 2: pct   += ov.value; break;
                }
            }
        }

        auto nearZero = [](double v) { return v > -1e-7 && v < 1e-7; };
        if (nearZero(origin) &&
            nearZero(base_) && nearZero(pct) && nearZero(abs_)) {
            attrs.push_back(json::object());  // empty object — JS treats as all-zero
            continue;
        }

        json attr;
        attr["id"] = i;
        if (!nearZero(origin)) attr["origin"] = Round(origin, 4);
        if (!nearZero(base_))   attr["base"]   = Round(base_, 4);
        if (!nearZero(pct))     attr["pct"]    = Round(pct, 4);
        if (!nearZero(abs_))    attr["abs"]    = Round(abs_, 4);
        attrs.push_back(attr);
    }

    j["attrs"] = attrs;
    return j;
}

json logAdventureActorSpecialAttrsJson(AdventureActor_o* actor) {
    json j;
    if (!actor) return j;

    auto* specialAttrList = actor->fields.specialAttributeList;
    if (!specialAttrList) return j;

    auto* entries = specialAttrList->fields.entries;
    if (!entries) return j;

    int32_t count = entries->max_length;

    json sattrs = json::array();
    for (int i = 0; i < count && i < 64; ++i) {
        const auto& e = entries->m_Items[i].fields;
        double current  = (double)e.current / FDP_ONE;
        int32_t max_type = e.max_type;

        auto nearZero = [](double v) { return v > -1e-7 && v < 1e-7; };
        if (nearZero(current) && max_type == 0) continue;

        json sattr;
        sattr["id"]      = i;
        sattr["current"] = Round(current, 6);
        sattr["maxType"] = max_type;
        sattrs.push_back(sattr);
    }

    j["specialAttrs"] = sattrs;
    return j;
}

// =============================================================================
//  Debug Gizmos
// =============================================================================
bool EnableAllDebugGizmos(uintptr_t moduleBase)
{
    if (!moduleBase) return false;

    // Resolve the AdventureModuleDebugHelper singleton the same way the engine
    // does (SceneSingleton<T>.get_Instance chain — see GetDebugHelperInstance
    // in proxy.cpp).  Returns null until the instance exists; the caller re-runs
    // this every logic tick so it takes effect as soon as the helper is up.
    void* helper = GetDebugHelperInstance();
    if (!helper) return false;
    uintptr_t obj = reinterpret_cast<uintptr_t>(helper);

    // Enable based on config
    *(char *)(obj + 0x28) = g_Cfg.player_gizmo ? 1 : 0; // PlayerGizmo
    *(char *)(obj + 0x29) = g_Cfg.monster_gizmo ? 1 : 0; // MonsterGizmo
    *(char *)(obj + 0x2A) = g_Cfg.bullet_gizmo ? 1 : 0; // BulletGizmo
    *(char *)(obj + 0x2B) = g_Cfg.hitbox_gizmo ? 1 : 0; // HitboxGizmo
    *(char *)(obj + 0x2C) = g_Cfg.hearing_gizmo_for_player ? 1 : 0; // HearingGizmoForPlayer
    *(char *)(obj + 0x2D) = g_Cfg.hearing_gizmo_for_monster ? 1 : 0; // HearingGizmoForMonster
    *(char *)(obj + 0x2E) = g_Cfg.vision_gizmo_for_player ? 1 : 0; // VisionGizmoForPlayer
    *(char *)(obj + 0x2F) = g_Cfg.vision_gizmo_for_monster ? 1 : 0; // VisionGizmoForMonster
    *(char *)(obj + 0x30) = g_Cfg.input_and_vision_gizmo ? 1 : 0; // InputAndVisionGizmo
    *(char *)(obj + 0x31) = g_Cfg.monster_path_gizmo ? 1 : 0; // MonsterPathGizmo
    *(char *)(obj + 0x32) = g_Cfg.player_path_gizmo ? 1 : 0; // PlayerPathGizmo
    *(char *)(obj + 0x33) = g_Cfg.camera_gizmo ? 1 : 0; // CameraGizmo

    return true;
}

// =============================================================================
//  ElementOrDmgDict helpers (used in BuildHitJson to overlay attrs at log time)
// =============================================================================
struct ElementOrDmgAttrKey {
    int32_t attributeType;        // bits [23:16]
    int32_t elementOrDamageType;  // bits [15:8]
    bool    isElementType;        // bits [31:24]
    int32_t mode;                 // bits [1:0]: 0=base, 1=assign, 2=percentAmend
};

static ElementOrDmgAttrKey DecodeElemKey(int32_t key) {
    ElementOrDmgAttrKey k;
    k.isElementType       = (key >> 24) & 0xFF;
    k.attributeType       = (key >> 16) & 0xFF;
    k.elementOrDamageType = (key >>  8) & 0xFF;
    k.mode                = key & 3;
    return k;
}

// Read all entries from an attributeWithElementOrDamageTypeDict into a flat list
// so we can apply them on top of an AttributeList_o at serialization time
// without touching the live game data.
static std::vector<ElemDictEntry> ReadElemDict(ActorAdditionalAttrInfo_o* info) {
    std::vector<ElemDictEntry> out;
    if (!info) return out;
    auto* dict = info->fields.attributeWithElementOrDamageTypeDict;
    if (!dict || !dict->fields._entries) return out;

    auto* arr    = reinterpret_cast<System_Collections_Generic_Dictionary_Entry_int__FDP__array*>(dict->fields._entries);
    int32_t cap  = (int32_t)arr->max_length;
    if (cap <= 0 || cap > 4096) return out;

    for (int32_t i = 0; i < cap; ++i) {
        const auto& e = arr->m_Items[i].fields;
        if (e.hashCode <= 0) continue;
        ElementOrDmgAttrKey k = DecodeElemKey(e.key);
        out.push_back({ k.attributeType, k.elementOrDamageType, k.isElementType, k.mode, (double)e.value / FDP_ONE });
    }
    return out;
}


// Filter element/damage-type overlay entries: only keep entries matching the
// hit's element type (for isElementType=true) or damage type (for isElementType=false).
static std::vector<ElemDictEntry> FilterElemDictForHit(
    const std::vector<ElemDictEntry>& entries,
    int32_t hitElementType, int32_t hitDamageType) {
    if (entries.empty()) return entries;
    std::vector<ElemDictEntry> out;
    out.reserve(entries.size());
    for (const auto& e : entries) {
        if (e.isElementType) {
            if (e.elementOrDamageType == hitElementType)
                out.push_back(e);
        } else {
            if (e.elementOrDamageType == hitDamageType)
                out.push_back(e);
        }
    }
    return out;
}


void BuildBuffJson(const char* type, int32_t configId, AdventureActor_o* owner, AdventureActor_o* fromActor, int isAdd, int32_t buffNum) {
    json j;
    j["Type"] = "Buff";
    j["Action"] = isAdd > 0 ? "Add" : "Remove";
    j["Time"] = gameTime();

    if (owner) {
        j["Owner"] = adventureActorId(owner);
        j["OwnerDisplay"] = adventureActorDisplay(owner);
    }

    if (fromActor) {
        j["Source"] = adventureActorId(fromActor);
        j["SourceDisplay"] = adventureActorDisplay(fromActor);
    }

    j["ConfigId"] = configId;

    if (buffNum > 0)
        j["Stacks"] = buffNum;

    j["SubType"] = type;

    logJson(j);
}

// Build a JSON object listing all active Buffs on an actor.
json BuildBuffListJson(AdventureActor_o* fromActor) {
    json j;
    if (!fromActor) return j;
    BuffCom_o* buffCom = fromActor->fields.buffComponent;
    if (!buffCom) return j;
    System_Collections_Generic_List_BuffEntity__o* buffList = buffCom->fields._BuffList_k__BackingField;
    if (!buffList) return j;

    auto* itemsArray = buffList->fields._items;   // BuffEntity_array*
    int32_t count    = buffList->fields._size;

    j["buffCount"] = count;
    json buffs = json::array();

    if (itemsArray && count > 0) {
        for (int i = 0; i < count; ++i) {
            auto* be = itemsArray->m_Items[i];    // BuffEntity_o*
            if (!be) continue;

            int32_t configId = 0;
            if (be->fields.buffConfig)
                configId = be->fields.buffConfig->fields.id_;
            json buff;
            buff["configId"] = configId;
            buff["stacks"]   = be->fields.buffNum;
            buff["totalTime"] = Round((double)be->fields.configBuffTime.fields._serializedValue / FP_ONE, 2);
            buff["leftTime"]  = Round((double)be->fields.buffLeftTime.fields._serializedValue / FP_ONE, 2);
            buffs.push_back(buff);
        }
    }
    j["buffs"] = buffs;
    return j;
}

// Helper: collect all keys from a Dictionary<int, T*> by raw slot iteration.
// dictPtr points to the Dictionary Il2CppObject (not pointer-to-pointer).
// NOTE: IL2CPP Dictionary layout: klass(8)+monitor(8)+_syncRoot(8)+_entries(8)
//       _entries at +0x18, _count at +0x20, _freeList at +0x24, _freeCount at +0x28
static std::unordered_set<int32_t> CollectDictKeys(void* dictPtr) {
    std::unordered_set<int32_t> keys;
    if (!dictPtr) return keys;

    uintptr_t base = reinterpret_cast<uintptr_t>(dictPtr);
    auto* entriesArr = *reinterpret_cast<void**>(base + 0x18);  // fields._entries
    int32_t count    = *reinterpret_cast<int32_t*>(base + 0x20); // fields._count

    if (!entriesArr || count <= 0 || count > 65536) return keys;

    constexpr size_t entrySize   = 0x18;  // hashCode(4)+next(4)+key(4)+value(8)
    constexpr size_t keyOffset   = 0x08;
    constexpr size_t arrayHeader = 0x20;  // klass(8)+monitor(8)+bounds(8)+max_length(8)
    uintptr_t items = reinterpret_cast<uintptr_t>(entriesArr) + arrayHeader;

    for (int i = 0; i < count; ++i) {
        uintptr_t slot = items + i * entrySize;
        int32_t hashCode = *reinterpret_cast<int32_t*>(slot);
        if (hashCode < 0) continue;
        int32_t key = *reinterpret_cast<int32_t*>(slot + keyOffset);
        if (key > 0) keys.insert(key);
    }
    return keys;
}

// Build a JSON object listing all active AdventureEffects on an actor.
json BuildEffectListJson(ActorEffectManage_o* effectManage, bool includeDetails,
                          GameDataController_o* gdc,
                          FnGetEffectValue GetEffectValue,
                          FnGetOnceAttr GetOnceAttr,
                          FnGetValueConfigId GetValueConfigId,
                          FnGetOnceAdditionalAttributeValue GetAttrValue,
                          AdventureActor_o* resolveActor,
                          const EffectSnapshot* effectSnapshot,
                          const std::unordered_set<int32_t>* appliedHittedAttrFix) {
    //ActorEffectManage has a list of Effects, each effect has a list of its derivative effects that are actually active
    json j;
    if (!effectManage) return j;

    auto* effectsDict = effectManage->fields.effectsDict;
    if (!effectsDict) return j;

    // Pre-build key set from GDC's EffectValue_Map for fast level-enumeration lookups
    std::unordered_set<int32_t> effectValueKeys;
    if (gdc && gdc->fields.EffectValue_Map) {
        static bool once = false;
        effectValueKeys = CollectDictKeys(gdc->fields.EffectValue_Map);
    } else {
        static bool once2 = false;
        if (!once2) {
            once2 = true;
            log("[LVLMAP] MISSING: gdc=%p fields.EffectValue_Map=%p",
                (void*)gdc,
                (void*)(gdc ? gdc->fields.EffectValue_Map : nullptr));
        }
    }

    auto* entriesArr = effectsDict->fields._entries;
    int   slotCount  = effectsDict->fields._count;
    int   freeCount  = effectsDict->fields._freeCount;
    int   liveCount  = slotCount - freeCount;

    j["liveCount"] = liveCount;
    json effects = json::array();

    // ── Inherited effects for minion actor hits ───────────────────────
    // Only for minions mapped in g_MinionToPlayer (damageTypeTemp=1 actor hits).
    // Area/weapon snapshots already capture the correct effects via IsUseHitFromSummon.
    // Effect-inheritance source per path:
    //  - live-inherit (summonAttrType=1): the minion's stats are the player's LIVE
    //    values at summon time, so use the per-minion summonSnapshot captured then.
    //  - snapshot path (summonAttrType=2): the minion's stats come from the player's
    //    battle-start snapshot, so resolve g_PlayerSnapshots via playerId.
    if (resolveActor) {
        std::string actorId = adventureActorId(resolveActor);

        const PlayerEffectSnapshot* src = nullptr;
        {
            std::lock_guard<std::mutex> mlk(g_MinionLinkMutex);
            auto mIt = g_MinionToPlayer.find(actorId);
            if (mIt != g_MinionToPlayer.end()) {
                if (!mIt->second.summonSnapshot.entries.empty())
                    src = &mIt->second.summonSnapshot;
                else if (!mIt->second.playerId.empty()) {
                    std::lock_guard<std::mutex> plk(g_PlayerSnapshotMutex);
                    auto pIt = g_PlayerSnapshots.find(mIt->second.playerId);
                    if (pIt != g_PlayerSnapshots.end())
                        src = &pIt->second;
                }
            }
        }

        if (src) {
            for (auto& e : src->entries) {
                json je;
                je["configId"] = e.configId;
                je["valueConfigId"] = e.valueConfigId;
                je["sourceType"] = e.sourceType;
                je["damage"] = e.damage;
                je["effectType"] = 12;  // ATTR_FIX
                je["attrType"] = e.attributeType;
                je["baseStatOnSnapshot"] = e.baseStatOnSnapshot;
                je["pctStatOnSnapshot"] = e.pctStatOnSnapshot;
                je["attributeType"] = e.attributeType;
                je["parameterType"] = e.parameterType;
                je["fromOwnerSnapshot"] = true;
                if (!e.ownerId.empty())
                    je["owner"] = e.ownerId;
                json allValueOptions = json::array();
                if (!effectValueKeys.empty() && e.configId > 0) {
                    bool anyFound = false;
                    for (int lvl = 0; lvl <= 50; ++lvl) {
                        int32_t vid = e.configId + lvl * 10;
                        if (effectValueKeys.count(vid)) {
                            anyFound = true;
                            json ve;
                            ve["l"] = lvl;
                            ve["v"] = vid;
                            allValueOptions.push_back(ve);
                        } else if (anyFound) break;
                    }
                }
                WriteLevelMapEntry(e.configId, 0, 0, allValueOptions);
                effects.push_back(je);
            }
        }
    }
    // ── End inherited effects ─────────────────────────────────────────


    if (effectSnapshot) {
        AdventureActor_o* actor = effectManage->fields._actor;
        std::string actorId = actor ? adventureActorId(actor) : "";
        // Build a quick lookup by effect ID: find live effects still in the dict
        std::unordered_set<int32_t> dictIds;
        if (entriesArr && slotCount > 0) {
            for (int i = 0; i < slotCount; ++i) {
                const auto& e = entriesArr->m_Items[i].fields;
                if (e.hashCode < 0) continue;
                AdventureEffect_o* effect = reinterpret_cast<AdventureEffect_o*>(e.value);
                if (!effect || effect->fields.removed) continue;
                dictIds.insert(effect->fields.id);
            }
        }
        for (auto instId : *effectSnapshot) {
            json je;
            // Try live effect first
            bool usedLive = false;
            if (dictIds.count(instId) && entriesArr && slotCount > 0) {
                for (int i = 0; i < slotCount; ++i) {
                    const auto& e = entriesArr->m_Items[i].fields;
                    if (e.hashCode < 0) continue;
                    AdventureEffect_o* effect = reinterpret_cast<AdventureEffect_o*>(e.value);
                    if (!effect || effect->fields.removed) continue;
                    if (effect->fields.id != instId) continue;
                    if (EffectActivationGate(effect) == 0) {
                        // Trigger/take-effect conditions definitively fail right
                        // now — the effect is dormant (e.g. "Daylight Garden"
                        // while its owner is not the main Ventus Trekker). Skip
                        // the entry and the instance-snapshot fallback below.
                        usedLive = true;
                        break;
                    }
                    auto* effectCfg = effect->fields._effectConfig_k__BackingField;
                    int32_t baseConfigId = effectCfg ? effectCfg->fields.id_ : 0;
                    int32_t ltd = effectCfg ? effectCfg->fields.levelTypeData_ : 0;
                    int32_t ld = effectCfg ? effectCfg->fields.levelData_ : 0;
                    json allValueOptions = json::array();
                    if (!effectValueKeys.empty() && baseConfigId > 0) {
                        bool anyFound = false;
                        for (int lvl = 0; lvl <= 50; ++lvl) {
                            int32_t vid = baseConfigId + lvl * 10;
                            if (effectValueKeys.count(vid)) { anyFound = true;
                                json ve; ve["l"] = lvl; ve["v"] = vid;
                                allValueOptions.push_back(ve);
                            } else if (anyFound) break;
                        }
                    }
                    WriteLevelMapEntry(baseConfigId, ltd, ld, allValueOptions);
                    auto* stack = effect->fields._effectStack;
                    if (stack && stack->fields._array) {
                        auto* array = stack->fields._array;
                        int size = stack->fields._size;
                        for (int s = 0; s < size; ++s) {
                            AdventureEffectBase_o* base = array->m_Items[s];
                            if (!base) continue;
                            AdventureEffect_o* parentEffect = base->fields._effect;
                            auto* ValueCfgPtr = parentEffect->fields._effectValueConfig_k__BackingField;
                            je["configId"] = baseConfigId;
                            je["valueConfigId"] = ValueCfgPtr ? ValueCfgPtr->fields.id_ : 0;
                            je["sourceType"] = parentEffect->fields.sourceType;
                            je["damage"] = static_cast<int64_t>(parentEffect->fields.Damage);
                            if (parentEffect->fields._owner)
                                je["owner"] = adventureActorId(parentEffect->fields._owner);
                            effects.push_back(je);
                            usedLive = true;
                        }
                    }
                    break;
                }
            }
            if (!usedLive) {
                InstanceSnapInfo info;
                if (!GetInstanceSnapInfo(instId, actorId, info)) {
                    int32_t cfgId = GetConfigForInstance(instId);
                    if (cfgId <= 0) continue;
                    info.configId = cfgId;
                }
                je["configId"] = info.configId;
                je["valueConfigId"] = info.valueConfigId;
                je["sourceType"] = info.sourceType;
                je["damage"] = info.damage;
                if (!info.ownerId.empty()) je["owner"] = info.ownerId;
                json allValueOptions = json::array();
                if (!effectValueKeys.empty() && info.configId > 0) {
                    bool anyFound = false;
                    for (int lvl = 0; lvl <= 50; ++lvl) {
                        int32_t vid = info.configId + lvl * 10;
                        if (effectValueKeys.count(vid)) { anyFound = true;
                            json ve; ve["l"] = lvl; ve["v"] = vid;
                            allValueOptions.push_back(ve);
                        } else if (anyFound) break;
                    }
                }
                WriteLevelMapEntry(info.configId, info.levelTypeData, info.levelData, allValueOptions);
                effects.push_back(je);
            }
        }
        j["effects"] = effects;
        return j;
    }

    if (entriesArr && slotCount > 0) {
        for (int i = 0; i < slotCount; ++i) {
            const auto& e = entriesArr->m_Items[i].fields;
            if (e.hashCode < 0) continue; // free slot

            AdventureEffect_o* effect = reinterpret_cast<AdventureEffect_o*>(e.value);
            if (!effect) continue;
            if (effect->fields.removed) continue;
            if (EffectActivationGate(effect) == 0) continue; // inactive — dormant registered effect

            // Pre-compute level config data for this effect (shared by all stack items)
            auto* effectCfg = effect->fields._effectConfig_k__BackingField;
            int32_t baseConfigId = effectCfg ? effectCfg->fields.id_ : 0;
            int32_t levelTypeData = effectCfg ? effectCfg->fields.levelTypeData_ : 0;
            int32_t levelData = effectCfg ? effectCfg->fields.levelData_ : 0;

            // Enumerate all possible value config IDs for this effect at different levels
            json allValueOptions = json::array();
            if (!effectValueKeys.empty() && baseConfigId > 0) {
                static bool once3 = false;
                bool anyFound = false;
                for (int lvl = 0; lvl <= 50; ++lvl) {
                    int32_t vid = baseConfigId + lvl * 10;
                    if (effectValueKeys.count(vid)) {
                        anyFound = true;
                        json ve;
                        ve["l"] = lvl;
                        ve["v"] = vid;
                        allValueOptions.push_back(ve);
                    } else if (anyFound) {
                        break;
                    }
                }
                if (!once3 && anyFound) {
                    once3 = true;
                    log("[LVLMAP] baseConfigId=%d first key at lvl=0 vid=%d found=%d keysample=%zu",
                        baseConfigId, baseConfigId + 0*10, (int)(effectValueKeys.count(baseConfigId)),
                        effectValueKeys.size() > 0 ? *(effectValueKeys.begin()) : 0);
                }
            }
            WriteLevelMapEntry(baseConfigId, levelTypeData, levelData, allValueOptions);

            auto* stack = effect->fields._effectStack; // System_Collections_Generic_Stack_AdventureEffectBase__o*
            if (stack && stack->fields._array) {
                auto* array = stack->fields._array;     // AdventureEffectBase_array*
                int size = stack->fields._size;         // number of items currently in stack

                for (int s = 0; s < size; ++s) {

                    json je;
                    AdventureEffectBase_o* base = array->m_Items[s];
                    if (!base) continue;

                    AdventureEffect_o* parentEffect = base->fields._effect;

                    // HITTED_ADDITIONAL_ATTR_FIX (effectType 45) effects stay in the
                    // effectsDict permanently, but their stat only actually lands in the
                    // per-hit fromAdditionalAttrInfo when HittedAdditionalAttriFix_Execute
                    // runs during that hit (it has no PostExecute; the whole snapshot is
                    // cleared between hits). So a dict entry is NOT proof it is applied.
                    // Only include it when the hook saw its Execute fire for this hit.
                    if (parentEffect && parentEffect->fields._effectType == 45) {
                        if (!appliedHittedAttrFix ||
                            !appliedHittedAttrFix->count(baseConfigId)) {
                            continue;
                        }
                    }

                    auto* ValueCfgPtr = parentEffect->fields._effectValueConfig_k__BackingField;
                    je["configId"] = baseConfigId;
                    je["valueConfigId"] = ValueCfgPtr ? ValueCfgPtr->fields.id_ : 0;
                    je["sourceType"] = parentEffect->fields.sourceType;
                    je["damage"]     = static_cast<int64_t>(parentEffect->fields.Damage);

                    if (parentEffect->fields._owner)
                        je["owner"] = adventureActorId(parentEffect->fields._owner);

                    effects.push_back(je);
                }
            }
        }
    }

    j["effects"] = effects;


    auto* timeTrigList = effectManage->fields._timeTriggerEffects;
    json timeTrig = json::array();

    if (timeTrigList) {
        auto* itemsArr = timeTrigList->fields._items; // AdventureEffect_array*
        int   size     = timeTrigList->fields._size;

        if (itemsArr && size > 0) {
            for (int i = 0; i < size; ++i) {
                AdventureEffect_o* effect = itemsArr->m_Items[i];
                if (!effect) continue;
                auto* trigCfg = effect->fields._effectConfig_k__BackingField;
                if (trigCfg && (trigCfg->fields.trigger_ == 3 || trigCfg->fields.trigger_ == 5)) continue;
                if (effectSnapshot && !effectSnapshot->count(effect->fields.id)) continue;
                if (EffectActivationGate(effect) == 0) continue; // inactive — skip
                json te;
                te["id"]         = effect->fields.id;   // unique effect id (key in effectsDict)
                auto* cfgPtr = effect->fields._effectConfig_k__BackingField;
                te["configId"]   = cfgPtr ? cfgPtr->fields.id_ : 0;
                te["sourceType"] = effect->fields.sourceType;
                te["effectType"] = effect->fields._effectType;
                timeTrig.push_back(te);
            }
        }
    }
    j["timeTriggerEffects"] = timeTrig;


    return j;
}

// Build a JSON array from a Dictionary<int,int> (attrId -> stackCount),
// resolving each entry's valueConfigId through GetOnceAttr -> GetValueConfigId
// and skipping entries whose value the damage calc would never consume (see
// the applied check below).
json BuildAdditionalAttrDictJson(
    System_Collections_Generic_Dictionary_int__int__o* dict,
    AdventureActor_o*                    fromActor,
    GameDataController_o*                gdc,
    FnGetOnceAttr                        GetOnceAttr,
    FnGetValueConfigId                   GetValueConfigId,
    FnGetOnceAdditionalAttributeValue    GetAttrValue,
    int32_t                              hitElementType)
{
    json arr = json::array();
    if (!dict || !dict->klass || !dict->fields._entries) return arr;

    auto* entryArr = reinterpret_cast<System_Collections_Generic_Dictionary_Entry_int__int__array*>(dict->fields._entries);
    int32_t capacity = static_cast<int32_t>(entryArr->max_length);
    if (capacity <= 0 || capacity > 4096) return arr;

    // Pre-build key set from GDC's OnceAdditionalAttributeValue_Map
    std::unordered_set<int32_t> attrValueKeys;
    if (gdc && gdc->fields.OnceAdditionalAttributeValue_Map) {
        attrValueKeys = CollectDictKeys(gdc->fields.OnceAdditionalAttributeValue_Map);
    }

    for (int32_t i = 0; i < capacity; ++i) {
        const auto& e = entryArr->m_Items[i].fields;
        if (e.hashCode <= 0) continue; // vacant or deleted slot

        json entry;
        entry["attrId"] = e.key;
        entry["stacks"] = e.value;

        // Full GDC resolution — resolve valueConfigId only
        if (gdc && fromActor && GetOnceAttr && GetValueConfigId) {
            Nova_Client_OnceAdditionalAttribute_o* def = GetOnceAttr(gdc, e.key, nullptr);
            if (def && def->klass) {
                int32_t baseId = def->fields.id_;
                int32_t lt = def->fields.levelTypeData_;
                int32_t ld = def->fields.levelData_;
                int32_t currentValueConfigId = GetValueConfigId(
                    fromActor, baseId, lt, ld, nullptr);
                entry["valueConfigId"] = currentValueConfigId;

                // Enumerate all possible value config IDs for this attribute at different levels
                json allValueOptions = json::array();
                if (!attrValueKeys.empty() && baseId > 0) {
                    bool anyFound = false;
                    for (int lvl = 0; lvl <= 50; ++lvl) {
                        int32_t vid = baseId + lvl * 10;
                        if (attrValueKeys.count(vid)) {
                            anyFound = true;
                            json ve;
                            ve["l"] = lvl;
                            ve["v"] = vid;
                            allValueOptions.push_back(ve);
                        } else if (anyFound) {
                            break;
                        }
                    }
                }
                WriteLevelMapEntry(baseId, lt, ld, allValueOptions);

                // ── Applied check (data-driven, mirrors the game's gating) ──
                // The melody value rows are ELEMENT-KEYED: e.g. "Wings of
                // Dream" (disc 214059) OnceAdditionalAttributeValue 4059121 /
                // 4059131 carry ElementType = 4 (Ventus) — "+5% Normal/Skill
                // Dmg" and "+1.5%/stack Skill Crit Dmg" are implemented as
                // bonuses on Ventus-element damage. ActorAdditionalAttrInfo$$
                // AddAttr_2 (decompiled.c:3421741) routes elementType != 0
                // values into the overlay's element-keyed dict under
                // (attributeType, elementType), and the damage calc reads each
                // attribute keyed by THE HIT'S element (e.g. SKILLCRITPOWER for
                // skill crits, decompiled.c:3613344). A Ventus-keyed entry is
                // therefore consumed only by Ventus-element hits — on any other
                // element the element-keyed probe misses and the contribution
                // never reaches the calc (observed: skill crits at stacks=10
                // keep the base-only critRatio because every hit in that log
                // was element 1 while the entry is keyed to 4). That is the
                // whole gate — there is no explicit element/main-control check
                // in the melody code; the filtering is data-driven.
                bool applied = true;
                if (GetAttrValue && gdc) {
                    auto* oav = GetAttrValue(gdc, currentValueConfigId, nullptr);
                    if (oav && oav->klass) {
                        const int32_t attrTypes[3] = { oav->fields.attributeType1_, oav->fields.attributeType2_, oav->fields.attributeType3_ };
                        const int32_t values[3]    = { oav->fields.value1_, oav->fields.value2_, oav->fields.value3_ };
                        const int32_t elemTypes[3] = { oav->fields.elementType1_, oav->fields.elementType2_, oav->fields.elementType3_ };
                        for (int s = 0; s < 3; ++s) {
                            if (attrTypes[s] == 0 || values[s] == 0) continue;
                            // An element-keyed slot is consumable only by hits of
                            // that same element: the calc reads (attr, hitElement),
                            // so a value keyed to another element can never match
                            // the probe.
                            if (elemTypes[s] != 0 && elemTypes[s] != hitElementType) {
                                applied = false; // element mismatch — never consumable by this hit
                                break;
                            }
                        }
                    }
                }
                if (!applied) continue; // inactive — the game never applied this entry
            }
        }

        arr.push_back(entry);
    }
    return arr;
}



static inline double RoundTo(double value, int decimals) {
    double factor = std::pow(10.0, decimals);
    return std::round(value * factor) / factor;
}

void BuildHitJson(AdventureActor_o* fromActor, AdventureActor_o* toActor, Nova_Client_HitDamage_o* hitDamageConfig,
                  int32_t skillLevel, bool isCrit, bool isDot, int32_t* hudColorIndex, int64_t* skillPercentAmend,
                  int64_t* talentGroupPercentAmend, int64_t* skillAbsAmend, int64_t* talentGroupAbsAmend, int64_t* perkIntensityRatio,
                  int64_t* slotDmgRatio, int64_t* fromEE, int64_t* erAmend, int64_t* defAmend, int64_t* rcdSlotDmgRatio, int64_t* toEERCD,
                  int64_t* skillIntensityRatio, int64_t* toughnessBrokenDmgRatio, int64_t* critRatio, int64_t* envAmendRatio,
                  int64_t finalDamage,
                  AttributeList_o* attackerInfo, AttributeList_o* defenderInfo,
                  ActorAdditionalAttrInfo_o* fromAdditionalAttrInfo,
                  ActorAdditionalAttrInfo_o* toAdditionalAttrInfo,
                  System_Collections_Generic_Dictionary_int__int__o* fromAttrDict,
                  System_Collections_Generic_Dictionary_int__int__o* toAttrDict,
                  GameDataController_o* gdc,
                  FnGetOnceAttr GetOnceAttr, FnGetValueConfigId GetValueConfigId,
                  FnGetEffectValue GetEffectValue,
                  FnGetOnceAdditionalAttributeValue GetAttrValue,
                  const EffectSnapshot* effectSnapshot,
                  const std::string* snapshotTime,
                  const std::unordered_set<int32_t>* appliedHittedAttrFix) {
    if (!g_Cfg.damage) return;
    // Build element/dmg dict overlays once — read-only, no game memory mutation
    std::vector<ElemDictEntry> fromRawOverlay = ReadElemDict(fromAdditionalAttrInfo);
    std::vector<ElemDictEntry> toRawOverlay   = ReadElemDict(toAdditionalAttrInfo);
    // Filter to only include entries matching this hit's element/damage type
    std::vector<ElemDictEntry> fromOverlay, toOverlay;
    if (hitDamageConfig) {
        fromOverlay = FilterElemDictForHit(fromRawOverlay, hitDamageConfig->fields.elementType_, hitDamageConfig->fields.damageType_);
        toOverlay   = FilterElemDictForHit(toRawOverlay,   hitDamageConfig->fields.elementType_, hitDamageConfig->fields.damageType_);
    } else {
        fromOverlay = std::move(fromRawOverlay);
        toOverlay   = std::move(toRawOverlay);
    }
    json j;
    j["Type"] = "Hit";
    OnCombatEvent();
    j["Time"] = gameTime();
    if (snapshotTime && !snapshotTime->empty())
        j["SnapshotAt"] = *snapshotTime;

    if (fromActor) {
        j["Attacker"] = adventureActorId(fromActor);
        j["AttackerDisplay"] = adventureActorDisplay(fromActor);
    }
    if (toActor) {
        j["Defender"] = adventureActorId(toActor);
        j["DefenderDisplay"] = adventureActorDisplay(toActor);
    }

    if (hitDamageConfig) {
        const auto& f = hitDamageConfig->fields;

        json hitCfg;
        hitCfg["hitDamageId"]   = f.id_;
        hitCfg["levelTypeData"] = f.levelTypeData_;
        hitCfg["levelData"]     = f.levelData_;
        hitCfg["mainOrSupport"] = f.mainOrSupport_;
        hitCfg["sourceType"]    = f.sourceType_;
        hitCfg["damageType"]    = f.damageType_;
        hitCfg["effectType"]    = f.effectType_;
        hitCfg["elementType"]   = f.elementType_;
        hitCfg["skillId"]       = f.skillId_;
        hitCfg["skillSlotType"] = f.skillSlotType_;
        hitCfg["energyCharge"] = f.energyCharge_;

        if (f.hitdamageInfo_)
            hitCfg["info"] = Il2CppStringToStd(f.hitdamageInfo_);

        j["HitConfig"] = hitCfg;
    }
    j["HitType"] = g_CurrentDamageTypeTemp;

    // Add summonAttrType + useSummonHit if the attacker is a minion
    if (fromActor) {
        std::lock_guard<std::mutex> mlk(g_MinionLinkMutex);
        auto mIt = g_MinionToPlayer.find(adventureActorId(fromActor));
        if (mIt != g_MinionToPlayer.end()) {
            j["SummonAttrType"] = mIt->second.summonAttrType;
            j["UseSummonHit"]   = mIt->second.useSummonHit;
        }
    }
    json dmgParams;
    dmgParams["skillLevel"]              = skillLevel + 1;
    dmgParams["isCrit"]                  = isCrit;
    dmgParams["isDot"]                   = isDot;
    dmgParams["hudColor"]                = hudColorIndex ? *hudColorIndex : -1;
    auto toDbl = [](int64_t* p) -> double { return p ? (double)(*p) / FDP_ONE : 0.0; };
    dmgParams["skillPercentAmend"]       = Round(toDbl(skillPercentAmend));
    dmgParams["talentGroupPercentAmend"] = RoundTo(toDbl(talentGroupPercentAmend), 4);
    dmgParams["skillAbsAmend"]           = RoundTo(toDbl(skillAbsAmend), 4);
    dmgParams["talentGroupAbsAmend"]     = RoundTo(toDbl(talentGroupAbsAmend), 4);
    dmgParams["perkIntensityRatio"]      = RoundTo(toDbl(perkIntensityRatio), 4);
    dmgParams["slotDmgRatio"]            = RoundTo(toDbl(slotDmgRatio), 4);
    dmgParams["fromEE"]                  = RoundTo(toDbl(fromEE), 4);
    dmgParams["erAmend"]                 = RoundTo(toDbl(erAmend), 4);
    dmgParams["defAmend"]                = RoundTo(toDbl(defAmend), 4);
    dmgParams["rcdSlotDmgRatio"]         = RoundTo(toDbl(rcdSlotDmgRatio), 4);
    dmgParams["toEERCD"]                 = RoundTo(toDbl(toEERCD), 4);
    dmgParams["skillIntensityRatio"]     = RoundTo(toDbl(skillIntensityRatio), 4);
    dmgParams["toughnessBrokenDmgRatio"] = RoundTo(toDbl(toughnessBrokenDmgRatio), 4);
    dmgParams["critRatio"]               = RoundTo(toDbl(critRatio), 4);
    dmgParams["envAmendRatio"]           = RoundTo(toDbl(envAmendRatio), 4);
    dmgParams["finalDamage"]             = finalDamage;
    j["DamageParams"]                    = dmgParams;




    if (fromActor && g_Cfg.on_hit_attacker_stats) {
        json attackerStats = logAdventureActorAttrsJson(attackerInfo, fromOverlay.empty() ? nullptr : &fromOverlay);
        json attackerSpecial = logAdventureActorSpecialAttrsJson(fromActor);
        j["AttackerStats"] = attackerStats;
        if (!attackerSpecial.empty())
            j["AttackerSpecial"] = attackerSpecial;
    }

    if (toActor && g_Cfg.on_hit_defender_stats) {
        json defenderStats = logAdventureActorAttrsJson(defenderInfo, toOverlay.empty() ? nullptr : &toOverlay);
        json defenderSpecial = logAdventureActorSpecialAttrsJson(toActor);
        j["DefenderStats"] = defenderStats;
        if (!defenderSpecial.empty())
            j["DefenderSpecial"] = defenderSpecial;
    }

    if (fromActor && g_Cfg.on_hit_buff_list) {
        json attackerBuffs = BuildBuffListJson(fromActor);
        j["AttackerBuffs"] = attackerBuffs;
    }

    if (toActor && g_Cfg.on_hit_buff_list) {
        json defenderBuffs = BuildBuffListJson(toActor);
        j["DefenderBuffs"] = defenderBuffs;
    }

    if (fromActor && g_Cfg.on_hit_effect_list) {
        ActorEffectManage_o* effectManage = fromActor->fields.effectManage;
        json effects = BuildEffectListJson(effectManage, g_Cfg.on_hit_effect_list_information, gdc, GetEffectValue, GetOnceAttr, GetValueConfigId, GetAttrValue, fromActor, effectSnapshot, appliedHittedAttrFix);
        if (!effects.empty())
            j["AttackerEffects"] = effects;
    }

    if (toActor && g_Cfg.on_hit_effect_list) {
        ActorEffectManage_o* effectManage = toActor->fields.effectManage;
        json effects = BuildEffectListJson(effectManage, g_Cfg.on_hit_effect_list_information, gdc, GetEffectValue, GetOnceAttr, GetValueConfigId, GetAttrValue, toActor, nullptr);
        if (!effects.empty())
            j["DefenderEffects"] = effects;
    }

    if (g_Cfg.on_hit_attacker_attr_dict) {
        json attrDict = BuildAdditionalAttrDictJson(fromAttrDict, fromActor, gdc, GetOnceAttr, GetValueConfigId, GetAttrValue,
                                                    hitDamageConfig ? hitDamageConfig->fields.elementType_ : 0);
        if (!attrDict.empty())
            j["AttackerAttrDict"] = attrDict;
    }

    if (g_Cfg.on_hit_defender_attr_dict) {
        json attrDict = BuildAdditionalAttrDictJson(toAttrDict, fromActor, gdc, GetOnceAttr, GetValueConfigId, GetAttrValue,
                                                    hitDamageConfig ? hitDamageConfig->fields.elementType_ : 0);
        if (!attrDict.empty())
            j["DefenderAttrDict"] = attrDict;
    }

    logJson(j);
}

void BuildSkillCastJson(int32_t skillId) {
    json j;
    j["Type"] = "Skill Cast";
    OnCombatEvent();
    j["Time"] = gameTime();
    j["SkillId"] = skillId;

    logJson(j);
}

void BuildResetJson() {
    json j;
    j["Type"] = "Reset";
    j["Time"] = gameTime();

    logJson(j);
    //log("[Reset] %s", gameTime().c_str());
}

std::mutex g_PlayerSnapshotMutex;
std::unordered_map<std::string, PlayerEffectSnapshot> g_PlayerSnapshots;
std::mutex g_MinionLinkMutex;
std::unordered_map<std::string, MinionLink> g_MinionToPlayer;

int32_t g_CurrentDamageTypeTemp = 1;

// =============================================================================
//  HITTED_ADDITIONAL_ATTR_FIX applied tracking (see logging.h)
// =============================================================================
static std::mutex g_AppliedHittedMutex;
static std::unordered_set<int32_t> g_AppliedHittedConfigIds;

void MarkHittedAdditionalAttrFixApplied(int32_t configId) {
    if (configId <= 0) return;
    std::lock_guard<std::mutex> lk(g_AppliedHittedMutex);
    g_AppliedHittedConfigIds.insert(configId);
}

std::unordered_set<int32_t> TakeAppliedHittedAttrFixSnapshot() {
    std::lock_guard<std::mutex> lk(g_AppliedHittedMutex);
    auto out = std::move(g_AppliedHittedConfigIds);
    g_AppliedHittedConfigIds.clear();
    return out;
}

// =============================================================================
//  Effect instance tracking (used by area hit path in BuildEffectListJson)
// =============================================================================
static std::mutex g_EffectTrackMutex;
static std::unordered_map<int32_t, int32_t> g_InstanceConfigMap;             // instanceId → configId
static std::unordered_map<std::string, InstanceSnapInfo> g_ScopedSnapInfoMap;  // "actorId:instanceId" → full info

void TrackInstanceConfig(int32_t instanceId, int32_t configId) {
    if (instanceId <= 0 || configId <= 0) return;
    std::lock_guard<std::mutex> lk(g_EffectTrackMutex);
    g_InstanceConfigMap[instanceId] = configId;
}

int32_t GetConfigForInstance(int32_t instanceId) {
    std::lock_guard<std::mutex> lk(g_EffectTrackMutex);
    auto it = g_InstanceConfigMap.find(instanceId);
    return (it != g_InstanceConfigMap.end()) ? it->second : 0;
}

void StoreInstanceSnapInfo(int32_t instanceId, const InstanceSnapInfo& info) {
    if (instanceId <= 0 || info.ownerId.empty() || info.ownerId == "null") return;
    std::string key = info.ownerId + ":" + std::to_string(instanceId);
    std::lock_guard<std::mutex> lk(g_EffectTrackMutex);
    g_ScopedSnapInfoMap[key] = info;
}

bool GetInstanceSnapInfo(int32_t instanceId, const std::string& actorId, InstanceSnapInfo& out) {
    std::string key = actorId + ":" + std::to_string(instanceId);
    std::lock_guard<std::mutex> lk(g_EffectTrackMutex);
    auto it = g_ScopedSnapInfoMap.find(key);
    if (it == g_ScopedSnapInfoMap.end()) {
        auto oldIt = g_InstanceConfigMap.find(instanceId);
        if (oldIt != g_InstanceConfigMap.end()) {
            out.configId = oldIt->second;
            return true;
        }
        return false;
    }
    out = it->second;
    return true;
}

// =============================================================================
//  Utility
// =============================================================================
std::string GetLocalAppDataPath() {
    PWSTR path_tmp;
    HRESULT hr = SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, NULL, &path_tmp);
    if (FAILED(hr)) {
        OutputDebugStringA("[SS Logger] SHGetKnownFolderPath failed — COM may not be initialized on this thread\n");
        return "";
    }
    char ch[MAX_PATH];
    WideCharToMultiByte(CP_UTF8, 0, path_tmp, -1, ch, MAX_PATH, NULL, NULL);
    CoTaskMemFree(path_tmp);
    return std::string(ch);
}

void InitializeLogger() {
    std::string logDir = GetLocalAppDataPath() + "\\Stella Sora Combat Logger";
    CreateDirectoryA(logDir.c_str(), nullptr);

    std::string logPath = logDir + "\\sanity_log.txt";
    g_Log = fopen(logPath.c_str(), "a");
    if (g_Log) {
        SYSTEMTIME t{};
        GetLocalTime(&t);
        fprintf(g_Log, "\n=== SS DPS Logger started %02d:%02d:%02d ===\n", t.wHour, t.wMinute, t.wSecond);
        fflush(g_Log);
    }

    HMODULE ntdll = GetModuleHandleA("ntdll.dll");
    bool wine = ntdll && GetProcAddress(ntdll, "wine_get_version") != nullptr;
    std::string jsonDir = wine ? "Z:\\dev\\shm\\StellaSoraLogger" : logDir;
    if (wine) CreateDirectoryA("Z:\\dev\\shm\\StellaSoraLogger", nullptr);
    std::string jsonPath = jsonDir + "\\ss_jsonlog.txt";
    g_JsonLog = fopen(jsonPath.c_str(), "a");
    if (g_JsonLog) {
        SYSTEMTIME t{};
        GetLocalTime(&t);
        fprintf(g_JsonLog, "=== JSON log started %02d:%02d:%02d ===\n", t.wHour, t.wMinute, t.wSecond);
        fflush(g_JsonLog);
    } else {
        if (g_Log) {
            fprintf(g_Log, "[ERROR] Failed to open JSON log: %s (errno=%d)\n", jsonPath.c_str(), errno);
            fflush(g_Log);
        }
    }

    // Level map file — reads existing entries so we don't re-write them
    g_LevelMapPath = jsonDir + "\\levelMap.txt";
    // Read existing entries to populate g_LevelMapKnown
    {
        FILE* existing = fopen(g_LevelMapPath.c_str(), "r");
        if (existing) {
            fseek(existing, 0, SEEK_END);
            long sz = ftell(existing);
            if (sz > 0) {
                rewind(existing);
                std::string buf(sz, '\0');
                size_t read = fread(&buf[0], 1, sz, existing);
                buf.resize(read);
                try {
                    json arr = json::parse(buf);
                    if (arr.is_array()) {
                        for (const auto& entry : arr) {
                            if (entry.contains("id"))
                                g_LevelMapKnown.insert(entry["id"].get<int32_t>());
                        }
                    }
                } catch (...) {}
            }
            fclose(existing);
        }
    }
}
