// =============================================================================
//  dummy.cpp — ScoreBoss "dummy" test-stage entry feature
// =============================================================================
// Client-side entry into datamined ScoreBoss test levels, bypassing the
// server-gated score_boss_apply_req:
//   * Alt+1..5 hotkeys, via a WndProc subclass on the Unity window
//   * a clickable "Dummy" button cloned from the Blitz formation screen's own
//     Deploy button (RegionBossFormationCtrl.btnStartBattle)
//   * a test-run settle bypass so a server-less run ends cleanly instead of
//     hanging on a settle ack the server rejects
//
// All of it funnels through the game's own
// PlayerScoreBossData:EnterScoreBossInstance(levelId, buildId) via xLua
// DoString, which is only safe on the Unity main thread (see RunLuaDoString /
// RefreshOriginCatalog in logging.cpp). The entry points below are called from
// proxy.cpp (window subclass + WM_TIMER pump over the game window, plus the
// room-transition hook).
//
// Hotkey map (Alt+1..5), all server-free ScoreBoss entries:
//   1 -> ScoreBossLevel 998  (BossRush arena Levels/StoryActivity/StoryActivity_13/
//                             StoryActivity_13_Boss_A_01, prefab
//                             StoryActivity_13_Boss_BossRush_1; the no-mechanic
//                             variant of Lv 26)
//   2 -> ScoreBossLevel 999  (BossRush arena Levels/Roguelike/Roguelike_2/
//                             Roguelike_2_Boss_002, prefab
//                             Roguelike_Boss_ShaSha_BossRush_3; the no-mechanic
//                             variant of Lv 27)
//   3 -> ScoreBossLevel 1    (Roguelike_2_MiniBoss_005, prefab Roguelike_MiniBoss_DaWuGui_Test)
//   4 -> ScoreBossLevel 12   (Roguelike_2_MiniBoss_005, prefab MiniBoss_BingXiangGuai_Test_Lv1)
//   5 -> ScoreBossLevel 13   (Roguelike_2_MiniBoss_005, prefab MiniBoss_BingXiangGuai_Test_Lv2)
// All five scenes + config prefabs ship in the client; there is no longer any
// scene/prefab redirect for the stripped QunGuai floors (the 999x entries were
// removed from the hotkey map).
//
// NOTE: scores from a dummy run do not persist (there is no server-side run to
// settle); the settle bypass only makes the fight end cleanly.
// =============================================================================

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <cstdint>
#include <cstdio>
#include <string>
#include <atomic>

#include "logging.h"

// Entry points consumed by proxy.cpp.
bool InstallHotkeys();
void StartHotkeyRetry();
void RemoveHotkeys();
void EnsureScoreBossTestButton();

// =============================================================================
//  SCOREBOSS TEST-STAGE HOTKEY ENTRY (Alt+1..5)
// =============================================================================
// ── Boss Blitz TEST-RUN settle bypass (installed once) ───────────────────────
// The dummy entry calls PlayerScoreBossData:EnterScoreBossInstance directly and
// never sends score_boss_apply_req, so the server has no record of the run and
// answers the end-of-fight score_boss_settle_req with score_boss_settle_failed_ack
// (11106, see NetMsgId.lua:967). Nothing is registered for 11106 in
// HttpNetHandler's dispatch table, while SendScoreBossSettleReq had already
// called AdventureModuleHelper.PauseLogic() (PlayerScoreBossData.lua:515) whose
// only ResumeLogic() lives in the *success* callback (:460) — so a rejected
// settle leaves the lock-step combat frozen forever, with no result screen.
// For test runs we settle locally instead: compute the score, resume, fire the
// ScoreBossSettleSuccess event (which drives ScoreBossLevel:PlaySuccessPerform →
// result panel) and end the level.
// __SSL_TESTMODE is set by our own entry points; a normal, server-authorized
// entry (RegionBossFormationCtrl.lua:438 → SendEnterScoreBossApplyReq) clears it,
// so real Blitz runs keep using the genuine server settle (and still save scores).
// No top-level return: this chunk is concatenated in front of other chunks.
static const char* kScoreBossSettlePatch = R"ssl(
if __SSL_SETTLEPATCH == nil then
  local okp = pcall(function()
    local cls = require('GameCore.Data.DataClass.PlayerScoreBossData')
    if cls == nil then return end
    if type(cls.SendScoreBossSettleReq) == 'function' then
      local origSettle = cls.SendScoreBossSettleReq
      cls.SendScoreBossSettleReq = function(self, totalTime)
        if __SSL_TESTMODE == true then
          self.TotalTime = totalTime
          pcall(function() NovaAPI.StopRecord() end)
          local totalScore = self.HPLvScore + self.CurHPLvScore + self.BehaviorScore
          local totalStar = self:ScoreToStar()
          CS.AdventureModuleHelper.ResumeLogic()
          EventManager.Hit('ScoreBossSettleSuccess', self.entryLevelId, totalScore, totalStar)
          self:LevelEnd()
          return
        end
        return origSettle(self, totalTime)
      end
    end
    if type(cls.SendEnterScoreBossApplyReq) == 'function' then
      local origApply = cls.SendEnterScoreBossApplyReq
      cls.SendEnterScoreBossApplyReq = function(self, ...)
        __SSL_TESTMODE = false
        return origApply(self, ...)
      end
    end
  end)
  if okp then __SSL_SETTLEPATCH = true end
end
)ssl";

// Server-free entry into datamined test levels via the game's own funnel.
// Must run on the Unity main thread (xLua DoString re-entry is only safe
// there — same constraint as PollLuaClock/RefreshOriginCatalog).
static const char* kTestEntryChunkTemplate = R"ssl(
local LEVEL = %d
local ok, res = pcall(function()
  if PlayerData == nil or PlayerData.ScoreBoss == nil then
    error('ScoreBoss data not ready (open Boss Blitz once first)')
  end
  local SB = PlayerData.ScoreBoss
  if SB.curLevel ~= nil then
    error('already inside a level (quit to menu first)')
  end
  if not SB.isGetScInfo then
    error('Blitz season info not loaded (open Boss Blitz once first)')
  end
  local build = tonumber(SB.entryBuild) or 0
  if build == 0 then
    for _, b in pairs(SB.tabCachedBuildId or {}) do
      if tonumber(b) ~= 0 then build = tonumber(b) break end
    end
  end
  if build == 0 and SB.OpenLevelGroup then
    for _, lid in ipairs(SB.OpenLevelGroup) do
      local lv = SB.tabScoreBossLevel and SB.tabScoreBossLevel[lid]
      if lv and tonumber(lv.BuildId) ~= 0 then build = tonumber(lv.BuildId) break end
    end
  end
  if build == 0 then
    error('no formation build (set a team on any Blitz floor first)')
  end
  local lvCfg = ConfigTable.GetData('ScoreBossLevel', LEVEL)
  if lvCfg == nil then error('ScoreBossLevel ' .. LEVEL .. ' missing from tables') end
  local fl = ConfigTable.GetData('ScoreBossFloor', lvCfg.FloorId)
  local scene = fl and fl.SceneName or ''
  if type(scene) == 'string' and scene:find('^Levels/Test/') then
    error('scene ' .. scene .. ' is stripped from the client bundles (entry would hang on loading) - needs a custom AssetBundle via patch server')
  end
  -- Mirror SendEnterScoreBossApplyReq's msgCallback (PlayerScoreBossData.lua):
  -- the server apply response zeroes the run score state, which EnterScoreBossInstance
  -- alone never sets. Without this, GetTotalScore/DamageToScore/BehaviorToScore do
  -- arithmetic on nil (pause Refresh crash, stuck input, broken scoring).
  SB.CurHPLvScore = 0
  SB.HPLvScore = 0
  SB.CurHPDamage = 0
  SB.BehaviorScore = 0
  SB.BehaviorScoreCount = 0
  -- Mark this server-less test run: SendScoreBossSettleReq (installed above) will
  -- then finish the fight locally instead of waiting on a settle ack the server
  -- will reject. A real, server-authorized entry clears this flag again.
  __SSL_TESTMODE = true
  local info = 'build=' .. tostring(build)
    .. ' floor=' .. tostring(lvCfg.FloorId)
    .. ' monster=' .. tostring(lvCfg.MonsterId)
    .. ' scene=' .. tostring(fl and fl.SceneName or '?')
    .. ' prefab=' .. tostring(fl and fl.ConfigPrefabName or '?')
  SB:EnterScoreBossInstance(LEVEL, build)
  return info
end)
if ok then return 'OK ' .. tostring(res) else return 'ERR:' .. tostring(res) end
)ssl";

static void RequestScoreBossTestEntry(int levelId) {
    char chunk[4096];
    snprintf(chunk, sizeof(chunk), kTestEntryChunkTemplate, levelId);
    log("[hotkey] Alt entry requested: ScoreBossLevel %d", levelId);
    std::string full = std::string(kScoreBossSettlePatch) + chunk;
    std::string res = RunLuaDoString(full.c_str(), "SSLTestEntry");
    if (res.empty()) {
        log("[hotkey] entry %d: DoString failed (see [origin] log above)", levelId);
        return;
    }
    if (res.rfind("ERR:", 0) == 0)
        log("[hotkey] entry %d blocked: %s", levelId, res.c_str() + 4);
    else
        log("[hotkey] entry %d: %s", levelId, res.c_str());
}

// =============================================================================
//  SCOREBOSS TEST-STAGE GUI BUTTON (top-right of the Boss Blitz select panel)
// =============================================================================
// Clones the Deploy button (btnStartBattle, RegionBossFormationCtrl._mapNodeConfig:32)
// via the game's own instantiate() — no raw GameObject/AddComponent work.
// The clone is a sibling of btnStartBattle under "---Team---" (goHaveTeam), and
// is shown/hidden the same way the natives are: by mirroring btnStartBattle's
// own active state, which Refresh() (:105) toggles together with the
// goHaveTeam/goNoneTeam localScale swap. So we hook *both* OnEnable and Refresh:
// OnEnable creates the clone, Refresh is what actually reveals the team UI (and
// is what runs after the async build load / after returning from team select),
// so without the Refresh hook the clone lagged a WM_TIMER tick behind the
// native buttons when a team was picked from the blank state.
// Shown only for Blitz formations (nType == RegionBossFormationType.ScoreBoss
// == 8, PanelId 43); the GameObject.Find fallback covers a formation screen that
// was already open when the patch installed. Runs on the Unity main thread only
// (WM_TIMER pump installed with the WndProc subclass, plus Hook_ModuleClearData).
static const char* kTestButtonChunk = R"lua(
if __SSL_TB == nil or __SSL_TB.v ~= 6 then
  __SSL_TB = { v = 6, patched = false, go = nil, ctrl = nil, tplDeploy = nil, lastCtrl = 'never' }
end
__SSL_TB.enter = function()
  local ok, res = pcall(function()
    if PlayerData == nil or PlayerData.ScoreBoss == nil then
      error('ScoreBoss data not ready (open Boss Blitz once first)')
    end
    local SB = PlayerData.ScoreBoss
    if SB.curLevel ~= nil then error('already inside a level (quit to menu first)') end
    if not SB.isGetScInfo then error('Blitz season info not loaded (open Boss Blitz once first)') end
    local build = tonumber(SB.entryBuild) or 0
    if build == 0 then
      for _, b in pairs(SB.tabCachedBuildId or {}) do
        if tonumber(b) ~= 0 then build = tonumber(b) break end
      end
    end
    if build == 0 and SB.OpenLevelGroup then
      for _, lid in ipairs(SB.OpenLevelGroup) do
        local lv = SB.tabScoreBossLevel and SB.tabScoreBossLevel[lid]
        if lv and tonumber(lv.BuildId) ~= 0 then build = tonumber(lv.BuildId) break end
      end
    end
    if build == 0 then error('no formation build (set a team on any Blitz floor first)') end
    SB.CurHPLvScore = 0
    SB.HPLvScore = 0
    SB.CurHPDamage = 0
    SB.BehaviorScore = 0
    SB.BehaviorScoreCount = 0
    __SSL_TESTMODE = true
    SB:EnterScoreBossInstance(1, build)
    return 'entered Lv1'
  end)
  if ok then return 'OK ' .. tostring(res) else return 'ERR:' .. tostring(res) end
end
__SSL_TB.alive = function(go)
  if go == nil then return false end
  local ok, dead = pcall(function() return go:IsNull() end)
  if not ok or dead then return false end
  local ok2, par = pcall(function() return go.transform.parent end)
  return ok2 and par ~= nil
end
__SSL_TB.isBlitzFormation = function(ctrl)
  local ok, v = pcall(function() return ctrl.nType == AllEnum.RegionBossFormationType.ScoreBoss end)
  if ok then return v == true end
  return false
end
__SSL_TB.setLabel = function(go)
  local txt = nil
  pcall(function() txt = go:GetComponentInChildren(typeof(CS.TMPro.TMP_Text), true) end)
  if txt == nil then pcall(function() txt = go:GetComponentInChildren(typeof(CS.UnityEngine.UI.Text), true) end) end
  if txt ~= nil then
    local dok = pcall(function() txt.text = 'Dummy' end)
    if not dok then pcall(function() NovaAPI.SetTMPText(txt, 'Dummy') end) end
  end
end
-- Give every descendant a unique prefixed name. The panel is re-parsed from a
-- cached instance on reopen (BasePanel.lua:94-97 ParsePrefab), and
-- BaseCtrl:_ParseNode's func_MarkAllNode (BaseCtrl.lua:204-213) maps nodes by
-- DFS name with last-write-wins. A clone whose child is still called
-- "txtStartBattle" would out-map the real one, and the panel's localized bind
-- (BaseCtrl.lua:298-299, sLanguageId "RegionBoss_SelectTeam_GoWar") would then
-- write "Deploy" into the clone — exactly the bug. Renaming the subtree keeps
-- both the name map and _mapNode pointing at the genuine nodes.
__SSL_TB.renameTree = function(go)
  pcall(function()
    local all = go:GetComponentsInChildren(typeof(CS.UnityEngine.Transform), true)
    local n = (all ~= nil) and all.Length or 0
    for i = 0, n - 1 do
      local t = all[i]
      if t ~= nil and t ~= go.transform then
        local nm = t.gameObject.name
        if nm:sub(1, 4) ~= 'SSL_' then t.gameObject.name = 'SSL_' .. nm end
      end
    end
  end)
end
-- Clone of the Deploy button (btnStartBattle): SAME parent and SAME anchor
-- space as the template, only anchoredPosition shifted left by the button width
-- so it sits right beside Deploy. (Earlier attempts forced a different anchor
-- space or cloned the ATK pill — the pill carries its own attribute-rendering
-- component that overwrote the label with the CJK attribute summary.)
__SSL_TB.apply = function(go, tplGo)
  local tRt = (tplGo ~= nil) and tplGo:GetComponent('RectTransform') or nil
  local rt = go:GetComponent('RectTransform')
  if rt ~= nil and tRt ~= nil then
    rt.anchorMin = tRt.anchorMin
    rt.anchorMax = tRt.anchorMax
    rt.pivot = tRt.pivot
    rt.sizeDelta = tRt.sizeDelta
    rt.anchoredPosition = Vector2(tRt.anchoredPosition.x - (tRt.sizeDelta.x + 28), tRt.anchoredPosition.y)
  end
  __SSL_TB.renameTree(go)
  __SSL_TB.setLabel(go)
  go.transform:SetAsLastSibling()
end
__SSL_TB.wire = function(tplGo, ctrl)
  local ok, res = pcall(function()
    if tplGo == nil then error('no template') end
    -- Stay in the template's own parent/anchor space: guaranteed sane placement.
    local rootTr = tplGo.transform.parent
    if rootTr == nil then error('no template parent') end
    -- Prefer the tracked reference (survives being hidden — GameObject.Find
    -- skips inactive objects, which would otherwise spawn duplicates).
    local go, made
    if __SSL_TB.alive(__SSL_TB.go) then
      go = __SSL_TB.go
      made = false
    else
      local exist = rootTr:Find('SSL_TestBlitzBtn')
      if exist ~= nil then
        go = exist.gameObject
        made = false
      else
        go = instantiate(tplGo, rootTr)
        go.name = 'SSL_TestBlitzBtn'
        made = true
      end
    end
    __SSL_TB.go = go
    __SSL_TB.apply(go, tplGo)
    local btn = go:GetComponent('UIButton')
    if btn == nil then btn = go:GetComponent('Button') end
    if btn == nil then error('no Button/UIButton on clone') end
    btn.onClick:RemoveAllListeners()
    btn.onClick:AddListener(function()
      local r = __SSL_TB.enter()
      printLog('[SSL] test button: ' .. tostring(r))
    end)
    return made and 'created' or 'exists'
  end)
  if ok then return res else return 'ERR:' .. tostring(res) end
end
-- Single place that (re)creates the clone and mirrors Deploy's visibility.
-- Called from OnEnable (panel open), Refresh (team added/loaded), and the pump.
__SSL_TB.sync = function(ctrl)
  if ctrl == nil or ctrl._mapNode == nil or ctrl._mapNode.btnStartBattle == nil then
    return 'ERR:no ctrl/btnStartBattle'
  end
  __SSL_TB.ctrl = ctrl
  if not __SSL_TB.isBlitzFormation(ctrl) then
    -- Other formation modes (RegionBoss / DailyInstance / ...) reuse this ctrl
    -- class; never show the Dummy button there.
    if __SSL_TB.alive(__SSL_TB.go) then __SSL_TB.go:SetActive(false) end
    return 'nonblitz'
  end
  local tplGo = ctrl._mapNode.btnStartBattle.gameObject
  __SSL_TB.tplDeploy = tplGo
  if not __SSL_TB.alive(__SSL_TB.go) then
    local r = __SSL_TB.wire(tplGo, ctrl)
    if tostring(r):sub(1, 3) == 'ERR' then return r end
  end
  local show = false
  pcall(function() show = tplGo.activeSelf == true end)
  if __SSL_TB.alive(__SSL_TB.go) then
    __SSL_TB.go:SetActive(show)
    -- Re-assert the label after the activation (and on every pump while shown):
    -- belt-and-braces against any component that re-localizes on enable.
    if show then __SSL_TB.setLabel(__SSL_TB.go) end
  end
  return show and 'shown' or 'hidden'
end
if not __SSL_TB.patched then
  pcall(function()
    local cls = require('Game.UI.RegionBossFormationEx.RegionBossFormationCtrl')
    local oldOn = cls.OnEnable
    if oldOn ~= nil then
      cls.OnEnable = function(self, ...)
        oldOn(self, ...)
        local okc, rc = pcall(function() return __SSL_TB.sync(self) end)
        __SSL_TB.lastCtrl = tostring(okc) .. ':' .. tostring(rc)
      end
    end
    local oldRf = cls.Refresh
    if oldRf ~= nil then
      cls.Refresh = function(self, ...)
        oldRf(self, ...)
        pcall(function() return __SSL_TB.sync(self) end)
      end
    end
    __SSL_TB.patched = true
  end)
end
local open = false
pcall(function() open = PanelManager.CheckPanelOpen(PanelId.RegionBossFormation) == true end)
local wired = 'nopanel'
if open then
  if __SSL_TB.ctrl ~= nil then
    local okc, rc = pcall(function() return __SSL_TB.sync(__SSL_TB.ctrl) end)
    wired = okc and tostring(rc) or ('ERR:' .. tostring(rc))
  else
    -- Panel opened before the patch installed: bootstrap off the live template
    -- (Find skips inactive objects, so this only fires once a team exists).
    pcall(function()
      local d = CS.UnityEngine.GameObject.Find('btnStartBattle')
      if d ~= nil then
        __SSL_TB.tplDeploy = d
        wired = 'boot:' .. tostring(__SSL_TB.wire(d, nil))
      else
        wired = 'noTemplate'
      end
    end)
  end
end
local vis = 'hidden'
pcall(function()
  if __SSL_TB.alive(__SSL_TB.go) then vis = __SSL_TB.go.activeSelf and 'shown' or 'hidden' end
end)
return 'OK patched=' .. tostring(__SSL_TB.patched) .. ' wired=' .. tostring(wired) .. ' vis=' .. tostring(vis) .. ' onenable=' .. tostring(__SSL_TB.lastCtrl) .. ' settle=' .. tostring(__SSL_SETTLEPATCH)
)lua";

void EnsureScoreBossTestButton() {
    static std::atomic<int64_t> nextMs{0};
    int64_t now = (int64_t)GetTickCount64();
    if (now < nextMs.load(std::memory_order_relaxed)) return;
    nextMs.store(now + 2000, std::memory_order_relaxed);   // 0.5 Hz is plenty for a lobby button
    std::string full = std::string(kScoreBossSettlePatch) + kTestButtonChunk;
    std::string res = RunLuaDoString(full.c_str(), "SSLTestBtn");
    if (res.empty()) return;   // failure already logged by RunLuaDoString ([origin] line)
    static std::string last;
    if (res != last) {
        last = res;
        log("[hotkey] test button: %s", res.c_str());
    }
}

// =============================================================================
//  Alt+1..5 ScoreBoss test-stage hotkeys (WndProc subclass)
//  The subclass proc runs on the Unity main thread (game message pump), so the
//  xLua DoString in RequestScoreBossTestEntry is safe to call synchronously.
//  Alt+1/2 = Lv 998/999 (BossRush arenas, no-mechanic variants), Alt+3/4/5 =
//  Lv 1/12/13 (Roguelike_2_MiniBoss_005; the DaWuGui + BingXiangGuai "Test"
//  prefabs ship inside roguelike_2_miniboss_005*.unity3d).
// =============================================================================
static const int32_t kTestLevelByHotkey[5] = { 998, 999, 1, 12, 13 };
static HWND g_GameWnd = nullptr;
static WNDPROC g_OrigWndProc = nullptr;
// Main-thread pump for the Blitz test button: WM_TIMER is delivered to the
// window's owning thread (Unity's main thread), so the xLua DoString inside
// EnsureScoreBossTestButton runs in the only context where Lua VM re-entry is
// safe. Without this the button only got built on room transitions (which
// never fire while the player just stands on the formation screen).
static constexpr UINT_PTR kButtonTimerId = 0x5153B001;
static constexpr UINT kButtonTimerMs = 1500;

static LRESULT CALLBACK HotkeyWndProc(HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    if (msg == WM_TIMER && wParam == kButtonTimerId) {
        EnsureScoreBossTestButton();
        return 0;
    }
    if ((msg == WM_SYSKEYDOWN || msg == WM_KEYDOWN) && !(lParam & 0x40000000)) {
        bool alt = (msg == WM_SYSKEYDOWN) || (GetKeyState(VK_MENU) < 0);
        if (alt && wParam >= '1' && wParam <= '5') {
            RequestScoreBossTestEntry(kTestLevelByHotkey[wParam - '1']);
            return 0;
        }
    }
    return CallWindowProcA(g_OrigWndProc, hWnd, msg, wParam, lParam);
}

struct GameWindowPick { HWND unity = nullptr; HWND visible = nullptr; HWND any = nullptr; int n = 0; };

static BOOL CALLBACK FindGameWindowCb(HWND hWnd, LPARAM lParam) {
    // Collect candidates; ranking happens in InstallHotkeys. Logs the first
    // few so a "not found" report shows what WAS visible.
    GameWindowPick* c = reinterpret_cast<GameWindowPick*>(lParam);
    DWORD wpid = 0;
    GetWindowThreadProcessId(hWnd, &wpid);
    if (wpid != GetCurrentProcessId() || !IsWindowVisible(hWnd)) return TRUE;
    char cls[64] = {0};
    GetClassNameA(hWnd, cls, (int)sizeof(cls) - 1);
    if (c->n < 5) {
        char title[128] = {0};
        GetWindowTextA(hWnd, title, (int)sizeof(title) - 1);
        log("[hotkey] window candidate: class='%s' title='%.100s' hwnd=0x%p", cls, title, hWnd);
    }
    c->n++;
    if (!c->any) c->any = hWnd;
    if (strcmp(cls, "UnityWndClass") == 0) { if (!c->unity) c->unity = hWnd; }
    else if (GetWindow(hWnd, GW_OWNER) == nullptr) { if (!c->visible) c->visible = hWnd; }
    return TRUE;
}

static std::atomic<bool> g_HotkeysArmed{false};
static std::atomic<bool> g_HotkeyStop{false};

bool InstallHotkeys() {
    if (g_HotkeysArmed.load(std::memory_order_relaxed)) return true;
    GameWindowPick pick{};
    EnumWindows(FindGameWindowCb, reinterpret_cast<LPARAM>(&pick));
    HWND wnd = pick.unity ? pick.unity : (pick.visible ? pick.visible : pick.any);
    if (!wnd) return false;
    WNDPROC orig = (WNDPROC)(intptr_t)SetWindowLongPtrA(wnd, GWLP_WNDPROC, (LONG_PTR)HotkeyWndProc);
    if (!orig) { log("[hotkey] subclass failed (%lu); Alt+1..5 disabled", (unsigned long)GetLastError()); return false; }
    g_GameWnd = wnd;
    g_OrigWndProc = orig;
    g_HotkeysArmed.store(true, std::memory_order_relaxed);
    SetTimer(wnd, kButtonTimerId, kButtonTimerMs, nullptr);
    log("[hotkey] Alt+1..5 armed on hwnd=0x%p (998/999/1/12/13); use from Blitz lobby, scores won't save", wnd);
    return true;
}

// The DLL loads at process start (winhttp proxy) before Unity creates its
// window, so a one-shot lookup in InitThread finds nothing. Retry in the
// background until the window appears; also re-arms if Unity recreates it
// (e.g. display changes).
static DWORD WINAPI HotkeyRetryThread(LPVOID) {
    for (int i = 0; i < 150 && !g_HotkeyStop.load(std::memory_order_relaxed); ++i) {
        if (!g_HotkeysArmed.load(std::memory_order_relaxed)) {
            InstallHotkeys();
        } else if (!IsWindow(g_GameWnd)) {
            log("[hotkey] game window gone; re-arming Alt+1..5");
            g_GameWnd = nullptr;
            g_OrigWndProc = nullptr;
            g_HotkeysArmed.store(false, std::memory_order_relaxed);
        }
        Sleep(2000);
    }
    return 0;
}

void StartHotkeyRetry() {
    HANDLE h = CreateThread(nullptr, 0, HotkeyRetryThread, nullptr, 0, nullptr);
    if (h) CloseHandle(h);
}

void RemoveHotkeys() {
    g_HotkeyStop.store(true, std::memory_order_relaxed);
    if (g_GameWnd && g_OrigWndProc) {
        KillTimer(g_GameWnd, kButtonTimerId);
        SetWindowLongPtrA(g_GameWnd, GWLP_WNDPROC, (LONG_PTR)g_OrigWndProc);
        g_GameWnd = nullptr;
        g_OrigWndProc = nullptr;
    }
    g_HotkeysArmed.store(false, std::memory_order_relaxed);
}
