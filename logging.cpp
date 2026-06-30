#pragma GCC diagnostic ignored "-Wattributes"

#include "game_structs.h"
#include "logging.h"

#include <windows.h>
#include <cstdio>
#include <cstdarg>
#include <shlobj.h>
#include <knownfolders.h>
#include <combaseapi.h>
#include <cmath>


// =============================================================================
//  GLOBAL DEFINITIONS
// =============================================================================
FILE*               g_Log     = nullptr;
FILE*               g_JsonLog = nullptr;
std::mutex          g_Mutex;
LogConfig           g_Cfg;
std::atomic<int64_t> g_CombatStartTimeFP{0};
int64_t*            g_LockStepTimePtr = nullptr;

// =============================================================================
//  GAME TIME
// =============================================================================
static constexpr int64_t FP_ONE = 4294967296LL;

std::string gameTime() {
    int64_t elapsedFP = 0;
    if (g_LockStepTimePtr) {
        int64_t lockstepTime = *g_LockStepTimePtr;
        int64_t combatStart = g_CombatStartTimeFP.load(std::memory_order_relaxed);
        elapsedFP = combatStart != 0 ? lockstepTime - combatStart : 0;
    }
    int64_t totalMs  = (elapsedFP * 1000LL) / FP_ONE;
    int     ms       = (int)(totalMs % 1000);
    int64_t totalSec = totalMs / 1000;
    int     sec      = (int)(totalSec % 60);
    int     min      = (int)(totalSec / 60);
    char buf[32];
    snprintf(buf, sizeof(buf), "%02d:%02d.%03d", min, sec, ms);
    return buf;
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
        double origin = e.origin;
        double base_  = e.baseAmend;
        double pct    = e.percentAmend;
        double abs_   = e.absAmend;
        double limPct = e.limitedPercentAmend;

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
            nearZero(base_) && nearZero(pct) && nearZero(abs_) && nearZero(limPct))
            continue;

        json attr;
        attr["id"]     = i;
        attr["origin"] = Round(origin, 4);
        attr["base"]   = Round(base_, 4);
        attr["pct"]    = Round(pct, 4);
        attr["abs"]    = Round(abs_, 4);
        attr["limPct"] = Round(limPct, 4);
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
        double current  = e.current;
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
#include <cstdint>
#include <cstdarg>
bool logGizsmos = false;

bool EnableAllDebugGizmos(uintptr_t moduleBase)
{
    if (!moduleBase) {
        log("[DebugGizmos] ERROR: Failed to get module base");
        return false;
    }
    if (logGizsmos) log("[DebugGizmos] Module base: 0x%llX", moduleBase);

    typedef uintptr_t(*GetDebugHelper_t)(uintptr_t);
    uintptr_t getterAddr = moduleBase + (0x180014840 - 0x180000000);
    GetDebugHelper_t GetDebugHelper = (GetDebugHelper_t)getterAddr;

    uintptr_t dat_f048 = moduleBase + (0x18715f048 - 0x180000000);
    uintptr_t dat_f048_val = *(uintptr_t *)dat_f048;
    if (logGizsmos) log("[DebugGizmos] DAT_18715f048 value: 0x%llX", dat_f048_val);
    if (!dat_f048_val) {
        log("[DebugGizmos] ERROR: DAT_18715f048 is null");
        return false;
    }

    uintptr_t obj = GetDebugHelper(dat_f048_val);
    if (logGizsmos) log("[DebugGizmos] AdventureModuleDebugHelper instance: 0x%llX", obj);
    if (!obj) {
        log("[DebugGizmos] ERROR: getter returned null — call this later in init");
        return false;
    }

    if (logGizsmos) {
      // Log current state with proper field names
      log("[DebugGizmos] Current values:");
      log("[DebugGizmos]   PlayerGizmo          (+0x28): %d", *(char *)(obj + 0x28));
      log("[DebugGizmos]   MonsterGizmo         (+0x29): %d", *(char *)(obj + 0x29));
      log("[DebugGizmos]   BulletGizmo          (+0x2A): %d", *(char *)(obj + 0x2A));
      log("[DebugGizmos]   HitboxGizmo          (+0x2B): %d", *(char *)(obj + 0x2B));
      log("[DebugGizmos]   HearingGizmoForPlayer  (+0x2C): %d", *(char *)(obj + 0x2C));
      log("[DebugGizmos]   HearingGizmoForMonster (+0x2D): %d", *(char *)(obj + 0x2D));
      log("[DebugGizmos]   VisionGizmoForPlayer   (+0x2E): %d", *(char *)(obj + 0x2E));
      log("[DebugGizmos]   VisionGizmoForMonster  (+0x2F): %d", *(char *)(obj + 0x2F));
      log("[DebugGizmos]   InputAndVisionGizmo  (+0x30): %d", *(char *)(obj + 0x30));
      log("[DebugGizmos]   MonsterPathGizmo     (+0x31): %d", *(char *)(obj + 0x31));
      log("[DebugGizmos]   PlayerPathGizmo      (+0x32): %d", *(char *)(obj + 0x32));
      log("[DebugGizmos]   CameraGizmo          (+0x33): %d", *(char *)(obj + 0x33));
    }

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

    if (logGizsmos) {
      // Verify
      log("[DebugGizmos] Values after write:");
      log("[DebugGizmos]   PlayerGizmo          (+0x28): %s", *(char *)(obj + 0x28) ? "OK" : "FAILED");
      log("[DebugGizmos]   MonsterGizmo         (+0x29): %s", *(char *)(obj + 0x29) ? "OK" : "FAILED");
      log("[DebugGizmos]   BulletGizmo          (+0x2A): %s", *(char *)(obj + 0x2A) ? "OK" : "FAILED");
      log("[DebugGizmos]   HitboxGizmo          (+0x2B): %s", *(char *)(obj + 0x2B) ? "OK" : "FAILED");
      log("[DebugGizmos]   HearingGizmoForPlayer  (+0x2C): %s", *(char *)(obj + 0x2C) ? "OK" : "FAILED");
      log("[DebugGizmos]   HearingGizmoForMonster (+0x2D): %s", *(char *)(obj + 0x2D) ? "OK" : "FAILED");
      log("[DebugGizmos]   VisionGizmoForPlayer   (+0x2E): %s", *(char *)(obj + 0x2E) ? "OK" : "FAILED");
      log("[DebugGizmos]   VisionGizmoForMonster  (+0x2F): %s", *(char *)(obj + 0x2F) ? "OK" : "FAILED");
      log("[DebugGizmos]   InputAndVisionGizmo  (+0x30): %s", *(char *)(obj + 0x30) ? "OK" : "FAILED");
      log("[DebugGizmos]   MonsterPathGizmo     (+0x31): %s", *(char *)(obj + 0x31) ? "OK" : "FAILED");
      log("[DebugGizmos]   PlayerPathGizmo      (+0x32): %s", *(char *)(obj + 0x32) ? "OK" : "FAILED");
      log("[DebugGizmos]   CameraGizmo          (+0x33): %s", *(char *)(obj + 0x33) ? "OK" : "FAILED");

      log("[DebugGizmos] Done.");
    }
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

    struct Entry { int32_t hashCode; int32_t next; int32_t key; float value; };
    struct EntryArray {
        Il2CppObject        obj;
        Il2CppArrayBounds*  bounds;
        il2cpp_array_size_t max_length;
        Entry               m_Items[1];
    };
    auto* arr    = reinterpret_cast<EntryArray*>(dict->fields._entries);
    int32_t cap  = (int32_t)arr->max_length;
    if (cap <= 0 || cap > 4096) return out;

    for (int32_t i = 0; i < cap; ++i) {
        const Entry& e = arr->m_Items[i];
        if (e.hashCode <= 0) continue;
        ElementOrDmgAttrKey k = DecodeElemKey(e.key);
        out.push_back({ k.attributeType, k.elementOrDamageType, k.isElementType, k.mode, (double)e.value });
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
                          FnGetEffectValue GetEffectValue) {
    //ActorEffectManage has a list of Effects, each effect has a list of its derivative effects that are actually active
    json j;
    if (!effectManage) return j;

    auto* effectsDict = effectManage->fields.effectsDict;
    if (!effectsDict) return j;

    // Pre-build key set from GDC's EffectValue_Map for fast level-enumeration lookups
    std::unordered_set<int32_t> effectValueKeys;
    if (gdc && gdc->fields.EffectValue_Map) {
        effectValueKeys = CollectDictKeys(gdc->fields.EffectValue_Map);
    }

    auto* entriesArr = effectsDict->fields._entries;
    int   slotCount  = effectsDict->fields._count;
    int   freeCount  = effectsDict->fields._freeCount;
    int   liveCount  = slotCount - freeCount;

    j["liveCount"] = liveCount;
    json effects = json::array();

    if (entriesArr && slotCount > 0) {
        constexpr size_t entrySize = 0x18;
        constexpr size_t valOffset  = 0x10;

        uintptr_t entries = reinterpret_cast<uintptr_t>(entriesArr)
                          + offsetof(System_Collections_Generic_Dictionary_Entry_TKey__TValue__array, m_Items);

        for (int i = 0; i < slotCount; ++i) {
            uintptr_t entry = entries + i * entrySize;
            int32_t hashCode = *reinterpret_cast<int32_t*>(entry);
            if (hashCode < 0) continue; // free slot

            AdventureEffect_o* effect = *reinterpret_cast<AdventureEffect_o**>(entry + valOffset);
            if (!effect) continue;

            // Pre-compute level config data for this effect (shared by all stack items)
            auto* effectCfg = effect->fields._effectConfig_k__BackingField;
            int32_t baseConfigId = effectCfg ? effectCfg->fields.id_ : 0;
            int32_t levelTypeData = effectCfg ? effectCfg->fields.levelTypeData_ : 0;
            int32_t levelData = effectCfg ? effectCfg->fields.levelData_ : 0;

            // Enumerate all possible value config IDs for this effect at different levels
            json allValueOptions = json::array();
            if (!effectValueKeys.empty() && baseConfigId > 0) {
                bool anyFound = false;
                for (int lvl = 0; lvl <= 50; ++lvl) {
                    int32_t vid = baseConfigId + lvl * 10;
                    if (effectValueKeys.count(vid)) {
                        anyFound = true;
                        json ve;
                        ve["level"] = lvl;
                        ve["valueConfigId"] = vid;
                        allValueOptions.push_back(ve);
                    } else if (anyFound) {
                        break;
                    }
                }
            }

            auto* stack = effect->fields._effectStack; // System_Collections_Generic_Stack_AdventureEffectBase__o*
            if (stack && stack->fields._array) {
                auto* array = stack->fields._array;     // AdventureEffectBase_array*
                int size = stack->fields._size;         // number of items currently in stack

                constexpr size_t arrayHeaderSize = 0x20; // klass(8) + monitor(8) + bounds(8) + max_length(8)
                uintptr_t itemsStart = reinterpret_cast<uintptr_t>(array) + arrayHeaderSize;

                for (int s = 0; s < size; ++s) {

                    json je;
                    AdventureEffectBase_o* base = *reinterpret_cast<AdventureEffectBase_o**>(itemsStart + s * sizeof(void*));
                    if (!base) continue;

                    AdventureEffect_o* parentEffect = base->fields._effect; 
                    auto* ValueCfgPtr = parentEffect->fields._effectValueConfig_k__BackingField;
                    je["configId"] = baseConfigId;
                    je["levelTypeData"] = levelTypeData;
                    je["levelData"] = levelData;
                    je["valueConfigId"] = ValueCfgPtr ? ValueCfgPtr->fields.id_ : 0;
                    je["allValueConfigIds"] = allValueOptions;
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

// Build a JSON array from a Dictionary<int,int> (attrId -> stackCount).
// When gdc and the three function pointers are provided, each entry is fully
// resolved through GetOnceAttr -> GetValueConfigId -> GetOnceAttrValue so that
// attrType/value/elem/dmgType/levelTypeData/levelData/paramType are all emitted.
json BuildAdditionalAttrDictJson(
    System_Collections_Generic_Dictionary_int__int__o* dict,
    AdventureActor_o*                    fromActor,
    GameDataController_o*                gdc,
    FnGetOnceAttr                        GetOnceAttr,
    FnGetValueConfigId                   GetValueConfigId,
    FnGetOnceAdditionalAttributeValue    GetAttrValue)
{
    json arr = json::array();
    if (!dict || !dict->klass || !dict->fields._entries) return arr;

    auto* entryArr = reinterpret_cast<DictEntryArray_Int_Int_L*>(dict->fields._entries);
    int32_t capacity = static_cast<int32_t>(entryArr->max_length);
    if (capacity <= 0 || capacity > 4096) return arr;

    // Pre-build key set from GDC's OnceAdditionalAttributeValue_Map
    std::unordered_set<int32_t> attrValueKeys;
    if (gdc && gdc->fields.OnceAdditionalAttributeValue_Map) {
        attrValueKeys = CollectDictKeys(gdc->fields.OnceAdditionalAttributeValue_Map);
    }

    for (int32_t i = 0; i < capacity; ++i) {
        const DictEntry_Int_Int_L& e = entryArr->m_Items[i];
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
                entry["levelTypeData"] = lt;
                entry["levelData"] = ld;

                // Enumerate all possible value config IDs for this attribute at different levels
                json allValueOptions = json::array();
                if (!attrValueKeys.empty() && baseId > 0) {
                    bool anyFound = false;
                    for (int lvl = 0; lvl <= 50; ++lvl) {
                        int32_t vid = baseId + lvl * 10;
                        if (attrValueKeys.count(vid)) {
                            anyFound = true;
                            json ve;
                            ve["level"] = lvl;
                            ve["valueConfigId"] = vid;
                            allValueOptions.push_back(ve);
                        } else if (anyFound) {
                            break;
                        }
                    }
                }
                entry["allValueConfigIds"] = allValueOptions;
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
                  int32_t skillLevel, bool isCrit, bool isDot, int32_t* hudColorIndex, double* skillPercentAmend,
                  double* talentGroupPercentAmend, double* skillAbsAmend, double* talentGroupAbsAmend, double* perkIntensityRatio,
                  double* slotDmgRatio, double* fromEE, double* erAmend, double* defAmend, double* rcdSlotDmgRatio, double* toEERCD,
                  double* skillIntensityRatio, double* toughnessBrokenDmgRatio, double* critRatio, double* envAmendRatio,
                  int64_t finalDamage,
                  AttributeList_o* attackerInfo, AttributeList_o* defenderInfo, 
                  ActorAdditionalAttrInfo_o* fromAdditionalAttrInfo,
                  ActorAdditionalAttrInfo_o* toAdditionalAttrInfo,
                  System_Collections_Generic_Dictionary_int__int__o* fromAttrDict,
                  System_Collections_Generic_Dictionary_int__int__o* toAttrDict,
                  GameDataController_o* gdc,
                  FnGetOnceAttr GetOnceAttr, FnGetValueConfigId GetValueConfigId,
                  FnGetEffectValue GetEffectValue,
                  FnGetOnceAdditionalAttributeValue GetAttrValue) {
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
    j["Time"] = gameTime();
    
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
        
        if (f.hitdamageInfo_)
            hitCfg["info"] = Il2CppStringToStd(f.hitdamageInfo_);
        
        j["HitConfig"] = hitCfg;
    }
    json dmgParams;
    dmgParams["skillLevel"]              = skillLevel + 1;
    dmgParams["isCrit"]                  = isCrit;
    dmgParams["isDot"]                   = isDot;
    dmgParams["hudColor"]                = hudColorIndex ? *hudColorIndex : -1;
    dmgParams["skillPercentAmend"]       = Round(skillPercentAmend ? *skillPercentAmend : 0.0);
    dmgParams["talentGroupPercentAmend"] = RoundTo(talentGroupPercentAmend ? *talentGroupPercentAmend : 0.0, 4);
    dmgParams["skillAbsAmend"]           = RoundTo(skillAbsAmend ? *skillAbsAmend : 0.0, 4);
    dmgParams["talentGroupAbsAmend"]     = RoundTo(talentGroupAbsAmend ? *talentGroupAbsAmend : 0.0, 4);
    dmgParams["perkIntensityRatio"]      = RoundTo(perkIntensityRatio ? *perkIntensityRatio : 0.0, 4);
    dmgParams["slotDmgRatio"]            = RoundTo(slotDmgRatio ? *slotDmgRatio : 0.0, 4);
    dmgParams["fromEE"]                  = RoundTo(fromEE ? *fromEE : 0.0, 4);
    dmgParams["erAmend"]                 = RoundTo(erAmend ? *erAmend : 0.0, 4);
    dmgParams["defAmend"]                = RoundTo(defAmend ? *defAmend : 0.0, 4);
    dmgParams["rcdSlotDmgRatio"]         = RoundTo(rcdSlotDmgRatio ? *rcdSlotDmgRatio : 0.0, 4);
    dmgParams["toEERCD"]                 = RoundTo(toEERCD ? *toEERCD : 0.0, 4);
    dmgParams["skillIntensityRatio"]     = RoundTo(skillIntensityRatio ? *skillIntensityRatio : 0.0, 4);
    dmgParams["toughnessBrokenDmgRatio"] = RoundTo(toughnessBrokenDmgRatio ? *toughnessBrokenDmgRatio : 0.0, 4);
    dmgParams["critRatio"]               = RoundTo(critRatio ? *critRatio : 0.0, 4);
    dmgParams["envAmendRatio"]           = RoundTo(envAmendRatio ? *envAmendRatio : 0.0, 4);
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
        json effects = BuildEffectListJson(effectManage, g_Cfg.on_hit_effect_list_information, gdc, GetEffectValue);
        if (!effects.empty())
            j["AttackerEffects"] = effects;
    }    

    if (toActor && g_Cfg.on_hit_effect_list) {
        ActorEffectManage_o* effectManage = toActor->fields.effectManage;
        json effects = BuildEffectListJson(effectManage, g_Cfg.on_hit_effect_list_information, gdc, GetEffectValue);
        if (!effects.empty())
            j["DefenderEffects"] = effects;
    }

    if (g_Cfg.on_hit_attacker_attr_dict) {
        json attrDict = BuildAdditionalAttrDictJson(fromAttrDict, fromActor, gdc, GetOnceAttr, GetValueConfigId, GetAttrValue);
        if (!attrDict.empty())
            j["AttackerAttrDict"] = attrDict;
    }

    if (g_Cfg.on_hit_defender_attr_dict) {
        json attrDict = BuildAdditionalAttrDictJson(toAttrDict, fromActor, gdc, GetOnceAttr, GetValueConfigId, GetAttrValue);
        if (!attrDict.empty())
            j["DefenderAttrDict"] = attrDict;
    }

    logJson(j);
}

void BuildSkillCastJson(int32_t skillId) {
    json j;
    j["Type"] = "Skill Cast";
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

// =============================================================================
//  Utility
// =============================================================================
std::string GetLocalAppDataPath() {
    PWSTR path_tmp;
    HRESULT hr = SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, NULL, &path_tmp);
    if (FAILED(hr)) return "";
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
    }
}
