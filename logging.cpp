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

// TEMP DEBUG: free-form debug lines next to the shared json log (same dir,
// wine-safe), so effect-gate diagnostics are reachable at /dev/shm.
static FILE* g_DebugLog = nullptr;
void debugEffectLog(const char* fmt, ...) {
    if (!g_DebugLog) {
        HMODULE ntdll = GetModuleHandleA("ntdll.dll");
        bool wine = ntdll && GetProcAddress(ntdll, "wine_get_version") != nullptr;
        std::string dir = wine ? "Z:\\dev\\shm\\StellaSoraLogger"
                               : GetLocalAppDataPath() + "\\Stella Sora Combat Logger";
        g_DebugLog = fopen((dir + "\\debug_effects.txt").c_str(), "a");
    }
    if (!g_DebugLog) return;
    std::lock_guard<std::mutex> lk(g_Mutex);
    fprintf(g_DebugLog, "[%s] ", gameTime().c_str());
    va_list args;
    va_start(args, fmt);
    vfprintf(g_DebugLog, fmt, args);
    va_end(args);
    fputc('\n', g_DebugLog);
    fflush(g_DebugLog);
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
// =============================================================================
// Ground-truth gate: AdventureEffect._effectStack is the game's own
// "currently applied" state. Execute() pushes the payload onto it
// (AdventureEffect$$Execute, decompiled.c:3634414) and the matching post phase
// pops + undoes it: OnDamage pops triggers 2/3/4/5/11 after the damage calc,
// OnCastSkillEnd pops 6, OnEffectPostExecute pops 18, OnBattleFinish pops
// IN_BATTLE_STATE, and AdventureEffectBase$$set_Removed (decompiled.c:3631990)
// drains it with undo. Continuous (trigger 1) effects are pushed once inside
// AdventureEffect$$OnInit (decompiled.c:3635117) — conditions are evaluated
// once at registration — and stay pushed for the effect's whole lifetime.
// CalculateNormalDamage runs inside that bracket for every damage-relevant
// trigger, so stack > 0 ⟺ the effect's contribution is alive for this hit:
// per-hit effects (pushed pre-settlement, popped post-settlement), continuous
// effects, and time-triggered ones alike. Dormant effects (PreExecute failed —
// e.g. Tailwind Journey's "main Trekker HP above 80%" unmet, or Daylight
// Garden registered while its conditions failed) are never pushed → skipped.
static bool EffectStackAlive(const AdventureEffect_o* effect) {
    if (!effect) return false;
    auto* st = effect->fields._effectStack;
    return st && st->fields._size > 0;
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
                // TEMP DEBUG: stack state of the watch-list effects at dump time
                auto* cfg = effect->fields._effectConfig_k__BackingField;
                int32_t cid = cfg ? cfg->fields.id_ : 0;
                if (cid == 3008026 || cid == 3008006) {
                    auto* st = effect->fields._effectStack;
                    debugEffectLog("[dump-time] actor=%s configId=%d instId=%d stackSize=%d trigger=%d",
                        actorId.c_str(), cid, effect->fields.id,
                        (st && st->fields._array) ? st->fields._size : -1,
                        cfg ? cfg->fields.trigger_ : -1);
                }
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
                    auto* effectCfg = effect->fields._effectConfig_k__BackingField;
                    int32_t baseConfigId = effectCfg ? effectCfg->fields.id_ : 0;
                    // Combined ground-truth gate:
                    //  - stack > 0: the payload is currently pushed — continuous
                    //    (trigger 1, pushed at OnInit) or inside the push bracket
                    //    of this hit's settlement (actor-hit route).
                    //  - executed-since-last-calc record: per-hit Hitted* payloads
                    //    write into the SHARED static overlay, and their pop can
                    //    precede an area/weapon calc that still consumes that
                    //    overlay — the stack alone would wrongly drop those rows.
                    bool alive = EffectStackAlive(effect)
                        || (appliedHittedAttrFix && appliedHittedAttrFix->count(baseConfigId));
                    if (!alive) {
                        // Registered but nothing currently pushed and nothing
                        // executed for this hit — dormant. Skip the entry AND
                        // the instance-snapshot fallback below, which would
                        // otherwise resurrect the row from stored OnInit info.
                        usedLive = true;
                        break;
                    }
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

            // Pre-compute level config data for this effect (shared by all stack items)
            auto* effectCfg = effect->fields._effectConfig_k__BackingField;
            int32_t baseConfigId = effectCfg ? effectCfg->fields.id_ : 0;

            // Combined gate (same as the snapshot path): the payload must either
            // be currently pushed (continuous / inside this settlement's push
            // bracket) or have executed since the last calc (per-hit Hitted*
            // payloads whose overlay write outlives their pop into the
            // shared static overlay this calc consumes).
            if (!EffectStackAlive(effect) &&
                !(appliedHittedAttrFix && appliedHittedAttrFix->count(baseConfigId)))
                continue; // dormant registered effect
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
                if (!EffectStackAlive(effect)) continue; // not currently applied — skip
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
        json effects = BuildEffectListJson(effectManage, g_Cfg.on_hit_effect_list_information, gdc, GetEffectValue, GetOnceAttr, GetValueConfigId, GetAttrValue, toActor, nullptr, appliedHittedAttrFix);
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

    // Per-room origin catalog (emblems/gems + char base + discs): one entry after
    // each Reset, on the first damage event of the room.
    MaybeEmitOriginCatalog(fromActor, toActor);

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

// =============================================================================
//  LUA VM ORIGIN CATALOG
// =============================================================================
// Reads the live game state through the game's own Lua code:
//   LuaManager (MonoSingleton, g_instance @static 0x0) → luaEnv @0x20
//   → xlua.LuaEnv.DoString (RVA 0x140F710, dump.cs:207654) with a chunk that
//   mirrors PlayerCharData.lua:CalCharacterAttrBattle (line 1690) / the tower
//   variant StarTowerLevelData.lua:1132, using the game's own accessors.
// Field offsets from dump.cs:188464 (LuaManager) — static g_instance @0x0,
// luaEnv backing field @0x20.

typedef void*       (*FnIl2CppDomainGet)();
typedef void**      (*FnIl2CppDomainGetAssemblies)(void*, size_t*);
typedef void*       (*FnIl2CppAssemblyGetImage)(void*);
typedef size_t      (*FnIl2CppImageGetClassCount)(void*);
typedef void*       (*FnIl2CppImageGetClass)(void*, size_t);
typedef const char* (*FnIl2CppClassNameGet)(void*);
typedef const char* (*FnIl2CppClassNamespaceGet)(void*);
typedef void*       (*FnIl2CppClassGetMethodFromName)(void*, const char*, int);
typedef void*       (*FnIl2CppRuntimeInvoke)(void*, void*, void**, void**);
typedef void*       (*FnIl2CppStringNew)(const char*);
typedef void*       (*FnIl2CppThreadCurrent)();
typedef void*       (*FnIl2CppThreadAttach)(void*);
typedef void        (*FnIl2CppRuntimeClassInit)(void*);
typedef void*       (*FnIl2CppCppClassGetFieldFromName)(void*, const char*);
typedef void*       (*FnIl2CppCppClassGetParent)(void*);
typedef void        (*FnIl2CppFieldStaticGetValue)(void* field, void* value);
typedef void*       (*FnIl2CppObjectGetClass)(void*);
typedef void*       (*FnIl2CppMethodGetParam)(void* method, uint32_t idx);
typedef void*       (*FnIl2CppClassFromIl2CppType)(void* type);
typedef void*       (*FnIl2CppArrayNew)(void* arrayClass, il2cpp_array_size_t length);
typedef void*       (*FnIl2CppArrayClassGet)(void* elementClass);

static FnIl2CppDomainGet              p_domain_get            = nullptr;
static FnIl2CppDomainGetAssemblies    p_domain_get_assemblies = nullptr;
static FnIl2CppAssemblyGetImage       p_assembly_get_image    = nullptr;
static FnIl2CppImageGetClassCount     p_image_get_class_count = nullptr;
static FnIl2CppImageGetClass          p_image_get_class       = nullptr;
static FnIl2CppClassNameGet           p_class_get_name        = nullptr;
static FnIl2CppClassNamespaceGet      p_class_get_namespace   = nullptr;
static FnIl2CppClassGetMethodFromName p_class_get_method      = nullptr;
static FnIl2CppRuntimeInvoke          p_runtime_invoke        = nullptr;
static FnIl2CppStringNew              p_string_new            = nullptr;
static FnIl2CppThreadCurrent          p_thread_current        = nullptr;
static FnIl2CppThreadAttach           p_thread_attach         = nullptr;
static FnIl2CppRuntimeClassInit       p_runtime_class_init    = nullptr;
static FnIl2CppCppClassGetFieldFromName p_class_get_field     = nullptr;
static FnIl2CppCppClassGetParent      p_class_get_parent      = nullptr;
static FnIl2CppFieldStaticGetValue    p_field_static_get      = nullptr;
static FnIl2CppObjectGetClass         p_object_get_class      = nullptr;
static FnIl2CppMethodGetParam         p_method_get_param      = nullptr;
static FnIl2CppClassFromIl2CppType    p_class_from_type       = nullptr;
static FnIl2CppArrayNew               p_array_new             = nullptr;
static FnIl2CppArrayClassGet          p_array_class_get       = nullptr;

// The chunk as UTF-8 bytes (for the DoString(byte[]) overload) — built once.
static void* g_OriginChunkBytes = nullptr;

static bool EnsureIl2CppExports() {
    static bool ready = false;
    if (ready) return true;
    HMODULE m = GetModuleHandleA("GameAssembly.dll");
    if (!m) return false;
    auto req = [&](const char* n, void** p) {
        *p = (void*)GetProcAddress(m, n);
        return *p != nullptr;
    };
    ready =
        req("il2cpp_domain_get",              (void**)&p_domain_get)            &&
        req("il2cpp_domain_get_assemblies",   (void**)&p_domain_get_assemblies) &&
        req("il2cpp_assembly_get_image",      (void**)&p_assembly_get_image)    &&
        req("il2cpp_image_get_class_count",   (void**)&p_image_get_class_count) &&
        req("il2cpp_image_get_class",         (void**)&p_image_get_class)       &&
        req("il2cpp_class_get_name",          (void**)&p_class_get_name)        &&
        req("il2cpp_class_get_namespace",      (void**)&p_class_get_namespace)   &&
        req("il2cpp_class_get_method_from_name", (void**)&p_class_get_method)    &&
        req("il2cpp_runtime_invoke",          (void**)&p_runtime_invoke)        &&
        req("il2cpp_string_new",              (void**)&p_string_new)            &&
        req("il2cpp_thread_current",          (void**)&p_thread_current)        &&
        req("il2cpp_thread_attach",           (void**)&p_thread_attach)         &&
        req("il2cpp_runtime_class_init",      (void**)&p_runtime_class_init)    &&
        req("il2cpp_class_get_field_from_name", (void**)&p_class_get_field)     &&
        req("il2cpp_class_get_parent",        (void**)&p_class_get_parent)      &&
        req("il2cpp_field_static_get_value",  (void**)&p_field_static_get)      &&
        req("il2cpp_object_get_class",        (void**)&p_object_get_class)      &&
        req("il2cpp_method_get_param",        (void**)&p_method_get_param)      &&
        req("il2cpp_class_from_il2cpp_type",  (void**)&p_class_from_type)       &&
        req("il2cpp_array_new",               (void**)&p_array_new)             &&
        req("il2cpp_array_class_get",         (void**)&p_array_class_get);
    if (!ready) log("[origin] il2cpp exports missing");
    return ready;
}

// Find a class by simple name, validated by a distinctive member so we don't
// grab an unrelated class that happens to share the name. `ns` may be nullptr
// for any namespace. Scans ALL images and returns the first validated match.
static void* FindIl2CppImageClass(const char* name, const char* ns,
                                  const char* mustHaveMethod, int methodArgc,
                                  const char* mustHaveField) {
    if (!EnsureIl2CppExports()) return nullptr;
    void* domain = p_domain_get();
    if (!domain) return nullptr;
    size_t nAsm = 0;
    void** asms = p_domain_get_assemblies(domain, &nAsm);
    if (!asms) return nullptr;
    for (size_t i = 0; i < nAsm; ++i) {
        void* img = p_assembly_get_image(asms[i]);
        if (!img) continue;
        size_t nCls = p_image_get_class_count(img);
        for (size_t c = 0; c < nCls; ++c) {
            void* klass = p_image_get_class(img, c);
            if (!klass) continue;
            const char* n = p_class_get_name(klass);
            if (!n || strcmp(n, name) != 0) continue;
            if (ns) {
                const char* kns = p_class_get_namespace(klass);
                if (!kns || strcmp(kns, ns) != 0) continue;
            }
            if (mustHaveField && !p_class_get_field(klass, mustHaveField)) continue;
            if (mustHaveMethod && !p_class_get_method(klass, mustHaveMethod, methodArgc)) continue;
            return klass;
        }
    }
    return nullptr;
}

struct Il2CppObjectArrayRef {
    Il2CppObject obj;
    Il2CppArrayBounds* bounds;
    il2cpp_array_size_t max_length;
    void* m_Items[65535];
};

static std::string ReadIl2CppUTF16(System_String_o* s) {
    if (!s) return "";
    int32_t len = s->fields._stringLength;
    if (len <= 0 || len > 1 << 20) return "";
    const wchar_t* chars = reinterpret_cast<const wchar_t*>(&s->fields._firstChar);
    int sz = WideCharToMultiByte(CP_UTF8, 0, chars, len, nullptr, 0, nullptr, nullptr);
    if (sz <= 0) return "";
    std::string out(sz, '\0');
    WideCharToMultiByte(CP_UTF8, 0, chars, len, out.data(), sz, nullptr, nullptr);
    return out;
}

// The collector chunk. Mirrors the game's own origin computation:
//  - PlayerCharData.lua:CalCharacterAttrBattle (line 1690) — general modes
//  - StarTowerLevelData.lua:CalCharacterAttrBattle (line 1132) — tower runs
// All state read from the live Lua globals (PlayerData is global, utils.lua:30).
static const char* kOriginChunk = R"lua(
local ok, res = pcall(function()
  local CD = require("GameCore.Data.ConfigData")
  local IFP = CD.IntFloatPrecision or 0.0001
  local ATT = AllEnum.AttachAttr
  local function sn(v) return string.format('%.10g', tonumber(v) or 0) end
  local function sq(s) return (tostring(s):gsub('[%c"\\]', '?')) end

  local pct = {}
  for _, a in ipairs(ATT) do if a.bPercent then pct[#pct+1] = '"'..a.sKey..'":true' end end

  -- ── Boss Blitz (ScoreBoss) only ─────────────────────────────────────────
  -- Record = PlayerData.ScoreBoss.curLevel.mapBuildData (team + discs + build)
  -- Guarded by the game's own mode flag (PlayerScoreBossData sets it on entry).
  local SB = nil
  pcall(function() SB = PlayerData.ScoreBoss end)
  local isBlitz = false
  pcall(function()
    isBlitz = SB and SB.curLevel and SB.curLevel.mapBuildData
      and SB.curLevel.tbCharId and #SB.curLevel.tbCharId > 0
      and PlayerData.nCurGameType == AllEnum.WorldMapNodeType.ScoreBoss
  end)
  if not isBlitz then return '' end

  local CL = SB.curLevel
  local team, charData = {}, {}
  for _, cid in ipairs(CL.tbCharId) do
    team[#team+1] = tostring(cid)
    charData[cid] = { nLevel = 1, nAdvance = 0 }
    pcall(function()
      local mc = PlayerData.Char._mapChar[cid]
      if mc then charData[cid] = { nLevel = mc.nLevel or 1, nAdvance = mc.nAdvance or 0 } end
    end)
    -- record's own (base) potential levels, for computing the gems' marginal
    -- potential ladder segment — mapBuildData.tbPotentials[charId][i].nLevel
    pcall(function()
      local bp = CL.mapBuildData.tbPotentials and CL.mapBuildData.tbPotentials[cid] or nil
      if bp then
        local pb = {}
        for _, pv in ipairs(bp) do
          pb[tostring(pv.nPotentialId)] = tonumber(pv.nLevel) or 0
        end
        charData[cid].potBase = pb
      end
    end)
  end

  -- discs: per-disc stat breakdown + sum (DiscData.mapAttrBase, the same
  -- source CalCharacterAttrBattle uses — PlayerCharData.lua:1700)
  local discIds, discObjs, discSum = {}, {}, {}
  pcall(function()
    for _, d in ipairs(CL.tbDiscId or {}) do
      if d and d > 0 then
        discIds[#discIds+1] = tostring(d)
        local entry = { id = d, attrs = {} }
        local dd = PlayerData.Disc:GetDiscById(d)
        local mb = dd and dd.mapAttrBase or nil
        if mb then
          for _, a in ipairs(ATT) do
            local v = mb[a.sKey]
            if v and v.CfgValue and v.CfgValue ~= 0 then
              entry.attrs[a.sKey] = v.CfgValue
              discSum[a.sKey] = (discSum[a.sKey] or 0) + v.CfgValue
            end
          end
        end
        discObjs[#discObjs+1] = entry
      end
    end
  end)

  -- build (record rank) attrs — PlayerBuildData:GetBuildAttrBase (lua:366)
  local buildSum = {}
  pcall(function()
    local ba = PlayerData.Build:GetBuildAttrBase(CL.mapBuildData.nBuildId)
    if ba then
      for _, a in ipairs(ATT) do
        local v = ba[a.sKey]
        if v and v.CfgValue and v.CfgValue ~= 0 then buildSum[a.sKey] = v.CfgValue end
      end
    end
  end)

  -- equipped gems of a char from the account store, per-gem, resolved through
  -- the in-use preset (mirrors PlayerEquipmentDataEx:GetEquipedGem, lua:135)
  local gemOf = function(cid)
    local out = {}
    local okE = pcall(function()
      local eqList, slotData = PlayerData.Equipment:GetEquipedGem(cid)
      if eqList and #eqList > 0 then
        for gi, eq in ipairs(eqList) do
          local slot = slotData and slotData[gi] and slotData[gi].nSlotId or 0
          local attrs, effects, pots, skills = {}, {}, {}, {}
          for _, ra in ipairs(eq:GetRandomAttr() or {}) do
            attrs[#attrs+1] = '['..tostring(ra.AttrId)..','..sn(ra.CfgValue)..','..sn(ra.Value)..']'
          end
          for _, ef in ipairs(eq:GetEffect() or {}) do
            effects[#effects+1] = tostring(ef)
          end
          for _, p in ipairs(eq.tbPotentialAffix or {}) do
            pots[#pots+1] = '['..tostring(p.AttrTypeFirstSubtype)..','..sn(p.Value)..']'
          end
          for _, s in ipairs(eq.tbSkillAffix or {}) do
            skills[#skills+1] = '['..tostring(s.AttrTypeFirstSubtype)..','..sn(s.Value)..']'
          end
          out[#out+1] = '{'..'"slot":'..tostring(slot)
            ..',"attrs":['..table.concat(attrs, ',')..']'
            ..',"effects":['..table.concat(effects, ',')..']'
            ..',"pots":['..table.concat(pots, ',')..']'
            ..',"skills":['..table.concat(skills, ',')..']}'
        end
      end
    end)
    if not okE then
      return {}
    end
    return out
  end

  local charArr = {}
  for cid, mc in pairs(charData) do
    local nLevel   = (mc and mc.nLevel)   or 1
    local nAdvance = (mc and mc.nAdvance) or 0

    local baseParts, eBase = {}, nil
    local okA, eA = pcall(function()
      local nAttrId = UTILS.GetCharacterAttributeId(cid, nAdvance, nLevel)
      local attrCfg = nAttrId and ConfigTable.GetData_Attribute(tostring(nAttrId)) or nil
      local charCfg = DataTable.Character[cid]
      if attrCfg then
        for _, a in ipairs(ATT) do
          local v = attrCfg[a.sKey]
          if v == nil then v = 0 end
          if a.bPlayer and charCfg and charCfg[a.sKey] ~= nil then v = charCfg[a.sKey] end
          if v ~= 0 then
            baseParts[#baseParts+1] = '"'..a.sKey..'":'..sn(v)
          end
        end
      end
    end)
    if not okA then eBase = eA end

    local discParts, buildParts = {}, {}
    for _, a in ipairs(ATT) do
      local v = discSum[a.sKey]
      if v and v ~= 0 then discParts[#discParts+1] = '"'..a.sKey..'":'..sn(v) end
      local bv = buildSum[a.sKey]
      if bv and bv ~= 0 then buildParts[#buildParts+1] = '"'..a.sKey..'":'..sn(bv) end
    end

    local gems, eGem = {}, nil
    local okG, eG2 = pcall(function() gems = gemOf(cid) end)
    if not okG then eGem = eG2 end

    local potBaseParts = {}
    pcall(function()
      local pb = mc and mc.potBase or nil
      if pb then
        for pid, lvl in pairs(pb) do
          potBaseParts[#potBaseParts+1] = '"'..pid..'":'..tostring(lvl)
        end
      end
    end)
    local parts = {
      '"charId":'..tostring(cid),
      '"level":'..tostring(nLevel),
      '"advance":'..tostring(nAdvance),
      '"base":{'..table.concat(baseParts, ',')..'}',
      '"disc":{'..table.concat(discParts, ',')..'}',
      '"build":{'..table.concat(buildParts, ',')..'}',
      '"potBase":{'..table.concat(potBaseParts, ',')..'}',
      '"gems":['..table.concat(gems, ',')..']',
    }
    if eBase then parts[#parts+1] = '"errBase":"'..sq(eBase)..'"' end
    if eGem then parts[#parts+1] = '"errGems":"'..sq(eGem)..'"' end
    charArr[#charArr+1] = '{'..table.concat(parts, ',')..'}'
  end

  local teamArr = table.concat(team, ',')
  local discArr = table.concat(discIds, ',')
  local discObjArr = {}
  for _, e in ipairs(discObjs) do
    local parts = {}
    for k, v in pairs(e.attrs) do
      parts[#parts+1] = '"'..k..'":'..sn(v)
    end
    discObjArr[#discObjArr+1] = '{"id":"'..tostring(e.id)..'"'..(#parts > 0 and ',"attrs":{'..table.concat(parts, ',')..'}' or '')..'}'
  end
  return '{"mode":"bossblitz","ifp":'..sn(IFP)..',"pct":{'..table.concat(pct, ',')..'}'
       ..',"team":['..teamArr..'],"discs":['..discArr..']'
       ..',"discStats":['..table.concat(discObjArr, ',')..']'
       ..',"chars":['..table.concat(charArr, ',')..']}'
end)
if ok then return res end
return 'ERR:' .. (tostring(res):gsub('[%c"\\]', '?'))
)lua";

static std::string RunLuaOriginCollector() {
    if (!EnsureIl2CppExports()) return "";

    static void* mgrKlass        = nullptr;
    static void* luaEnvKlass     = nullptr;
    static void* doStringMethod  = nullptr;
    if (!doStringMethod) {
        // The real LuaManager owns the luaEnv auto-property; il2cpp metadata
        // names its backing field "<luaEnv>k__BackingField" (dump.cs:188464).
        mgrKlass = FindIl2CppImageClass("LuaManager", nullptr, nullptr, 0, "<luaEnv>k__BackingField");
        if (!mgrKlass) { log("[origin] LuaManager class not found"); return ""; }
        luaEnvKlass = FindIl2CppImageClass("LuaEnv", nullptr, "DoString", 3, nullptr);
        if (!luaEnvKlass) { log("[origin] LuaEnv class not found"); return ""; }
        doStringMethod = p_class_get_method(luaEnvKlass, "DoString", 3);
        if (!doStringMethod) { log("[origin] DoString method not found"); return ""; }
    }

    // static_fields are allocated lazily — make sure the class is initialized.
    p_runtime_class_init(mgrKlass);

    // g_instance is declared on the generic base MonoSingleton<T> (dump.cs:1109414),
    // NOT on LuaManager — LuaManager has no statics of its own. Resolve it from
    // the inflated parent class (MonoSingleton'1<LuaManager>), preferring the
    // field API (handles generic static offsets) with a raw static_fields fallback.
    void* mgrInstance = nullptr;
    {
        void* holder = mgrKlass;
        if (!reinterpret_cast<Il2CppClass*>(holder)->static_fields) {
            void* parent = p_class_get_parent(mgrKlass);
            if (parent) {
                p_runtime_class_init(parent);
                holder = parent;
            }
        }
        void* sf = reinterpret_cast<Il2CppClass*>(holder)->static_fields;
        if (!sf) { log("[origin] no static_fields on LuaManager or its MonoSingleton base"); return ""; }
        void* fld = p_class_get_field(holder, "g_instance");
        if (fld) {
            p_field_static_get(fld, &mgrInstance);
        } else {
            mgrInstance = *(void**)sf;           // MonoSingleton<T>.g_instance @0x0
        }
    }
    if (!mgrInstance) { log("[origin] LuaManager instance null (Lua not initialised?)"); return ""; }
    void* luaEnv = *(void**)((char*)mgrInstance + 0x20);   // luaEnv backing @0x20
    if (!luaEnv) { log("[origin] luaEnv null"); return ""; }

    // Which DoString overload did class_get_method_from_name pick? Both have
    // argc==3 (dump.cs:207651 byte[], 207654 string). Check the first param type.
    static bool overloadChecked = false;
    static bool wantsBytes = false;
    if (!overloadChecked) {
        overloadChecked = true;
        void* p0 = p_method_get_param(doStringMethod, 0);
        void* p0cls = p0 ? p_class_from_type(p0) : nullptr;
        const char* p0name = p0cls ? p_class_get_name(p0cls) : nullptr;
        wantsBytes = p0name && strcmp(p0name, "Byte[]") == 0;
        log("[origin] DoString first param: %s (%s path)",
            p0name ? p0name : "?", wantsBytes ? "byte[]" : "string");
    }

    // Build the chunk argument for the detected overload.
    void* chunkArg = nullptr;
    if (wantsBytes) {
        if (!g_OriginChunkBytes) {
            void* byteCls = FindIl2CppImageClass("Byte", "System", nullptr, 0, nullptr);
            if (!byteCls) { log("[origin] System.Byte class not found"); return ""; }
            void* arrCls = p_array_class_get(byteCls);
            if (!arrCls) { log("[origin] byte[] class not found"); return ""; }
            size_t len = strlen(kOriginChunk);
            void* arr = p_array_new(arrCls, (il2cpp_array_size_t)len);
            if (!arr) { log("[origin] byte[] alloc failed"); return ""; }
            memcpy(reinterpret_cast<Il2CppObjectArrayRef*>(arr)->m_Items, kOriginChunk, len);
            g_OriginChunkBytes = arr;
        }
        chunkArg = g_OriginChunkBytes;
    } else {
        chunkArg = p_string_new(kOriginChunk);
    }

    // The main thread is attached already; attach defensively if somehow not.
    if (!p_thread_current()) p_thread_attach(p_domain_get());

    void* exc = nullptr;
    void* args[3] = { chunkArg, p_string_new("SSLOriginCollector"), nullptr };
    void* ret = p_runtime_invoke(doStringMethod, luaEnv, args, &exc);
    if (exc || !ret) {
        std::string msg;
        if (exc) {
            void* ek = p_object_get_class(exc);
            void* ts = ek ? p_class_get_method(ek, "ToString", 0) : nullptr;
            if (ts) {
                void* texc = nullptr;
                void* tret = p_runtime_invoke(ts, exc, nullptr, &texc);
                if (tret && !texc)
                    msg = ReadIl2CppUTF16(reinterpret_cast<System_String_o*>(tret));
            }
        }
        log("[origin] DoString failed: %.400s", msg.c_str());
        return "";
    }
    auto* arr = reinterpret_cast<Il2CppObjectArrayRef*>(ret);
    if (arr->max_length < 1 || !arr->m_Items[0]) {
        log("[origin] DoString returned empty");
        return "";
    }
    std::string res = ReadIl2CppUTF16(reinterpret_cast<System_String_o*>(arr->m_Items[0]));
    if (res.rfind("ERR:", 0) == 0) {
        log("[origin] chunk error: %.200s", res.c_str());
        return "";
    }
    return res;
}

// ── Cache + emission ──
static std::mutex g_OriginMutex;
static json g_OriginCatalog = json::object();                 // {ifp,pct,team,chars[]}
static std::unordered_map<int32_t, json> g_OriginByChar;
static std::unordered_set<int32_t> g_OriginEmitted;
static bool g_OriginPending = false;
static DWORD g_OriginMainThreadId = 0;
static bool  g_OriginRetryAtHit   = false;

void RefreshOriginCatalog() {
    std::lock_guard<std::mutex> lk(g_OriginMutex);
    g_OriginMainThreadId = GetCurrentThreadId();
    g_OriginRetryAtHit = true;         // failed refreshes get one combat-time retry
    g_OriginByChar.clear();
    g_OriginEmitted.clear();
    g_OriginCatalog = json::object();
    g_OriginPending = true;

    std::string res = RunLuaOriginCollector();
    if (res.empty()) { g_OriginPending = false; return; }
    json parsed = json::parse(res, nullptr, false);
    if (parsed.is_discarded() || !parsed.is_object()) {
        log("[origin] chunk output not valid json: %.120s", res.c_str());
        g_OriginPending = false;
        return;
    }
    g_OriginCatalog = parsed;
    for (auto& cj : parsed.value("chars", json::array())) {
        if (!cj.is_object()) continue;
        int32_t cid = cj.value("charId", 0);
        if (cid > 0) g_OriginByChar[cid] = cj;
    }
    g_OriginRetryAtHit = false;        // success — no retry needed
    auto team = parsed.value("team", json::array());
    log("[origin] catalog refreshed: chars=%zu team=%zu",
        g_OriginByChar.size(), (size_t)team.size());

    // Emit immediately for team-aware modes (e.g. Star Tower): one entry right
    // after the Reset — room enter — without waiting for the first damage event
    // (logJson takes g_Mutex; g_OriginMutex is never taken while holding it, so
    // this nesting has no inversion).
    if (!team.empty()) {
        json out = g_OriginCatalog;
        out["Type"] = "Record";
        out["Time"] = gameTime();
        g_OriginPending = false;
        logJson(out);
    }
}

void MaybeEmitOriginCatalog(AdventureActor_o* fromActor, AdventureActor_o* toActor) {
    // Combat-time retry: if the reset-time refresh failed and the damage hook
    // runs on the same thread it ran on at the reset (same call environment),
    // retry the DoString once here — at room enter / combat start.
    if (!g_OriginPending && g_OriginRetryAtHit && g_OriginByChar.empty()
        && GetCurrentThreadId() == g_OriginMainThreadId) {
        g_OriginRetryAtHit = false;    // single retry per room
        RefreshOriginCatalog();
    }
    if (!g_OriginPending) return;
    json out;
    {
        std::lock_guard<std::mutex> lk(g_OriginMutex);
        if (!g_OriginPending) return;

        auto team = g_OriginCatalog.value("team", json::array());
        if (!team.empty()) {
            // Tower (or any mode that reported its deployed team): emit the whole
            // batch once, on the first damage event after the reset.
            out = g_OriginCatalog;
            g_OriginPending = false;
        } else {
            // No team info: emit lazily per appearing actor dataId (= char tid,
            // same key the viewer resolves against Character.json).
            json chars = json::array();
            auto addActor = [&](AdventureActor_o* a) {
                if (!a) return;
                int32_t dataId = a->fields._dataID_k__BackingField;
                if (dataId <= 0 || g_OriginEmitted.count(dataId)) return;
                g_OriginEmitted.insert(dataId);          // never retried, even if absent
                auto it = g_OriginByChar.find(dataId);
                if (it != g_OriginByChar.end()) chars.push_back(it->second);
            };
            addActor(fromActor);
            addActor(toActor);
            if (chars.empty()) return;
            out["chars"] = chars;
            out["pct"]  = g_OriginCatalog.value("pct", json::object());
            out["ifp"]  = g_OriginCatalog.value("ifp", 0.0);
            if (g_OriginEmitted.size() >= g_OriginByChar.size() && !g_OriginByChar.empty())
                g_OriginPending = false;   // everything emitted
        }
    }
    out["Type"] = "Record";
    out["Time"] = gameTime();
    logJson(out);
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
