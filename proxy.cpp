#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <cstdint>
#include <cstdio>
#include <string>
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
//  CRASH HANDLER
// =============================================================================
static LONG WINAPI CrashHandler(EXCEPTION_POINTERS* ep) {
    EXCEPTION_RECORD* er  = ep->ExceptionRecord;
    CONTEXT*          ctx = ep->ContextRecord;

    // Identify which module owns the faulting address
    char modName[MAX_PATH] = "<unknown>";
    uintptr_t modBase = 0;
    HMODULE hMod = nullptr;
    if (GetModuleHandleExA(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                           (LPCSTR)er->ExceptionAddress, &hMod) && hMod) {
        GetModuleFileNameA(hMod, modName, MAX_PATH);
        modBase = (uintptr_t)hMod;
    }

    log("[CRASH] Exception 0x%08lX at 0x%p  (module: %s  RVA: 0x%llX)",
        er->ExceptionCode, er->ExceptionAddress,
        modName, (unsigned long long)((uintptr_t)er->ExceptionAddress - modBase));

    if (er->ExceptionCode == EXCEPTION_ACCESS_VIOLATION && er->NumberParameters >= 2)
        log("[CRASH] %s on address 0x%p",
            er->ExceptionInformation[0] == 1 ? "WRITE fault" : "READ fault",
            (void*)er->ExceptionInformation[1]);

#ifdef _WIN64
    log("[CRASH] RIP=0x%016llX  RSP=0x%016llX  RAX=0x%016llX  RCX=0x%016llX",
        (unsigned long long)ctx->Rip, (unsigned long long)ctx->Rsp,
        (unsigned long long)ctx->Rax, (unsigned long long)ctx->Rcx);
#else
    log("[CRASH] EIP=0x%08lX  ESP=0x%08lX", ctx->Eip, ctx->Esp);
#endif

    if (g_Log) fflush(g_Log);
    return EXCEPTION_CONTINUE_SEARCH;  // let the process die normally
}

// =============================================================================
//  RVAs
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
static constexpr uintptr_t RVA_GET_ONCE_ATTR        = 0x12840E0;
static constexpr uintptr_t RVA_GET_VALUE_CONFIG_ID  = 0x1111080;

//  Cached module base
static uintptr_t g_base = 0;

// =============================================================================
//  Damage hook
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

static DamageTuple* __fastcall Hook_Damage( DamageTuple* sret, AdventureActor_o* self, LogicEntity_o* from, int32_t uniqueAttackId, int32_t onceAttackTargetCount, int32_t hitDamageId,
    void* hurtEffectPrefab, HitBox_o* hitbox, bool isHittedEffectScale, bool showHud, bool effectIgnoreTimeScale, void* method)
{
    DamageTuple* result = g_OrigDamage(sret, self, from, uniqueAttackId, onceAttackTargetCount, hitDamageId,
                                       hurtEffectPrefab, hitbox, isHittedEffectScale, showHud, effectIgnoreTimeScale, method);
    return result;
}

AttributeList_o* DeepCopyAttributeList(AttributeList_o* src) {
    if (!src) return nullptr;
    if (!src->fields.entries) return nullptr;
    uint32_t count = src->fields.entries->max_length;

    if (count == 0 || count > 1024) return nullptr;
    size_t arraySize = sizeof(AttributeEntry_array) + count * sizeof(AttributeEntry_o);
    AttributeList_o* copy = new AttributeList_o(*src);

    AttributeEntry_array* entriesCopy = (AttributeEntry_array*)new uint8_t[arraySize];
    memcpy(entriesCopy, src->fields.entries, arraySize);
    copy->fields.entries = entriesCopy;

    if (src->fields.assignmentValueDict) {
        auto* dictCopy = new std::remove_pointer_t<decltype(src->fields.assignmentValueDict)>(*src->fields.assignmentValueDict);
        copy->fields.assignmentValueDict = dictCopy;
    }
    return copy;
}

// =============================================================================
//  CalculateNormalDamage hook
// =============================================================================
using FnCalcNormalDamage = int64_t(__fastcall*)( AdventureActor_o*, AdventureActor_o*, Nova_Client_HitDamage_o*,
    int32_t, bool, bool, int32_t*, double*, double*, double*, double*, double*, double*, double*, double*, double*, double*, double*, double*, double*, double*, double*, void*);
static FnCalcNormalDamage g_OrigCalcNormalDamage = nullptr;

// Cached GDC instance — resolved once on first use
static GameDataController_o* g_gdc = nullptr;

static GameDataController_o* GetGDC() {
    if (g_gdc) return g_gdc;
    if (!g_base) return nullptr;

    // GameDataController_TypeInfo
    // It's a pointer to GameDataController_c, whose _1.parent is Singleton_GameDataController__c
    // which holds static_fields->g_instance
    GameDataController_c* gdcTypeInfo = *reinterpret_cast<GameDataController_c**>(g_base + 0x714E958);
    if (!gdcTypeInfo) { log("[GDC] gdcTypeInfo is null"); return nullptr; }

    Il2CppClass* parentClass = gdcTypeInfo->_1.parent;
    if (!parentClass) { log("[GDC] parent (Singleton<GDC>) is null"); return nullptr; }

    auto* sf = reinterpret_cast<Singleton_GameDataController__StaticFields*>(parentClass->static_fields);
    if (!sf) { log("[GDC] singleton static_fields is null"); return nullptr; }

    g_gdc = sf->g_instance;
    if (!g_gdc) log("[GDC] g_instance is null — GDC not yet initialized");
    return g_gdc;
}

static int64_t __fastcall Hook_CalcNormalDamage( AdventureActor_o* fromActor, AdventureActor_o* toActor, Nova_Client_HitDamage_o* hitDamageConfig,
    int32_t skillLevel, bool isCrit, bool isDot, int32_t* hudColorIndex, double* skillPercentAmend, 
    double* talentGroupPercentAmend, double* skillAbsAmend, double* talentGroupAbsAmend, double* perkIntensityRatio, double* slotDmgRatio,
    double* fromEE, double* erAmend, double* defAmend, double* rcdSlotDmgRatio, double* toEERCD, double* skillIntensityRatio,
    double* toughnessBrokenDmgRatio, double* critRatio, double* envAmendRatio, void* method)
{
    // ── Walk up to AdventureActor_c to get static fields ────────────────────
    // fromActor is a child of AdventureActor.
    Il2CppClass* parentKlass = fromActor->klass->_1.parent;
    AdventureActor_StaticFields* staticFields = reinterpret_cast<AdventureActor_c*>(parentKlass)->static_fields;
    log("uniqueAttackIdTemp: %d", staticFields->uniqueAttackIdTemp);

    // ── Snapshot attribute lists before the original call ───────────────────
    AttributeList_o* attackerInfo = 0;
    AttributeList_o* defenderInfo = 0;
    if (staticFields->fromAdditionalAttrInfo)
        attackerInfo = DeepCopyAttributeList(staticFields->fromAdditionalAttrInfo->fields._attributeList_k__BackingField);
    if (staticFields->toAdditionalAttrInfo)
        defenderInfo = DeepCopyAttributeList(staticFields->toAdditionalAttrInfo->fields._attributeList_k__BackingField);

    // ── Original call ────────────────────────────────────────────────────────
    int64_t dmg = g_OrigCalcNormalDamage(
        fromActor, toActor, hitDamageConfig, skillLevel, isCrit, isDot, hudColorIndex,
        skillPercentAmend, talentGroupPercentAmend, skillAbsAmend, talentGroupAbsAmend,
        perkIntensityRatio, slotDmgRatio, fromEE, erAmend, defAmend, rcdSlotDmgRatio,
        toEERCD, skillIntensityRatio, toughnessBrokenDmgRatio, critRatio, envAmendRatio, method);

    // ── Resolve GDC and function pointers for attr dict resolution ───────────
    GameDataController_o* gdc = GetGDC();
    FnGetOnceAttr      GetOnceAttr      = nullptr;
    FnGetValueConfigId GetValueConfigId = nullptr;
    if (gdc && g_base) {
        GetOnceAttr      = reinterpret_cast<FnGetOnceAttr>     (g_base + RVA_GET_ONCE_ATTR);
        GetValueConfigId = reinterpret_cast<FnGetValueConfigId>(g_base + RVA_GET_VALUE_CONFIG_ID);
    }

    BuildHitJson(
        fromActor, toActor, hitDamageConfig, skillLevel, isCrit, isDot, hudColorIndex,
        skillPercentAmend, talentGroupPercentAmend, skillAbsAmend, talentGroupAbsAmend,
        perkIntensityRatio, slotDmgRatio, fromEE, erAmend, defAmend, rcdSlotDmgRatio,
        toEERCD, skillIntensityRatio, toughnessBrokenDmgRatio, critRatio, envAmendRatio,
        dmg, attackerInfo, defenderInfo,
        staticFields->fromAdditionalAttrDict,
        staticFields->toAdditionalAttrDict,
        gdc, GetOnceAttr, GetValueConfigId);

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

                BuildBuffJson("Effect", configId, owner, fromActor, -1);
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
    EnableAllDebugGizmos();    //tried doing it on Hook_BattleFinish (which runs on battle start) but it didnt work
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

    SetUnhandledExceptionFilter(CrashHandler);

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

    InstallHook(g_base + RVA_DAMAGE,                 reinterpret_cast<void*>(&Hook_Damage),             (void**)&g_OrigDamage,             "AdventureActor$$Damage");
    InstallHook(g_base + RVA_EFFECT_ON_INIT,         reinterpret_cast<void*>(&Hook_EffectOnInit),       (void**)&g_OrigEffectOnInit,       "AdventureEffect$$OnInit");
    InstallHook(g_base + RVA_EFFECT_ON_CLEAR,        reinterpret_cast<void*>(&Hook_EffectOnClear),      (void**)&g_OrigEffectOnClear,      "AdventureEffectBase$$OnClear");
    InstallHook(g_base + RVA_UPDATE_LOGIC,           reinterpret_cast<void*>(&Hook_UpdateLogic),        (void**)&g_OrigUpdateLogic,        "AdventureLevelController$$UpdateLogic");
    InstallHook(g_base + RVA_BATTLE_FINISH,          reinterpret_cast<void*>(&Hook_BattleFinish),       (void**)&g_OrigBattleFinish,       "ActorEffectManage$$OnBattleFinish");
    InstallHook(g_base + RVA_SPAWN_SKILL,            reinterpret_cast<void*>(&Hook_SpawnSkill),         (void**)&g_OrigSpawnSkill,         "AdventureLevelController$$SpawnSkill");
    InstallHook(g_base + RVA_BUFF_EFFECT_ON_INIT,    reinterpret_cast<void*>(&Hook_BuffEffectOnInit),   (void**)&g_OrigBuffEffectOnInit,   "BuffEffectBase$$OnInit");
    InstallHook(g_base + RVA_BUFF_ENTITY_INIT,       reinterpret_cast<void*>(&Hook_BuffEntityInit),     (void**)&g_OrigBuffEntityInit,     "BuffEntity$$InitBuff");
    InstallHook(g_base + RVA_BUFF_ENTITY_EXCUTE,     reinterpret_cast<void*>(&Hook_BuffEntityExcute),   (void**)&g_OrigBuffEntityExcute,   "BuffEntity$$BuffExcute");
    InstallHook(g_base + RVA_CALC_NORMAL_DAMAGE,     reinterpret_cast<void*>(&Hook_CalcNormalDamage),   (void**)&g_OrigCalcNormalDamage,   "CommonHelper$$CalculateNormalDamage");

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
