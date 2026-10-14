// =============================================================================
//  dummy.cpp — ScoreBoss "dummy" test-stage entry feature
// =============================================================================
// Client-side entry into datamined ScoreBoss test levels, bypassing the
// server-gated score_boss_apply_req:
//   * Alt+1..5 hotkeys (enter immediately) and Shift+Alt+1..5 (preset the
//     Dummy button's target without entering), via a WndProc subclass
//   * a clickable "Dummy <level>" button cloned from the Blitz formation
//     screen's own Deploy button (RegionBossFormationCtrl.btnStartBattle)
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
//   1 -> ScoreBossLevel 1    (Roguelike_2_MiniBoss_005, prefab Roguelike_MiniBoss_DaWuGui_Test)
//   2 -> ScoreBossLevel 998  (BossRush arena Levels/StoryActivity/StoryActivity_13/
//                             StoryActivity_13_Boss_A_01, prefab
//                             StoryActivity_13_Boss_BossRush_1; the no-mechanic
//                             variant of Lv 26)
//   3 -> ScoreBossLevel 999  (BossRush arena Levels/Roguelike/Roguelike_2/
//                             Roguelike_2_Boss_002, prefab
//                             Roguelike_Boss_ShaSha_BossRush_3; the no-mechanic
//                             variant of Lv 27)
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
#include "ui_toolkit.h"
#include "arenafix.h"

// Entry points consumed by proxy.cpp.
bool InstallHotkeys();
void StartHotkeyRetry();
void RemoveHotkeys();
void EnsureScoreBossTestButton();

// Provided by proxy.cpp: the "Dummy 1" model dropdown selection. The
// GameDataController$$GetMonster hook rewrites that one Monster row's FAId —
// the key the engine resolves the monster's MonsterSkin (model + scale) with —
// to `skinId`; skinId 0 restores the original value, monsterId 0 is a no-op.
void SetDummySkinOverride(int32_t monsterId, int32_t skinId);

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

// Pull the current dropdown state (the "Dummy 1" model) right before entering:
// Alt+1 can be pressed inside a pump interval, and the level reads the Monster
// row only once it spawns its monsters. Same main-thread DoString context as the
// entry itself; defensive because __SSL_TB may not exist before the first pump.
static void SyncDummySkinNow() {
    static const char* kChunk =
        "local t, s = 0, 0\n"
        "if __SSL_TB ~= nil and __SSL_TB.dummyState ~= nil then t, s = __SSL_TB.dummyState() end\n"
        "return tostring(t) .. ':' .. tostring(s)";
    std::string res = RunLuaDoString(kChunk, "SSLDummyState");
    if (res.empty()) return;
    int mon = 0, skin = 0;
    if (sscanf(res.c_str(), "%d:%d", &mon, &skin) == 2)
        SetDummySkinOverride(mon, skin);
}

static void RequestScoreBossTestEntry(int levelId) {
    char chunk[4096];
    snprintf(chunk, sizeof(chunk), kTestEntryChunkTemplate, levelId);
    log("[hotkey] Alt entry requested: ScoreBossLevel %d", levelId);
    SyncDummySkinNow();
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
//  SCOREBOSS TEST-STAGE GUI BUTTONS (Blitz formation panel)
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
if __SSL_TB == nil or __SSL_TB.v ~= 26 then
  __SSL_TB = { v = 26, patched = false, go = nil, dd = nil, dd2 = nil,
    ctrl = nil, tplDeploy = nil, lastCtrl = 'never', sel = 0, mdl = 0,
    levels = { 1, 998, 999, 12, 13 },
    labels = { 'Floor 1', 'Floor 998', 'Floor 999', 'Floor 12', 'Floor 13' },
    dummyLevel = 1, dummyTarget = 0,
    models = { 0, 9912101, 9912102, 5054101, 3093101, 7000101, 7200101, 1651001 },
    modelLabels = { 'King Glopo III', 'Sherlock', 'Sherlock Small', 'Flavor Dread', 'Hazana', 'Opera Ghost: Rovina', 'Celsia Red', 'Lithe Beauty' } }
end
-- UI toolkit (__SSL_UI: clone/fit/wire buttons + dropdowns) lives in
-- ui_toolkit.cpp and is concatenated ahead of this chunk; re-alias it here.
local UI = __SSL_UI
-- =============================================================================
-- ScoreBoss test entries (Dummy button + level/model dropdowns).
-- Donor = the character EQUIPMENT panel's preset dropdown ('tc_dropdown_01',
-- CharacterInfoEx/CharEquipmentPanel.prefab): unlike the list panels' empty
-- arrow stubs it carries the full ornament (imgBg plate + imgUp/imgDown).
-- =============================================================================
__SSL_TB.enter = function()
  UI.closeDrop(__SSL_TB.dd)
  UI.closeDrop(__SSL_TB.dd2)
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
    -- Mirror SendEnterScoreBossApplyReq's msgCallback (PlayerScoreBossData.lua):
    -- the server apply response zeroes the run score state, which
    -- EnterScoreBossInstance alone never sets.
    SB.CurHPLvScore = 0
    SB.HPLvScore = 0
    SB.CurHPDamage = 0
    SB.BehaviorScore = 0
    SB.BehaviorScoreCount = 0
    -- Mark this server-less test run: the settle patch finishes the fight
    -- locally instead of waiting on a settle ack the server will reject. A
    -- real, server-authorized entry clears this flag again.
    __SSL_TESTMODE = true
    local lvl = __SSL_TB.selLevel()
    SB:EnterScoreBossInstance(lvl, build)
    return 'entered Lv' .. tostring(lvl)
  end)
  if ok then return 'OK ' .. tostring(res) else return 'ERR:' .. tostring(res) end
end
__SSL_TB.isBlitzFormation = function(ctrl)
  local ok, v = pcall(function() return ctrl.nType == AllEnum.RegionBossFormationType.ScoreBoss end)
  if ok then return v == true end
  return false
end
__SSL_TB.selLevel = function()
  return (__SSL_TB.levels ~= nil and __SSL_TB.levels[(__SSL_TB.sel or 0) + 1]) or 1
end
__SSL_TB.selLabel = function()
  return 'Dummy ' .. tostring(__SSL_TB.selLevel())
end
-- Hotkey preset for the Dummy target (Shift+Alt+1..5, wired in HotkeyWndProc):
-- selects without entering. Alt+1..5 alone still enters immediately.
__SSL_TB.setSel = function(i)
  local n = #(__SSL_TB.levels or { 1 })
  i = tonumber(i) or 0
  if i < 0 then i = 0 end
  if i >= n then i = n - 1 end
  __SSL_TB.sel = i
  if UI.alive(__SSL_TB.go) then UI.setText(__SSL_TB.go, __SSL_TB.selLabel()) end
  pcall(function()
    if UI.alive(__SSL_TB.dd) then
      local dd = UI.dropComp(__SSL_TB.dd)
      if dd ~= nil then dd.value = i end
    end
  end)
  pcall(function() __SSL_TB.refreshModelDD() end)
  return 'preset Lv' .. tostring((__SSL_TB.levels or {})[i + 1] or '?')
end
__SSL_TB.ddPrefabPath = 'Assets/AssetBundles/UI/CharacterInfoEx/CharEquipmentPanel.prefab'
__SSL_TB.ddNodeNames = { 'tc_dropdown_01', 'goSortDropdown' }
__SSL_TB.ddTemplate = function()
  -- Retry once after evicting: covers the case where the cached asset passes
  -- the touch test but instantiate still throws (unloaded mid-frame).
  local ok, tpl = pcall(function() return UI.loadNode(__SSL_TB.ddPrefabPath, __SSL_TB.ddNodeNames) end)
  if ok and tpl ~= nil then
    local usable = pcall(function() local _ = tpl.name end)
    if usable then return tpl end
    UI.evictNode(__SSL_TB.ddPrefabPath)
  end
  return UI.loadNode(__SSL_TB.ddPrefabPath, __SSL_TB.ddNodeNames)
end
__SSL_TB.wireButton = function(tplGo)
  local ok, res = pcall(function()
    if tplGo == nil then error('no template') end
    -- Stay in the template's own parent/anchor space: guaranteed sane placement.
    local rootTr = tplGo.transform.parent
    if rootTr == nil then error('no template parent') end
    local go = UI.alive(__SSL_TB.go) and __SSL_TB.go or UI.clone(tplGo, rootTr, 'SSL_TestBlitzBtn')
    __SSL_TB.go = go
    -- Same rect as Deploy, shifted left by its own width beside it. (Not the
    -- ATK pill: it carries an attribute renderer that overwrites the label.)
    local tRt = tplGo:GetComponent('RectTransform')
    if tRt ~= nil then
      UI.place(go, tplGo, tRt.anchoredPosition.x - (tRt.sizeDelta.x + 28), tRt.anchoredPosition.y)
    end
    UI.renameTree(go)
    UI.setText(go, __SSL_TB.selLabel())
    go.transform:SetAsLastSibling()
    UI.onClick(go, function()
      local r = __SSL_TB.enter()
      printLog('[SSL] test button: ' .. tostring(r))
    end)
    return 'wired'
  end)
  if ok then return res else return 'ERR:' .. tostring(res) end
end
__SSL_TB.wireLevelDD = function(rootTr, tplGo)
  local ok, res = pcall(function()
    local tpl = __SSL_TB.ddTemplate()
    local dd = UI.alive(__SSL_TB.dd) and __SSL_TB.dd or UI.clone(tpl, rootTr, 'SSL_LevelDropdown')
    __SSL_TB.dd = dd
    UI.renameTree(dd)
    UI.manage(dd)
    -- Float above Dummy, same anchor space.
    local dRt = UI.alive(__SSL_TB.go) and __SSL_TB.go:GetComponent('RectTransform') or nil
    if dRt ~= nil then
      UI.place(dd, tplGo, dRt.anchoredPosition.x, dRt.anchoredPosition.y + (dRt.sizeDelta.y + 10))
    end
    UI.fillDrop(dd, __SSL_TB.labels, __SSL_TB.sel or 0, function(idx)
      __SSL_TB.sel = tonumber(idx) or 0
      if UI.alive(__SSL_TB.go) then UI.setText(__SSL_TB.go, __SSL_TB.selLabel()) end
      -- Selecting closes the popup: flip the chevron now instead of waiting
      -- for the next pump, and show/hide the skin bar immediately.
      UI.setArrows(dd, false)
      pcall(function() __SSL_TB.refreshModelDD() end)
      printLog('[SSL] level pick: Lv' .. tostring(__SSL_TB.selLevel()))
    end)
    UI.flipUp(dd)
    local w = UI.fitBar(dd, __SSL_TB.go)
    UI.fitList(dd, w)
    UI.setArrows(dd, false)
    UI.subEvent()
    dd.transform:SetAsLastSibling()
    return 'real-dd'
  end)
  if ok then return res else return 'ERR:' .. tostring(res) end
end
-- Dummy MODEL dropdown (second bar, only while Floor 1 is picked): a spawned
-- monster's combat model is MonsterSkin[Monster.FAId], so picking one rewrites
-- that floor's boss row to the wooden-dummy skin (model-only: stats/AI/skills
-- untouched). The pick reaches the DLL as dummy=<monsterId>:<skinId> (see
-- dummyState); skin 0 = the row's own FAId, untouched.
__SSL_TB.modelSkin = function()
  return (__SSL_TB.models or {})[(__SSL_TB.mdl or 0) + 1] or 0
end
__SSL_TB.wantModelDD = function()
  return ((__SSL_TB.levels or {})[(__SSL_TB.sel or 0) + 1] == (__SSL_TB.dummyLevel or 1))
end
__SSL_TB.dummyTargetId = function()
  local t = __SSL_TB.dummyTarget
  if t ~= nil and t ~= 0 then return t end
  local id = 0
  pcall(function()
    local cfg = ConfigTable.GetData('ScoreBossLevel', __SSL_TB.dummyLevel or 1)
    if cfg ~= nil and cfg.MonsterId ~= nil then id = tonumber(cfg.MonsterId) or 0 end
  end)
  if id ~= 0 then __SSL_TB.dummyTarget = id end
  return id
end
__SSL_TB.dummyState = function()
  return __SSL_TB.dummyTargetId(), __SSL_TB.modelSkin()
end
__SSL_TB.wireModelDD = function(rootTr, tplGo)
  local ok, res = pcall(function()
    local tpl = __SSL_TB.ddTemplate()
    local dd = UI.alive(__SSL_TB.dd2) and __SSL_TB.dd2 or UI.clone(tpl, rootTr, 'SSL_ModelDropdown')
    __SSL_TB.dd2 = dd
    UI.renameTree(dd)
    UI.manage(dd)
    local dRt = UI.alive(__SSL_TB.go) and __SSL_TB.go:GetComponent('RectTransform') or nil
    local lRt = UI.alive(__SSL_TB.dd) and __SSL_TB.dd:GetComponent('RectTransform') or nil
    if dRt ~= nil then
      -- Stacked above the level bar (both 72 tall after the fit, 10 px gap).
      local baseY = dRt.anchoredPosition.y + (dRt.sizeDelta.y + 10)
      if lRt ~= nil then baseY = lRt.anchoredPosition.y + 36 + 10 + 36 end
      UI.place(dd, tplGo, dRt.anchoredPosition.x, baseY)
    end
    UI.fillDrop(dd, __SSL_TB.modelLabels, __SSL_TB.mdl or 0, function(idx)
      __SSL_TB.mdl = tonumber(idx) or 0
      UI.setArrows(dd, false)
      printLog('[SSL] dummy model: ' .. tostring((__SSL_TB.modelLabels or {})[(__SSL_TB.mdl or 0) + 1] or '?')
        .. ' (' .. tostring(__SSL_TB.modelSkin()) .. ')')
    end)
    UI.flipUp(dd)
    local w = UI.fitBar(dd, __SSL_TB.go)
    UI.fitList(dd, w)
    UI.setArrows(dd, false)
    dd.transform:SetAsLastSibling()
    return 'model-dd'
  end)
  if ok then return res else return 'ERR:' .. tostring(res) end
end
-- Instant skin-bar show/hide for level picks and Shift+Alt presets, without
-- waiting for the next pump tick (sync re-asserts the same state on its tick).
__SSL_TB.refreshModelDD = function()
  local want = false
  pcall(function() want = __SSL_TB.wantModelDD() end)
  if want then
    pcall(function()
      local tpl = __SSL_TB.tplDeploy
      if tpl ~= nil then __SSL_TB.wireModelDD(tpl.transform.parent, tpl) end
    end)
    if UI.alive(__SSL_TB.dd2) then __SSL_TB.dd2:SetActive(true) end
  elseif UI.alive(__SSL_TB.dd2) then
    UI.closeDrop(__SSL_TB.dd2)
    __SSL_TB.dd2:SetActive(false)
  end
end
-- Single place that (re)creates the clones and mirrors Deploy's visibility.
-- Called from OnEnable (panel open), Refresh (team added/loaded), and the pump.
__SSL_TB.sync = function(ctrl)
  if ctrl == nil or ctrl._mapNode == nil or ctrl._mapNode.btnStartBattle == nil then
    return 'ERR:no ctrl/btnStartBattle'
  end
  __SSL_TB.ctrl = ctrl
  if not __SSL_TB.isBlitzFormation(ctrl) then
    -- Other formation modes reuse this ctrl class; never show our clones there.
    -- Close popups BEFORE deactivating or their click-eaters orphan.
    UI.closeDrop(__SSL_TB.dd)
    UI.closeDrop(__SSL_TB.dd2)
    if UI.alive(__SSL_TB.go) then __SSL_TB.go:SetActive(false) end
    if UI.alive(__SSL_TB.dd) then __SSL_TB.dd:SetActive(false) end
    if UI.alive(__SSL_TB.dd2) then __SSL_TB.dd2:SetActive(false) end
    return 'nonblitz'
  end
  local tplGo = ctrl._mapNode.btnStartBattle.gameObject
  __SSL_TB.tplDeploy = tplGo
  if not UI.alive(__SSL_TB.go) then
    local r = __SSL_TB.wireButton(tplGo)
    if tostring(r):sub(1, 3) == 'ERR' then return r end
  end
  local show = false
  pcall(function() show = tplGo.activeSelf == true end)
  if UI.alive(__SSL_TB.go) then
    __SSL_TB.go:SetActive(show)
    -- Re-assert the label on every pump while shown: belt-and-braces against
    -- any component that re-localizes on enable.
    if show then UI.setText(__SSL_TB.go, __SSL_TB.selLabel()) end
  end
  local listRes = 'nolist'
  if show then
    listRes = __SSL_TB.wireLevelDD(tplGo.transform.parent, tplGo)
    if tostring(listRes):sub(1, 3) == 'ERR' then
      -- Prefab gone (game update): dropdowns stay hidden, everything else works.
      UI.closeDrop(__SSL_TB.dd)
      UI.closeDrop(__SSL_TB.dd2)
      if UI.alive(__SSL_TB.dd) then __SSL_TB.dd:SetActive(false) end
      if UI.alive(__SSL_TB.dd2) then __SSL_TB.dd2:SetActive(false) end
    else
      if UI.alive(__SSL_TB.dd) then __SSL_TB.dd:SetActive(true) end
      UI.pollDrop(__SSL_TB.dd)
      __SSL_TB.refreshModelDD()
      UI.pollDrop(__SSL_TB.dd2)
    end
  else
    UI.closeDrop(__SSL_TB.dd)
    UI.closeDrop(__SSL_TB.dd2)
    if UI.alive(__SSL_TB.dd) then __SSL_TB.dd:SetActive(false) end
    if UI.alive(__SSL_TB.dd2) then __SSL_TB.dd2:SetActive(false) end
  end
  return (show and 'shown' or 'hidden') .. ' ' .. tostring(listRes)
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
        wired = 'boot:' .. tostring(__SSL_TB.wireButton(d))
      else
        wired = 'noTemplate'
      end
    end)
  end
end
local vis = 'hidden'
pcall(function()
  if UI.alive(__SSL_TB.go) then vis = __SSL_TB.go.activeSelf and 'shown' or 'hidden' end
end)
local selinfo = tostring(__SSL_TB.selLevel())
local dmt, dms = 0, 0
pcall(function() dmt, dms = __SSL_TB.dummyState() end)
return 'OK patched=' .. tostring(__SSL_TB.patched) .. ' wired=' .. tostring(wired) .. ' vis=' .. tostring(vis) .. ' sel=' .. selinfo .. ' onenable=' .. tostring(__SSL_TB.lastCtrl) .. ' settle=' .. tostring(__SSL_SETTLEPATCH) .. ' dummy=' .. tostring(dmt) .. ':' .. tostring(dms)
)lua";

// The chunk reports the two dropdowns' state as 'dummy=<monsterId>:<skinId>'
// (see __SSL_TB.dummyState). Push it into the GetMonster hook, which puts that
// skin into that one Monster row (monsterId 0 = tables not loaded: no-op).
static void PushDummySkinFromResult(const std::string& res) {
    size_t pos = res.find(" dummy=");
    if (pos == std::string::npos) return;
    int mon = 0, skin = 0;
    if (sscanf(res.c_str() + pos + 7, "%d:%d", &mon, &skin) == 2)
        SetDummySkinOverride(mon, skin);
}

void EnsureScoreBossTestButton() {
    static std::atomic<int64_t> nextMs{0};
    int64_t now = (int64_t)GetTickCount64();
    if (now < nextMs.load(std::memory_order_relaxed)) return;
    // 0.5 Hz is plenty for a lobby button; poke ~3x faster while the formation
    // panel is up (the only place the two dropdowns can change) so a model pick
    // is in place before the level spawns its monsters.
    nextMs.store(now + 2000, std::memory_order_relaxed);
    std::string full = std::string(kScoreBossSettlePatch) + InfinityTowerOpenPatch() + SslUiToolkitChunk() + kTestButtonChunk;
    std::string res = RunLuaDoString(full.c_str(), "SSLTestBtn");
    if (res.empty()) return;   // failure already logged by RunLuaDoString ([origin] line)
    if (res.find(" vis=shown") != std::string::npos)
        nextMs.store(now + 700, std::memory_order_relaxed);
    PushDummySkinFromResult(res);
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
//  Alt+1 = Lv 1 (Roguelike_2_MiniBoss_005 DaWuGui test), Alt+2/3 = Lv 998/999
//  (BossRush arenas, no-mechanic variants), Alt+4/5 = Lv 12/13
//  (Roguelike_2_MiniBoss_005; the BingXiangGuai "Test" prefabs ship inside
//  roguelike_2_miniboss_005*.unity3d).
//  Shift+Alt+1..5 only presets the Dummy button target (no entry).
// =============================================================================
static const int32_t kTestLevelByHotkey[5] = { 1, 998, 999, 12, 13 };
static HWND g_GameWnd = nullptr;
static WNDPROC g_OrigWndProc = nullptr;
// Main-thread pump for the Blitz test button: WM_TIMER is delivered to the
// window's owning thread (Unity's main thread), so the xLua DoString inside
// EnsureScoreBossTestButton runs in the only context where Lua VM re-entry is
// safe. Without this the button only got built on room transitions (which
// never fire while the player just stands on the formation screen).
static constexpr UINT_PTR kButtonTimerId = 0x5153B001;
// Fires faster than the chunk's own fast throttle (700 ms while the formation
// panel is up): the timer is what actually delivers the pump, so a slower
// timer here would cap the whole UI at its own rate.
static constexpr UINT kButtonTimerMs = 500;

static LRESULT CALLBACK HotkeyWndProc(HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    if (msg == WM_TIMER && wParam == kButtonTimerId) {
        EnsureScoreBossTestButton();
        return 0;
    }
    if ((msg == WM_SYSKEYDOWN || msg == WM_KEYDOWN) && !(lParam & 0x40000000)) {
        bool alt = (msg == WM_SYSKEYDOWN) || (GetKeyState(VK_MENU) < 0);
        if (alt && wParam >= '1' && wParam <= '5') {
            int idx = (int)(wParam - '1');
            // Shift+Alt+1..5: preset the Dummy button's target without
            // entering (main-thread Lua is safe here). Alt+1..5 alone enters
            // immediately, as before.
            if (GetKeyState(VK_SHIFT) < 0) {
                char chunk[128];
                snprintf(chunk, sizeof(chunk), "return __SSL_TB.setSel(%d)", idx);
                std::string res = RunLuaDoString(chunk, "SSLPreset");
                log("[hotkey] preset Dummy target: %s", res.empty() ? "(lua busy)" : res.c_str());
            } else {
                RequestScoreBossTestEntry(kTestLevelByHotkey[idx]);
            }
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
    log("[hotkey] Alt+1..5 armed on hwnd=0x%p (1/998/999/12/13 enter; Shift+Alt+1..5 presets Dummy target); use from Blitz lobby, scores won't save", wnd);
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
