# 2.1.0

Game version `2.1.0` (`prefs.dat` `LOCAL_GAME_VERSION 2.1.0`, `LOCAL_CLIENT_VERSION 2.0.0`, install updated 2026-11-13). Mirrors `2.0.1/`.

## Inputs

- `Hotfix.dll` — `Persistent_Store/Scripts/Hotfix.dll`, CDPH md5 `aca7cf52d6bd227ce7fa4f854b7cf46f`, 17676872 B, mtime 2026-11-12 20:37. Differs from 2.0.1 (`dde4c3f0eb19d5710b690fda517c0eaf`, 17552648 B) → **new build**.
- `Hotfix.dec.dll` — `scripts/cdph_dump.py --opstable scripts/opstable.json`, key check OK (`CDPH version 1`, the Jul 21 opcode table still works, no re-extract needed). md5 `304f693994b6490079f855f061035f6e`, 17676868 B.
- `Hotfix.decompiled.cs` — `ilspycmd` 10.1.1.8388, md5 `b67ad1c7fdce24c3b70e531b33d0c8b7`, 31886841 B / 1147934 lines.
- Reference stubs: `decompilation/versions/2.0.0/dumper/DummyDll` (via `decompilation/il2cppDumper_out`). Correct for this build — the install's `GameAssembly.dll` is md5 `be9c5f631fadbadf14a524c0a4aec4c2`, i.e. byte-identical to 2.0.0, so the AOT side did not change, no new `versions/` folder and no opcode-table re-extract.

## Counts

`TypeDef` rows **15008** (2.0.1: 14948, +60), method bodies **89787** (2.0.1: 89346, +441), 0 namespaces added/removed (431 both), no new `AIScript.Character._<id>` namespace → no new playable character.

Diff vs `2.0.1/Hotfix.decompiled.cs`: 113915 diff lines, 1726 hunks in 1075 types. The bulk is `MonoScriptData` (416 hunks) plus dorm/roam/story/runtime work, so hunk count overstates the combat delta.

## Combat-relevant

- **Leafia `AIScript.Character._16101`** — real kit rework, not just a rename: new `EarthMarkUtil` (`IsEarthMark(List<int> buffTags)`, `TryTrigger`) and the mark plumbing around it (`hitTag_Normal_Res` → `hitTag_NormalSpecial` in the perk-516106 branch, `base.OnCastSkill(evt)` added). New buff ids `16143012` (`buff_43_ultra`), `16196111` (`buffId_m1`), `16196211` (`buffId_m2_mark`), `16196311` (`buffId_m3`), `16196411` (`buffId_m2_atk`); the hardcoded `add_10_1/add_10_2/level_10` trio became `paramId_add_10 = 16110001`; `logicTag_FangWeiBiaoLv` renamed to `localDataKey_FangWeiBiaoLv` (the literal `"161_FangWeiBiaoLv"` is unchanged).
- **`AIScript.Monster._31801FeiLong`** — boss branch table now reads its release distance / angle / trace duration from `Config` per skill (`releaseDistance_MeeleSkill`/`_Push`/`_FireSkill`/`_FlySkill`/`_FireBall`/`_CriticalityDischarge`) instead of `default(FP)`; branch `1010` (`Operate_ExitToughnessBroken`) replaced by `9999` (`Operate_Test`, gated on `Config.skillId_Test > 0`, which also selects sequence 6 instead of 1). Toughness-break handling rewritten: `buffTag_Burst` check → `SwitchSequence(2)` else `SwitchSequence(1, …)`; the fly-state break now force-interrupts, `DestoryAllSkill()`, creates skill `3180133`, resumes the animation group, clears `IsFlyState`, releases `Camera_Fly` and logs `飞龙释放破韧技能失败` on failure.
- **`AIScript.Monster._70001JuYuanMeiYing`** — the summon boss got a period-based `Config` (`_wayPointByPeriod`, `_skillRecordByPeriod`, `_unmoveSummonByPeriod`, `current = 3`) with waypoint routes (`Zuo_0x_0y`/`You_0x_0y`), per-phase skill records (`evt_Smash`/`evt_Wave`/`evt_Boom`/`evt_Danmu`/`evt_Laser` → effects `700010020`/`700010021`) and unmove summons `7010026`/`7010027`/`7010057`/`7010058` (period 1) vs `7010469`/`7010470` (period 3). Behaviour: `healInterval` 5 → 14, `meteorInterval` 4 → 7, meteor radius 6 → `meteorRadius_NoTag3 1.5` / `meteorRadius_WithTag3 2` picked by `monsterInfo.Tag3`, meteor now targets the active player (`ActivedPlayerActor`) instead of falling back through `TryGetTargetPosition` (method deleted), FX renamed to `Area_70001_Supremebook_Damage`/`_zhiliao`, and spawn FX `fx_m70001_base_Supremebook_shifa`.

## Non-combat / runtime

- `HotfixDataController`: new `BuildGeneratorLevelControl` table (map + JSON/bin loaders + `GetBuildGeneratorLevelControl(int)` + unload), i.e. a new data table is shipped this build; periodic-quest `TitleText` fix.
- `MonsterAdventureActor`: debug field `testSkillId` (reset in `Reset`), paired with FeiLong's `Operate_Test`.
- `AdventureModuleHelper`: level-type allow-list and debug performance-monitor / `JumpOverCurLevel` helpers.
- `MonoScriptData` (416 hunks, bulk re-serialisation), `DormActor`/`DormLevelController`/`RoamBehaviour`/`ActorMovementMode`/`DormConfigs`, `SwitchActorPoseSnapshot` (actor → actorId), `StoryLine`, `PeriodicQuestControl`.

## Logger impact

None required. All 22 hooked classes/methods in `g_HybridTargets` (`Logger Dll/proxy.cpp`) keep identical parameter counts and `needsRealOrig` flags — `AdventureEffect.OnInit` 12+this, `CommonHelper.CalculateNormalDamage` 22, `AdventureWeapon.Setup`, `MonsterAdventureActor.SetPlayerSummonAttrInfo[BySnapshot]`, `MonsterSummonInfo.ParseSummonCfg`, `HotfixDataController.GetHitDamage`/`GetMonster` (`int key`, `Hotfix.decompiled.cs:139023`/`144402`), etc. Diff hunks do land in three of those classes (`HotfixDataController` 5, `AdventureModuleHelper` 2, `MonsterAdventureActor` 2) but none inside a hooked method body. The interpreter lives in an unchanged `GameAssembly.dll`, so `hybrid::Detect()` and its RVAs are unaffected.

Citations into the hotfix shift by roughly +19 lines (the bulk insert is earlier in the file), but not uniformly — recompute before quoting:

| anchor | 2.0.1 | 2.1.0 |
| --- | --- | --- |
| `GetInjuredElementValue` | 20703 | 20710 |
| `GetEEAndER` | 52369 | 52388 |
| `CalculateNormalDamage` | 52838 | 52857 |
| damage product (`fDP7 = zero * … * toEERCD * …`) | 52970 | 52989 |
| `AdventureEffect.PreExecute` | 56065 | 56084 |
| `enum effectiveGoals` | 163759 | 164097 |
| `enum takeEffect` | 166325 | 166681 |
| `Disc_214032` | 759336 | 764874 |
| `Disc_214032.OnPlayerActorDamaged` | 759370 | 764908 |

## Not checked here

`ss-data` was not re-pulled for this build — table-side deltas (`Effect`/`EffectValue`/`BuffValue`/`Skill`) are not in this document. The 214032 Corrosion effect-target bug is data-side (`Effect.json` `4032021.Target1 = 2`), so it cannot appear in this decompile; `Disc_214032` itself has no hunks.
