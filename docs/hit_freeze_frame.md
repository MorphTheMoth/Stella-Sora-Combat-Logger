# Hit freeze frames — which hits stop time and for how long

Per-hit "hit-stop". It is **not** in `HitDamage.json`: the values live on the clip's `Hit` `Combo.Event`, in `hitFeatureData`, and they only do anything when a flag bit is set on the same event. Numbers below are 2.0.x `char_*_combos.unity3d` (53 character bundles, 4,894 hit events); code anchors are `decompilation/hotfix/2.0.1/Hotfix.decompiled.cs`.

## The gate

`HitBox.FeatureFlag.DamageFreezeFrame = 0x10000000` (`:42761`), copied verbatim from the clip event into the runtime hitbox (`:4230`):

```csharp
_actor.hitBox.featureFlags = comboEvent.hitFlags;
```

and checked before anything is read out of `featureData` (`:13668`):

```csharp
if ((hitboxTemp.featureFlags & HitBox.FeatureFlag.DamageFreezeFrame) == HitBox.FeatureFlag.DamageFreezeFrame
    && (fromActorTemp is PlayerAdventureActor || this is PlayerAdventureActor))
```

Consequences:

- The `_freezeFrameType` enum's zero value (`Local`) is meaningless on its own — a hit with `Local` and no flag freezes nothing. 4,704 of the 4,894 hit events are in that state, so **only 3.9 % of hits freeze at all**. A lot of the filled-in Personalize weights in the assets (162 events) are inert for the same reason; only 24 of them carry the flag.
- A player must be on one side. Player minions are `MonsterAdventureActor` instances (`IsPlayerMinion`, `:760766`), so a summon hitting a monster never triggers a freeze.
- Values are `FP` (2^32 == 1.0). `-1` means "use the shared default".

## Three modes

| `_freezeFrameType` | scaling target | applied to |
|---|---|---|
| `Local = 0` | `AdventureActor.LogicTimeScale(0, duration)` (`:53611`) | the victim (`this`) and the attacker (`fromWeaponTemp`, else `fromActorTemp`) |
| `Global = 1` | `AdventureModuleController.FreezeFrame(0, duration)` → `LockStepManager.globalTimeScale` | everything, including the level/Blitz clock |
| `Personalize = 2` | `EnterFreezeFramePer(aTimeScale, aDuration, bTimeScale, bDuration)` (`:14187`) | A = attacker, B = victim, each with its own duration and time scale |

The consumer is the actor's own tick (`:53552`):

```csharp
LogicDeltaTime = (ignoreGlobalLogicTimeScale ? LockStepManager.unscaledDeltaTime
                                             : (LockStepManager.deltaTime * TSMath.Max(0f, logicTimeScale)));
```

With `logicTimeScale == 0` that actor's `buffComponent.LogicUpdate`, `effectManage.LogicUpdate`, `actorSkillManage.LogicUpdate`, `playerSkillCd.UpdateSkillCD`, `_primeFSM`, `_attackFSM`, `_movementFSM` and AI all receive `0`, so its buffs, DoTs, cooldowns, animation, movement and AI stop. Other actors are untouched, and so is the level: `LevelLogicUpdate()` feeds `levelInstance.UpdateLogic(LockStepManager.deltaTime)` (`:31751`), which a per-actor freeze never changes. `Global` is the exception — it scales `deltaTime` itself.

Defaults when the field is `-1` (`:28596`): damage 0.1 s, crit 0.2 s, toughness break 0.2 s, kill 0.2 s at scale 0.1. Branch precedence is kill > toughness break > crit > plain damage (`:13672-13721`); a crit value of exactly `0.0` fails the `!= FP.Zero` test and falls through to the damage value. The B/last freeze duration is also subtracted from the victim's stagger, `EnterStiff(hitStrenth, StiffDuration - fP, …)` (`:13724`), so the flinch is not spent inside the freeze.

## Which hits are affected

`both` = attacker and victim both at scale 0 · `A/B` = attacker / victim · `GLOBAL` = whole lockstep.

| Char | hits | what's affected | freeze |
|---|---|---|---|
| Shimiao (113) | 130 | normal attacks (all 6 directional variants), main skill, support skill, ultimate | `both 0.05–0.15`; skills/ult `0.1` |
| Freesia (125) | 9 | normals 1-3, Rage-3 chain, dodge counter (no skills, no ult) | `A 0.166 / B 0.266`; Rage-3 follow-ups `0.05/0.15`; counter `GLOBAL 0.1` |
| Coronis (118) | 8 | normal U chain, aimed charged B, support skill, ultimate finisher | `both 0.02 → 0.07 → 0.2`; skill `0.3/0.3`; ult `0.5/0.5` |
| Noya (112) | 7 | normal 4, main skill (spin), ultimate 2-hit | `both 0.1 / 0.05`; ult `A 0.1 / B 0.1` |
| Tilia (107) | 6 | normals 1-4, ultimate (both `_TL` and `_NoTL`) | `both 0.1` |
| Minova (132) | 6 | normals 1-4, main skills S3 jump-cut + S1 thump | `A 0.166 / B 0.266`, later lights `0.1/0.266`; S1 `both 0.2` |
| Cosette (142) | 6 | normals 1, 2, 4, main skill ShengLong | `both 0.1–0.15` |
| Chixia (141) | 5 | normals 1, 4, 5 | `A 0.05–0.15 / B 0.266` |
| Ridge (116) | 4 | melee normals, main skill (perk variants inherit) | `both 0.15` |
| Ann (123) | 4 | normals 1, 2, 4, dodge | lights `both 0.166`; 4th `A 0.1 / B 0.2` |
| Firenze (110) | 2 | second skill only (no normals) | `both 0.1` |
| Teresa (127) | 1 | `B2_Start` opener | `A 0.166 / B 0.266` |
| Mistique (135) | 1 | main skill (summon ghost) | `A 0 / B 0.5`, target only |
| Iris (111) | 1 | special attack only | `both 0.1` |

Every other character in the bundle is at zero: Amber, Kasimira, Aobelle, Chaton, Firefly, Jinglin, Nanoha, Canace, Donna, Nazuka, Fuyuka, Angie, Eleanor, Nyx, Allie, Sparkla, Wraith, Chitose, Otoha, Caramel, Gerie, Laru (150 + 158), Shia, Nazuna, Karin, Coronis-159, Willow, Alina, Greyhorn. The two 2.1.0 packs not in the extracted set were checked as well: 161 (65 hit events) and 162 Alina (258) have **no** flagged hits either.

## Crit

Precedence means a crit-specific value wins over the plain one, and `-1` resolves to the shared defaults (0.1 damage vs 0.2 crit), so `-1` hits freeze **twice as long** on a crit.

| case | who | normal hit | crit |
|---|---|---|---|
| explicit crit values | Shimiao `XAA` 1130101 / `YAB` 1130102 / `XAC` 1130103 | 0.05 / 0.12 / 0.15 | 0.08 / 0.15 / 0.18 |
| field `-1` on both | Tilia all lights + both ults, Iris special, Ann dodge, Minova S3 jump-cut, Shimiao skill/ult hits (and her `AC` on X/Y variants) | 0.1 (default) | 0.2 (default) |
| crit `0.0` | Firenze `Skill2_3` / `Skill2_4` | 0.1 | 0.1 — branch skipped |
| identical values | everything else, including all 24 Personalize rows: Freesia, Chixia, Coronis, Minova lights, Teresa, Noya, Mistique | unchanged | unchanged |

Toughness-break durations are never different from the damage duration, so that branch never changes the outcome.

## Freesia (125)

- `Attack_1` / `Attack_2` / `Attack_3` (125100011 / 125100021 / 125100031, flags `0x10001001` = `KnockBack|Stiff|DamageFreezeFrame`): `Personalize`, **A 0.166 s / B 0.266 s**, both at scale 0 — the target loses 16 frames, the player 10, per swing.
- `Attack_4`, `Attack_5`, `Attack_Rage_1`, `Attack_Rage_2` (flags `0x1001`): no freeze bit, so their `FreezeFrameWhenDamage = 0.166` and `b = 0.266` are dead data; they only stagger and knock back.
- `Attack_Rage_3`: 125100081 flags `0x10001002` → `0.166 / 0.266`; 125100082 and 125100084 flags `0x10001000` → `0.05 / 0.15`.
- `Dodge_Rage` 125200001 flags `0x10001001`, `_freezeFrameType = Global`, value `-1` → 0.1 s through `LockStepManager.globalTimeScale`; the only `Global` freeze on the roster.
- Ultimate (125400001-3, flags `0x1002` / `0x1000`): no freeze. Its impact comes from the clip's type-10 `FrozenTime` event instead, which is a different mechanism — see `ult_animations.md`.
- Crit is irrelevant for her: the Personalize crit values equal the damage values.

## Re-deriving the table

Reads the extracted bundles only; no game process needed. `hitFlags` is the gate, `hitFeatureData` the values:

```python
import json, glob, os
EX = "decompilation/CombatAssetsBundles/extracted"
FLAG = 0x10000000
fp = lambda v: (v.get('_serializedValue', 0) if isinstance(v, dict) else v or 0) / 2**32
for f in sorted(glob.glob(EX + "/*/*_combos.json")):
    cid = os.path.basename(f).split('_')[1]
    for o in json.load(open(f)).get('objects', []):
        for sk in (o.get('tree') or {}).get('comboEventSkins') or []:
            for e in sk.get('comboEvents') or []:
                hf = e.get('hitFeatureData')
                if not isinstance(hf, dict) or not (e.get('hitFlags') or 0) & FLAG:
                    continue
                print(cid, o.get('name'), e.get('hitDamageId'), hex(e['hitFlags']),
                      hf.get('_freezeFrameType'), fp(hf.get('FreezeFrameWhenDamage')),
                      fp(hf.get('FreezeFrameWhenCrit')),
                      fp(hf.get('aFreezeFrameWhenDamage')), fp(hf.get('bFreezeFrameWhenDamage')))
```

The log cannot show these: `hitFlags` is never emitted (`HitConfig` in `logging.cpp` carries `hitDamageId`, `levelTypeData`, `damageType`, `skillId`, … but no flags), and the durations are in the asset, not in `HitDamage.json`. A `hitDamageId → freeze` sidecar (same shape as `levelMap.txt`) would be the way to surface it.
