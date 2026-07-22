#pragma once

#include <cstdint>
#include <cstdio>
#include <mutex>
#include <atomic>
#include <string>
#include <unordered_set>
#include <unordered_map>
#include <vector>

#include "json.hpp"
#include "game_structs.h"

using json = nlohmann::json;

// Forward declarations – actual definitions are in game_structs.h
struct AdventureActor_o;
struct ActorEffectManage_o;
struct Nova_Client_HitDamage_o;
struct Nova_Client_EffectValue_o;
struct Nova_Client_OnceAdditionalAttributeValue_o;
struct AttributeList_o;
struct GameDataController_o;
struct Nova_Client_OnceAdditionalAttribute_o;
struct System_Collections_Generic_Dictionary_int__int__o;
struct ActorAdditionalAttrInfo_o;

// Function pointer types shared between proxy.cpp and logging.cpp
using FnGetOnceAttr                      = Nova_Client_OnceAdditionalAttribute_o* (__fastcall*)(GameDataController_o*, int32_t, void*);
using FnGetValueConfigId                 = int32_t                                (__fastcall*)(AdventureActor_o*, int32_t, int32_t, int32_t, void*);
using FnGetEffectValue                   = Nova_Client_EffectValue_o*             (__fastcall*)(GameDataController_o*, int32_t, void*);
using FnGetOnceAdditionalAttributeValue  = Nova_Client_OnceAdditionalAttributeValue_o* (__fastcall*)(GameDataController_o*, int32_t, void*);

struct LogConfig {
    bool buffs;
    bool effects;
    bool damage;
    bool skill_casts;
    bool on_hit_attacker_stats;
    bool on_hit_defender_stats;
    bool on_hit_buff_list;
    bool on_hit_effect_list;
    bool on_hit_effect_list_information;
    bool on_hit_attacker_attr_dict;
    bool on_hit_defender_attr_dict;
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
    bool monster_dummy_mode;
};

extern FILE*                g_Log;
extern FILE*                g_JsonLog;
extern std::mutex           g_Mutex;
extern LogConfig            g_Cfg;
extern std::atomic<int64_t>            g_CombatStartTimeFP;
extern std::atomic<int64_t>            g_GameTimeFP;

// Basic logging
void log(const char* fmt, ...);
void logJson(const json& j);
std::string gameTime();
void loadConfig(const std::string& dir);

// String helpers
std::string Il2CppStringToStd(System_String_o* strObj);
const char* AttrName(int i);

// Actor logging
std::string adventureActorId(AdventureActor_o* actor);
std::string adventureActorDisplay(AdventureActor_o* actor);
struct ElemDictEntry { int32_t attributeType; int32_t elementOrDamageType; bool isElementType; int32_t mode; double value; };
json logAdventureActorAttrsJson(AttributeList_o* attrList, const std::vector<ElemDictEntry>* overlay = nullptr);
json logAdventureActorSpecialAttrsJson(AdventureActor_o* actor);

// Effect snapshot: a set of effect instance IDs captured at snapshot time
using EffectSnapshot = std::unordered_set<int32_t>;

// Timed snapshot stored for weapon/area hits
struct SnapshotEntry {
    EffectSnapshot ids;
    std::string gameTime;
};

// Per-effect snapshot data stored at effect init / execute time
struct InstanceSnapInfo {
    int32_t configId;
    int32_t levelTypeData;
    int32_t levelData;
    int32_t sourceType;
    int32_t valueConfigId;
    int64_t damage;
    std::string ownerId;
    std::string fromActorId;
};
void StoreInstanceSnapInfo(int32_t instanceId, const InstanceSnapInfo& info);
bool GetInstanceSnapInfo(int32_t instanceId, const std::string& actorId, InstanceSnapInfo& out);
void TrackInstanceConfig(int32_t instanceId, int32_t configId);
int32_t GetConfigForInstance(int32_t instanceId);
extern int32_t g_CurrentDamageTypeTemp;  // set before BuildHitJson

// Player effect snapshot for minion inherited effects
struct PlayerEffectEntry {
    int32_t instanceId;
    int32_t configId;
    int32_t valueConfigId;
    int32_t sourceType;
    int64_t damage;
    int32_t attributeType;
    int32_t parameterType;
    double baseStatOnSnapshot;
    double pctStatOnSnapshot;
    std::string ownerId;
};
struct PlayerEffectSnapshot {
    std::vector<PlayerEffectEntry> entries;
    std::vector<double> pctValues;
    std::vector<double> baseValues;
    std::string time;
};
struct MinionLink {
    std::string playerId;
    int32_t summonAttrType;
};
extern std::mutex g_PlayerSnapshotMutex;
extern std::unordered_map<std::string, PlayerEffectSnapshot> g_PlayerSnapshots;
extern std::mutex g_MinionLinkMutex;
extern std::unordered_map<std::string, MinionLink> g_MinionToPlayer;
// JSON builders for different event types
void BuildBuffJson(const char* type, int32_t configId, AdventureActor_o* owner, AdventureActor_o* fromActor, int isAdd, int32_t buffNum = 0);
json BuildBuffListJson(AdventureActor_o* fromActor);
json BuildEffectListJson(ActorEffectManage_o* effectManage, bool includeDetails,
                          GameDataController_o* gdc = nullptr,
                          FnGetEffectValue GetEffectValue = nullptr,
                          FnGetOnceAttr GetOnceAttr = nullptr,
                          FnGetValueConfigId GetValueConfigId = nullptr,
                          FnGetOnceAdditionalAttributeValue GetAttrValue = nullptr,
                          AdventureActor_o* resolveActor = nullptr,
                          const EffectSnapshot* effectSnapshot = nullptr);
json BuildAdditionalAttrDictJson(
    System_Collections_Generic_Dictionary_int__int__o* dict,
    AdventureActor_o*     fromActor,
    GameDataController_o* gdc,
    FnGetOnceAttr         GetOnceAttr,
    FnGetValueConfigId    GetValueConfigId,
    FnGetOnceAdditionalAttributeValue GetAttrValue = nullptr);
void BuildHitJson(
    AdventureActor_o* fromActor, AdventureActor_o* toActor, Nova_Client_HitDamage_o* hitDamageConfig,
    int32_t skillLevel, bool isCrit, bool isDot,
    int32_t* hudColorIndex, int64_t* skillPercentAmend,
    int64_t* talentGroupPercentAmend, int64_t* skillAbsAmend,
    int64_t* talentGroupAbsAmend, int64_t* perkIntensityRatio,
    int64_t* slotDmgRatio, int64_t* fromEE, int64_t* erAmend,
    int64_t* defAmend, int64_t* rcdSlotDmgRatio, int64_t* toEERCD,
    int64_t* skillIntensityRatio, int64_t* toughnessBrokenDmgRatio,
    int64_t* critRatio, int64_t* envAmendRatio,
    int64_t finalDamage,
    AttributeList_o* attackerInfo, AttributeList_o* defenderInfo,
    ActorAdditionalAttrInfo_o* fromAdditionalAttrInfo,
    ActorAdditionalAttrInfo_o* toAdditionalAttrInfo,
    System_Collections_Generic_Dictionary_int__int__o* fromAttrDict,
    System_Collections_Generic_Dictionary_int__int__o* toAttrDict,
    GameDataController_o* gdc,
    FnGetOnceAttr GetOnceAttr, FnGetValueConfigId GetValueConfigId,
    FnGetEffectValue GetEffectValue = nullptr,
    FnGetOnceAdditionalAttributeValue GetAttrValue = nullptr,
    const EffectSnapshot* effectSnapshot = nullptr,
    const std::string* snapshotTime = nullptr);
void BuildSkillCastJson(int32_t skillId);
void BuildResetJson();

// Utility
std::string GetLocalAppDataPath();
void InitializeLogger();

bool InstallHook(uintptr_t target, void* hook, void** original, const char* name);

bool EnableAllDebugGizmos(uintptr_t moduleBase);

struct DictEntry_Int_Int_L {
    int32_t hashCode;
    int32_t next;
    int32_t key;
    int32_t value;
};
struct DictEntryArray_Int_Int_L {
    Il2CppObject            obj;
    Il2CppArrayBounds*      bounds;
    il2cpp_array_size_t     max_length;
    DictEntry_Int_Int_L     m_Items[1]; // flexible
};
