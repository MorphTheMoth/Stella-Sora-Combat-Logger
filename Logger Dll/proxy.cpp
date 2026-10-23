#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <objbase.h>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <string>
#include <unordered_map>
#include "MinHook.h"
#include "logging.h"
#include "hybrid_hooks.h"
#include "http_hooks.h"
#include "star_tower_hooks.h"
#include "game_structs.h"

// ─── ScoreBoss "dummy" test-stage feature (dummy.cpp) ───────────────────────
// Alt+1..5 entry hotkeys + the Blitz formation-screen "Dummy" button, pumped
// over the game window's message loop and torn down on detach.
bool InstallHotkeys();
void StartHotkeyRetry();
void RemoveHotkeys();
void EnsureScoreBossTestButton();

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
//  Module base
// =============================================================================
// Since 2.0.0 the combat/AI implementation is HybridCLR-interpreted code in
// `Hotfix.dll`; there are no per-method addresses to hook.  The module base is
// still needed to locate the interpreter (hybrid::Detect) and for the one
// remaining AOT hook, `HttpNetworkManager$$DispatchMsgToLua` (http_hooks.cpp).
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

// Per-room hit snapshot state, cleared on room change — shared with the Lua
// clock's run-start path (LuaClockRunStart in logging.cpp).
void ResetHitSnapshots() {
    g_HaveHitSnapshot = false;
    g_SnapshotTime.clear();
}

// =============================================================================
//  Boss Blitz floor-enter hook (room-enter signal for the Lua game clock)
//  AdventureModuleHelper.EnterScoreBossFloor is called from ScoreBossLevel.lua:76
//  on every Blitz floor entry — first entry and retry — so it works on the first
//  combat after game start, before the Lua clock listener has been installed.
//  Room-enter processing (clock seed + Reset) runs synchronously here, before the
//  scene load starts, so it precedes the actor-spawn setup logs; the origin
//  catalog refresh is deferred to PollLuaClock (Lua VM re-entry not safe from
//  this call context).  The attach layer forwards the engine call itself.
// =============================================================================
static void __fastcall Hook_EnterScoreBossFloor(int32_t id, void* team, void* method) {
    LuaClockNotifyRoomEnter();
}

// =============================================================================
//  Reset-button hook
// =============================================================================
static void __fastcall Hook_ModuleClearData(void* self, void* method) {
    OnResetTime();
    ResetHitSnapshots();
    // Re-read the live origin catalog (emblems/gems + char base + discs) from the
    // game's Lua state on the main thread; the next damage event emits it once.
    RefreshOriginCatalog();
    // Room transition (incl. back to lobby/menu): (re)install the Blitz test
    // button patch + ensure the clone exists. Same main-thread DoString context.
    EnsureScoreBossTestButton();
    // Lua-clock modes (Boss Blitz): LuaClockNotifyRoomEnter already emitted the
    // Reset at room entry, so skip a duplicate here.  The matching Record is
    // emitted by the poll once the build data is ready.
    if (!LuaClockOwnsResetLog())
        BuildResetJson();
}

// =============================================================================
//  CalculateNormalDamage hook
// =============================================================================
// Game data / helper accessors.  All of them are interpreted hotfix methods, so
// they are resolved + invoked by name through the interpreter (the old
// `g_base + RVA` direct calls only existed in <=1.16.1).
static Nova_Client_OnceAdditionalAttribute_o* __fastcall HyGetOnceAdditionalAttribute(
        GameDataController_o* self, int32_t key, void*) {
    uint64_t a[2] = { (uint64_t)(uintptr_t)self, (uint64_t)(int64_t)key };
    // Class from the live object: HotfixDataController declares ~3.5k methods
    // while its class array exposes only 935, so a class-table name lookup can
    // miss; the object already knows its class.
    auto r = hybrid::CallGameMethodOnObject(self, "GetOnceAdditionalAttribute", a, 2,
                                            "GetOnceAdditionalAttribute");
    return reinterpret_cast<Nova_Client_OnceAdditionalAttribute_o*>(r);
}

static Nova_Client_OnceAdditionalAttributeValue_o* __fastcall HyGetOnceAdditionalAttributeValue(
        GameDataController_o* self, int32_t key, void*) {
    uint64_t a[2] = { (uint64_t)(uintptr_t)self, (uint64_t)(int64_t)key };
    auto r = hybrid::CallGameMethodOnObject(self, "GetOnceAdditionalAttributeValue", a, 2,
                                            "GetOnceAdditionalAttributeValue");
    return reinterpret_cast<Nova_Client_OnceAdditionalAttributeValue_o*>(r);
}

static int32_t __fastcall HyGetValueConfigIdByLevelType(
        AdventureActor_o* actor, int32_t mainConfigId, int32_t type, int32_t data, void*) {
    uint64_t a[4] = { (uint64_t)(uintptr_t)actor, (uint64_t)(int64_t)mainConfigId,
                      (uint64_t)(int64_t)type, (uint64_t)(int64_t)data };
    uint64_t r = hybrid::CallGameMethod("CommonHelper", "GetValueConfigIdByLevelType", a, 4,
                                        "GetValueConfigIdByLevelType");
    return (int32_t)(uint32_t)r;
}

using FnCalcNormalDamage = int64_t(__fastcall*)( AdventureActor_o*, AdventureActor_o*, Nova_Client_HitDamage_o*,
    int32_t, bool, bool, int32_t*, int64_t*, int64_t*, int64_t*, int64_t*, int64_t*, int64_t*, int64_t*, int64_t*, int64_t*, int64_t*, int64_t*, int64_t*, int64_t*, int64_t*, int64_t*, void*);
static FnCalcNormalDamage g_OrigCalcNormalDamage = nullptr;


static std::atomic<GameDataController_o*> g_gdc{nullptr};

// =============================================================================
//  Capture GDC singleton from any GameDataController method
//  All Get* methods follow (GameDataController_o* __this, int32_t key, MethodInfo*)
// =============================================================================
using FnGdcGet = void* (__fastcall*)(GameDataController_o*, int32_t, void*);
static FnGdcGet g_OrigGdcGetMonster = nullptr;

// Record the GDC singleton the first time any hooked Get* method fires.
static inline void CaptureGdc(GameDataController_o* __this) {
    if (!g_gdc.load(std::memory_order_relaxed) && __this)
        g_gdc.store(__this, std::memory_order_relaxed);
}

// =============================================================================
//  Dummy-model override (Blitz test UI, "Dummy 1" -> model dropdown)
//  A monster's combat model is MonsterSkin[Monster.FAId]: both the preload pass
//  (AdventureModulePreloadAssetsMrg$$PreloadMonster) and the actual spawn
//  (AdventureLevelController$$SpawnMonster) read the row's fAId_.  We rewrite
//  fAId_ in place for the one row the test UI targets — model only, since stats,
//  AI (fCId_) and skills are untouched.
//  NOTE: this only covers the C# engine path (preload/spawn). Lua UI (boss HP
//  bar, result/pause screens) reads _G.DataTable via ConfigTable, never GDC —
//  its mirror patch (__SSL_MONPATCH wrapping ConfigTable.GetData) lives in
//  kScoreBossSettlePatch in dummy.cpp.
// =============================================================================
static std::atomic<int32_t> g_DummyMonsterId{0};   // Nova.Client.Monster.Id to rewrite
static std::atomic<int32_t> g_DummySkinId{0};      // MonsterSkin.Id to substitute (0 = original)
// Pristine fAId_ per monster row.  The dropdown can retarget to another level
// (= another Monster row) at any time, and switching back must restore that
// row's own original model, not the previously selected row's.
static std::mutex g_DummyOrigMutex;
static std::unordered_map<int32_t, int32_t> g_DummyOrigFAId;

// Nova.Client.Monster (dump.cs:233375) — one row of the 'Monster' bin table.
// Only id_/fCId_/fAId_ are read; the other fields keep the offsets right.
struct Nova_Client_Monster_o {
    void* klass;             // 0x00
    void* monitor;           // 0x08
    void* unknownFields;     // 0x10
    int32_t id_;             // 0x18
    void* name_;             // 0x20
    int32_t epicLv_;         // 0x28
    int32_t subBossType_;    // 0x2C
    int32_t monsterPosition_;// 0x30
    int32_t bloodType_;      // 0x34
    void* force_;            // 0x38
    int32_t fCId_;           // 0x40  MonsterAI id (behaviour)
    int32_t fAId_;           // 0x44  MonsterSkin id (model)
};
static_assert(offsetof(Nova_Client_Monster_o, fAId_) == 0x44, "Nova.Client.Monster.fAId_ offset");

// Set from the test-button chunk each pump: the row to touch and the skin to put
// in it (skin 0 = put the original value back). monsterId 0 = leave everything
// alone (tables not loaded yet / no selection).
void SetDummySkinOverride(int32_t monsterId, int32_t skinId) {
    const int32_t prevSkin = g_DummySkinId.load(std::memory_order_relaxed);
    if (g_DummyMonsterId.load(std::memory_order_relaxed) == monsterId && prevSkin == skinId)
        return;
    g_DummyMonsterId.store(monsterId, std::memory_order_relaxed);
    g_DummySkinId.store(skinId, std::memory_order_relaxed);
    log("[dummy] model selection: monster=%d skin=%d", monsterId, skinId);
}

// Rewrite (or restore) fAId_ on the targeted table row. The engine re-reads the
// row from the GDC dictionary on every preload/spawn, so the value only has to be
// current by the time the level spawns its monsters — which the pump guarantees
// (the dropdown is picked while the formation panel is open, seconds before the
// entry, and the pump runs during the level load too).
static void ApplyDummySkin(void* monster) {
    if (monster == nullptr) return;
    const int32_t target = g_DummyMonsterId.load(std::memory_order_relaxed);
    if (target == 0) return;
    auto* row = reinterpret_cast<Nova_Client_Monster_o*>(monster);
    if (row->id_ != target) return;          // only the selected row is ever touched
    int32_t orig;
    {
        std::lock_guard<std::mutex> lk(g_DummyOrigMutex);
        auto it = g_DummyOrigFAId.find(target);
        if (it == g_DummyOrigFAId.end())
            it = g_DummyOrigFAId.emplace(target, row->fAId_).first;
        orig = it->second;
    }
    const int32_t skin = g_DummySkinId.load(std::memory_order_relaxed);
    const int32_t want = (skin > 0) ? skin : orig;
    if (row->fAId_ == want) return;
    log("[dummy] monster %d model: skin %d -> %d", target, row->fAId_, want);
    row->fAId_ = want;
}

static void* __fastcall GdcHook_GetHitDamage(GameDataController_o* __this, int32_t key, void* method) {
    CaptureGdc(__this);
    return nullptr;
}
static void* __fastcall GdcHook_GetMonster(GameDataController_o* __this, int32_t key, void* method) {
    CaptureGdc(__this);
    void* row = g_OrigGdcGetMonster(__this, key, method);
    ApplyDummySkin(row);
    return row;
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

    // ── Step 0: drain the HITTED_ADDITIONAL_ATTR_FIX applied set for this hit ──
    // HittedAdditionalAttriFix_Execute runs right before CalculateNormalDamage and
    // records which configIds actually landed in the static fromAdditionalAttrInfo.
    // Take (copy-and-clear) here so the logged effect list is scoped to this hit.
    std::unordered_set<int32_t> appliedHitted = TakeAppliedHittedAttrFixSnapshot();
    const std::unordered_set<int32_t>* pAppliedHitted =
        appliedHitted.empty() ? nullptr : &appliedHitted;

    // ── Step 1: walk klass chain for static fields ───────────────────────────
    if (!fromActor)         { return callOriginal(); }
    if (!fromActor->klass)  { return callOriginal(); }

    Il2CppClass* parentKlass = fromActor->klass->_1.parent;
    if (!parentKlass) { return callOriginal(); }

    AdventureActor_c* actorClass = reinterpret_cast<AdventureActor_c*>(parentKlass);
    if (!actorClass->static_fields) { return callOriginal(); }

    AdventureActor_StaticFields* staticFields = actorClass->static_fields;

    int32_t damageTypeTemp = staticFields->damageTypeTemp;
    g_CurrentDamageTypeTemp = damageTypeTemp;

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
    FnGetOnceAttr                     GetOnceAttr      = nullptr;
    FnGetValueConfigId                GetValueConfigId = nullptr;
    FnGetOnceAdditionalAttributeValue GetAttrValue     = nullptr;
    if (gdc) {
        GetOnceAttr      = &HyGetOnceAdditionalAttribute;
        GetValueConfigId = &HyGetValueConfigIdByLevelType;
        GetAttrValue     = &HyGetOnceAdditionalAttributeValue;
    }

    // ── Step 5: resolve raw attr lists  ──────────────────────────────────────
    // Resolve through the runtime class: 2.0.0 reordered ActorAdditionalAttrInfo
    // (dictionary before the attributeList property), so the struct offset from
    // the 1.15 dump would read the wrong member.
    AttributeList_o* attackerInfo = nullptr;
    AttributeList_o* defenderInfo = nullptr;
    if (staticFields->fromAdditionalAttrInfo)
        attackerInfo = reinterpret_cast<AttributeList_o*>(
            ReadObjectFieldPtr(staticFields->fromAdditionalAttrInfo, "_attributeList_k__BackingField"));
    if (staticFields->toAdditionalAttrInfo)
        defenderInfo = reinterpret_cast<AttributeList_o*>(
            ReadObjectFieldPtr(staticFields->toAdditionalAttrInfo, "_attributeList_k__BackingField"));

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
        GetAttrValue, hitEffectSnapshot, pHitSnapshotTime,
        pAppliedHitted);

    return dmg;
}

// =============================================================================
//  AreaEffectEntity::CopyBattleData — snapshot effects when area snapshots stats
// =============================================================================
// Resolve the real stats source: if the actor is a summoned entity, use the
// summoner instead (ActorHelper.IsUseHitFromSummon).
static AdventureActor_o* ResolveHitSource(AdventureActor_o* source) {
    if (!source) return source;

    // Until the game has run any ActorHelper method the class is unknown and the
    // source is returned unchanged (the resolver logs the miss once).
    PlayerAdventureActor_o* summoner = nullptr;
    uint64_t a[2] = { (uint64_t)(uintptr_t)source, (uint64_t)(uintptr_t)&summoner };
    uint64_t r = hybrid::CallGameMethod("ActorHelper", "IsUseHitFromSummon", a, 2, "IsUseHitFromSummon");
    bool isSummoned = (r & 0xFF) != 0;
    return (isSummoned && summoner) ? reinterpret_cast<AdventureActor_o*>(summoner) : source;
}

// Collect the live effect instance IDs registered on `source`'s effectsDict.
// requireStackAlive=false: deliberately NOT stack-filtered — the snapshot only
// defines the lookup candidates; per-hit payloads (Hitted*) write into the
// shared static overlay and their stack may already be popped when an
// area/weapon calc consumes that overlay — the row gate in BuildEffectListJson
// combines the stack check with the executed-since-last-calc record instead.
// requireStackAlive=true: only effects with a currently pushed payload.
static EffectSnapshot CollectEffectIds(AdventureActor_o* source, bool requireStackAlive) {
    EffectSnapshot snap;
    if (!source || !source->fields.effectManage) return snap;
    auto* effectsDict = source->fields.effectManage->fields.effectsDict;
    if (!effectsDict) return snap;
    auto* entriesArr = effectsDict->fields._entries;
    int slotCount = effectsDict->fields._count;
    if (!entriesArr || slotCount <= 0) return snap;
    for (int i = 0; i < slotCount; ++i) {
        const auto& e = entriesArr->m_Items[i].fields;
        if (e.hashCode < 0) continue;
        AdventureEffect_o* effect = reinterpret_cast<AdventureEffect_o*>(e.value);
        if (!effect || effect->fields.removed) continue;
        if (requireStackAlive) {
            auto* stack = effect->fields._effectStack;
            if (!stack || !stack->fields._array || stack->fields._size <= 0) continue;
        }
        snap.insert(effect->fields.id);
    }
    return snap;
}

static void __fastcall Hook_CopyBattleData(void* areaEntity, bool force, void* method)
{
    auto* area = reinterpret_cast<AreaEffectEntity_o*>(areaEntity);

    // Owner is the game's stats source.  `_fxPlayer` is a real AdventureFXPlayer
    // (MonoBehaviour, not an actor) in 2.0.0; it stays only as a fallback for the
    // older layout where it pointed at the owner actor.
    AdventureActor_o* fxPlayer = reinterpret_cast<AdventureActor_o*>(area->fields._fxPlayer_k__BackingField);
    AdventureActor_o* owner = area->fields._owner_k__BackingField;
    AdventureActor_o* source = owner ? owner : fxPlayer;

    source = ResolveHitSource(source);
    EffectSnapshot snap = CollectEffectIds(source, /*requireStackAlive=*/false);

    {
        std::lock_guard<std::mutex> lk(g_AreaSnapshotMutex);
        g_AreaSnapshots[reinterpret_cast<uintptr_t>(areaEntity)] = { std::move(snap), gameTime() };
    }
}

// =============================================================================
//  AdventureWeapon::Setup — snapshot effects when weapon copies owner stats
// =============================================================================
static void __fastcall Hook_WeaponSetup(AdventureWeapon_o* weapon, LogicEntity_o* owner,
                                         void* pos, void* posY, void* dir, void* target,
                                         void* targetPos, void* targetPosY, int32_t aimType, void* method)
{
    AdventureActor_o* source = ResolveHitSource(reinterpret_cast<AdventureActor_o*>(owner));
    EffectSnapshot snap = CollectEffectIds(source, /*requireStackAlive=*/false);

    {
        std::lock_guard<std::mutex> lk(g_WeaponSnapshotMutex);
        g_WeaponSnapshots[reinterpret_cast<uintptr_t>(weapon)] = { std::move(snap), gameTime() };
    }
}

// =============================================================================
//  Minion/Summon stat initialization hooks
// =============================================================================

static void __fastcall Hook_FakeSetAttrInfo(AdventureActor_o* self, int32_t templeteId,
                                            int64_t attributeId, int32_t factionID, void* method)
{
    log("[MINION] FakeAdventureActor$$SetAttrInfo id=%d attrId=%lld faction=%d time=%s",
        templeteId, (long long)attributeId, factionID, gameTime().c_str());
}

// Captures a player's live attribute base/pct values + active effects.
// Defined below; both the live-inherit summon hook and the battle-start
// snapshot hook use it at their respective reference times.
static PlayerEffectSnapshot CapturePlayerEffectSnapshot(AdventureActor_o* player);

static void __fastcall Hook_SetPlayerSummonAttr(AdventureActor_o* self, AdventureActor_o* player,
                                                int32_t percent, void* method)
{
    // Live-inherit path (summonAttrType=1): the engine copies the player's LIVE
    // attributeList into the minion's .origin at summon time, so capture the
    // player's effects/values right now (not the battle-start snapshot).
    if (self && player) {
        MinionLink link;
        link.playerId = adventureActorId(player);
        link.summonAttrType = 1;
        link.summonSnapshot = CapturePlayerEffectSnapshot(player);
        link.summonSnapshot.time = gameTime();
        {
            std::lock_guard<std::mutex> lk(g_MinionLinkMutex);
            g_MinionToPlayer[adventureActorId(self)] = std::move(link);
        }
    }
}

static void __fastcall Hook_SetPlayerSummonSnap(AdventureActor_o* self, AdventureActor_o* player,
                                                int32_t percent, void* method)
{
    // Store minion→player mapping for inherited effect tracking.
    // Snapshot path (summonAttrType=2): the minion's stats come from the
    // player's battle-start snapshot, so no per-minion capture is stored here —
    // BuildEffectListJson resolves the player's snapshot via playerId.
    if (self && player) {
        MinionLink link;
        link.playerId = adventureActorId(player);
        link.summonAttrType = 2;
        {
            std::lock_guard<std::mutex> lk(g_MinionLinkMutex);
            g_MinionToPlayer[adventureActorId(self)] = std::move(link);
        }
    }
}

// =============================================================================
//  Player snapshot stat capture — shared by the battle-start save hook and the
//  live-inherit summon hook (SetPlayerSummonAttrInfo).
// =============================================================================

// Capture a player's live attribute base/pct values plus active effects into a
// PlayerEffectSnapshot. The caller decides the reference time: battle start for
// the snapshot path, summon time for the live-inherit path.
static PlayerEffectSnapshot CapturePlayerEffectSnapshot(AdventureActor_o* player) {
    PlayerEffectSnapshot snap;
    std::vector<double> baseValues(0x61, 0.0);
    std::vector<double> pctValues(0x61, 0.0);

    // Read origin + baseAmend (total base) AND percentAmend from player's attributeList
    if (auto* sl = player->fields.attributeList) {
        if (auto* entriesArr = sl->fields.entries) {
            for (int t = 1; t < 0x61; t++) {
                const auto& e = entriesArr->m_Items[t].fields;
                baseValues[t] = (double)(e.origin + e.baseAmend) / 16777216.0;
                pctValues[t] = (double)(e.percentAmend) / 16777216.0;
            }
        }
    }

    // Collect active effects from player's effectsDict
    if (auto* em = player->fields.effectManage) {
        if (auto* dict = em->fields.effectsDict) {
            auto* entriesArr = dict->fields._entries;
            int slotCount = dict->fields._count;
            if (entriesArr && slotCount > 0) {
                for (int i = 0; i < slotCount; ++i) {
                    const auto& e = entriesArr->m_Items[i].fields;
                    if (e.hashCode < 0) continue;
                    AdventureEffect_o* effect = reinterpret_cast<AdventureEffect_o*>(e.value);
                    if (!effect) continue;
                    if (effect->fields.removed) continue;

                    auto* stack = effect->fields._effectStack;
                    if (!stack || !stack->fields._array || stack->fields._size <= 0) continue;

                    auto* array = stack->fields._array;
                    int size = stack->fields._size;

                    for (int s = 0; s < size; ++s) {
                        AdventureEffectBase_o* base = array->m_Items[s];
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
                        pe.configId = configId;
                        pe.valueConfigId = valueConfigId;
                        pe.sourceType = parentEffect->fields.sourceType;
                        pe.damage = static_cast<int64_t>(parentEffect->fields.Damage);
                        pe.attributeType = attrType;
                        pe.parameterType = paramType;

                        if (attrType > 0 && attrType < 0x61) {
                            pe.baseStatOnSnapshot = baseValues[attrType];
                            pe.pctStatOnSnapshot = pctValues[attrType];
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

    return snap;
}

static void __fastcall Hook_SavePlayerSnapshot(AdventureActor_o* player, void* method)
{
    if (!player) { log("[SNAP] SavePlayerSnapshot: player is null"); return; }

    PlayerEffectSnapshot snap = CapturePlayerEffectSnapshot(player);
    snap.time = gameTime();

    {
        std::lock_guard<std::mutex> lk(g_PlayerSnapshotMutex);
        g_PlayerSnapshots[adventureActorId(player)] = std::move(snap);
    }
}

static void __fastcall Hook_CloneSetAttr(AdventureActor_o* self, AdventureActor_o* master, void* method)
{
    log("[MINION] MonsterCloneAdventureActor$$SetAttr master=%s self=%s time=%s",
        master ? adventureActorId(master).c_str() : "null",
        self ? adventureActorId(self).c_str() : "null",
        gameTime().c_str());
}

// Player dataID → display name (for summon-owner logging).
static const char* SummonerName(int32_t dataId) {
    switch (dataId) { case 103: return "Amber"; case 106: return "Aeloria"; case 107: return "Tilia"; case 108: return "Kasimira"; case 109: return "Aobelle"; case 110: return "Firenze"; case 111: return "Iris"; case 112: return "Noya"; case 113: return "Shimiao"; case 114: return "Chaton"; case 115: return "Firefly"; case 116: return "Ridge"; case 117: return "Jinglin"; case 118: return "Coronis"; case 119: return "Nanoha"; case 120: return "Canace"; case 123: return "Ann"; case 125: return "Freesia"; case 126: return "Flora"; case 127: return "Teresa"; case 129: return "Yoranda"; case 130: return "Donna"; case 131: return "Bloc"; case 132: return "Minova"; case 133: return "Nazuka"; case 134: return "Fuyuka"; case 135: return "Mistique"; case 136: return "Angie"; case 137: return "Eleanor"; case 138: return "Nyx"; case 139: return "Allie"; case 140: return "Sparkla"; case 141: return "Chixia"; case 142: return "Cosette"; case 143: return "Wraith"; case 144: return "Chitose"; case 145: return "Otoha"; case 146: return "Benito"; case 147: return "Caramel"; case 149: return "Gerie"; case 150: return "Laru"; case 151: return "Yunshu"; case 152: return "Jiyue"; case 153: return "Danyun"; case 155: return "Shia"; case 156: return "Nazuna"; case 157: return "Karin"; case 158: return "Laru"; case 159: return "Coronis"; case 160: return "Willow"; case 163: return "Greyhorn"; case 164: return "Shuo"; default: return "?"; }
}

static void __fastcall Hook_ParseSummonCfg(MonsterSummonInfo_o* summonInfo, SummonCfg_o* cfgData, void* spawnInfo, void* method)
{
    int32_t attrType = -1;
    int32_t perc = 0;
    bool useSummonHit = false;
    if (cfgData) {
        attrType = cfgData->fields.summonAttrType;
        perc = cfgData->fields.attrPercent;
        useSummonHit = cfgData->fields.useSummonHit;
    }
    // Summoner (owner) is MonsterSummonInfo._SummonActor_k__BackingField
    int32_t ownerId = 0;
    const char* ownerName = "?";
    if (summonInfo) {
        AdventureActor_o* summoner = summonInfo->fields._SummonActor_k__BackingField;
        if (summoner) {
            ownerId = summoner->fields._dataID_k__BackingField;
            ownerName = SummonerName(ownerId);
        }
        // useSummonHit is copied onto the summoned monster's MonsterSummonInfo by
        // ParseSummonCfg; also record it on the minion link so damage events from
        // this minion can be labeled "Live". The minion is the LogicComponent
        // entity: MonsterSummonInfo._Entity_k__BackingField (inherited).
        AdventureActor_o* minion = reinterpret_cast<AdventureActor_o*>(summonInfo->fields._Entity_k__BackingField);
        if (minion) {
            std::lock_guard<std::mutex> lk(g_MinionLinkMutex);
            g_MinionToPlayer[adventureActorId(minion)].useSummonHit = useSummonHit;
        }
    }
    log("[MINION] summonAttrType=%d attrPercent=%d useSummonHit=%d owner=%s(%d) time=%s",
        attrType, perc, useSummonHit, ownerName, ownerId, gameTime().c_str());
}

static void __fastcall Hook_GetBothAllInfo(AdventureActor_o* actor, void* method)
{
    // Snapshot the effects of the actor the hit is computed from (static
    // fromActorTemp on the AdventureActor parent class) with their payload
    // currently pushed (stack > 0).
    EffectSnapshot snap;
    auto* parentKlass = actor ? actor->klass->_1.parent : nullptr;
    if (parentKlass) {
        auto* actorClass = reinterpret_cast<AdventureActor_c*>(parentKlass);
        auto* sf = actorClass->static_fields;
        if (sf)
            snap = CollectEffectIds(sf->fromActorTemp, /*requireStackAlive=*/true);
    }
    g_GetBothAllInfoSnapshot = snap;
    g_SnapshotTime = gameTime();
    g_HaveHitSnapshot = true;
}

// =============================================================================
//  Effect / Buff hooks
// =============================================================================
static void __fastcall Hook_EffectOnInit(void* self, int32_t effType, int32_t sourceType, int32_t id, Nova_Client_Effect_o* effectConfig,
                                         Nova_Client_EffectValue_o* effectValueConfig, AdventureActor_o* owner, AdventureActor_o* fromActor,
                                         bool shareCD, int32_t takeEffectLimit, bool shareTakeEffectLimit,
                                         TrueSync_FP_o initCD, BuffEntity_o* fromBuff, void* method)
{
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
        StoreInstanceSnapInfo(instanceId, info);
    }

    if (g_Cfg.effects) {
        BuildBuffJson("Effect", configId, owner, fromActor, 1);
    }
}

static void __fastcall Hook_BuffEffectOnInit(void* self, AdventureActor_o* owner, AdventureActor_o* fromActor, BuffEntity_o* buffEntity,
                                             Nova_Client_BuffEffect_o* buffEffectConfig, int32_t buffUid, void* method)
{
    int32_t configId = 0;
    if (buffEffectConfig)
        configId = buffEffectConfig->fields.id_;

    if (g_Cfg.buffs) {
        BuildBuffJson("Buff", configId, owner, fromActor, 1);
    }
}

static void __fastcall Hook_BuffEntityExcute(BuffEntity_o* self, int32_t addType,
                                             AdventureActor_o* fromActor, void* method)
{
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
}

// =============================================================================
//  HittedAdditionalAttriFix::Execute — record that this HITTED effect was applied
//  to the per-hit fromAdditionalAttrInfo snapshot for the in-flight hit.
// =============================================================================
static void __fastcall Hook_HittedAdditionalAttrFixExecute(AdventureEffectBase_o* effectBase, void* method)
{
    if (effectBase && effectBase->fields._effect) {
        auto* effectCfg = effectBase->fields._effect->fields._effectConfig_k__BackingField;
        if (effectCfg)
            MarkHittedAdditionalAttrFixApplied(effectCfg->fields.id_);
    }
}


// =============================================================================
//  Battle start / timer / spawn
// =============================================================================
static void __fastcall Hook_UpdateLogic(void* self, TrueSync_FP_o logicDeltaTime, void* method) {
    OnUpdateLogicTick();
    g_GameTimeFP.fetch_add(logicDeltaTime.fields._serializedValue, std::memory_order_relaxed);
    PollLuaClock();   // Boss Blitz countdown sync (10 Hz internally throttled)

    // Re-apply gizmo flags every tick — the engine clears them between frames,
    // so a one-shot write at DllMain is not enough.
    EnableAllDebugGizmos();
}

// The gizmo helper is `SceneSingleton<AdventureModuleDebugHelper>`: the helper is
// hotfix code and the singleton is an AOT generic over it, so there is no AOT
// `get_Instance` address and no interpreted MethodInfo either.  Read the instance
// from the declaring class's static field (`SceneSingleton<T>.g_instance`, set by
// the game's own Awake); the class is learned once its own methods run.
void* GetDebugHelperInstance() {
    // Nothing to do if every gizmo is off.
    bool anyGizmo = false;
    for (const auto& g : g_GizmoFlags)
        if (g_Cfg.*(g.enabled)) { anyGizmo = true; break; }
    if (!anyGizmo) return nullptr;

    // Rate-limited diagnostics — log the first ~20 attempts and every 300th
    // after that; the loop retries every logic tick until the level scene is up.
    static int64_t s_attempts = 0;
    s_attempts++;
    #define GIZMO_LOG(...) do { if (s_attempts <= 20 || (s_attempts % 300) == 0) log(__VA_ARGS__); } while (0)

    void* klass = hybrid::ClassByName("AdventureModuleDebugHelper");
    if (!klass) {
        GIZMO_LOG("[gizmo] resolve #%lld: AdventureModuleDebugHelper not learned yet "
                  "(no interpreted method of the class has run)", (long long)s_attempts);
        return nullptr;
    }

    const char* declaredOn = "?";
    void* inst = hybrid::ReadStaticFieldPtr(klass, "g_instance", &declaredOn);
    if (!inst) {
        GIZMO_LOG("[gizmo] resolve #%lld: g_instance (declared on %s) is null "
                  "(helper not awake yet, retrying)", (long long)s_attempts, declaredOn);
        return nullptr;
    }
    #undef GIZMO_LOG
    return inst;
}

static void __fastcall Hook_BattleStart(void* self, void* evt, void* method) {
    OnBattleStart();
}

static void* __fastcall Hook_SpawnSkill(void* self, int32_t skillId, void* method) {
    if (skillId >= 10000000 && g_Cfg.skill_casts)
        BuildSkillCastJson(skillId);
    return nullptr;
}

// =============================================================================
//  HybridCLR (hotfix) attach layer
// =============================================================================
//  2.0.0 moved the combat/AI implementation into the HybridCLR-interpreted
//  `Hotfix.dll`, so this is the only hook path (the 1.15 RVA table was removed).
//  Hooks are registered by metadata name (see include/hybrid_hooks.h) and the
//  attach layer performs the engine call itself, so a body only observes.  Two
//  targets are exceptions because their bodies consume the call's result:
//  `CalculateNormalDamage` (damage value + out parameters) and
//  `HotfixDataController.GetMonster` (dummy-model row).  Their `HyOrig_*`
//  adapters return what the engine call produced, or repeat the call through the
//  interpreter when the body runs on the interpreted→interpreted path.
//  The `HyGet*` helpers are the only implementation of the hotfix
//  GameDataController/CommonHelper/ActorHelper accessors.
// =============================================================================

// GDC table row (dummy-model feature): the engine call already ran, so reuse its
// result on native entries and otherwise repeat the (side-effect free) lookup.
static void* __fastcall HyOrig_GdcGetMonster(GameDataController_o* self, int32_t key, void* method) {
    if (hybrid::CurrentRetValid()) return (void*)hybrid::CurrentRetValue();
    uint64_t a[2] = { (uint64_t)(uintptr_t)self, (uint64_t)(int64_t)key };
    (void)method;
    return (void*)hybrid::DupCall(a, 2);
}

// Damage value: same treatment.  CommonHelper.CalculateNormalDamage only writes
// the static from/to attribute caches (deterministic for unchanged inputs), so
// the duplicate call is safe (see docs/damage_flow_analysis.md).
static int64_t __fastcall HyOrig_CalcNormalDamage(
    AdventureActor_o* fromActor, AdventureActor_o* toActor, Nova_Client_HitDamage_o* hitDamageConfig,
    int32_t skillLevel, bool isCrit, bool isDot, int32_t* hudColorIndex, int64_t* skillPercentAmend,
    int64_t* talentGroupPercentAmend, int64_t* skillAbsAmend, int64_t* talentGroupAbsAmend, int64_t* perkIntensityRatio, int64_t* slotDmgRatio,
    int64_t* fromEE, int64_t* erAmend, int64_t* defAmend, int64_t* rcdSlotDmgRatio, int64_t* toEERCD, int64_t* skillIntensityRatio,
    int64_t* toughnessBrokenDmgRatio, int64_t* critRatio, int64_t* envAmendRatio, void* method)
{
    (void)method;
    if (hybrid::CurrentRetValid()) return hybrid::CurrentRetValue();
    uint64_t a[22] = {
        (uint64_t)(uintptr_t)fromActor, (uint64_t)(uintptr_t)toActor, (uint64_t)(uintptr_t)hitDamageConfig,
        (uint64_t)(int64_t)skillLevel, isCrit ? 1ull : 0ull, isDot ? 1ull : 0ull,
        (uint64_t)(uintptr_t)hudColorIndex,
        (uint64_t)(uintptr_t)skillPercentAmend, (uint64_t)(uintptr_t)talentGroupPercentAmend,
        (uint64_t)(uintptr_t)skillAbsAmend, (uint64_t)(uintptr_t)talentGroupAbsAmend,
        (uint64_t)(uintptr_t)perkIntensityRatio, (uint64_t)(uintptr_t)slotDmgRatio,
        (uint64_t)(uintptr_t)fromEE, (uint64_t)(uintptr_t)erAmend, (uint64_t)(uintptr_t)defAmend,
        (uint64_t)(uintptr_t)rcdSlotDmgRatio, (uint64_t)(uintptr_t)toEERCD,
        (uint64_t)(uintptr_t)skillIntensityRatio, (uint64_t)(uintptr_t)toughnessBrokenDmgRatio,
        (uint64_t)(uintptr_t)critRatio, (uint64_t)(uintptr_t)envAmendRatio,
    };
    return hybrid::DupCall(a, 22);
}

static void InstallHybridOriginals() {
    g_OrigCalcNormalDamage = &HyOrig_CalcNormalDamage;
    g_OrigGdcGetMonster    = &HyOrig_GdcGetMonster;
}

// ── outgoing hotfix calls: see the HyGet* adapters above (next to the
//    CalculateNormalDamage hook), which need the interpreted-method invoker.

// ── argument unpackers + target table ──────────────────────────────────────
// Each unpacker forwards the metadata arguments to the existing hook body; the
// engine call itself is performed by the attach layer (see TargetDesc::mode).
static void HY_EnterScoreBossFloor(void* mi, const hybrid::StackObject* s, const int* o, void*) {
    Hook_EnterScoreBossFloor(hybrid::I32(s, o[0]), hybrid::Ptr(s, o[1]), mi);
}

static void HY_ModuleClearData(void* mi, const hybrid::StackObject* s, const int* o, void*) {
    Hook_ModuleClearData(hybrid::Ptr(s, o[0]), mi);
}

static void HY_CalcNormalDamage(void* mi, const hybrid::StackObject* s, const int* o, void*) {
    Hook_CalcNormalDamage(
        (AdventureActor_o*)hybrid::Ptr(s, o[0]), (AdventureActor_o*)hybrid::Ptr(s, o[1]),
        (Nova_Client_HitDamage_o*)hybrid::Ptr(s, o[2]), hybrid::I32(s, o[3]),
        hybrid::Bool(s, o[4]), hybrid::Bool(s, o[5]),
        (int32_t*)hybrid::Ptr(s, o[6]),
        (int64_t*)hybrid::Ptr(s, o[7]),  (int64_t*)hybrid::Ptr(s, o[8]),
        (int64_t*)hybrid::Ptr(s, o[9]),  (int64_t*)hybrid::Ptr(s, o[10]),
        (int64_t*)hybrid::Ptr(s, o[11]), (int64_t*)hybrid::Ptr(s, o[12]),
        (int64_t*)hybrid::Ptr(s, o[13]), (int64_t*)hybrid::Ptr(s, o[14]),
        (int64_t*)hybrid::Ptr(s, o[15]), (int64_t*)hybrid::Ptr(s, o[16]),
        (int64_t*)hybrid::Ptr(s, o[17]), (int64_t*)hybrid::Ptr(s, o[18]),
        (int64_t*)hybrid::Ptr(s, o[19]), (int64_t*)hybrid::Ptr(s, o[20]),
        (int64_t*)hybrid::Ptr(s, o[21]), mi);
}

static void HY_GetHitDamage(void* mi, const hybrid::StackObject* s, const int* o, void*) {
    (void)GdcHook_GetHitDamage((GameDataController_o*)hybrid::Ptr(s, o[0]), hybrid::I32(s, o[1]), mi);
}

static void HY_GetMonster(void* mi, const hybrid::StackObject* s, const int* o, void*) {
    (void)GdcHook_GetMonster((GameDataController_o*)hybrid::Ptr(s, o[0]), hybrid::I32(s, o[1]), mi);
}

static void HY_CopyBattleData(void* mi, const hybrid::StackObject* s, const int* o, void*) {
    Hook_CopyBattleData(hybrid::Ptr(s, o[0]), hybrid::Bool(s, o[1]), mi);
}

static void HY_WeaponSetup(void* mi, const hybrid::StackObject* s, const int* o, void*) {
    // Slot layout (descriptor-driven): this=0, owner=1, position=2 (TSVector2,
    // 2 slots), positionY=4 (FP), direction=5 (2 slots), target=7,
    // targetPosition=8 (2 slots), targetPositionY=10, aimType=11.
    // The body only reads weapon + owner; the value-type parameters are passed as
    // pointers to their inline slot bytes.
    Hook_WeaponSetup((AdventureWeapon_o*)hybrid::Ptr(s, o[0]), (LogicEntity_o*)hybrid::Ptr(s, o[1]),
                     (void*)&s[o[2]], (void*)&s[o[4]], (void*)&s[o[5]],
                     hybrid::Ptr(s, o[7]), (void*)&s[o[8]], (void*)&s[o[10]],
                     hybrid::I32(s, o[11]), mi);
}

static void HY_FakeSetAttrInfo(void* mi, const hybrid::StackObject* s, const int* o, void*) {
    Hook_FakeSetAttrInfo((AdventureActor_o*)hybrid::Ptr(s, o[0]), hybrid::I32(s, o[1]),
                         hybrid::I64(s, o[2]), hybrid::I32(s, o[3]), mi);
}

static void HY_SetPlayerSummonAttr(void* mi, const hybrid::StackObject* s, const int* o, void*) {
    Hook_SetPlayerSummonAttr((AdventureActor_o*)hybrid::Ptr(s, o[0]),
                             (AdventureActor_o*)hybrid::Ptr(s, o[1]), hybrid::I32(s, o[2]), mi);
}

static void HY_SetPlayerSummonSnap(void* mi, const hybrid::StackObject* s, const int* o, void*) {
    Hook_SetPlayerSummonSnap((AdventureActor_o*)hybrid::Ptr(s, o[0]),
                             (AdventureActor_o*)hybrid::Ptr(s, o[1]), hybrid::I32(s, o[2]), mi);
}

static void HY_CloneSetAttr(void* mi, const hybrid::StackObject* s, const int* o, void*) {
    Hook_CloneSetAttr((AdventureActor_o*)hybrid::Ptr(s, o[0]),
                      (AdventureActor_o*)hybrid::Ptr(s, o[1]), mi);
}

static void HY_ParseSummonCfg(void* mi, const hybrid::StackObject* s, const int* o, void*) {
    Hook_ParseSummonCfg((MonsterSummonInfo_o*)hybrid::Ptr(s, o[0]),
                        (SummonCfg_o*)hybrid::Ptr(s, o[1]), hybrid::Ptr(s, o[2]), mi);
}

static void HY_SavePlayerSnapshot(void* mi, const hybrid::StackObject* s, const int* o, void*) {
    Hook_SavePlayerSnapshot((AdventureActor_o*)hybrid::Ptr(s, o[0]), mi);
}

static void HY_GetBothAllInfo(void* mi, const hybrid::StackObject* s, const int* o, void*) {
    Hook_GetBothAllInfo((AdventureActor_o*)hybrid::Ptr(s, o[0]), mi);
}

static void HY_EffectOnInit(void* mi, const hybrid::StackObject* s, const int* o, void*) {
    TrueSync_FP_o initCD;
    __builtin_memcpy(&initCD, &s[o[11]], sizeof(initCD));
    Hook_EffectOnInit(hybrid::Ptr(s, o[0]), hybrid::I32(s, o[1]), hybrid::I32(s, o[2]),
                      hybrid::I32(s, o[3]), (Nova_Client_Effect_o*)hybrid::Ptr(s, o[4]),
                      (Nova_Client_EffectValue_o*)hybrid::Ptr(s, o[5]),
                      (AdventureActor_o*)hybrid::Ptr(s, o[6]), (AdventureActor_o*)hybrid::Ptr(s, o[7]),
                      hybrid::Bool(s, o[8]), hybrid::I32(s, o[9]), hybrid::Bool(s, o[10]),
                      initCD, (BuffEntity_o*)hybrid::Ptr(s, o[12]), mi);
}

static void HY_BuffEffectOnInit(void* mi, const hybrid::StackObject* s, const int* o, void*) {
    Hook_BuffEffectOnInit(hybrid::Ptr(s, o[0]), (AdventureActor_o*)hybrid::Ptr(s, o[1]),
                          (AdventureActor_o*)hybrid::Ptr(s, o[2]), (BuffEntity_o*)hybrid::Ptr(s, o[3]),
                          (Nova_Client_BuffEffect_o*)hybrid::Ptr(s, o[4]), hybrid::I32(s, o[5]), mi);
}

static void HY_BuffEntityExcute(void* mi, const hybrid::StackObject* s, const int* o, void*) {
    Hook_BuffEntityExcute((BuffEntity_o*)hybrid::Ptr(s, o[0]), hybrid::I32(s, o[1]),
                          (AdventureActor_o*)hybrid::Ptr(s, o[2]), mi);
}

static void HY_EffectOnClear(void* mi, const hybrid::StackObject* s, const int* o, void*) {
    Hook_EffectOnClear((AdventureEffectBase_o*)hybrid::Ptr(s, o[0]),
                       reinterpret_cast<MethodInfo*>(mi));
}

static void HY_HittedFixExecute(void* mi, const hybrid::StackObject* s, const int* o, void*) {
    Hook_HittedAdditionalAttrFixExecute((AdventureEffectBase_o*)hybrid::Ptr(s, o[0]), mi);
}

static void HY_UpdateLogic(void* mi, const hybrid::StackObject* s, const int* o, void*) {
    TrueSync_FP_o dt;
    __builtin_memcpy(&dt, &s[o[1]], sizeof(dt));
    Hook_UpdateLogic(hybrid::Ptr(s, o[0]), dt, mi);
}

static void HY_BattleStart(void* mi, const hybrid::StackObject* s, const int* o, void*) {
    Hook_BattleStart(hybrid::Ptr(s, o[0]), hybrid::Ptr(s, o[1]), mi);
}

static void HY_SpawnSkill(void* mi, const hybrid::StackObject* s, const int* o, void*) {
    (void)Hook_SpawnSkill(hybrid::Ptr(s, o[0]), hybrid::I32(s, o[1]), mi);
}

static const hybrid::TargetDesc g_HybridTargets[] = {
    // klass,                        method,                          args, mode,               dup, body
    { "AdventureEffect",             "OnInit",                          13,  hybrid::Mode::After, false, HY_EffectOnInit },
    { "AdventureEffectBase",         "OnClear",                          1,  hybrid::Mode::Entry, false, HY_EffectOnClear },
    { "HittedAdditionalAttriFix",    "Execute",                          1,  hybrid::Mode::Entry, false, HY_HittedFixExecute },
    { "AdventureLevelController",    "UpdateLogic",                      2,  hybrid::Mode::Entry, false, HY_UpdateLogic },
    { "ActorEffectManage",           "OnBattleStart",                    2,  hybrid::Mode::Entry, false, HY_BattleStart },
    { "AdventureLevelController",    "SpawnSkill",                       2,  hybrid::Mode::Entry, false, HY_SpawnSkill },
    { "BuffEffectBase",              "OnInit",                           6,  hybrid::Mode::After, false, HY_BuffEffectOnInit },
    { "BuffEntity",                  "BuffExcute",                       3,  hybrid::Mode::After, false, HY_BuffEntityExcute },
    { "CommonHelper",                "CalculateNormalDamage",           22,  hybrid::Mode::After, true,  HY_CalcNormalDamage },
    { "AdventureModuleController",   "ClearData",                        1,  hybrid::Mode::Entry, false, HY_ModuleClearData },
    { "AdventureModuleHelper",       "EnterScoreBossFloor",              2,  hybrid::Mode::Entry, false, HY_EnterScoreBossFloor },
    { "AdventureActor",              "GetBothAllInfo",                   1,  hybrid::Mode::After, false, HY_GetBothAllInfo },
    { "AreaEffectEntity",            "CopyBattleData",                   2,  hybrid::Mode::After, false, HY_CopyBattleData },
    { "AdventureWeapon",             "Setup",                            9,  hybrid::Mode::After, false, HY_WeaponSetup },
    { "FakeAdventureActor",          "SetAttrInfo",                      4,  hybrid::Mode::After, false, HY_FakeSetAttrInfo },
    { "MonsterAdventureActor",       "SetPlayerSummonAttrInfo",          3,  hybrid::Mode::After, false, HY_SetPlayerSummonAttr },
    { "MonsterAdventureActor",       "SetPlayerSummonAttrInfoBySnapshot",3,  hybrid::Mode::After, false, HY_SetPlayerSummonSnap },
    { "MonsterCloneAdventureActor",  "SetAttr",                          2,  hybrid::Mode::After, false, HY_CloneSetAttr },
    { "MonsterSummonInfo",           "ParseSummonCfg",                   3,  hybrid::Mode::After, false, HY_ParseSummonCfg },
    { "PlayerAdventureActor",        "SavePlayerAttributeSnapshot",      1,  hybrid::Mode::After, false, HY_SavePlayerSnapshot },
    { "HotfixDataController",        "GetHitDamage",                     2,  hybrid::Mode::Entry, false, HY_GetHitDamage },
    { "HotfixDataController",        "GetMonster",                       2,  hybrid::Mode::After, true,  HY_GetMonster },
};

// Install the hotfix attach layer.  Returns true when it is live; without it
// there are no combat hooks at all (the legacy AOT path no longer exists).
static bool InstallHybridLayer() {
    if (!hybrid::Detect(g_base)) {
        log("[init] HybridCLR interpreter not found — this is not a 2.0.0+ build; "
            "no combat hooks installed");
        return false;
    }
    InstallHybridOriginals();
    const int count = (int)(sizeof(g_HybridTargets) / sizeof(g_HybridTargets[0]));
    hybrid::InstallAll(g_HybridTargets, count);
    if (hybrid::Active()) {
        log("[init] hotfix attach layer active — %d combat methods hooked by name", count);
        return true;
    }
    log("[init] hotfix attach layer detected but hotfix_hooks is disabled in the config — "
        "no combat hooks");
    return false;
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

    // Combat/AI lives in the HybridCLR-interpreted Hotfix.dll; the attach layer
    // is the only hook path (see the hybrid block above).
    InstallHybridLayer();

    InstallHttpHooks(g_base);
    if (!InstallHotkeys())
        log("[hotkey] game window not ready yet; retrying in background for Alt+1..5");
    StartHotkeyRetry();

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
        RemoveHotkeys();
        MH_DisableHook(MH_ALL_HOOKS);
        MH_Uninitialize();
        if (g_Log)     { log("[uninit] DLL detached."); fclose(g_Log); g_Log = nullptr; }
        if (g_JsonLog) { fclose(g_JsonLog); g_JsonLog = nullptr; }
        ShutdownStarTowerLogger();
        ShutdownHttpLogger();
    }
    return TRUE;
}
