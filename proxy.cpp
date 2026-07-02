#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <cstdint>
#include <cstdio>
#include <string>
#include <unordered_map>
#include "MinHook.h"
#include "logging.h"
#include "http_hooks.h"
#include "game_structs.h"

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
//  RVAs
// =============================================================================
static constexpr uintptr_t RVA_EFFECT_ON_INIT                = 0x11281A0;
static constexpr uintptr_t RVA_EFFECT_ON_CLEAR               = 0x1123C90;
static constexpr uintptr_t RVA_UPDATE_LOGIC                  = 0x1179570;
static constexpr uintptr_t RVA_BATTLE_START                  = 0x102FFE0;
static constexpr uintptr_t RVA_SPAWN_SKILL                   = 0x11780D0;
static constexpr uintptr_t RVA_BUFF_EFFECT_ON_INIT           = 0x16C4BD0;
static constexpr uintptr_t RVA_BUFF_ENTITY_INIT              = 0x16C9500;
static constexpr uintptr_t RVA_BUFF_ENTITY_EXCUTE            = 0x16C81C0;
static constexpr uintptr_t RVA_CALC_NORMAL_DAMAGE            = 0x110C100;
static constexpr uintptr_t RVA_GET_ONCE_ATTR                      = 0x12840E0;
static constexpr uintptr_t RVA_GET_VALUE_CONFIG_ID                = 0x1111080;
static constexpr uintptr_t RVA_GET_EFFECT_VALUE                   = 0x1282100;
static constexpr uintptr_t RVA_GET_ONCE_ADDITIONAL_ATTRIBUTE_VALUE = 0x1283F30;
static constexpr uintptr_t RVA_MONSTER_ACTION_STATE_ON_ENTER = 0x1104CD0;
static constexpr uintptr_t RVA_MODULE_CLEAR_DATA     = 0x15C78A0;  // AdventureModuleController$$ClearData
static constexpr uintptr_t RVA_GET_BOTH_ALL_INFO     = 0x12263F0;  // AdventureActor$$GetBothAllInfo
static constexpr uintptr_t RVA_AREA_COPY_BATTLE      = 0x169C610;  // AreaEffectEntity$$CopyBattleData
static constexpr uintptr_t RVA_WEAPON_SETUP          = 0x16F57E0;  // AdventureWeapon$$Setup

//  Cached module base
static uintptr_t g_base = 0;

//  Per-hit effect snapshot (set by GetBothAllInfo hook, used by CalculateNormalDamage)
static EffectSnapshot g_GetBothAllInfoSnapshot;
static bool g_HaveHitSnapshot = false;

//  Per-area effect snapshot (set by CopyBattleData hook, used for damageTypeTemp=5)
static std::mutex g_AreaSnapshotMutex;
static std::unordered_map<uintptr_t, EffectSnapshot> g_AreaSnapshots;

//  Per-weapon effect snapshot (set by AdventureWeapon::Setup, used for damageTypeTemp=2)
static std::mutex g_WeaponSnapshotMutex;
static std::unordered_map<uintptr_t, EffectSnapshot> g_WeaponSnapshots;

// =============================================================================
//  Monster dummy-mode hooks
// =============================================================================
using FnMonsterActionStateOnEnter = void(__fastcall*)(void*, void*, void*, void*, void*);
static FnMonsterActionStateOnEnter g_OrigMonsterActionStateOnEnter = nullptr;

static void __fastcall Hook_MonsterActionStateOnEnter(void* self, void* preStatus, void* onComplete, void* onLeave, void* method) {
    if (!g_Cfg.monster_dummy_mode) {
        g_OrigMonsterActionStateOnEnter(self, preStatus, onComplete, onLeave, method);
    }
}

// =============================================================================
//  Reset-button hook
// =============================================================================
using FnVoidVoid = void(__fastcall*)(void*, void*);
static FnVoidVoid g_OrigModuleClearData = nullptr;

static void __fastcall Hook_ModuleClearData(void* self, void* method) {
    BuildResetJson();
    g_CombatStartTimeFP.store(0, std::memory_order_relaxed);
    g_HaveHitSnapshot = false;
    g_OrigModuleClearData(self, method);
}

// =============================================================================
//  CalculateNormalDamage hook
// =============================================================================
using FnCalcNormalDamage = int64_t(__fastcall*)( AdventureActor_o*, AdventureActor_o*, Nova_Client_HitDamage_o*,
    int32_t, bool, bool, int32_t*, double*, double*, double*, double*, double*, double*, double*, double*, double*, double*, double*, double*, double*, double*, double*, void*);
static FnCalcNormalDamage g_OrigCalcNormalDamage = nullptr;


static std::atomic<GameDataController_o*> g_gdc{nullptr};  // atomic, not raw pointer

static GameDataController_o* GetGDC() {
    GameDataController_o* cached = g_gdc.load(std::memory_order_relaxed);
    if (cached) return cached;
    if (!g_base) return nullptr;

    GameDataController_c* gdcTypeInfo = *reinterpret_cast<GameDataController_c**>(g_base + 0x714E958);
    if (!gdcTypeInfo) { log("[GDC] gdcTypeInfo is null"); return nullptr; }

    Il2CppClass* parentClass = gdcTypeInfo->_1.parent;
    if (!parentClass) { log("[GDC] parent (Singleton<GDC>) is null"); return nullptr; }

    auto* sf = reinterpret_cast<Singleton_GameDataController__StaticFields*>(parentClass->static_fields);
    if (!sf) { log("[GDC] singleton static_fields is null"); return nullptr; }

    GameDataController_o* instance = sf->g_instance;  // store in a local first
    if (!instance) { log("[GDC] g_instance is null — GDC not yet initialized"); return nullptr; }

    g_gdc.store(instance, std::memory_order_relaxed);  // only cache if non-null
    return instance;
}




static int64_t __fastcall Hook_CalcNormalDamage(
    AdventureActor_o* fromActor, AdventureActor_o* toActor, Nova_Client_HitDamage_o* hitDamageConfig,
    int32_t skillLevel, bool isCrit, bool isDot, int32_t* hudColorIndex, double* skillPercentAmend,
    double* talentGroupPercentAmend, double* skillAbsAmend, double* talentGroupAbsAmend, double* perkIntensityRatio, double* slotDmgRatio,
    double* fromEE, double* erAmend, double* defAmend, double* rcdSlotDmgRatio, double* toEERCD, double* skillIntensityRatio,
    double* toughnessBrokenDmgRatio, double* critRatio, double* envAmendRatio, void* method)
{

    // ── Step 1: walk klass chain for static fields ───────────────────────────
    if (!fromActor)         { log("[CND] BAIL: fromActor is null");         return 0; }
    if (!fromActor->klass)  { log("[CND] BAIL: fromActor->klass is null");  return 0; }

    Il2CppClass* parentKlass = fromActor->klass->_1.parent;
    if (!parentKlass) { log("[CND] BAIL: parentKlass is null"); return 0; }

    AdventureActor_c* actorClass = reinterpret_cast<AdventureActor_c*>(parentKlass);
    if (!actorClass->static_fields) { log("[CND] BAIL: static_fields is null"); return 0; }

    AdventureActor_StaticFields* staticFields = actorClass->static_fields;

    int32_t hitElem = hitDamageConfig ? hitDamageConfig->fields.elementType_ : -1;
    int32_t hitDmgType = hitDamageConfig ? hitDamageConfig->fields.damageType_ : -1;
    int32_t hitDmgId = hitDamageConfig ? hitDamageConfig->fields.id_ : -1;
    int32_t hitEffectType = hitDamageConfig ? hitDamageConfig->fields.effectType_ : -1;

    int32_t damageTypeTemp = staticFields->damageTypeTemp;
    g_CurrentDamageTypeTemp = damageTypeTemp;

    const char* hitTypeStr = "unknown";
    if (damageTypeTemp == 1) hitTypeStr = "actor";
    else if (damageTypeTemp == 2) hitTypeStr = "weapon";
    else if (damageTypeTemp == 5) hitTypeStr = "area";
    log("[HIT] id=%d type=%s(%d)", hitDmgId, hitTypeStr, damageTypeTemp);

    // ── Step 2: choose the right effect snapshot for this hit ──────────────────
    EffectSnapshot hitSnapshot;
    const EffectSnapshot* hitEffectSnapshot = nullptr;

    if (damageTypeTemp == 2 && staticFields->fromWeaponTemp) {
        auto weaponPtr = reinterpret_cast<uintptr_t>(staticFields->fromWeaponTemp);
        {
            std::lock_guard<std::mutex> lk(g_WeaponSnapshotMutex);
            auto it = g_WeaponSnapshots.find(weaponPtr);
            if (it != g_WeaponSnapshots.end()) {
                hitSnapshot = it->second;
                hitEffectSnapshot = &hitSnapshot;
            }
        }
    }
    if (!hitEffectSnapshot && damageTypeTemp == 5 && staticFields->fromAreaTemp) {
        auto areaPtr = reinterpret_cast<uintptr_t>(staticFields->fromAreaTemp);
        {
            std::lock_guard<std::mutex> lk(g_AreaSnapshotMutex);
            auto it = g_AreaSnapshots.find(areaPtr);
            if (it != g_AreaSnapshots.end()) {
                hitSnapshot = it->second;
                hitEffectSnapshot = &hitSnapshot;
            }
        }
    }
    if (!hitEffectSnapshot && g_HaveHitSnapshot) {
        hitSnapshot = g_GetBothAllInfoSnapshot;
        hitEffectSnapshot = &hitSnapshot;
    }

    // ── Step 3: original call ────────────────────────────────────────────────
    int64_t dmg = g_OrigCalcNormalDamage(
        fromActor, toActor, hitDamageConfig, skillLevel, isCrit, isDot, hudColorIndex,
        skillPercentAmend, talentGroupPercentAmend, skillAbsAmend, talentGroupAbsAmend,
        perkIntensityRatio, slotDmgRatio, fromEE, erAmend, defAmend, rcdSlotDmgRatio,
        toEERCD, skillIntensityRatio, toughnessBrokenDmgRatio, critRatio, envAmendRatio, method);

    // ── Step 4: GDC ─────────────────────────────────────────────────────────
    GameDataController_o* gdc = GetGDC();
    FnGetOnceAttr                     GetOnceAttr   = nullptr;
    FnGetValueConfigId                GetValueConfigId = nullptr;
    FnGetEffectValue                  GetEffectValue    = nullptr;
    FnGetOnceAdditionalAttributeValue GetAttrValue      = nullptr;
    if (gdc && g_base) {
        GetOnceAttr   = reinterpret_cast<FnGetOnceAttr>                    (g_base + RVA_GET_ONCE_ATTR);
        GetValueConfigId = reinterpret_cast<FnGetValueConfigId>            (g_base + RVA_GET_VALUE_CONFIG_ID);
        GetEffectValue    = reinterpret_cast<FnGetEffectValue>             (g_base + RVA_GET_EFFECT_VALUE);
        GetAttrValue      = reinterpret_cast<FnGetOnceAdditionalAttributeValue>(g_base + RVA_GET_ONCE_ADDITIONAL_ATTRIBUTE_VALUE);
    }

    // ── Step 5: resolve raw attr lists  ──────────────────────────────────────
    AttributeList_o* attackerInfo = staticFields->fromAdditionalAttrInfo
        ? staticFields->fromAdditionalAttrInfo->fields._attributeList_k__BackingField : nullptr;
    AttributeList_o* defenderInfo = staticFields->toAdditionalAttrInfo
        ? staticFields->toAdditionalAttrInfo->fields._attributeList_k__BackingField   : nullptr;

    // ── Step 6: BuildHitJson ─────────────────────────────────────────────────
    BuildHitJson(
        fromActor, toActor, hitDamageConfig, skillLevel, isCrit, isDot, hudColorIndex,
        skillPercentAmend, talentGroupPercentAmend, skillAbsAmend, talentGroupAbsAmend,
        perkIntensityRatio, slotDmgRatio, fromEE, erAmend, defAmend, rcdSlotDmgRatio,
        toEERCD, skillIntensityRatio, toughnessBrokenDmgRatio, critRatio, envAmendRatio,
        dmg, attackerInfo, defenderInfo,
        staticFields->fromAdditionalAttrInfo,
        staticFields->toAdditionalAttrInfo,
        staticFields->fromAdditionalAttrDict,
        staticFields->toAdditionalAttrDict,
        gdc, GetOnceAttr, GetValueConfigId,
        GetEffectValue, GetAttrValue, hitEffectSnapshot);

    return dmg;
}

// =============================================================================
//  AreaEffectEntity::CopyBattleData — snapshot effects when area snapshots stats
// =============================================================================
using FnCopyBattleData = void(__fastcall*)(void*, bool, void*);
static FnCopyBattleData g_OrigCopyBattleData = nullptr;

static void __fastcall Hook_CopyBattleData(void* areaEntity, bool force, void* method)
{
    g_OrigCopyBattleData(areaEntity, force, method);

    EffectSnapshot snap;
    auto* area = reinterpret_cast<AreaEffectEntity_o*>(areaEntity);
    AdventureActor_o* owner = area->fields._owner_k__BackingField;
    if (owner && owner->fields.effectManage) {
        auto* effectsDict = owner->fields.effectManage->fields.effectsDict;
        if (effectsDict) {
            auto* entriesArr = effectsDict->fields._entries;
            int slotCount = effectsDict->fields._count;
            if (entriesArr && slotCount > 0) {
                constexpr size_t entrySize = 0x18;
                constexpr size_t valOffset  = 0x10;
                uintptr_t entries = reinterpret_cast<uintptr_t>(entriesArr)
                                  + offsetof(System_Collections_Generic_Dictionary_Entry_TKey__TValue__array, m_Items);
                for (int i = 0; i < slotCount; ++i) {
                    uintptr_t entry = entries + i * entrySize;
                    int32_t hashCode = *reinterpret_cast<int32_t*>(entry);
                    if (hashCode < 0) continue;
                    AdventureEffect_o* effect = *reinterpret_cast<AdventureEffect_o**>(entry + valOffset);
                    if (!effect) continue;
                    if (effect->fields.removed) continue;
                    snap.insert(effect->fields.id);
                }
            }
        }
    }

    {
        std::lock_guard<std::mutex> lk(g_AreaSnapshotMutex);
        g_AreaSnapshots[reinterpret_cast<uintptr_t>(areaEntity)] = std::move(snap);
    }
}

// =============================================================================
//  AdventureWeapon::Setup — snapshot effects when weapon copies owner stats
// =============================================================================
using FnWeaponSetup = void(__fastcall*)(AdventureWeapon_o*, LogicEntity_o*, void*, void*, void*, void*, void*, void*, int32_t, void*);
static FnWeaponSetup g_OrigWeaponSetup = nullptr;

static void __fastcall Hook_WeaponSetup(AdventureWeapon_o* weapon, LogicEntity_o* owner,
                                         void* pos, void* posY, void* dir, void* target,
                                         void* targetPos, void* targetPosY, int32_t aimType, void* method)
{
    g_OrigWeaponSetup(weapon, owner, pos, posY, dir, target, targetPos, targetPosY, aimType, method);

    EffectSnapshot snap;
    auto* actor = reinterpret_cast<AdventureActor_o*>(owner);
    if (actor && actor->fields.effectManage) {
        auto* effectsDict = actor->fields.effectManage->fields.effectsDict;
        if (effectsDict) {
            auto* entriesArr = effectsDict->fields._entries;
            int slotCount = effectsDict->fields._count;
            if (entriesArr && slotCount > 0) {
                constexpr size_t entrySize = 0x18;
                constexpr size_t valOffset  = 0x10;
                uintptr_t entries = reinterpret_cast<uintptr_t>(entriesArr)
                                  + offsetof(System_Collections_Generic_Dictionary_Entry_TKey__TValue__array, m_Items);
                for (int i = 0; i < slotCount; ++i) {
                    uintptr_t entry = entries + i * entrySize;
                    int32_t hashCode = *reinterpret_cast<int32_t*>(entry);
                    if (hashCode < 0) continue;
                    AdventureEffect_o* effect = *reinterpret_cast<AdventureEffect_o**>(entry + valOffset);
                    if (!effect) continue;
                    if (effect->fields.removed) continue;
                    snap.insert(effect->fields.id);
                }
            }
        }
    }

    {
        std::lock_guard<std::mutex> lk(g_WeaponSnapshotMutex);
        g_WeaponSnapshots[reinterpret_cast<uintptr_t>(weapon)] = std::move(snap);
    }
}

using FnGetBothAllInfo = void(__fastcall*)(AdventureActor_o*, void*);
static FnGetBothAllInfo g_OrigGetBothAllInfo = nullptr;

static void __fastcall Hook_GetBothAllInfo(AdventureActor_o* actor, void* method)
{
    g_OrigGetBothAllInfo(actor, method);

    EffectSnapshot snap;
    auto* parentKlass = actor ? actor->klass->_1.parent : nullptr;
    if (parentKlass) {
        auto* actorClass = reinterpret_cast<AdventureActor_c*>(parentKlass);
        auto* sf = actorClass->static_fields;
        if (sf) {
            AdventureActor_o* fromActor = sf->fromActorTemp;
            if (fromActor && fromActor->fields.effectManage) {
                auto* effectsDict = fromActor->fields.effectManage->fields.effectsDict;
                if (effectsDict) {
                    auto* entriesArr = effectsDict->fields._entries;
                    int slotCount = effectsDict->fields._count;
                    if (entriesArr && slotCount > 0) {
                        constexpr size_t entrySize = 0x18;
                        constexpr size_t valOffset = 0x10;
                        uintptr_t entries = reinterpret_cast<uintptr_t>(entriesArr)
                                          + offsetof(System_Collections_Generic_Dictionary_Entry_TKey__TValue__array, m_Items);
                        for (int i = 0; i < slotCount; ++i) {
                            uintptr_t entry = entries + i * entrySize;
                            int32_t hashCode = *reinterpret_cast<int32_t*>(entry);
                            if (hashCode < 0) continue;
                            AdventureEffect_o* effect = *reinterpret_cast<AdventureEffect_o**>(entry + valOffset);
                            if (!effect) continue;
                            if (effect->fields.removed) continue;
                            auto* stack = effect->fields._effectStack;
                            if (stack && stack->fields._array && stack->fields._size > 0)
                                snap.insert(effect->fields.id);
                        }
                    }
                }
            }
        }
    }
    g_GetBothAllInfoSnapshot = snap;
    g_HaveHitSnapshot = true;
}

// =============================================================================
//  Effect / Buff hooks
// =============================================================================
using FnEffectOnInit = void(__fastcall*)( void*, int32_t, int32_t, int32_t,
    Nova_Client_Effect_o*, Nova_Client_EffectValue_o*, AdventureActor_o*, AdventureActor_o*,
    bool, int32_t, bool, TrueSync_FP_o, BuffEntity_o*, void*);
static FnEffectOnInit g_OrigEffectOnInit = nullptr;

static void __fastcall Hook_EffectOnInit(void* self, int32_t effType, int32_t sourceType, int32_t id, Nova_Client_Effect_o* effectConfig,
                                         Nova_Client_EffectValue_o* effectValueConfig, AdventureActor_o* owner, AdventureActor_o* fromActor,
                                         bool shareCD, int32_t takeEffectLimit, bool shareTakeEffectLimit,
                                         TrueSync_FP_o initCD, BuffEntity_o* fromBuff, void* method)
{
    g_OrigEffectOnInit(self, effType, sourceType, id, effectConfig, effectValueConfig,
                       owner, fromActor, shareCD, takeEffectLimit, shareTakeEffectLimit,
                       initCD, fromBuff, method);
    
    int32_t configId = 0;
    if (effectConfig)
        configId = effectConfig->fields.id_;
    
    if (configId > 0) {
        int32_t instanceId = reinterpret_cast<AdventureEffect_o*>(self)->fields.id;
        TrackInstanceConfig(instanceId, configId);
        InstanceSnapInfo info = {};
        info.configId = configId;
        info.levelTypeData = effectConfig ? effectConfig->fields.levelTypeData_ : 0;
        info.levelData = effectConfig ? effectConfig->fields.levelData_ : 0;
        info.sourceType = sourceType;
        info.valueConfigId = effectValueConfig ? effectValueConfig->fields.id_ : 0;
        info.damage = 0;
        info.ownerId = adventureActorId(owner);
        info.fromActorId = adventureActorId(fromActor);
        StoreInstanceSnapInfo(instanceId, info);
    }
    
    if (g_Cfg.effects) {
        BuildBuffJson("Effect", configId, owner, fromActor, 1);
    }
}

using FnBuffEffectOnInit = void(__fastcall*)( void*, AdventureActor_o*, AdventureActor_o*, BuffEntity_o*, Nova_Client_BuffEffect_o*, int32_t, void*);
static FnBuffEffectOnInit g_OrigBuffEffectOnInit = nullptr;

static void __fastcall Hook_BuffEffectOnInit(void* self, AdventureActor_o* owner, AdventureActor_o* fromActor, BuffEntity_o* buffEntity,
                                             Nova_Client_BuffEffect_o* buffEffectConfig, int32_t buffUid, void* method)
{
    g_OrigBuffEffectOnInit(self, owner, fromActor, buffEntity, buffEffectConfig, buffUid, method);
    
    int32_t configId = 0;
    if (buffEffectConfig)
        configId = buffEffectConfig->fields.id_;
    
    if (g_Cfg.buffs) {
        BuildBuffJson("Buff", configId, owner, fromActor, 1);
    }
}

using FnBuffEntityInit = void(__fastcall*)( BuffEntity_o*, Nova_Client_Buff_o*, Nova_Client_BuffValue_o*, BuffCom_o*, AdventureActor_o*, void*);
static FnBuffEntityInit g_OrigBuffEntityInit = nullptr;

static void __fastcall Hook_BuffEntityInit(BuffEntity_o* self, Nova_Client_Buff_o* buffConfig, Nova_Client_BuffValue_o* buffValueConfig,
                                           BuffCom_o* bfC, AdventureActor_o* fromActor, void* method)
{
    g_OrigBuffEntityInit(self, buffConfig, buffValueConfig, bfC, fromActor, method);

    int32_t buffCfgId = 0;
    AdventureActor_o* owner = nullptr;
    if (buffConfig) buffCfgId = buffConfig->fields.id_;
    if (bfC) owner = bfC->fields._owner;
    log("[BUFF_INIT] configId=%d time=%s owner=%s", buffCfgId, gameTime().c_str(),
        owner ? adventureActorId(owner).c_str() : "null");
}

using FnBuffEntityExcute = void(__fastcall*)( BuffEntity_o*, int32_t, AdventureActor_o*, void*);
static FnBuffEntityExcute g_OrigBuffEntityExcute = nullptr;

static void __fastcall Hook_BuffEntityExcute(BuffEntity_o* self, int32_t addType,
                                             AdventureActor_o* fromActor, void* method)
{
    g_OrigBuffEntityExcute(self, addType, fromActor, method);
    
    int32_t configId = 0;
    if (self->fields.buffConfig)
        configId = self->fields.buffConfig->fields.id_;
    int32_t buffNum = self->fields.buffNum;
    
    // Owner is the actor who owns the BuffCom that contains this BuffEntity
    AdventureActor_o* owner = nullptr;
    BuffCom_o* bc = self->fields._buffCom;
    if (bc)
        owner = bc->fields._owner;
    if (!owner)
        owner = fromActor;
    
    log("[BUFF_EXCUTE] configId=%d addType=%d buffNum=%d owner=%s time=%s",
        configId, addType, buffNum, owner ? adventureActorId(owner).c_str() : "null", gameTime().c_str());

    if (g_Cfg.buffs) {
        BuildBuffJson("Buff", configId, owner, fromActor, addType==3 ? -1 : 1, buffNum);
    }
}

using FnEffectOnClear = void(__fastcall*)(AdventureEffectBase_o*, void*);
static FnEffectOnClear g_OrigEffectOnClear = nullptr;

static void __fastcall Hook_EffectOnClear(AdventureEffectBase_o* effectBase, MethodInfo* method)
{

    if (effectBase)
    {
        AdventureEffect_o* effect = effectBase->fields._effect;
        if (effect)
        {
            if (g_Cfg.effects)
            {
                auto* clearCfg = effect->fields._effectConfig_k__BackingField;
                AdventureActor_o* owner = effect->fields._owner;
                AdventureActor_o* fromActor = effect->fields._fromActor;

                int32_t configId = clearCfg ? clearCfg->fields.id_ : 0;

                BuildBuffJson("Effect", configId, owner, fromActor, -1);
            }
        }
    }
    g_OrigEffectOnClear(effectBase, method);
}


// =============================================================================
//  Battle start / timer / spawn
// =============================================================================
using FnUpdateLogic = void(__fastcall*)( void*, TrueSync_FP_o, void*);
static FnUpdateLogic g_OrigUpdateLogic = nullptr;

static void __fastcall Hook_UpdateLogic(void* self, TrueSync_FP_o logicDeltaTime, void* method) {
    EnableAllDebugGizmos(g_base);

    // Lazy init: resolve LockStepManager._time pointer for gameTime()
    if (!g_LockStepTimePtr) {
        auto* lsTypeInfo = *reinterpret_cast<Il2CppClass**>(g_base + 0x70F2D78);
        if (lsTypeInfo && lsTypeInfo->static_fields) {
            g_LockStepTimePtr = reinterpret_cast<int64_t*>(
                reinterpret_cast<uint8_t*>(lsTypeInfo->static_fields) + 0x08);
            log("[init] LockStep._time resolved at %p", (void*)g_LockStepTimePtr);
        } else {
            log("[init] LockStep static fields still not ready after game loaded");
        }
    }

    g_OrigUpdateLogic(self, logicDeltaTime, method);
}

using FnBattleStart = void(__fastcall*)( void*, void*, void*);
static FnBattleStart g_OrigBattleStart = nullptr;

static void __fastcall Hook_BattleStart(void* self, void* evt, void* method) {
    auto* lsTypeInfo = *reinterpret_cast<Il2CppClass**>(g_base + 0x70F2D78);
    if (lsTypeInfo && lsTypeInfo->static_fields) {
        int64_t t = *reinterpret_cast<int64_t*>(
            reinterpret_cast<uint8_t*>(lsTypeInfo->static_fields) + 0x08);
        g_CombatStartTimeFP.store(t, std::memory_order_relaxed);
        //log("[BattleStart] Combat started! LockStep._time = %lld", (long long)t);
    } else {
        //log("[BattleStart] Combat started! (could not read time)");
    }
    g_OrigBattleStart(self, evt, method);
}

using FnSpawnSkill = void*(__fastcall*)( void*, int32_t, void*);
static FnSpawnSkill g_OrigSpawnSkill = nullptr;

static void* __fastcall Hook_SpawnSkill(void* self, int32_t skillId, void* method) {
    void* result = g_OrigSpawnSkill(self, skillId, method);
    
    if (skillId < 10000000) return result;
    if (!g_Cfg.skill_casts) return result;
    
    BuildSkillCastJson(skillId);
    
    return result;
}

// =============================================================================
//  Hook installer / init
// =============================================================================
bool InstallHook(uintptr_t target, void* hook, void** original, const char* name) {
    MH_STATUS s = MH_CreateHook(reinterpret_cast<void*>(target), hook, original);
    if (s != MH_OK) { log("[ERROR] MH_CreateHook failed for %s: %d", name, (int)s); return false; }
    s = MH_EnableHook(reinterpret_cast<void*>(target));
    if (s != MH_OK) { log("[ERROR] MH_EnableHook failed for %s: %d", name, (int)s); return false; }
    log("[init] Hooked %s at 0x%llX", name, (unsigned long long)target);
    return true;
}

static DWORD WINAPI InitThread(LPVOID) {
    InitializeLogger();
    if (!g_Log) return 1;

    std::string logDir = GetLocalAppDataPath() + "\\Stella Sora Combat Logger";
    loadConfig(logDir);
    BuildGemAttrTable(GetLocalAppDataPath() + "\\StellaSoraData");
    InitHttpLogger(logDir);

    for (int i = 0; i < 60; i++) {
        g_base = reinterpret_cast<uintptr_t>(GetModuleHandleA("GameAssembly.dll"));
        if (g_base) break;
        log("[init] Waiting for GameAssembly.dll... attempt %d/60", i + 1);
        Sleep(500);
    }
    if (!g_base) { log("[ERROR] GameAssembly.dll never loaded!"); return 1; }
    log("[init] GameAssembly base=0x%llX", (unsigned long long)g_base);

    if (MH_Initialize() != MH_OK) { log("[ERROR] MH_Initialize failed."); return 1; }

    InstallHook(g_base + RVA_EFFECT_ON_INIT,         reinterpret_cast<void*>(&Hook_EffectOnInit),       (void**)&g_OrigEffectOnInit,       "AdventureEffect$$OnInit");
    InstallHook(g_base + RVA_EFFECT_ON_CLEAR,        reinterpret_cast<void*>(&Hook_EffectOnClear),      (void**)&g_OrigEffectOnClear,      "AdventureEffectBase$$OnClear");
    InstallHook(g_base + RVA_UPDATE_LOGIC,           reinterpret_cast<void*>(&Hook_UpdateLogic),        (void**)&g_OrigUpdateLogic,        "AdventureLevelController$$UpdateLogic");
    InstallHook(g_base + RVA_BATTLE_START,           reinterpret_cast<void*>(&Hook_BattleStart),        (void**)&g_OrigBattleStart,        "ActorEffectManage$$OnBattleStart");
    InstallHook(g_base + RVA_SPAWN_SKILL,            reinterpret_cast<void*>(&Hook_SpawnSkill),         (void**)&g_OrigSpawnSkill,         "AdventureLevelController$$SpawnSkill");
    InstallHook(g_base + RVA_BUFF_EFFECT_ON_INIT,    reinterpret_cast<void*>(&Hook_BuffEffectOnInit),   (void**)&g_OrigBuffEffectOnInit,   "BuffEffectBase$$OnInit");
    InstallHook(g_base + RVA_BUFF_ENTITY_INIT,       reinterpret_cast<void*>(&Hook_BuffEntityInit),     (void**)&g_OrigBuffEntityInit,     "BuffEntity$$InitBuff");
    InstallHook(g_base + RVA_BUFF_ENTITY_EXCUTE,     reinterpret_cast<void*>(&Hook_BuffEntityExcute),   (void**)&g_OrigBuffEntityExcute,   "BuffEntity$$BuffExcute");
    InstallHook(g_base + RVA_CALC_NORMAL_DAMAGE,     reinterpret_cast<void*>(&Hook_CalcNormalDamage),   (void**)&g_OrigCalcNormalDamage,   "CommonHelper$$CalculateNormalDamage");
    InstallHook(g_base + RVA_MONSTER_ACTION_STATE_ON_ENTER, reinterpret_cast<void*>(&Hook_MonsterActionStateOnEnter), (void**)&g_OrigMonsterActionStateOnEnter, "MonsterActionState$$OnEnter");
    InstallHook(g_base + RVA_MODULE_CLEAR_DATA, reinterpret_cast<void*>(&Hook_ModuleClearData), (void**)&g_OrigModuleClearData, "AdventureModuleController$$ClearData");
    InstallHook(g_base + RVA_GET_BOTH_ALL_INFO, reinterpret_cast<void*>(&Hook_GetBothAllInfo), (void**)&g_OrigGetBothAllInfo, "AdventureActor$$GetBothAllInfo");
    InstallHook(g_base + RVA_AREA_COPY_BATTLE, reinterpret_cast<void*>(&Hook_CopyBattleData), (void**)&g_OrigCopyBattleData, "AreaEffectEntity$$CopyBattleData");
    InstallHook(g_base + RVA_WEAPON_SETUP, reinterpret_cast<void*>(&Hook_WeaponSetup), (void**)&g_OrigWeaponSetup, "AdventureWeapon$$Setup");
    InstallHttpHooks(g_base);
    
    log("[init] Ready.");
    return 0;
}

BOOL APIENTRY DllMain(HMODULE hInst, DWORD reason, LPVOID reserved) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(hInst);
        HANDLE h = CreateThread(nullptr, 0, InitThread, nullptr, 0, nullptr);
        if (h) CloseHandle(h);
    }
    else if (reason == DLL_PROCESS_DETACH) {
        MH_DisableHook(MH_ALL_HOOKS);
        MH_Uninitialize();
        if (g_Log)     { log("[uninit] DLL detached."); fclose(g_Log); g_Log = nullptr; }
        if (g_JsonLog) { fclose(g_JsonLog); g_JsonLog = nullptr; }
        ShutdownHttpLogger();
    }
    return TRUE;
}
