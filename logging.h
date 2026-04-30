#pragma once

#include <cstdint>
#include <cstdio>
#include <mutex>
#include <atomic>
#include <string>

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

// The global variables referencing tables.h are already declared there,
// so we only need to declare what we define in logging.cpp
extern FILE*               g_Log;
extern std::mutex          g_Mutex;
extern LogConfig           g_Cfg;
extern std::atomic<int64_t> g_BattleTimeFP;

// Basic logging
void Log(const char* fmt, ...);
std::string GameTime();
void LoadConfig(const std::string& dir);

// String helpers
std::string Il2CppStringToStd(void* strObj);
const char* AttrName(int i);

// Actor logging
char* adventureActorLog(void* actor);
void logAdventureActorAttrs(void* actor);
void logAdventureActorSpecialAttrs(void* actor);
char* buffIdToName(int32_t configId);

// Buff/effect logging
void LogActorBuffCom(void* fromActor);
void logBuff(const char* type, int32_t configId, void* owner, int isAdd);

// Extended logging for combat details
void LogHitDamageConfig(void* hitDamageConfig);
void LogEffectManage(void* effectManage, bool logList, bool logDetails);
