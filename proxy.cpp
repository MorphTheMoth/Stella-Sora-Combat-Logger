#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <cstdint>
#include <cstdio>
#include <shlobj.h>
#include <knownfolders.h>
#include <combaseapi.h>
#include "MinHook.h"
#include "json.hpp"
#include "tables.h"
#include "logging.h"

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

using FnDamage = DamageTuple*(__fastcall*)(
    DamageTuple*, void*, void*,
    int32_t, int32_t, int32_t,
    void*, void*, bool, bool, bool, void*);
static FnDamage             g_OrigDamage = nullptr;
static std::atomic<int64_t> g_HitDamage{0};

static DamageTuple* __fastcall Hook_Damage(
    DamageTuple* sret,
    void* self, void* from,
    int32_t uniqueAttackId, int32_t onceAttackTargetCount, int32_t hitDamageId,
    void* hurtEffect, void* hitbox,
    bool isHittedEffectScale, bool showHud, bool effectIgnoreTimeScale,
    void* method)
{
    DamageTuple* result = g_OrigDamage(sret, self, from,
                                       uniqueAttackId, onceAttackTargetCount, hitDamageId,
                                       hurtEffect, hitbox,
                                       isHittedEffectScale, showHud, effectIgnoreTimeScale,
                                       method);
    ++g_HitDamage;

    if (g_Cfg.damage) {
        auto it = g_HitTable.find(hitDamageId);
        if (it != g_HitTable.end()) {
            const HitInfo& h = it->second;
            Log("[dmg hook] dmg=%-8lld  %s / %s [hit %d], id=%d",
                (long long)sret->Item2, h.charName.c_str(), h.skillTitle.c_str(), h.hitNum, hitDamageId);
        } else {
            Log("[dmg hook] dmg=%-8lld  hitId=%d (unknown)", (long long)sret->Item2, hitDamageId);
        }
    }
    return result;
}

// =============================================================================
//  CalculateNormalDamage hook
// =============================================================================
using FnCalcNormalDamage = int64_t(__fastcall*)(
    void*,    void*,    void*,
    int32_t,  bool,     bool,
    int32_t*, double*,  double*,
    double*,  double*,  double*,
    double*,  double*,  double*,
    double*,  double*,  double*,
    double*,  double*,  double*,
    double*,  void*);
static FnCalcNormalDamage g_OrigCalcNormalDamage = nullptr;

static int64_t __fastcall Hook_CalcNormalDamage(
    void*    fromActor,
    void*    toActor,
    void*    hitDamageConfig,
    int32_t  skillLevel,
    bool     isCrit,
    bool     isDot,
    int32_t* hudColorIndex,
    double*  skillPercentAmend,
    double*  talentGroupPercentAmend,
    double*  skillAbsAmend,
    double*  talentGroupAbsAmend,
    double*  perkIntensityRatio,
    double*  slotDmgRatio,
    double*  fromEE,
    double*  erAmend,
    double*  defAmend,
    double*  rcdSlotDmgRatio,
    double*  toEERCD,
    double*  skillIntensityRatio,
    double*  toughnessBrokenDmgRatio,
    double*  critRatio,
    double*  envAmendRatio,
    void*    method)
{
    Log("[calcN] -- skillLevel=%d  isCrit=%d  isDot=%d", skillLevel+1, (int)isCrit, (int)isDot);

    int64_t dmg = g_OrigCalcNormalDamage(
        fromActor, toActor, hitDamageConfig,
        skillLevel, isCrit, isDot,
        hudColorIndex, skillPercentAmend, talentGroupPercentAmend,
        skillAbsAmend, talentGroupAbsAmend, perkIntensityRatio,
        slotDmgRatio, fromEE, erAmend,
        defAmend, rcdSlotDmgRatio, toEERCD,
        skillIntensityRatio, toughnessBrokenDmgRatio, critRatio,
        envAmendRatio, method);

    if (g_Cfg.damage) {
        LogHitDamageConfig(hitDamageConfig);
        Log("[calcN] Hit Mv = %.4f", skillPercentAmend ? *skillPercentAmend : 0.0);
    }

    if (g_Cfg.on_hit_attacker_stats) {
        Log("[calcN] hudColor=%d  skillPct=%.4f  talentGrpPct=%.4f  skillAbs=%.4f  talentGrpAbs=%.4f",
            hudColorIndex          ? *hudColorIndex          : -1,
            skillPercentAmend      ? *skillPercentAmend      : 0.0,
            talentGroupPercentAmend? *talentGroupPercentAmend: 0.0,
            skillAbsAmend          ? *skillAbsAmend          : 0.0,
            talentGroupAbsAmend    ? *talentGroupAbsAmend    : 0.0);
        Log("[calcN] perkIntensity=%.4f  slotDmg=%.4f  fromEE=%.4f  erAmend=%.4f  defAmend=%.4f",
            perkIntensityRatio     ? *perkIntensityRatio     : 0.0,
            slotDmgRatio           ? *slotDmgRatio           : 0.0,
            fromEE                 ? *fromEE                 : 0.0,
            erAmend                ? *erAmend                : 0.0,
            defAmend               ? *defAmend               : 0.0);
        Log("[calcN] rcdSlotDmg=%.4f  toEERCD=%.4f  skillIntensity=%.4f  toughBrokenDmg=%.4f  crit=%.4f  envAmend=%.4f",
            rcdSlotDmgRatio        ? *rcdSlotDmgRatio        : 0.0,
            toEERCD                ? *toEERCD                : 0.0,
            skillIntensityRatio    ? *skillIntensityRatio    : 0.0,
            toughnessBrokenDmgRatio? *toughnessBrokenDmgRatio: 0.0,
            critRatio              ? *critRatio              : 0.0,
            envAmendRatio          ? *envAmendRatio          : 0.0);
    }

    if (fromActor) {
        // Effect manage (from attacker)
        uintptr_t actorBase = reinterpret_cast<uintptr_t>(fromActor);
        static constexpr uintptr_t ACTOR_FIELDS = 0x18;
        void* effectManage = *reinterpret_cast<void**>(actorBase + ACTOR_FIELDS + 0xD8);
        LogEffectManage(effectManage, g_Cfg.on_hit_effect_list, g_Cfg.on_hit_effect_list_information);

        // Buffs on attacker
        if (g_Cfg.on_hit_buff_list) LogActorBuffCom(fromActor);
    }

    if (g_Cfg.damage) {
        auto it = g_HitTable.find(0/*hitDamageId from inside LogHitDamageConfig - we already logged it*/);
        // We'll just log the final damage and actor info
        int32_t hitDamageId = 0;
        if (hitDamageConfig)
            hitDamageId = *reinterpret_cast<int32_t*>(reinterpret_cast<uintptr_t>(hitDamageConfig) + 0x18);
        if (it != g_HitTable.end()) {
            const HitInfo& h = it->second;
            Log("[calcN] dmg=%-8lld  %s / %s [hit %d], id=%d",
                (long long)dmg, h.charName.c_str(), h.skillTitle.c_str(), h.hitNum, hitDamageId);
        } else {
            Log("[calcN] dmg=%-8lld  hitId=%d (unknown)", (long long)dmg, hitDamageId);
        }
        Log("[calcN] {from->to : %s  ->  %s}", adventureActorLog(fromActor), adventureActorLog(toActor));
    }

    // Attacker/defender stats when requested
    if (fromActor && g_Cfg.on_hit_attacker_stats) {
        logAdventureActorAttrs(fromActor);
        Log("---");
        logAdventureActorSpecialAttrs(fromActor);
        Log("--  --");
    }
    if (toActor) {
        if (g_Cfg.on_hit_buff_list)      LogActorBuffCom(toActor);
        if (g_Cfg.on_hit_defender_stats) logAdventureActorAttrs(toActor);
    }
    Log("--end of calcN--");
    return dmg;
}

// =============================================================================
//  Effect / Buff hooks (simplified)
// =============================================================================
using FnEffectOnInit = void(__fastcall*)(void*, int32_t, int32_t, int32_t, void*, void*, void*, void*, bool, int32_t, bool, int64_t, void*, void*);
static FnEffectOnInit g_OrigEffectOnInit = nullptr;

static void __fastcall Hook_EffectOnInit(void* self, int32_t effType, int32_t sourceType, int32_t id,
                                         void* effectConfig, void* effectValueConfig, void* owner, void* fromActor,
                                         bool shareCD, int32_t takeEffectLimit, bool shareTakeEffectLimit,
                                         int64_t initCD, void* fromBuff, void* method)
{
    g_OrigEffectOnInit(self, effType, sourceType, id, effectConfig, effectValueConfig,
                       owner, fromActor, shareCD, takeEffectLimit, shareTakeEffectLimit,
                       initCD, fromBuff, method);
    int32_t configId = 0;
    if (effectConfig)
        configId = *reinterpret_cast<int32_t*>(reinterpret_cast<uintptr_t>(effectConfig) + 0x18);
    if (g_Cfg.effects)
        logBuff("Effect", configId, owner, +1);
}

using FnBuffEffectOnInit = void(__fastcall*)(void*, void*, void*, void*, void*, int32_t, void*);
static FnBuffEffectOnInit g_OrigBuffEffectOnInit = nullptr;

static void __fastcall Hook_BuffEffectOnInit(void* self, void* owner, void* fromActor, void* buffEntity,
                                             void* buffEffectConfig, int32_t buffUid, void* method)
{
    g_OrigBuffEffectOnInit(self, owner, fromActor, buffEntity, buffEffectConfig, buffUid, method);
    int32_t configId = 0;
    if (buffEffectConfig)
        configId = *reinterpret_cast<int32_t*>(reinterpret_cast<uintptr_t>(buffEffectConfig) + 0x18);
    if (g_Cfg.buffs) {
        Log("[debug] BuffEffectOnInit called");
        logBuff("Buff", configId, owner, +1);
    }
}

using FnBuffEntityInit = void(__fastcall*)(void*, void*, void*, void*, void*, void*);
static FnBuffEntityInit g_OrigBuffEntityInit = nullptr;

static void __fastcall Hook_BuffEntityInit(void* self, void* buffConfig, void* buffValueConfig,
                                           void* bfC, void* fromActor, void* method)
{
    g_OrigBuffEntityInit(self, buffConfig, buffValueConfig, bfC, fromActor, method);
    int32_t configId = 0;
    if (buffConfig)
        configId = *reinterpret_cast<int32_t*>(reinterpret_cast<uintptr_t>(buffConfig) + 0x18);
    // simplified: we don't log buff init because it's redundant with BuffExcute and BuffEffectOnInit
}

using FnBuffEntityExcute = void(__fastcall*)(void*, int32_t, void*, void*);
static FnBuffEntityExcute g_OrigBuffEntityExcute = nullptr;

static void __fastcall Hook_BuffEntityExcute(void* self, int32_t addType, void* fromActor, void* method)
{
    g_OrigBuffEntityExcute(self, addType, fromActor, method);
    int32_t configId = 0;
    void* buffConfig = *reinterpret_cast<void**>(reinterpret_cast<uintptr_t>(self) + 0x38);
    int32_t buffNum = *reinterpret_cast<int32_t*>(reinterpret_cast<uintptr_t>(self) + 0x50);
    if (buffConfig)
        configId = *reinterpret_cast<int32_t*>(reinterpret_cast<uintptr_t>(buffConfig) + 0x18);
    if (g_Cfg.buffs)
        logBuff(("Buff Execute " + std::to_string(buffNum)).c_str(), configId, fromActor, +1);
}

using FnEffectOnClear = void(__fastcall*)(void*, void*);
static FnEffectOnClear g_OrigEffectOnClear = nullptr;

static void __fastcall Hook_EffectOnClear(void* self, void* method)
{
    int32_t configId = 0;
    void* effect = *reinterpret_cast<void**>(reinterpret_cast<uintptr_t>(self) + 0x10);
    if (effect) {
        void* owner = *reinterpret_cast<void**>(reinterpret_cast<uintptr_t>(effect) + 0x88);
        void* effectConfig = *reinterpret_cast<void**>(reinterpret_cast<uintptr_t>(effect) + 0x20);
        if (effectConfig)
            configId = *reinterpret_cast<int32_t*>(reinterpret_cast<uintptr_t>(effectConfig) + 0x18);
        if (g_Cfg.effects)
            logBuff("Effect", configId, owner, -1);
    }
    g_OrigEffectOnClear(self, method);
}

// =============================================================================
//  Battle finish / timer / spawn
// =============================================================================
using FnUpdateLogic = void(__fastcall*)(void*, int64_t, void*);
static FnUpdateLogic g_OrigUpdateLogic = nullptr;

static void __fastcall Hook_UpdateLogic(void* self, int64_t logicDeltaTime, void* method) {
    g_OrigUpdateLogic(self, logicDeltaTime, method);
    g_BattleTimeFP.fetch_add(logicDeltaTime, std::memory_order_relaxed);
}

using FnBattleFinish = void(__fastcall*)(void*, void*, void*);
static FnBattleFinish g_OrigBattleFinish = nullptr;

static void __fastcall Hook_BattleFinish(void* self, void* evt, void* method) {
    g_OrigBattleFinish(self, evt, method);
    g_BattleTimeFP.store(0, std::memory_order_relaxed);
    Log("[timer] Battle started — timer reset");
}

using FnSpawnSkill = void*(__fastcall*)(void*, int32_t, void*);
static FnSpawnSkill g_OrigSpawnSkill = nullptr;

static void* __fastcall Hook_SpawnSkill(void* self, int32_t skillId, void* method) {
    void* result = g_OrigSpawnSkill(self, skillId, method);
    if (skillId < 10000000) return result;
    if (!g_Cfg.skill_casts) return result;
    Log("---");
    auto it = g_SkillTable.find(skillId);
    if (it != g_SkillTable.end()) {
        const SkillInfo& s = it->second;
        if (!s.ownerName.empty())
            Log("[skill cast] %s / %s (%s)  skillId=%d", s.ownerName.c_str(), s.skillName.c_str(), s.skillType.c_str(), skillId);
        else
            Log("[skill cast] skillId=%d  %s  fcPath=%s", skillId, s.skillName.c_str(), s.fcPath.c_str());
    } else {
        Log("[skill cast] skillId=%d (unknown)", skillId);
    }
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

std::string GetLocalAppDataPath() {
    PWSTR path_tmp;
    HRESULT hr = SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, NULL, &path_tmp);
    if (FAILED(hr)) return "";
    char ch[MAX_PATH];
    WideCharToMultiByte(CP_UTF8, 0, path_tmp, -1, ch, MAX_PATH, NULL, NULL);
    CoTaskMemFree(path_tmp);
    return std::string(ch);
}

static DWORD WINAPI InitThread(LPVOID) {
    std::string logDir = GetLocalAppDataPath() + "\\Stella Sora Combat Logger";
    std::string logPath = logDir + "\\ss_dpslog.txt";
    CreateDirectoryA(logDir.c_str(), nullptr);
    g_Log = fopen(logPath.c_str(), "a");
    if (!g_Log) return 1;

    SYSTEMTIME t{};
    GetLocalTime(&t);
    fprintf(g_Log, "\n=== SS DPS Logger started %02d:%02d:%02d ===\n", t.wHour, t.wMinute, t.wSecond);
    fflush(g_Log);

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
        if (g_Log) { Log("[uninit] DLL detached."); fclose(g_Log); g_Log = nullptr; }
    }
    return TRUE;
}
