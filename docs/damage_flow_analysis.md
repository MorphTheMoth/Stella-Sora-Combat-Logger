# Starward Damage Flow Analysis

How effects, attributes, and snapshots work for actor / weapon / area hits.

> **Update note (2026-08-01):** verified against the post-update binary
> (`decompiled.c` from the Il2CppInspectorRedux/Ghidra pipeline, RVAs from
> `out_new/script.json`). The attribute **store moved from
> `specialAttributeList` to `attributeList`**, the element/damage-type dict
> moved from `ActorElementInfo.attributeList` to
> `ActorInfo.attributeWithElementOrDamageTypeDict`, and `AreaEffectEntity`
> now copies battle data from `_owner` (not `_fxPlayer`). All line numbers /
> RVAs below are for the new binary.

---

## 1. Effect Lifecycle

### Init (`AdventureEffect::OnInit`)

```
decompiled.c line 3635030
```

Sets fields (config, valueConfig, owner, sourceType, id, CD). Then checks `trigger_`:

- **`trigger_ == 1`** (immediate / no-trigger-condition): calls `PreExecute` → `Execute` synchronously within `OnInit`. Modifications apply immediately.
- **any other `trigger_`** (event-driven: BEHIT, CRIT, CASTSKILL, CERTAIN_TIME_INTERVAL, …): does nothing. Effect sits idle in the dict, waits for the event/time trigger later.

### Execute (`AdventureEffect::Execute`)

```
decompiled.c line 3634414
```

Handles cooldown, dispatches an `AdventureActorEffectExecute` event, then:

```c
// Push onto stack, then call virtual methods on the effect base:
System_Collections_Generic_Stack<object>__Push(__this->_effectStack, eff);
eff->InitParams();       // vtable 0x1b8
eff->AddListenerer();    // vtable 0x1a8
eff->Execute();          // vtable 0x1a0 ← applies attribute changes
```

### PostExecute (`AdventureEffect::PostExecute`)

```
decompiled.c line 3635139
```

Pops the effect base from `_effectStack`, calls `RemoveListener` and `PostExecute`:

```c
System_Collections_Generic_Stack<object>__TryPop(_effectStack, &base);
// calls cleanup virtuals on the popped base:
base->RemoveListenerer(); // vtable ~0x198
base->EndEffect();        // vtable ~0x1a8
base->PostExecute();      // vtable ~0x1c8 ← reverses attribute changes
```

### Clear (`AdventureEffect::Clear`)

```
decompiled.c line 3632860
```

Pops all remaining items from `_effectStack`, calls cleanup on each, stops CD coroutine, clears `_impactActors`.

### Stack as execution tracker

- **Push** → Execute → modifications applied
- **Pop** → PostExecute/Clear → modifications reversed

`_effectStack->fields._size > 0` means the effect has **active modifications** on the `AttributeList` right now.

---

## 2. Fix-Type Effects (`BaseAttriFix`)

### Execute → Process

```
decompiled.c line 3636734 (Execute), line 3637281 (Process)
```

Builds `_targets` list based on config, then for each target:

```c
BaseAttriFix__Process(__this, actor, value, post=false, method);
```

`Process` (when `post=false`) modifies the target's **`attributeList`** (in the
old build this was `specialAttributeList`):

```c
// decompiled.c line ~3637312
__this_00 = (actor->fields).attributeList;
AttributeList__ChangeValue(__this_00,
    effectTypeFirstSubtype_,   // attribute type (e.g. 1 = ATK)
    effectTypeSecondSubtype_,  // parameter type (1=base, 2=pct, 3=abs)
    val, method);
```

### PostExecute — reverses changes

```c
// decompiled.c line 3637237
AttributeList__ChangeValue(entity->attributeList,
    effectTypeFirstSubtype_,
    effectTypeSecondSubtype_,
    negatedValue,
    method);
```

### `AttributeList::ChangeValue` internals

Each `AttributeEntry` is **0x20 (32) bytes**, with fields at offsets:

| Offset | Field | Modified by |
|--------|-------|-------------|
| `+0x00` | `origin` (base stat) | never |
| `+0x08` | `baseAmend` | `secondSubType == 1` (BASE_VALUE) — `+= val` |
| `+0x10` | `percentAmend` | `secondSubType == 2` (PERCENTAGE) — `+= val` |
| `+0x18` | `absAmend` | `secondSubType == 3` (ABSOLUTE_VALUE) — `+= val` |

(`AttributeEntry_ChangeValue`, decompiled.c line 4105627.)

The **collapsed** value used for damage is
`GetAttributeValue(type)` (decompiled.c line 4106539):

```
(origin + baseAmend) * (1 + percentAmend) + absAmend
   → overridden by assignmentValueDict[type] if present
   → clamped by per-type AttributeList_Limit
```

---

## 3. How `fromAdditionalAttrInfo` gets populated

### Actor hits (`damageTypeTemp == 1`)

```
decompiled.c line 3852999, GetBothAllInfo case default
```

```c
pAVar6 = static_fields->fromActorTemp;
pAVar8 = (pAVar6->fields).actorInfo;
ActorAdditionalAttrInfo__AddFrom(
    fromAdditionalAttrInfo,
    pAVar6->attributeList,                       // ← LIVE read every hit
    pAVar8->attributeWithElementOrDamageTypeDict,// element/damage type dict
    method);
```

Reads the attacker's **live** `attributeList` on every hit. `BaseAttriFix`
changes are immediately visible. (Old build: `specialAttributeList` +
`actorElementInfo->attributeList`.)

### Weapon hits (`damageTypeTemp == 2`)

```
decompiled.c line ~3853053, GetBothAllInfo case 2
```

```c
pAVar4 = static_fields->fromWeaponTemp;
ActorAdditionalAttrInfo__AddFrom(
    fromAdditionalAttrInfo,
    pAVar4->attributeList,                        // ← CACHED copy
    pAVar4->attributeWithElementOrDamageTypeDict, // ← CACHED copy
    method);
```

Reads from the WEAPON's cached copies — NOT from the actor's live
`attributeList`. The weapon's `attributeList` / dict were populated at
`Setup` time.

### Area hits (`damageTypeTemp == 5`)

```
decompiled.c line ~3853086, GetBothAllInfo case 5
```

```c
pAVar5 = static_fields->fromAreaTemp;
ActorAdditionalAttrInfo__AddFrom(
    fromAdditionalAttrInfo,
    pAVar5->attributeList,                        // ← CACHED copy
    pAVar5->attributeWithElementOrDamageTypeDict, // ← CACHED copy
    method);
```

Same pattern as weapon: reads from the AREA's cached copies, populated at
`CopyBattleData` time.

### Defender (`toAdditionalAttrInfo`)

```
decompiled.c line ~3853272
```

```c
ActorAdditionalAttrInfo__AddFrom(
    toAdditionalAttrInfo,
    __this->attributeList,                       // defender live
    __this->actorInfo->attributeWithElementOrDamageTypeDict,
    method);
```

`AddFrom` (decompiled.c line 3421999) merges `list` into
`this->_attributeList_k__BackingField` (`AttributeList_AddValueFrom`) and then
copies every key of the dict into `this->attributeWithElementOrDamageTypeDict`
(key format: `CommonHelper_ConvertAttributeTypeAndElementOrDamageTypeToKey`).

---

## 4. How the weapon / area caches get populated

### `AdventureWeapon::Setup`

```
decompiled.c line 4767802
RVA: 0x1727CC0
```

Called when the weapon spawns/activates. Takes `(weapon, owner, ...)`.

Resolves the stat source with `ActorHelper_IsUseHitFromSummon(owner)` → the
summoner when the owner is a minion, then copies:

```c
// 1. attributeList ← source->attributeList
AttributeList__CopyValueFrom(weapon->attributeList, from, method);

// 2. Skill slot levels → bindSkillSlotLevelInfo
PlayerSkillCd_o* skillCd = LogicEntity__GetLogicComponent<PlayerSkillCd>(owner);
SkillSlotLevelInfo__CopyValueFrom(weapon->bindSkillSlotLevelInfo, skillCd, method);
//    (re-done from the summoner when IsPlayerSummoned(owner))

// 3. Element/damage dict ← source->actorInfo->attributeWithElementOrDamageTypeDict
//    (clears weapon dict, then Add() every key/value)
```

(Old build: copied `owner->specialAttributeList` → `attributeWithElementOrDamageTypeDict`,
`PlayerSkillCd` → `attributeList`, and the element dict → `_DefaultWeaponTag_k__BackingField`.)

### `AreaEffectEntity::CopyBattleData`

```
decompiled.c line 4669674
RVA: 0x16AADA0
```

Three independently gated copies (each runs on `force` or its own dirty flag,
set by `OnAttributeListChange` / `OnAttributeWithElementOrDamageTypeChange` /
`OnSkillSlotLevelInfoChange` events from the owner):

```c
// 1. _attributeListHasChanged || force
AttributeList__CopyValueFrom(area->attributeList, source->attributeList);
//    source = IsUseHitFromSummon(owner) ? summoner : owner

// 2. _attributeWithElementOrDamageTypeHasChanged || force
AreaEffectEntity_CopyAttributeWithElementOrDamageType(area);
//    clears area dict, copies source->actorInfo->attributeWithElementOrDamageTypeDict

// 3. _SkillSlotLevelInfoHasChanged || force
SkillSlotLevelInfo__CopyValueFrom(area->bindSkillSlotLevelInfo, source->PlayerSkillCd);
```

**Important:** the source is `_owner_k__BackingField` — NOT `_fxPlayer_k__BackingField`.
Since the update, `_fxPlayer` holds a real `AdventureFXPlayer` (MonoBehaviour,
not an AdventureActor); only the owner has an `attributeList`. (Old build used
`_fxPlayer`, which used to point at the owner actor.)

---

## 5. Why weapon/area hits are "stale" vs actor hits

| Hit type | Attribute source | Refresh timing |
|----------|-----------------|----------------|
| **Actor** (`1`) | `fromActorTemp->attributeList` (+ `actorInfo` dict) | **Every hit** — live read |
| **Weapon** (`2`) | `fromWeaponTemp->attributeList` + `attributeWithElementOrDamageTypeDict` | **At `Setup` time** — when weapon spawns/activates |
| **Area** (`5`) | `fromAreaTemp->attributeList` + `attributeWithElementOrDamageTypeDict` | **At `CopyBattleData` time** — on owner-change events or `copyBattleDataBeforeAttack` |

Actor hits always get the latest stats. Weapon and area hits get a **cached
snapshot** from the moment the entity was created or refreshed. If the owner's
stats change between those moments and the hit, the cached copy is stale.

---

## 6. Logger snapshot strategy

To correctly match the effect list with the `fromAdditionalAttrInfo` used for damage calculation, we snapshot effects at the same moment the game snapshots the attributes:

| Hit type | Snapshot hook | When captured |
|----------|--------------|---------------|
| **Actor** (`1`) | `GetBothAllInfo` | Hit time — attacker's `effectsDict`, filtered by `_effectStack->fields._size > 0` |
| **Weapon** (`2`) | `AdventureWeapon::Setup` (RVA `0x1727CC0`) | Weapon spawn/activation — owner/summoner's `effectsDict`, all non-removed effects |
| **Area** (`5`) | `AreaEffectEntity::CopyBattleData` (RVA `0x16AADA0`) | Area creation/refresh — **owner** (fxPlayer fallback only for legacy layouts), all non-removed effects |

Selection priority in `Hook_CalcNormalDamage`:

```
damageTypeTemp == 2 → g_WeaponSnapshots[fromWeaponTemp]
damageTypeTemp == 5 → g_AreaSnapshots[fromAreaTemp]
fallback           → g_GetBothAllInfoSnapshot
```

### Why the stack check for actor hits

For actor hits, `GetBothAllInfo` reads live `attributeList` at hit time. Effects in the dict might not have executed yet (if `trigger_ != 1` and no trigger fired). The `_effectStack` check (`stack->_array && stack->_size > 0`) ensures only effects with active modifications are included.

For weapon/area hits, the lists are snapshotted at setup/creation time. All effects in the dict at that moment contribute to the cached attribute copy, regardless of stack state.

### Why local copies in `Hook_CalcNormalDamage`

The snapshots are copied into a **local** `hitSnapshot` before being passed to `BuildHitJson`. This prevents a race condition where a subsequent `GetBothAllInfo` / `Setup` / `CopyBattleData` call overwrites the global snapshot before the current hit's JSON is built.

---

## 7. Relevant RVAs (new binary, out_new/script.json)

| RVA | Function |
|-----|----------|
| `0x16AADA0` | `AreaEffectEntity$$CopyBattleData` |
| `0x1727CC0` | `AdventureWeapon$$Setup` |
| `0x123EDF0` | `AdventureActor$$GetBothAllInfo` |
| `0x11213B0` | `CommonHelper$$CalculateNormalDamage` |
| `0x113DA40` | `AdventureEffect$$Execute` |
| `0x113B710` | `AdventureEffect$$Clear` |
| `0x113E6D0` | `AdventureEffect$$OnInit` |
| `0x1139B40` | `AdventureEffectBase$$OnClear` |
| `0x110BFC0` | `ActorHelper$$IsUseHitFromSummon` |

---

## 8. Key struct locations in decompiled.c (new binary)

| Line | Function |
|------|----------|
| 3632860 | `AdventureEffect__Clear` |
| 3634414 | `AdventureEffect__Execute` |
| 3635030 | `AdventureEffect__OnInit` |
| 3635139 | `AdventureEffect__PostExecute` |
| 3631531 | `AdventureEffectBase__OnClear` |
| 3636734 | `BaseAttriFix__Execute` |
| 3637237 | `BaseAttriFix__PostExecute` |
| 3637281 | `BaseAttriFix__Process` |
| 4106107 | `AttributeList__ChangeValue` |
| 4105627 | `AttributeEntry__ChangeValue` |
| 4106539 | `AttributeList__GetAttributeValue` |
| 4106263 | `AttributeList__CopyOwnerValue` |
| 3421999 | `ActorAdditionalAttrInfo__AddFrom` |
| 3852956 | `AdventureActor__GetBothAllInfo` |
| 3845313 | `AdventureActor__Damage` (damageTypeTemp resolution) |
| 4767802 | `AdventureWeapon__Setup` |
| 4669531 | `AreaEffectEntity__CopyAttributeWithElementOrDamageType` |
| 4669674 | `AreaEffectEntity__CopyBattleData` |
| 3612911 | `CommonHelper__CalculateNormalDamage` |
| 4320137 | `PlayerAdventureActor__SavePlayerAttributeSnapshot` |
| 4311905 | `MonsterSummonInfo__ParseSummonCfg` |
| 4116945 | `MonsterAdventureActor__SetPlayerSummonAttrInfoBySnapshot` |
| 4117202 | `MonsterAdventureActor__SetPlayerSummonAttrInfo` |



## final formula

((((((Atk * ((skillPercentAmend + talentGroupPercentAmend) * 0.0001 / 100) + skillAbsAmend + talentGroupAbsAmend)
* skillIntensity * perkIntensity * slotDmg * elementDmg * generalDmg + dmgPlus) * (critDmg + slotCritDmg)
* (erAmend * defAmend * slotDmgTaken * elementDmgTaken * generalDmgTaken * resilienceBreakDmg)) + dmgPlusTaken)
* finalDmg) + finalDmgPlus)
