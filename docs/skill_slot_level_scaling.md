# Skill-slot level scaling — how effects/hits pick the "Main" vs "Support" skill level

Written after investigating Tilia's effects `10795002` / `10793005` both being
controlled by the Main Skill level in the Log Viewer for saved logs without a
record log.

## TL;DR

Both the main skill and the support skill share ONE level slot in combat:
`ActionKey.B` ("skill slot 1"). Which skill that slot holds depends on how the
character is deployed — `SkillId` (main skill) when the character is the
on-stage main (slot 1), `AssistSkillId` (support skill) when it is a support
(slot 2/3). Any effect or hit with `levelTypeData = 3` (SkillSlot) and
`LevelData = 2` therefore scales with the **main** skill level while its owner
is main-deployed, and with the **support** skill level while its owner is
support-deployed. The `MainOrSupport` field on the config only says which
skill the effect was authored under — combat ignores it; the Lua UI uses it
purely for display.

## The shared B slot

Character table (`StellaSoraData/EN/bin/Character.json`, char 107 Tilia):

- `SkillId: 10731000` — main skill (used when Tilia is in slot 1)
- `AssistSkillId: 10732000` — support skill (used when Tilia is in slot 2/3)

Skill binding at battle setup, `PlayerAdventureActor_SetSkillBind`
(`decompiled.c:4320783`):

- `isAssist == false` (main): `B ← SkillId` (10731000), `C ← SpecialSkillId`
- `isAssist == true` (support): `B ← AssistSkillId` (10732000), no C binding

So for a support-deployed Tilia, slot B **is** her support skill.

The level the player buys per skill comes from Lua
(`StellaSoraData Makostar/_Lua/GameCore/Data/DataClass/PlayerCharData.lua`):

- `GetSkillIds` (line 296): `[NormalAtkId, SkillId, AssistSkillId, UltimateId]`
  — index 2 = main skill level, index 3 = support skill level, upgraded
  independently (`tbSkillLvs[2]` vs `tbSkillLvs[3]`).
- `CalCharacterAttrBattle` (line 1704) strips the unused one before passing
  `SkillLevel` into the engine:
  ```lua
  local tbSkillLevel = self:GetCharSkillAddedLevel(nCharId)
  if bMainChar == true then
      table.remove(tbSkillLevel, 3)   -- main char: drop support lv
  else
      table.remove(tbSkillLevel, 2)   -- support char: drop main lv
  end
  ```
- `PlayerAdventureActor_LoadData` (`decompiled.c:4317962`) then binds the
  surviving array: `SkillLevel[0] → ActionKey.Normal`, `[1] → ActionKey.B`,
  `[2] → ActionKey.D` (C is never bound).

## How a config resolves its level

Effects (`Effect.json` rows = `ScriptParameter`, id/`levelTypeData`/`LevelData`
/`MainOrSupport`):

- `CommonHelper_GetScriptValue` (`Hotfix.decompiled.cs:429037` →
  `CommonHelper_GetValueConfigIdByLevelType`, `decompiled.c:3616319`):
  `level = CommonHelper_GetLevelByLevelType(actorDataId, levelTypeData,
  ownerSkillCd, LevelData)`, and the value id is `mainConfigId + level*10`.
- `GetLevelByLevelType` (`decompiled.c:3615154`): `SkillSlot` (3) →
  `PlayerSkillCd_GetSkillLevel(skillCd, LevelData)` — LevelData is an
  `ActionKey` (`il2cppDumper_out/dump.cs:142467`: A=1 dodge, **B=2 技能1**,
  C=3 技能2, D=4 大招, Normal=5 普攻). MainOrSupport is **not passed** — combat
  ignores it.
- The resolution happens ONCE at effect creation with the origin actor's skill
  dict (`ActorEffectManage_AddEffect`, `decompiled.c:3433232`); copies carry
  the resolved id.

Hits (`HitDamage.json`): same rule via
`AdventureActor_GetBothAllInfo` (`decompiled.c:3852930`):
`skillLevelTemp = PlayerSkillCd_GetSkillLevel(fromActor's PlayerSkillCd,
hitDamage.levelData_)` (weapon/area hits use their bound
`SkillSlotLevelInfo`). `HitDamage.MainOrSupport` is likewise unused in
combat. For `levelTypeData` 1/2/3 the game does `level-1` before indexing the
per-level arrays (`decompiled.c:3853176`); the DLL logs
`skillLevel + 1` (`logging.cpp:1157`), so logged `skillLevel` = the display
level and `sp[skillLevel-1]` reproduces the game's pick.

## Tilia's two effects

`StellaSoraData/EN/bin/Skill.json`:

- Main skill `10731000` (`SkillScript_Zhukong_Skill`): `Param3/4 =
  "Effect,LevelUp,10793005,…"`
- Support skill `10732000` (`SkillScript_Zhiyuan_Skill`): `Param3/4 =
  "Effect,LevelUp,10795002,…"`

`Effect.json`:

```json
10793005: { "levelTypeData": 3, "LevelData": 2, "MainOrSupport": 1 }   // MAINCONTROL
10795002: { "levelTypeData": 3, "LevelData": 2, "MainOrSupport": 2 }   // SUPPORT
```

Both scale with slot B of the owner:

- Tilia main-deployed → B = main skill → `10793005` follows the main skill.
- Tilia support-deployed → B = support skill → BOTH `10795002` (authored
  under the support skill) **and** `10793005` (authored under the main skill
  but resolved from the support actor) follow the **support** skill.

Ground truth from a real Tilia-as-support log
(`saved logs/1min30 shia firefly tilia.txt`): her support-skill hit
`107320001` logged `skillLevel = 11`, and both effects were resolved at

- `10795002 → valueConfigId 10795112` = 10795002 + 11×10 (EffectValue 0.56)
- `10793005 → valueConfigId 10793115` = 10793005 + 11×10 (EffectValue 0.45)

i.e. the main-skill-authored effect took the support skill's level.

The Lua UI disambiguates the display by MainOrSupport instead of role
(`PlayerCharData.lua:1596`, `QueryLevelInfo`): `LevelData == 2 →
MainOrSupport == SUPPORT ? tbSkillLevel[3] : tbSkillLevel[2]` — so the game's
own tooltips always show SUPPORT-authored effects against the support skill
level, even for a main-deployed character (where combat would use the main
skill). The viewer follows combat, not the tooltip.

## What the Log Viewer got wrong (fixed)

1. **Effects pinned to the main skill without a record log.**
   `dcSkillSlotFor(levelData=2, mainOrSupport=null, roleSlot=null)` fell back
   to slot 2 (Main Skill) when no Origin record exists
   (`dmgCalc.calc.js` `dcGetLevelOverride`). Fixed by
   - `effectMainOrSupport` (tableResolver, from `Effect.json`): SUPPORT-
     authored configs always ride the support-skill row (they only ever run
     on a support-deployed owner);
   - `dcInferredRole`: when there is no record log, the owner's deployment
     role is inferred from the log's own evidence — a Skill Cast / hit
     `skillId` equal to the char's `skill.id` proves MAIN, `supportSkill.id`
     proves SUPPORT (`skillRoleOwner`, built from the served
     `character.json`; boot binding `PlayerAdventureActor_SetSkillBind`).
     Last evidence wins (multi-battle logs).

2. **Hits not rescaling for saved logs.** Old saved logs' shared
   `saved logs/levelMap.txt` predates the DLL's hit-ladder capture
   (`WriteHitDamageLevelMapEntry`, added 2026-09-10), so
   `resolveHitLevelMap` missed and `calcHitFields` kept the logged
   multiplier. Fixed with a datamine fallback: `hitLadderFallback` built from
   the served `HitDamage.json` (`SkillPercentAmend` etc. are the same
   per-level arrays the DLL captures live). Note: levelMap entries are
   version-accurate for their log; the datamine fallback reflects the
   current tables.

3. **Effect level metadata missing.** `resolveLevelMap` now falls back to
   `effectLevelMetaFallback` (`Effect.json` / `OnceAdditionalAttribute.json`
   `levelTypeData`/`LevelData`) when the levelMap has no entry, and
   `dcRebuildSkillLevels` seeds `dcSkillScaled` from it.

4. **Legacy effect rows (pre-valueConfigId DLL format).** Old logs serialize
   effects as `{configId, config:{levelType, levelData}, damage, owner}` with
   no `valueConfigId`/value. Since the game resolved the value id once at
   creation (`configId + level*10`), the id is reproducible from the owning
   slot's logged level: `dcResolveLegacyEffectRow` rebuilds it (e.g. Tilia
   support lv 10 → `10795002 + 100 = 10795102`, value 0.53) so the row shows
   a value and is level-controllable/disableable again.
