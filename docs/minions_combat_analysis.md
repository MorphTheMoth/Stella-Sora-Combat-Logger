# Minion and Summon Behavior

> **Scope.** This document records what is established from the current post-update binary (`decompilation/decompiled.c`), the 1.13 hotfix decompilation, and the hook log. It uses *minion* for the player-owned `SummonType.Minion` case, and *summon* for the broader `MonsterSummonInfo` system. Some summoned monsters are derivatives or other summon types.

## Executive Summary

- A normal monster summon is a `MonsterAdventureActor` with a `MonsterSummonInfo` logic component. The public hotfix spawn wrapper creates an `ActorSpawnInfo`, records the caller as `summoner`, and calls `SpawnMonster` (`decompilation/hotfix/1.13/Hotfix.decompiled.cs:419882-419934`).
- `MonsterSummonInfo.ParseSummonCfg` records the summoner, config, summon type, follow mode, attribute mode, relation, lifetime, and `useSummonHit` (`decompilation/decompiled.c:4311937-4311969`).
- For a player summoner with `summonFollowType == 0`, attribute mode selects live player stats (`1`), the battle-start snapshot (`2`), or config/template stats (`0`/other). `summonFollowType != 0` instead aliases the minion's `actorInfo` and `actorElementInfo` to the summoner (`decompilation/decompiled.c:4312004-4312080`).
- `summonType` is not the stat-copy selector. It is stored for later ownership and classification checks; `IsPlayerMinion` is specifically `IsPlayerSummoned(...) && summonType == Minion` (`decompilation/decompiled.c:3595665-3595679`).
- The snapshot path copies the player's snapshot `AttributeList`, collapses each effective value into the minion entry's `.origin`, scales the special entries 2 and 3 from `BaseValue`, resets the minion to its own HP maximum, copies element type, and scales the snapshot element/damage dictionary (`decompilation/decompiled.c:4116945-4117193`).
- The live path uses the same collapsed `AttributeList` copy, but additionally copies `ActorHealthInfo` from the live player before copying element type and the live element/damage dictionary (`decompilation/decompiled.c:4117202-4117404`).
- Summon lifetime is deterministic. `OnLogicUpdate` subtracts the actor's logic delta time and destroys the summon at zero (`decompilation/decompiled.c:4311858-4311895`).

## Hook Log Result

The observed session produced only:

```text
[MINION] MonsterSummonInfo$$ParseSummonCfg summonAttrType=2 percent=100 time=00:01.698
[MINION] MonsterAdventureActor$$SetPlayerSummonAttrInfoBySnapshot percent=100 player=p:135 time=00:01.698
```

Therefore this session uses `summonAttrType=2`, at 100 percent, and reads the player's initial snapshot. It does not establish that every minion uses this mode; it establishes the mode for the observed summon.

The same log did not show calls to:

- `SetPlayerSummonAttrInfo` (`summonAttrType=1`)
- `FakeAdventureActor.SetAttrInfo` (illusion/decoy path)
- `MonsterCloneAdventureActor.SetAttr` (clone-enemy path)

## What Counts as a Minion

The reliable runtime test is not the monster id or the existence of a skill that looks like a pet. `ActorHelper.IsSummoned` accepts only a `MonsterAdventureActor`, then reads its summon component's stored summoner and summon type (`decompilation/decompiled.c:3595780-3595825`). `ActorHelper.IsPlayerSummoned` further requires that the stored summoner is a `PlayerAdventureActor` (`decompilation/decompiled.c:3595686-3595717`). Finally, `IsPlayerMinion` requires `SummonType.Minion` (`decompilation/decompiled.c:3595665-3595679`).

This distinction matters:

- `SummonType.Minion` is a player minion.
- A player summon with another `SummonType` is still player-summoned, but does not pass `IsPlayerMinion`.
- A monster summoned by a monster is a summon, but not a player summon.
- A `CustomHotFixEntityBase` special process is not a monster summon and does not appear in summon queries. This is the distinction documented for Karin's fish versus Eleanor's drone (`docs/how-to-research-unreleased-characters.md:116-121`).

## Creation and Registration

The 1.13 hotfix wrapper `ILRuntimeAPI.SummonMonster`:

1.  Rejects spawns after the normal monster-clear/battle-end condition, except for tower-defense actors.
2.  Builds `ActorSpawnInfo` with monster id, position, height, rotation, summoner, optional summon-group suffix, immediate callback, and level 1.
3.  Copies `SummonCfg.maxCount` to `spawnInfo.maxCout` when configured.
4.  Calls `AdventureModuleController.SpawnMonster`.
5.  Dispatches `AdventureMonsterSummonerSpawnedEvent` with the spawned actor id, data id, and `component.monsterSummonInfo.SummonActor.Id`.

Source: `decompilation/hotfix/1.13/Hotfix.decompiled.cs:419882-419934`.

The actor's base monster data is loaded before summon configuration is applied. `MonsterAdventureActor.LoadData` initializes the monster data id, template id, movement, search ranges, scale, collider movement values, and other monster defaults (`decompilation/decompiled.c:4114303-4114464`). It later initializes the normal monster components and calls `DoInit` (`decompilation/decompiled.c:4114770-4114829`). Thus summon inheritance is an override/augmentation of an already-created monster actor, not construction of a player actor subclass.

## `SummonCfg` Dispatch

`ParseSummonCfg` first stores:

```c
SummonActor = actorSpawnInfo->summoner;
SummonCfg = cfgData;
SummonType = cfgData->summonType;
UseSummonHit = cfgData->useSummonHit;
summonFollowType = cfgData->summonFollowType;
summonAttrType = cfgData->summonAttrType;
summonRelation = cfgData->summonRelation;
attrPercent = cfgData->attrPercent;
leftTime = cfgData->leftTime;
```

Source: `decompilation/decompiled.c:4311937-4311969`.

The dispatch is:

```c
if (summoner is PlayerAdventureActor && summonFollowType == 0) {
    if (summonAttrType == 1)
        SetPlayerSummonAttrInfo(minion, player, percent);
    else if (summonAttrType == 2)
        SetPlayerSummonAttrInfoBySnapshot(minion, player, percent);
    else
        CalcRougeAttr(minion, templateId, level, percent);
} else if (summoner is PlayerAdventureActor && summonFollowType != 0) {
    minion->actorInfo = summoner->actorInfo;
    minion->actorElementInfo = summoner->actorElementInfo;
} else {
    CalcRougeAttr(minion, templateId, difficultyLevel, percent);
}
```

This is a faithful condensation of `decompilation/decompiled.c:4311971-4312080`.

For monster summoners, the difficulty level starts at 1, can be replaced by the summoner's battle level when `HasBattleLevelUp` and `summonMonsterUseBattleLevelAsDifficultLevel` are true, and can be replaced by the roguelike difficulty for roguelike spawns (`decompilation/decompiled.c:4311983-4312002`). `CalcRougeAttr` calls `SetRoguelikeAttrInfo`, which resolves the monster template and difficulty configuration and initializes health, actor attributes, element information, and toughness (`decompilation/decompiled.c:4311610-4311633`; `4117411-4117501`).

### Config fields

| Field              | Observed effect                                                                            |
|--------------------|--------------------------------------------------------------------------------------------|
| `summonType`       | Stored classification used by `IsSummoned`/`IsPlayerMinion`; not the stat-copy selector.   |
| `summonFollowType` | Selects the player direct-alias branch when nonzero.                                       |
| `summonAttrType`   | Selects live copy (`1`), initial snapshot (`2`), or template/self calculation (`0`/other). |
| `summonRelation`   | `1` sets `IsCoexisted`; this controls death cleanup behavior.                              |
| `attrPercent`      | Converted with `FDP_FromPercent` and used as the inheritance ratio.                        |
| `leftTime`         | Enables lifetime countdown when greater than zero.                                         |
| `useSummonHit`     | Stored as `UseSummonHit`; `IsUseHitFromSummon` returns this stored flag.                   |
| `maxCount`         | Passed to spawn as `maxCout` by the hotfix wrapper when positive.                          |

The `summonRelation` and lifetime assignments are visible at `decompilation/decompiled.c:4312082-4312093`; the `maxCount` bridge is at `decompilation/hotfix/1.13/Hotfix.decompiled.cs:419901-419904`.

## Attribute Representation

The current `AttributeEntry` is 0x20 bytes:

```c
struct AttributeEntry { // 0x20 bytes
    FDP origin;
    FDP baseAmend;
    FDP percentAmend;
    FDP absAmend;
};
```

The effective values are:

```text
baseValue  = origin + baseAmend
amendValue = (origin + baseAmend) * (1 + percentAmend) + absAmend
```

This is directly implemented by `AttributeEntry.get_BaseValue` and `AttributeEntry.get_AmendValue` (`decompilation/decompiled.c:4105795-4105814`; `4105766-4105789`). `FDP` is the game's deterministic fixed-point type.

`AttributeList.CopyOwnerValue` iterates attribute types ATK through the final attribute type (`type < 0x61`), reads `GetAttributeValue(owner, type)`, scales it by `ratio`, and writes only the destination entry's `origin` (`decompilation/decompiled.c:4106260-4106298`). Consequently, inherited stats do not preserve the source's base/percent/absolute amendment split. The effective source value is baked into the minion's `origin`; destination amendments are not populated by this method.

## Snapshot Timing and Contents

`PlayerAdventureActor.SavePlayerAttributeSnapshot` copies the live `attributeList` into `attributeListOfInitialSnapshot` with ratio one. It also creates a real copy of the player's element/damage dictionary in `attributeWithElementOrDamageTypeDictOfInitialSnapshot` (`decompilation/decompiled.c:4320137-4320185`).

The snapshot is therefore not merely a flat array. It contains:

1.  An `AttributeList` whose entries retain the source structure until a minion copies them through `CopyOwnerValue`.
2.  A dictionary keyed by the encoded element/damage attribute key, with `FDP` values.

The snapshot path is battle-start data only if `SavePlayerAttributeSnapshot` is called at battle start. The decompilation proves what is copied, but the call-site timing must be established separately for a particular mode.

## Snapshot Inheritance (`summonAttrType=2`)

`SetPlayerSummonAttrInfoBySnapshot` performs these operations in order:

1.  Rejects a null player.
2.  Computes `ratio = FDP_FromPercent(percent)`.
3.  Calls `AttributeList_CopyOwnerValue(minion.attributeList, player.attributeListOfInitialSnapshot, ratio)`.
4.  Reads the player's live `attributeList` entries 2 and 3 through `BaseValue`, scales them, and overwrites the minion entries 2 and 3 `.origin`. These are special HP/SP-like values and intentionally use `BaseValue`, not the fully amended value.
5.  Sets the minion HP to its own current `hpMax`; it does not copy the player's current HP or shield.
6.  Copies the player's live origin element type.
7.  Clears/creates the minion element/damage dictionary and copies every key from the player's snapshot dictionary multiplied by `ratio`.

Source: `decompilation/decompiled.c:4116945-4117193`.

The use of live entries 2 and 3 inside the snapshot method is important: the general attributes come from `attributeListOfInitialSnapshot`, but those two special values are read from `player->attributeList` at summon time (`decompilation/decompiled.c:4117023-4117082`). This is a verified asymmetry, not an inference.

## Live Inheritance (`summonAttrType=1`)

The live path requires a player actor with non-null `actorInfo`, `actorElementInfo`, `actorHealthInfo`, and `actorShield`. It then:

1.  Computes the same `FDP_FromPercent(percent)` ratio.
2.  Copies the player's live `attributeList` through `CopyOwnerValue`, again collapsing effective values into destination `.origin`.
3.  Copies `ActorHealthInfo` with `ActorHealthInfo_SetOwnerValue`, so this path differs from the snapshot path for health state and max-health handling.
4.  Copies the player's live element type.
5.  Clears/creates the minion dictionary and copies the live player's element/damage dictionary, scaling every value by the ratio.

Source: `decompilation/decompiled.c:4117271-4117404`.

## Follow-Alias Path

When a player summon has `summonFollowType != 0`, `ParseSummonCfg` does not call either player-copy method. It assigns the minion's `actorInfo` and `actorElementInfo` references directly from the summoner (`decompilation/decompiled.c:4312070-4312080`). This is stronger than copying values: later mutations to the shared objects may be visible to both actors. The decompilation does not prove whether every downstream component treats these shared references as immutable, so this should not be generalized into "follow summons always update live" without a mode-specific trace.

## Lifetime, Coexistence, and Destruction

`ParseSummonCfg` stores `leftTime`, sets `IsCoexisted` when `summonRelation == 1`, sets `HaveLeftTime` when the configured time is greater than zero, and clears the destruction guard (`decompilation/decompiled.c:4312082-4312093`).

On each logic update, a timed summon subtracts the actor's deterministic logic delta time. At zero or below it calls `DestroySelf` (`decompilation/decompiled.c:4311858-4311895`). Destruction is idempotent via `_isDestroy`; active actors are sent through a destroy coroutine, while actors outside the active state call `AdventureActor.DestroySelf` (`decompilation/decompiled.c:4311643-4311687`).

The component subscribes to `ADVENTURE_ACTOR_DIED` on activation and removes the listener on deactivation (`decompilation/decompiled.c:4311692-4311743`; `4311814-4311849`). If the tracked summon actor dies and `IsCoexisted` is true, the component calls `DestroySelf` (`decompilation/decompiled.c:4311752-4311808`). This means coexistence affects cleanup after actor death; it is not the same thing as lifetime.

## Ownership, Queries, and Targeting

The hotfix exposes `GetAllSummons` and `GetAllSummonsById`. The former filters the module's `MonsterSummonInfos` to `isPlayerSummons`, resolves each entity id, and returns live `MonsterAdventureActor` instances. The latter filters by monster data id (`decompilation/hotfix/1.13/Hotfix.decompiled.cs:420477-420509`).

The summon component itself is the authoritative link: `IsSummoned` reads the stored summoner and summon type from the monster's update-component storage (`decompilation/decompiled.c:3595780-3595825`). Systems use that link for damage attribution, perk checks, target filtering, and summon-specific events.

Concrete drone AI demonstrates the normal pattern. The drone obtains its player summoner from `MonsterSummonInfo.SummonActor`, registers global damage listeners, and removes them on disable (`decompilation/hotfix/1.13/Hotfix.decompiled.cs:665002-665020`). Its target search first prefers the active player's attack target, then falls back to the monster lock target (`:664982-664992`).

## Damage and Effect Source Behavior

`ActorHelper.IsUseHitFromSummon(entity, out summoner)` first verifies that the entity is player-summoned and then returns the summon component's `UseSummonHit` flag (`decompilation/decompiled.c:3595860-3595891`). This flag is not equivalent to `summonType` or `summonAttrType`.

When a weapon or area effect is created by a summon and this flag is true, downstream caches use the player summoner as the source. `AdventureWeapon.Setup` copies the source attribute list, skill-slot levels, and element/damage dictionary (`docs/damage_flow_analysis.md:221-247`; detailed decompilation at `decompilation/decompiled.c:4767915-4767994`). Area effects use the same source selection and refresh their three caches independently (`docs/damage_flow_analysis.md:249-275`).

This creates two distinct inheritance layers:

- The minion actor's own attributes are initialized by `summonAttrType`.
- A summon hit's weapon/area caches may use the summoner as their source when `useSummonHit` is true.

The source-selection layer can therefore make a summon hit behave as if it uses current summoner data even when the minion actor itself was initialized from an initial snapshot. Do not collapse these two mechanisms into one.

The 1.13 drone is an example of summon-specific behavior layered on top of ordinary monster combat. Its bullet damage tag is `137_DroneBullet`; on a matching hit it adds buff `2011` to the target using the player summoner, and several personal perks add attributes to the drone before hit resolution (`decompilation/hotfix/1.13/Hotfix.decompiled.cs:664994-665064`).

## Events and Accounting

The spawn wrapper dispatches `AdventureMonsterSummonerSpawnedEvent` and carries the summoner id (`decompilation/hotfix/1.13/Hotfix.decompiled.cs:419917-419931`). Combat accounting commonly attributes damage from a player summon back to the player returned by `IsPlayerSummoned`, including direct, DOT, and kill damage (`decompilation/hotfix/1.13/Hotfix.decompiled.cs:52760-52828`).

This is why a logger should record at least:

- spawned monster data id and actor id;
- summoner actor id and player data id;
- `summonType`, `summonFollowType`, `summonAttrType`, `summonRelation`;
- `attrPercent`, `leftTime`, and `useSummonHit`;
- the stat source used and the snapshot-save time;
- whether the attack came from the minion actor, weapon, or area entity.

## Common Misreadings

| Misreading                                          | Correct interpretation                                                             |
|-----------------------------------------------------|------------------------------------------------------------------------------------|
| `summonType=Minion` selects inherited stats         | `summonAttrType` selects stats; `summonType` classifies ownership.                 |
| Snapshot inheritance copies current player HP       | The snapshot path sets the minion's HP to its own `hpMax`.                         |
| Snapshot inheritance is a flat stat array           | It copies an `AttributeList` plus an element/damage dictionary.                    |
| All inherited entries preserve amendments           | `CopyOwnerValue` writes effective values into `.origin`; amendments are collapsed. |
| `useSummonHit` means the minion uses snapshot stats | It controls downstream hit-source selection.                                       |
| A summoned-looking special FX object is a minion    | Confirm `MonsterAdventureActor`, `MonsterSummonInfo`, and `IsPlayerSummoned`.      |
| `leftTime` controls all summon cleanup              | It controls countdown; `summonRelation` separately affects death cleanup.          |

## Pre-Update Difference

Older notes and `old_decompiled.c` describe a different layout and path. The current binary uses `attributeList`, 0x20-byte entries, and a real snapshot element/damage dictionary. The current authoritative locations are the post-update functions cited above. Treat older `specialAttributeList` or five-field-entry descriptions as historical unless a specific old build is being analyzed.

## Open Questions

The repository does not yet establish:

- the exact call timing of `SavePlayerAttributeSnapshot` in every battle mode;
- the numeric enum declarations for all `SummonCfg` fields in the available generated decompilation;
- whether every game mode uses the same `SummonCfg` defaults;
- whether direct aliasing under `summonFollowType != 0` is intentionally mutable or only safe because those objects are treated as immutable;
- the full set of non-monster special entities that are visually presented as summons.

These should be answered with a mode-specific hook trace or a matching data table/decompilation rather than inferred from a single summon.
