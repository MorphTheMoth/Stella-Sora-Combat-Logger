#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <objbase.h>
#include <cstdint>
#include <cstdio>
#include <string>
#include <unordered_map>
#include "MinHook.h"
#include "logging.h"
#include "http_hooks.h"
#include "star_tower_hooks.h"
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
static constexpr uintptr_t RVA_EFFECT_ON_INIT                = 0x113E6D0;
static constexpr uintptr_t RVA_EFFECT_ON_CLEAR               = 0x1139B40;
static constexpr uintptr_t RVA_UPDATE_LOGIC                  = 0x118EF10;
static constexpr uintptr_t RVA_BATTLE_START                  = 0x10450B0;
static constexpr uintptr_t RVA_SPAWN_SKILL                   = 0x118DA40;
static constexpr uintptr_t RVA_BUFF_EFFECT_ON_INIT           = 0x16F6B80;
static constexpr uintptr_t RVA_BUFF_ENTITY_INIT              = 0x16FB6A0;
static constexpr uintptr_t RVA_BUFF_ENTITY_EXCUTE            = 0x16FA360;
static constexpr uintptr_t RVA_CALC_NORMAL_DAMAGE            = 0x11213B0;
static constexpr uintptr_t RVA_GET_ONCE_ATTR                      = 0x1298660;
static constexpr uintptr_t RVA_GET_VALUE_CONFIG_ID                = 0x1126950;
static constexpr uintptr_t RVA_GET_EFFECT_VALUE                   = 0x1296860;
static constexpr uintptr_t RVA_GET_ONCE_ADDITIONAL_ATTRIBUTE_VALUE = 0x12984E0;
static constexpr uintptr_t RVA_MONSTER_ACTION_STATE_ON_ENTER = 0x1119F30;
static constexpr uintptr_t RVA_MODULE_CLEAR_DATA     = 0x15DF600;  // AdventureModuleController$$ClearData
static constexpr uintptr_t RVA_GET_BOTH_ALL_INFO     = 0x123EDF0;  // AdventureActor$$GetBothAllInfo
static constexpr uintptr_t RVA_AREA_COPY_BATTLE      = 0x16AADA0;  // AreaEffectEntity$$CopyBattleData
static constexpr uintptr_t RVA_WEAPON_SETUP          = 0x1727CC0;  // AdventureWeapon$$Setup
static constexpr uintptr_t RVA_FAKE_SET_ATTR_INFO     = 0x1373550;  // FakeAdventureActor$$SetAttrInfo
static constexpr uintptr_t RVA_SET_PLAYER_SUMMON_ATTR = 0x137BB80;  // MonsterAdventureActor$$SetPlayerSummonAttrInfo
static constexpr uintptr_t RVA_SET_PLAYER_SUMMON_SNAP = 0x137B6B0;  // MonsterAdventureActor$$SetPlayerSummonAttrInfoBySnapshot
static constexpr uintptr_t RVA_CLONE_SET_ATTR         = 0x149F820;  // MonsterCloneAdventureActor$$SetAttr
static constexpr uintptr_t RVA_PARSE_SUMMON_CFG       = 0x14A0490;  // MonsterSummonInfo$$ParseSummonCfg
static constexpr uintptr_t RVA_SAVE_PLAYER_SNAPSHOT  = 0x14A9B80;  // PlayerAdventureActor$$SavePlayerAttributeSnapshot
static constexpr uintptr_t RVA_IS_USE_HIT_FROM_SUMMON  = 0x110BFC0;  // ActorHelper$$IsUseHitFromSummon
static constexpr uintptr_t RVA_GDC_GET_HIT_DAMAGE      = 0x1296E60;  // GameDataController$$GetHitDamage
static constexpr uintptr_t RVA_GDC_GET_MONSTER         = 0x1298160;  // GameDataController$$GetMonster
// SceneSingleton<AdventureModuleDebugHelper>.get_Instance() — the global (in
// .data) that the engine's metadata init (FUN_180608250) patches to point at
// the MethodInfo.  FUN_180014830 (RVA 0x14830) is the shared get_Instance body
// we replicate in GetDebugHelperInstance().
static constexpr uintptr_t RVA_ADM_GET_INSTANCE_METHODINFO = 0x71F4C18;
static constexpr uintptr_t RVA_GET_INSTANCE_IMPL           = 0x14830;   // FUN_180014830 (get_Instance)

//  Cached module base
static uintptr_t g_base = 0;

//  Per-hit effect snapshot (set by GetBothAllInfo hook, used by CalculateNormalDamage)
static EffectSnapshot g_GetBothAllInfoSnapshot;
static bool g_HaveHitSnapshot = false;

//  Per-area effect snapshot (set by CopyBattleData hook, used for damageTypeTemp=5)
static std::mutex g_AreaSnapshotMutex;
static std::unordered_map<uintptr_t, SnapshotEntry> g_AreaSnapshots;

//  Per-weapon effect snapshot (set by AdventureWeapon::Setup, used for damageTypeTemp=2)
static std::mutex g_WeaponSnapshotMutex;
static std::unordered_map<uintptr_t, SnapshotEntry> g_WeaponSnapshots;

//  Snapshot time for GetBothAllInfo (actor hits)
static std::string g_SnapshotTime;

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
    g_SnapshotTime.clear();
    g_OrigModuleClearData(self, method);
}

// =============================================================================
//  CalculateNormalDamage hook
// =============================================================================
using FnCalcNormalDamage = int64_t(__fastcall*)( AdventureActor_o*, AdventureActor_o*, Nova_Client_HitDamage_o*,
    int32_t, bool, bool, int32_t*, int64_t*, int64_t*, int64_t*, int64_t*, int64_t*, int64_t*, int64_t*, int64_t*, int64_t*, int64_t*, int64_t*, int64_t*, int64_t*, int64_t*, int64_t*, void*);
static FnCalcNormalDamage g_OrigCalcNormalDamage = nullptr;


static std::atomic<GameDataController_o*> g_gdc{nullptr};  // atomic, not raw pointer

// =============================================================================
//  Capture GDC singleton from any GameDataController method
//  All Get* methods follow (GameDataController_o* __this, int32_t key, MethodInfo*)
// =============================================================================
using FnGdcGet = void* (__fastcall*)(GameDataController_o*, int32_t, void*);

struct GdcHook {
    FnGdcGet original;
    const char* name;
};

static GdcHook g_GdcHooks[2] = {
    { nullptr, "GameDataController$$GetHitDamage" },
    { nullptr, "GameDataController$$GetMonster" },
};

static void* __fastcall GdcHook_GetHitDamage(GameDataController_o* __this, int32_t key, void* method) {
    if (!g_gdc.load(std::memory_order_relaxed) && __this)
        g_gdc.store(__this, std::memory_order_relaxed);
    return g_GdcHooks[0].original(__this, key, method);
}
static void* __fastcall GdcHook_GetMonster(GameDataController_o* __this, int32_t key, void* method) {
    if (!g_gdc.load(std::memory_order_relaxed) && __this)
        g_gdc.store(__this, std::memory_order_relaxed);
    return g_GdcHooks[1].original(__this, key, method);
}

static GameDataController_o* GetGDC() {
    return g_gdc.load(std::memory_order_relaxed);
}




static int64_t __fastcall Hook_CalcNormalDamage(
    AdventureActor_o* fromActor, AdventureActor_o* toActor, Nova_Client_HitDamage_o* hitDamageConfig,
    int32_t skillLevel, bool isCrit, bool isDot, int32_t* hudColorIndex, int64_t* skillPercentAmend,
    int64_t* talentGroupPercentAmend, int64_t* skillAbsAmend, int64_t* talentGroupAbsAmend, int64_t* perkIntensityRatio, int64_t* slotDmgRatio,
    int64_t* fromEE, int64_t* erAmend, int64_t* defAmend, int64_t* rcdSlotDmgRatio, int64_t* toEERCD, int64_t* skillIntensityRatio,
    int64_t* toughnessBrokenDmgRatio, int64_t* critRatio, int64_t* envAmendRatio, void* method)
{
    auto callOriginal = [&]() -> int64_t {
        return g_OrigCalcNormalDamage(
            fromActor, toActor, hitDamageConfig, skillLevel, isCrit, isDot, hudColorIndex,
            skillPercentAmend, talentGroupPercentAmend, skillAbsAmend, talentGroupAbsAmend,
            perkIntensityRatio, slotDmgRatio, fromEE, erAmend, defAmend, rcdSlotDmgRatio,
            toEERCD, skillIntensityRatio, toughnessBrokenDmgRatio, critRatio, envAmendRatio, method);
    };
    
    // ── Step 1: walk klass chain for static fields ───────────────────────────
    if (!fromActor)         { return callOriginal(); }
    if (!fromActor->klass)  { return callOriginal(); }

    Il2CppClass* parentKlass = fromActor->klass->_1.parent;
    if (!parentKlass) { return callOriginal(); }

    AdventureActor_c* actorClass = reinterpret_cast<AdventureActor_c*>(parentKlass);
    if (!actorClass->static_fields) { return callOriginal(); }

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

    // ── Step 2: choose the right effect snapshot for this hit ──────────────────
    EffectSnapshot hitSnapshot;
    std::string snapshotTime;
    const EffectSnapshot* hitEffectSnapshot = nullptr;
    const std::string* pHitSnapshotTime = nullptr;

    if (damageTypeTemp == 2 && staticFields->fromWeaponTemp) {
        auto weaponPtr = reinterpret_cast<uintptr_t>(staticFields->fromWeaponTemp);
        {
            std::lock_guard<std::mutex> lk(g_WeaponSnapshotMutex);
            auto it = g_WeaponSnapshots.find(weaponPtr);
            if (it != g_WeaponSnapshots.end()) {
                hitSnapshot = it->second.ids;
                snapshotTime = it->second.gameTime;
                hitEffectSnapshot = &hitSnapshot;
                pHitSnapshotTime = &snapshotTime;
            }
        }
    }
    if (!hitEffectSnapshot && damageTypeTemp == 5 && staticFields->fromAreaTemp) {
        auto areaPtr = reinterpret_cast<uintptr_t>(staticFields->fromAreaTemp);
        {
            std::lock_guard<std::mutex> lk(g_AreaSnapshotMutex);
            auto it = g_AreaSnapshots.find(areaPtr);
            if (it != g_AreaSnapshots.end()) {
                hitSnapshot = it->second.ids;
                snapshotTime = it->second.gameTime;
                hitEffectSnapshot = &hitSnapshot;
                pHitSnapshotTime = &snapshotTime;
            }
        }
    }
    if (!hitEffectSnapshot && g_HaveHitSnapshot) {
        hitSnapshot = g_GetBothAllInfoSnapshot;
        snapshotTime = g_SnapshotTime;
        hitEffectSnapshot = &hitSnapshot;
        pHitSnapshotTime = &snapshotTime;
    }

    // ── Step 3: original call ────────────────────────────────────────────────
    int64_t dmg = callOriginal();

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
        GetEffectValue, GetAttrValue, hitEffectSnapshot, pHitSnapshotTime);

    return dmg;
}

// =============================================================================
//  AreaEffectEntity::CopyBattleData — snapshot effects when area snapshots stats
// =============================================================================
using FnCopyBattleData = void(__fastcall*)(void*, bool, void*);
static FnCopyBattleData g_OrigCopyBattleData = nullptr;

using FnIsUseHitFromSummon = bool(__fastcall*)(LogicEntity_o*, PlayerAdventureActor_o**, void*);
static FnIsUseHitFromSummon g_IsUseHitFromSummon = nullptr;

static void __fastcall Hook_CopyBattleData(void* areaEntity, bool force, void* method)
{
    g_OrigCopyBattleData(areaEntity, force, method);

    // Lazy-init the IsUseHitFromSummon function pointer
    if (!g_IsUseHitFromSummon && g_base)
        g_IsUseHitFromSummon = reinterpret_cast<FnIsUseHitFromSummon>(g_base + RVA_IS_USE_HIT_FROM_SUMMON);

    auto* area = reinterpret_cast<AreaEffectEntity_o*>(areaEntity);

    // Step 1: Get potential sources.
    // NOTE: since the game update, AreaEffectEntity::CopyBattleData copies stats
    // from _owner_k__BackingField only. _fxPlayer_k__BackingField is now a real
    // AdventureFXPlayer (MonoBehaviour, NOT an AdventureActor), so it must never
    // be used as the effect source.
    AdventureActor_o* fxPlayer = reinterpret_cast<AdventureActor_o*>(area->fields._fxPlayer_k__BackingField);
    AdventureActor_o* owner = area->fields._owner_k__BackingField;

    // Step 2: Owner is the game's stats source; fxPlayer is only a legacy
    // fallback for the pre-update layout where it pointed at the owner actor.
    AdventureActor_o* source = owner ? owner : fxPlayer;

    // Step 3: If source exists, check if summoned → resolve to summoner
    bool isSummoned = false;
    AdventureActor_o* summonerResolved = nullptr;
    if (source && g_IsUseHitFromSummon) {
        PlayerAdventureActor_o* rawSummoner = nullptr;
        isSummoned = g_IsUseHitFromSummon(
            reinterpret_cast<LogicEntity_o*>(source),
            reinterpret_cast<PlayerAdventureActor_o**>(&rawSummoner),
            nullptr);
        if (isSummoned && rawSummoner)
            summonerResolved = reinterpret_cast<AdventureActor_o*>(rawSummoner);
    }

    // Use resolved summoner as the final source for effects
    if (summonerResolved)
        source = summonerResolved;

    EffectSnapshot snap;
    if (source && source->fields.effectManage) {
        auto* effectsDict = source->fields.effectManage->fields.effectsDict;
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
        g_AreaSnapshots[reinterpret_cast<uintptr_t>(areaEntity)] = { std::move(snap), gameTime() };
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

    // Lazy-init IsUseHitFromSummon
    if (!g_IsUseHitFromSummon && g_base)
        g_IsUseHitFromSummon = reinterpret_cast<FnIsUseHitFromSummon>(g_base + RVA_IS_USE_HIT_FROM_SUMMON);

    // Resolve the real stats source — same as Hook_CopyBattleData:
    // if the owner is a summoned entity, use the summoner instead
    AdventureActor_o* source = reinterpret_cast<AdventureActor_o*>(owner);
    if (source && g_IsUseHitFromSummon) {
        PlayerAdventureActor_o* summoner = nullptr;
        bool isSummoned = g_IsUseHitFromSummon(
            reinterpret_cast<LogicEntity_o*>(source),
            reinterpret_cast<PlayerAdventureActor_o**>(&summoner),
            nullptr);
        if (isSummoned && summoner)
            source = reinterpret_cast<AdventureActor_o*>(summoner);
    }

    EffectSnapshot snap;
    if (source && source->fields.effectManage) {
        auto* effectsDict = source->fields.effectManage->fields.effectsDict;
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
        g_WeaponSnapshots[reinterpret_cast<uintptr_t>(weapon)] = { std::move(snap), gameTime() };
    }
}

// =============================================================================
//  Minion/Summon stat initialization hooks
// =============================================================================

using FnFakeSetAttrInfo = void(__fastcall*)(AdventureActor_o*, int32_t, int64_t, int32_t, void*);
static FnFakeSetAttrInfo g_OrigFakeSetAttrInfo = nullptr;

static void __fastcall Hook_FakeSetAttrInfo(AdventureActor_o* self, int32_t templeteId,
                                            int64_t attributeId, int32_t factionID, void* method)
{
    g_OrigFakeSetAttrInfo(self, templeteId, attributeId, factionID, method);
    log("[MINION] FakeAdventureActor$$SetAttrInfo id=%d attrId=%lld faction=%d time=%s",
        templeteId, (long long)attributeId, factionID, gameTime().c_str());
}

using FnSetPlayerSummonAttr = void(__fastcall*)(AdventureActor_o*, AdventureActor_o*, int32_t, void*);
static FnSetPlayerSummonAttr g_OrigSetPlayerSummonAttr = nullptr;

static void __fastcall Hook_SetPlayerSummonAttr(AdventureActor_o* self, AdventureActor_o* player,
                                                int32_t percent, void* method)
{
    g_OrigSetPlayerSummonAttr(self, player, percent, method);
    log("[MINION] MonsterAdventureActor$$SetPlayerSummonAttrInfo percent=%d player=%s time=%s",
        percent, player ? adventureActorId(player).c_str() : "null", gameTime().c_str());
}

using FnSetPlayerSummonSnap = void(__fastcall*)(AdventureActor_o*, AdventureActor_o*, int32_t, void*);
static FnSetPlayerSummonSnap g_OrigSetPlayerSummonSnap = nullptr;

static void __fastcall Hook_SetPlayerSummonSnap(AdventureActor_o* self, AdventureActor_o* player,
                                                int32_t percent, void* method)
{
    g_OrigSetPlayerSummonSnap(self, player, percent, method);

    // Store minion→player mapping for inherited effect tracking
    if (self && player) {
        MinionLink link;
        link.playerId = adventureActorId(player);
        link.summonAttrType = 2;
        {
            std::lock_guard<std::mutex> lk(g_MinionLinkMutex);
            g_MinionToPlayer[adventureActorId(self)] = link;
        }
    }

    //log("[MINION] MonsterAdventureActor$$SetPlayerSummonAttrInfoBySnapshot percent=%d player=%s time=%s",
    //    percent, player ? adventureActorId(player).c_str() : "null", gameTime().c_str());
}

// =============================================================================
//  Player snapshot stat save hook — capture player's effects for minions
// =============================================================================
using FnSaveSnapshot = void(__fastcall*)(AdventureActor_o*, void*);
static FnSaveSnapshot g_OrigSaveSnapshot = nullptr;

static void __fastcall Hook_SavePlayerSnapshot(AdventureActor_o* player, void* method)
{
    g_OrigSaveSnapshot(player, method);

    if (!player) { log("[SNAP] SavePlayerSnapshot: player is null"); return; }

    PlayerEffectSnapshot snap;
    snap.time = gameTime();

    // Read origin + baseAmend (total base) AND percentAmend from player's attributeList
    if (auto* sl = player->fields.attributeList) {
        if (auto* entriesArr = sl->fields.entries) {
            snap.baseValues.resize(0x61, 0.0);
            snap.pctValues.resize(0x61, 0.0);
            for (int t = 1; t < 0x61; t++) {
                int64_t* origin = reinterpret_cast<int64_t*>(
                    reinterpret_cast<uint8_t*>(entriesArr) + 0x20 + t * 0x20 + 0x00);
                int64_t* baseAmend = reinterpret_cast<int64_t*>(
                    reinterpret_cast<uint8_t*>(entriesArr) + 0x20 + t * 0x20 + 0x08);
                int64_t* pctAmend = reinterpret_cast<int64_t*>(
                    reinterpret_cast<uint8_t*>(entriesArr) + 0x20 + t * 0x20 + 0x10);
                snap.baseValues[t] = (double)(*origin + *baseAmend) / 16777216.0;
                snap.pctValues[t] = (double)(*pctAmend) / 16777216.0;
            }
        } else {
            log("[SNAP] SavePlayerSnapshot: attributeList entries is null");
        }
    } else {
        log("[SNAP] SavePlayerSnapshot: attributeList is null for player=%s", adventureActorId(player).c_str());
    }

    // Collect active effects from player's effectsDict
    if (auto* em = player->fields.effectManage) {
        if (auto* dict = em->fields.effectsDict) {
            auto* entriesArr = dict->fields._entries;
            int slotCount = dict->fields._count;
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
                    if (!stack || !stack->fields._array || stack->fields._size <= 0) continue;

                    auto* array = stack->fields._array;
                    int size = stack->fields._size;
                    constexpr size_t arrayHeaderSize = 0x20;
                    uintptr_t itemsStart = reinterpret_cast<uintptr_t>(array) + arrayHeaderSize;

                    for (int s = 0; s < size; ++s) {
                        AdventureEffectBase_o* base = *reinterpret_cast<AdventureEffectBase_o**>(itemsStart + s * sizeof(void*));
                        if (!base) continue;

                        AdventureEffect_o* parentEffect = base->fields._effect;
                        auto* effectCfg = parentEffect->fields._effectConfig_k__BackingField;
                        auto* valueCfg = parentEffect->fields._effectValueConfig_k__BackingField;

                        int32_t configId = effectCfg ? effectCfg->fields.id_ : 0;
                        int32_t valueConfigId = valueCfg ? valueCfg->fields.id_ : 0;
                        int32_t attrType = valueCfg ? valueCfg->fields.effectTypeFirstSubtype_ : 0;
                        int32_t paramType = valueCfg ? valueCfg->fields.effectTypeSecondSubtype_ : 0;

                        if (configId == 0) continue;

                        PlayerEffectEntry pe;
                        pe.instanceId = parentEffect->fields.id;
                        pe.configId = configId;
                        pe.valueConfigId = valueConfigId;
                        pe.sourceType = parentEffect->fields.sourceType;
                        pe.damage = static_cast<int64_t>(parentEffect->fields.Damage);
                        pe.attributeType = attrType;
                        pe.parameterType = paramType;

                        if (attrType > 0 && attrType < 0x61) {
                            pe.baseStatOnSnapshot = snap.baseValues[attrType];
                            pe.pctStatOnSnapshot = snap.pctValues[attrType];
                        } else {
                            pe.baseStatOnSnapshot = 0.0;
                            pe.pctStatOnSnapshot = 0.0;
                        }

                        if (parentEffect->fields._owner)
                            pe.ownerId = adventureActorId(parentEffect->fields._owner);

                        snap.entries.push_back(pe);
                    }
                }
            }
        }
    }

    {
        std::lock_guard<std::mutex> lk(g_PlayerSnapshotMutex);
        g_PlayerSnapshots[adventureActorId(player)] = std::move(snap);
    }
}

using FnCloneSetAttr = void(__fastcall*)(AdventureActor_o*, AdventureActor_o*, void*);
static FnCloneSetAttr g_OrigCloneSetAttr = nullptr;

static void __fastcall Hook_CloneSetAttr(AdventureActor_o* self, AdventureActor_o* master, void* method)
{
    g_OrigCloneSetAttr(self, master, method);
    log("[MINION] MonsterCloneAdventureActor$$SetAttr master=%s self=%s time=%s",
        master ? adventureActorId(master).c_str() : "null",
        self ? adventureActorId(self).c_str() : "null",
        gameTime().c_str());
}

using FnParseSummonCfg = void(__fastcall*)(void*, void*, void*, void*);
static FnParseSummonCfg g_OrigParseSummonCfg = nullptr;

// Minimal struct to read SummonCfg fields by offset
struct SummonCfgFields {
    int32_t summonType;
    int32_t summonFollowType;
    int32_t summonAttrType;
    int32_t summonRelation;
    int32_t attrPercent;
    int64_t leftTime;
    int32_t maxCount;
    bool retainWhenCrossLevel;
    bool useSummonHit;
};

// Player dataID → display name (for summon-owner logging).
static const char* SummonerName(int32_t dataId) {
    switch (dataId) {
        case 103: return "Amber";
        case 106: return "Aeloria";
        case 107: return "Tilia";
        case 108: return "Kasimira";
        case 109: return "Aobelle";
        case 110: return "Firenze";
        case 111: return "Iris";
        case 112: return "Noya";
        case 113: return "Shimiao";
        case 114: return "Chaton";
        case 115: return "Firefly";
        case 116: return "Ridge";
        case 117: return "Jinglin";
        case 118: return "Coronis";
        case 119: return "Nanoha";
        case 120: return "Canace";
        case 123: return "Ann";
        case 125: return "Freesia";
        case 126: return "Flora";
        case 127: return "Teresa";
        case 129: return "Yoranda";
        case 130: return "Donna";
        case 131: return "Bloc";
        case 132: return "Minova";
        case 133: return "Nazuka";
        case 134: return "Fuyuka";
        case 135: return "Mistique";
        case 136: return "Angie";
        case 137: return "Eleanor";
        case 138: return "Nyx";
        case 139: return "Allie";
        case 140: return "Sparkla";
        case 141: return "Chixia";
        case 142: return "Cosette";
        case 143: return "Wraith";
        case 144: return "Chitose";
        case 145: return "Otoha";
        case 146: return "Benito";
        case 147: return "Caramel";
        case 149: return "Gerie";
        case 150: return "Laru";
        case 151: return "Yunshu";
        case 152: return "Jiyue";
        case 153: return "Danyun";
        case 155: return "Shia";
        case 156: return "Nazuna";
        case 157: return "Karin";
        case 158: return "Laru";
        case 159: return "Coronis";
        case 160: return "Willow";
        case 163: return "Greyhorn";
        case 164: return "Shuo";
        default: return "?";
    }
}

static void __fastcall Hook_ParseSummonCfg(void* summonInfo, void* cfgData, void* spawnInfo, void* method)
{
    g_OrigParseSummonCfg(summonInfo, cfgData, spawnInfo, method);
    int32_t attrType = -1;
    int32_t perc = 0;
    if (cfgData) {
        auto* f = reinterpret_cast<SummonCfgFields*>(reinterpret_cast<uint8_t*>(cfgData) + 0x10); // skip klass+monitor
        attrType = f->summonAttrType;
        perc = f->attrPercent;
    }
    // Summoner (owner) is MonsterSummonInfo._SummonActor_k__BackingField:
    // first field after LogicComponent (0x10) + klass/monitor (0x10) = +0x20.
    int32_t ownerId = 0;
    const char* ownerName = "?";
    if (summonInfo) {
        AdventureActor_o* summoner = *reinterpret_cast<AdventureActor_o**>(reinterpret_cast<uint8_t*>(summonInfo) + 0x20);
        if (summoner) {
            ownerId = summoner->fields._dataID_k__BackingField;
            ownerName = SummonerName(ownerId);
        }
    }
    //log("[MINION] summon type=%d percent=%d owner=%s(%d) time=%s",
    //    attrType, perc, ownerName, ownerId, gameTime().c_str());
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
    g_SnapshotTime = gameTime();
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
    g_GameTimeFP.fetch_add(logicDeltaTime.fields._serializedValue, std::memory_order_relaxed);

    // Re-apply gizmo flags every tick — the engine clears them between frames,
    // so a one-shot write at DllMain is not enough.
    EnableAllDebugGizmos(g_base);

    g_OrigUpdateLogic(self, logicDeltaTime, method);
}

void* GetDebugHelperInstance() {
    if (!g_base) return nullptr;

    // Nothing to do if every gizmo is off.
    if (!g_Cfg.player_gizmo && !g_Cfg.monster_gizmo && !g_Cfg.bullet_gizmo &&
        !g_Cfg.hitbox_gizmo && !g_Cfg.hearing_gizmo_for_player && !g_Cfg.hearing_gizmo_for_monster &&
        !g_Cfg.vision_gizmo_for_player && !g_Cfg.vision_gizmo_for_monster &&
        !g_Cfg.input_and_vision_gizmo && !g_Cfg.monster_path_gizmo &&
        !g_Cfg.player_path_gizmo && !g_Cfg.camera_gizmo) {
        return nullptr;
    }

    // The game's generic-class metadata lives on the il2cpp HEAP, not in the
    // module image (observed: mi=0x3276AD00, klass=0x3276A180), so any manual
    // re-implementation that range-checks against the module is wrong.  Just
    // call the engine's own get_Instance (FUN_180014830) with the MethodInfo*
    // the engine itself uses — exactly what the pre-update code did.  It
    // handles Class::Init internally and returns the singleton (or null until
    // the helper has been Awake'd).
    typedef uintptr_t(__fastcall* FnGetInstance)(uintptr_t mi);
    static FnGetInstance getInstance = nullptr;
    if (!getInstance) getInstance = (FnGetInstance)(g_base + RVA_GET_INSTANCE_IMPL);

    uintptr_t mi = *(uintptr_t*)(g_base + RVA_ADM_GET_INSTANCE_METHODINFO);

    // Rate-limited diagnostics — log the first ~20 attempts and every 300th
    // after that.  Removed once this is confirmed working.
    static int64_t s_attempts = 0;
    s_attempts++;
    #define GIZMO_LOG(...) do { if (s_attempts <= 20 || (s_attempts % 300) == 0) log(__VA_ARGS__); } while (0)

    // Guard before handing mi to the engine's getter (which derefs it): require
    // a plausible pointer.  Unpatched metadata tokens are tiny/unaligned and are
    // rejected here; the patched MethodInfo is 8-aligned.
    if (!mi || mi < 0x10000 || (mi & 7)) {
        GIZMO_LOG("[gizmo] resolve #%lld mi=0x%llX -> implausible (not patched yet?)", (long long)s_attempts, (unsigned long long)mi);
        return nullptr;
    }
    GIZMO_LOG("[gizmo] resolve #%lld mi=0x%llX -> calling get_Instance", (long long)s_attempts, (unsigned long long)mi);

    uintptr_t inst = getInstance(mi);
    if (!inst) {
        GIZMO_LOG("[gizmo]   get_Instance -> 0 (helper not awake yet, retrying)");
        return nullptr;
    }
    GIZMO_LOG("[gizmo] RESOLVED instance=0x%llX", (unsigned long long)inst);
    #undef GIZMO_LOG
    return (void*)inst;
}

// =============================================================================
//  TEMPORARY DIAGNOSTIC — engine gizmo call observers
//  Hooks the engine's ShowCircleGizmo / ShowRingGizmo to prove whether the
//  engine itself reaches the draw calls when the flags are set.  Passes through
//  to origin so rendering is unaffected.  Remove once the feature works.
// =============================================================================
static constexpr uintptr_t RVA_SHOW_CIRCLE_GIZMO_DIAG = 0x111DB70;  // AdventureModuleDebugHelper$$ShowCircleGizmo
static constexpr uintptr_t RVA_SHOW_RING_GIZMO_DIAG   = 0x111F7B0;  // AdventureModuleDebugHelper$$ShowRingGizmo

typedef void (__fastcall* FnShowCircleGizmoDiag_t)(void* __this, void* pos, void* up, float radius, void* color, float durationTime, float lineWidthPixels, void* method);
static FnShowCircleGizmoDiag_t g_OrigShowCircleGizmoDiag = nullptr;

static void __fastcall Hook_ShowCircleGizmoDiag(void* __this, void* pos, void* up, float radius, void* color, float durationTime, float lineWidthPixels, void* method) {
    static int64_t s_count = 0;
    if ((++s_count) <= 3 || (s_count % 500) == 0) {
        log("[gizmo] ENGINE ShowCircleGizmo x%lld this=0x%llX r=%.2f dur=%.2f",
            (long long)s_count, (unsigned long long)__this, radius, durationTime);
    }
    g_OrigShowCircleGizmoDiag(__this, pos, up, radius, color, durationTime, lineWidthPixels, method);
}

typedef void (__fastcall* FnShowRingGizmoDiag_t)(void* __this, void* pos, void* up, float innerRadius, float radius, void* innerColor, void* color, float durationTime, void* method);
static FnShowRingGizmoDiag_t g_OrigShowRingGizmoDiag = nullptr;

static void __fastcall Hook_ShowRingGizmoDiag(void* __this, void* pos, void* up, float innerRadius, float radius, void* innerColor, void* color, float durationTime, void* method) {
    static int64_t s_count = 0;
    if ((++s_count) <= 3 || (s_count % 500) == 0) {
        log("[gizmo] ENGINE ShowRingGizmo x%lld this=0x%llX ir=%.2f r=%.2f dur=%.2f",
            (long long)s_count, (unsigned long long)__this, innerRadius, radius, durationTime);
    }
    g_OrigShowRingGizmoDiag(__this, pos, up, innerRadius, radius, innerColor, color, durationTime, method);
}


using FnBattleStart = void(__fastcall*)( void*, void*, void*);
static FnBattleStart g_OrigBattleStart = nullptr;

static void __fastcall Hook_BattleStart(void* self, void* evt, void* method) {
    g_CombatStartTimeFP.store(g_GameTimeFP.load(std::memory_order_relaxed), std::memory_order_relaxed);
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
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    InitializeLogger();
    if (!g_Log) { CoUninitialize(); return 1; }

    std::string logDir = GetLocalAppDataPath() + "\\Stella Sora Combat Logger";
    loadConfig(logDir);
    BuildGemAttrTable(GetLocalAppDataPath() + "\\StellaSoraData");
    InitHttpLogger(logDir);
    InitStarTowerLogger(logDir);

    for (int i = 0; i < 60; i++) {
        g_base = reinterpret_cast<uintptr_t>(GetModuleHandleA("GameAssembly.dll"));
        if (g_base) break;
        log("[init] Waiting for GameAssembly.dll... attempt %d/60", i + 1);
        Sleep(500);
    }
    if (!g_base) { log("[ERROR] GameAssembly.dll never loaded!"); CoUninitialize(); return 1; }
    log("[init] GameAssembly base=0x%llX", (unsigned long long)g_base);

    if (MH_Initialize() != MH_OK) { log("[ERROR] MH_Initialize failed."); CoUninitialize(); return 1; }

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
    InstallHook(g_base + RVA_MODULE_CLEAR_DATA,      reinterpret_cast<void*>(&Hook_ModuleClearData),    (void**)&g_OrigModuleClearData,    "AdventureModuleController$$ClearData");
    InstallHook(g_base + RVA_GET_BOTH_ALL_INFO,      reinterpret_cast<void*>(&Hook_GetBothAllInfo),     (void**)&g_OrigGetBothAllInfo,     "AdventureActor$$GetBothAllInfo");
    InstallHook(g_base + RVA_AREA_COPY_BATTLE,       reinterpret_cast<void*>(&Hook_CopyBattleData),     (void**)&g_OrigCopyBattleData,     "AreaEffectEntity$$CopyBattleData");
    InstallHook(g_base + RVA_WEAPON_SETUP,           reinterpret_cast<void*>(&Hook_WeaponSetup),        (void**)&g_OrigWeaponSetup,        "AdventureWeapon$$Setup");
    InstallHook(g_base + RVA_FAKE_SET_ATTR_INFO,     reinterpret_cast<void*>(&Hook_FakeSetAttrInfo),    (void**)&g_OrigFakeSetAttrInfo,    "FakeAdventureActor$$SetAttrInfo");
    InstallHook(g_base + RVA_SET_PLAYER_SUMMON_ATTR, reinterpret_cast<void*>(&Hook_SetPlayerSummonAttr),(void**)&g_OrigSetPlayerSummonAttr,"MonsterAdventureActor$$SetPlayerSummonAttrInfo");
    InstallHook(g_base + RVA_SET_PLAYER_SUMMON_SNAP, reinterpret_cast<void*>(&Hook_SetPlayerSummonSnap),(void**)&g_OrigSetPlayerSummonSnap,"MonsterAdventureActor$$SetPlayerSummonAttrInfoBySnapshot");
    InstallHook(g_base + RVA_CLONE_SET_ATTR,         reinterpret_cast<void*>(&Hook_CloneSetAttr),       (void**)&g_OrigCloneSetAttr,       "MonsterCloneAdventureActor$$SetAttr");
    InstallHook(g_base + RVA_PARSE_SUMMON_CFG,       reinterpret_cast<void*>(&Hook_ParseSummonCfg),     (void**)&g_OrigParseSummonCfg,     "MonsterSummonInfo$$ParseSummonCfg");
    InstallHook(g_base + RVA_SAVE_PLAYER_SNAPSHOT,   reinterpret_cast<void*>(&Hook_SavePlayerSnapshot), (void**)&g_OrigSaveSnapshot,       "PlayerAdventureActor$$SavePlayerAttributeSnapshot");
    InstallHook(g_base + RVA_GDC_GET_HIT_DAMAGE,     reinterpret_cast<void*>(&GdcHook_GetHitDamage),    (void**)&g_GdcHooks[0].original, g_GdcHooks[0].name);
    InstallHook(g_base + RVA_GDC_GET_MONSTER,        reinterpret_cast<void*>(&GdcHook_GetMonster),      (void**)&g_GdcHooks[1].original, g_GdcHooks[1].name);
    InstallHook(g_base + RVA_SHOW_CIRCLE_GIZMO_DIAG, reinterpret_cast<void*>(&Hook_ShowCircleGizmoDiag), (void**)&g_OrigShowCircleGizmoDiag, "ShowCircleGizmo(debug observer)");
    InstallHook(g_base + RVA_SHOW_RING_GIZMO_DIAG,   reinterpret_cast<void*>(&Hook_ShowRingGizmoDiag),   (void**)&g_OrigShowRingGizmoDiag,   "ShowRingGizmo(debug observer)");
    InstallHttpHooks(g_base);
    
    log("[init] Ready.");
    CoUninitialize();
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
        ShutdownStarTowerLogger();
        ShutdownHttpLogger();
    }
    return TRUE;
}
