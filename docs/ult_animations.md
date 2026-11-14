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
| Alina (162) | 6.73 | 6.73 | 0.50 | +0.00 |

41 characters.

Rows without a full/short split:

- 162 (Alina): no _TL/_NoTL split; both columns = Ultra_Zhong (the default stance), and the Witch freeze applies in both modes, so the clock delta is 0. Stance variants: `Ultra_Zhong` 6.73 s / freeze 0.50 s; `Ultra_Qing` 5.00 s / freeze 0.30 s
