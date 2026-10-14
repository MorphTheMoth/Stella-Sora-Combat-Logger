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
if __SSL_TB == nil or __SSL_TB.v ~= 22 then
  __SSL_TB = { v = 22, patched = false, go = nil, tgl = nil, opts = {}, listOpen = false,
    dd = nil, ddTpl = nil, ddArrowUp = nil, ddArrowDn = nil, ddMode = 'none',
    ctrl = nil, tplDeploy = nil, lastCtrl = 'never', sel = 0,
    levels = { 998, 999, 1, 12, 13 },
    labels = { '998 BossRush', '999 ShaSha', '1 DaWuGui', '12 Bing L1', '13 Bing L2' } }
end
if __SSL_TB.opts == nil then __SSL_TB.opts = {} end
if __SSL_TB.wasOpen == nil then __SSL_TB.wasOpen = false end
if __SSL_TB.evSub == nil then __SSL_TB.evSub = false end
if __SSL_TB.listOpen == nil then __SSL_TB.listOpen = false end
if __SSL_TB.levels == nil then
  __SSL_TB.levels = { 998, 999, 1, 12, 13 }
  __SSL_TB.labels = { '998 BossRush', '999 ShaSha', '1 DaWuGui', '12 Bing L1', '13 Bing L2' }
end
if __SSL_TB.sel == nil then __SSL_TB.sel = 0 end
__SSL_TB.enter = function()
  pcall(function() __SSL_TB.closeList() end)
  pcall(function() __SSL_TB.closePopup() end)
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
    local lvl = (__SSL_TB.levels ~= nil and __SSL_TB.levels[(__SSL_TB.sel or 0) + 1]) or 1
    SB:EnterScoreBossInstance(lvl, build)
    return 'entered Lv' .. tostring(lvl)
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
__SSL_TB.selLabel = function()
  local lvl = (__SSL_TB.levels ~= nil and __SSL_TB.levels[(__SSL_TB.sel or 0) + 1]) or 1
  return 'Dummy ' .. tostring(lvl)
end
__SSL_TB.setText = function(go, s)
  local txt = nil
  pcall(function() txt = go:GetComponentInChildren(typeof(CS.TMPro.TMP_Text), true) end)
  if txt == nil then pcall(function() txt = go:GetComponentInChildren(typeof(CS.UnityEngine.UI.Text), true) end) end
  if txt ~= nil then
    local dok = pcall(function() txt.text = s end)
    if not dok then pcall(function() NovaAPI.SetTMPText(txt, s) end) end
  end
end
__SSL_TB.setLabel = function(go)
  __SSL_TB.setText(go, __SSL_TB.selLabel())
end
-- Hotkey preset for the Dummy target (Shift+Alt+1..5, wired in HotkeyWndProc):
-- selects without entering. Alt+1..5 alone still enters immediately.
__SSL_TB.setSel = function(i)
  local n = #(__SSL_TB.levels or { 1 })
  i = tonumber(i) or 0
  if i < 0 then i = 0 end
  if i >= n then i = n - 1 end
  __SSL_TB.sel = i
  if __SSL_TB.alive(__SSL_TB.go) then __SSL_TB.setLabel(__SSL_TB.go) end
  pcall(function() __SSL_TB.markOpts() end)
  pcall(function() __SSL_TB.closeList() end)
  pcall(function()
    if __SSL_TB.alive(__SSL_TB.dd) then
      local dd = __SSL_TB.ddComp(__SSL_TB.dd)
      if dd ~= nil then dd.value = i end
    end
  end)
  return 'preset Lv' .. tostring((__SSL_TB.levels or {})[i + 1] or '?')
end
-- Option-list popup built ONLY from same-panel Deploy clones (no foreign
-- prefab, no bundle load, no TMP_Dropdown): a small 'v' toggle beside Dummy
-- plus one button per level stacked upward. Plain sibling buttons can never
-- orphan a fullscreen click-eater, so the worst case is a stray visible
-- button, never dead input.
__SSL_TB.optText = function(i)
  local s = tostring((__SSL_TB.labels or {})[i] or ('Lv' .. tostring((__SSL_TB.levels or {})[i] or '?')))
  if ((__SSL_TB.sel or 0) + 1) == i then return '> ' .. s end
  return '  ' .. s
end
__SSL_TB.markOpts = function()
  for i, o in ipairs(__SSL_TB.opts or {}) do
    if __SSL_TB.alive(o) then __SSL_TB.setText(o, __SSL_TB.optText(i)) end
  end
end
__SSL_TB.closeList = function()
  __SSL_TB.listOpen = false
  pcall(function()
    if __SSL_TB.alive(__SSL_TB.tgl) then __SSL_TB.setText(__SSL_TB.tgl, 'v') end
  end)
  for _, o in ipairs(__SSL_TB.opts or {}) do
    if __SSL_TB.alive(o) then o:SetActive(false) end
  end
end
__SSL_TB.toggleList = function()
  if __SSL_TB.listOpen then
    __SSL_TB.closeList()
    return 'closed'
  end
  __SSL_TB.listOpen = true
  pcall(function()
    if __SSL_TB.alive(__SSL_TB.tgl) then __SSL_TB.setText(__SSL_TB.tgl, '^') end
  end)
  pcall(function() __SSL_TB.markOpts() end)
  for _, o in ipairs(__SSL_TB.opts or {}) do
    if __SSL_TB.alive(o) then
      o:SetActive(true)
      o.transform:SetAsLastSibling()
    end
  end
  if __SSL_TB.alive(__SSL_TB.tgl) then __SSL_TB.tgl.transform:SetAsLastSibling() end
  for _, o in ipairs(__SSL_TB.opts or {}) do
    if __SSL_TB.alive(o) then o.transform:SetAsLastSibling() end
  end
  return 'open'
end
-- Real game dropdown (TemplateDropdown visuals), sourced WITHOUT any foreign
-- panel in the scene: a panel prefab is loaded as an asset (panelId 0 =>
-- MakeBundleGroup returns nil => never auto-unloaded on panel close, which is
-- what killed the old full-panel donor), and ONLY its template ctrl is
-- instantiated. No TemplateDropdownCtrl instance is created (it fires the
-- global SelectTemplateDD), the TMP_Dropdown is driven directly. Falls back to
-- the same-panel clone stack if the load fails.
-- Donor = the character EQUIPMENT panel's preset dropdown ('tc_dropdown_01',
-- CharacterInfoEx/CharEquipmentPanel.prefab) rather than the character/disc
-- LIST panel's 'goSortDropdown': both are TemplateDropdownCtrl instances, but
-- the list variants ship imgUp/imgDown as EMPTY placeholders (RectTransform
-- only - see wireArrows), while the equipment one carries the full ornament:
--   Dropdown (462x72)
--     Arrow -> imgBg  Image<disc> 72x72   <- the plate behind the chevron
--              imgUp  Image<chevron> 58x58
--              imgDown Image<chevron> 58x58
--     Label  (stretch, sizeDelta.x -184.2 -> text stops left of the arrow)
--     Template (popup)
-- so the chevron shows with its background disc 'around it' and the caption is
-- already inset, no fitting needed.
__SSL_TB.ddPrefabPath = 'Assets/AssetBundles/UI/CharacterInfoEx/CharEquipmentPanel.prefab'
__SSL_TB.ddNodeNames = { 'tc_dropdown_01', 'goSortDropdown' }
__SSL_TB.ddComp = function(go)
  if go == nil then return nil end
  local dd = nil
  pcall(function() dd = go:GetComponent('TMP_Dropdown') end)
  if dd == nil then pcall(function() dd = go:GetComponent('Dropdown') end) end
  if dd == nil then pcall(function() dd = go:GetComponentInChildren(typeof(CS.TMPro.TMP_Dropdown), true) end) end
  if dd == nil then pcall(function() dd = go:GetComponentInChildren(typeof(CS.UnityEngine.UI.Dropdown), true) end) end
  return dd
end
__SSL_TB.loadDDTemplate = function()
  if __SSL_TB.alive(__SSL_TB.ddTpl) then return true end
  if __SSL_TB.ddTpl ~= nil then
    local okp = pcall(function() return __SSL_TB.ddTpl:IsNull() end)
    if okp then __SSL_TB.ddTpl = nil end
  end
  local ok, res = pcall(function()
    local GRL = require('Game.Common.Resource.GameResourceLoader')
    local prefab = GRL.LoadAsset(GRL.ResType.Any, __SSL_TB.ddPrefabPath, typeof(CS.UnityEngine.Object), 'UI', 0)
    if prefab == nil then error('prefab load failed: ' .. tostring(__SSL_TB.ddPrefabPath)) end
    local found = nil
    local all = prefab:GetComponentsInChildren(typeof(CS.UnityEngine.Transform), true)
    local n = (all ~= nil) and all.Length or 0
    for _, nm in ipairs(__SSL_TB.ddNodeNames or {}) do
      for i = 0, n - 1 do
        local t = all[i]
        if t ~= nil and t.gameObject ~= nil and t.gameObject.name == nm then found = t.gameObject break end
      end
      if found ~= nil then break end
    end
    if found == nil then error('dropdown ctrl node not in prefab') end
    __SSL_TB.ddTpl = found
    -- Fallback arrow donors, used ONLY if the dropdown's own imgUp/imgDown turn
    -- out to be empty placeholders (see wireArrows). The equipment prefab wires
    -- them itself; the character/disc LIST prefabs instead ship them as
    -- RectTransform-only 'goDummy' stubs (ui_characterlistex, ui_disc), and the
    -- only real chevron in those panels sits on the sort-order button
    -- (goListBtn/btnOrder/AnimRoot/Image/imgArrowUp|imgArrowDown)Enable — one
    -- shared sprite, 'Down' being that same sprite rotated 180 deg on X.
    -- Absent here (that panel has no such button), so these stay nil unless the
    -- prefab path is ever swapped back to a list panel.
    __SSL_TB.ddArrowUp = __SSL_TB.findDeep(prefab.transform, 'imgArrowUpEnable')
      or __SSL_TB.findDeep(prefab.transform, 'imgArrowUpDisable')
    __SSL_TB.ddArrowDn = __SSL_TB.findDeep(prefab.transform, 'imgArrowDownEnable')
      or __SSL_TB.findDeep(prefab.transform, 'imgArrowDownDisable')
    return true
  end)
  if ok then return true else return 'ERR:' .. tostring(res) end
end
__SSL_TB.fillDD = function(go)
  local dd = __SSL_TB.ddComp(go)
  if dd == nil then error('no TMP_Dropdown under clone') end
  dd:ClearOptions()
  local List_String = CS.System.Collections.Generic.List(CS.System.String)
  local lst = List_String()
  for _, s in ipairs(__SSL_TB.labels or {}) do lst:Add(s) end
  dd:AddOptions(lst)
  dd.value = __SSL_TB.sel or 0
  dd.onValueChanged:RemoveAllListeners()
  dd.onValueChanged:AddListener(function(idx)
    __SSL_TB.sel = tonumber(idx) or 0
    if __SSL_TB.alive(__SSL_TB.go) then __SSL_TB.setLabel(__SSL_TB.go) end
    printLog('[SSL] level pick: Lv' .. tostring((__SSL_TB.levels or {})[(__SSL_TB.sel or 0) + 1] or '?'))
  end)
  return true
end
-- Hide() is a no-op unless the popup is open. Opening a TMP_Dropdown spawns a
-- fullscreen invisible Blocker on the root canvas; deactivating the clone (or
-- leaving the panel) with the popup open orphans it and eats all clicks.
-- Call before EVERY deactivation.
__SSL_TB.closePopup = function()
  if not __SSL_TB.alive(__SSL_TB.dd) then return end
  pcall(function()
    local dd = __SSL_TB.ddComp(__SSL_TB.dd)
    if dd == nil then return end
    local open = false
    pcall(function() open = dd.IsExpanded == true end)
    if open then dd:Hide() end
  end)
end
-- TemplateDropdownCtrl swaps imgUp/imgDown on open via the DropdownOpenState
-- event; without the ctrl we poll IsExpanded in sync (cheap, pump-rate).
__SSL_TB.pollArrows = function()
  if not __SSL_TB.alive(__SSL_TB.dd) then return end
  pcall(function()
    local dd = __SSL_TB.ddComp(__SSL_TB.dd)
    if dd == nil then return end
    local open = dd.IsExpanded == true
    __SSL_TB.wasOpen = open
    local up, dn = __SSL_TB.arrowRefs()
    if up ~= nil then up:SetActive(not open) end
    if dn ~= nil then dn:SetActive(open) end
  end)
end
-- The formation screen sits at the bottom of the display, so the stock
-- downward-opening template runs off-screen. Re-anchor it to the TOP edge of
-- the control with a bottom pivot: the list grows upward where there is room.
-- dd.template is an object reference, so the SSL_ rename does not affect it.
-- Idempotent: re-applied on every sync.
__SSL_TB.flipTemplate = function(ddgo)
  pcall(function()
    local dd = __SSL_TB.ddComp(ddgo)
    if dd == nil or dd.template == nil then return end
    local t = dd.template
    t.anchorMin = Vector2(0, 1)
    t.anchorMax = Vector2(1, 1)
    t.pivot = Vector2(0.5, 0)
    t.anchoredPosition = Vector2(0, 4)
    -- Stretch anchors + zero x-offset => popup exactly as wide as the button.
    t.sizeDelta = Vector2(0, t.sizeDelta.y)
  end)
end
-- Arrows + sounds, mirroring TemplateDropdownCtrl:OnEvent_Open exactly. The
-- C# dropdown class fires the global string event 'DropdownOpenState' on
-- show/hide (that is the only listener in _mapEventConfig); our clone is the
-- same component class so it fires too. The event carries no source, so only
-- react when OUR popup is the one involved (open: our IsExpanded is true;
-- close: our wasOpen flag) — otherwise the owning screen's own ctrl already
-- handles its arrows+sound and we would double-play.
-- In practice the event almost never arrives: DropdownOpenState_Start/
-- OnDestroy only Fire it when their own GameObject is named 'Dropdown_List'
-- (decompiled.c → StringLiteral_Dropdown_List), and the prefab's node is
-- 'Template', so nothing fires even in the real panels. pollArrows() is what
-- actually drives the swap; onDDOpen stays as the no-double-play path in case
-- a future prefab is renamed.
-- BaseCtrl resolves node names by DFS (func_MarkAllNode), so imgUp/imgDown may
-- sit nested; a direct-child Find misses them (they hang off an intermediate
-- container two levels below the dropdown root: 'goDummy' in the list prefabs,
-- 'Arrow' in the equipment one). Both ship ACTIVE in the asset, so the explicit
-- SetActive below is what picks one — TemplateDropdownCtrl:Awake would normally
-- do it, but Awake never runs on our ctrl-less clone.
__SSL_TB.findDeep = function(root, name)
  if root == nil then return nil end
  local found = nil
  pcall(function()
    local all = root:GetComponentsInChildren(typeof(CS.UnityEngine.Transform), true)
    local n = (all ~= nil) and all.Length or 0
    for i = 0, n - 1 do
      local t = all[i]
      if t ~= nil and t.gameObject ~= nil and t.gameObject.name == name then found = t.gameObject break end
    end
  end)
  return found
end
__SSL_TB.arrowRefs = function()
  local up, dn = nil, nil
  pcall(function()
    if __SSL_TB.alive(__SSL_TB.arrowUp) then up = __SSL_TB.arrowUp end
    if __SSL_TB.alive(__SSL_TB.arrowDn) then dn = __SSL_TB.arrowDn end
    if up == nil and __SSL_TB.alive(__SSL_TB.dd) then
      up = __SSL_TB.findDeep(__SSL_TB.dd.transform, 'SSL_imgUp')
      if up == nil then up = __SSL_TB.findDeep(__SSL_TB.dd.transform, 'imgUp') end
      __SSL_TB.arrowUp = up
    end
    if dn == nil and __SSL_TB.alive(__SSL_TB.dd) then
      dn = __SSL_TB.findDeep(__SSL_TB.dd.transform, 'SSL_imgDown')
      if dn == nil then dn = __SSL_TB.findDeep(__SSL_TB.dd.transform, 'imgDown') end
      __SSL_TB.arrowDn = dn
    end
  end)
  return up, dn
end
__SSL_TB.setArrows = function(bOpen)
  if not __SSL_TB.alive(__SSL_TB.dd) then return end
  pcall(function()
    local up, dn = __SSL_TB.arrowRefs()
    if up ~= nil then up:SetActive(not bOpen) end
    if dn ~= nil then dn:SetActive(bOpen) end
  end)
end
-- The equipment dropdown wires its own chevrons (imgUp/imgDown carry the Image,
-- with a 'imgBg' plate behind them). If a swapped-in prefab instead ships them
-- as empty placeholders (the character/disc LIST variants), activating them
-- would draw nothing (dd-diag showed 'comps=[RectTransform]' for both) — then
-- clone the panel's own sort-order chevron (ddArrowUp/ddArrowDn) into them.
-- Never touches the box when the prefab already draws it, so the equipment
-- layout (imgBg + chevron at x 195.9) is left exactly as authored.
__SSL_TB.arrowBox = 44
__SSL_TB.wireArrows = function()
  local ok, res = pcall(function()
    if not __SSL_TB.alive(__SSL_TB.dd) then return 'nodropdown' end
    local up, dn = __SSL_TB.arrowRefs()
    if up == nil or dn == nil then return 'noanchors' end
    local made = 0
    local w = 236
    pcall(function()
      local drt = __SSL_TB.dd:GetComponent('RectTransform')
      if drt ~= nil then
        local rw = drt.rect.width          -- only used when we must build the arrow
        if rw ~= nil and rw > 1 then w = rw else w = drt.sizeDelta.x end
      end
    end)
    if w == nil or w < 1 then w = 236 end
    local box = __SSL_TB.arrowBox
    local x = (w / 2) - 12 - (box / 2)
    local function hasImage(go)
      local found = false
      pcall(function() if go:GetComponent('Image') ~= nil then found = true end end)
      if not found then
        pcall(function()
          if go:GetComponentInChildren(typeof(CS.UnityEngine.UI.Image), true) ~= nil then found = true end
        end)
      end
      return found
    end
    local function dress(boxGo, donor, nm)
      if donor == nil or not __SSL_TB.alive(boxGo) then return end
      if hasImage(boxGo) then return end
      local child = __SSL_TB.findDeep(boxGo.transform, 'SSL_' .. nm)
      if child == nil then
        child = instantiate(donor, boxGo.transform)
        if child == nil then return end
        child.name = 'SSL_' .. nm
        __SSL_TB.renameTree(child)
        made = made + 1
      end
      local brt = boxGo:GetComponent('RectTransform')
      if brt ~= nil then
        brt.anchorMin = Vector2(0.5, 0.5)
        brt.anchorMax = Vector2(0.5, 0.5)
        brt.pivot = Vector2(0.5, 0.5)
        brt.sizeDelta = Vector2(box, box)
        brt.anchoredPosition = Vector2(x, 0)
      end
      local crt = child:GetComponent('RectTransform')
      if crt ~= nil then
        crt.anchorMin = Vector2(0.5, 0.5)
        crt.anchorMax = Vector2(0.5, 0.5)
        crt.pivot = Vector2(0.5, 0.5)
        crt.anchoredPosition = Vector2(0, 0)
      end
    end
    dress(up, __SSL_TB.ddArrowUp, 'ArrowUp')
    dress(dn, __SSL_TB.ddArrowDn, 'ArrowDn')
    -- The plate behind the chevron (equipment prefab: Arrow/imgBg) is optional
    -- decoration; an Image whose cross-bundle sprite failed to resolve draws a
    -- white quad, so hide it rather than show a blank square.
    pcall(function()
      local bg = __SSL_TB.findDeep(__SSL_TB.dd.transform, 'SSL_imgBg')
      if bg == nil then bg = __SSL_TB.findDeep(__SSL_TB.dd.transform, 'imgBg') end
      if bg ~= nil then
        local img = nil
        pcall(function() img = bg:GetComponent('Image') end)
        if img ~= nil then bg:SetActive(img.sprite ~= nil) end
      end
    end)
    return 'arrows=' .. tostring(made)
  end)
  if ok then return res else return 'ERR:' .. tostring(res) end
end
__SSL_TB.playDDSound = function(bOpen)
  pcall(function()
    local s = bOpen and 'ui_common_menu_open' or 'ui_common_menu_close'
    CS.WwiseAudioManager.Instance:PlaySound(s)
  end)
end
__SSL_TB.onDDOpen = function(_, bOpen)
  bOpen = (bOpen == true)
  if bOpen then
    local ours = false
    pcall(function()
      ours = __SSL_TB.alive(__SSL_TB.dd) and __SSL_TB.ddComp(__SSL_TB.dd).IsExpanded == true
    end)
    if ours then
      __SSL_TB.wasOpen = true
      __SSL_TB.setArrows(true)
      __SSL_TB.playDDSound(true)
    end
  else
    if __SSL_TB.wasOpen then
      __SSL_TB.wasOpen = false
      __SSL_TB.setArrows(false)
      __SSL_TB.playDDSound(false)
    end
  end
end
-- One-shot diagnostics: dump the clone subtree (names, active, images) so a
-- missing arrow can be located exactly instead of guessed at.
-- The arrow boxes themselves carry only a RectTransform, so the sprite that
-- actually draws is one level down — report the children too.
__SSL_TB.diagKids = function(go)
  local s = ''
  pcall(function()
    local cn = go.transform.childCount
    s = ' kids=' .. tostring(cn)
    for ci = 0, cn - 1 do
      local cgo = go.transform:GetChild(ci).gameObject
      local img = nil
      pcall(function() img = cgo:GetComponent('Image') end)
      if img ~= nil then
        local sp = (img.sprite ~= nil) and img.sprite.name or 'nosprite'
        s = s .. ' [' .. tostring(cgo.name) .. ' Image<' .. tostring(sp) .. '>]'
      else
        s = s .. ' [' .. tostring(cgo.name) .. ']'
      end
    end
  end)
  return s
end
__SSL_TB.diagDD = function()
  if __SSL_TB.diagDone then return end
  __SSL_TB.diagDone = true
  pcall(function()
    if not __SSL_TB.alive(__SSL_TB.dd) then
      printLog('[SSL] dd-diag: no clone')
      return
    end
    local up, dn = __SSL_TB.arrowRefs()
    pcall(function()
      printLog('[SSL] dd-diag: arrows up=' .. tostring(up) .. ' dn=' .. tostring(dn))
    end)
    local all = __SSL_TB.dd:GetComponentsInChildren(typeof(CS.UnityEngine.Transform), true)
    local n = (all ~= nil) and all.Length or 0
    printLog('[SSL] dd-diag: nodes=' .. tostring(n))
    pcall(function()
      for _, key in ipairs({ 'arrowUp', 'arrowDn' }) do
        local go = __SSL_TB[key]
        if go ~= nil then
          local comps = go:GetComponents(typeof(CS.UnityEngine.Component))
          local names = ''
          if comps ~= nil then
            for ci = 0, comps.Length - 1 do
              local cn = tostring(comps[ci]:GetType().Name)
              if names ~= '' then names = names .. ',' end
              names = names .. cn
            end
          end
          local rt = ''
          pcall(function()
            local r = go:GetComponent('RectTransform')
            if r ~= nil then rt = ' pos=' .. tostring(r.anchoredPosition) .. ' sz=' .. tostring(r.sizeDelta) end
          end)
          printLog('[SSL] dd-diag: ' .. tostring(key) .. ' comps=[' .. names .. ']' .. rt .. ' active=' .. tostring(go.activeSelf) .. __SSL_TB.diagKids(go))
        else
          printLog('[SSL] dd-diag: ' .. tostring(key) .. ' MISSING')
        end
      end
    end)
    local shown = 0
    for i = 0, n - 1 do
      if shown >= 40 then break end
      local t = all[i]
      if t ~= nil and t.gameObject ~= nil then
        local nm = t.gameObject.name
        local act = tostring(t.gameObject.activeSelf)
        local extra = ''
        pcall(function()
          local img = t.gameObject:GetComponent('Image')
          if img ~= nil then
            local sp = (img.sprite ~= nil) and img.sprite.name or 'nosprite'
            extra = ' Image(en=' .. tostring(img.enabled) .. ' sp=' .. tostring(sp) .. ')'
          end
        end)
        pcall(function()
          local dd = t.gameObject:GetComponent('TMP_Dropdown')
          if dd ~= nil then extra = extra .. ' TMP_Dropdown' end
        end)
        printLog('[SSL] dd-diag: ' .. tostring(nm) .. ' active=' .. act .. extra)
        shown = shown + 1
      end
    end
  end)
end
__SSL_TB.subDDEvent = function()
  if __SSL_TB.evSub then return end
  pcall(function()
    EventManager.Add('DropdownOpenState', __SSL_TB, __SSL_TB.onDDOpen)
    __SSL_TB.evSub = true
  end)
end
__SSL_TB.wireRealDD = function(rootTr, tplGo)
  local ok, res = pcall(function()
    local tr = __SSL_TB.loadDDTemplate()
    if tr ~= true then error(tr) end
    local dd
    if __SSL_TB.alive(__SSL_TB.dd) then
      dd = __SSL_TB.dd
    else
      local exist = rootTr:Find('SSL_LevelDropdown')
      if exist ~= nil then
        dd = exist.gameObject
      else
        dd = instantiate(__SSL_TB.ddTpl, rootTr)
        dd.name = 'SSL_LevelDropdown'
      end
    end
    if not __SSL_TB.alive(__SSL_TB.dd) or __SSL_TB.dd ~= dd then
      __SSL_TB.arrowUp = nil
      __SSL_TB.arrowDn = nil
      __SSL_TB.diagDone = false
    end
    __SSL_TB.dd = dd
    __SSL_TB.renameTree(dd)
    -- Float above Dummy: keep the prefab's own size/styling, same anchor space.
    local tRt = tplGo:GetComponent('RectTransform')
    local dRt = __SSL_TB.alive(__SSL_TB.go) and __SSL_TB.go:GetComponent('RectTransform') or nil
    local rt = dd:GetComponent('RectTransform')
    if rt ~= nil and tRt ~= nil and dRt ~= nil then
      rt.anchorMin = tRt.anchorMin
      rt.anchorMax = tRt.anchorMax
      rt.pivot = tRt.pivot
      -- Keep the prefab's own rect: the equipment dropdown's bar (462x72) is
      -- wider than the Dummy button and is centred on the ctrl root, so the
      -- bar hangs symmetrically over the button. Shrinking it would squeeze
      -- the Label (already inset by 184.2 for the arrow) and re-anchor nothing.
      rt.anchoredPosition = Vector2(dRt.anchoredPosition.x, dRt.anchoredPosition.y + (dRt.sizeDelta.y + 10))
    end
    __SSL_TB.fillDD(dd)
    __SSL_TB.flipTemplate(dd)
    __SSL_TB.wireArrows()
    __SSL_TB.setArrows(false)
    __SSL_TB.subDDEvent()
    dd.transform:SetAsLastSibling()
    __SSL_TB.ddMode = 'real'
    return 'real-dd'
  end)
  if ok then return res else return 'ERR:' .. tostring(res) end
end
__SSL_TB.btnOf = function(go)
  local b = nil
  pcall(function() b = go:GetComponent('UIButton') end)
  if b == nil then pcall(function() b = go:GetComponent('Button') end) end
  return b
end
-- Creates/wires the toggle + 5 option clones off the SAME Deploy template.
-- Positions are derived from the Dummy clone's rect (toggle to its left,
-- options stacked upward from it), all in the template's anchor space.
__SSL_TB.wireList = function(rootTr, tplGo)
  local ok, res = pcall(function()
    if tplGo == nil or not __SSL_TB.alive(__SSL_TB.go) then error('no dummy yet') end
    local tRt = tplGo:GetComponent('RectTransform')
    local dRt = __SSL_TB.go:GetComponent('RectTransform')
    if tRt == nil or dRt == nil then error('no rect') end
    local n = #(__SSL_TB.levels or {})
    -- Toggle: narrow clone left of Dummy.
    local tgl, tMade
    if __SSL_TB.alive(__SSL_TB.tgl) then
      tgl = __SSL_TB.tgl
      tMade = false
    else
      local exist = rootTr:Find('SSL_LvlToggle')
      if exist ~= nil then
        tgl = exist.gameObject
        tMade = false
      else
        tgl = instantiate(tplGo, rootTr)
        tgl.name = 'SSL_LvlToggle'
        tMade = true
      end
    end
    __SSL_TB.tgl = tgl
    __SSL_TB.renameTree(tgl)
    local gRt = tgl:GetComponent('RectTransform')
    if gRt ~= nil then
      gRt.anchorMin = tRt.anchorMin
      gRt.anchorMax = tRt.anchorMax
      gRt.pivot = tRt.pivot
      local tw = 64
      gRt.sizeDelta = Vector2(tw, tRt.sizeDelta.y)
      gRt.anchoredPosition = Vector2(dRt.anchoredPosition.x - (dRt.sizeDelta.x / 2) - 10 - (tw / 2), dRt.anchoredPosition.y)
    end
    __SSL_TB.setText(tgl, __SSL_TB.listOpen and '^' or 'v')
    local tb = __SSL_TB.btnOf(tgl)
    if tb == nil then error('no Button on toggle') end
    tb.onClick:RemoveAllListeners()
    tb.onClick:AddListener(function()
      local r = __SSL_TB.toggleList()
      printLog('[SSL] level list: ' .. tostring(r))
    end)
    tgl.transform:SetAsLastSibling()
    -- Options: same size as Dummy, stacked upward above it.
    local h = dRt.sizeDelta.y
    local dx = dRt.anchoredPosition.x
    local dy = dRt.anchoredPosition.y
    for i = 1, n do
      local o
      if __SSL_TB.alive(__SSL_TB.opts[i]) then
        o = __SSL_TB.opts[i]
      else
        local nm = 'SSL_LvlOpt' .. tostring(i)
        local exist = rootTr:Find(nm)
        if exist ~= nil then
          o = exist.gameObject
        else
          o = instantiate(tplGo, rootTr)
          o.name = nm
        end
        __SSL_TB.opts[i] = o
        __SSL_TB.renameTree(o)
        local ob = __SSL_TB.btnOf(o)
        if ob ~= nil then
          local idx = i
          ob.onClick:RemoveAllListeners()
          ob.onClick:AddListener(function()
            local r = __SSL_TB.setSel(idx - 1)
            printLog('[SSL] level pick: ' .. tostring(r))
          end)
        end
      end
      local oRt = o:GetComponent('RectTransform')
      if oRt ~= nil then
        oRt.anchorMin = tRt.anchorMin
        oRt.anchorMax = tRt.anchorMax
        oRt.pivot = tRt.pivot
        oRt.sizeDelta = dRt.sizeDelta
        oRt.anchoredPosition = Vector2(dx, dy + i * (h + 10))
      end
      __SSL_TB.setText(o, __SSL_TB.optText(i))
      o:SetActive(__SSL_TB.listOpen == true)
      o.transform:SetAsLastSibling()
    end
    return 'list:' .. tostring(n) .. 'opts'
  end)
  if ok then return res else return 'ERR:' .. tostring(res) end
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
    pcall(function() __SSL_TB.closeList() end)
    pcall(function() __SSL_TB.closePopup() end)
    if __SSL_TB.alive(__SSL_TB.go) then __SSL_TB.go:SetActive(false) end
    if __SSL_TB.alive(__SSL_TB.tgl) then __SSL_TB.tgl:SetActive(false) end
    if __SSL_TB.alive(__SSL_TB.dd) then __SSL_TB.dd:SetActive(false) end
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
  local listRes = 'nolist'
  if show then
    listRes = __SSL_TB.wireRealDD(tplGo.transform.parent, tplGo)
    if tostring(listRes):sub(1, 3) == 'ERR' then
      -- Bundle load failed (e.g. prefab moved after a game update): fall back
      -- to the same-panel clone stack. Dummy + Shift+Alt preset keep working.
      __SSL_TB.ddMode = 'stack'
      pcall(function() __SSL_TB.closePopup() end)
      if __SSL_TB.alive(__SSL_TB.dd) then __SSL_TB.dd:SetActive(false) end
      listRes = 'real:' .. tostring(listRes) .. ' stack:' .. tostring(__SSL_TB.wireList(tplGo.transform.parent, tplGo))
      if __SSL_TB.alive(__SSL_TB.tgl) then __SSL_TB.tgl:SetActive(true) end
      if __SSL_TB.listOpen then
        for _, o in ipairs(__SSL_TB.opts or {}) do
          if __SSL_TB.alive(o) then o:SetActive(true) end
        end
      end
    else
      -- Real dropdown live: keep the fallback stack hidden.
      pcall(function() __SSL_TB.closeList() end)
      if __SSL_TB.alive(__SSL_TB.tgl) then __SSL_TB.tgl:SetActive(false) end
      for _, o in ipairs(__SSL_TB.opts or {}) do
        if __SSL_TB.alive(o) then o:SetActive(false) end
      end
      if __SSL_TB.alive(__SSL_TB.dd) then __SSL_TB.dd:SetActive(true) end
      pcall(function() __SSL_TB.pollArrows() end)
      pcall(function() __SSL_TB.diagDD() end)
    end
  else
    -- Deploy hidden (no team / other mode / leaving): never leave popups up.
    -- Close the TMP popup BEFORE deactivating or its click-eater orphans.
    pcall(function() __SSL_TB.closePopup() end)
    pcall(function() __SSL_TB.closeList() end)
    if __SSL_TB.alive(__SSL_TB.dd) then __SSL_TB.dd:SetActive(false) end
    if __SSL_TB.alive(__SSL_TB.tgl) then __SSL_TB.tgl:SetActive(false) end
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
local selinfo = tostring((__SSL_TB.levels or {})[(__SSL_TB.sel or 0) + 1] or '?')
return 'OK patched=' .. tostring(__SSL_TB.patched) .. ' wired=' .. tostring(wired) .. ' vis=' .. tostring(vis) .. ' sel=' .. selinfo .. ' onenable=' .. tostring(__SSL_TB.lastCtrl) .. ' settle=' .. tostring(__SSL_SETTLEPATCH)
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
//  Shift+Alt+1..5 only presets the Dummy button target (no entry).
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
    log("[hotkey] Alt+1..5 armed on hwnd=0x%p (998/999/1/12/13 enter; Shift+Alt+1..5 presets Dummy target); use from Blitz lobby, scores won't save", wnd);
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
