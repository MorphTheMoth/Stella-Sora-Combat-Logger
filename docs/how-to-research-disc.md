# How to research a disc

Practical workflow for finding what a disc actually *does*, from the
aggregated datamine descriptions down to the raw tables, the C# disc scripts,
the engine, and the game Lua. Trust only the actual code — descriptions are
not reliable; when they disagree, explain how they disagree. When the research
is done, **do not write a `.md` report per disc** — answer in chat with a
summary in the format shown at the bottom.

## Resources

| # | Resource | What it gives you |
|---|----------|-------------------|
| 1 | `/home/morph/StellaSoraData/disc.json` | Aggregated per-disc description: mainSkill, secondarySkill1/2, supportNote, stats, dupes, EN/CN/JP/KR text with params resolved. Start here. Regenerate with `node disc.js`. Key fields per skill: `id` (group id), `desc`, `descCN`, `effectType` (decoded labels), `effectData` (decoded trigger/target strings), `params`. |
| 2 | `/home/morph/StellaSoraData/EN/bin/*.json` | Raw tables: `Disc.json` (per disc: `MainSkillGroupId`, `SecondarySkillGroupId1/2`, `SubNoteSkillGroupId`, `SkillScript`), `MainSkill.json` / `SecondarySkill.json` (per level: `EffectId` list, `ParamN`), `Effect.json` (trigger + conditions + targets per effect row), `EffectValue.json` (actual numbers), `Buff.json` / `BuffValue.json` (buff metadata / duration+effects), `OnceAdditionalAttribute.json` / `OnceAdditionalAttributeValue.json` (hit-time attribute adds), `DiscExtraAttribute.json` (dupe ATK). |
| 3 | `/home/morph/StellaSoraData/EN/language/en_US/` + `CN/language/zh_CN/` | Raw localized description strings (`MainSkill.<id>.2`, `SecondarySkill.<id>.2`). Compare EN vs CN here to check mistranslation. The `##Ventus Mark#1017#` markup links mark ids. |
| 4 | `decompilation/hotfix/<version>/Hotfix.decompiled.cs` | C# disc scripts: `AIScript.Disc.Disc_<discId>` classes (search `class Disc_<id>`). Only *some* skills are scripted — the rest are data-driven `Effect.json` rows. Also `DiscScriptBase` (line ~452603) for event plumbing. |
| 5 | `decompilation/decompiled.c` | Engine: `ActorEffectManage_OnTriggerElementMark` (TRIGGER_MARK vs ANY_ACTOR_TRIGGER_MARK gating), `BuffEntity_DispatchAddBuffEvent` (`ACTOR_GET_BUFF.from` = applier), `AttributeList_GetInjuredElementValue` / `CalculateNormalDamage` (which attribute bucket a buff modifies), `CommonHelper_GetLevelByLevelType` (level resolution). |
| 6 | `/home/morph/stella sora meter/StellaSoraData Makostar/_Lua/` | Readable decompiled Lua (preferred). Key files: `GameCore/Data/DataClass/DiscData.lua` (`GetSkillEffect`), `utils.lua` (`AddEffect`, `RemoveEffect`), `Game/Adventure/StarTower/StarTowerLevelData.lua` (`ChangeNote` — the disc effect attach). Line numbers differ from raw bytecode — cite logic, not exact lines. |
| 7 | Raw bytecode fallback | `Persistent_Store/Scripts/lua.arcx` (in the install). Format cracked during 214028 research: `\x1aBAR` v102 header (magic, version, flag, originSize, size, entryCount at +0x18), index at 0x18 (entries: XXH64 hash u64 + offset/originSize/size u32s), LZ4 + XOR key `"&^^%#$#_$!@![]<_>?GHBFR_7481SDR_"` (`ArchiveUtil` cctor, decompiled.c:3446232), then XXTEA with key = MD5(bytes FE 01 00 00) (`AC.get___CK`, decompiled.c:3463740). Entry hash = XXH64(lowercase path with `.`→`/` + `".lua"`, seed 0). Decrypt script from the 214028 session, disassemble with `luac5.3 -l`. |
| 8 | `docs/Enums.md`, `StellaSoraData/utils.js` | Enum decodes: `trigger`, `takeEffect` (= condition type), `effectType`, `effectAttributeType`, `elementType`, `skillSlotType`, `levelTypeData`; `TARGET_TYPE` / `CONDITION_TYPE` / `SKILL_SLOT_TYPE` maps in `utils.js`. |

## Step 1 — Resolve the disc

Find the disc in `disc.json` (search by name). Note `id`, star, element
(`EET`: WE=Aqua, FE=Ignis, SE=Terra, AE=Ventus, LE=Lux, DE=Umbra), signature
character, and the three skill group ids.

## Step 2 — Read the aggregated description + params

`disc.json[id].mainSkill / secondarySkill1 / secondarySkill2`. The `effectData`
strings are `disc.js`'s decode of the raw `Effect.json` rows and are usually
correct — but verify against the raw rows, they omit nuance (e.g. they don't
show *who holds* the effect).

## Step 3 — Walk the raw table chain

For each skill group:

1. `MainSkill.json` / `SecondarySkill.json` rows by `GroupId` → per-level
   `EffectId` list + `ParamN` (cross-check against desc params).
2. `Effect.json[<effectId>]` → the logic:
   - `Trigger`: 1 NOTHING (passive), 2 HITTING, 6 CASTSKILL, 32 TRIGGER_MARK,
     41 ANY_ACTOR_TRIGGER_MARK, ... (`docs/Enums.md`).
   - `TriggerTarget`: 1 SELF — for TRIGGER_MARK/CASTSKILL/HITTING this is
     enforced by dispatch: the engine only raises the per-owner trigger event
     when the event source == effect owner (`ActorEffectManage_OnTriggerElementMark`,
     decompiled.c:3438886). With the per-trekker attach (step 5) `SELF`
     triggers union into "any trekker".
   - Conditions: `takeEffect` enum values used as condition ids — 7
     SKILLSLOTTYPE (4 = ultimate), 10 ACTORELEMENTTYPE (4 = AE/Ventus),
     41 SELF_BE_MAINCONTROL, 44 CERTAIN_MARK_ELMENT_TYPE, ...
   - Targets: `TARGET_TYPE` — 1 SELF, 3 FULL_TEAM (no summons), 6
     MAINCONTROL_PLAYER, 9 FULL_TEAM_AND_SUMMONED.
   - `Trigger`/`TakeEffect`/`Target` conditions on Ventus summons pass via
     element inheritance (`elementType INHERIT`).
3. `EffectValue.json[<effectId + level*10 if leveled>]` → `EffectType` 12
   ATTR_FIX (attribute bucket = `EffectTypeFirstSubtype`, value in
   `EffectTypeParam1`), 6 ADDBUFF (`EffectTypeParam1` = buff id), 25 ADD_TAG...
   Attribute bucket decode (`effectAttributeType`):
   - `56 NORMALDMG / 57 SKILLDMG / 58 ULTRADMG` = Auto Attack / Skill / Ultimate DMG (base)
   - `11-16 WER..DER` element rate, `17-22 WEE..DEE` element DMG dealt
     (`20 AEE` = "Ventus DMG" in every disc description),
   - `35-40 WEERCD..DEERCD` element damage **taken** (`38 AEERCD` = "the Ventus
     DMG the target takes" — verified: `AttributeList.GetInjuredElementValue(AE)`
     → `AEERCD`, decompiled.c:4106793, read from the defender in
     `CalculateNormalDamage`).
4. `Buff.json` / `BuffValue.json[<buffId>]` → duration `Time` in units of
   1/10000 s (40000 = 4 s), `LaminatedNum` stacking, `ReplaceType/Mode`
   (refresh on reapply), `Effects` (empty = marker buff only), `BuffTag1`
   (hash tags — `CommonDefine.Wind` = hash("Wind") = -719983267).
5. Hit-time attributes: `OnceAdditionalAttribute.json` (levelTypeData 6 =
   DiscSkill → level via `GetDiscSkillLevel`) →
   `OnceAdditionalAttributeValue.json` (`AttributeType1` + `Value1`, percent =
   value/100).

## Step 4 — Read the C# disc script

`grep "class Disc_<id>" decompilation/hotfix/1.15/Hotfix.decompiled.cs`.
Only some secondary skills are scripted (the rest are pure data rows — a
skill with no `EffectId` in `SecondarySkill.json` is scripted). Known
`DiscScriptBase` virtuals and their *actual* semantics (names are misleading):

- `OnPlayerActorDamaged(from, monster, evt)` — fires when a player actor
  **deals** damage to a monster (`DiscScriptBase.OnReceiveDamage` routes
  `ADVENTURE_ACTOR_RECEIVE_DAMAGE` with `from` player / `to` monster), for
  **any** trekker, not just the disc owner.
- `OnMainPlayerActorDamaged` — same, but only for the disc owner
  (`_actor` = active main control).
- `OnBeforePlayerActorHit` / `OnBeforeHit` — before a hit resolves.
- `OnMainPlayerActorCastSkill` — main control casts; slot via
  `castSkillEvent.skillEventInfo.skillSlotType`.
- `OnElementMarkTrigger` — mark trigger event.
- Script-local listeners: `AddEventListener("ACTOR_GET_BUFF", ...)` etc.
  (`ACTOR_GET_BUFF.from` = the buff **applier**, decompiled.c:4734759).

Watch for missing checks vs the desc: element checks
(`actorElementInfo.elementType == AE`), main-control checks, `isAssist`,
ICDs, per-target dictionaries. Common desc-vs-code gaps found so far: hit
counters pooled across the whole team (214028 Swaying Petals), triggers on
buff application instead of marks (214024 Team Spirit), CASTSKILL instead of
"deals X DMG" (214028 Fragrant Illusion).

## Step 5 — Establish who holds the effects

Data-driven disc effects are attached to **every team member**, each
evaluating its own SELF conditions (this is what makes `TriggerTarget SELF`
rows behave as "any trekker"). Verified in
`StarTowerLevelData.lua:ChangeNote()`:

```lua
local tbDiscEft = mapDiscData:GetSkillEffect(self._mapNote)
for _, mapEft in ipairs(tbDiscEft) do
    for _, nCharId in ipairs(self.tbTeam) do
        UTILS.AddEffect(nCharId, mapEft[1], mapEft[2], nEftUseCount)
```

`DiscData:GetSkillEffect` (DiscData.lua:405) = main skill `EffectId`s + the
highest *active* tier per secondary group. `UTILS.AddEffect` (utils.lua:1619)
resolves `id + level*10` for leveled rows and calls
`CS.AdventureModuleHelper.SetActorEffect(nCharId, nEffectId, remainTimes, 0)`.
The same helper serves the non-roguelike modes (utils.lua:1607-1692 effect
assembly); the exact per-mode caller chain may still need tracing — say so
when it's inferred rather than verified.

## Step 6 — Mistranslation check (EN vs CN)

Compare the raw language rows, not the aggregated JSON
(`EN/language/en_US/MainSkill.json "MainSkill.<row>.2"` and
`SecondarySkill.<row>.2` vs `CN/language/zh_CN/...`). So far every checked disc
(214028, 214024) has a faithful EN translation — the real discrepancies are
desc-vs-code and exist in all languages.

## Step 7 — Verify engine claims when the meaning of a number matters

- Attribute bucket semantics → `decompiled.c` (`GetInjuredElementValue`,
  `GetHarmElementValue`, `CalculateNormalDamage` reading defender/attacker lists).
- Event semantics → find the dispatcher (`BuffEntity_DispatchAddBuffEvent`,
  `ActorEffectManage_On*`) and check what `from`/`sender` actually are.
- Duration units → `BuffValue.Time` / 10000 s.
- Mark ids → the `##Ventus Mark#1017#` links in language files.

## Output format

Do **not** write a per-disc `.md`. Answer in chat with:

1. **How it works** — per skill: trigger, conditions, target, values, durations,
   with `file.json["id"]` / `decompiled.c:line` citations and short quoted
   snippets.
2. **Description accuracy** — per part: ✓ or the exact desc-vs-code mismatch.
3. **Mistranslation?** — EN vs CN verdict from the raw language rows.
4. **Quick reference table** for the logger (buff ids, values, durations, triggers).
