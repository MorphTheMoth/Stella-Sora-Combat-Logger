# Ultimate animations: full (`_TL`) vs short (`_NoTL`) timing

Ultimates exist in two variants per character. `ComboGroup.timelineAlias` names a
PlayableDirector cinematic (`char_<id>_timeline.unity3d`); `timelineAliasN` is the
short-mode alternative and is empty for every 2.0.x character, so `none` skips the
cinematic entirely and plays the `_NoTL` combo.

- **Full path** — `AdventureSkillTimelinePlayer.Play` pauses the lockstep
  (`ModuleController.PauseLogic`), then `BeginAttack("<id>_Ultra_TL")`.
- **Short path** — `BeginAttack("<id>_Ultra_NoTL")` immediately. Every `_NoTL` ult
  clip carries a `Combo.Event` of type 10 (`FrozenTime`, designers' tag `大招黑屏`)
  that calls `EnterWitchTime(duration)` -> `LogicTimeScale(Config.FrozenTime_Scale = 0)`,
  freezing every actor except the caster (who has `ignoreGlobalLogicTimeScale`).
  The screen darkens through `WitchTime_BackgroundColor`. A perfect dodge is a
  different mechanism: `EnterPerfectDodge` uses `FreezeFrame(0.1, 0.5)` (global slow).

Both stop the Boss Blitz clock, because `StandaloneLockStepManager.LogicFixedUpdate`
sets `deltaTime = unscaledDeltaTime * logicTimeScale`.

Columns (all seconds; every value is derived, nothing hand-entered):

| Column | Meaning |
|---|---|
| Char | character id + name |
| TL | full-path attack block (`<id>_Ultra_TL`): sum of `animationLength / playSpeed` |
| NoTL | short-path attack block (`<id>_Ultra_NoTL`), same formula |
| Witch | short-path black-out: `(activeNormalizedTimeRange.y - x) * animationLength` over type-10 `FrozenTime` events; the caster is exempt (`ignoreGlobalLogicTimeScale`), so only allies and enemies stop |
| Clock Δ | Boss Blitz logic-clock delta, TL vs NoTL (`NoTL` taken net of `Witch`): the cinematic and the black-out are free clock, so negative means the full-animation ult costs less clock |

Caveats: script-held loops can extend a block longer than its clip sum (Iris ~5 s,
Wraith's field 10 s, Shia 4 s); Sparkla (140) starts a second combo
(`140_Ultra_TL2`) after `TL1`, so his TL column covers `TL1` only; Tilia (107) fires the
same hit (`107400001`) in both ults but with a 5 m circle in `_TL` and a 7 m circle in `_NoTL`. Rows come from the
live `char_*_combos.unity3d` bundles (Persistent_Store first, base skin preferred over
variants). Characters without a `_TL`/`_NoTL` pair get one ult clip duplicated into both
columns and are flagged under the table (162 Alina: stance variants `Ultra_Qing`/`Ultra_Zhong`).

## Table

| Char | TL | NoTL | Witch | Clock Δ (TL vs NoTL) |
|---|---|---|---|---|
| Amber (103) | 1.07 | 1.78 | 0.38 | -0.33 |
| Tilia (107) | 1.85 | 3.43 | 0.83 | -0.75 |
| Kasimira (108) | 1.03 | 2.50 | 1.08 | -0.39 |
| Firenze (110) | 5.23 | 6.50 | 0.50 | -0.77 |
| Iris (111) | 3.27 | 5.43 | 1.00 | -1.17 |
| Noya (112) | 2.70 | 2.70 | 0.50 | +0.50 |
| Shimiao (113) | 2.00 | 2.93 | 1.77 | +0.83 |
| Chaton (114) | 3.87 | 5.37 | 0.00 | -1.50 |
| Firefly (115) | 2.03 | 2.33 | 0.40 | +0.10 |
| Ridge (116) | 3.70 | 6.00 | 0.74 | -1.56 |
| Jinglin (117) | 0.82 | 1.90 | 0.50 | -0.58 |
| Coronis (118) | 2.63 | 3.60 | 0.50 | -0.47 |
| Nanoha (119) | 0.73 | 2.23 | 0.42 | -1.08 |
| Canace (120) | 3.43 | 4.27 | 0.73 | -0.10 |
| Ann (123) | 1.67 | 1.67 | 0.50 | +0.50 |
| Freesia (125) | 3.80 | 5.33 | 1.33 | -0.20 |
| Flora (126) | 2.27 | 3.77 | 1.08 | -0.42 |
| Teresa (127) | 2.45 | 5.28 | 1.00 | -1.83 |
| Donna (130) | 1.83 | 2.00 | 0.67 | +0.50 |
| Minova (132) | 3.77 | 4.48 | 0.83 | +0.12 |
| Nazuka (133) | 8.33 | 9.33 | 0.75 | -0.25 |
| Fuyuka (134) | 7.80 | 8.53 | 0.67 | -0.07 |
| Mistique (135) | 2.43 | 4.07 | 0.50 | -1.13 |
| Eleanor (137) | 3.47 | 4.53 | 0.50 | -0.57 |
| Allie (139) | 1.77 | 2.70 | 1.08 | +0.15 |
| Sparkla (140) | 3.37 | 8.93 | 0.00 | -5.57 |
| Chixia (141) | 1.50 | 4.20 | 0.50 | -2.20 |
| Cosette (142) | 2.87 | 4.53 | 0.56 | -1.11 |
| Wraith (143) | 5.47 | 6.40 | 0.50 | -0.43 |
| Chitose (144) | 5.33 | 7.23 | 1.08 | -0.82 |
| Otoha (145) | 1.10 | 2.00 | 0.50 | -0.40 |
| Caramel (147) | 4.57 | 5.33 | 0.50 | -0.27 |
| Gerie (149) | 1.93 | 3.73 | 3.67 | +1.87 |
| Laru (150) | 3.37 | 4.97 | 1.50 | -0.11 |
| Shia (155) | 3.73 | 3.90 | 0.50 | +0.33 |
| Nazuna (156) | 4.50 | 5.20 | 0.50 | -0.20 |
| Karin (157) | 5.30 | 6.80 | 0.67 | -0.83 |
| Laru (158) | 0.86 | 2.33 | 0.65 | -0.82 |
| Coronis (159) | 2.33 | 2.73 | 0.50 | +0.10 |
| Willow (160) | 3.70 | 5.50 | 0.75 | -1.05 |
| Leafia (161) | 3.80 | 3.80 | 0.52 | +0.52 |
| Alina (162) | 6.73 | 6.73 | 0.50 | +0.00 |

42 rows: the 41 released characters plus 161 Leafia, who has no `EN/bin/Character.json` entry yet.

161 Leafia has a stub kit only — `ComboClip_161_Skill_Main`, `_Skill_Sup`, `_Ultra_TL`, `_Ultra_NoTL` (12 objects in `char_16101_combos.unity3d`, plus a `_combos_summon` bundle; her normals live on `161_Atk1/2/3`, see `leafia-161-2.0.0-kit.md`) — so her TL and NoTL clips are the same length (3.80 s) and the only delta is the 0.52 s type-10 `FrozenTime` black-out in the short variant. Bundles are dated 2026-11-13, the same patch batch as 162.

163 (Greyhorn), 164 (Shuo) and the still-`***` ids 166 / 168 / 177 have `characterid.json` entries but **no installed bundles** (no `char_163*` / `char_164*` in `InstallResource` or `Persistent_Store/AssetBundles`, and no manifest reference), so there is nothing to measure for them yet; re-run the extraction once the game downloads their packs.

Rows without a full/short split:

- 162 (Alina): no _TL/_NoTL split; both columns = Ultra_Zhong (the default stance), and the Witch freeze applies in both modes, so the clock delta is 0. Stance variants: `Ultra_Zhong` 6.73 s / freeze 0.50 s; `Ultra_Qing` 5.00 s / freeze 0.30 s

## Support slot (assist)

Nothing about the ult path is skipped when the caster sits in the support slot: `UltimateId == AssistUltimateId` for every entry in `EN/bin/Character.json`, so the same skill id runs the same `SkillScript_Ultra` → `PlayTimeline` → `<id>_Ultra_TL` / `_NoTL` clips. The caster is a `PlayerAdventureActor` with `isAssist = true` (`:24138`, `:24774`), which is what the shared code tests.

- **Full animation** — identical: `AdventureSkillTimelinePlayer.Play` sets `_director.timeUpdateMode = UnscaledGameTime`, disables input, hides the HUD and calls `PauseLogic()` (`:184155`), with `EnableInvincible()` on the assist. Whole game and Blitz clock stop for the cinematic.
- **Short animation / black-out** — `OnFrozenTimeEvent` only checks `_actor is PlayerAdventureActor` (`:4178`), so the assist triggers `EnterWitchTime` too, but `ignoreGlobalLogicTimeScale = true` is set on the **caster**, i.e. the assist (`:17114`). So during a support-slot black-out the assist keeps ticking while **your main character is frozen for the full 0.38–1.83 s** — the opposite of a main-slot ult, where you are the exempt actor. The whole level clock also stops, because `LockStepManager.deltaTime = unscaledDeltaTime * logicTimeScale`.
- **Highlight / camera pairing** — an assist has no `attackTarget` of its own, so `EnterWitchTime` substitutes `assistWitchTimeTarget` (`:17103`). It is filled when the assist is staged (`:93967`) from `FrozenTimeHighlightUnit` (enum `:169145`): `SelfAndTarget = 2` → the main's current target if alive, else the assist's own, else a 256-layer search; `Self = 1` → stays null, so only the assist is highlighted. `Self` is used by Iris, Chaton, Jinglin, Coronis, Nanoha, Nazuka, Sparkla, Nazuna and Laru; everyone else is `SelfAndTarget`.
- **Interrupt** — `EnterWitchTime` begins with `EndCurrentWitchTime()` (`:17096`), so an assist ult cancels a witch time the main is currently in (e.g. a perfect-dodge freeze).
- **158 Laru is the exception in data**: her assist variants are separate clips — `Attack_Ultra_Support` (1.07 s) and `Ultra_Skill_Support` (1.33 s), chosen by `isAssist ? "…_Support" : …` in `SkillScript_NormalAttack_Transfrom` / `SkillScript_Skill_Transfrom` — and neither has a type-10 `FrozenTime` event, so her support-slot ult has **no** black-out, while her main-slot `Ultra_NoTL` does (0.232 × 2.80 = 0.65 s). No other character in the extracted bundles has `_Support` ult clips; they all reuse their normal ult clips in both slots.
- **Day-once counter** — the `TimeLinePlayType.dayOnce` allowance is keyed `{playerUid}_{actor.dataID}day` (`:52720`), i.e. per character, so a character's main-slot and support-slot ults share the same daily counter.
