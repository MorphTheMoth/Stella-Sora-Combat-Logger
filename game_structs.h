#pragma once

#ifndef _MSC_VER
    #pragma push_macro("align")
    #undef align
    #define __declspec(x) __attribute__((x))
    #define align(n)      aligned(n)
#endif

#include <cstdint>

typedef void(*Il2CppMethodPointer)();
typedef uintptr_t il2cpp_array_size_t;
typedef int32_t il2cpp_array_lower_bound_t;

// Definitions
struct Il2CppClass;
struct MethodInfo;

struct Il2CppType
{
    void* data;
    unsigned int bits;
};

struct Il2CppArrayBounds
{
    il2cpp_array_size_t length;
    il2cpp_array_lower_bound_t lower_bound;
};

struct Il2CppRuntimeInterfaceOffsetPair
{
    Il2CppClass* interfaceType;
    int32_t offset;
};

struct Il2CppClass_1
{
    void* image;
    void* gc_desc;
    const char* name;
    const char* namespaze;
    Il2CppType byval_arg;
    Il2CppType this_arg;
    Il2CppClass* element_class;
    Il2CppClass* castClass;
    Il2CppClass* declaringType;
    Il2CppClass* parent;
    void *generic_class;
    void* typeMetadataHandle;
    void* interopData;
    Il2CppClass* klass;
    void* fields;
    void* events;
    void* properties;
    void* methods;
    Il2CppClass** nestedTypes;
    Il2CppClass** implementedInterfaces;
    Il2CppRuntimeInterfaceOffsetPair* interfaceOffsets;
};

struct Il2CppClass_2
{
    Il2CppClass** typeHierarchy;
    void *unity_user_data;
    uint32_t initializationExceptionGCHandle;
    uint32_t cctor_started;
    uint32_t cctor_finished;
    size_t cctor_thread;
    void* genericContainerHandle;
    uint32_t instance_size;
    uint32_t actualSize;
    uint32_t element_size;
    int32_t native_size;
    uint32_t static_fields_size;
    uint32_t thread_static_fields_size;
    int32_t thread_static_fields_offset;
    uint32_t flags;
    uint32_t token;
    uint16_t method_count;
    uint16_t property_count;
    uint16_t field_count;
    uint16_t event_count;
    uint16_t nested_type_count;
    uint16_t vtable_count;
    uint16_t interfaces_count;
    uint16_t interface_offsets_count;
    uint8_t typeHierarchyDepth;
    uint8_t genericRecursionDepth;
    uint8_t rank;
    uint8_t minimumAlignment;
    uint8_t naturalAligment;
    uint8_t packingSize;
    uint8_t bitflags1;
    uint8_t bitflags2;
};

struct VirtualInvokeData
{
    Il2CppMethodPointer methodPtr;
    const MethodInfo* method;
};

union Il2CppRGCTXData
{
    void* rgctxDataDummy;
    const MethodInfo* method;
    const Il2CppType* type;
    Il2CppClass* klass;
};

struct Il2CppClass
{
    Il2CppClass_1 _1;
    void* static_fields;
    Il2CppRGCTXData* rgctx_data;
    Il2CppClass_2 _2;
    VirtualInvokeData vtable[255];
};

struct Il2CppObject
{
    Il2CppClass *klass;
    void *monitor;
};


// Definitions

struct UnityEngine_Vector2_Fields {
	float x;
	float y;
};

struct __declspec(align(8)) Nova_Client_BuffEffect_Fields {
	struct Google_Protobuf_UnknownFieldSet_o* _unknownFields;
	int32_t id_;
	struct System_String_o* name_;
	int32_t buffEffectType_;
	struct System_String_o* param1_;
	struct System_String_o* param2_;
	struct System_String_o* param3_;
	struct System_String_o* param4_;
	struct System_String_o* param5_;
};

struct __declspec(align(8)) AdventureEffectBase_Fields {
	struct AdventureEffect_o* _effect;
	struct System_Collections_Generic_List_AdventureActor__o* _targets;
	struct ExecuteEffectInfo_o* executeEffectInfo;
};

struct __declspec(align(8)) BuffEffectBase_Fields {
	struct BuffEntity_o* buffEntity;
	struct Nova_Client_BuffEffect_o* buffEffectConfig;
	struct AdventureActor_o* fromActor;
	struct AdventureActor_o* owner;
	struct UnityEngine_Coroutine_o* _coroutine;
	int32_t processCount;
	struct UnityEngine_WaitForSeconds_o* _waitForSeconds;
	int32_t _buffuid;
	int64_t period;
};

struct __declspec(align(8)) Nova_Client_HitDamage_Fields {
	struct Google_Protobuf_UnknownFieldSet_o* _unknownFields;
	int32_t id_;
	int32_t levelTypeData_;
	int32_t levelData_;
	int32_t mainOrSupport_;
	struct System_String_o* hitdamageInfo_;
	int32_t distanceType_;
	int32_t sourceType_;
	int32_t damageType_;
	int32_t effectType_;
	int32_t elementType_;
	struct Google_Protobuf_Collections_RepeatedField_int__o* damageTag_;
	int32_t damageBonusType_;
	struct Google_Protobuf_Collections_RepeatedField_int__o* skillPercentAmend_;
	struct Google_Protobuf_Collections_RepeatedField_int__o* skillAbsAmend_;
	int32_t additionalSource_;
	int32_t additionalType_;
	struct Google_Protobuf_Collections_RepeatedField_int__o* additionalPercent_;
	int32_t energyCharge_;
	struct Google_Protobuf_Collections_RepeatedField_int__o* talentPercentAmend_;
	struct Google_Protobuf_Collections_RepeatedField_int__o* talentAbsAmend_;
	bool isDenseType_;
	struct Google_Protobuf_Collections_RepeatedField_int__o* perkIntensity_;
	int32_t skillId_;
	int32_t skillSlotType_;
	int32_t perkId_;
	int32_t hitImmunityTime_;
};

struct __declspec(align(8)) IEvent_Fields {
};

struct __declspec(align(8)) AttributeList_Fields {
	struct AttributeList_ValueChangedHandle_o* ValueChangedEvent;
	struct AttributeEntry_array* entries;
	struct System_Collections_Generic_Dictionary_GameEnum_effectAttributeType__double__o* assignmentValueDict;
	bool isBelongToPlayer;
};

struct __declspec(align(8)) Nova_Client_Buff_Fields {
	struct Google_Protobuf_UnknownFieldSet_o* _unknownFields;
	int32_t id_;
	struct System_String_o* name_;
	int32_t levelTypeData_;
	int32_t levelData_;
	int32_t mainOrSupport_;
	int32_t groupId_;
	int32_t reduceTime_;
	int32_t buffTag1_;
	int32_t buffTag2_;
	int32_t buffTag3_;
	int32_t buffTag4_;
	int32_t buffTag5_;
	struct System_String_o* bindEffect_;
	struct System_String_o* icon_;
	bool isShow_;
	struct System_String_o* topofHeadEffect_;
	struct Google_Protobuf_Collections_RepeatedField_int__o* buffNumEffectLevel_;
	bool notRemove_;
	bool changeTeamNotRemove_;
};

struct ExtraLevelInfo_Fields {
	struct UnityEngine_Transform_o* actorRootNode;
	struct UnityEngine_Transform_o* weaponRootNode;
	struct UnityEngine_Transform_o* skillRootNode;
	struct UnityEngine_Transform_o* minimapRootNode;
	int32_t levelSuccessDelayKey;
	int32_t levelDefeatDelayKey;
	int32_t levelTeleporterDelayKey;
};

struct __declspec(align(8)) Nova_Client_Effect_Fields {
	struct Google_Protobuf_UnknownFieldSet_o* _unknownFields;
	int32_t id_;
	struct System_String_o* name_;
	int32_t levelTypeData_;
	int32_t levelData_;
	int32_t mainOrSupport_;
	int32_t trigger_;
	int32_t triggerTarget_;
	int32_t triggerCondition1_;
	struct System_String_o* triggerParam1_;
	struct System_String_o* triggerParam2_;
	struct System_String_o* triggerParam3_;
	struct System_String_o* triggerParam4_;
	int32_t triggerTarget2_;
	int32_t triggerCondition2_;
	struct System_String_o* trigger2Param1_;
	struct System_String_o* trigger2Param2_;
	struct System_String_o* trigger2Param3_;
	struct System_String_o* trigger2Param4_;
	int32_t triggerLogicType_;
	int32_t takeEffectTarget1_;
	int32_t takeEffectCondition1_;
	struct System_String_o* takeEffectParam1_;
	struct System_String_o* takeEffectParam2_;
	struct System_String_o* takeEffectParam3_;
	struct System_String_o* takeEffectParam4_;
	int32_t takeEffectTarget2_;
	int32_t takeEffectCondition2_;
	struct System_String_o* takeEffect2Param1_;
	struct System_String_o* takeEffect2Param2_;
	struct System_String_o* takeEffect2Param3_;
	struct System_String_o* takeEffect2Param4_;
	int32_t takeEffectLogicType_;
	int32_t target1_;
	int32_t targetCondition1_;
	struct System_String_o* targetParam1_;
	struct System_String_o* targetParam2_;
	struct System_String_o* targetParam3_;
	struct System_String_o* targetParam4_;
	int32_t targetCondition2_;
	struct System_String_o* target2Param1_;
	struct System_String_o* target2Param2_;
	struct System_String_o* target2Param3_;
	struct System_String_o* target2Param4_;
	int32_t filterLogicType_;
};

struct TrueSync_FP_Fields {
	int64_t _serializedValue;
};

struct __declspec(align(8)) Nova_Client_EffectValue_Fields {
	struct Google_Protobuf_UnknownFieldSet_o* _unknownFields;
	int32_t id_;
	struct System_String_o* name_;
	struct System_String_o* tag_;
	int32_t takeEffectLimit_;
	bool remove_;
	int32_t cD_;
	int32_t effectRate_;
	int32_t effectType_;
	int32_t effectTypeFirstSubtype_;
	int32_t effectTypeSecondSubtype_;
	struct System_String_o* effectTypeParam1_;
	struct System_String_o* effectTypeParam2_;
	struct System_String_o* effectTypeParam3_;
	struct System_String_o* effectTypeParam4_;
	struct System_String_o* effectTypeParam5_;
	struct System_String_o* effectTypeParam6_;
	struct System_String_o* effectTypeParam7_;
};

struct __declspec(align(8)) SpecialAttributeList_Fields {
	struct SpecialAttributeList_ValueChangedHandle_o* ValueChangedEvent;
	struct SpecialAttributeEntry_array* entries;
};

struct __declspec(align(8)) UnityEngine_Object_Fields {
	intptr_t m_CachedPtr;
};

struct AdventureLevelTeleporter_NextLevelData_Fields {
	bool enterSettlementState;
	bool isCurScene;
	struct System_String_o* bornID;
	int32_t enterExitPortDirection;
	bool levelSuccess;
	float fadeTime;
	struct System_String_o* videoName;
};

struct System_ValueTuple_bool__long__bool__Fields {
	bool Item1;
	int64_t Item2;
	bool Item3;
};

struct __declspec(align(8)) Nova_Client_BuffValue_Fields {
	struct Google_Protobuf_UnknownFieldSet_o* _unknownFields;
	int32_t id_;
	struct System_String_o* name_;
	int32_t sort_;
	struct Google_Protobuf_Collections_RepeatedField_int__o* effects_;
	struct Google_Protobuf_Collections_RepeatedField_int__o* buffEffects_;
	int32_t time_;
	int32_t laminatedNum_;
	int32_t num_;
	int32_t timeSuperposition_;
	int32_t timing_;
	bool replaceType_;
	bool replaceMode_;
	bool attackClear_;
	bool hitClear_;
	bool isInherit_;
	bool isExitDelete_;
};

struct AttributeList_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
};

struct BuffEffectBase_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_Enter;
	VirtualInvokeData _5_Execute;
	VirtualInvokeData _6_Exit;
};

struct UnityEngine_GameObject_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
};

struct Nova_Client_BuffEffect_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_MergeFrom;
	VirtualInvokeData _5_MergeFrom;
	VirtualInvokeData _6_WriteTo;
	VirtualInvokeData _7_CalculateSize;
	VirtualInvokeData _8_pb__Google_Protobuf_IMessage_get_Descriptor;
	VirtualInvokeData _9_Equals;
	VirtualInvokeData _10_Clone;
};

struct AdventureActor_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_get_Id;
	VirtualInvokeData _5_get_ActiveSelf;
	VirtualInvokeData _6_AddLogicComponent;
	VirtualInvokeData _7_GetLogicComponent;
	VirtualInvokeData _8_GetLogicComponent;
	VirtualInvokeData _9_AddOrGetLogicComponent;
	VirtualInvokeData _10_AddMonoLogicComponent;
	VirtualInvokeData _11_AddOrGetMonoLogicComponent;
	VirtualInvokeData _12_IsCoroutineAlive;
	VirtualInvokeData _13_IsCoroutineRunning;
	VirtualInvokeData _14_GetCoroutineDeltaTime;
	VirtualInvokeData _15_OnActive;
	VirtualInvokeData _16_OnDeactive;
	VirtualInvokeData _17_OnInit;
	VirtualInvokeData _18_OnShutdown;
	VirtualInvokeData _19_OnLogicUpdateEnabled;
	VirtualInvokeData _20_OnLogicUpdateDisabled;
	VirtualInvokeData _21_OnLogicUpdatePaused;
	VirtualInvokeData _22_OnLogicUpdateResumed;
	VirtualInvokeData _23_OnLogicStart;
	VirtualInvokeData _24_OnLogicUpdate;
	VirtualInvokeData _25_OnLogicTimeScaleChanged;
	VirtualInvokeData _26_OnVisualUpdate;
	VirtualInvokeData _27_QueryHitBoxContextTime;
	VirtualInvokeData _28_QueryHitBoxContextPosition;
	VirtualInvokeData _29_QueryHitBoxContextDirection;
	VirtualInvokeData _30_QueryActorHitedTimeout;
	VirtualInvokeData _31_SetActorHitedTime;
	VirtualInvokeData _32_CheckHitable;
	VirtualInvokeData _33_OnHitActor;
	VirtualInvokeData _34_OnHitShield;
	VirtualInvokeData _35_OnHitObstacle;
	VirtualInvokeData _36_OnHitDestructibleObstacle;
	VirtualInvokeData _37_OnDeterministicCollisionEnter;
	VirtualInvokeData _38_OnDeterministicCollisionStay;
	VirtualInvokeData _39_OnDeterministicCollisionExit;
	VirtualInvokeData _40_OnStateTransformation;
	VirtualInvokeData _41_OnStateMachineTransformation;
	VirtualInvokeData _42_LevelStart;
	VirtualInvokeData _43_LevelEnd;
	VirtualInvokeData _44_OnAttributeListValueChange;
	VirtualInvokeData _45_OnHpChangedEvent;
	VirtualInvokeData _46_OnAliveChangedEvent;
	VirtualInvokeData _47_OnShieldChangedEvent;
	VirtualInvokeData _48_OnShow;
	VirtualInvokeData _49_OnEnterDeterministicCollision;
	VirtualInvokeData _50_OnStayDeterministicCollision;
	VirtualInvokeData _51_OnExitDeterministicCollision;
	VirtualInvokeData _52_PlaySound;
	VirtualInvokeData _53_LoadAnimations;
	VirtualInvokeData _54_OnPlayIdleAnim;
	VirtualInvokeData _55_CurrentStepCanbeHurt;
	VirtualInvokeData _56_InitializeFXControl;
	VirtualInvokeData _57_PlayHurtCueEffect;
	VirtualInvokeData _58_InitializeMovementBehaviour;
	VirtualInvokeData _59_UpdateNovementAgentAvoidanceBlockSetting;
	VirtualInvokeData _60_SetupPrimeFSM;
	VirtualInvokeData _61_Death;
	VirtualInvokeData _62_InitializeVisual;
	VirtualInvokeData _63_ReleaseVisual;
	VirtualInvokeData _64_LoadModel;
	VirtualInvokeData _65_SetupVisualComponents;
};

struct ActorEffectManage_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_get_ActiveSelf;
	VirtualInvokeData _5_set_ActiveSelf;
	VirtualInvokeData _6_SetEntity;
	VirtualInvokeData _7_Init;
	VirtualInvokeData _8_unknown;
	VirtualInvokeData _9_unknown;
	VirtualInvokeData _10_Shutdown;
	VirtualInvokeData _11_OnActive;
	VirtualInvokeData _12_OnDeactive;
	VirtualInvokeData _13_OnInit;
	VirtualInvokeData _14_OnShutdown;
};

struct Nova_Client_Effect_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_MergeFrom;
	VirtualInvokeData _5_MergeFrom;
	VirtualInvokeData _6_WriteTo;
	VirtualInvokeData _7_CalculateSize;
	VirtualInvokeData _8_pb__Google_Protobuf_IMessage_get_Descriptor;
	VirtualInvokeData _9_Equals;
	VirtualInvokeData _10_Clone;
};

struct AdventureSkill_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_get_Id;
	VirtualInvokeData _5_get_ActiveSelf;
	VirtualInvokeData _6_AddLogicComponent;
	VirtualInvokeData _7_GetLogicComponent;
	VirtualInvokeData _8_GetLogicComponent;
	VirtualInvokeData _9_AddOrGetLogicComponent;
	VirtualInvokeData _10_AddMonoLogicComponent;
	VirtualInvokeData _11_AddOrGetMonoLogicComponent;
	VirtualInvokeData _12_IsCoroutineAlive;
	VirtualInvokeData _13_IsCoroutineRunning;
	VirtualInvokeData _14_GetCoroutineDeltaTime;
	VirtualInvokeData _15_OnActive;
	VirtualInvokeData _16_OnDeactive;
	VirtualInvokeData _17_OnInit;
	VirtualInvokeData _18_OnShutdown;
	VirtualInvokeData _19_OnLogicUpdateEnabled;
	VirtualInvokeData _20_OnLogicUpdateDisabled;
	VirtualInvokeData _21_OnLogicUpdatePaused;
	VirtualInvokeData _22_OnLogicUpdateResumed;
	VirtualInvokeData _23_OnLogicStart;
	VirtualInvokeData _24_OnLogicUpdate;
	VirtualInvokeData _25_OnLogicTimeScaleChanged;
	VirtualInvokeData _26_OnVisualUpdate;
};

struct AdventureEffect_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
};

struct AdventureLevelController_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_Awake;
	VirtualInvokeData _5_Initialize;
	VirtualInvokeData _6_Load;
	VirtualInvokeData _7_LevelLoadComplete;
	VirtualInvokeData _8_LevelTeleporterTriggered;
	VirtualInvokeData _9_LevelStart;
	VirtualInvokeData _10_LevelEnd;
	VirtualInvokeData _11_LevelFinish;
	VirtualInvokeData _12_Unload;
	VirtualInvokeData _13_UnloadLevelComplete;
	VirtualInvokeData _14_UpdateLogic;
	VirtualInvokeData _15_PreloadAssets;
	VirtualInvokeData _16_Clear;
	VirtualInvokeData _17_IsLevelComplete;
	VirtualInvokeData _18_UpdateSpawnLogic;
	VirtualInvokeData _19_HasTimelinePerformance;
	VirtualInvokeData _20_PlayTimelinePerformance;
	VirtualInvokeData _21_InitSpawnPoints;
	VirtualInvokeData _22_HandleSpawnGizmos;
	VirtualInvokeData _23_HandleTreasureBoxSpawnPoints;
	VirtualInvokeData _24_ClearSpawnPoints;
	VirtualInvokeData _25_GetNPCs;
	VirtualInvokeData _26_GetWaves;
	VirtualInvokeData _27_GetPlans;
	VirtualInvokeData _28_GetGroups;
	VirtualInvokeData _29_BossSummonMonster;
	VirtualInvokeData _30_BossSummonMonsterPoint;
	VirtualInvokeData _31_PauseTimeLine;
	VirtualInvokeData _32_StopTimeLine;
	VirtualInvokeData _33_LevelStart_CheckBattleStartMsgTrigger;
	VirtualInvokeData _34_MonsterCleared_CheckBattleFinishMsgTrigger;
	VirtualInvokeData _35_CurLevelStateChanged;
	VirtualInvokeData _36_ClearMonsterGizmos;
	VirtualInvokeData _37_IsEmptyLevel;
	VirtualInvokeData _38_CheckLevelEntitiesStatus;
	VirtualInvokeData _39_MonsterCleared;
	VirtualInvokeData _40_LevelSuccess;
	VirtualInvokeData _41_SetMonsterGizmoAllActivedAndDied;
};

struct Nova_Client_HitDamage_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_MergeFrom;
	VirtualInvokeData _5_MergeFrom;
	VirtualInvokeData _6_WriteTo;
	VirtualInvokeData _7_CalculateSize;
	VirtualInvokeData _8_pb__Google_Protobuf_IMessage_get_Descriptor;
	VirtualInvokeData _9_Equals;
	VirtualInvokeData _10_Clone;
};

struct BuffEntity_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
};

struct Nova_Client_Buff_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_MergeFrom;
	VirtualInvokeData _5_MergeFrom;
	VirtualInvokeData _6_WriteTo;
	VirtualInvokeData _7_CalculateSize;
	VirtualInvokeData _8_pb__Google_Protobuf_IMessage_get_Descriptor;
	VirtualInvokeData _9_Equals;
	VirtualInvokeData _10_Clone;
};

struct BuffCom_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_get_ActiveSelf;
	VirtualInvokeData _5_set_ActiveSelf;
	VirtualInvokeData _6_SetEntity;
	VirtualInvokeData _7_Init;
	VirtualInvokeData _8_unknown;
	VirtualInvokeData _9_unknown;
	VirtualInvokeData _10_Shutdown;
	VirtualInvokeData _11_OnActive;
	VirtualInvokeData _12_OnDeactive;
	VirtualInvokeData _13_OnInit;
	VirtualInvokeData _14_OnShutdown;
};

struct SpecialAttributeList_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_Clone;
};

struct AdventureEffectBase_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_Execute;
	VirtualInvokeData _5_AddListenerer;
	VirtualInvokeData _6_PostExecute;
	VirtualInvokeData _7_RemoveListener;
	VirtualInvokeData _8_InitParams;
	VirtualInvokeData _9_OnClear;
};

struct Nova_Client_BuffValue_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_MergeFrom;
	VirtualInvokeData _5_MergeFrom;
	VirtualInvokeData _6_WriteTo;
	VirtualInvokeData _7_CalculateSize;
	VirtualInvokeData _8_pb__Google_Protobuf_IMessage_get_Descriptor;
	VirtualInvokeData _9_Equals;
	VirtualInvokeData _10_Clone;
};

struct Nova_Client_EffectValue_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_MergeFrom;
	VirtualInvokeData _5_MergeFrom;
	VirtualInvokeData _6_WriteTo;
	VirtualInvokeData _7_CalculateSize;
	VirtualInvokeData _8_pb__Google_Protobuf_IMessage_get_Descriptor;
	VirtualInvokeData _9_Equals;
	VirtualInvokeData _10_Clone;
};

struct LogicEntity_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_get_Id;
	VirtualInvokeData _5_get_ActiveSelf;
	VirtualInvokeData _6_AddLogicComponent;
	VirtualInvokeData _7_GetLogicComponent;
	VirtualInvokeData _8_GetLogicComponent;
	VirtualInvokeData _9_AddOrGetLogicComponent;
	VirtualInvokeData _10_AddMonoLogicComponent;
	VirtualInvokeData _11_AddOrGetMonoLogicComponent;
	VirtualInvokeData _12_IsCoroutineAlive;
	VirtualInvokeData _13_IsCoroutineRunning;
	VirtualInvokeData _14_GetCoroutineDeltaTime;
	VirtualInvokeData _15_OnActive;
	VirtualInvokeData _16_OnDeactive;
	VirtualInvokeData _17_OnInit;
	VirtualInvokeData _18_OnShutdown;
	VirtualInvokeData _19_OnLogicUpdateEnabled;
	VirtualInvokeData _20_OnLogicUpdateDisabled;
	VirtualInvokeData _21_OnLogicUpdatePaused;
	VirtualInvokeData _22_OnLogicUpdateResumed;
	VirtualInvokeData _23_OnLogicStart;
	VirtualInvokeData _24_OnLogicUpdate;
	VirtualInvokeData _25_OnLogicTimeScaleChanged;
	VirtualInvokeData _26_OnVisualUpdate;
};

struct HitBox_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
};

struct UnityEngine_Vector2_o {
	UnityEngine_Vector2_Fields fields;
};

struct ExtraLevelInfo_o {
	ExtraLevelInfo_Fields fields;
};

struct TrueSync_FP_o {
	TrueSync_FP_Fields fields;
};

struct UnityEngine_GameObject_Fields : UnityEngine_Object_Fields {
};

struct UnityEngine_Component_Fields : UnityEngine_Object_Fields {
};

struct AdventureLevelTeleporter_NextLevelData_o {
	AdventureLevelTeleporter_NextLevelData_Fields fields;
};

struct System_ValueTuple_bool__long__bool__o {
	System_ValueTuple_bool__long__bool__Fields fields;
};

struct AdventureEffectBase_c {
	Il2CppClass_1 _1;
	void* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	AdventureEffectBase_VTable vtable;
};

struct SpecialAttributeList_c {
	Il2CppClass_1 _1;
	void* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	SpecialAttributeList_VTable vtable;
};

struct AdventureLevelController_c {
	Il2CppClass_1 _1;
	struct AdventureLevelController_StaticFields* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	AdventureLevelController_VTable vtable;
};

struct LogicEntity_c {
	Il2CppClass_1 _1;
	struct LogicEntity_StaticFields* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	LogicEntity_VTable vtable;
};

struct UnityEngine_GameObject_c {
	Il2CppClass_1 _1;
	void* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	UnityEngine_GameObject_VTable vtable;
};

struct Nova_Client_EffectValue_c {
	Il2CppClass_1 _1;
	struct Nova_Client_EffectValue_StaticFields* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	Nova_Client_EffectValue_VTable vtable;
};

struct IEvent_c {
	Il2CppClass_1 _1;
	void* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	VirtualInvokeData vtable[32];
};

struct AttributeList_c {
	Il2CppClass_1 _1;
	struct AttributeList_StaticFields* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	AttributeList_VTable vtable;
};

struct AdventureEffect_c {
	Il2CppClass_1 _1;
	void* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	AdventureEffect_VTable vtable;
};

struct HitBox_c {
	Il2CppClass_1 _1;
	struct HitBox_StaticFields* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	HitBox_VTable vtable;
};

struct AdventureActor_c {
	Il2CppClass_1 _1;
	struct AdventureActor_StaticFields* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	AdventureActor_VTable vtable;
};

struct Nova_Client_BuffValue_c {
	Il2CppClass_1 _1;
	struct Nova_Client_BuffValue_StaticFields* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	Nova_Client_BuffValue_VTable vtable;
};

struct Nova_Client_Effect_c {
	Il2CppClass_1 _1;
	struct Nova_Client_Effect_StaticFields* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	Nova_Client_Effect_VTable vtable;
};

struct Nova_Client_Buff_c {
	Il2CppClass_1 _1;
	struct Nova_Client_Buff_StaticFields* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	Nova_Client_Buff_VTable vtable;
};

struct AdventureSkill_c {
	Il2CppClass_1 _1;
	void* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	AdventureSkill_VTable vtable;
};

struct Nova_Client_BuffEffect_c {
	Il2CppClass_1 _1;
	struct Nova_Client_BuffEffect_StaticFields* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	Nova_Client_BuffEffect_VTable vtable;
};

struct BuffEntity_c {
	Il2CppClass_1 _1;
	void* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	BuffEntity_VTable vtable;
};

struct BuffCom_c {
	Il2CppClass_1 _1;
	void* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	BuffCom_VTable vtable;
};

struct Nova_Client_HitDamage_c {
	Il2CppClass_1 _1;
	struct Nova_Client_HitDamage_StaticFields* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	Nova_Client_HitDamage_VTable vtable;
};

struct BuffEffectBase_c {
	Il2CppClass_1 _1;
	void* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	BuffEffectBase_VTable vtable;
};

struct ActorEffectManage_c {
	Il2CppClass_1 _1;
	void* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	ActorEffectManage_VTable vtable;
};

struct __declspec(align(8)) AdventureEffect_Fields {
	int32_t id;
	int32_t sourceType;
	int32_t _effectType;
	struct Nova_Client_Effect_o* _effectConfig_k__BackingField;
	struct Nova_Client_EffectValue_o* _effectValueConfig_k__BackingField;
	struct LogicEntity_o* enemyEntity;
	struct TrueSyncTransform_o* _enemyEntityTs;
	struct System_Collections_Generic_Stack_AdventureEffectBase__o* _effectStack;
	bool shareCD;
	bool shareTakeEffectLimit;
	int32_t _takeEffectLimit;
	struct TrueSync_CoroutineNode_o* _cdCoroutine;
	struct System_Collections_Generic_List_AdventureActor__o* _impactActors;
	bool _isNeedPostExecute;
	struct TrueSync_FP_o _cd;
	struct TrueSync_FP_o OrginMaxCd;
	struct TrueSync_FP_o _MaxCD_k__BackingField;
	bool removed;
	struct AdventureActor_o* _owner;
	struct AdventureActor_o* _fromActor;
	struct AdventureWeapon_o* _fromWeapon;
	struct BuffEntity_o* _fromBuffEntity;
	struct TrueSync_FP_o nextTriggerTime;
	int64_t Damage;
};

struct __declspec(align(8)) System_Collections_Generic_Stack_AdventureEffectBase__Fields {
	struct AdventureEffectBase_array* _array;
	int32_t _size;
	int32_t _version;
	Il2CppObject* _syncRoot;
};

struct System_Collections_Generic_Stack_AdventureEffectBase__VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_System_Collections_Generic_IEnumerable_T__GetEnumerator;
	VirtualInvokeData _5_System_Collections_IEnumerable_GetEnumerator;
	VirtualInvokeData _6_System_Collections_ICollection_CopyTo;
	VirtualInvokeData _7_unknown;
	VirtualInvokeData _8_System_Collections_ICollection_get_SyncRoot;
	VirtualInvokeData _9_System_Collections_ICollection_get_IsSynchronized;
	VirtualInvokeData _10_get_Count;
};

struct System_Collections_Generic_Stack_AdventureEffectBase__c {
	Il2CppClass_1 _1;
	void* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	System_Collections_Generic_Stack_AdventureEffectBase__VTable vtable;
};

struct System_Collections_Generic_Stack_AdventureEffectBase__o {
	System_Collections_Generic_Stack_AdventureEffectBase__c *klass;
	void *monitor;
	System_Collections_Generic_Stack_AdventureEffectBase__Fields fields;
};

struct TrueSync_TSVector2_Fields {
	struct TrueSync_FP_o x;
	struct TrueSync_FP_o y;
};

struct __declspec(align(8)) BuffEntity_Fields {
	struct System_Collections_Generic_Dictionary_int__List_int___o* buffUidLs;
	struct System_Collections_Generic_Dictionary_int__AdventureActor__o* fromActors;
	struct TrueSync_FP_o configBuffTime;
	struct TrueSync_FP_o buffLeftTime;
	struct TrueSync_FP_o inputReduceTime;
	struct Nova_Client_Buff_o* buffConfig;
	struct Nova_Client_BuffValue_o* buffValueConfig;
	struct BuffCom_o* _buffCom;
	int32_t buffNum;
	struct AdventureBuffFXHandler_o* adventureBuffFx;
	int32_t exceptNum;
	struct System_Collections_Generic_List_int__o* _Tags_k__BackingField;
	struct TrueSync_FP_o exceptTime;
	bool removed;
};

struct UnityEngine_Behaviour_Fields : UnityEngine_Component_Fields {
};

struct AdventureEffectBase_o {
	AdventureEffectBase_c *klass;
	void *monitor;
	AdventureEffectBase_Fields fields;
};

struct AdventureEffectBase_array {
	Il2CppObject obj;
	Il2CppArrayBounds *bounds;
	il2cpp_array_size_t max_length;
	AdventureEffectBase_o* m_Items[65535];
};

struct SpecialAttributeList_o {
	SpecialAttributeList_c *klass;
	void *monitor;
	SpecialAttributeList_Fields fields;
};

struct UnityEngine_GameObject_o {
	UnityEngine_GameObject_c *klass;
	void *monitor;
	UnityEngine_GameObject_Fields fields;
};

struct Nova_Client_EffectValue_o {
	Nova_Client_EffectValue_c *klass;
	void *monitor;
	Nova_Client_EffectValue_Fields fields;
};

struct IEvent_o {
	IEvent_c *klass;
	void *monitor;
	IEvent_Fields fields;
};

struct AttributeList_o {
	AttributeList_c *klass;
	void *monitor;
	AttributeList_Fields fields;
};

struct Nova_Client_BuffValue_o {
	Nova_Client_BuffValue_c *klass;
	void *monitor;
	Nova_Client_BuffValue_Fields fields;
};

struct Nova_Client_Effect_o {
	Nova_Client_Effect_c *klass;
	void *monitor;
	Nova_Client_Effect_Fields fields;
};

struct Nova_Client_Buff_o {
	Nova_Client_Buff_c *klass;
	void *monitor;
	Nova_Client_Buff_Fields fields;
};

struct Nova_Client_BuffEffect_o {
	Nova_Client_BuffEffect_c *klass;
	void *monitor;
	Nova_Client_BuffEffect_Fields fields;
};

struct Nova_Client_HitDamage_o {
	Nova_Client_HitDamage_c *klass;
	void *monitor;
	Nova_Client_HitDamage_Fields fields;
};

struct BuffEffectBase_o {
	BuffEffectBase_c *klass;
	void *monitor;
	BuffEffectBase_Fields fields;
};

struct AdventureEffect_o {
	AdventureEffect_c *klass;
	void *monitor;
	AdventureEffect_Fields fields;
};

struct TrueSync_TSVector2_o {
	TrueSync_TSVector2_Fields fields;
};

struct BuffEntity_o {
	BuffEntity_c *klass;
	void *monitor;
	BuffEntity_Fields fields;
};

struct UnityEngine_MonoBehaviour_Fields : UnityEngine_Behaviour_Fields {
	struct System_Threading_CancellationTokenSource_o* m_CancellationTokenSource;
};

struct LockStepManager_c {
	Il2CppClass_1 _1;
	struct LockStepManager_StaticFields* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
};

struct DeterministicShape_Fields {
	int32_t shapeType;
	struct TrueSync_FP_o width;
	struct TrueSync_FP_o length;
	struct TrueSync_FP_o radius;
	struct TrueSync_FP_o innerRadius;
	struct TrueSync_FP_o angle;
	struct TrueSync_TSVector2_o position;
	struct TrueSync_FP_o rotation;
};

struct LogicEntity_Fields : UnityEngine_MonoBehaviour_Fields {
	struct System_Collections_Generic_List_ILogicComponent__o* logicComponents;
	struct LogicEntity_o* _Parent_k__BackingField;
	struct TrueSyncTransform_o* _tsTransform_k__BackingField;
	struct ILogicComponentVisualUpdate_array* visualUpdateComponents;
	struct ILogicComponentUpdate_array* updateComponents;
	bool initialised;
	int64_t _Id_k__BackingField;
	bool _ignoreGlobalLogicTimeScale_k__BackingField;
	struct TrueSync_FP_o _logicTimeScale_k__BackingField;
	struct TrueSync_FP_o _LogicDeltaTime_k__BackingField;
	struct TrueSync_FP_o _LogicTime_k__BackingField;
	int32_t _logicUpdatePausedRC;
	bool _callLogicStartOnce;
	bool _logicUpdateEnabled_k__BackingField;
	bool useParentTimeScale;
	struct AdventureTimeControlManager_o* _logicTimeControlManager;
	struct LogManager_Logger_o* _logger;
};

struct HitBox_Fields : UnityEngine_MonoBehaviour_Fields {
	struct LogicEntity_o* owner;
	struct IHitBoxContext_o* context;
	uint32_t featureFlags;
	struct HitBox_HitBoxFeatureData_o* featureData;
	int32_t _id;
	struct System_Collections_Generic_List_HitBox_HitDamageIdData__o* _HitDamageIdDatas;
	int32_t hurtAnimType;
	struct UnityEngine_GameObject_o* hurtEffectSource;
	struct System_Collections_Generic_List_DeterministicCollider__o* _hitTargets;
	struct AkWeaponHitSwitch_o* weaponTrigger;
	bool canWeaponTrigger;
	struct AdventureActor_o* actor;
	int32_t _hitBoxShape_k__BackingField;
	struct TrueSync_FP_o _hitBoxWidth_k__BackingField;
	struct TrueSync_FP_o _hitBoxLength_k__BackingField;
	struct TrueSync_FP_o _hitBoxRadius_k__BackingField;
	struct TrueSync_FP_o _hitBoxInnerRadius_k__BackingField;
	struct TrueSync_FP_o _hitBoxAngle_k__BackingField;
	struct TrueSync_TSVector2_o _hitPos_k__BackingField;
};

struct AdventureLevelController_Fields : UnityEngine_MonoBehaviour_Fields {
	struct System_String_o* scenePath;
	struct System_String_o* musicName;
	struct System_String_o* leaveMusicEvent;
	struct System_String_o* levelScript;
	struct AIAdapter_o* _aiAdapter;
	struct AdventureModuleLevelLoadParams_o* _levelLoadParams_k__BackingField;
	struct System_Action_o* flowCallback;
	struct LogManager_Logger_o* logger;
	bool _isReconnected_k__BackingField;
	bool _isBattleFinish_k__BackingField;
	bool _isLastLevelFloor_k__BackingField;
	bool _isPrologueBattleCanSwitchActor_k__BackingField;
	struct System_Collections_Generic_Dictionary_string__int__o* dicLevelCounter;
	int32_t boxID;
	struct UnityEngine_GameObject_o* configPrefab;
	bool isLoadingLevel;
	bool isUnloadingLevel;
	struct UnityEngine_Transform_o* timelineNode;
	struct System_String_o* timelineName;
	struct ExtraLevelInfo_o extraLevelInfo;
	struct EventDispatcher_o* eventDispatcher;
	int32_t currentLvDropCount;
	struct System_Collections_Generic_List_LogicEntity__o* _entities_k__BackingField;
	struct System_Collections_Generic_List_LogicEntity__o* _playerActors_k__BackingField;
	struct System_Collections_Generic_List_LogicEntity__o* _monsterActors_k__BackingField;
	struct System_Collections_Generic_List_LogicEntity__o* _weapons_k__BackingField;
	struct System_Collections_Generic_List_LogicEntity__o* _destructibleObjects_k__BackingField;
	struct System_Collections_Generic_List_Searchable__o* _searchables_k__BackingField;
	struct System_Collections_Generic_List_LogicEntity__o* _obstacles_k__BackingField;
	struct System_Collections_Generic_List_LogicEntity__o* _trapActors_k__BackingField;
	struct System_Collections_Generic_List_LogicEntity__o* _areaEffects_k__BackingField;
	struct System_Collections_Generic_List_LogicEntity__o* _dropEntitys_k__BackingField;
	struct System_Collections_Generic_List_LogicEntity__o* _forzenTimeChildren_k__BackingField;
	struct System_Collections_Generic_Dictionary_Transform__GameObject__o* _minimapObjects_k__BackingField;
	struct System_Collections_Generic_List_InteractiveNpc__o* interactiveNpc;
	struct System_Collections_Generic_List_LogicEntity__o* _dynamicActors_k__BackingField;
	struct System_Collections_Generic_List_LogicEntity__o* _placeHolders_k__BackingField;
	struct System_Collections_Generic_List_LogicEntity__o* _specialEntities_k__BackingField;
	struct System_Collections_Generic_Dictionary_int__int__o* dicIndexTreasureBox;
	struct System_Collections_Generic_Dictionary_int__int__o* dicIndexChestBoss;
	struct System_Collections_Generic_Dictionary_int__int__o* dicIndexChestMiniBoss;
	struct System_Collections_Generic_Dictionary_int__int__o* dicIndexChestSpecCom;
	struct TrueSync_TSVector2_o bigChestPos;
	struct AdventureObjectOrderByLocationComparer_o* _objectOrderByLocationComparer;
	int32_t _totalAlivePlayerActorCount_k__BackingField;
	bool _isMonsterCleared_k__BackingField;
	int64_t _uidCounter;
	bool _lockEntitiesListUpdate;
	struct System_Collections_Generic_List_LogicEntity__o* removeEntities;
	int32_t currentMonsterWeaponCount;
	struct System_Collections_Generic_Dictionary_long__LogicEntity__o* _entityIDCache;
	bool isHaveBigBox;
	struct System_Collections_Generic_List_int____o* tmpPrizeList;
	struct Pathfinding_NavmeshCut_array* navMeshCuts;
	struct System_Collections_Generic_List_AdventureLevelController_RoomRuleInfo__o* roomRuleInfos;
	struct System_Collections_Generic_List_MonsterSpawnWaveGizmo__o* _monsterSpawnWaves_k__BackingField;
	struct System_Collections_Generic_List_TrapSpawnGroupGizmo__o* _trapGroups_k__BackingField;
	struct System_Collections_Generic_List_VirtualMonsterSpawnWaveGizmo__o* _virtualMonsterSpawnWaves_k__BackingField;
	struct System_Collections_Generic_List_TreasureBoxSpawnPoint__o* specifiedTreasureBoxSpawnPoints;
	struct System_Collections_Generic_List_TreasureBoxSpawnPoint__o* treasureBoxSpawnPoints;
	struct System_Collections_Generic_List_PlayerSpawnPointGizmo__o* playerSpawnPoints;
	struct PlayerSpawnPointGizmo_o* playerSpawnPointGizmo;
	struct System_Collections_Generic_List_AdventureLevelTeleporter__o* teleporters;
	struct System_Collections_Generic_List_NPCSpawnPointGizmo__o* npcSpawnPoints;
	struct AdventureObjectOrderByLocationComparer_o* objectOrderByLocationComparer;
	struct System_Collections_Generic_List_AdventureTriggerGizmo__o* _triggerGizmos_k__BackingField;
	struct AdventureInteractableEventTriggerGizmo_o* _activedInteractableEventTriggerGizmo_k__BackingField;
	struct AdventurePlayerCameraTriggerGizmo_o* curCameraTriggerGizmo;
	int32_t _levelStatus;
	int32_t _gameState_k__BackingField;
	struct System_Action_AdventureLevelState__o* levelStatusChanged;
	struct AdventureLevelTeleporter_NextLevelData_o nextLevelData;
	bool hasBattleStartMsgTrigger;
	bool hasBattleFinishMsgTrigger;
	bool hasSendMonsterClearEvt;
	struct UnityEngine_Animator_array* _allAnimatorsInScene;
	struct UnityEngine_ParticleSystem_array* _allParticlesInScene;
	struct UnityEngine_Playables_PlayableDirector_array* _allTimelinesInScene;
};

struct LogicMonoComponent_Fields : UnityEngine_MonoBehaviour_Fields {
	struct LogicEntity_o* _Entity_k__BackingField;
};

struct DeterministicShape_o {
	DeterministicShape_Fields fields;
};

struct AdventureSkill_Fields : LogicEntity_Fields {
	int32_t _skillId_k__BackingField;
	bool _checkCdRestore_k__BackingField;
	bool _forceRunFinish_k__BackingField;
	struct System_Collections_Generic_List_GameObject__o* _targets_k__BackingField;
	struct System_Collections_Generic_List_int__o* _breakSkillIds_k__BackingField;
	struct UnityEngine_GameObject_o* _owner_k__BackingField;
	struct AdventureActor_o* _actor_k__BackingField;
	struct ActorSkillManage_o* _actorSkillManage_k__BackingField;
	struct AIAdapter_o* _ai;
	struct AdventureSkillPhaseConfig_o* _phaseConfig;
	struct Nova_Client_Skill_o* _skillInfo;
	struct System_Action_bool__o* _finishCallback;
	struct System_Action_FP__o* _beginCDForMonsterCallback;
	struct PlayerSkillCd_o* _playerSkillCd;
	bool _alreadyResume;
	int32_t _countdownTiming;
	int32_t _skillLauncherType;
	int32_t _skillCastBehaviourType;
	struct System_Action_o* _setPhaseExecuteConfigCallback;
	struct AdventureLevelObjPoolMgr_PoolObj_o* _poolObj;
	bool isActivationEnd;
	bool isDodgeSkill;
	bool CanExecuteOtherSkillWhenSemiAutoBattle;
	bool _IsRemoved_k__BackingField;
};

struct LogicEntity_o {
	LogicEntity_c *klass;
	void *monitor;
	LogicEntity_Fields fields;
};

struct HitBox_o {
	HitBox_c *klass;
	void *monitor;
	HitBox_Fields fields;
};

struct AdventureLevelController_o {
	AdventureLevelController_c *klass;
	void *monitor;
	AdventureLevelController_Fields fields;
};

struct BuffCom_Fields : LogicMonoComponent_Fields {
	struct System_Collections_Generic_List_BuffEntity__o* _BuffList_k__BackingField;
	struct BuffCom_BuffUIHandle_o* BuffUIEvent;
	struct System_Collections_Generic_Dictionary_int__int__o* firstIdBuffs;
	struct AdventureActor_o* _owner;
	bool useOldCode;
	struct System_Collections_Generic_List_BuffCom_BuffHeadSlot__o* buffHeadSlots;
	struct UnityEngine_Transform_o* buffSlotRoot;
	int32_t tokenIndex;
	struct AnimationSlotConfigComponent_o* _syncSlotConfigComponent;
	struct System_Collections_Generic_Dictionary_int__int__o* immunityIds;
	struct System_Collections_Generic_Dictionary_int__int__o* immunityGroupIds;
	struct System_Collections_Generic_Dictionary_int__int__o* immunityTags;
	struct BuffCom_ReduceTimeHandle_o* JsReduceTimeEvent;
	int32_t _reduceCountA;
	int32_t _reduceTimeCount;
};

struct ActorEffectManage_Fields : LogicMonoComponent_Fields {
	struct AdventureActor_o* _actor;
	int32_t _uniqueEffectId;
	struct System_Collections_Generic_Dictionary_int__AdventureEffect__o* effectsDict;
	struct System_Collections_Generic_List_AdventureEffect__o* _timeTriggerEffects;
	struct System_Collections_Generic_List_int__o* _delayRemovedEffectUniqueIds;
	int32_t _beingProcessedRC;
	struct System_Collections_Generic_Dictionary_int__AdventureEffect__o* _delayAddedEffectDict;
	struct System_Collections_Generic_List_int__o* onceAttackEffectUniqueAttackIds;
	struct System_Collections_Generic_List_int__o* _changeEffectIdList;
	struct System_Collections_Generic_List_AddEffectInfo__o* _addEffectInfoList;
	struct System_Collections_Generic_List_int__o* _removeEffectIds;
	struct System_Collections_Generic_List_ChangeBuffTimeEffectInfo__o* _changeBuffTimeEffectInfos;
	struct System_Collections_Generic_List_ChangeBuffLaminatedNumEffectInfo__o* _changeBuffLaminatedNumEffectInfos;
};

struct AdventureActor_Fields : LogicEntity_Fields {
	struct System_Collections_Generic_List_DeterministicRaycastHit__o* _tempDeterministicRaycastHits;
	struct AttributeList_o* attributeList;
	struct SpecialAttributeList_o* specialAttributeList;
	struct StateAttributeList_o* stateAttributeList;
	struct ActorInfo_o* actorInfo;
	struct ActorElementInfo_o* actorElementInfo;
	struct ActorHealthInfo_o* actorHealthInfo;
	struct ActorScaleInfo_o* actorScaleInfo;
	struct ActorSearchTarget_o* actorSearchTargetInfo;
	struct ShootBehaviour_o* shootBehaviour;
	struct AmmoInfo_o* ammoInfo;
	struct ActorSkillManage_o* actorSkillManage;
	struct ActorEffectManage_o* effectManage;
	struct BuffCom_o* buffComponent;
	struct DeterministicMovementAgent_o* movAgent;
	struct UnityEngine_Animator_o* animator;
	struct AnimationSlotConfigComponent_o* slotConfig;
	struct AnimatorReactionBinder_o* animatorReactionBinder;
	struct ComboGroup_o* comboGroup;
	struct AdventureSelfFXHandler_o* selfFXHandler;
	struct UnityEngine_Collider_o* collider;
	struct DeterministicCollider_o* _dtCollider_k__BackingField;
	struct LogicVariable_o* logicVariable;
	struct VisualSmooth_o* _smooth;
	struct ActorShield_o* actorShield;
	int32_t _dataID_k__BackingField;
	struct System_String_o* _attrID_k__BackingField;
	int32_t _attrTempleteID_k__BackingField;
	int32_t _skinID_k__BackingField;
	struct TrueSync_FP_o strengthOverride;
	bool isSyncActived;
	struct System_String_o* GroupId;
	int32_t _rowOfScene_k__BackingField;
	int32_t _columnOfScene_k__BackingField;
	bool _logicPaused;
	struct System_Collections_Generic_List_LogicEntity__o* _enterColliderEntities;
	bool _logicInitialized_k__BackingField;
	struct HybirdAnimatorController_o* _animatorController_k__BackingField;
	struct UnityEngine_RuntimeAnimatorController_o* _currentRuntimeAnimatorController_k__BackingField;
	struct UnityEngine_RuntimeAnimatorController_o* _originRuntimeAnimatorController;
	int32_t _animationPauseRC;
	bool useSpecialLostControlClip;
	float specialLostControlStartClipLen;
	float specialLostControlEndClipLen;
	struct DG_Tweening_Tween_o* _nrootShakeTween;
	struct UnityEngine_Vector2_o _nrootShakeShifting;
	struct MagicaCloth_BaseCloth_array* _dynamicBones_k__BackingField;
	struct System_Single_array* _originDynamicBonesBlendWeight;
	struct UnityEngine_Coroutine_array* _dynamicBonesBlendFadeCoroutines;
	struct ActorAttackFSM_o* _attackFSM;
	struct ComboInputBuffer_o* _comboInputBuffer;
	struct System_String_o* _actionTag;
	int32_t lastComboPhaseSwitchFrameCount;
	struct AdventureBehaviour_ComboAttack_o* activeComboAttack;
	struct System_Collections_Generic_Dictionary_long__FP__o* _monsterWeaponHitedActors;
	bool enableChangeCurrentAttackTarget;
	struct LogicEntity_o* _attackTarget;
	struct LogicEntity_o* _currentAttackTarget_k__BackingField;
	bool isChangeAimLockedTargetWhenCurrentAttackTargetInValid;
	struct TrueSync_TSVector2_o _lastAttackTargetDeterministicPosition;
	int64_t monsterTargetId;
	struct LogicEntity_o* _monsterTarget;
	struct LogicEntity_o* _soldierAttackTarget;
	bool comboTriggerExitTime;
	struct System_Action_AdventureActor__Combo_Event__o* _onAttackCustomEvent;
	struct System_Action_AdventureActor__o* _onAttackInterrupted;
	struct System_Action_AdventureActor__Combo_Phase__o* _onBeforeAttackComboPhaseChange;
	struct System_Action_AdventureActor__Combo_Phase__o* _onAfterAttackComboPhaseChange;
	struct System_Action_AdventureActor__int__Combo_FeaturePhase__o* _onFeaturePhaseActive;
	struct System_Action_AdventureActor__o* _onAttackComboLoop;
	struct System_Action_AdventureActor__o* OnSendSkillTakeEffect;
	struct System_Action_AdventureActor__bool__o* _onSendSkillAllowOtherSkillExecute;
	struct HitBox_o* _hitBox_k__BackingField;
	struct System_Collections_Generic_Dictionary_long__FP__o* _hitedActors;
	struct System_Action_o* OnDeadImmunityHandle;
	struct System_Func_GameEnum_stateAttributeType__bool__o* OnBuffHandle;
	struct System_Func_GameEnum_stateAttributeType__bool__o* OnDamageHandle;
	struct System_Func_GameEnum_stateAttributeType__bool__o* OnBeHitHandle;
	struct System_Func_GameEnum_stateAttributeType__bool__o* OnSpecialControlHandle;
	struct System_Func_GameEnum_stateAttributeType__bool__o* OnStrongControlHandle;
	struct System_Func_GameEnum_stateAttributeType__bool__o* OnWeekControlHandle;
	bool onHurtEffectCD;
	struct AkAnimatorAudio_o* _akAudio;
	bool onHurtAudioCD;
	struct AdventureActor_o* _lastAttackMonster_k__BackingField;
	struct System_String_o* specialHurtFx;
	bool isEnterLostCtr;
	uint32_t lastCtrType;
	uint32_t curCtrType;
	struct System_Collections_Generic_List_int__o* immuneCertainDamageIds;
	struct Nova_Client_Recorder_Types_Damage_o* dmgData;
	struct System_Collections_Generic_List_CoroutineNode__o* movableFCoroutineNodes;
	struct System_Collections_Generic_List_AdventureFXPlayer__o* playFxs;
	struct EventDispatcher_o* _dispatcher;
	struct ActorMovementFSM_o* _movementFSM;
	struct TrueSync_FP_o _velocitySpeed_k__BackingField;
	struct TrueSync_FP_o _currentRotateSpeed;
	struct TrueSync_FP_o targetRotation;
	struct TrueSync_FP_o currentRotTime;
	struct TrueSync_FP_o rotationDuration;
	struct TrueSync_TSVector2_o _velocityDirection;
	struct TrueSync_TSVector2_o _forceChangeDirection_k__BackingField;
	bool forbiddenBehitRot;
	struct TrueSync_TSVector2_o _externalForce_k__BackingField;
	bool haveExternalForce;
	int32_t _movementMode;
	bool specialDodgeMode;
	bool _crossObstacleMode;
	struct TrueSync_FP_o crossObstacleModeSpeedMultiply;
	struct System_Collections_Generic_List_DeterministicCollider__o* _checkTargetList_PerfectDodge;
	struct System_Collections_Generic_List_DeterministicCollider__o* _checkHitList_PerfectDodge;
	struct TrueSync_CoroutineNode_o* _rotateCoroutine;
	struct System_Action_o* _onClear;
	bool isRotate;
	bool isRotateCloseTarget;
	bool aimWithStartAnim;
	int32_t _aimMode;
	int32_t curAimIndex;
	struct TrueSync_TSVector2_o targetDir;
	struct TrueSync_FP_o aimAngleLimit;
	struct Pathfinding_NNConstraint_o* _reachableConstraint;
	struct TrueSync_FP_o _speedTransitionTimer;
	struct TrueSync_CoroutineNode_o* speedTransition;
	struct TrueSync_FP_o _accelerationScaleValue;
	struct TrueSync_FP_o _rotationSpeedScaleValue;
	bool _movementAgentEnabled_k__BackingField;
	int32_t _movementAgentPauseRC;
	int32_t _movementAvoidancePauseRC;
	int32_t _movementAvoidanceLockRC;
	int32_t _movementBlockPauseRC;
	struct TrueSync_FP_o _orginMovementBlockPriority;
	int32_t _lostControlRC;
	bool _isInteractive_k__BackingField;
	bool _canPerfectDodge_k__BackingField;
	bool InPerfectDodge;
	bool _forbiddenPerfectDodge_k__BackingField;
	int32_t _deadImmunityRC;
	bool _isHpLocked_k__BackingField;
	int64_t _lockedHp_k__BackingField;
	int32_t _forceControlRC;
	int32_t _disableMoveRC;
	int32_t _disableMoveAgentCanMoveRC;
	int32_t _disableRotateRC;
	int32_t _disableCastDodgeRC;
	int32_t _disableCastNormalRC;
	int32_t _disableCastSkillRC;
	int32_t _disableCastUltraRC;
	int32_t _hideMonsterHpAndAttackHintRC;
	struct TrueSync_FP_o _stiffDuration;
	bool isStiff;
	struct TrueSync_CoroutineNode_o* _knockbackCoroutine;
	struct TrueSync_TSVector2_o _knockBackDirection;
	struct TrueSync_FP_o _knockBackSpeed;
	struct TrueSync_FP_o _knockBackAcceleration;
	struct TrueSync_CoroutineNode_o* _airBorneCoroutine;
	struct TrueSync_FP_o _airBorneSpeed;
	struct TrueSync_FP_o _actorOriginalPositionY;
	struct System_Collections_Generic_Dictionary_StateEnum__AdventureBuffFXHandler__o* dicBuffFx;
	struct System_Action_o* _scnenMoveInterruptCallBack;
	struct TrueSync_CoroutineNode_o* _sceneMoveCor;
	bool _isWitchTimeOwner_k__BackingField;
	bool _isWitchTimeAttacker_k__BackingField;
	struct AdventureTimeControlHandler_o* _witchtimeTimeControlHandler;
	struct AdventureActor_o* _witchtimeAttackTarget;
	struct System_Collections_Generic_List_AdventureActor_MoveFeatureData__o* currentMoveFeatureDataLs;
	struct System_Collections_Generic_List_AdventureActor_MoveFeatureData__o* newMoveFeatureDatas;
	struct AdventureActor_MoveFeatureData_o* currentMoveData;
	struct TrueSync_FP_o moveDuration;
	int32_t framIndex;
	struct TrueSync_FP_o acceleration;
	struct TrueSync_FP_o _enterStunTime;
	bool _isStunSpecialLostControlFinish;
	struct TrueSync_CoroutineNode_o* _stunSpecialLostControlNode;
	struct TrueSync_FP_o currentDuration;
	struct TrueSync_FP_o totalDuration;
	struct TrueSync_CoroutineNode_o* _charmMoveCoroutine;
	struct TrueSync_TSVector2_o _charmDir;
	struct AdventureActor_o* _from;
	int64_t _fromId;
	struct TrueSync_CoroutineNode_o* _terrorMoveCoroutine;
	struct TrueSync_TSVector2_o _terrorDir;
	struct TrueSync_FP_o _enterToughnessBrokenTime;
	bool _isToughnessBrokenSpecialLostControlFinish;
	struct TrueSync_CoroutineNode_o* _toughnessBrokenSpecialLostControlNode;
	struct AdventureActor_o* tauntFromActor;
	struct DeterministicShape_o _shape;
	struct TrueSync_TSVector2_o randomPos;
	struct TrueSync_CoroutineNode_o* _randomMoveCoroutine;
	bool complete;
	int32_t waitC;
	int32_t _state;
	struct System_Action_bool__o* DyingStateChanged;
	bool _inDying;
	struct ActorPrimeFSM_o* _primeFSM;
	struct ActorNullState_o* _nullState;
	struct ActorSpawnState_o* _spawnState;
	struct ActorIdleState_o* _idleState;
	struct ActorActionState_o* _actionState;
	struct ActorLostControlState_o* _lostControlState;
	struct ActorDeathState_o* _deathState;
	struct ActorClearState_o* _clearState;
	struct System_String_o* _actionAIPath;
	struct System_String_o* _spawnAIPath;
	struct System_String_o* _idleAIPath;
	struct System_String_o* _lostcontrolAIPath;
	struct System_String_o* _deathAIPath;
	struct System_String_o* _parallelAIPath;
	struct System_String_o* _clearAIPath;
	struct System_String_o* _trapActionAIPath;
	struct System_String_o* _trapSpawnAIPath;
	struct System_String_o* _trapIdleAIPath;
	struct System_String_o* _trapLostcontrolAIPath;
	struct System_String_o* _trapDeathAIPath;
	struct System_String_o* _trapParallelAIPath;
	struct System_String_o* _trapClearAIPath;
	struct System_String_o* _comboGroupPath;
	struct AIAdapter_o* _parallelAI;
	bool _isBorn_k__BackingField;
	struct TrueSync_CoroutineNode_o* _bornCoroutine;
	struct TrueSync_CoroutineNode_o* _spwanShowCoroutine;
	bool _makeThreatAlert;
	int32_t _makeThreatAlertPrevState;
	bool _isDead_k__BackingField;
	bool _isDeclareDead_k__BackingField;
	struct LogicEntity_o* killer;
	struct System_Collections_Generic_IList_int__o* _damageTag;
	struct HitBox_o* killerHitBox;
	int32_t _uniqueAttackId;
	int32_t _deadType;
	struct System_Collections_Generic_Dictionary_int__int__o* tags;
	struct System_Collections_Generic_Dictionary_int__List_int___o* elementMarkTags;
	struct System_Collections_Generic_Dictionary_int__FP__o* _hitImmunitys;
	bool _hitIdImmuneTriggered;
	bool _hitIdImmuneSeenNonImmune;
	struct AdventureActor_ShowChangedHandle_o* ShowChangedEvent;
	struct InGameActorVisualControlComponent_o* _visualControl_k__BackingField;
	int32_t _hideRC;
	int32_t _transparentRC;
	float _transparencyFrom;
	float _transparencyTo;
	int32_t _transparentFadeMaterialID;
	struct UnityEngine_Coroutine_o* _transparentFadeCoroutine;
	struct UnityEngine_Coroutine_o* _transparentFadeSwichActorCoroutine;
	float _currentTransparency_k__BackingField;
	int32_t _hurtAnimToggleRC;
	int32_t _checkBrokenLineBulletRC;
	struct TrueSync_FP_o checkBrokenLineBulletRadius;
	struct System_Collections_Generic_List_AdventureWeapon__o* _equipedWeapons_k__BackingField;
	struct System_Collections_Generic_List_AdventureRotateWeapon__o* wepons;
	struct TrueSync_FP_o fixedWeaponTime;
	bool iFixWeaponDuration;
};

struct AdventureSkill_o {
	AdventureSkill_c *klass;
	void *monitor;
	AdventureSkill_Fields fields;
};

struct BuffCom_o {
	BuffCom_c *klass;
	void *monitor;
	BuffCom_Fields fields;
};

struct ActorEffectManage_o {
	ActorEffectManage_c *klass;
	void *monitor;
	ActorEffectManage_Fields fields;
};

struct AdventureActor_o {
	AdventureActor_c *klass;
	void *monitor;
	AdventureActor_Fields fields;
};

struct __declspec(align(8)) ExecuteEffectInfo_Fields {
	int32_t effectId;
	struct System_String_o* effectTag;
};

struct ExecuteEffectInfo_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
};

struct ExecuteEffectInfo_c {
	Il2CppClass_1 _1;
	void* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	ExecuteEffectInfo_VTable vtable;
};

struct ExecuteEffectInfo_o {
	ExecuteEffectInfo_c *klass;
	void *monitor;
	ExecuteEffectInfo_Fields fields;
};


struct __declspec(align(8)) System_Collections_Generic_List_BuffEntity__Fields {
	struct BuffEntity_array* _items;
	int32_t _size;
	int32_t _version;
	Il2CppObject* _syncRoot;
};

struct System_Collections_Generic_List_BuffEntity__VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_unknown;
	VirtualInvokeData _5_set_Item;
	VirtualInvokeData _6_IndexOf;
	VirtualInvokeData _7_Insert;
	VirtualInvokeData _8_unknown;
	VirtualInvokeData _9_unknown;
	VirtualInvokeData _10_System_Collections_Generic_ICollection_T__get_IsReadOnly;
	VirtualInvokeData _11_Add;
	VirtualInvokeData _12_unknown;
	VirtualInvokeData _13_Contains;
	VirtualInvokeData _14_CopyTo;
	VirtualInvokeData _15_Remove;
	VirtualInvokeData _16_System_Collections_Generic_IEnumerable_T__GetEnumerator;
	VirtualInvokeData _17_System_Collections_IEnumerable_GetEnumerator;
	VirtualInvokeData _18_System_Collections_IList_get_Item;
	VirtualInvokeData _19_System_Collections_IList_set_Item;
	VirtualInvokeData _20_System_Collections_IList_Add;
	VirtualInvokeData _21_System_Collections_IList_Contains;
	VirtualInvokeData _22_Clear;
	VirtualInvokeData _23_System_Collections_IList_get_IsReadOnly;
	VirtualInvokeData _24_System_Collections_IList_get_IsFixedSize;
	VirtualInvokeData _25_System_Collections_IList_IndexOf;
	VirtualInvokeData _26_System_Collections_IList_Insert;
	VirtualInvokeData _27_System_Collections_IList_Remove;
	VirtualInvokeData _28_RemoveAt;
	VirtualInvokeData _29_System_Collections_ICollection_CopyTo;
	VirtualInvokeData _30_unknown;
	VirtualInvokeData _31_System_Collections_ICollection_get_SyncRoot;
	VirtualInvokeData _32_System_Collections_ICollection_get_IsSynchronized;
	VirtualInvokeData _33_get_Item;
	VirtualInvokeData _34_get_Count;
};

struct System_Collections_Generic_List_BuffEntity__c {
	Il2CppClass_1 _1;
	struct System_Collections_Generic_List_BuffEntity__StaticFields* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	System_Collections_Generic_List_BuffEntity__VTable vtable;
};

struct System_Collections_Generic_List_BuffEntity__o {
	System_Collections_Generic_List_BuffEntity__c *klass;
	void *monitor;
	System_Collections_Generic_List_BuffEntity__Fields fields;
};


struct BuffEntity_array {
	Il2CppObject obj;
	Il2CppArrayBounds *bounds;
	il2cpp_array_size_t max_length;
	BuffEntity_o* m_Items[65535];
};
struct __declspec(align(8)) System_Collections_Generic_List_ChangeBuffLaminatedNumEffectInfo__Fields {
	struct ChangeBuffLaminatedNumEffectInfo_array* _items;
	int32_t _size;
	int32_t _version;
	Il2CppObject* _syncRoot;
};

struct __declspec(align(8)) System_Collections_Generic_List_AddEffectInfo__Fields {
	struct AddEffectInfo_array* _items;
	int32_t _size;
	int32_t _version;
	Il2CppObject* _syncRoot;
};

struct __declspec(align(8)) System_Collections_Generic_List_AdventureEffect__Fields {
	struct AdventureEffect_array* _items;
	int32_t _size;
	int32_t _version;
	Il2CppObject* _syncRoot;
};

struct AdventureEffect_array {
	Il2CppObject obj;
	Il2CppArrayBounds *bounds;
	il2cpp_array_size_t max_length;
	AdventureEffect_o* m_Items[65535];
};

struct __declspec(align(8)) System_Collections_Generic_Dictionary_int__AdventureEffect__Fields {
	struct System_Int32_array* _buckets;
	struct System_Collections_Generic_Dictionary_Entry_TKey__TValue__array* _entries;
	int32_t _count;
	int32_t _freeList;
	int32_t _freeCount;
	int32_t _version;
	struct System_Collections_Generic_IEqualityComparer_TKey__o* _comparer;
	struct System_Collections_Generic_Dictionary_KeyCollection_TKey__TValue__o* _keys;
	struct System_Collections_Generic_Dictionary_ValueCollection_TKey__TValue__o* _values;
	Il2CppObject* _syncRoot;
};

struct __declspec(align(8)) System_Collections_Generic_List_int__Fields {
	struct System_Int32_array* _items;
	int32_t _size;
	int32_t _version;
	Il2CppObject* _syncRoot;
};

struct __declspec(align(8)) System_Collections_Generic_List_ChangeBuffTimeEffectInfo__Fields {
	struct ChangeBuffTimeEffectInfo_array* _items;
	int32_t _size;
	int32_t _version;
	Il2CppObject* _syncRoot;
};

struct System_Int32_array {
	Il2CppObject obj;
	Il2CppArrayBounds *bounds;
	il2cpp_array_size_t max_length;
	int32_t m_Items[65535];
};

struct System_Collections_Generic_List_AdventureEffect__VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_unknown;
	VirtualInvokeData _5_set_Item;
	VirtualInvokeData _6_IndexOf;
	VirtualInvokeData _7_Insert;
	VirtualInvokeData _8_unknown;
	VirtualInvokeData _9_unknown;
	VirtualInvokeData _10_System_Collections_Generic_ICollection_T__get_IsReadOnly;
	VirtualInvokeData _11_Add;
	VirtualInvokeData _12_unknown;
	VirtualInvokeData _13_Contains;
	VirtualInvokeData _14_CopyTo;
	VirtualInvokeData _15_Remove;
	VirtualInvokeData _16_System_Collections_Generic_IEnumerable_T__GetEnumerator;
	VirtualInvokeData _17_System_Collections_IEnumerable_GetEnumerator;
	VirtualInvokeData _18_System_Collections_IList_get_Item;
	VirtualInvokeData _19_System_Collections_IList_set_Item;
	VirtualInvokeData _20_System_Collections_IList_Add;
	VirtualInvokeData _21_System_Collections_IList_Contains;
	VirtualInvokeData _22_Clear;
	VirtualInvokeData _23_System_Collections_IList_get_IsReadOnly;
	VirtualInvokeData _24_System_Collections_IList_get_IsFixedSize;
	VirtualInvokeData _25_System_Collections_IList_IndexOf;
	VirtualInvokeData _26_System_Collections_IList_Insert;
	VirtualInvokeData _27_System_Collections_IList_Remove;
	VirtualInvokeData _28_RemoveAt;
	VirtualInvokeData _29_System_Collections_ICollection_CopyTo;
	VirtualInvokeData _30_unknown;
	VirtualInvokeData _31_System_Collections_ICollection_get_SyncRoot;
	VirtualInvokeData _32_System_Collections_ICollection_get_IsSynchronized;
	VirtualInvokeData _33_get_Item;
	VirtualInvokeData _34_get_Count;
};

struct System_Collections_Generic_List_int__VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_unknown;
	VirtualInvokeData _5_set_Item;
	VirtualInvokeData _6_IndexOf;
	VirtualInvokeData _7_Insert;
	VirtualInvokeData _8_unknown;
	VirtualInvokeData _9_unknown;
	VirtualInvokeData _10_System_Collections_Generic_ICollection_T__get_IsReadOnly;
	VirtualInvokeData _11_Add;
	VirtualInvokeData _12_unknown;
	VirtualInvokeData _13_Contains;
	VirtualInvokeData _14_CopyTo;
	VirtualInvokeData _15_Remove;
	VirtualInvokeData _16_System_Collections_Generic_IEnumerable_T__GetEnumerator;
	VirtualInvokeData _17_System_Collections_IEnumerable_GetEnumerator;
	VirtualInvokeData _18_System_Collections_IList_get_Item;
	VirtualInvokeData _19_System_Collections_IList_set_Item;
	VirtualInvokeData _20_System_Collections_IList_Add;
	VirtualInvokeData _21_System_Collections_IList_Contains;
	VirtualInvokeData _22_Clear;
	VirtualInvokeData _23_System_Collections_IList_get_IsReadOnly;
	VirtualInvokeData _24_System_Collections_IList_get_IsFixedSize;
	VirtualInvokeData _25_System_Collections_IList_IndexOf;
	VirtualInvokeData _26_System_Collections_IList_Insert;
	VirtualInvokeData _27_System_Collections_IList_Remove;
	VirtualInvokeData _28_RemoveAt;
	VirtualInvokeData _29_System_Collections_ICollection_CopyTo;
	VirtualInvokeData _30_unknown;
	VirtualInvokeData _31_System_Collections_ICollection_get_SyncRoot;
	VirtualInvokeData _32_System_Collections_ICollection_get_IsSynchronized;
	VirtualInvokeData _33_get_Item;
	VirtualInvokeData _34_get_Count;
};

struct System_Collections_Generic_List_AddEffectInfo__VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_unknown;
	VirtualInvokeData _5_set_Item;
	VirtualInvokeData _6_IndexOf;
	VirtualInvokeData _7_Insert;
	VirtualInvokeData _8_unknown;
	VirtualInvokeData _9_unknown;
	VirtualInvokeData _10_System_Collections_Generic_ICollection_T__get_IsReadOnly;
	VirtualInvokeData _11_Add;
	VirtualInvokeData _12_unknown;
	VirtualInvokeData _13_Contains;
	VirtualInvokeData _14_CopyTo;
	VirtualInvokeData _15_Remove;
	VirtualInvokeData _16_System_Collections_Generic_IEnumerable_T__GetEnumerator;
	VirtualInvokeData _17_System_Collections_IEnumerable_GetEnumerator;
	VirtualInvokeData _18_System_Collections_IList_get_Item;
	VirtualInvokeData _19_System_Collections_IList_set_Item;
	VirtualInvokeData _20_System_Collections_IList_Add;
	VirtualInvokeData _21_System_Collections_IList_Contains;
	VirtualInvokeData _22_Clear;
	VirtualInvokeData _23_System_Collections_IList_get_IsReadOnly;
	VirtualInvokeData _24_System_Collections_IList_get_IsFixedSize;
	VirtualInvokeData _25_System_Collections_IList_IndexOf;
	VirtualInvokeData _26_System_Collections_IList_Insert;
	VirtualInvokeData _27_System_Collections_IList_Remove;
	VirtualInvokeData _28_RemoveAt;
	VirtualInvokeData _29_System_Collections_ICollection_CopyTo;
	VirtualInvokeData _30_unknown;
	VirtualInvokeData _31_System_Collections_ICollection_get_SyncRoot;
	VirtualInvokeData _32_System_Collections_ICollection_get_IsSynchronized;
	VirtualInvokeData _33_get_Item;
	VirtualInvokeData _34_get_Count;
};

struct System_Collections_Generic_List_ChangeBuffLaminatedNumEffectInfo__VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_unknown;
	VirtualInvokeData _5_set_Item;
	VirtualInvokeData _6_IndexOf;
	VirtualInvokeData _7_Insert;
	VirtualInvokeData _8_unknown;
	VirtualInvokeData _9_unknown;
	VirtualInvokeData _10_System_Collections_Generic_ICollection_T__get_IsReadOnly;
	VirtualInvokeData _11_Add;
	VirtualInvokeData _12_unknown;
	VirtualInvokeData _13_Contains;
	VirtualInvokeData _14_CopyTo;
	VirtualInvokeData _15_Remove;
	VirtualInvokeData _16_System_Collections_Generic_IEnumerable_T__GetEnumerator;
	VirtualInvokeData _17_System_Collections_IEnumerable_GetEnumerator;
	VirtualInvokeData _18_System_Collections_IList_get_Item;
	VirtualInvokeData _19_System_Collections_IList_set_Item;
	VirtualInvokeData _20_System_Collections_IList_Add;
	VirtualInvokeData _21_System_Collections_IList_Contains;
	VirtualInvokeData _22_Clear;
	VirtualInvokeData _23_System_Collections_IList_get_IsReadOnly;
	VirtualInvokeData _24_System_Collections_IList_get_IsFixedSize;
	VirtualInvokeData _25_System_Collections_IList_IndexOf;
	VirtualInvokeData _26_System_Collections_IList_Insert;
	VirtualInvokeData _27_System_Collections_IList_Remove;
	VirtualInvokeData _28_RemoveAt;
	VirtualInvokeData _29_System_Collections_ICollection_CopyTo;
	VirtualInvokeData _30_unknown;
	VirtualInvokeData _31_System_Collections_ICollection_get_SyncRoot;
	VirtualInvokeData _32_System_Collections_ICollection_get_IsSynchronized;
	VirtualInvokeData _33_get_Item;
	VirtualInvokeData _34_get_Count;
};

struct System_Collections_Generic_List_ChangeBuffTimeEffectInfo__VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_unknown;
	VirtualInvokeData _5_set_Item;
	VirtualInvokeData _6_IndexOf;
	VirtualInvokeData _7_Insert;
	VirtualInvokeData _8_unknown;
	VirtualInvokeData _9_unknown;
	VirtualInvokeData _10_System_Collections_Generic_ICollection_T__get_IsReadOnly;
	VirtualInvokeData _11_Add;
	VirtualInvokeData _12_unknown;
	VirtualInvokeData _13_Contains;
	VirtualInvokeData _14_CopyTo;
	VirtualInvokeData _15_Remove;
	VirtualInvokeData _16_System_Collections_Generic_IEnumerable_T__GetEnumerator;
	VirtualInvokeData _17_System_Collections_IEnumerable_GetEnumerator;
	VirtualInvokeData _18_System_Collections_IList_get_Item;
	VirtualInvokeData _19_System_Collections_IList_set_Item;
	VirtualInvokeData _20_System_Collections_IList_Add;
	VirtualInvokeData _21_System_Collections_IList_Contains;
	VirtualInvokeData _22_Clear;
	VirtualInvokeData _23_System_Collections_IList_get_IsReadOnly;
	VirtualInvokeData _24_System_Collections_IList_get_IsFixedSize;
	VirtualInvokeData _25_System_Collections_IList_IndexOf;
	VirtualInvokeData _26_System_Collections_IList_Insert;
	VirtualInvokeData _27_System_Collections_IList_Remove;
	VirtualInvokeData _28_RemoveAt;
	VirtualInvokeData _29_System_Collections_ICollection_CopyTo;
	VirtualInvokeData _30_unknown;
	VirtualInvokeData _31_System_Collections_ICollection_get_SyncRoot;
	VirtualInvokeData _32_System_Collections_ICollection_get_IsSynchronized;
	VirtualInvokeData _33_get_Item;
	VirtualInvokeData _34_get_Count;
};

struct System_Collections_Generic_Dictionary_int__AdventureEffect__VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_unknown;
	VirtualInvokeData _5_set_Item;
	VirtualInvokeData _6_System_Collections_Generic_IDictionary_TKey_TValue__get_Keys;
	VirtualInvokeData _7_System_Collections_Generic_IDictionary_TKey_TValue__get_Values;
	VirtualInvokeData _8_unknown;
	VirtualInvokeData _9_Add;
	VirtualInvokeData _10_Remove;
	VirtualInvokeData _11_unknown;
	VirtualInvokeData _12_unknown;
	VirtualInvokeData _13_System_Collections_Generic_ICollection_System_Collections_Generic_KeyValuePair_TKey_TValue___get_IsReadOnly;
	VirtualInvokeData _14_System_Collections_Generic_ICollection_System_Collections_Generic_KeyValuePair_TKey_TValue___Add;
	VirtualInvokeData _15_unknown;
	VirtualInvokeData _16_System_Collections_Generic_ICollection_System_Collections_Generic_KeyValuePair_TKey_TValue___Contains;
	VirtualInvokeData _17_System_Collections_Generic_ICollection_System_Collections_Generic_KeyValuePair_TKey_TValue___CopyTo;
	VirtualInvokeData _18_System_Collections_Generic_ICollection_System_Collections_Generic_KeyValuePair_TKey_TValue___Remove;
	VirtualInvokeData _19_System_Collections_Generic_IEnumerable_System_Collections_Generic_KeyValuePair_TKey_TValue___GetEnumerator;
	VirtualInvokeData _20_System_Collections_IEnumerable_GetEnumerator;
	VirtualInvokeData _21_System_Collections_IDictionary_get_Item;
	VirtualInvokeData _22_System_Collections_IDictionary_set_Item;
	VirtualInvokeData _23_System_Collections_IDictionary_get_Keys;
	VirtualInvokeData _24_System_Collections_IDictionary_get_Values;
	VirtualInvokeData _25_System_Collections_IDictionary_Contains;
	VirtualInvokeData _26_System_Collections_IDictionary_Add;
	VirtualInvokeData _27_Clear;
	VirtualInvokeData _28_System_Collections_IDictionary_get_IsReadOnly;
	VirtualInvokeData _29_System_Collections_IDictionary_get_IsFixedSize;
	VirtualInvokeData _30_System_Collections_IDictionary_GetEnumerator;
	VirtualInvokeData _31_System_Collections_IDictionary_Remove;
	VirtualInvokeData _32_System_Collections_ICollection_CopyTo;
	VirtualInvokeData _33_unknown;
	VirtualInvokeData _34_System_Collections_ICollection_get_SyncRoot;
	VirtualInvokeData _35_System_Collections_ICollection_get_IsSynchronized;
	VirtualInvokeData _36_ContainsKey;
	VirtualInvokeData _37_TryGetValue;
	VirtualInvokeData _38_get_Item;
	VirtualInvokeData _39_System_Collections_Generic_IReadOnlyDictionary_TKey_TValue__get_Keys;
	VirtualInvokeData _40_System_Collections_Generic_IReadOnlyDictionary_TKey_TValue__get_Values;
	VirtualInvokeData _41_get_Count;
	VirtualInvokeData _42_unknown;
	VirtualInvokeData _43_unknown;
	VirtualInvokeData _44_GetObjectData;
	VirtualInvokeData _45_OnDeserialization;
};

struct System_Collections_Generic_List_AdventureEffect__c {
	Il2CppClass_1 _1;
	struct System_Collections_Generic_List_AdventureEffect__StaticFields* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	System_Collections_Generic_List_AdventureEffect__VTable vtable;
};

struct System_Collections_Generic_List_int__c {
	Il2CppClass_1 _1;
	struct System_Collections_Generic_List_int__StaticFields* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	System_Collections_Generic_List_int__VTable vtable;
};

struct System_Collections_Generic_List_AddEffectInfo__c {
	Il2CppClass_1 _1;
	struct System_Collections_Generic_List_AddEffectInfo__StaticFields* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	System_Collections_Generic_List_AddEffectInfo__VTable vtable;
};

struct System_Collections_Generic_List_ChangeBuffLaminatedNumEffectInfo__c {
	Il2CppClass_1 _1;
	struct System_Collections_Generic_List_ChangeBuffLaminatedNumEffectInfo__StaticFields* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	System_Collections_Generic_List_ChangeBuffLaminatedNumEffectInfo__VTable vtable;
};

struct System_Collections_Generic_List_ChangeBuffTimeEffectInfo__c {
	Il2CppClass_1 _1;
	struct System_Collections_Generic_List_ChangeBuffTimeEffectInfo__StaticFields* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	System_Collections_Generic_List_ChangeBuffTimeEffectInfo__VTable vtable;
};

struct System_Collections_Generic_Dictionary_int__AdventureEffect__c {
	Il2CppClass_1 _1;
	void* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	System_Collections_Generic_Dictionary_int__AdventureEffect__VTable vtable;
};

struct System_Collections_Generic_List_AdventureEffect__o {
	System_Collections_Generic_List_AdventureEffect__c *klass;
	void *monitor;
	System_Collections_Generic_List_AdventureEffect__Fields fields;
};

struct System_Collections_Generic_List_int__o {
	System_Collections_Generic_List_int__c *klass;
	void *monitor;
	System_Collections_Generic_List_int__Fields fields;
};

struct System_Collections_Generic_List_AddEffectInfo__o {
	System_Collections_Generic_List_AddEffectInfo__c *klass;
	void *monitor;
	System_Collections_Generic_List_AddEffectInfo__Fields fields;
};

struct System_Collections_Generic_List_ChangeBuffLaminatedNumEffectInfo__o {
	System_Collections_Generic_List_ChangeBuffLaminatedNumEffectInfo__c *klass;
	void *monitor;
	System_Collections_Generic_List_ChangeBuffLaminatedNumEffectInfo__Fields fields;
};

struct System_Collections_Generic_List_ChangeBuffTimeEffectInfo__o {
	System_Collections_Generic_List_ChangeBuffTimeEffectInfo__c *klass;
	void *monitor;
	System_Collections_Generic_List_ChangeBuffTimeEffectInfo__Fields fields;
};

struct System_Collections_Generic_Dictionary_int__AdventureEffect__o {
	System_Collections_Generic_Dictionary_int__AdventureEffect__c *klass;
	void *monitor;
	System_Collections_Generic_Dictionary_int__AdventureEffect__Fields fields;
};

struct System_Collections_Generic_Dictionary_Entry_TKey__TValue__Fields {
	int32_t hashCode;
	int32_t next;
	Il2CppObject* key;
	Il2CppObject* value;
};

struct System_Collections_Generic_Dictionary_Entry_TKey__TValue__o {
	System_Collections_Generic_Dictionary_Entry_TKey__TValue__Fields fields;
};

struct System_Collections_Generic_Dictionary_Entry_TKey__TValue__array {
	Il2CppObject obj;
	Il2CppArrayBounds *bounds;
	il2cpp_array_size_t max_length;
	System_Collections_Generic_Dictionary_Entry_TKey__TValue__o m_Items[65535];
};

// The generic Entry above is for reference-typed values (key/value are pointers).
// Value-type dictionaries (Dictionary<int,int>, Dictionary<int,FDP>) use these
// mirrored layouts instead — key/value are stored inline, not boxed.
struct System_Collections_Generic_Dictionary_Entry_int__int__Fields {
	int32_t hashCode;
	int32_t next;
	int32_t key;
	int32_t value;
};
struct System_Collections_Generic_Dictionary_Entry_int__int__o {
	System_Collections_Generic_Dictionary_Entry_int__int__Fields fields;
};
struct System_Collections_Generic_Dictionary_Entry_int__int__array {
	Il2CppObject obj;
	Il2CppArrayBounds *bounds;
	il2cpp_array_size_t max_length;
	System_Collections_Generic_Dictionary_Entry_int__int__o m_Items[65535];
};

struct __declspec(align(8)) System_Collections_Generic_Dictionary_Entry_int__FDP__Fields {
	int32_t hashCode;
	int32_t next;
	int32_t key;
	int64_t value;
};
struct System_Collections_Generic_Dictionary_Entry_int__FDP__o {
	System_Collections_Generic_Dictionary_Entry_int__FDP__Fields fields;
};
struct System_Collections_Generic_Dictionary_Entry_int__FDP__array {
	Il2CppObject obj;
	Il2CppArrayBounds *bounds;
	il2cpp_array_size_t max_length;
	System_Collections_Generic_Dictionary_Entry_int__FDP__o m_Items[65535];
};

struct __declspec(align(8)) System_String_Fields {
	int32_t _stringLength;
	uint16_t _firstChar;
};

struct System_String_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_CompareTo;
	VirtualInvokeData _5_System_Collections_IEnumerable_GetEnumerator;
	VirtualInvokeData _6_System_Collections_Generic_IEnumerable_System_Char__GetEnumerator;
	VirtualInvokeData _7_CompareTo;
	VirtualInvokeData _8_Equals;
	VirtualInvokeData _9_GetTypeCode;
	VirtualInvokeData _10_System_IConvertible_ToBoolean;
	VirtualInvokeData _11_System_IConvertible_ToChar;
	VirtualInvokeData _12_System_IConvertible_ToSByte;
	VirtualInvokeData _13_System_IConvertible_ToByte;
	VirtualInvokeData _14_System_IConvertible_ToInt16;
	VirtualInvokeData _15_System_IConvertible_ToUInt16;
	VirtualInvokeData _16_System_IConvertible_ToInt32;
	VirtualInvokeData _17_System_IConvertible_ToUInt32;
	VirtualInvokeData _18_System_IConvertible_ToInt64;
	VirtualInvokeData _19_System_IConvertible_ToUInt64;
	VirtualInvokeData _20_System_IConvertible_ToSingle;
	VirtualInvokeData _21_System_IConvertible_ToDouble;
	VirtualInvokeData _22_System_IConvertible_ToDecimal;
	VirtualInvokeData _23_System_IConvertible_ToDateTime;
	VirtualInvokeData _24_ToString;
	VirtualInvokeData _25_System_IConvertible_ToType;
	VirtualInvokeData _26_Clone;
};

struct System_String_c {
	Il2CppClass_1 _1;
	struct System_String_StaticFields* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	System_String_VTable vtable;
};

struct System_String_o {
	System_String_c *klass;
	void *monitor;
	System_String_Fields fields;
};

struct SpecialAttributeEntry_Fields {
	int64_t current;
	int32_t max_type;
};

struct AttributeEntry_Fields {
	int64_t origin;
	int64_t baseAmend;
	int64_t percentAmend;
	int64_t absAmend;
};

struct SpecialAttributeEntry_o {
	SpecialAttributeEntry_Fields fields;
};

struct AttributeEntry_o {
	AttributeEntry_Fields fields;
};

struct SpecialAttributeEntry_array {
	Il2CppObject obj;
	Il2CppArrayBounds *bounds;
	il2cpp_array_size_t max_length;
	SpecialAttributeEntry_o m_Items[65535];
};

struct AttributeEntry_array {
	Il2CppObject obj;
	Il2CppArrayBounds *bounds;
	il2cpp_array_size_t max_length;
	AttributeEntry_o m_Items[65535];
};

struct __declspec(align(8)) YoStar_SDK_Net_Request_Fields {
	struct YoStar_SDK_Net_RetryManage_o* _RetryManage_k__BackingField;
	struct System_String_o* _CurrentHost_k__BackingField;
	struct System_String_o* _PrimaryHost_k__BackingField;
	struct System_String_o* _BackupHost_k__BackingField;
	struct System_String_o* _Endpoint_k__BackingField;
	int32_t _TimeOut_k__BackingField;
	struct System_Collections_Generic_Dictionary_string__object__o* _requestHead_k__BackingField;
	struct System_Collections_Generic_Dictionary_string__object__o* _requestBody_k__BackingField;
};

struct __declspec(align(8)) YoStar_SDK_Net_ResponseResult_T__Fields {
	int32_t _code_k__BackingField;
	struct System_String_o* _msg_k__BackingField;
	Il2CppObject* _data_k__BackingField;
};

struct __declspec(align(8)) YoStar_SDK_Net_Response_object__Fields {
	int64_t _HttpCode_k__BackingField;
	bool _Timeout_k__BackingField;
	struct System_String_o* _AuthInfo_k__BackingField;
	struct YoStar_SDK_Net_ResponseResult_T__o* _responseResult_k__BackingField;
	struct YoStar_SDK_Net_Request_o* _Request_k__BackingField;
};
struct YoStar_SDK_Net_Request_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
};

struct YoStar_SDK_Net_ResponseResult_T__VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
};

struct YoStar_SDK_Net_Response_object__VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
};

struct YoStar_SDK_Net_Response_object__c {
	Il2CppClass_1 _1;
	void* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	YoStar_SDK_Net_Response_object__VTable vtable;
};

struct YoStar_SDK_Net_ResponseResult_T__RGCTXs {
	Il2CppClass* _0_YoStar_SDK_Net_ResponseResult_T_;
	Il2CppClass* _1_T;
	MethodInfo* _2_YoStar_SDK_Net_ResponseResult_T__set_code;
	MethodInfo* _3_YoStar_SDK_Net_ResponseResult_T__set_msg;
	MethodInfo* _4_YoStar_SDK_Net_ResponseResult_T__set_data;
};

struct YoStar_SDK_Net_ResponseResult_T__c {
	Il2CppClass_1 _1;
	void* static_fields;
	YoStar_SDK_Net_ResponseResult_T__RGCTXs* rgctx_data;
	Il2CppClass_2 _2;
	YoStar_SDK_Net_ResponseResult_T__VTable vtable;
};

struct YoStar_SDK_Net_Request_c {
	Il2CppClass_1 _1;
	void* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	YoStar_SDK_Net_Request_VTable vtable;
};

struct YoStar_SDK_Net_Response_object__o {
	YoStar_SDK_Net_Response_object__c *klass;
	void *monitor;
	YoStar_SDK_Net_Response_object__Fields fields;
};

struct YoStar_SDK_Net_ResponseResult_T__o {
	YoStar_SDK_Net_ResponseResult_T__c *klass;
	void *monitor;
	YoStar_SDK_Net_ResponseResult_T__Fields fields;
};

struct YoStar_SDK_Net_Request_o {
	YoStar_SDK_Net_Request_c *klass;
	void *monitor;
	YoStar_SDK_Net_Request_Fields fields;
};

struct __declspec(align(8)) HttpNetMsg_Fields {
	int16_t msgId;
	struct System_Byte_array* msgBody;
	struct System_Action_HttpNetMsg__object__o* callback;
	int16_t receiveMsgId;
};

struct HttpNetMsg_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
};

struct HttpNetMsg_c {
	Il2CppClass_1 _1;
	void* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	HttpNetMsg_VTable vtable;
};

struct HttpNetMsg_o {
	HttpNetMsg_c *klass;
	void *monitor;
	HttpNetMsg_Fields fields;
};

struct System_Byte_array {
	Il2CppObject obj;
	Il2CppArrayBounds *bounds;
	il2cpp_array_size_t max_length;
	uint8_t m_Items[65535];
};

struct AdventureActor_StaticFields {
	int32_t simplePlayerTag;
	struct LogicEntity_o* fromEntityTemp;
	struct AdventureWeapon_o* fromWeaponTemp;
	struct AreaEffectEntity_o* fromAreaTemp;
	struct AdventureActor_o* fromActorTemp;
	struct AdventureActor_o* toActor;
	struct ActorAdditionalAttrInfo_o* fromAdditionalAttrInfo;
	struct ActorAdditionalAttrInfo_o* toAdditionalAttrInfo;
	struct System_Collections_Generic_HashSet_GameEnum_elementType__o* toWeakElementTemp;
	int32_t toElementTypeTemp;
	struct UnityEngine_GameObject_o* hurtEffectPrefabTemp;
	struct HitBox_o* hitboxTemp;
	bool isHittedEffectScaleTemp;
	int32_t uniqueAttackIdTemp;
	int32_t damageTypeTemp;
	int32_t onceAttackTargetCountTemp;
	int32_t hitDamageIdTemp;
	struct Nova_Client_HitDamage_o* hitDamageConfigTemp;
	int32_t skillLevelTemp;
	bool showHudTemp;
	int64_t areaEffectIdTemp;
	bool effectIgnoreTimeScaleTemp;
	struct TrueSync_FP_o knockBackDistancePercentTemp;
	int32_t hudColorIndexTemp;
	bool isPlayShakeAnim;
	struct System_Collections_Generic_Dictionary_int__int__o* fromAdditionalAttrDict;
	struct System_Collections_Generic_Dictionary_int__int__o* toAdditionalAttrDict;
	struct TrueSync_FP_o addEnergyForMainControlTemp;
	struct System_Collections_Generic_List_GameEnum_stateAttributeType__o* strongControlStatusEffects;
	struct System_Collections_Generic_List_GameEnum_stateAttributeType__o* weakControlStatusEffects;
};

// MonsterSummonInfo / SummonCfg — copied from the il2cpp dump (only these three
// classes are needed by the summon hooks).
struct __declspec(align(8)) SummonCfg_Fields {
	int32_t summonType;
	int32_t summonFollowType;
	int32_t summonAttrType;
	int32_t summonRelation;
	int32_t attrPercent;
	struct TrueSync_FP_o leftTime;
	int32_t maxCount;
	bool retainWhenCrossLevel;
	bool useSummonHit;
};
struct SummonCfg_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
};
struct SummonCfg_c {
	Il2CppClass_1 _1;
	void* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	SummonCfg_VTable vtable;
};
struct SummonCfg_o {
	SummonCfg_c *klass;
	void *monitor;
	SummonCfg_Fields fields;
};

struct __declspec(align(8)) LogicComponent_Fields {
	struct LogicEntity_o* _Entity_k__BackingField;
	bool active;
};
struct LogicComponent_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_get_ActiveSelf;
	VirtualInvokeData _5_set_ActiveSelf;
	VirtualInvokeData _6_SetEntity;
	VirtualInvokeData _7_Init;
	VirtualInvokeData _8_unknown;
	VirtualInvokeData _9_unknown;
	VirtualInvokeData _10_Shutdown;
	VirtualInvokeData _11_OnActive;
	VirtualInvokeData _12_OnDeactive;
	VirtualInvokeData _13_OnInit;
	VirtualInvokeData _14_OnShutdown;
};
struct LogicComponent_c {
	Il2CppClass_1 _1;
	void* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	LogicComponent_VTable vtable;
};
struct LogicComponent_o {
	LogicComponent_c *klass;
	void *monitor;
	LogicComponent_Fields fields;
};

struct MonsterSummonInfo_Fields : LogicComponent_Fields {
	struct AdventureActor_o* _SummonActor_k__BackingField;
	struct SummonCfg_o* _SummonCfg_k__BackingField;
	int32_t _SummonType_k__BackingField;
	bool _IsCoexisted_k__BackingField;
	bool _HaveLeftTime_k__BackingField;
	struct TrueSync_FP_o _LeftTime_k__BackingField;
	bool _UseSummonHit_k__BackingField;
	bool _isDestroy;
};
struct MonsterSummonInfo_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_get_ActiveSelf;
	VirtualInvokeData _5_set_ActiveSelf;
	VirtualInvokeData _6_SetEntity;
	VirtualInvokeData _7_Init;
	VirtualInvokeData _8_unknown;
	VirtualInvokeData _9_unknown;
	VirtualInvokeData _10_Shutdown;
	VirtualInvokeData _11_OnActive;
	VirtualInvokeData _12_OnDeactive;
	VirtualInvokeData _13_OnInit;
	VirtualInvokeData _14_OnShutdown;
	VirtualInvokeData _15_OnLogicUpdate;
};
struct MonsterSummonInfo_c {
	Il2CppClass_1 _1;
	void* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	MonsterSummonInfo_VTable vtable;
};
struct MonsterSummonInfo_o {
	MonsterSummonInfo_c *klass;
	void *monitor;
	MonsterSummonInfo_Fields fields;
};

struct __declspec(align(8)) ActorAdditionalAttrInfo_Fields {
	struct AttributeList_o* _attributeList_k__BackingField;
	bool _forceCrit_k__BackingField;
	bool _forceMissDamage_k__BackingField;
	struct System_Collections_Generic_Dictionary_int__FDP__o* attributeWithElementOrDamageTypeDict;
};

struct ActorAdditionalAttrInfo_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
};

struct ActorAdditionalAttrInfo_c {
	Il2CppClass_1 _1;
	void* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	ActorAdditionalAttrInfo_VTable vtable;
};

struct ActorAdditionalAttrInfo_o {
	ActorAdditionalAttrInfo_c *klass;
	void *monitor;
	ActorAdditionalAttrInfo_Fields fields;
};

struct __declspec(align(8)) System_Collections_Generic_Dictionary_int__FDP__Fields {
	struct System_Int32_array* _buckets;
	struct System_Collections_Generic_Dictionary_Entry_TKey__TValue__array* _entries;
	int32_t _count;
	int32_t _freeList;
	int32_t _freeCount;
	int32_t _version;
	struct System_Collections_Generic_IEqualityComparer_TKey__o* _comparer;
	struct System_Collections_Generic_Dictionary_KeyCollection_TKey__TValue__o* _keys;
	struct System_Collections_Generic_Dictionary_ValueCollection_TKey__TValue__o* _values;
	Il2CppObject* _syncRoot;
};
struct System_Collections_Generic_Dictionary_int__FDP__VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_unknown;
	VirtualInvokeData _5_set_Item;
	VirtualInvokeData _6_System_Collections_Generic_IDictionary_TKey_TValue__get_Keys;
	VirtualInvokeData _7_System_Collections_Generic_IDictionary_TKey_TValue__get_Values;
	VirtualInvokeData _8_unknown;
	VirtualInvokeData _9_Add;
	VirtualInvokeData _10_Remove;
	VirtualInvokeData _11_unknown;
	VirtualInvokeData _12_unknown;
	VirtualInvokeData _13_System_Collections_Generic_ICollection_System_Collections_Generic_KeyValuePair_TKey_TValue___get_IsReadOnly;
	VirtualInvokeData _14_System_Collections_Generic_ICollection_System_Collections_Generic_KeyValuePair_TKey_TValue___Add;
	VirtualInvokeData _15_unknown;
	VirtualInvokeData _16_System_Collections_Generic_ICollection_System_Collections_Generic_KeyValuePair_TKey_TValue___Contains;
	VirtualInvokeData _17_System_Collections_Generic_ICollection_System_Collections_Generic_KeyValuePair_TKey_TValue___CopyTo;
	VirtualInvokeData _18_System_Collections_Generic_ICollection_System_Collections_Generic_KeyValuePair_TKey_TValue___Remove;
	VirtualInvokeData _19_System_Collections_Generic_IEnumerable_System_Collections_Generic_KeyValuePair_TKey_TValue___GetEnumerator;
	VirtualInvokeData _20_System_Collections_IEnumerable_GetEnumerator;
	VirtualInvokeData _21_System_Collections_IDictionary_get_Item;
	VirtualInvokeData _22_System_Collections_IDictionary_set_Item;
	VirtualInvokeData _23_System_Collections_IDictionary_get_Keys;
	VirtualInvokeData _24_System_Collections_IDictionary_get_Values;
	VirtualInvokeData _25_System_Collections_IDictionary_Contains;
	VirtualInvokeData _26_System_Collections_IDictionary_Add;
	VirtualInvokeData _27_Clear;
	VirtualInvokeData _28_System_Collections_IDictionary_get_IsReadOnly;
	VirtualInvokeData _29_System_Collections_IDictionary_get_IsFixedSize;
	VirtualInvokeData _30_System_Collections_IDictionary_GetEnumerator;
	VirtualInvokeData _31_System_Collections_IDictionary_Remove;
	VirtualInvokeData _32_System_Collections_ICollection_CopyTo;
	VirtualInvokeData _33_unknown;
	VirtualInvokeData _34_System_Collections_ICollection_get_SyncRoot;
	VirtualInvokeData _35_System_Collections_ICollection_get_IsSynchronized;
	VirtualInvokeData _36_ContainsKey;
	VirtualInvokeData _37_TryGetValue;
	VirtualInvokeData _38_get_Item;
	VirtualInvokeData _39_System_Collections_Generic_IReadOnlyDictionary_TKey_TValue__get_Keys;
	VirtualInvokeData _40_System_Collections_Generic_IReadOnlyDictionary_TKey_TValue__get_Values;
	VirtualInvokeData _41_get_Count;
	VirtualInvokeData _42_unknown;
	VirtualInvokeData _43_unknown;
	VirtualInvokeData _44_GetObjectData;
	VirtualInvokeData _45_OnDeserialization;
};
struct System_Collections_Generic_Dictionary_int__FDP__c {
	Il2CppClass_1 _1;
	void* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	System_Collections_Generic_Dictionary_int__FDP__VTable vtable;
};
struct System_Collections_Generic_Dictionary_int__FDP__o {
	System_Collections_Generic_Dictionary_int__FDP__c *klass;
	void *monitor;
	System_Collections_Generic_Dictionary_int__FDP__Fields fields;
};

struct __declspec(align(8)) System_Collections_Generic_Dictionary_int__int__Fields {
	struct System_Int32_array* _buckets;
	struct System_Collections_Generic_Dictionary_Entry_TKey__TValue__array* _entries;
	int32_t _count;
	int32_t _freeList;
	int32_t _freeCount;
	int32_t _version;
	struct System_Collections_Generic_IEqualityComparer_TKey__o* _comparer;
	struct System_Collections_Generic_Dictionary_KeyCollection_TKey__TValue__o* _keys;
	struct System_Collections_Generic_Dictionary_ValueCollection_TKey__TValue__o* _values;
	Il2CppObject* _syncRoot;
};
struct System_Collections_Generic_Dictionary_int__int__VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_unknown;
	VirtualInvokeData _5_set_Item;
	VirtualInvokeData _6_System_Collections_Generic_IDictionary_TKey_TValue__get_Keys;
	VirtualInvokeData _7_System_Collections_Generic_IDictionary_TKey_TValue__get_Values;
	VirtualInvokeData _8_unknown;
	VirtualInvokeData _9_Add;
	VirtualInvokeData _10_Remove;
	VirtualInvokeData _11_unknown;
	VirtualInvokeData _12_unknown;
	VirtualInvokeData _13_System_Collections_Generic_ICollection_System_Collections_Generic_KeyValuePair_TKey_TValue___get_IsReadOnly;
	VirtualInvokeData _14_System_Collections_Generic_ICollection_System_Collections_Generic_KeyValuePair_TKey_TValue___Add;
	VirtualInvokeData _15_unknown;
	VirtualInvokeData _16_System_Collections_Generic_ICollection_System_Collections_Generic_KeyValuePair_TKey_TValue___Contains;
	VirtualInvokeData _17_System_Collections_Generic_ICollection_System_Collections_Generic_KeyValuePair_TKey_TValue___CopyTo;
	VirtualInvokeData _18_System_Collections_Generic_ICollection_System_Collections_Generic_KeyValuePair_TKey_TValue___Remove;
	VirtualInvokeData _19_System_Collections_Generic_IEnumerable_System_Collections_Generic_KeyValuePair_TKey_TValue___GetEnumerator;
	VirtualInvokeData _20_System_Collections_IEnumerable_GetEnumerator;
	VirtualInvokeData _21_System_Collections_IDictionary_get_Item;
	VirtualInvokeData _22_System_Collections_IDictionary_set_Item;
	VirtualInvokeData _23_System_Collections_IDictionary_get_Keys;
	VirtualInvokeData _24_System_Collections_IDictionary_get_Values;
	VirtualInvokeData _25_System_Collections_IDictionary_Contains;
	VirtualInvokeData _26_System_Collections_IDictionary_Add;
	VirtualInvokeData _27_Clear;
	VirtualInvokeData _28_System_Collections_IDictionary_get_IsReadOnly;
	VirtualInvokeData _29_System_Collections_IDictionary_get_IsFixedSize;
	VirtualInvokeData _30_System_Collections_IDictionary_GetEnumerator;
	VirtualInvokeData _31_System_Collections_IDictionary_Remove;
	VirtualInvokeData _32_System_Collections_ICollection_CopyTo;
	VirtualInvokeData _33_unknown;
	VirtualInvokeData _34_System_Collections_ICollection_get_SyncRoot;
	VirtualInvokeData _35_System_Collections_ICollection_get_IsSynchronized;
	VirtualInvokeData _36_ContainsKey;
	VirtualInvokeData _37_TryGetValue;
	VirtualInvokeData _38_get_Item;
	VirtualInvokeData _39_System_Collections_Generic_IReadOnlyDictionary_TKey_TValue__get_Keys;
	VirtualInvokeData _40_System_Collections_Generic_IReadOnlyDictionary_TKey_TValue__get_Values;
	VirtualInvokeData _41_get_Count;
	VirtualInvokeData _42_unknown;
	VirtualInvokeData _43_unknown;
	VirtualInvokeData _44_GetObjectData;
	VirtualInvokeData _45_OnDeserialization;
};
struct System_Collections_Generic_Dictionary_int__int__c {
	Il2CppClass_1 _1;
	void* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	System_Collections_Generic_Dictionary_int__int__VTable vtable;
};
struct System_Collections_Generic_Dictionary_int__int__o {
	System_Collections_Generic_Dictionary_int__int__c *klass;
	void *monitor;
	System_Collections_Generic_Dictionary_int__int__Fields fields;
};

struct __declspec(align(8)) System_Collections_Generic_Dictionary_GameEnum_effectAttributeType__double__Fields {
	struct System_Int32_array* _buckets;
	struct System_Collections_Generic_Dictionary_Entry_TKey__TValue__array* _entries;
	int32_t _count;
	int32_t _freeList;
	int32_t _freeCount;
	int32_t _version;
	struct System_Collections_Generic_IEqualityComparer_TKey__o* _comparer;
	struct System_Collections_Generic_Dictionary_KeyCollection_TKey__TValue__o* _keys;
	struct System_Collections_Generic_Dictionary_ValueCollection_TKey__TValue__o* _values;
	Il2CppObject* _syncRoot;
};

struct System_Collections_Generic_Dictionary_GameEnum_effectAttributeType__double__VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_unknown;
	VirtualInvokeData _5_set_Item;
	VirtualInvokeData _6_System_Collections_Generic_IDictionary_TKey_TValue__get_Keys;
	VirtualInvokeData _7_System_Collections_Generic_IDictionary_TKey_TValue__get_Values;
	VirtualInvokeData _8_unknown;
	VirtualInvokeData _9_Add;
	VirtualInvokeData _10_Remove;
	VirtualInvokeData _11_unknown;
	VirtualInvokeData _12_unknown;
	VirtualInvokeData _13_System_Collections_Generic_ICollection_System_Collections_Generic_KeyValuePair_TKey_TValue___get_IsReadOnly;
	VirtualInvokeData _14_System_Collections_Generic_ICollection_System_Collections_Generic_KeyValuePair_TKey_TValue___Add;
	VirtualInvokeData _15_unknown;
	VirtualInvokeData _16_System_Collections_Generic_ICollection_System_Collections_Generic_KeyValuePair_TKey_TValue___Contains;
	VirtualInvokeData _17_System_Collections_Generic_ICollection_System_Collections_Generic_KeyValuePair_TKey_TValue___CopyTo;
	VirtualInvokeData _18_System_Collections_Generic_ICollection_System_Collections_Generic_KeyValuePair_TKey_TValue___Remove;
	VirtualInvokeData _19_System_Collections_Generic_IEnumerable_System_Collections_Generic_KeyValuePair_TKey_TValue___GetEnumerator;
	VirtualInvokeData _20_System_Collections_IEnumerable_GetEnumerator;
	VirtualInvokeData _21_System_Collections_IDictionary_get_Item;
	VirtualInvokeData _22_System_Collections_IDictionary_set_Item;
	VirtualInvokeData _23_System_Collections_IDictionary_get_Keys;
	VirtualInvokeData _24_System_Collections_IDictionary_get_Values;
	VirtualInvokeData _25_System_Collections_IDictionary_Contains;
	VirtualInvokeData _26_System_Collections_IDictionary_Add;
	VirtualInvokeData _27_Clear;
	VirtualInvokeData _28_System_Collections_IDictionary_get_IsReadOnly;
	VirtualInvokeData _29_System_Collections_IDictionary_get_IsFixedSize;
	VirtualInvokeData _30_System_Collections_IDictionary_GetEnumerator;
	VirtualInvokeData _31_System_Collections_IDictionary_Remove;
	VirtualInvokeData _32_System_Collections_ICollection_CopyTo;
	VirtualInvokeData _33_unknown;
	VirtualInvokeData _34_System_Collections_ICollection_get_SyncRoot;
	VirtualInvokeData _35_System_Collections_ICollection_get_IsSynchronized;
	VirtualInvokeData _36_ContainsKey;
	VirtualInvokeData _37_TryGetValue;
	VirtualInvokeData _38_get_Item;
	VirtualInvokeData _39_System_Collections_Generic_IReadOnlyDictionary_TKey_TValue__get_Keys;
	VirtualInvokeData _40_System_Collections_Generic_IReadOnlyDictionary_TKey_TValue__get_Values;
	VirtualInvokeData _41_get_Count;
	VirtualInvokeData _42_unknown;
	VirtualInvokeData _43_unknown;
	VirtualInvokeData _44_GetObjectData;
	VirtualInvokeData _45_OnDeserialization;
};

struct System_Collections_Generic_Dictionary_GameEnum_effectAttributeType__double__c {
	Il2CppClass_1 _1;
	void* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	System_Collections_Generic_Dictionary_GameEnum_effectAttributeType__double__VTable vtable;
};

struct System_Collections_Generic_Dictionary_GameEnum_effectAttributeType__double__o {
	System_Collections_Generic_Dictionary_GameEnum_effectAttributeType__double__c *klass;
	void *monitor;
	System_Collections_Generic_Dictionary_GameEnum_effectAttributeType__double__Fields fields;
};

struct UnityEngine_Color_Fields {
	float r;
	float g;
	float b;
	float a;
};
struct UnityEngine_Color_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_Equals;
	VirtualInvokeData _5_ToString;
};
struct UnityEngine_Color_c {
	Il2CppClass_1 _1;
	void* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	UnityEngine_Color_VTable vtable;
};
struct UnityEngine_Color_o {
	UnityEngine_Color_Fields fields;
};

struct PlayerAdventureActor_Fields : AdventureActor_Fields {
	struct AdventureLevelObjPoolMgr_PoolObj_o* spawnPoolObj;
	struct PlayerSkillCd_o* playerSkillCd;
	struct PlayerAIInfo_o* playerAIInfo;
	bool isAssist;
	bool isAssistAIFinish;
	struct AdventureActor_o* assistWitchTimeTarget;
	bool isResident;
	bool isResidentAssist;
	bool isAssistStartLeave;
	bool isAssistLeaving;
	int32_t status;
	struct TrueSync_FP_o specialStatusTime;
	int32_t searchType;
	int32_t moveControlType;
	bool enableReload;
	bool enableIndependentRushSkill;
	bool isSkin;
	struct ComboGroup_o* comboGroupForSkin;
	struct System_Collections_Generic_Dictionary_string__ComboClip__o* overrideComboClipsForSkin;
	bool isPreventNormalAttackByObstacle;
	bool isBornForceMove;
	struct AttributeEntry_array* playerEntries;
	struct AttributeList_o* attributeListOfInitialSnapshot;
	struct System_Collections_Generic_Dictionary_int__FDP__o* attributeWithElementOrDamageTypeDictOfInitialSnapshot;
	struct System_Action_o* dodgeSkillActivationEndEvent;
	struct System_Collections_Generic_Dictionary_ActionKey__ActionCondition__o* _actionConditionDict;
	bool _movementHasInput;
	struct TrueSync_TSVector2_o _movementInputVector;
	struct TrueSync_TSVector2_o _MovementInputDirection_k__BackingField;
	bool _actived_k__BackingField;
	bool dodgeButtonHold;
	bool switchToRush;
	struct IEvent_o* _evt;
	bool enterElevator;
	struct UnityEngine_Transform_o* elevatorFloor;
	struct PlayerAdventureActor_SerializableDictionary_string__string__o* localData;
	struct System_Collections_Generic_List_TSVector__o* points;
};
struct PlayerAdventureActor_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_get_Id;
	VirtualInvokeData _5_get_ActiveSelf;
	VirtualInvokeData _6_AddLogicComponent;
	VirtualInvokeData _7_GetLogicComponent;
	VirtualInvokeData _8_GetLogicComponent;
	VirtualInvokeData _9_AddOrGetLogicComponent;
	VirtualInvokeData _10_AddMonoLogicComponent;
	VirtualInvokeData _11_AddOrGetMonoLogicComponent;
	VirtualInvokeData _12_IsCoroutineAlive;
	VirtualInvokeData _13_IsCoroutineRunning;
	VirtualInvokeData _14_GetCoroutineDeltaTime;
	VirtualInvokeData _15_OnActive;
	VirtualInvokeData _16_OnDeactive;
	VirtualInvokeData _17_OnInit;
	VirtualInvokeData _18_OnShutdown;
	VirtualInvokeData _19_OnLogicUpdateEnabled;
	VirtualInvokeData _20_OnLogicUpdateDisabled;
	VirtualInvokeData _21_OnLogicUpdatePaused;
	VirtualInvokeData _22_OnLogicUpdateResumed;
	VirtualInvokeData _23_OnLogicStart;
	VirtualInvokeData _24_OnLogicUpdate;
	VirtualInvokeData _25_OnLogicTimeScaleChanged;
	VirtualInvokeData _26_OnVisualUpdate;
	VirtualInvokeData _27_QueryHitBoxContextTime;
	VirtualInvokeData _28_QueryHitBoxContextPosition;
	VirtualInvokeData _29_QueryHitBoxContextDirection;
	VirtualInvokeData _30_QueryActorHitedTimeout;
	VirtualInvokeData _31_SetActorHitedTime;
	VirtualInvokeData _32_CheckHitable;
	VirtualInvokeData _33_OnHitActor;
	VirtualInvokeData _34_OnHitShield;
	VirtualInvokeData _35_OnHitObstacle;
	VirtualInvokeData _36_OnHitDestructibleObstacle;
	VirtualInvokeData _37_OnDeterministicCollisionEnter;
	VirtualInvokeData _38_OnDeterministicCollisionStay;
	VirtualInvokeData _39_OnDeterministicCollisionExit;
	VirtualInvokeData _40_OnStateTransformation;
	VirtualInvokeData _41_OnStateMachineTransformation;
	VirtualInvokeData _42_LevelStart;
	VirtualInvokeData _43_LevelEnd;
	VirtualInvokeData _44_OnAttributeListValueChange;
	VirtualInvokeData _45_OnHpChangedEvent;
	VirtualInvokeData _46_OnAliveChangedEvent;
	VirtualInvokeData _47_OnShieldChangedEvent;
	VirtualInvokeData _48_OnShow;
	VirtualInvokeData _49_OnEnterDeterministicCollision;
	VirtualInvokeData _50_OnStayDeterministicCollision;
	VirtualInvokeData _51_OnExitDeterministicCollision;
	VirtualInvokeData _52_PlaySound;
	VirtualInvokeData _53_LoadAnimations;
	VirtualInvokeData _54_OnPlayIdleAnim;
	VirtualInvokeData _55_CurrentStepCanbeHurt;
	VirtualInvokeData _56_InitializeFXControl;
	VirtualInvokeData _57_PlayHurtCueEffect;
	VirtualInvokeData _58_InitializeMovementBehaviour;
	VirtualInvokeData _59_UpdateNovementAgentAvoidanceBlockSetting;
	VirtualInvokeData _60_SetupPrimeFSM;
	VirtualInvokeData _61_Death;
	VirtualInvokeData _62_InitializeVisual;
	VirtualInvokeData _63_ReleaseVisual;
	VirtualInvokeData _64_LoadModel;
	VirtualInvokeData _65_SetupVisualComponents;
	VirtualInvokeData _66_InitData;
	VirtualInvokeData _67_LoadData;
	VirtualInvokeData _68_RegisterActionState;
	VirtualInvokeData _69_Recycle;
};
struct PlayerAdventureActor_c {
	Il2CppClass_1 _1;
	struct PlayerAdventureActor_StaticFields* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	PlayerAdventureActor_VTable vtable;
};
struct PlayerAdventureActor_o {
	PlayerAdventureActor_c *klass;
	void *monitor;
	PlayerAdventureActor_Fields fields;
};
struct PlayerAdventureActor_StaticFields {
	struct UnityEngine_Color_o color1;
	struct UnityEngine_Color_o color2;
	struct UnityEngine_Color_o color3;
	struct UnityEngine_Color_o color4;
	struct UnityEngine_Color_o color5;
};

struct MonsterAdventureActor_Fields : AdventureActor_Fields {
	struct MonsterInfo_o* _monsterInfo_k__BackingField;
	struct MonsterSpawnerInfo_o* _spawnerInfo_k__BackingField;
	struct MonsterActiveScheme_o* _monsterActiveScheme_k__BackingField;
	struct MonsterAIInfo_o* _monsterAIInfo_k__BackingField;
	struct MonsterSummonInfo_o* _monsterSummonInfo_k__BackingField;
	struct MonsterToughnessInfo_o* _monsterToughnessInfo_k__BackingField;
	bool _HasLoadData_k__BackingField;
	int32_t _ScoreBossBehavior_k__BackingField;
	struct AdventureLevelObjPoolMgr_PoolObj_o* spawnPoolObj;
	bool _ToughnessBrokenToIdle_k__BackingField;
	struct System_Collections_Generic_List_int__o* initBuffIds;
	int32_t battleLevel;
	struct AdventureBehaviour_PlayFX_o* battleLevelUpFx;
	bool summonMonsterUseBattleLevelAsDifficultLevel;
	struct AttributeEntry_array* monsterEntries;
	int32_t gmSetId;
	bool delayEnterAction;
	struct System_Collections_Generic_List_TSVector__o* points;
};
struct MonsterAdventureActor_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_get_Id;
	VirtualInvokeData _5_get_ActiveSelf;
	VirtualInvokeData _6_AddLogicComponent;
	VirtualInvokeData _7_GetLogicComponent;
	VirtualInvokeData _8_GetLogicComponent;
	VirtualInvokeData _9_AddOrGetLogicComponent;
	VirtualInvokeData _10_AddMonoLogicComponent;
	VirtualInvokeData _11_AddOrGetMonoLogicComponent;
	VirtualInvokeData _12_IsCoroutineAlive;
	VirtualInvokeData _13_IsCoroutineRunning;
	VirtualInvokeData _14_GetCoroutineDeltaTime;
	VirtualInvokeData _15_OnActive;
	VirtualInvokeData _16_OnDeactive;
	VirtualInvokeData _17_OnInit;
	VirtualInvokeData _18_OnShutdown;
	VirtualInvokeData _19_OnLogicUpdateEnabled;
	VirtualInvokeData _20_OnLogicUpdateDisabled;
	VirtualInvokeData _21_OnLogicUpdatePaused;
	VirtualInvokeData _22_OnLogicUpdateResumed;
	VirtualInvokeData _23_OnLogicStart;
	VirtualInvokeData _24_OnLogicUpdate;
	VirtualInvokeData _25_OnLogicTimeScaleChanged;
	VirtualInvokeData _26_OnVisualUpdate;
	VirtualInvokeData _27_QueryHitBoxContextTime;
	VirtualInvokeData _28_QueryHitBoxContextPosition;
	VirtualInvokeData _29_QueryHitBoxContextDirection;
	VirtualInvokeData _30_QueryActorHitedTimeout;
	VirtualInvokeData _31_SetActorHitedTime;
	VirtualInvokeData _32_CheckHitable;
	VirtualInvokeData _33_OnHitActor;
	VirtualInvokeData _34_OnHitShield;
	VirtualInvokeData _35_OnHitObstacle;
	VirtualInvokeData _36_OnHitDestructibleObstacle;
	VirtualInvokeData _37_OnDeterministicCollisionEnter;
	VirtualInvokeData _38_OnDeterministicCollisionStay;
	VirtualInvokeData _39_OnDeterministicCollisionExit;
	VirtualInvokeData _40_OnStateTransformation;
	VirtualInvokeData _41_OnStateMachineTransformation;
	VirtualInvokeData _42_LevelStart;
	VirtualInvokeData _43_LevelEnd;
	VirtualInvokeData _44_OnAttributeListValueChange;
	VirtualInvokeData _45_OnHpChangedEvent;
	VirtualInvokeData _46_OnAliveChangedEvent;
	VirtualInvokeData _47_OnShieldChangedEvent;
	VirtualInvokeData _48_OnShow;
	VirtualInvokeData _49_OnEnterDeterministicCollision;
	VirtualInvokeData _50_OnStayDeterministicCollision;
	VirtualInvokeData _51_OnExitDeterministicCollision;
	VirtualInvokeData _52_PlaySound;
	VirtualInvokeData _53_LoadAnimations;
	VirtualInvokeData _54_OnPlayIdleAnim;
	VirtualInvokeData _55_CurrentStepCanbeHurt;
	VirtualInvokeData _56_InitializeFXControl;
	VirtualInvokeData _57_PlayHurtCueEffect;
	VirtualInvokeData _58_InitializeMovementBehaviour;
	VirtualInvokeData _59_UpdateNovementAgentAvoidanceBlockSetting;
	VirtualInvokeData _60_SetupPrimeFSM;
	VirtualInvokeData _61_Death;
	VirtualInvokeData _62_InitializeVisual;
	VirtualInvokeData _63_ReleaseVisual;
	VirtualInvokeData _64_LoadModel;
	VirtualInvokeData _65_SetupVisualComponents;
	VirtualInvokeData _66_OnMessage;
	VirtualInvokeData _67_LoadData;
	VirtualInvokeData _68_Recycle;
};
struct MonsterAdventureActor_c {
	Il2CppClass_1 _1;
	struct MonsterAdventureActor_StaticFields* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	MonsterAdventureActor_VTable vtable;
};
struct MonsterAdventureActor_o {
	MonsterAdventureActor_c *klass;
	void *monitor;
	MonsterAdventureActor_Fields fields;
};
struct MonsterAdventureActor_StaticFields {
	struct UnityEngine_Color_o color1;
	struct UnityEngine_Color_o color2;
	struct UnityEngine_Color_o color3;
	struct UnityEngine_Color_o color4;
	struct UnityEngine_Color_o color5;
	struct UnityEngine_Color_o color6;
	struct UnityEngine_Color_o color7;
};


struct UnityEngine_Vector3_Fields {
	float x;
	float y;
	float z;
};
struct UnityEngine_Vector3_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_Equals;
	VirtualInvokeData _5_ToString;
};
struct UnityEngine_Vector3_c {
	Il2CppClass_1 _1;
	struct UnityEngine_Vector3_StaticFields* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	UnityEngine_Vector3_VTable vtable;
};
struct UnityEngine_Vector3_o {
	UnityEngine_Vector3_Fields fields;
};

struct AdventureWeapon_Fields : LogicEntity_Fields {
	struct UnityEngine_GameObject_o* _prefab_k__BackingField;
	struct LogicEntity_o* _owner;
	int64_t _ownerId;
	struct TrueSync_TSVector2_o _originPosition_k__BackingField;
	struct TrueSync_TSVector2_o _originDirection_k__BackingField;
	struct TrueSync_FP_o _velocitySpeed_k__BackingField;
	struct TrueSync_TSVector2_o _velocityDirection_k__BackingField;
	bool useOwnerActorInfo;
	struct System_String_o* weaponTag;
	struct System_String_o* bulletTag;
	int32_t hitDamageId;
	struct HitBox_HitDamageIdData_array* _hitdamagedatas;
	int32_t heightClass;
	uint32_t hitFlags;
	struct HitBox_HitBoxFeatureData_o* hitFeatureData;
	int32_t hurtAnimType;
	bool canBeBlock;
	bool isPauseMove;
	int32_t attackRound;
	int32_t temphitDmgId;
	int32_t weaponHashCode;
	int32_t bulletHashCode;
	struct VisualSmooth_o* _smooth_k__BackingField;
	struct UnityEngine_Collider_o* collider;
	struct DeterministicCollider_o* _dtCollider_k__BackingField;
	struct SkillSlotLevelInfo_o* bindSkillSlotLevelInfo;
	struct AttributeList_o* attributeList;
	struct System_Collections_Generic_Dictionary_int__FDP__o* attributeWithElementOrDamageTypeDict;
	struct System_String_o* _DefaultWeaponTag_k__BackingField;
	struct System_String_o* _DefaultBulletTag_k__BackingField;
	struct UnityEngine_Vector3_o _DefaultWeaponScale_k__BackingField;
	struct HitBox_o* _hitBox;
	struct System_Collections_Generic_Dictionary_long__FP__o* _hitedActors;
	struct System_Collections_Generic_HashSet_int__o* subWeaponTags;
	struct System_Collections_Generic_List_int__o* additionalAttrIdList;
};
struct AdventureWeapon_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_get_Id;
	VirtualInvokeData _5_get_ActiveSelf;
	VirtualInvokeData _6_AddLogicComponent;
	VirtualInvokeData _7_GetLogicComponent;
	VirtualInvokeData _8_GetLogicComponent;
	VirtualInvokeData _9_AddOrGetLogicComponent;
	VirtualInvokeData _10_AddMonoLogicComponent;
	VirtualInvokeData _11_AddOrGetMonoLogicComponent;
	VirtualInvokeData _12_IsCoroutineAlive;
	VirtualInvokeData _13_IsCoroutineRunning;
	VirtualInvokeData _14_GetCoroutineDeltaTime;
	VirtualInvokeData _15_OnActive;
	VirtualInvokeData _16_OnDeactive;
	VirtualInvokeData _17_OnInit;
	VirtualInvokeData _18_OnShutdown;
	VirtualInvokeData _19_OnLogicUpdateEnabled;
	VirtualInvokeData _20_OnLogicUpdateDisabled;
	VirtualInvokeData _21_OnLogicUpdatePaused;
	VirtualInvokeData _22_OnLogicUpdateResumed;
	VirtualInvokeData _23_OnLogicStart;
	VirtualInvokeData _24_OnLogicUpdate;
	VirtualInvokeData _25_OnLogicTimeScaleChanged;
	VirtualInvokeData _26_OnVisualUpdate;
	VirtualInvokeData _27_QueryHitBoxContextTime;
	VirtualInvokeData _28_QueryHitBoxContextPosition;
	VirtualInvokeData _29_QueryHitBoxContextDirection;
	VirtualInvokeData _30_QueryActorHitedTimeout;
	VirtualInvokeData _31_SetActorHitedTime;
	VirtualInvokeData _32_unknown;
	VirtualInvokeData _33_unknown;
	VirtualInvokeData _34_unknown;
	VirtualInvokeData _35_unknown;
	VirtualInvokeData _36_unknown;
	VirtualInvokeData _37_get_isValid;
	VirtualInvokeData _38_Setup;
	VirtualInvokeData _39_Reset;
	VirtualInvokeData _40_Finish;
	VirtualInvokeData _41_CheckHitable;
	VirtualInvokeData _42_OnHitActor;
	VirtualInvokeData _43_OnHitShield;
	VirtualInvokeData _44_OnHitObstacle;
	VirtualInvokeData _45_OnHitDestructibleObstacle;
	VirtualInvokeData _46_get_isShootableWeapon;
	VirtualInvokeData _47_get_isEquipableWeapon;
	VirtualInvokeData _48_OnEquipWith;
	VirtualInvokeData _49_OnEquipUpdate;
	VirtualInvokeData _50_OnEquipDrop;
	VirtualInvokeData _51_get_isShield;
	VirtualInvokeData _52_get_isShowShadowBlob;
	VirtualInvokeData _53_iShowShadowBlob;
	VirtualInvokeData _54_ModifyWeaponScaleByMulti;
	VirtualInvokeData _55_OnWeaponScaleChange;
};
struct AdventureWeapon_c {
	Il2CppClass_1 _1;
	void* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	AdventureWeapon_VTable vtable;
};
struct AdventureWeapon_o {
	AdventureWeapon_c *klass;
	void *monitor;
	AdventureWeapon_Fields fields;
};

struct __declspec(align(8)) Singleton_GameDataController__Fields {
};
struct Singleton_GameDataController__VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
};
struct Singleton_GameDataController__c {
	Il2CppClass_1 _1;
	struct Singleton_GameDataController__StaticFields* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	Singleton_GameDataController__VTable vtable;
};
struct Singleton_GameDataController__o {
	Singleton_GameDataController__c *klass;
	void *monitor;
	Singleton_GameDataController__Fields fields;
};
struct Singleton_GameDataController__StaticFields {
	struct GameDataController_o* g_instance;
};
struct GameDataController_Fields : Singleton_GameDataController__Fields {
	struct System_Collections_Generic_Dictionary_int__AddBuffAction__o* AddBuffAction_Map;
	struct System_Collections_Generic_Dictionary_int__AI__o* AI_Map;
	struct System_Collections_Generic_List_AreaEffect__o* AreaEffect_List;
	struct System_Collections_Generic_Dictionary_string__Attribute__o* Attribute_Map;
	struct System_Collections_Generic_Dictionary_int__AttributeLimit__o* AttributeLimit_Map;
	struct System_Collections_Generic_Dictionary_int__AttributeSetLimit__o* AttributeSetLimit_Map;
	struct System_Collections_Generic_Dictionary_int__Buff__o* Buff_Map;
	struct System_Collections_Generic_Dictionary_int__BuffEffect__o* BuffEffect_Map;
	struct System_Collections_Generic_Dictionary_int__BuffValue__o* BuffValue_Map;
	struct System_Collections_Generic_Dictionary_int__Character__o* Character_Map;
	struct System_Collections_Generic_Dictionary_int__CharacterSkin__o* CharacterSkin_Map;
	struct System_Collections_Generic_Dictionary_string__CharacterVoiceControl__o* CharacterVoiceControl_Map;
	struct System_Collections_Generic_Dictionary_int__Chest__o* Chest_Map;
	struct System_Collections_Generic_Dictionary_string__Config__o* Config_Map;
	struct System_Collections_Generic_Dictionary_int__DestroyObject__o* DestroyObject_Map;
	struct System_Collections_Generic_Dictionary_int__DropObject__o* DropObject_Map;
	struct System_Collections_Generic_List_DropObjectGroup__o* DropObjectGroup_List;
	struct System_Collections_Generic_Dictionary_int__Effect__o* Effect_Map;
	struct System_Collections_Generic_Dictionary_int__EffectValue__o* EffectValue_Map;
	struct System_Collections_Generic_Dictionary_int__FactionRelation__o* FactionRelation_Map;
	struct System_Collections_Generic_Dictionary_int__FloorBuff__o* FloorBuff_Map;
	struct System_Collections_Generic_List_FormationScene__o* FormationScene_List;
	struct System_Collections_Generic_Dictionary_int__HitDamage__o* HitDamage_Map;
	struct System_Collections_Generic_Dictionary_int__HonorLevel__o* HonorLevel_Map;
	struct System_Collections_Generic_List_InfinityTowerEnemySet__o* InfinityTowerEnemySet_List;
	struct System_Collections_Generic_Dictionary_int__InteractiveAction__o* InteractiveAction_Map;
	struct System_Collections_Generic_Dictionary_int__MainlineFloor__o* MainlineFloor_Map;
	struct System_Collections_Generic_Dictionary_int__Monster__o* Monster_Map;
	struct System_Collections_Generic_Dictionary_int__MonsterActionBranch__o* MonsterActionBranch_Map;
	struct System_Collections_Generic_Dictionary_int__MonsterAI__o* MonsterAI_Map;
	struct System_Collections_Generic_Dictionary_long__MonsterAttackAjust__o* MonsterAttackAjust_Map;
	struct System_Collections_Generic_Dictionary_int__MonsterAttributeContact__o* MonsterAttributeContact_Map;
	struct System_Collections_Generic_Dictionary_int__MonsterManual__o* MonsterManual_Map;
	struct System_Collections_Generic_Dictionary_int__MonsterSkin__o* MonsterSkin_Map;
	struct System_Collections_Generic_Dictionary_int__MonsterTeam__o* MonsterTeam_Map;
	struct System_Collections_Generic_Dictionary_long__MonsterValueTemplete__o* MonsterValueTemplete_Map;
	struct System_Collections_Generic_Dictionary_long__MonsterValueTempleteAdjust__o* MonsterValueTempleteAdjust_Map;
	struct System_Collections_Generic_Dictionary_long__MonsterValueTempleteModify__o* MonsterValueTempleteModify_Map;
	struct System_Collections_Generic_Dictionary_int__NPCConfig__o* NPCConfig_Map;
	struct System_Collections_Generic_Dictionary_int__NPCSkin__o* NPCSkin_Map;
	struct System_Collections_Generic_Dictionary_int__OnceAdditionalAttribute__o* OnceAdditionalAttribute_Map;
	struct System_Collections_Generic_Dictionary_int__OnceAdditionalAttributeValue__o* OnceAdditionalAttributeValue_Map;
	struct System_Collections_Generic_Dictionary_int__RandomLevelMonster__o* RandomLevelMonster_Map;
	struct System_Collections_Generic_Dictionary_int__RegionBossAffix__o* RegionBossAffix_Map;
	struct System_Collections_Generic_Dictionary_int__RegionBossFloor__o* RegionBossFloor_Map;
	struct System_Collections_Generic_Dictionary_int__RegionBossLevel__o* RegionBossLevel_Map;
	struct System_Collections_Generic_Dictionary_int__Shield__o* Shield_Map;
	struct System_Collections_Generic_Dictionary_int__ShieldValue__o* ShieldValue_Map;
	struct System_Collections_Generic_Dictionary_int__Skill__o* Skill_Map;
	struct System_Collections_Generic_Dictionary_int__StarTower__o* StarTower_Map;
	struct System_Collections_Generic_Dictionary_int__StarTowerCombatEvent__o* StarTowerCombatEvent_Map;
	struct System_Collections_Generic_Dictionary_int__StarTowerCombo__o* StarTowerCombo_Map;
	struct System_Collections_Generic_Dictionary_int__StarTowerDropItem__o* StarTowerDropItem_Map;
	struct System_Collections_Generic_List_StarTowerEnemySet__o* StarTowerEnemySet_List;
	struct System_Collections_Generic_Dictionary_int__StarTowerFloor__o* StarTowerFloor_Map;
	struct System_Collections_Generic_Dictionary_int__StarTowerFloorSet__o* StarTowerFloorSet_Map;
	struct System_Collections_Generic_Dictionary_int__StarTowerMap__o* StarTowerMap_Map;
	struct System_Collections_Generic_List_StarTowerMonsterBornGroup__o* StarTowerMonsterBornGroup_List;
	struct System_Collections_Generic_Dictionary_int__StarTowerMonsterSpAttr__o* StarTowerMonsterSpAttr_Map;
	struct System_Collections_Generic_Dictionary_int__StarTowerScenePrefab__o* StarTowerScenePrefab_Map;
	struct System_Collections_Generic_Dictionary_int__StarTowerSpecificCombat__o* StarTowerSpecificCombat_Map;
	struct System_Collections_Generic_Dictionary_int__StarTowerStage__o* StarTowerStage_Map;
	struct System_Collections_Generic_Dictionary_string__TestCharacterAtt__o* TestCharacterAtt_Map;
	struct System_Collections_Generic_Dictionary_int__TestCharacterList__o* TestCharacterList_Map;
	struct System_Collections_Generic_Dictionary_int__TestTeamData__o* TestTeamData_Map;
	struct System_Collections_Generic_Dictionary_int__TraceHuntControl__o* TraceHuntControl_Map;
	struct System_Collections_Generic_Dictionary_int__TraceHuntLogEntryTemplate__o* TraceHuntLogEntryTemplate_Map;
	struct System_Collections_Generic_Dictionary_int__TraceHuntScoreSwitch__o* TraceHuntScoreSwitch_Map;
	struct System_Collections_Generic_List_TraceHuntSelfHuntExtraCost__o* TraceHuntSelfHuntExtraCost_List;
	struct System_Collections_Generic_List_TraceHuntStar__o* TraceHuntStar_List;
	struct System_Collections_Generic_Dictionary_int__Trap__o* Trap_Map;
	struct System_Collections_Generic_Dictionary_int__TravelerDuelFansLevel__o* TravelerDuelFansLevel_Map;
	struct System_Collections_Generic_Dictionary_int__TravelerDuelHotValueItem__o* TravelerDuelHotValueItem_Map;
	struct System_Collections_Generic_Dictionary_int__TravelerDuelHotValueRewards__o* TravelerDuelHotValueRewards_Map;
	struct System_Collections_Generic_List_TravelerDuelIdleRewards__o* TravelerDuelIdleRewards_List;
	struct System_Collections_Generic_Dictionary_int__TravelerDuelTarget__o* TravelerDuelTarget_Map;
	struct System_Collections_Generic_List_VampireEnemyPool__o* VampireEnemyPool_List;
	struct System_Collections_Generic_List_VampireEnemySet__o* VampireEnemySet_List;
	struct System_Collections_Generic_Dictionary_int__VampireEnemySpAttr__o* VampireEnemySpAttr_Map;
	struct System_Collections_Generic_Dictionary_int__VoDirectory__o* VoDirectory_Map;
	struct System_Collections_Generic_List_WeightParameter__o* WeightParameter_List;
	bool isLQA;
	struct LogManager_Logger_o* _logger;
	struct Archive_o* archive;
	bool _loaded_k__BackingField;
	int32_t _magicKey;
	struct System_String_o* _binVersion;
	struct System_String_o* _languageType;
};
struct GameDataController_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
};
struct GameDataController_c {
	Il2CppClass_1 _1;
	struct GameDataController_StaticFields* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	GameDataController_VTable vtable;
};
struct GameDataController_o {
	GameDataController_c *klass;
	void *monitor;
	GameDataController_Fields fields;
};
struct GameDataController_StaticFields {
	struct TrueSync_FP_o IntFloatPrecisionFP;
	double IntFloatPrecision;
	struct System_String_o* _textDataSearchPath;
	struct System_String_o* _tableDataSearchPath;
};

struct __declspec(align(8)) Nova_Client_OnceAdditionalAttribute_Fields {
	struct Google_Protobuf_UnknownFieldSet_o* _unknownFields;
	int32_t id_;
	int32_t levelTypeData_;
	int32_t levelData_;
	int32_t mainOrSupport_;
};
struct Nova_Client_OnceAdditionalAttribute_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_MergeFrom;
	VirtualInvokeData _5_MergeFrom;
	VirtualInvokeData _6_WriteTo;
	VirtualInvokeData _7_CalculateSize;
	VirtualInvokeData _8_pb__Google_Protobuf_IMessage_get_Descriptor;
	VirtualInvokeData _9_Equals;
	VirtualInvokeData _10_Clone;
};
struct Nova_Client_OnceAdditionalAttribute_c {
	Il2CppClass_1 _1;
	struct Nova_Client_OnceAdditionalAttribute_StaticFields* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	Nova_Client_OnceAdditionalAttribute_VTable vtable;
};
struct Nova_Client_OnceAdditionalAttribute_o {
	Nova_Client_OnceAdditionalAttribute_c *klass;
	void *monitor;
	Nova_Client_OnceAdditionalAttribute_Fields fields;
};

struct __declspec(align(8)) Nova_Client_OnceAdditionalAttributeValue_Fields {
	struct Google_Protobuf_UnknownFieldSet_o* _unknownFields;
	int32_t id_;
	int32_t damageType1_;
	int32_t elementType1_;
	int32_t attributeType1_;
	int32_t parameterType1_;
	int32_t value1_;
	int32_t damageType2_;
	int32_t elementType2_;
	int32_t attributeType2_;
	int32_t parameterType2_;
	int32_t value2_;
	int32_t damageType3_;
	int32_t elementType3_;
	int32_t attributeType3_;
	int32_t parameterType3_;
	int32_t value3_;
};
struct Nova_Client_OnceAdditionalAttributeValue_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_MergeFrom;
	VirtualInvokeData _5_MergeFrom;
	VirtualInvokeData _6_WriteTo;
	VirtualInvokeData _7_CalculateSize;
	VirtualInvokeData _8_pb__Google_Protobuf_IMessage_get_Descriptor;
	VirtualInvokeData _9_Equals;
	VirtualInvokeData _10_Clone;
};
struct Nova_Client_OnceAdditionalAttributeValue_c {
	Il2CppClass_1 _1;
	struct Nova_Client_OnceAdditionalAttributeValue_StaticFields* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	Nova_Client_OnceAdditionalAttributeValue_VTable vtable;
};
struct Nova_Client_OnceAdditionalAttributeValue_o {
	Nova_Client_OnceAdditionalAttributeValue_c *klass;
	void *monitor;
	Nova_Client_OnceAdditionalAttributeValue_Fields fields;
};


struct UnityEngine_ScriptableObject_Fields : UnityEngine_Object_Fields {
};

struct ClientConfig_Fields : UnityEngine_ScriptableObject_Fields {
    struct System_String_o* buildVersion;
    struct System_String_o* buildTag;
    bool isOpenGM;
    bool useLocalResourcesDownloadServer;
    struct System_String_o* localResourcesDownloadServerUrl;
    struct System_String_o* backupServerUrlPrefix;
};

struct ClientConfig_StaticFields {
    struct ClientConfig_o* _Instance;
};

struct ClientConfig_c {
    Il2CppClass_1 _1;
    struct ClientConfig_StaticFields* static_fields;
    Il2CppRGCTXData* rgctx_data;
    Il2CppClass_2 _2;
};

struct ClientConfig_o {
    ClientConfig_c *klass;
    void *monitor;
    ClientConfig_Fields fields;
};

struct AreaEffectEntity_VTable {
	VirtualInvokeData _0_Equals;
	VirtualInvokeData _1_Finalize;
	VirtualInvokeData _2_GetHashCode;
	VirtualInvokeData _3_ToString;
	VirtualInvokeData _4_get_Id;
	VirtualInvokeData _5_get_ActiveSelf;
	VirtualInvokeData _6_AddLogicComponent;
	VirtualInvokeData _7_GetLogicComponent;
	VirtualInvokeData _8_GetLogicComponent;
	VirtualInvokeData _9_AddOrGetLogicComponent;
	VirtualInvokeData _10_AddMonoLogicComponent;
	VirtualInvokeData _11_AddOrGetMonoLogicComponent;
	VirtualInvokeData _12_IsCoroutineAlive;
	VirtualInvokeData _13_IsCoroutineRunning;
	VirtualInvokeData _14_GetCoroutineDeltaTime;
	VirtualInvokeData _15_OnActive;
	VirtualInvokeData _16_OnDeactive;
	VirtualInvokeData _17_OnInit;
	VirtualInvokeData _18_OnShutdown;
	VirtualInvokeData _19_OnLogicUpdateEnabled;
	VirtualInvokeData _20_OnLogicUpdateDisabled;
	VirtualInvokeData _21_OnLogicUpdatePaused;
	VirtualInvokeData _22_OnLogicUpdateResumed;
	VirtualInvokeData _23_OnLogicStart;
	VirtualInvokeData _24_OnLogicUpdate;
	VirtualInvokeData _25_OnLogicTimeScaleChanged;
	VirtualInvokeData _26_OnVisualUpdate;
	VirtualInvokeData _27_QueryHitBoxContextTime;
	VirtualInvokeData _28_QueryHitBoxContextPosition;
	VirtualInvokeData _29_QueryHitBoxContextDirection;
	VirtualInvokeData _30_QueryActorHitedTimeout;
	VirtualInvokeData _31_SetActorHitedTime;
	VirtualInvokeData _32_CheckHitable;
	VirtualInvokeData _33_OnHitActor;
	VirtualInvokeData _34_OnHitShield;
	VirtualInvokeData _35_OnHitObstacle;
	VirtualInvokeData _36_OnHitDestructibleObstacle;
};

struct AreaEffectEntity_c {
	Il2CppClass_1 _1;
	void* static_fields;
	Il2CppRGCTXData* rgctx_data;
	Il2CppClass_2 _2;
	AreaEffectEntity_VTable vtable;
};

struct AreaEffectEntity_Fields : LogicEntity_Fields {
	struct System_String_o* areaTag;
	struct System_Collections_Generic_List_string__o* areaChildTagList;
	struct TrueSync_FP_o duration;
	bool canBeHit;
	bool finishAfterOwnerDead;
	bool copyBattleDataBeforeAttack;
	int32_t hitBoxShape;
	struct TrueSync_FP_o hitBoxWidth;
	struct TrueSync_FP_o hitBoxLength;
	struct TrueSync_FP_o hitBoxHeight;
	struct TrueSync_FP_o hitBoxRadius;
	struct TrueSync_FP_o hitBoxInnerRadius;
	struct TrueSync_FP_o hitBoxAngle;
	struct TrueSync_FP_o hitBoxRotation;
	struct TrueSync_TSVector2_o hitBoxOffset;
	struct TrueSync_FP_o hitBoxOffsetY;
	bool areaWithActorScale;
	bool enableEarlyWarningEffect;
	struct UnityEngine_GameObject_o* earlyWarningPrefab;
	struct TrueSync_FP_o earlyWarningDuration;
	float earlyWarningScale;
	struct UnityEngine_GameObject_o* fx;
	struct UnityEngine_Transform_o* cTrans;
	bool effectWithActorScale;
	float effectScale;
	bool syncPosition;
	bool syncRotation;
	bool stopFxOnDeactive;
	bool checkTargetByPosition;
	bool shareSameDamageImmuneDuration;
	int32_t areaHashCode;
	struct System_Collections_Generic_List_int__o* areaChildHashCodeList;
	struct System_String_o* originalAreaTag;
	struct UnityEngine_Vector3_o orginalAreaScale;
	struct AdventureActor_o* _owner_k__BackingField;
	struct AdventureFXPlayer_o* _fxPlayer_k__BackingField;
	int64_t _fxToken;
	struct AdventureEarlyWarningFXPlayer_o* _earlyWarningFXPlayer_k__BackingField;
	int64_t _earlyWarningFXToken;
	struct System_Collections_Generic_List_AreaEffect_Component__o* _components;
	bool _RunningLogic_k__BackingField;
	bool _Finished_k__BackingField;
	struct TrueSync_FP_o _leftTime;
	struct TrueSync_FP_o _earlyWarningTime;
	struct AttributeList_o* attributeList;
	struct System_Collections_Generic_Dictionary_int__FDP__o* attributeWithElementOrDamageTypeDict;
	struct SkillSlotLevelInfo_o* bindSkillSlotLevelInfo;
	struct System_Action_o* OnBeforeEnd;
	int64_t _battleDataOwnerId;
	bool _attributeListHasChanged;
	bool _attributeWithElementOrDamageTypeHasChanged;
	bool _SkillSlotLevelInfoHasChanged;
	struct UnityEngine_Collider_o* _collider;
	struct DeterministicCollider_o* _dtCollider;
	struct HitBox_o* _hitBox;
	struct System_Collections_Generic_List_DeterministicCollider__o* _bulletColliderList;
	struct DeterministicShape_o _deterministicShape;
	struct VisualSmooth_o* _smooth;
	struct System_Collections_Generic_List_int__o* additionalAttrIdList;
	struct System_Collections_Generic_Dictionary_long__FP__o* _hittedEntities;
	struct AreaEffectEntity_DeterministicColliderCompare_o* _compare;
	struct System_Collections_Generic_List_DeterministicCollider__o* _lastColliderList;
	struct System_Collections_Generic_List_DeterministicCollider__o* _nowColliderList;
};

struct AreaEffectEntity_o {
	AreaEffectEntity_c *klass;
	void *monitor;
	AreaEffectEntity_Fields fields;
};

// =============================================================================
//  Minimal opaque forward declarations for the HitBox-area-hit hooks
// =============================================================================
// Only the fields these hooks actually touch are defined; everything else
// remains forward-declared so we don't pull in megabytes of unused types.

struct IHitBoxContext_Fields {
};
struct IHitBoxContext_c; // forward-declared class type
struct IHitBoxContext_o {
	IHitBoxContext_c *klass;
	void *monitor;
	IHitBoxContext_Fields fields;
};

struct DeterministicCollider_Fields {
	// We never read or write any field of this struct from the hook —
	// the engine passes it through unchanged to the original function.
	// Defined as a single byte to give the struct a non-zero size.
	uint8_t _opaque[1];
};
struct DeterministicCollider_c; // forward-declared class type
struct DeterministicCollider_o {
	DeterministicCollider_c *klass;
	void *monitor;
	DeterministicCollider_Fields fields;
};

struct DeterministicRaycastHit_Fields {
	uint8_t _opaque[1];
};
struct DeterministicRaycastHit_o {
	DeterministicRaycastHit_Fields fields;
};

// Transform's get_position returns a Vector3 by value (returned in XMM0 on
// x64).  Only a few fields of UnityEngine_Transform are useful for the hook
// (we call get_transform on a Component, then get_position on the Transform).
// We don't need the full Transform layout — just the klass pointer and monitor
// are required to be at the right offsets to make the type a valid il2cpp obj.
struct UnityEngine_Transform_o {
	void* klass;
	void* monitor;
	// ...rest of fields elided — we only ever treat this as opaque
};
struct UnityEngine_Component_o {
	void* klass;
	void* monitor;
	// ...rest of fields elided
};

#ifndef _MSC_VER
  #pragma pop_macro("align")
#endif
