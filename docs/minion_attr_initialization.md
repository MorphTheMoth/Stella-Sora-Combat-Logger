# Minion/Summon Attribute Initialization

> **Update note (2026-08-01):** verified against the post-update binary
> (`decompiled.c`, RVAs from `out_new/script.json`). The stat store moved from
> `specialAttributeList` to `attributeList`, and the player snapshot now saves
> **two** structures (flat `AttributeList` + element/damage-type dict). The
> snapshot path still collapses values into `.origin`.

## Hook Log Results

From `sanity_log.txt`, only two functions fire for this session's minions:

```
[MINION] MonsterSummonInfo$$ParseSummonCfg summonAttrType=2 percent=100 time=00:01.698
[MINION] MonsterAdventureActor$$SetPlayerSummonAttrInfoBySnapshot percent=100 player=p:135 time=00:01.698
```

- **summonAttrType=2** — snapshot-based copy (not percent-based)
- **summonAttrType=1** (percent-based, `SetPlayerSummonAttrInfo`) — **never called**
- **`FakeAdventureActor$$SetAttrInfo`** — **never called** (used for illusions/decoys, not minions)
- **`MonsterCloneAdventureActor$$SetAttr`** — **never called** (used for clone enemies, not player minions)

## The two stat-copy paths

### `SetPlayerSummonAttrInfoBySnapshot` (summonAttrType=2) — the one used here

```
decompiled.c line 4116945
RVA: 0x137B6B0
```

Source: `player->attributeListOfInitialSnapshot` (an `AttributeList`),
captured by `PlayerAdventureActor::SavePlayerAttributeSnapshot`.

```c
// ratio = percent/100 (FDP_FromPercent(percent))
ratio = FDP_FromPercent(percent);

// Copy collapsed values into the minion's attributeList entries[type].origin
AttributeList_CopyOwnerValue(minion->attributeList,
    player->attributeListOfInitialSnapshot, ratio);
//   → for type in 1..0x60: minion->entries[type].origin = GetAttributeValue(snapshot, type) * ratio
//     GetAttributeValue = (origin + baseAmend) * (1 + percentAmend) + absAmend

// Special-case entries 2 and 3 (HP/SP-ish): set origin from BaseValue
// (BaseValue = origin + baseAmend), scaled:
minion->entries[2].origin = (int)  BaseValue(player->entries[2]) * ratio;
minion->entries[3].origin = (long) BaseValue(player->entries[3]) * ratio;
ActorHealthInfo_set_hp(healthInfo, ActorHealthInfo_get_hpMax(healthInfo));

// Element type from the player:
MonsterAdventureActor_SetElementType(minion, player->actorElementInfo->_originElementType, ...);

// NEW: also copy the element/damage-type dict (values scaled by ratio):
//   minion->actorInfo->attributeWithElementOrDamageTypeDict
//     ← player->attributeWithElementOrDamageTypeDictOfInitialSnapshot (each value * ratio)
```

### `SetPlayerSummonAttrInfo` (summonAttrType=1) — not used in your session

```
decompiled.c line 4117202
RVA: 0x137BB80
```

Identical structure, but the source is the player's **live** `attributeList`
instead of the initial snapshot:

```c
AttributeList_CopyOwnerValue(minion->attributeList, player->attributeList, ratio);
// + copies player->actorHealthInfo (scaled) and
//   player->actorInfo->attributeWithElementOrDamageTypeDict → minion dict (scaled)
```

Both paths now collapse into `.origin` — the difference is only the **source**
(live vs battle-start snapshot). (In the pre-update build, type 2 read a flat
`double` array and wrote `specialAttributeList` entries; type 1 preserved the
base/pct split. That split behavior no longer exists.)

## AttributeEntry structure

Each entry in an `AttributeList.entries` array is **0x20 (32) bytes**:

```c
struct AttributeEntry {   // 0x20 = 32 bytes
    FDP origin;          // +0x00 — base stat
    FDP baseAmend;       // +0x08 — flat bonus (parameterType 1)
    FDP percentAmend;    // +0x10 — percent bonus (parameterType 2)
    FDP absAmend;        // +0x18 — absolute bonus (parameterType 3)
};
```

The logger's `Hook_SavePlayerSnapshot` reads `entries + t*0x20 + {0x00, 0x08,
0x10}` (origin / baseAmend / percentAmend, all `FDP` = int64 fixed-point,
scale 2^24) — this matches the current layout. (Pre-update entries were 0x28
with a 5th `limitedPercentAmend` field.)

## The `ParseSummonCfg` dispatcher

`MonsterSummonInfo__ParseSummonCfg` (decompiled.c line 4311905) reads
`cfgData->summonFollowType` (decompiled.c 4311965, gate) and
`cfgData->summonAttrType` (decompiled.c 4311966, selector) and routes (only
when the summoner is a `PlayerAdventureActor`):

```c
// NOTE: the branch gate is summonFollowType (tested at decompiled.c 4312010),
// NOT summonType. summonType (None/Minion/Derivative) is only copied into
// _SummonType_k__BackingField (decompiled.c 4311963) and consumed later by AI
// targeting (IsSummoned/CheckTargetType); it plays no role in stat copying.
if (summoner is PlayerAdventureActor && summonFollowType == 0) {
    if (summonAttrType == 1) {
        SetPlayerSummonAttrInfo(minion, player, percent);       // live attributeList
    } else if (summonAttrType == 2) {
        SetPlayerSummonAttrInfoBySnapshot(minion, player, percent); // initial snapshot
    } else { // summonAttrType == 0 (Self)
        CalcRougeAttr(minion, attrTempleteID, level, percent);  // config-based, level-scaled
    }
} else if (summoner is PlayerAdventureActor && summonFollowType != 0) {
    // Directly borrow the summoner's actorInfo + actorElementInfo
} else {
    CalcRougeAttr(minion, attrTempleteID, levelDifficultLv, percent); // monster summoner
}
```

(Monster summoners additionally check `summonMonsterUseBattleLevelAsDifficultLevel`
and roguelike difficulty for `CalcRougeAttr`.)

## `PlayerAdventureActor` initial snapshot

```
decompiled.c line 4320137
RVA: 0x14A9B80
```

`SavePlayerAttributeSnapshot` saves **two** structures:

```c
// 1. Flat stat list (AttributeList, full entry structure scaled by ratio 1.0)
AttributeList_CopyOwnerValue(attributeListOfInitialSnapshot, player->attributeList, One);

// 2. NEW: element/damage-type dict (a real Dictionary<int, FDP> copy)
attributeWithElementOrDamageTypeDictOfInitialSnapshot
    = new Dictionary<int,FDP>(player->actorInfo->attributeWithElementOrDamageTypeDict);
```

So `summonAttrType=2` minions get the player's **snapshot-time** stats
(battle start) in both the flat list AND the element/damage dict.

## Summary

| Aspect | Path used (summonAttrType=2) | Path not used (summonAttrType=1) |
|---|---|---|
| Source data | `attributeListOfInitialSnapshot` (snapshot at battle start) | Live `attributeList` |
| Data type | `AttributeList` — `AttributeEntry` array (origin/base/pct/abs per type) | Same `AttributeList` |
| Value preservation | **Collapsed into `.origin`** — base × (1 + pct%) + abs baked into one FDP | Same collapse |
| Element/damage dict | `attributeWithElementOrDamageTypeDictOfInitialSnapshot` → minion `actorInfo` dict (scaled) | Live `actorInfo` dict → minion dict (scaled) |
| Functions | `SetPlayerSummonAttrInfoBySnapshot` (RVA `0x137B6B0`) | `SetPlayerSummonAttrInfo` (RVA `0x137BB80`) |
