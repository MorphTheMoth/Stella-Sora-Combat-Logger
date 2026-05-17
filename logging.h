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
    bool suppress_useless_info;
    bool buffs;
    bool effects;
    bool damage;
    bool skill_casts;
    bool on_hit_attacker_stats;
    bool on_hit_defender_stats;
    bool on_hit_buff_list;
    bool on_hit_effect_list;
    bool on_hit_effect_list_information;
    bool player_gizmo;
    bool monster_gizmo;
    bool bullet_gizmo;
    bool hitbox_gizmo;
    bool hearing_gizmo_for_player;
    bool hearing_gizmo_for_monster;
    bool vision_gizmo_for_player;
    bool vision_gizmo_for_monster;
    bool input_and_vision_gizmo;
    bool monster_path_gizmo;
    bool player_path_gizmo;
    bool camera_gizmo;
};

extern FILE*                g_Log;
extern FILE*                g_JsonLog;
extern std::mutex           g_Mutex;
extern LogConfig            g_Cfg;
extern std::atomic<int64_t> g_BattleTimeFP;
extern std::unordered_set<int32_t> g_SuppressedEffects;

// Basic logging
void log(const char* fmt, ...);
void logJson(const json& j);
std::string gameTime();
void loadConfig(const std::string& dir);

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

bool EnableAllDebugGizmos();
