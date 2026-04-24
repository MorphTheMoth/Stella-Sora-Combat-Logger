#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <cstdint>
#include <cstdio>
#include <mutex>
#include <atomic>
#include <string>
#include <shlobj.h>
#include <knownfolders.h>
#include <combaseapi.h>
#include <unordered_map>
#include <unordered_set>
#include <vector>
#include "MinHook.h"
#include "json.hpp"
#include "tables.h"


using json = nlohmann::json;

// =============================================================================
//  RVAs
// =============================================================================
static constexpr uintptr_t RVA_DAMAGE               = 0x121D860; // AdventureActor$$Damage
static constexpr uintptr_t RVA_EFFECT_ON_INIT       = 0x11281A0; // AdventureEffect$$OnInit
static constexpr uintptr_t RVA_EFFECT_ON_CLEAR      = 0x1123C90; // AdventureEffectBase$$OnClear
static constexpr uintptr_t RVA_UPDATE_LOGIC         = 0x1179570; // AdventureLevelController$$UpdateLogic
static constexpr uintptr_t RVA_BATTLE_FINISH        = 0x102FF60; // ActorEffectManage$$OnBattleFinish
static constexpr uintptr_t RVA_SPAWN_SKILL          = 0x11780D0; // AdventureLevelController$$SpawnSkill
static constexpr uintptr_t RVA_BUFF_EFFECT_ON_INIT  = 0x16C4BD0; // BuffEffectBase$$OnInit
static constexpr uintptr_t RVA_BUFF_ENTITY_INIT     = 0x16C9500; // BuffEntity$$InitBuff
static constexpr uintptr_t RVA_BUFF_ENTITY_EXCUTE   = 0x16C81C0; // BuffEntity$$BuffExcute
static constexpr uintptr_t RVA_CALC_NORMAL_DAMAGE   = 0x110C100; // CommonHelper$$CalculateNormalDamage


#ifdef WINHTTP_PROXY
// =============================================================================
//  WINHTTP FORWARDING
// =============================================================================
HMODULE real_winhttp = nullptr;
extern "C" {
    void* real_WinHttpOpen = nullptr;
    void* real_WinHttpGetProxyForUrl = nullptr;
    void* real_WinHttpGetIEProxyConfigForCurrentUser = nullptr;
    void* real_WinHttpCloseHandle = nullptr;

    __declspec(dllexport) __attribute__((naked)) void WinHttpOpen()                           { __asm__ volatile ("jmpq *real_WinHttpOpen(%rip)\n"); }
    __declspec(dllexport) __attribute__((naked)) void WinHttpGetProxyForUrl()                 { __asm__ volatile ("jmpq *real_WinHttpGetProxyForUrl(%rip)\n"); }
    __declspec(dllexport) __attribute__((naked)) void WinHttpGetIEProxyConfigForCurrentUser() { __asm__ volatile ("jmpq *real_WinHttpGetIEProxyConfigForCurrentUser(%rip)\n"); }
    __declspec(dllexport) __attribute__((naked)) void WinHttpCloseHandle()                    { __asm__ volatile ("jmpq *real_WinHttpCloseHandle(%rip)\n"); }
}
__attribute__((constructor)) void init_forwards() {
    real_winhttp = LoadLibraryA("C:\\windows\\system32\\winhttp.dll");
    real_WinHttpOpen                           = (void*)GetProcAddress(real_winhttp, "WinHttpOpen");
    real_WinHttpGetProxyForUrl                 = (void*)GetProcAddress(real_winhttp, "WinHttpGetProxyForUrl");
    real_WinHttpGetIEProxyConfigForCurrentUser = (void*)GetProcAddress(real_winhttp, "WinHttpGetIEProxyConfigForCurrentUser");
    real_WinHttpCloseHandle                    = (void*)GetProcAddress(real_winhttp, "WinHttpCloseHandle");
}
#endif

// =============================================================================
//  GAME TIME
// =============================================================================
static constexpr int64_t FP_ONE = 4294967296LL; // 1LL << 32 // TrueSync FP fixed-point denominator
static std::atomic<int64_t> g_BattleTimeFP{0};

static std::string GameTime() {
    int64_t raw = g_BattleTimeFP.load(std::memory_order_relaxed);
    if (raw > 0) {
        int64_t totalMs  = (raw * 1000LL) / FP_ONE;
        int     ms       = (int)(totalMs % 1000);
        int64_t totalSec = totalMs / 1000;
        int     sec      = (int)(totalSec % 60);
        int     min      = (int)(totalSec / 60);
        char buf[32];
        snprintf(buf, sizeof(buf), "%02d:%02d.%03d", min, sec, ms);
        return buf;
    }
    SYSTEMTIME t{};
    GetLocalTime(&t);
    char buf[32];
    snprintf(buf, sizeof(buf), "%02d:%02d:%02d.%03d", t.wHour, t.wMinute, t.wSecond, t.wMilliseconds);
    return buf;
}

// =============================================================================
//  LOGGING
// =============================================================================
static FILE*      g_Log = nullptr;
static std::mutex g_Mutex;

void Log(const char* fmt, ...) {
    if (strcmp(fmt, "suppressed") == 0) return;
    if (!g_Log) return;
    std::string ts = GameTime();
    std::lock_guard<std::mutex> lk(g_Mutex);
    fprintf(g_Log, "[%s] ", ts.c_str());
    va_list args;
    va_start(args, fmt);
    vfprintf(g_Log, fmt, args);
    va_end(args);
    fputc('\n', g_Log);
    fflush(g_Log);
}

// =============================================================================
//  LOG CONFIG
// =============================================================================
struct LogConfig {
    bool suppress_useless_info          = true;
    bool buffs                          = true;
    bool effects                        = true;
    bool damage                         = true;
    bool skill_casts                    = true;
    bool on_hit_attacker_stats          = false;
    bool on_hit_defender_stats          = false;
    bool on_hit_buff_list               = true;
    bool on_hit_effect_list             = false;
    bool on_hit_effect_list_information = false;
};
static LogConfig g_Cfg;

static void LoadConfig(const char* dir) {
    char path[512];
    snprintf(path, sizeof(path), "%s\\log_config.json", dir);

    FILE* f = fopen(path, "r");
    if (!f) {
        // write defaults so the user has a template to edit
        f = fopen(path, "w");
        if (f) {
            fprintf(f,
                "{\n"
                "  \"suppress_useless_info\":          true,\n"
                "  \"buffs\":                          true,\n"
                "  \"effects\":                        true,\n"
                "  \"damage\":                         true,\n"
                "  \"skill_casts\":                    true,\n"
                "  \"on_hit_attacker_stats\":          false,\n"
                "  \"on_hit_defender_stats\":          false,\n"
                "  \"on_hit_buff_list\":               true,\n"
                "  \"on_hit_effect_list\":             false,\n"
                "  \"on_hit_effect_list_information\": false\n"
                "}\n");
            fclose(f);
            Log("[config] log_config.json not found — wrote defaults to %s", path);
        }
        return;
    }

    // read entire file
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
        g_Cfg.suppress_useless_info          = get("suppress_useless_info",         true);
        g_Cfg.buffs                          = get("buffs",                          true);
        g_Cfg.effects                        = get("effects",                        true);
        g_Cfg.damage                         = get("damage",                         true);
        g_Cfg.skill_casts                    = get("skill_casts",                    true);
        g_Cfg.on_hit_attacker_stats          = get("on_hit_attacker_stats",          true);
        g_Cfg.on_hit_defender_stats          = get("on_hit_defender_stats",          true);
        g_Cfg.on_hit_buff_list               = get("on_hit_buff_list",               true);
        g_Cfg.on_hit_effect_list             = get("on_hit_effect_list",             true);
        g_Cfg.on_hit_effect_list_information = get("on_hit_effect_list_information", true);
        Log("[config] Loaded log_config.json — suppress_useless_info=%d buffs=%d effects=%d damage=%d skill_casts=%d"
            " oh_atk=%d oh_def=%d oh_buffs=%d oh_efx=%d oh_efx_info=%d",
            g_Cfg.suppress_useless_info, g_Cfg.buffs, g_Cfg.effects, g_Cfg.damage, g_Cfg.skill_casts,
            g_Cfg.on_hit_attacker_stats, g_Cfg.on_hit_defender_stats,
            g_Cfg.on_hit_buff_list, g_Cfg.on_hit_effect_list, g_Cfg.on_hit_effect_list_information);
    } catch (...) {
        Log("[config] Failed to parse log_config.json — using defaults");
    }
}

// =============================================================================
//  AdventureLevelController$$UpdateLogic HOOK  — pause-aware battle timer
// =============================================================================
using FnUpdateLogic = void(__fastcall*)(void*, int64_t, void*);
static FnUpdateLogic g_OrigUpdateLogic = nullptr;

static void __fastcall Hook_UpdateLogic(void* self, int64_t logicDeltaTime, void* method) {
    g_OrigUpdateLogic(self, logicDeltaTime, method);
    g_BattleTimeFP.fetch_add(logicDeltaTime, std::memory_order_relaxed);
}

// =============================================================================
//  Il2CppString helper
// =============================================================================
static std::string Il2CppStringToStd(void* strObj) {
    if (!strObj) return "?";
    int32_t len = *reinterpret_cast<int32_t*>(reinterpret_cast<uintptr_t>(strObj) + 0x10);
    if (len <= 0 || len >= 1024) return "zero";
    char16_t* chars = reinterpret_cast<char16_t*>(reinterpret_cast<uintptr_t>(strObj) + 0x14);
    std::string out(len, '\0');
    for (int i = 0; i < len; ++i)
        out[i] = (char)chars[i];
    return out;
}

static const char* AttrName(int i) {
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

static void logAdventureActorAttrs(void* actor) {
    uintptr_t base = reinterpret_cast<uintptr_t>(actor);
    static constexpr uintptr_t ACTOR_FIELDS = 0x18;

    int64_t entityId = *reinterpret_cast<int64_t*>(base + 0x48);
    void* attrList   = *reinterpret_cast<void**>(base + ACTOR_FIELDS + 0x080); // +0x098

    if (!attrList) {
        Log("[attr] entityId=%lld  attrList is null", entityId);
        return;
    }

    bool isBelongToPlayer = *reinterpret_cast<bool*>(reinterpret_cast<uintptr_t>(attrList) + 0x28);

    void* entries = *reinterpret_cast<void**>(reinterpret_cast<uintptr_t>(attrList) + 0x18);
    if (!entries) {
        Log("[attr] entityId=%lld  entries is null", entityId);
        return;
    }

    int32_t count  = *reinterpret_cast<int32_t*>(reinterpret_cast<uintptr_t>(entries) + 0x18);
    uintptr_t data = reinterpret_cast<uintptr_t>(entries) + 0x20;

    Log("[attr] entityId=%lld  isBelongToPlayer=%d  count=%d", entityId, (int)isBelongToPlayer, count);

    for (int i = 0; i < count && i < 98; ++i) {
        uintptr_t entry = data + i * 0x28;
        double origin = *reinterpret_cast<double*>(entry + 0x00);
        double base_  = *reinterpret_cast<double*>(entry + 0x08);
        double pct    = *reinterpret_cast<double*>(entry + 0x10);
        double abs_   = *reinterpret_cast<double*>(entry + 0x18);
        double limPct = *reinterpret_cast<double*>(entry + 0x20);

        auto nearZero = [](double v) { return v > -1e-7 && v < 1e-7; };
        if ((nearZero(origin) || nearZero(origin-1)) && nearZero(base_) && nearZero(pct) && nearZero(abs_) && nearZero(limPct))
            continue;
        Log("[attr] entityId=%lld  [%d] %-24s  origin=%.4f  base=%.4f  pct=%.4f  abs=%.4f  limPct=%.4f",
            entityId, i, AttrName(i), origin, base_, pct, abs_, limPct);
    }
}

static void logAdventureActorSpecialAttrs(void* actor) {
    uintptr_t base = reinterpret_cast<uintptr_t>(actor);
    static constexpr uintptr_t ACTOR_FIELDS = 0x18;

    int64_t entityId      = *reinterpret_cast<int64_t*>(base + 0x48);
    void* specialAttrList = *reinterpret_cast<void**>(base + ACTOR_FIELDS + 0x088); // +0x0A0

    if (!specialAttrList) {
        Log("[sattr] entityId=%lld  specialAttrList is null", entityId);
        return;
    }

    void* entries = *reinterpret_cast<void**>(reinterpret_cast<uintptr_t>(specialAttrList) + 0x18);
    if (!entries) {
        Log("[sattr] entityId=%lld  entries is null", entityId);
        return;
    }

    int32_t  count = *reinterpret_cast<int32_t*>(reinterpret_cast<uintptr_t>(entries) + 0x18);
    uintptr_t data = reinterpret_cast<uintptr_t>(entries) + 0x20;

    Log("[sattr] entityId=%lld  count=%d", entityId, count);

    // SpecialAttributeEntry: double current (0x0) + int32_t max_type (0x8) = 0xC stride
    static constexpr uintptr_t ENTRY_STRIDE = 0x0C;

    for (int i = 0; i < count && i < 64; ++i) {
        uintptr_t entry  = data + i * ENTRY_STRIDE;

        double  current  = *reinterpret_cast<double*>  (entry + 0x00);
        int32_t max_type = *reinterpret_cast<int32_t*> (entry + 0x08);

        auto nearZero = [](double v) { return v > -1e-7 && v < 1e-7; };
        if (nearZero(current) && max_type == 0)
            continue;

        Log("[sattr] entityId=%lld  [%d] %-24s  current=%.4f  max_type=%d",
            entityId, i, AttrName(i), current, max_type);
    }
}

// logs
static char* adventureActorLog(void* actor) {
    uintptr_t base = reinterpret_cast<uintptr_t>(actor);
    static constexpr uintptr_t ACTOR_FIELDS = 0x18;

    int64_t entityId    = *reinterpret_cast<int64_t*>(base + 0x48);                    // LogicEntity _Id_k__BackingField
    int32_t dataId      = *reinterpret_cast<int32_t*>(base + ACTOR_FIELDS + 0x140);    // +0x158
    //int32_t attrTemplId = *reinterpret_cast<int32_t*>(base + ACTOR_FIELDS + 0x150);    // +0x168
    int32_t skinId      = *reinterpret_cast<int32_t*>(base + ACTOR_FIELDS + 0x154);    // +0x16C
    //bool isSyncActived  = *reinterpret_cast<bool*>   (base + ACTOR_FIELDS + 0x158);    // +0x170
    //void* groupIdStr    = *reinterpret_cast<void**>  (base + ACTOR_FIELDS + 0x160);    // +0x178
    //std::string groupId = Il2CppStringToStd(groupIdStr); //groupId.c_str()

    bool isBelongToPlayer = false;
    void* attrList = *reinterpret_cast<void**>(base + ACTOR_FIELDS + 0x080);           // +0x098
    if (attrList)
        isBelongToPlayer = *reinterpret_cast<bool*>(reinterpret_cast<uintptr_t>(attrList) + 0x28);
    const std::string& ownerName = ActorDisplayName(isBelongToPlayer ? dataId : skinId);

    char* logStr = new char[256];
    if(isBelongToPlayer)
        sprintf(logStr, "[%s]", ownerName.c_str());
    else
        sprintf(logStr, "%s (dataId=%d  skinId=%d  isPlayer=%d)", 
            ownerName.c_str(), dataId, skinId, (int)isBelongToPlayer);
    return logStr;
}

static char* buffIdToName(int32_t configId) {
    char* buf = new char[256];
    if (configId > 100000000 && !g_Cfg.suppress_useless_info) {   //enemy
        sprintf(buf, "configId=%d  (suppressed for length(enemy))", configId);
    }
    auto eit = g_EffectTable.find(configId);
    if (eit != g_EffectTable.end()) {
        const EffectInfo& ei = eit->second;
        if (ei.charName != "?")
            sprintf(buf, "%s / %s", ei.charName.c_str(), ei.label.c_str());
        else
            sprintf(buf, "%s", ei.label.c_str());
    } else {
        if (!g_SuppressedEffects.count(configId))
            sprintf(buf, "? / ?, configId=%d  (unknown)", configId);
        else
            if(!g_Cfg.suppress_useless_info)
                sprintf(buf, "? / ?, configId=%d  (suppressed)", configId);
    }
    return buf;
}

// =============================================================================
//  STRUCT — ValueTuple<bool, long, bool> exact IL2CPP layout
// =============================================================================
struct DamageTuple {
    bool    Item1;
    uint8_t _pad[7];
    int64_t Item2;
    bool    Item3;
};
static_assert(offsetof(DamageTuple, Item2) == 8,  "Item2 offset wrong");
static_assert(offsetof(DamageTuple, Item3) == 16, "Item3 offset wrong");

// =============================================================================
//  DAMAGE HOOK
// =============================================================================
using FnDamage = DamageTuple*(__fastcall*)(
    DamageTuple*, void*, void*,
    int32_t, int32_t, int32_t,
    void*, void*, bool, bool, bool, void*);
static FnDamage             g_OrigDamage = nullptr;
static std::atomic<int64_t> g_HitDamage{0};

static DamageTuple* __fastcall Hook_Damage(
    DamageTuple* sret,
    void* self, void* from,
    int32_t uniqueAttackId, int32_t onceAttackTargetCount, int32_t hitDamageId,
    void* hurtEffect, void* hitbox,
    bool isHittedEffectScale, bool showHud, bool effectIgnoreTimeScale,
    void* method)
{
    DamageTuple* result = g_OrigDamage(sret, self, from,
                                       uniqueAttackId, onceAttackTargetCount, hitDamageId,
                                       hurtEffect, hitbox,
                                       isHittedEffectScale, showHud, effectIgnoreTimeScale,
                                       method);
    ++g_HitDamage;

    

    if (g_Cfg.damage) {
        auto it = g_HitTable.find(hitDamageId);
        if (it != g_HitTable.end()) {
            const HitInfo& h = it->second;
            Log("[dmg hook] dmg=%-8lld  %s / %s [hit %d], id=%d",
                (long long)sret->Item2,
                h.charName.c_str(),
                h.skillTitle.c_str(),
                h.hitNum,
                hitDamageId);
        } else {
            Log("[dmg hook] dmg=%-8lld  hitId=%d (unknown)", (long long)sret->Item2, hitDamageId);
            Log("---");
        }
    }
    return result;
    Log("[dmg hook] {from->to : %s  ->  %s}", adventureActorLog(from), adventureActorLog(self));
    
    if(adventureActorLog(from)[0] != '?') {
        logAdventureActorAttrs(from);
        Log("---");
        logAdventureActorSpecialAttrs(from);
        Log("---");
    }
    return result;
}

// =============================================================================
//  CommonHelper$$CalculateNormalDamage HOOK
// =============================================================================
using FnCalcNormalDamage = int64_t(__fastcall*)(
    void*,    void*,    void*,
    int32_t,  bool,     bool,
    int32_t*, double*,  double*,
    double*,  double*,  double*,
    double*,  double*,  double*,
    double*,  double*,  double*,
    double*,  double*,  double*,
    double*,  void*);
static FnCalcNormalDamage g_OrigCalcNormalDamage = nullptr;

void static LogActorBuffCom(void* fromActor){
    uintptr_t actorBase = reinterpret_cast<uintptr_t>(fromActor);
    static constexpr uintptr_t ACTOR_FIELDS = 0x18;
    void* buffCom = *reinterpret_cast<void**>(actorBase + ACTOR_FIELDS + 0xE0);
    if (buffCom) {
        uintptr_t bc = reinterpret_cast<uintptr_t>(buffCom) + 0x18;

        void*   buffList        = *reinterpret_cast<void**>  (bc + 0x10);
        void*   firstIdBuffs    = *reinterpret_cast<void**>  (bc + 0x20);
        void*   owner           = *reinterpret_cast<void**>  (bc + 0x28);
        int32_t tokenIndex      = *reinterpret_cast<int32_t*>(bc + 0x40);
        void*   immunityIds     = *reinterpret_cast<void**>  (bc + 0x50);
        void*   immunityGroupIds= *reinterpret_cast<void**>  (bc + 0x58);
        void*   immunityTags    = *reinterpret_cast<void**>  (bc + 0x60);
        int32_t reduceCountA    = *reinterpret_cast<int32_t*>(bc + 0x70);
        int32_t reduceTimeCount = *reinterpret_cast<int32_t*>(bc + 0x74);
        void*   buffTags        = *reinterpret_cast<void**>  (bc + 0x78);

        Log("[calcN] buffCom: tokenIndex=%d  reduceCountA=%d  reduceTimeCount=%d",
            tokenIndex, reduceCountA, reduceTimeCount);
        Log("[calcN] buffCom: firstIdBuffs=%p  immunityIds=%p  immunityGroupIds=%p  immunityTags=%p  buffTags=%p",
            firstIdBuffs, immunityIds, immunityGroupIds, immunityTags, buffTags);
        Log("[calcN] buffCom: owner=%p", adventureActorLog(owner));
        
        if (buffList) {
            uintptr_t bl = reinterpret_cast<uintptr_t>(buffList);
            void*    itemsArray = *reinterpret_cast<void**> (bl + 0x10); // List._items (the backing array)
            int32_t  count      = *reinterpret_cast<int32_t*>(bl + 0x18); // List._size
            Log("[calcN] buffs: count=%d", count);

            if (itemsArray && count > 0) {
                uintptr_t items = reinterpret_cast<uintptr_t>(itemsArray) + 0x20; // array data start
                for (int i = 0; i < count && i < 32; ++i) {
                    void* buffEntity = *reinterpret_cast<void**>(items + i * 0x8);
                    if (!buffEntity) continue;

                    uintptr_t be = reinterpret_cast<uintptr_t>(buffEntity) + 0x10; // skip Il2Cpp header

                    // buffConfig at fields+0x28 → be+0x28, configId inside at +0x18
                    void*   buffConfig  = *reinterpret_cast<void**>  (be + 0x28);
                    int32_t buffNum     = *reinterpret_cast<int32_t*>(be + 0x40);
                    int32_t exceptNum   = *reinterpret_cast<int32_t*>(be + 0x50);
                    bool    isNew       = *reinterpret_cast<bool*>   (be + 0x68);
                    bool    removed     = *reinterpret_cast<bool*>   (be + 0x69);

                    // TrueSync FP: raw int64 >> 32 = whole part, use as double
                    int64_t configBuffTimeRaw = *reinterpret_cast<int64_t*>(be + 0x10);
                    int64_t buffLeftTimeRaw   = *reinterpret_cast<int64_t*>(be + 0x18);
                    double  configBuffTime    = (double)configBuffTimeRaw / 4294967296.0;
                    double  buffLeftTime      = (double)buffLeftTimeRaw   / 4294967296.0;

                    int32_t configId = 0;
                    if (buffConfig)
                        configId = *reinterpret_cast<int32_t*>(reinterpret_cast<uintptr_t>(buffConfig) + 0x18);
                    char flags[128] = "";
                    int offset = 0;
                    if (exceptNum != 0)
                        offset += sprintf(flags + offset, "  exceptNum=%d", exceptNum);
                    if (isNew)
                        offset += sprintf(flags + offset, "  isNew=1");
                    if (removed)
                        offset += sprintf(flags + offset, "  removed=1");
                    Log("[calcN] buff [%2d]: %-35s stacks=%2d  totalTime=%.2f  leftTime=%.2f%s",
                        i, buffIdToName(configId), buffNum, configBuffTime, buffLeftTime, flags);
                }
            }
        }
    } else {
        Log("[calcN] buffCom: null");
    }
}

static int64_t __fastcall Hook_CalcNormalDamage(
    void*    fromActor,                  // AdventureActor_o*
    void*    toActor,                    // AdventureActor_o*
    void*    hitDamageConfig,            // Nova_Client_HitDamage_o*
    int32_t  skillLevel,
    bool     isCrit,
    bool     isDot,
    int32_t* hudColorIndex,
    double*  skillPercentAmend,
    double*  talentGroupPercentAmend,
    double*  skillAbsAmend,
    double*  talentGroupAbsAmend,
    double*  perkIntensityRatio,
    double*  slotDmgRatio,
    double*  fromEE,
    double*  erAmend,
    double*  defAmend,
    double*  rcdSlotDmgRatio,
    double*  toEERCD,
    double*  skillIntensityRatio,
    double*  toughnessBrokenDmgRatio,
    double*  critRatio,
    double*  envAmendRatio,
    void*    method)
{
    Log("[calcN] -- skillLevel=%d  isCrit=%d  isDot=%d", skillLevel+1, (int)isCrit, (int)isDot);

    int64_t dmg = g_OrigCalcNormalDamage(
        fromActor, toActor, hitDamageConfig,
        skillLevel, isCrit, isDot,
        hudColorIndex, skillPercentAmend, talentGroupPercentAmend,
        skillAbsAmend, talentGroupAbsAmend, perkIntensityRatio,
        slotDmgRatio, fromEE, erAmend,
        defAmend, rcdSlotDmgRatio, toEERCD,
        skillIntensityRatio, toughnessBrokenDmgRatio, critRatio,
        envAmendRatio, method);

    
    int32_t hitDamageId = 0;
    if (hitDamageConfig) {
        hitDamageId = *reinterpret_cast<int32_t*>(reinterpret_cast<uintptr_t>(hitDamageConfig) + 0x18);
        uintptr_t hdc = reinterpret_cast<uintptr_t>(hitDamageConfig) + 0x10; // skip Il2Cpp header
        int32_t hitDamageId      = *reinterpret_cast<int32_t*>(hdc + 0x08);
        int32_t levelTypeData_   = *reinterpret_cast<int32_t*>(hdc + 0x0C);
        int32_t levelData_       = *reinterpret_cast<int32_t*>(hdc + 0x10);
        int32_t mainOrSupport_   = *reinterpret_cast<int32_t*>(hdc + 0x14);
        void*   hitdamageInfo_   = *reinterpret_cast<void**>  (hdc + 0x18);
        int32_t distanceType_    = *reinterpret_cast<int32_t*>(hdc + 0x20);
        int32_t sourceType_      = *reinterpret_cast<int32_t*>(hdc + 0x24);
        int32_t damageType_      = *reinterpret_cast<int32_t*>(hdc + 0x28);
        int32_t effectType_      = *reinterpret_cast<int32_t*>(hdc + 0x2C);
        int32_t elementType_     = *reinterpret_cast<int32_t*>(hdc + 0x30);
        int32_t damageBonusType_ = *reinterpret_cast<int32_t*>(hdc + 0x40);
        int32_t additionalSource_= *reinterpret_cast<int32_t*>(hdc + 0x58);
        int32_t additionalType_  = *reinterpret_cast<int32_t*>(hdc + 0x5C);
        int32_t energyCharge_    = *reinterpret_cast<int32_t*>(hdc + 0x68);
        bool    isDenseType_     = *reinterpret_cast<bool*>   (hdc + 0x80);
        int32_t skillId_         = *reinterpret_cast<int32_t*>(hdc + 0x90);
        int32_t skillSlotType_   = *reinterpret_cast<int32_t*>(hdc + 0x94);
        int32_t perkId_          = *reinterpret_cast<int32_t*>(hdc + 0x98);
        int32_t hitImmunityTime_ = *reinterpret_cast<int32_t*>(hdc + 0x9C);
        std::string hitInfo      = Il2CppStringToStd(hitdamageInfo_);

        if (g_Cfg.damage) {
            Log("[calcN] hitDmgCfg: id=%d  levelType=%d  levelData=%d  mainOrSupport=%d  info=%s",
                hitDamageId, levelTypeData_, levelData_, mainOrSupport_, hitInfo.c_str());
            Log("[calcN] hitDmgCfg: distType=%d  srcType=%d  dmgType=%d  effType=%d  elemType=%d  dmgBonusType=%d  isDense=%d",
                distanceType_, sourceType_, damageType_, effectType_, elementType_, damageBonusType_, (int)isDenseType_);
            Log("[calcN] hitDmgCfg: addSrc=%d  addType=%d  energyCharge=%d  skillId=%d  slotType=%d  perkId=%d  hitImmunity=%d",
                additionalSource_, additionalType_, energyCharge_, skillId_, skillSlotType_, perkId_, hitImmunityTime_);
        }
    }

    if (g_Cfg.on_hit_attacker_stats) {
        Log("[calcN] hudColor=%d  skillPct=%.4f  talentGrpPct=%.4f  skillAbs=%.4f  talentGrpAbs=%.4f",
            hudColorIndex          ? *hudColorIndex          : -1,
            skillPercentAmend      ? *skillPercentAmend      : 0.0,
            talentGroupPercentAmend? *talentGroupPercentAmend: 0.0,
            skillAbsAmend          ? *skillAbsAmend          : 0.0,
            talentGroupAbsAmend    ? *talentGroupAbsAmend    : 0.0);
        Log("[calcN] perkIntensity=%.4f  slotDmg=%.4f  fromEE=%.4f  erAmend=%.4f  defAmend=%.4f",
            perkIntensityRatio     ? *perkIntensityRatio     : 0.0,
            slotDmgRatio           ? *slotDmgRatio           : 0.0,
            fromEE                 ? *fromEE                 : 0.0,
            erAmend                ? *erAmend                : 0.0,
            defAmend               ? *defAmend               : 0.0);
        Log("[calcN] rcdSlotDmg=%.4f  toEERCD=%.4f  skillIntensity=%.4f  toughBrokenDmg=%.4f  crit=%.4f  envAmend=%.4f",
            rcdSlotDmgRatio        ? *rcdSlotDmgRatio        : 0.0,
            toEERCD                ? *toEERCD                : 0.0,
            skillIntensityRatio    ? *skillIntensityRatio    : 0.0,
            toughnessBrokenDmgRatio? *toughnessBrokenDmgRatio: 0.0,
            critRatio              ? *critRatio              : 0.0,
            envAmendRatio          ? *envAmendRatio          : 0.0);
    }

    

    if (fromActor) {
        uintptr_t actorBase = reinterpret_cast<uintptr_t>(fromActor);
        static constexpr uintptr_t ACTOR_FIELDS = 0x18;

        // ── ActorEffectManage (offset 0xD8 from actor fields) ─────────────────────
        void* effectManage = *reinterpret_cast<void**>(actorBase + ACTOR_FIELDS + 0xD8);
        if (effectManage) {
            uintptr_t em = reinterpret_cast<uintptr_t>(effectManage) + 0x18; // skip Il2Cpp header

            // scalar fields
            int32_t uniqueEffectId      = *reinterpret_cast<int32_t*>(em + 0x18);
            void*   effectsDict         = *reinterpret_cast<void**>  (em + 0x20);
            void*   timeTriggerEffects  = *reinterpret_cast<void**>  (em + 0x28);
            void*   delayRemovedIds     = *reinterpret_cast<void**>  (em + 0x30);
            int32_t beingProcessedRC    = *reinterpret_cast<int32_t*>(em + 0x38);
            void*   delayAddedDict      = *reinterpret_cast<void**>  (em + 0x40);
            void*   onceAttackIds       = *reinterpret_cast<void**>  (em + 0x48);
            void*   changeEffectIdList  = *reinterpret_cast<void**>  (em + 0x50);
            void*   addEffectInfoList   = *reinterpret_cast<void**>  (em + 0x58);
            void*   removeEffectIds     = *reinterpret_cast<void**>  (em + 0x60);
            void*   changeBuffTimeInfos = *reinterpret_cast<void**>  (em + 0x68);
            void*   changeLaminatedInfos= *reinterpret_cast<void**>  (em + 0x70);

            if (g_Cfg.on_hit_effect_list) {
                Log("[calcN] effectMgr: uniqueEffectId=%d  beingProcessedRC=%d", uniqueEffectId, beingProcessedRC);
                Log("[calcN] effectMgr: timeTrigger=%p  delayRemovedIds=%p  delayAddedDict=%p  onceAttackIds=%p",
                    timeTriggerEffects, delayRemovedIds, delayAddedDict, onceAttackIds);
                Log("[calcN] effectMgr: changeEffectIdList=%p  addEffectInfoList=%p  removeEffectIds=%p  changeBuffTimeInfos=%p  changeLaminatedInfos=%p",
                    changeEffectIdList, addEffectInfoList, removeEffectIds, changeBuffTimeInfos, changeLaminatedInfos);
            }

            if (g_Cfg.on_hit_effect_list && effectsDict) {
                uintptr_t d         = reinterpret_cast<uintptr_t>(effectsDict) + 0x10; // skip Il2Cpp header
                void*    entriesArr = *reinterpret_cast<void**>  (d + 0x08); // _entries array
                int32_t  slotCount  = *reinterpret_cast<int32_t*>(d + 0x10); // _count (allocated slots)
                int32_t  freeCount  = *reinterpret_cast<int32_t*>(d + 0x1C); // _freeCount
                int32_t  liveCount  = slotCount - freeCount;

                Log("[calcN] effectsDict: liveCount=%d  slots=%d", liveCount, slotCount);

                if (entriesArr && slotCount > 0) {
                    uintptr_t entries = reinterpret_cast<uintptr_t>(entriesArr) + 0x20;
                    int logged = 0;
                    for (int i = 0; i < slotCount && logged < 32; ++i) {
                        uintptr_t entry  = entries + i * 0x18;
                        int32_t hashCode = *reinterpret_cast<int32_t*>(entry + 0x00);
                        if (hashCode < 0) continue; // free slot

                        int32_t effectKey = *reinterpret_cast<int32_t*>(entry + 0x08);
                        void*   effectPtr = *reinterpret_cast<void**>  (entry + 0x10);

                        if (effectPtr) {
                            uintptr_t ef = reinterpret_cast<uintptr_t>(effectPtr) + 0x10; // skip Il2Cpp header

                            int32_t  id               = *reinterpret_cast<int32_t*>(ef + 0x00);
                            int32_t  sourceType       = *reinterpret_cast<int32_t*>(ef + 0x04);
                            int32_t  effectType       = *reinterpret_cast<int32_t*>(ef + 0x08);
                            bool     shareCD          = *reinterpret_cast<bool*>   (ef + 0x38);
                            bool     shareTakeLimit   = *reinterpret_cast<bool*>   (ef + 0x39);
                            int32_t  takeEffectLimit  = *reinterpret_cast<int32_t*>(ef + 0x3C);
                            bool     isNeedPostExec   = *reinterpret_cast<bool*>   (ef + 0x50);
                            bool     removed          = *reinterpret_cast<bool*>   (ef + 0x70);
                            void*    owner            = *reinterpret_cast<void**>  (ef + 0x78);
                            void*    fromActor_       = *reinterpret_cast<void**>  (ef + 0x80);
                            void*    fromWeapon       = *reinterpret_cast<void**>  (ef + 0x88);
                            void*    fromBuffEntity   = *reinterpret_cast<void**>  (ef + 0x90);
                            int64_t  damage           = *reinterpret_cast<int64_t*>(ef + 0xA0);

                            double cd              = (double)*reinterpret_cast<int64_t*>(ef + 0x58) / 4294967296.0;
                            double orginMaxCd      = (double)*reinterpret_cast<int64_t*>(ef + 0x60) / 4294967296.0;
                            double maxCd           = (double)*reinterpret_cast<int64_t*>(ef + 0x68) / 4294967296.0;
                            double nextTriggerTime = (double)*reinterpret_cast<int64_t*>(ef + 0x98) / 4294967296.0;

                            Log("[calcN] effect [%2d]: key=%-6d  id=%-6d  srcType=%d  effType=%d  removed=%d",
                                logged, effectKey, id, sourceType, effectType, (int)removed);
                            Log("[calcN] effect [%2d]: cd=%.3f  orginMaxCd=%.3f  maxCd=%.3f  nextTrigger=%.3f  damage=%lld",
                                logged, cd, orginMaxCd, maxCd, nextTriggerTime, (long long)damage);
                            Log("[calcN] effect [%2d]: takeLimit=%d  shareCD=%d  shareTakeLimit=%d  needPostExec=%d  owner=%s  fromActor=%s  fromWeapon=%p  fromBuff=%p",
                                logged, takeEffectLimit, (int)shareCD, (int)shareTakeLimit, (int)isNeedPostExec,
                                adventureActorLog(owner),  adventureActorLog(fromActor_), fromWeapon, fromBuffEntity);

                            // ── Nova_Client_Effect (_effectConfig) ──────────────────
                            void* effectConfig = *reinterpret_cast<void**>(ef + 0x10);
                            if (g_Cfg.on_hit_effect_list_information) {
                            if (effectConfig) {
                                uintptr_t ec = reinterpret_cast<uintptr_t>(effectConfig) + 0x10; // skip Il2Cpp header

                                int32_t cfg_id               = *reinterpret_cast<int32_t*>(ec + 0x08);
                                int32_t cfg_levelTypeData     = *reinterpret_cast<int32_t*>(ec + 0x18);
                                int32_t cfg_levelData         = *reinterpret_cast<int32_t*>(ec + 0x1C);
                                int32_t cfg_mainOrSupport     = *reinterpret_cast<int32_t*>(ec + 0x20);
                                int32_t cfg_trigger           = *reinterpret_cast<int32_t*>(ec + 0x24);
                                int32_t cfg_triggerTarget     = *reinterpret_cast<int32_t*>(ec + 0x28);
                                int32_t cfg_triggerCond1      = *reinterpret_cast<int32_t*>(ec + 0x2C);
                                int32_t cfg_triggerTarget2    = *reinterpret_cast<int32_t*>(ec + 0x50);
                                int32_t cfg_triggerCond2      = *reinterpret_cast<int32_t*>(ec + 0x54);
                                int32_t cfg_triggerLogicType  = *reinterpret_cast<int32_t*>(ec + 0x78);
                                int32_t cfg_teTarget1         = *reinterpret_cast<int32_t*>(ec + 0x7C);
                                int32_t cfg_teCond1           = *reinterpret_cast<int32_t*>(ec + 0x80);
                                int32_t cfg_teTarget2         = *reinterpret_cast<int32_t*>(ec + 0xA8);
                                int32_t cfg_teCond2           = *reinterpret_cast<int32_t*>(ec + 0xAC);
                                int32_t cfg_teLogicType       = *reinterpret_cast<int32_t*>(ec + 0xD0);
                                int32_t cfg_target1           = *reinterpret_cast<int32_t*>(ec + 0xD4);
                                int32_t cfg_targetCond1       = *reinterpret_cast<int32_t*>(ec + 0xD8);
                                int32_t cfg_targetCond2       = *reinterpret_cast<int32_t*>(ec + 0x100);
                                int32_t cfg_filterLogicType   = *reinterpret_cast<int32_t*>(ec + 0x128);

                                std::string cfg_name         = Il2CppStringToStd(*reinterpret_cast<void**>(ec + 0x10));
                                std::string cfg_tParam1      = Il2CppStringToStd(*reinterpret_cast<void**>(ec + 0x30));
                                std::string cfg_tParam2      = Il2CppStringToStd(*reinterpret_cast<void**>(ec + 0x38));
                                std::string cfg_tParam3      = Il2CppStringToStd(*reinterpret_cast<void**>(ec + 0x40));
                                std::string cfg_tParam4      = Il2CppStringToStd(*reinterpret_cast<void**>(ec + 0x48));
                                std::string cfg_t2Param1     = Il2CppStringToStd(*reinterpret_cast<void**>(ec + 0x58));
                                std::string cfg_t2Param2     = Il2CppStringToStd(*reinterpret_cast<void**>(ec + 0x60));
                                std::string cfg_t2Param3     = Il2CppStringToStd(*reinterpret_cast<void**>(ec + 0x68));
                                std::string cfg_t2Param4     = Il2CppStringToStd(*reinterpret_cast<void**>(ec + 0x70));
                                std::string cfg_teParam1     = Il2CppStringToStd(*reinterpret_cast<void**>(ec + 0x88));
                                std::string cfg_teParam2     = Il2CppStringToStd(*reinterpret_cast<void**>(ec + 0x90));
                                std::string cfg_teParam3     = Il2CppStringToStd(*reinterpret_cast<void**>(ec + 0x98));
                                std::string cfg_teParam4     = Il2CppStringToStd(*reinterpret_cast<void**>(ec + 0xA0));
                                std::string cfg_te2Param1    = Il2CppStringToStd(*reinterpret_cast<void**>(ec + 0xB0));
                                std::string cfg_te2Param2    = Il2CppStringToStd(*reinterpret_cast<void**>(ec + 0xB8));
                                std::string cfg_te2Param3    = Il2CppStringToStd(*reinterpret_cast<void**>(ec + 0xC0));
                                std::string cfg_te2Param4    = Il2CppStringToStd(*reinterpret_cast<void**>(ec + 0xC8));
                                std::string cfg_tgtParam1    = Il2CppStringToStd(*reinterpret_cast<void**>(ec + 0xE0));
                                std::string cfg_tgtParam2    = Il2CppStringToStd(*reinterpret_cast<void**>(ec + 0xE8));
                                std::string cfg_tgtParam3    = Il2CppStringToStd(*reinterpret_cast<void**>(ec + 0xF0));
                                std::string cfg_tgtParam4    = Il2CppStringToStd(*reinterpret_cast<void**>(ec + 0xF8));
                                std::string cfg_tgt2Param1   = Il2CppStringToStd(*reinterpret_cast<void**>(ec + 0x108));
                                std::string cfg_tgt2Param2   = Il2CppStringToStd(*reinterpret_cast<void**>(ec + 0x110));
                                std::string cfg_tgt2Param3   = Il2CppStringToStd(*reinterpret_cast<void**>(ec + 0x118));
                                std::string cfg_tgt2Param4   = Il2CppStringToStd(*reinterpret_cast<void**>(ec + 0x120));
                                Log("---");
                                Log("[calcN] effect [%2d] cfg: id=%d  name=%s  levelType=%d  levelData=%d  mainOrSupport=%d",
                                    logged, cfg_id, buffIdToName(cfg_id), cfg_levelTypeData, cfg_levelData, cfg_mainOrSupport);
                                Log("[calcN] effect [%2d] cfg: trigger=%d  triggerTarget=%d  triggerCond1=%d  triggerTarget2=%d  triggerCond2=%d  triggerLogic=%d",
                                    logged, cfg_trigger, cfg_triggerTarget, cfg_triggerCond1, cfg_triggerTarget2, cfg_triggerCond2, cfg_triggerLogicType);
                                Log("[calcN] effect [%2d] cfg: tParams=[%s|%s|%s|%s]  t2Params=[%s|%s|%s|%s]",
                                    logged,
                                    cfg_tParam1.c_str(), cfg_tParam2.c_str(), cfg_tParam3.c_str(), cfg_tParam4.c_str(),
                                    cfg_t2Param1.c_str(), cfg_t2Param2.c_str(), cfg_t2Param3.c_str(), cfg_t2Param4.c_str());
                                Log("[calcN] effect [%2d] cfg: teTarget1=%d  teCond1=%d  teTarget2=%d  teCond2=%d  teLogic=%d",
                                    logged, cfg_teTarget1, cfg_teCond1, cfg_teTarget2, cfg_teCond2, cfg_teLogicType);
                                Log("[calcN] effect [%2d] cfg: teParams=[%s|%s|%s|%s]  te2Params=[%s|%s|%s|%s]",
                                    logged,
                                    cfg_teParam1.c_str(), cfg_teParam2.c_str(), cfg_teParam3.c_str(), cfg_teParam4.c_str(),
                                    cfg_te2Param1.c_str(), cfg_te2Param2.c_str(), cfg_te2Param3.c_str(), cfg_te2Param4.c_str());
                                Log("[calcN] effect [%2d] cfg: target1=%d  targetCond1=%d  targetCond2=%d  filterLogic=%d",
                                    logged, cfg_target1, cfg_targetCond1, cfg_targetCond2, cfg_filterLogicType);
                                Log("[calcN] effect [%2d] cfg: tgtParams=[%s|%s|%s|%s]  tgt2Params=[%s|%s|%s|%s]",
                                    logged,
                                    cfg_tgtParam1.c_str(), cfg_tgtParam2.c_str(), cfg_tgtParam3.c_str(), cfg_tgtParam4.c_str(),
                                    cfg_tgt2Param1.c_str(), cfg_tgt2Param2.c_str(), cfg_tgt2Param3.c_str(), cfg_tgt2Param4.c_str());
                            } else {
                                Log("[calcN] effect [%2d] cfg: null", logged);
                            }

                            // ── Nova_Client_EffectValue (_effectValueConfig) ─────────
                            void* effectValueConfig = *reinterpret_cast<void**>(ef + 0x18);
                            if (effectValueConfig) {
                                uintptr_t ev = reinterpret_cast<uintptr_t>(effectValueConfig) + 0x10; // skip Il2Cpp header

                                int32_t ev_id                  = *reinterpret_cast<int32_t*>(ev + 0x08);
                                int32_t ev_takeEffectLimit     = *reinterpret_cast<int32_t*>(ev + 0x20);
                                bool    ev_remove              = *reinterpret_cast<bool*>   (ev + 0x24);
                                int32_t ev_cd                  = *reinterpret_cast<int32_t*>(ev + 0x28);
                                int32_t ev_effectRate           = *reinterpret_cast<int32_t*>(ev + 0x2C);
                                int32_t ev_effectType           = *reinterpret_cast<int32_t*>(ev + 0x30);
                                int32_t ev_effectTypeFirstSub   = *reinterpret_cast<int32_t*>(ev + 0x34);
                                int32_t ev_effectTypeSecondSub  = *reinterpret_cast<int32_t*>(ev + 0x38);

                                std::string ev_name    = Il2CppStringToStd(*reinterpret_cast<void**>(ev + 0x10));
                                std::string ev_tag     = Il2CppStringToStd(*reinterpret_cast<void**>(ev + 0x18));
                                std::string ev_param1  = Il2CppStringToStd(*reinterpret_cast<void**>(ev + 0x40));
                                std::string ev_param2  = Il2CppStringToStd(*reinterpret_cast<void**>(ev + 0x48));
                                std::string ev_param3  = Il2CppStringToStd(*reinterpret_cast<void**>(ev + 0x50));
                                std::string ev_param4  = Il2CppStringToStd(*reinterpret_cast<void**>(ev + 0x58));
                                std::string ev_param5  = Il2CppStringToStd(*reinterpret_cast<void**>(ev + 0x60));
                                std::string ev_param6  = Il2CppStringToStd(*reinterpret_cast<void**>(ev + 0x68));
                                std::string ev_param7  = Il2CppStringToStd(*reinterpret_cast<void**>(ev + 0x70));

                                Log("[calcN] effect [%2d] val: tag=%s  takeLimit=%d  remove=%d  cd=%d  rate=%d",
                                    logged, ev_tag.c_str(), ev_takeEffectLimit, (int)ev_remove, ev_cd, ev_effectRate);
                                Log("[calcN] effect [%2d] val: effType=%d  firstSub=%d  secondSub=%d  params=[%s|%s|%s|%s|%s|%s|%s]",
                                    logged, ev_effectType, ev_effectTypeFirstSub, ev_effectTypeSecondSub,
                                    ev_param1.c_str(), ev_param2.c_str(), ev_param3.c_str(), ev_param4.c_str(),
                                    ev_param5.c_str(), ev_param6.c_str(), ev_param7.c_str());
                            } else {
                                Log("[calcN] effect [%2d] val: null", logged);
                            }
                            } // end on_hit_effect_list_information
                        } else {
                            Log("[calcN] effect [%2d]: key=%-6d  ptr=null", logged, effectKey);
                        }
                        ++logged;
                    }
                }
            } else {
                Log("[calcN] effectsDict: null");
            }

            // ── iterate _timeTriggerEffects (List<AdventureEffect>) ─────────────
            if (g_Cfg.on_hit_effect_list && timeTriggerEffects) {
                uintptr_t tl       = reinterpret_cast<uintptr_t>(timeTriggerEffects);
                void*    itemsArr  = *reinterpret_cast<void**> (tl + 0x10); // List._items
                int32_t  count     = *reinterpret_cast<int32_t*>(tl + 0x18); // List._size
                Log("[calcN] timeTriggerEffects: count=%d", count);

                if (itemsArr && count > 0) {
                    uintptr_t items = reinterpret_cast<uintptr_t>(itemsArr) + 0x20; // array data start
                    for (int i = 0; i < count && i < 32; ++i) {
                        void* effectPtr = *reinterpret_cast<void**>(items + i * 0x8);
                        Log("[calcN] timeTriggerEffect [%2d]: ptr=%p", i, effectPtr);
                    }
                }
            }
                    // ── iterate onceAttackEffectUniqueAttackIds (List<int>) ─────────────────
            if (g_Cfg.on_hit_effect_list && onceAttackIds) {
                uintptr_t ol      = reinterpret_cast<uintptr_t>(onceAttackIds);
                void*    itemsArr = *reinterpret_cast<void**>  (ol + 0x10); // List._items
                int32_t  count    = *reinterpret_cast<int32_t*>(ol + 0x18); // List._size
                Log("[calcN] onceAttackEffectIds: count=%d", count);

                if (itemsArr && count > 0) {
                    uintptr_t items = reinterpret_cast<uintptr_t>(itemsArr) + 0x20; // array data start
                    for (int i = 0; i < count && i < 32; ++i) {
                        int32_t uid = *reinterpret_cast<int32_t*>(items + i * 0x4); // List<int> → 4-byte stride
                        Log("[calcN] onceAttackEffect [%2d]: uniqueAttackId=%d", i, uid);
                    }
                }
            } else if (g_Cfg.on_hit_effect_list) {
                Log("[calcN] onceAttackEffectIds: null");
            }
        } else {
            Log("[calcN] effectManage: null");
        }

        if (g_Cfg.on_hit_buff_list) LogActorBuffCom(fromActor);
    }


    if (g_Cfg.damage) {
        auto it = g_HitTable.find(hitDamageId);
        if (it != g_HitTable.end()) {
            const HitInfo& h = it->second;
            Log("[calcN] dmg=%-8lld  %s / %s [hit %d], id=%d",
                (long long)dmg,
                h.charName.c_str(),
                h.skillTitle.c_str(),
                h.hitNum,
                hitDamageId);
        } else {
            Log("[calcN] dmg=%-8lld  hitId=%d (unknown)", (long long)dmg, hitDamageId);
        }

        Log("[calcN] {from->to : %s  ->  %s}", adventureActorLog(fromActor), adventureActorLog(toActor));
    }

    // AdventureActor static fields via klass pointer:
    //   object+0x0  -> Il2CppClass* (klass)
    //   klass+0xB8  -> static_fields*
    // Static layout (from dump):
    //   +0x00  int32_t  simplePlayerTag
    //   +0x64  int32_t  uniqueAttackIdTemp
    //   +0x68  int32_t  damageTypeTemp
    //   +0x6C  int32_t  onceAttackTargetCountTemp
    //   +0x80  int32_t  skillLevelTemp

    if (adventureActorLog(fromActor)[0] != '?') {
        if (g_Cfg.on_hit_attacker_stats) {
            logAdventureActorAttrs(fromActor);
            Log("---");
            logAdventureActorSpecialAttrs(fromActor);
            Log("--  --");
        }
        if (g_Cfg.on_hit_defender_stats || g_Cfg.on_hit_buff_list) {
            Log("-- toActor --");
            Log("--  --");
        }
        if (g_Cfg.on_hit_buff_list)      LogActorBuffCom(fromActor);
        if (g_Cfg.on_hit_defender_stats) logAdventureActorAttrs(toActor);
        Log("--end of calcN--");
    }

    return dmg;
}

// =============================================================================
//  Buffs hooks
// =============================================================================
using FnEffectOnInit = void(__fastcall*)( void*, int32_t, int32_t, int32_t, void*, void*, void*, void*, bool, int32_t, bool, int64_t, void*, void*);
static FnEffectOnInit g_OrigEffectOnInit = nullptr;
using FnBuffEffectOnInit = void(__fastcall*)(void*, void*, void*, void*, void*, int32_t, void*);
static FnBuffEffectOnInit g_OrigBuffEffectOnInit = nullptr;
using FnBuffEntityInit = void(__fastcall*)(void*, void*, void*, void*, void*, void*);
static FnBuffEntityInit g_OrigBuffEntityInit = nullptr;
using FnBuffEntityExcute = void(__fastcall*)(void*, int32_t, void*, void*);
static FnBuffEntityExcute g_OrigBuffEntityExcute = nullptr;

static char* logBuff(const char* type, int32_t configId, void* owner, int isAdd) {
    char* ownerLog = adventureActorLog(owner);
    char* ret = new char[256];
    if (configId > 100000000)   //enemy
        if(!g_Cfg.suppress_useless_info) {
            sprintf(ret, "[%s%s] %s \t\tconfigId=%d]  (suppressed for length(enemy))", type, isAdd>0 ? "+" : "-", ownerLog, configId);
            return ret;
        }
    {
        auto eit = g_EffectTable.find(configId);
        if (eit != g_EffectTable.end()) {
            const EffectInfo& ei = eit->second;
            if (ei.charName != "?")
                sprintf(ret, "[%s%s] %s \t\tbuff=%s/%s", type, isAdd>0 ? "+" : "-", ownerLog, ei.charName.c_str(), ei.label.c_str());
            else
                sprintf(ret, "[%s%s] %s \t\tbuff=%s  (configId=%d)", type, isAdd>0 ? "+" : "-", ownerLog, ei.label.c_str(), configId);
        } else {
            if (!g_SuppressedEffects.count(configId))
                sprintf(ret, "[%s%s] %s \t\tconfigId=%d  (unknown)", type, isAdd>0 ? "+" : "-", ownerLog, configId);
            else if(!g_Cfg.suppress_useless_info)
                sprintf(ret, "[%s%s] %s \t\tconfigId=%d  (suppressed)", type, isAdd>0 ? "+" : "-", ownerLog, configId);
            else
                sprintf(ret, "suppressed");
        }
    }
    delete[] ownerLog;
    return ret;
}

// =============================================================================
//  BuffEntity$$InitBuff HOOK
// =============================================================================
static void __fastcall Hook_BuffEntityInit(
    void* self,            // BuffEntity_o*
    void* buffConfig,      // Nova_Client_Buff_o*
    void* buffValueConfig, // Nova_Client_BuffValue_o*
    void* bfC,             // BuffCom_o*
    void* fromActor,       // AdventureActor_o*
    void* method)
{
    g_OrigBuffEntityInit(self, buffConfig, buffValueConfig, bfC, fromActor, method);
    int32_t configId = 0;
    if (buffConfig)
        configId = *reinterpret_cast<int32_t*>(reinterpret_cast<uintptr_t>(buffConfig) + 0x18);
    //char* fromLog = adventureActorLog(fromActor);
    //Log("[buff init] configId=%d  from=%s", configId, fromLog);
    //delete[] fromLog;
    //logBuff("Buff", configId, fromActor, +1);
}

static void __fastcall Hook_EffectOnInit( void* self, int32_t effType, int32_t sourceType, int32_t id, void* effectConfig, void* effectValueConfig, void* owner, void* fromActor, bool shareCD, int32_t takeEffectLimit, bool shareTakeEffectLimit, int64_t initCD, void* fromBuff, void* method)
{
    g_OrigEffectOnInit(self, effType, sourceType, id,
                       effectConfig, effectValueConfig,
                       owner, fromActor,
                       shareCD, takeEffectLimit, shareTakeEffectLimit,
                       initCD, fromBuff, method);
    int32_t configId = 0;
    if (effectConfig)
        configId = *reinterpret_cast<int32_t*>(reinterpret_cast<uintptr_t>(effectConfig) + 0x18);
    if (g_Cfg.effects)
        Log(logBuff("Effect", configId, owner, +1));
}

static void __fastcall Hook_BuffEffectOnInit(
    void*    self,             // BuffEffectBase_o*
    void*    owner,            // AdventureActor_o*  — buff recipient
    void*    fromActor,        // AdventureActor_o*  — buff source
    void*    buffEntity,       // BuffEntity_o*
    void*    buffEffectConfig, // Nova_Client_BuffEffect_o*
    int32_t  buffUid,
    void*    method)
{
    g_OrigBuffEffectOnInit(self, owner, fromActor, buffEntity, buffEffectConfig, buffUid, method);
    int32_t configId = 0;
    if (buffEffectConfig)
        configId = *reinterpret_cast<int32_t*>(reinterpret_cast<uintptr_t>(buffEffectConfig) + 0x18);
    if (g_Cfg.buffs) {
        Log("[debug] BuffEffectOnInit called");
        Log(logBuff("Buff", configId, owner, +1));
    }
}

// =============================================================================
//  BuffEntity$$BuffExcute HOOK
// =============================================================================
static void __fastcall Hook_BuffEntityExcute(
    void*    self,      // BuffEntity_o*
    int32_t  addType,
    void*    fromActor, // AdventureActor_o*
    void*    method)
{
    g_OrigBuffEntityExcute(self, addType, fromActor, method);
    int32_t configId = 0;
    // BuffEntity_fields: buffConfig is at fields+0x28 → object+0x38 (0x10 il2cpp header + 0x28)
    // Nova_Client_Buff configId sits at +0x18 inside the config object (same as InitBuff hook)
    void* buffConfig = *reinterpret_cast<void**>(reinterpret_cast<uintptr_t>(self) + 0x38);
    int32_t buffNum = *reinterpret_cast<int32_t*>(reinterpret_cast<uintptr_t>(self) + 0x50);

    if (buffConfig)
        configId = *reinterpret_cast<int32_t*>(reinterpret_cast<uintptr_t>(buffConfig) + 0x18);
    //Log("[Buff Excute] configId=%d  addType=%d", configId, addType);
    if (g_Cfg.buffs)
        Log(logBuff(("Buff Execute " + std::to_string(buffNum)).c_str(), configId, fromActor, +1));
}


using FnEffectOnClear = void(__fastcall*)(void*, void*);
static FnEffectOnClear g_OrigEffectOnClear = nullptr;

static void __fastcall Hook_EffectOnClear(void* self, void* method) {
    int32_t effectId   = 0;
    int32_t effectType = 0;
    int32_t configId   = 0;
    void* owner = nullptr;

    void* effect = *reinterpret_cast<void**>(reinterpret_cast<uintptr_t>(self) + 0x10);
    if (effect) {
        effectId   = *reinterpret_cast<int32_t*>(reinterpret_cast<uintptr_t>(effect) + 0x10);
        effectType = *reinterpret_cast<int32_t*>(reinterpret_cast<uintptr_t>(effect) + 0x18);
        owner      = *reinterpret_cast<void**>  (reinterpret_cast<uintptr_t>(effect) + 0x88);

        void* effectConfig = *reinterpret_cast<void**>(reinterpret_cast<uintptr_t>(effect) + 0x20);
        if (effectConfig)
            configId = *reinterpret_cast<int32_t*>(reinterpret_cast<uintptr_t>(effectConfig) + 0x18);
    }
    if (g_Cfg.effects)
        Log(logBuff("Effect", configId, owner, -1));
    g_OrigEffectOnClear(self, method);
}

// =============================================================================
//  ActorEffectManage$$OnBattleFinish HOOK, resets battle timer
// =============================================================================
using FnBattleFinish = void(__fastcall*)(void*, void*, void*);
static FnBattleFinish g_OrigBattleFinish = nullptr;

static void __fastcall Hook_BattleFinish(void* self, void* evt, void* method) {
    g_OrigBattleFinish(self, evt, method);
    g_BattleTimeFP.store(0, std::memory_order_relaxed);
    Log("[timer] Battle started — timer reset");  //idk why but this function runs at the start
}

// =============================================================================
//  AdventureLevelController$$SpawnSkill
// =============================================================================
using FnSpawnSkill = void*(__fastcall*)(void*, int32_t, void*);
static FnSpawnSkill g_OrigSpawnSkill = nullptr;

static void* __fastcall Hook_SpawnSkill(void* self, int32_t skillId, void* method) {
    void* result = g_OrigSpawnSkill(self, skillId, method);

    if (skillId < 10000000) return result; // if < 10 million, it belongs to an enemy monster
    if (!g_Cfg.skill_casts) return result;
    Log("---");
    auto it = g_SkillTable.find(skillId);
    if (it != g_SkillTable.end()) {
        const SkillInfo& s = it->second;
        if (!s.ownerName.empty())
            Log("[skill cast] %s / %s (%s)  skillId=%d",
                s.ownerName.c_str(), s.skillName.c_str(), s.skillType.c_str(), skillId);
        else
            Log("[skill cast] skillId=%d  %s  fcPath=%s",
                skillId, s.skillName.c_str(), s.fcPath.c_str());
    } else {
        Log("[skill cast] skillId=%d (unknown)", skillId);
    }
    return result;
}

// =============================================================================
//  HOOK INSTALLER
// =============================================================================
static bool InstallHook(uintptr_t target, void* hook, void** original, const char* name) {
    MH_STATUS s = MH_CreateHook(reinterpret_cast<void*>(target), hook, original);
    if (s != MH_OK) { Log("[ERROR] MH_CreateHook failed for %s: %d", name, (int)s); return false; }
    s = MH_EnableHook(reinterpret_cast<void*>(target));
    if (s != MH_OK) { Log("[ERROR] MH_EnableHook failed for %s: %d", name, (int)s); return false; }
    Log("[init] Hooked %s at 0x%llX", name, (unsigned long long)target);
    return true;
}

std::string GetLocalAppDataPath() {
    PWSTR path_tmp;
    // FOLDERID_LocalAppData corresponds to %LOCALAPPDATA%
    HRESULT hr = SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, NULL, &path_tmp);
    
    if (FAILED(hr)) return "";

    // Convert WSTR to string
    char ch[MAX_PATH];
    WideCharToMultiByte(CP_UTF8, 0, path_tmp, -1, ch, MAX_PATH, NULL, NULL);
    CoTaskMemFree(path_tmp);
    
    return std::string(ch);
}

// =============================================================================
//  INIT THREAD
// =============================================================================
static DWORD WINAPI InitThread(LPVOID) {
    std::string logDir = GetLocalAppDataPath() + "\\Stella Sora Combat Logger";
    std::string logPath = (logDir + "\\ss_dpslog.txt").c_str();
    CreateDirectoryA(logDir.c_str(), nullptr);
    g_Log = fopen(logPath.c_str(), "a");
    if (!g_Log) return 1;

    SYSTEMTIME t{};
    GetLocalTime(&t);
    fprintf(g_Log, "\n=== SS DPS Logger started %02d:%02d:%02d ===\n", t.wHour, t.wMinute, t.wSecond);
    fflush(g_Log);

    LoadConfig(logDir.c_str());
    BuildHitTable((GetLocalAppDataPath() + "\\StellaSoraData").c_str());

    uintptr_t base = 0;
    for (int i = 0; i < 60; i++) {
        base = reinterpret_cast<uintptr_t>(GetModuleHandleA("GameAssembly.dll"));
        if (base) break;
        Log("[init] Waiting for GameAssembly.dll... attempt %d/60", i + 1);
        Sleep(500);
    }
    if (!base) { Log("[ERROR] GameAssembly.dll never loaded!"); return 1; }
    Log("[init] GameAssembly base=0x%llX", (unsigned long long)base);


    if (MH_Initialize() != MH_OK) { Log("[ERROR] MH_Initialize failed."); return 1; }

    InstallHook(base + RVA_DAMAGE,
                reinterpret_cast<void*>(&Hook_Damage),
                reinterpret_cast<void**>(&g_OrigDamage),
                "AdventureActor$$Damage");

    InstallHook(base + RVA_EFFECT_ON_INIT,
                reinterpret_cast<void*>(&Hook_EffectOnInit),
                reinterpret_cast<void**>(&g_OrigEffectOnInit),
                "AdventureEffect$$OnInit");

    InstallHook(base + RVA_EFFECT_ON_CLEAR,
                reinterpret_cast<void*>(&Hook_EffectOnClear),
                reinterpret_cast<void**>(&g_OrigEffectOnClear),
                "AdventureEffectBase$$OnClear");

    InstallHook(base + RVA_UPDATE_LOGIC,
                reinterpret_cast<void*>(&Hook_UpdateLogic),
                reinterpret_cast<void**>(&g_OrigUpdateLogic),
                "AdventureLevelController$$UpdateLogic");

    InstallHook(base + RVA_BATTLE_FINISH,
                reinterpret_cast<void*>(&Hook_BattleFinish),
                reinterpret_cast<void**>(&g_OrigBattleFinish),
                "ActorEffectManage$$OnBattleFinish");

    InstallHook(base + RVA_SPAWN_SKILL,
                reinterpret_cast<void*>(&Hook_SpawnSkill),
                reinterpret_cast<void**>(&g_OrigSpawnSkill),
                "AdventureLevelController$$SpawnSkill");

    InstallHook(base + RVA_BUFF_EFFECT_ON_INIT,
                reinterpret_cast<void*>(&Hook_BuffEffectOnInit),
                reinterpret_cast<void**>(&g_OrigBuffEffectOnInit),
                "BuffEffectBase$$OnInit");

    InstallHook(base + RVA_BUFF_ENTITY_INIT,
                reinterpret_cast<void*>(&Hook_BuffEntityInit),
                reinterpret_cast<void**>(&g_OrigBuffEntityInit),
                "BuffEntity$$InitBuff");

    InstallHook(base + RVA_BUFF_ENTITY_EXCUTE,
                reinterpret_cast<void*>(&Hook_BuffEntityExcute),
                reinterpret_cast<void**>(&g_OrigBuffEntityExcute),
                "BuffEntity$$BuffExcute");

    InstallHook(base + RVA_CALC_NORMAL_DAMAGE,
                reinterpret_cast<void*>(&Hook_CalcNormalDamage),
                reinterpret_cast<void**>(&g_OrigCalcNormalDamage),
                "CommonHelper$$CalculateNormalDamage");

    Log("[init] Ready.");
    return 0;
}

// =============================================================================
//  DLL ENTRY POINT
// =============================================================================
BOOL APIENTRY DllMain(HMODULE hInst, DWORD reason, LPVOID reserved) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(hInst);
        HANDLE h = CreateThread(nullptr, 0, InitThread, nullptr, 0, nullptr);
        if (h) CloseHandle(h);
    }
    else if (reason == DLL_PROCESS_DETACH) {
        MH_DisableHook(MH_ALL_HOOKS);
        MH_Uninitialize();
        if (g_Log) { Log("[uninit] DLL detached."); fclose(g_Log); g_Log = nullptr; }
    }
    return TRUE;
}
