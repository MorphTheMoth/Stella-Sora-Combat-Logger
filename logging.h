#pragma once

#include <cstdint>
#include <cstdio>
#include <mutex>
#include <atomic>
#include <string>
#include <unordered_set>
#include <vector>
#include "json.hpp"

using json = nlohmann::json;

// Forward declarations – actual definitions are in game_structs.h
struct AdventureActor_o;
struct ActorEffectManage_o;
struct Nova_Client_HitDamage_o;

struct LogConfig {
    bool suppress_useless_info          = true;
    bool buffs                          = true;
    bool effects                        = true;
    bool damage                         = true;
    bool skill_casts                    = true;
    bool on_hit_attacker_stats          = true;
    bool on_hit_defender_stats          = true;
    bool on_hit_buff_list               = true;
    bool on_hit_effect_list             = true;
    bool on_hit_effect_list_information = true;
};

extern FILE*                g_Log;
extern FILE*                g_JsonLog;
extern std::mutex           g_Mutex;
extern LogConfig            g_Cfg;
extern std::atomic<int64_t> g_BattleTimeFP;
extern std::unordered_set<int32_t> g_SuppressedEffects;

// Basic logging
void Log(const char* fmt, ...);
void LogJson(const json& j);
std::string GameTime();
void LoadConfig(const std::string& dir);

// String helpers
std::string Il2CppStringToStd(void* strObj);
const char* AttrName(int i);

// Actor logging
std::string adventureActorId(AdventureActor_o* actor);
std::string adventureActorDisplay(AdventureActor_o* actor);
json logAdventureActorAttrsJson(AdventureActor_o* actor);
json logAdventureActorSpecialAttrsJson(AdventureActor_o* actor);
std::string buffIdToName(int32_t configId);

// JSON builders for different event types
json BuildBuffJson(const char* type, int32_t configId, AdventureActor_o* owner, AdventureActor_o* fromActor, int isAdd, int32_t buffNum = 0);
json BuildBuffListJson(AdventureActor_o* fromActor);
json BuildEffectListJson(ActorEffectManage_o* effectManage, bool includeDetails);
json BuildHitJson(AdventureActor_o* fromActor, AdventureActor_o* toActor, Nova_Client_HitDamage_o* hitDamageConfig, 
                  int32_t skillLevel, bool isCrit, bool isDot,
                  int32_t* hudColorIndex, double* skillPercentAmend,
                  double* talentGroupPercentAmend, double* skillAbsAmend,
                  double* talentGroupAbsAmend, double* perkIntensityRatio,
                  double* slotDmgRatio, double* fromEE, double* erAmend,
                  double* defAmend, double* rcdSlotDmgRatio, double* toEERCD,
                  double* skillIntensityRatio, double* toughnessBrokenDmgRatio,
                  double* critRatio, double* envAmendRatio,
                  int64_t finalDamage);
json BuildSkillCastJson(int32_t skillId);

// Utility
std::string GetLocalAppDataPath();
void InitializeLogger();

bool InstallHook(uintptr_t target, void* hook, void** original, const char* name);
