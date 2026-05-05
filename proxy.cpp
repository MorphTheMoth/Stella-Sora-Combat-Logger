#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <cstdint>
#include <cstdio>
#include "MinHook.h"
#include "tables.h"
#include "logging.h"
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
//  RVAs (unchanged – these are relative to GameAssembly base)
// =============================================================================
static constexpr uintptr_t RVA_DAMAGE               = 0x121D860;
static constexpr uintptr_t RVA_EFFECT_ON_INIT       = 0x11281A0;
static constexpr uintptr_t RVA_EFFECT_ON_CLEAR      = 0x1123C90;
static constexpr uintptr_t RVA_UPDATE_LOGIC         = 0x1179570;
static constexpr uintptr_t RVA_BATTLE_FINISH        = 0x102FF60;
static constexpr uintptr_t RVA_SPAWN_SKILL          = 0x11780D0;
static constexpr uintptr_t RVA_BUFF_EFFECT_ON_INIT  = 0x16C4BD0;
static constexpr uintptr_t RVA_BUFF_ENTITY_INIT     = 0x16C9500;
static constexpr uintptr_t RVA_BUFF_ENTITY_EXCUTE   = 0x16C81C0;
static constexpr uintptr_t RVA_CALC_NORMAL_DAMAGE   = 0x110C100;

// =============================================================================
//  Damage hook (kept as void* because DamageTuple is a custom struct)
// =============================================================================
struct DamageTuple {
    bool    Item1;
    uint8_t _pad[7];
    int64_t Item2;
    bool    Item3;
};
static_assert(offsetof(DamageTuple, Item2) == 8,  "Item2 offset wrong");
static_assert(offsetof(DamageTuple, Item3) == 16, "Item3 offset wrong");

using FnDamage = DamageTuple*(__fastcall*)( DamageTuple*, AdventureActor_o*, LogicEntity_o*, int32_t, int32_t, int32_t, void*, HitBox_o*, bool, bool, bool, void*);
static FnDamage             g_OrigDamage = nullptr;
static std::atomic<int64_t> g_HitDamage{0};

static DamageTuple* __fastcall Hook_Damage( DamageTuple* sret, AdventureActor_o* self, LogicEntity_o* from, int32_t uniqueAttackId, int32_t onceAttackTargetCount, int32_t hitDamageId,
    void* hurtEffectPrefab, HitBox_o* hitbox, bool isHittedEffectScale, bool showHud, bool effectIgnoreTimeScale, void* method)
{
    DamageTuple* result = g_OrigDamage(sret, self, from, uniqueAttackId, onceAttackTargetCount, hitDamageId,
                                       hurtEffectPrefab, hitbox, isHittedEffectScale, showHud, effectIgnoreTimeScale, method);
    ++g_HitDamage;
    return result;
}

// =============================================================================
//  CalculateNormalDamage hook
// =============================================================================
using FnCalcNormalDamage = int64_t(__fastcall*)( AdventureActor_o*, AdventureActor_o*, Nova_Client_HitDamage_o*,
    int32_t, bool, bool, int32_t*, double*, double*, double*, double*, double*, double*, double*, double*, double*, double*, double*, double*, double*, double*, double*, void*);
static FnCalcNormalDamage g_OrigCalcNormalDamage = nullptr;

static int64_t __fastcall Hook_CalcNormalDamage( AdventureActor_o* fromActor, AdventureActor_o* toActor, Nova_Client_HitDamage_o* hitDamageConfig,
    int32_t skillLevel, bool isCrit, bool isDot, int32_t* hudColorIndex, double* skillPercentAmend, 
    double* talentGroupPercentAmend, double* skillAbsAmend, double* talentGroupAbsAmend, double* perkIntensityRatio, double* slotDmgRatio,
    double* fromEE, double* erAmend, double* defAmend, double* rcdSlotDmgRatio, double* toEERCD, double* skillIntensityRatio,
    double* toughnessBrokenDmgRatio, double* critRatio, double* envAmendRatio, void* method)
{
    int64_t dmg = g_OrigCalcNormalDamage(
        fromActor, toActor, hitDamageConfig, skillLevel, isCrit, isDot, hudColorIndex, skillPercentAmend, talentGroupPercentAmend,
        skillAbsAmend, talentGroupAbsAmend, perkIntensityRatio, slotDmgRatio, fromEE, erAmend, defAmend, rcdSlotDmgRatio, toEERCD,
        skillIntensityRatio, toughnessBrokenDmgRatio, critRatio, envAmendRatio, method);

    json hitJson = BuildHitJson(
        fromActor, toActor, hitDamageConfig, skillLevel, isCrit, isDot, hudColorIndex, skillPercentAmend, talentGroupPercentAmend, 
        skillAbsAmend, talentGroupAbsAmend, perkIntensityRatio, slotDmgRatio, fromEE, erAmend, defAmend, rcdSlotDmgRatio, toEERCD,
        skillIntensityRatio, toughnessBrokenDmgRatio, critRatio, envAmendRatio, dmg);
    
    LogJson(hitJson);
    return dmg;
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
    
    if (g_Cfg.effects) {
        json j = BuildBuffJson("Effect", configId, owner, fromActor, 1);
        LogJson(j);
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
        json j = BuildBuffJson("Buff", configId, owner, fromActor, 1);
        LogJson(j);
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
        json j = BuildBuffJson("Buff", configId, owner, fromActor, addType==3 ? -1 : 1, buffNum);
        LogJson(j);
    }
}

using FnEffectOnClear = void(__fastcall*)(AdventureEffectBase_o*, void*);
static FnEffectOnClear g_OrigEffectOnClear = nullptr;

static void __fastcall Hook_EffectOnClear(AdventureEffectBase_o* effectBase, MethodInfo* method)
{
    if (g_Cfg.effects)
    {
        if (effectBase && effectBase)
        {
            AdventureEffect_o* effect = effectBase->fields._effect;
            if (effect && effect)
            {
                Nova_Client_Effect_o* cfgCandidate = effect->fields._effectConfig_k__BackingField;
                AdventureActor_o* owner = effect->fields._owner;
                AdventureActor_o* fromActor = effect->fields._fromActor;

                int32_t configId = 0;
                if (cfgCandidate && cfgCandidate)
                    configId = cfgCandidate->fields.id_;

                json j = BuildBuffJson("Effect", configId, owner, fromActor, -1);
                LogJson(j);
            }
        }
    }
    g_OrigEffectOnClear(effectBase, method);
}

// =============================================================================
//  Battle finish / timer / spawn
// =============================================================================
using FnUpdateLogic = void(__fastcall*)( void*, TrueSync_FP_o, void*);
static FnUpdateLogic g_OrigUpdateLogic = nullptr;

static void __fastcall Hook_UpdateLogic(void* self, TrueSync_FP_o logicDeltaTime, void* method) {
    g_OrigUpdateLogic(self, logicDeltaTime, method);
    g_BattleTimeFP.fetch_add(logicDeltaTime.fields._serializedValue, std::memory_order_relaxed);
}

using FnBattleFinish = void(__fastcall*)( ActorEffectManage_o*, void*, void*);
static FnBattleFinish g_OrigBattleFinish = nullptr;

static void __fastcall Hook_BattleFinish(ActorEffectManage_o* self, void* evt, void* method) {
    g_OrigBattleFinish(self, evt, method);
    g_BattleTimeFP.store(0, std::memory_order_relaxed);
    //Log("[timer] Battle started — timer reset");
}

using FnSpawnSkill = void*(__fastcall*)( void*, int32_t, void*);
static FnSpawnSkill g_OrigSpawnSkill = nullptr;

static void* __fastcall Hook_SpawnSkill(void* self, int32_t skillId, void* method) {
    void* result = g_OrigSpawnSkill(self, skillId, method);
    
    if (skillId < 10000000) return result;
    if (!g_Cfg.skill_casts) return result;
    
    json j = BuildSkillCastJson(skillId);
    LogJson(j);
    
    return result;
}

// =============================================================================
//  Hook installer / init
// =============================================================================
static bool InstallHook(uintptr_t target, void* hook, void** original, const char* name) {
    MH_STATUS s = MH_CreateHook(reinterpret_cast<void*>(target), hook, original);
    if (s != MH_OK) { Log("[ERROR] MH_CreateHook failed for %s: %d", name, (int)s); return false; }
    s = MH_EnableHook(reinterpret_cast<void*>(target));
    if (s != MH_OK) { Log("[ERROR] MH_EnableHook failed for %s: %d", name, (int)s); return false; }
    Log("[init] Hooked %s at 0x%llX", name, (unsigned long long)target);
    return true;
}

static DWORD WINAPI InitThread(LPVOID) {
    InitializeLogger();
    if (!g_Log) return 1;

    std::string logDir = GetLocalAppDataPath() + "\\Stella Sora Combat Logger";
    LoadConfig(logDir);
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

    InstallHook(base + RVA_DAMAGE,                 reinterpret_cast<void*>(&Hook_Damage),             (void**)&g_OrigDamage,             "AdventureActor$$Damage");
    InstallHook(base + RVA_EFFECT_ON_INIT,         reinterpret_cast<void*>(&Hook_EffectOnInit),       (void**)&g_OrigEffectOnInit,       "AdventureEffect$$OnInit");
    InstallHook(base + RVA_EFFECT_ON_CLEAR,        reinterpret_cast<void*>(&Hook_EffectOnClear),      (void**)&g_OrigEffectOnClear,      "AdventureEffectBase$$OnClear");
    InstallHook(base + RVA_UPDATE_LOGIC,           reinterpret_cast<void*>(&Hook_UpdateLogic),        (void**)&g_OrigUpdateLogic,        "AdventureLevelController$$UpdateLogic");
    InstallHook(base + RVA_BATTLE_FINISH,          reinterpret_cast<void*>(&Hook_BattleFinish),       (void**)&g_OrigBattleFinish,       "ActorEffectManage$$OnBattleFinish");
    InstallHook(base + RVA_SPAWN_SKILL,            reinterpret_cast<void*>(&Hook_SpawnSkill),         (void**)&g_OrigSpawnSkill,         "AdventureLevelController$$SpawnSkill");
    InstallHook(base + RVA_BUFF_EFFECT_ON_INIT,    reinterpret_cast<void*>(&Hook_BuffEffectOnInit),   (void**)&g_OrigBuffEffectOnInit,   "BuffEffectBase$$OnInit");
    InstallHook(base + RVA_BUFF_ENTITY_INIT,       reinterpret_cast<void*>(&Hook_BuffEntityInit),     (void**)&g_OrigBuffEntityInit,     "BuffEntity$$InitBuff");
    InstallHook(base + RVA_BUFF_ENTITY_EXCUTE,     reinterpret_cast<void*>(&Hook_BuffEntityExcute),   (void**)&g_OrigBuffEntityExcute,   "BuffEntity$$BuffExcute");
    InstallHook(base + RVA_CALC_NORMAL_DAMAGE,     reinterpret_cast<void*>(&Hook_CalcNormalDamage),   (void**)&g_OrigCalcNormalDamage,   "CommonHelper$$CalculateNormalDamage");

    Log("[init] Ready.");
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
        if (g_Log)     { Log("[uninit] DLL detached."); fclose(g_Log); g_Log = nullptr; }
        if (g_JsonLog) { fclose(g_JsonLog); g_JsonLog = nullptr; }
    }
    return TRUE;
}
