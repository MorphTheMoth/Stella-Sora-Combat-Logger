#include "tables.h"
#include "logging.h"
#include "json.hpp"

#include <windows.h>
#include <cstdio>
#include <cstdarg>
#include <algorithm>

using json = nlohmann::json;

// =============================================================================
//  GLOBAL DEFINITIONS
// =============================================================================
FILE*               g_Log    = nullptr;
std::mutex          g_Mutex;
LogConfig           g_Cfg;
std::atomic<int64_t> g_BattleTimeFP{0};

// =============================================================================
//  GAME TIME (requires g_BattleTimeFP)
// =============================================================================
static constexpr int64_t FP_ONE = 4294967296LL;

std::string GameTime() {
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
    snprintf(buf, sizeof(buf), "%02d:%02d.%03d", t.wMinute, t.wSecond, t.wMilliseconds);
    return buf;
}

// =============================================================================
//  LOGGING
// =============================================================================
void Log(const char* fmt, ...) {
    if (!g_Log) return;
    char buffer[2048];
    va_list args;
    va_start(args, fmt);
    std::vsnprintf(buffer, sizeof(buffer), fmt, args);
    va_end(args);
    if (std::strstr(buffer, "suppressed") != nullptr) return;
    std::string ts = GameTime();
    std::lock_guard<std::mutex> lk(g_Mutex);
    std::fprintf(g_Log, "[%s] %s\n", ts.c_str(), buffer);
    std::fflush(g_Log);
}

// =============================================================================
//  CONFIG LOADING
// =============================================================================
void LoadConfig(const std::string& dir) {
    std::string path = dir + "\\log_config.json";

    FILE* f = fopen(path.c_str(), "r");
    if (!f) {
        f = fopen(path.c_str(), "w");
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
            Log("[config] log_config.json not found — wrote defaults to %s", path.c_str());
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
            " on_atk=%d on_def=%d on_buffs=%d on_efx=%d on_efx_info=%d",
            g_Cfg.suppress_useless_info, g_Cfg.buffs, g_Cfg.effects, g_Cfg.damage, g_Cfg.skill_casts,
            g_Cfg.on_hit_attacker_stats, g_Cfg.on_hit_defender_stats,
            g_Cfg.on_hit_buff_list, g_Cfg.on_hit_effect_list, g_Cfg.on_hit_effect_list_information);
    } catch (...) {
        Log("[config] Failed to parse log_config.json — using defaults");
    }
}

// =============================================================================
//  Il2CppString helper
// =============================================================================
std::string Il2CppStringToStd(void* strObj) {
    if (!strObj) return "?";
    int32_t len = *reinterpret_cast<int32_t*>(reinterpret_cast<uintptr_t>(strObj) + 0x10);
    if (len <= 0 || len >= 1024) return "zero";
    char16_t* chars = reinterpret_cast<char16_t*>(reinterpret_cast<uintptr_t>(strObj) + 0x14);
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
char* adventureActorLog(void* actor) {
    if (!actor) {
        char* s = new char[8];
        strcpy(s, "null");
        return s;
    }
    uintptr_t base = reinterpret_cast<uintptr_t>(actor);
    static constexpr uintptr_t ACTOR_FIELDS = 0x18;

    int64_t entityId    = *reinterpret_cast<int64_t*>(base + 0x48);
    int32_t dataId      = *reinterpret_cast<int32_t*>(base + ACTOR_FIELDS + 0x140);
    int32_t skinId      = *reinterpret_cast<int32_t*>(base + ACTOR_FIELDS + 0x154);

    bool isBelongToPlayer = false;
    void* attrList = *reinterpret_cast<void**>(base + ACTOR_FIELDS + 0x080);
    if (attrList)
        isBelongToPlayer = *reinterpret_cast<bool*>(reinterpret_cast<uintptr_t>(attrList) + 0x28);
    const std::string& ownerName = ActorDisplayName(isBelongToPlayer ? dataId : skinId);

    char* logStr = new char[256];
    if (isBelongToPlayer)
        sprintf(logStr, "[%s]", ownerName.c_str());
    else
        sprintf(logStr, "%s (dataId=%d  skinId=%d  isPlayer=%d)",
                ownerName.c_str(), dataId, skinId, (int)isBelongToPlayer);
    return logStr;
}

void logAdventureActorAttrs(void* actor) {
    uintptr_t base = reinterpret_cast<uintptr_t>(actor);
    static constexpr uintptr_t ACTOR_FIELDS = 0x18;

    int64_t entityId = *reinterpret_cast<int64_t*>(base + 0x48);
    void* attrList   = *reinterpret_cast<void**>(base + ACTOR_FIELDS + 0x080);

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

void logAdventureActorSpecialAttrs(void* actor) {
    uintptr_t base = reinterpret_cast<uintptr_t>(actor);
    static constexpr uintptr_t ACTOR_FIELDS = 0x18;

    int64_t entityId      = *reinterpret_cast<int64_t*>(base + 0x48);
    void* specialAttrList = *reinterpret_cast<void**>(base + ACTOR_FIELDS + 0x088);

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
    static constexpr uintptr_t ENTRY_STRIDE = 0x0C;
    for (int i = 0; i < count && i < 64; ++i) {
        uintptr_t entry  = data + i * ENTRY_STRIDE;
        double  current  = *reinterpret_cast<double*>(entry + 0x00);
        int32_t max_type = *reinterpret_cast<int32_t*>(entry + 0x08);
        auto nearZero = [](double v) { return v > -1e-7 && v < 1e-7; };
        if (nearZero(current) && max_type == 0) continue;
        Log("[sattr] entityId=%lld  [%d] %-24s  current=%.4f  max_type=%d",
            entityId, i, AttrName(i), current, max_type);
    }
}

char* buffIdToName(int32_t configId) {
    char* buf = new char[256];
    if (configId > 100000000 && !g_Cfg.suppress_useless_info) {
        sprintf(buf, "configId=%d  (suppressed for length(enemy))", configId);
        return buf;
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
        else if (!g_Cfg.suppress_useless_info)
            sprintf(buf, "? / ?, configId=%d  (suppressed)", configId);
        else
            sprintf(buf, "suppressed");
    }
    return buf;
}

void logBuff(const char* type, int32_t configId, void* owner, int isAdd) {
    char* ownerLog = adventureActorLog(owner);
    char* ret = new char[256];
    if (configId > 100000000) {
        if (!g_Cfg.suppress_useless_info) {
            sprintf(ret, "[%s%s] %s \t\tconfigId=%d]  (suppressed for length(enemy))", type, isAdd>0?"+":"-", ownerLog, configId);
            Log("%s", ret);
        }
    } else {
        auto eit = g_EffectTable.find(configId);
        if (eit != g_EffectTable.end()) {
            const EffectInfo& ei = eit->second;
            if (ei.charName != "?")
                sprintf(ret, "[%s%s] %s \t\tbuff=%s/%s", type, isAdd>0?"+":"-", ownerLog, ei.charName.c_str(), ei.label.c_str());
            else
                sprintf(ret, "[%s%s] %s \t\tbuff=%s  (configId=%d)", type, isAdd>0?"+":"-", ownerLog, ei.label.c_str(), configId);
        } else {
            if (!g_SuppressedEffects.count(configId))
                sprintf(ret, "[%s%s] %s \t\tconfigId=%d  (unknown)", type, isAdd>0?"+":"-", ownerLog, configId);
            else if (!g_Cfg.suppress_useless_info)
                sprintf(ret, "[%s%s] %s \t\tconfigId=%d  (suppressed)", type, isAdd>0?"+":"-", ownerLog, configId);
            else
                sprintf(ret, "suppressed");
        }
        Log("%s", ret);
    }
    delete[] ret;
    delete[] ownerLog;
}

void LogActorBuffCom(void* fromActor) {
    uintptr_t actorBase = reinterpret_cast<uintptr_t>(fromActor);
    static constexpr uintptr_t ACTOR_FIELDS = 0x18;
    void* buffCom = *reinterpret_cast<void**>(actorBase + ACTOR_FIELDS + 0xE0);
    if (!buffCom) {
        Log("[calcN] buffCom: null");
        return;
    }
    uintptr_t bc = reinterpret_cast<uintptr_t>(buffCom) + 0x18;

    void*   buffList        = *reinterpret_cast<void**>(bc + 0x10);
    void*   firstIdBuffs    = *reinterpret_cast<void**>(bc + 0x20);
    void*   owner           = *reinterpret_cast<void**>(bc + 0x28);
    int32_t tokenIndex      = *reinterpret_cast<int32_t*>(bc + 0x40);
    void*   immunityIds     = *reinterpret_cast<void**>(bc + 0x50);
    void*   immunityGroupIds= *reinterpret_cast<void**>(bc + 0x58);
    void*   immunityTags    = *reinterpret_cast<void**>(bc + 0x60);
    int32_t reduceCountA    = *reinterpret_cast<int32_t*>(bc + 0x70);
    int32_t reduceTimeCount = *reinterpret_cast<int32_t*>(bc + 0x74);
    void*   buffTags        = *reinterpret_cast<void**>(bc + 0x78);

    Log("[calcN] buffCom: tokenIndex=%d  reduceCountA=%d  reduceTimeCount=%d",
        tokenIndex, reduceCountA, reduceTimeCount);
    Log("[calcN] buffCom: firstIdBuffs=%p  immunityIds=%p  immunityGroupIds=%p  immunityTags=%p  buffTags=%p",
        firstIdBuffs, immunityIds, immunityGroupIds, immunityTags, buffTags);
    Log("[calcN] buffCom: owner=%s", adventureActorLog(owner));

    if (buffList) {
        uintptr_t bl = reinterpret_cast<uintptr_t>(buffList);
        void*    itemsArray = *reinterpret_cast<void**>(bl + 0x10);
        int32_t  count      = *reinterpret_cast<int32_t*>(bl + 0x18);
        Log("[calcN] buffs: count=%d", count);

        if (itemsArray && count > 0) {
            uintptr_t items = reinterpret_cast<uintptr_t>(itemsArray) + 0x20;
            for (int i = 0; i < count && i < 32; ++i) {
                void* buffEntity = *reinterpret_cast<void**>(items + i * 0x8);
                if (!buffEntity) continue;
                uintptr_t be = reinterpret_cast<uintptr_t>(buffEntity) + 0x10;
                void*   buffConfig  = *reinterpret_cast<void**>(be + 0x28);
                int32_t buffNum     = *reinterpret_cast<int32_t*>(be + 0x40);
                int32_t exceptNum   = *reinterpret_cast<int32_t*>(be + 0x50);
                bool    isNew       = *reinterpret_cast<bool*>(be + 0x68);
                bool    removed     = *reinterpret_cast<bool*>(be + 0x69);
                int64_t configBuffTimeRaw = *reinterpret_cast<int64_t*>(be + 0x10);
                int64_t buffLeftTimeRaw   = *reinterpret_cast<int64_t*>(be + 0x18);
                double  configBuffTime    = (double)configBuffTimeRaw / 4294967296.0;
                double  buffLeftTime      = (double)buffLeftTimeRaw   / 4294967296.0;
                int32_t configId = 0;
                if (buffConfig)
                    configId = *reinterpret_cast<int32_t*>(reinterpret_cast<uintptr_t>(buffConfig) + 0x18);
                char flags[128] = "";
                int offset = 0;
                if (exceptNum != 0) offset += sprintf(flags+offset, "  exceptNum=%d", exceptNum);
                if (isNew)         offset += sprintf(flags+offset, "  isNew=1");
                if (removed)       offset += sprintf(flags+offset, "  removed=1");
                Log("[calcN] buff [%2d]: %-35s stacks=%2d  totalTime=%.2f  leftTime=%.2f%s",
                    i, buffIdToName(configId), buffNum, configBuffTime, buffLeftTime, flags);
            }
        }
    }
}

// =============================================================================
//  Extended logging helpers (used in Hook_CalcNormalDamage)
// =============================================================================
void LogHitDamageConfig(void* hitDamageConfig) {
    if (!hitDamageConfig) return;
    uintptr_t hdc = reinterpret_cast<uintptr_t>(hitDamageConfig) + 0x10;
    int32_t hitDamageId      = *reinterpret_cast<int32_t*>(hdc + 0x08);
    int32_t levelTypeData_   = *reinterpret_cast<int32_t*>(hdc + 0x0C);
    int32_t levelData_       = *reinterpret_cast<int32_t*>(hdc + 0x10);
    int32_t mainOrSupport_   = *reinterpret_cast<int32_t*>(hdc + 0x14);
    void*   hitdamageInfo_   = *reinterpret_cast<void**>(hdc + 0x18);
    int32_t distanceType_    = *reinterpret_cast<int32_t*>(hdc + 0x20);
    int32_t sourceType_      = *reinterpret_cast<int32_t*>(hdc + 0x24);
    int32_t damageType_      = *reinterpret_cast<int32_t*>(hdc + 0x28);
    int32_t effectType_      = *reinterpret_cast<int32_t*>(hdc + 0x2C);
    int32_t elementType_     = *reinterpret_cast<int32_t*>(hdc + 0x30);
    int32_t damageBonusType_ = *reinterpret_cast<int32_t*>(hdc + 0x40);
    int32_t additionalSource_= *reinterpret_cast<int32_t*>(hdc + 0x58);
    int32_t additionalType_  = *reinterpret_cast<int32_t*>(hdc + 0x5C);
    int32_t energyCharge_    = *reinterpret_cast<int32_t*>(hdc + 0x68);
    bool    isDenseType_     = *reinterpret_cast<bool*>(hdc + 0x80);
    int32_t skillId_         = *reinterpret_cast<int32_t*>(hdc + 0x90);
    int32_t skillSlotType_   = *reinterpret_cast<int32_t*>(hdc + 0x94);
    int32_t perkId_          = *reinterpret_cast<int32_t*>(hdc + 0x98);
    int32_t hitImmunityTime_ = *reinterpret_cast<int32_t*>(hdc + 0x9C);
    std::string hitInfo      = Il2CppStringToStd(hitdamageInfo_);

    Log("[calcN] hitDmgCfg: id=%d  levelType=%d  levelData=%d  mainOrSupport=%d  info=%s",
        hitDamageId, levelTypeData_, levelData_, mainOrSupport_, hitInfo.c_str());
    Log("[calcN] hitDmgCfg: distType=%d  srcType=%d  dmgType=%d  effType=%d  elemType=%d  dmgBonusType=%d  isDense=%d",
        distanceType_, sourceType_, damageType_, effectType_, elementType_, damageBonusType_, (int)isDenseType_);
    Log("[calcN] hitDmgCfg: addSrc=%d  addType=%d  energyCharge=%d  skillId=%d  slotType=%d  perkId=%d  hitImmunity=%d",
        additionalSource_, additionalType_, energyCharge_, skillId_, skillSlotType_, perkId_, hitImmunityTime_);
}

static void LogSingleEffect(int logged, uintptr_t ef, bool verbose) {
    int32_t  id               = *reinterpret_cast<int32_t*>(ef + 0x00);
    int32_t  sourceType       = *reinterpret_cast<int32_t*>(ef + 0x04);
    int32_t  effectType       = *reinterpret_cast<int32_t*>(ef + 0x08);
    bool     shareCD          = *reinterpret_cast<bool*>(ef + 0x38);
    bool     shareTakeLimit   = *reinterpret_cast<bool*>(ef + 0x39);
    int32_t  takeEffectLimit  = *reinterpret_cast<int32_t*>(ef + 0x3C);
    bool     isNeedPostExec   = *reinterpret_cast<bool*>(ef + 0x50);
    bool     removed          = *reinterpret_cast<bool*>(ef + 0x70);
    void*    owner            = *reinterpret_cast<void**>(ef + 0x78);
    void*    fromActor_       = *reinterpret_cast<void**>(ef + 0x80);
    void*    fromWeapon       = *reinterpret_cast<void**>(ef + 0x88);
    void*    fromBuffEntity   = *reinterpret_cast<void**>(ef + 0x90);
    int64_t  damage           = *reinterpret_cast<int64_t*>(ef + 0xA0);

    double cd              = (double)*reinterpret_cast<int64_t*>(ef + 0x58) / 4294967296.0;
    double orginMaxCd      = (double)*reinterpret_cast<int64_t*>(ef + 0x60) / 4294967296.0;
    double maxCd           = (double)*reinterpret_cast<int64_t*>(ef + 0x68) / 4294967296.0;
    double nextTriggerTime = (double)*reinterpret_cast<int64_t*>(ef + 0x98) / 4294967296.0;

    Log("[calcN] effect [%2d]: srcType=%d  effType=%d  removed=%d", logged, sourceType, effectType, (int)removed);
    Log("[calcN] effect [%2d]: cd=%.3f  orginMaxCd=%.3f  maxCd=%.3f  nextTrigger=%.3f  damage=%lld",
        logged, cd, orginMaxCd, maxCd, nextTriggerTime, (long long)damage);
    Log("[calcN] effect [%2d]: takeLimit=%d  shareCD=%d  shareTakeLimit=%d  needPostExec=%d  owner=%s  fromActor=%s  fromWeapon=%p  fromBuff=%p",
        logged, takeEffectLimit, (int)shareCD, (int)shareTakeLimit, (int)isNeedPostExec,
        adventureActorLog(owner), adventureActorLog(fromActor_), fromWeapon, fromBuffEntity);

    if (!verbose) return;
    // verbose logging of effect config and value config
    void* effectConfig = *reinterpret_cast<void**>(ef + 0x10);
    if (effectConfig) {
        uintptr_t ec = reinterpret_cast<uintptr_t>(effectConfig) + 0x10;
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
            logged, cfg_tParam1.c_str(), cfg_tParam2.c_str(), cfg_tParam3.c_str(), cfg_tParam4.c_str(),
            cfg_t2Param1.c_str(), cfg_t2Param2.c_str(), cfg_t2Param3.c_str(), cfg_t2Param4.c_str());
        Log("[calcN] effect [%2d] cfg: teTarget1=%d  teCond1=%d  teTarget2=%d  teCond2=%d  teLogic=%d",
            logged, cfg_teTarget1, cfg_teCond1, cfg_teTarget2, cfg_teCond2, cfg_teLogicType);
        Log("[calcN] effect [%2d] cfg: teParams=[%s|%s|%s|%s]  te2Params=[%s|%s|%s|%s]",
            logged, cfg_teParam1.c_str(), cfg_teParam2.c_str(), cfg_teParam3.c_str(), cfg_teParam4.c_str(),
            cfg_te2Param1.c_str(), cfg_te2Param2.c_str(), cfg_te2Param3.c_str(), cfg_te2Param4.c_str());
        Log("[calcN] effect [%2d] cfg: target1=%d  targetCond1=%d  targetCond2=%d  filterLogic=%d",
            logged, cfg_target1, cfg_targetCond1, cfg_targetCond2, cfg_filterLogicType);
        Log("[calcN] effect [%2d] cfg: tgtParams=[%s|%s|%s|%s]  tgt2Params=[%s|%s|%s|%s]",
            logged, cfg_tgtParam1.c_str(), cfg_tgtParam2.c_str(), cfg_tgtParam3.c_str(), cfg_tgtParam4.c_str(),
            cfg_tgt2Param1.c_str(), cfg_tgt2Param2.c_str(), cfg_tgt2Param3.c_str(), cfg_tgt2Param4.c_str());

        // value config
        void* effectValueConfig = *reinterpret_cast<void**>(ef + 0x18);
        if (effectValueConfig) {
            uintptr_t ev = reinterpret_cast<uintptr_t>(effectValueConfig) + 0x10;
            int32_t ev_id                  = *reinterpret_cast<int32_t*>(ev + 0x08);
            int32_t ev_takeEffectLimit     = *reinterpret_cast<int32_t*>(ev + 0x20);
            bool    ev_remove              = *reinterpret_cast<bool*>(ev + 0x24);
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
    }
}

void LogEffectManage(void* effectManage, bool logList, bool logDetails) {
    if (!effectManage) {
        if (logList) Log("[calcN] effectManage: null");
        return;
    }
    uintptr_t em = reinterpret_cast<uintptr_t>(effectManage) + 0x18;
    int32_t uniqueEffectId      = *reinterpret_cast<int32_t*>(em + 0x18);
    void*   effectsDict         = *reinterpret_cast<void**>(em + 0x20);
    void*   timeTriggerEffects  = *reinterpret_cast<void**>(em + 0x28);
    void*   delayRemovedIds     = *reinterpret_cast<void**>(em + 0x30);
    int32_t beingProcessedRC    = *reinterpret_cast<int32_t*>(em + 0x38);
    void*   delayAddedDict      = *reinterpret_cast<void**>(em + 0x40);
    void*   onceAttackIds       = *reinterpret_cast<void**>(em + 0x48);
    void*   changeEffectIdList  = *reinterpret_cast<void**>(em + 0x50);
    void*   addEffectInfoList   = *reinterpret_cast<void**>(em + 0x58);
    void*   removeEffectIds     = *reinterpret_cast<void**>(em + 0x60);
    void*   changeBuffTimeInfos = *reinterpret_cast<void**>(em + 0x68);
    void*   changeLaminatedInfos= *reinterpret_cast<void**>(em + 0x70);

    if (logList) {
        Log("[calcN] effectMgr: uniqueEffectId=%d  beingProcessedRC=%d", uniqueEffectId, beingProcessedRC);
        Log("[calcN] effectMgr: timeTrigger=%p  delayRemovedIds=%p  delayAddedDict=%p  onceAttackIds=%p",
            timeTriggerEffects, delayRemovedIds, delayAddedDict, onceAttackIds);
        Log("[calcN] effectMgr: changeEffectIdList=%p  addEffectInfoList=%p  removeEffectIds=%p  changeBuffTimeInfos=%p  changeLaminatedInfos=%p",
            changeEffectIdList, addEffectInfoList, removeEffectIds, changeBuffTimeInfos, changeLaminatedInfos);
    }

    if (logList && effectsDict) {
        uintptr_t d         = reinterpret_cast<uintptr_t>(effectsDict) + 0x10;
        void*    entriesArr = *reinterpret_cast<void**>(d + 0x08);
        int32_t  slotCount  = *reinterpret_cast<int32_t*>(d + 0x10);
        int32_t  freeCount  = *reinterpret_cast<int32_t*>(d + 0x1C);
        int32_t  liveCount  = slotCount - freeCount;
        Log("[calcN] effectsDict: liveCount=%d  slots=%d", liveCount, slotCount);

        if (entriesArr && slotCount > 0) {
            uintptr_t entries = reinterpret_cast<uintptr_t>(entriesArr) + 0x20;
            int logged = 0;
            for (int i = 0; i < slotCount && logged < 32; ++i) {
                uintptr_t entry  = entries + i * 0x18;
                int32_t hashCode = *reinterpret_cast<int32_t*>(entry + 0x00);
                if (hashCode < 0) continue;
                int32_t effectKey = *reinterpret_cast<int32_t*>(entry + 0x08);
                void*   effectPtr = *reinterpret_cast<void**>(entry + 0x10);
                if (effectPtr) {
                    uintptr_t ef = reinterpret_cast<uintptr_t>(effectPtr) + 0x10;
                    Log("[calcN] effect [%2d]: key=%-6d  id=%-6d", logged, effectKey, *reinterpret_cast<int32_t*>(ef));
                    LogSingleEffect(logged, ef, logDetails);
                } else {
                    Log("[calcN] effect [%2d]: key=%-6d  ptr=null", logged, effectKey);
                }
                ++logged;
            }
        }
    } else if (logList) {
        Log("[calcN] effectsDict: null");
    }

    // time trigger effects
    if (logList && timeTriggerEffects) {
        uintptr_t tl       = reinterpret_cast<uintptr_t>(timeTriggerEffects);
        void*    itemsArr  = *reinterpret_cast<void**>(tl + 0x10);
        int32_t  count     = *reinterpret_cast<int32_t*>(tl + 0x18);
        Log("[calcN] timeTriggerEffects: count=%d", count);
        if (itemsArr && count > 0) {
            uintptr_t items = reinterpret_cast<uintptr_t>(itemsArr) + 0x20;
            for (int i = 0; i < count && i < 32; ++i) {
                void* effectPtr = *reinterpret_cast<void**>(items + i * 0x8);
                Log("[calcN] timeTriggerEffect [%2d]: ptr=%p", i, effectPtr);
            }
        }
    }

    // once attack ids
    if (logList && onceAttackIds) {
        uintptr_t ol      = reinterpret_cast<uintptr_t>(onceAttackIds);
        void*    itemsArr = *reinterpret_cast<void**>(ol + 0x10);
        int32_t  count    = *reinterpret_cast<int32_t*>(ol + 0x18);
        Log("[calcN] onceAttackEffectIds: count=%d", count);
        if (itemsArr && count > 0) {
            uintptr_t items = reinterpret_cast<uintptr_t>(itemsArr) + 0x20;
            for (int i = 0; i < count && i < 32; ++i) {
                int32_t uid = *reinterpret_cast<int32_t*>(items + i * 0x4);
                Log("[calcN] onceAttackEffect [%2d]: uniqueAttackId=%d", i, uid);
            }
        }
    } else if (logList) {
        Log("[calcN] onceAttackEffectIds: null");
    }
}
