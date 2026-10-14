// =============================================================================
//  arenafix.cpp — Menace Arena (InfinityTower) open-day bypass
// =============================================================================
// The timegate is purely client-side: PlayerInfinityTowerData:CheckOpenDay
// (PlayerInfinityTowerData.lua:500) reads the InfinityTower.OpenDay table and
// the server weekday, and every menu gate funnels through it:
//   * InfinityTowerSelectTowerItem:InitTowerMsg (:34) — tower-list dimming +
//     reopen countdown
//   * InfinityTowerLvList:ShowLvInfo (:500) — Deploy button vs "not open" label
//   * InfinityTowerLvList:OnClickGo (:563) — "RegionBoss_Unlock_OpenDay" block
//   * InfinityTowerBattleResultCtrl:CheckCanGo (:258) — again/next-floor block
// The formation screen itself (RegionBossFormationCtrl:OpenInfinityTower →
// EnterITApplyReq → SendEnterITApplyReq, 4504 apply_req) never checks the day,
// so forcing CheckOpenDay to true unlocks the whole menu chain with one
// override. Same class-table patch mechanism as kScoreBossSettlePatch in
// dummy.cpp (PlayerData.InfinityTower is an instance of the required class,
// so the live object picks the override up via its metatable).
// NOTE: if the server also validates the open day on 4504 apply_req, entry
// will still be rejected there (4506) — the menu will look open but the fight
// won't start. In that case a server-free direct entry (EnterInfinityTower,
// same pattern as the ScoreBoss dummy entry) would be needed instead.
// No top-level return: this chunk is concatenated in front of other chunks.

#include "arenafix.h"

static const char* kInfinityTowerOpenPatch = R"ssl(
if __SSL_ITOPEN == nil then
  local okp = pcall(function()
    local cls = require('GameCore.Data.DataClass.PlayerInfinityTowerData')
    if cls == nil then return end
    if type(cls.CheckOpenDay) == 'function' then
      cls.CheckOpenDay = function(self, index) return true end
    end
  end)
  if okp then __SSL_ITOPEN = true end
end
)ssl";

const char* InfinityTowerOpenPatch() {
    return kInfinityTowerOpenPatch;
}
