# How Karin (157) & Eleanor (137) were researched

A walkthrough of the session that produced `docs/karin-eleanor-pots.md`. The methods here are written generally so they apply to any unreleased character, but the evidence cited is specific to this research. Every fact taken from the datamine git history is dated.

Line numbers below cite `decompilation/hotfix/1.13/Hotfix.decompiled.cs` when they refer to the original `karin-eleanor-pots.md` research, and `decompilation/hotfix/1.14/Hotfix.decompiled.cs` for the current build — always re-resolve in `1.14` for new work (see version table).

---

## The characters

- **Karin (157), Umbra (Dark).** Unreleased. Full, fully-coded kit in `AIScript.Character._15701` (`1.13/Hotfix.decompiled.cs:680972-682838`, 1866 lines; `1.14/Hotfix.decompiled.cs:686781-688694`, 1913 lines after patch).
- **Eleanor (137), Ventus (Wind).** Unreleased. Full kit in `AIScript.Character._13701` (`1.13/Hotfix.decompiled.cs:708314-709935` = `1.14/Hotfix.decompiled.cs:714170-715791`, 1621 lines, identical). Lore: a rookie Trekker in Philae.

Neither fully-coded character ships any datamine table entry, so kits were reconstructed entirely from the hotfix.

---

## Source inventory (what was sifted, in priority order)

| Source | Path | What it contributed |
|---|---|---|
| Hotfix decompile | `decompilation/hotfix/<version>/Hotfix.decompiled.cs` (see version table below — default is `1.14/`, the latest) | The kit: skills, perks, buff/AddAttr/param ids, trigger tags, element-mark code. Older folders are historical comparisons; always use the latest unless you need to match an existing citation. |
| Il2Cpp dumps | `decompilation/out_new/dump.cs` | Enum values: `AdventureActorElementTriggerType` (Type1=31, Type2=32, `dump.cs:176985`), `characterJobClass` (Vanguard=1 / Balance=2 / Support=3, `dump.cs:175269`). |
| Datamine language | `Link to StellaSoraData/EN/language/en_US/UIText.json` | Concept names: `LightMark_Trigger_Effect_01` = Lucent (#4028), `_02` = Thunderbolt (#4027). |
| Datamine history | `StellaSoraData/.git` | The only raw data for unreleased chars (see dates below). |

The datamine is auto-updated and strips unreleased content, so anything not in the current tables must be pulled from git history.

## Hotfix decompile versions in this repository

`decompilation/hotfix/` holds versioned builds. Each folder contains `Hotfix.dec.dll` (decrypted .NET assembly) and `Hotfix.decompiled.cs` (full C# via `ilspycmd -r <Il2CppDumper>/out_new/DummyDll Hotfix.dec.dll -o .`). See `decompilation/hotfix/README.md` and `decompilation/hotfix/scripts/README.md` for the `CDPH`/Obfuz VM decryption, `opstable.json` extraction, and `scripts/rerun.sh` re-run.

| Folder | Game build / provenance | Size / lines | Commit | What it contains |
|---|---|---|---|---|
| `0.5/` | Old build from `/home/morph/Downloads/Hotfix.dll` (predates the two current builds) | 14.8 MB, 533,576 lines, `Hotfix.dec.dll` 8.1 MB, 123 residual `Unknown result type` comments | `f2d36af` (2026-08-07) | Smallest. Only 37 `AIScript.Character` namespaces (`_10101` ... `_15901`/`_15801`/`_99701`); **no** `_15701` (Karin), `_13701` (Eleanor), `_16201`, `_16001`, `_14001`, `_99901` (compare 43 in `1.13`/`1.14`). Decrypted with the `1.13` opcode table (key check `Hello, HybridCLR` OK) — 123 ILSpy stack-analysis edge cases on TrueSync/`FP` (`iFP`/`TSVector2`), still readable (vs 4 warnings in the newer builds). Useful only to prove absence: "character did not exist in the old build". |
| `1.13/` | Previous game build (`Persistent_Store/Scripts/Hotfix.dll`) | 21 MB, 761,729 lines, `Hotfix.dec.dll` 12 MB, ~4852 types, 0 IL errors, 4 residual warnings (`FP <= FP` in `ILRuntimeAPI.CalcDistanceBetweenMonsterAndPlayer`) | `f77d312` (2026-08-02) moved to `1.13/` in `f2d36af` | First version with the full unreleased kits: Karin `_15701` at `1.13/Hotfix.decompiled.cs:680972-682838` (1866 lines), Eleanor `_13701` at `708314-709935` (1621 lines), plus stubs/full kits for `_16201:668062`, `_16001:669446`, `_14001:705314` — 43 character namespaces total. This is the version cited in `docs/karin-eleanor-pots.md` and in the gauge example below. Retained for citation stability; superseded by `1.14` for new work. |
| `1.14/` | Current game build (`Persistent_Store/Scripts/Hotfix.dll`, Aug 14; decompiled Aug 26) | 21 MB, 767,585 lines (+5,856 vs `1.13`), `Hotfix.dec.dll` 12.4 MB, 11032 TypeDefs, 0 IL errors, 4 residual warnings (same pattern) | `d4ea061` (2026-08-18) | **Default for all new research.** Same 43 character namespaces as `1.13`. Eleanor `_13701` at `1.14/Hotfix.decompiled.cs:714170-715791` is byte-for-byte identical to `1.13`. Karin `_15701` moved to `686781-688694` (1913 lines, +47) and was patched — see below. Stubs `_16201:673871`, `_16001:675255`, `_14001:711170` are identical to `1.13`. |

Version choice: always start with `1.14/Hotfix.decompiled.cs`. Fall back to `1.13` only when you need to match an existing citation (`karin-eleanor-pots.md` was written against `1.13`) or to document a pre-patch mechanic, and to `0.5` only when you need to show a character/kit did not exist yet. Do not cite an older file just because its line numbers match an existing note — re-resolve the symbol in `1.14` and cite that line instead.

Karin `1.13` -> `1.14` patch (full namespace diff: `decompilation/hotfix/1.13/Hotfix.decompiled.cs` vs `1.14/Hotfix.decompiled.cs`, or `git show d4ea061 --stat` + namespace grep): Eleanor unchanged; Karin received five talent passives `D1-D5` (`15796111`/`15796211`/`15796311`/`15796411`/`15796511` in `Config`, `Hotfix.decompiled.cs:687470` in `1.14`), Dark-mark trigger rewritten (`AnSuo` `5031/5041`/`DarkAnSuo`/`DarkMark_Trigger_Effect_05` -> `DarkAnZhuo` `15700001`/`DarkAnZhuo`/`DarkMark_Trigger_Effect_03`, `TriggerType2` -> `Type1`), P1 tag `157FishAtk` -> `157P1Trigger`, P3 normal-attack shoot `shootOffsetDic_P3` -> `shootBulletKeyList_P3` (`Bullet_157_NrmAtk_1_Num2/3/4`), `randomRadius_NormalAttack_P3` `1` -> `3`, P4 FX `Actor/Character/13701/...` -> `fx_15701_hit_01`, P6/P13 split into self+other buffs (`15706011` -> `15706011+15706012` for Balance Dark teammates, `15713011` -> `15713011+15713012` with `GetPlayerActorCountByElement`), P9 trigger narrowed to `157P9Trigger` + `DarkAnZhuo` + `CheckAllPlayerActorAreSameElement(DE)` + CD check, P5 `damageType.SKILL` -> `ULTIMATE`, plus gauge init `100` stacks at `ActorStatus.Special` and buff `15790013` re-timed. `docs/karin-1.14-changes.md` (if present) has the annotated diff.

---

## Step 1 — detect an unreleased character

- A character is "in development" when `namespace AIScript.Character._<id>01` exists in the hotfix but the id is missing from `characterid.json`, `character.json` and every `EN/bin/*.json` table.
- Two flavours:
  - **Stub** (162): empty Config, zero ids. You can describe mechanics.
  - **Fully coded** (157, 137): complete kit, but buff/AddAttr values may still be `0` stubs ("id not wired yet" in the output doc).
- Check `unreleased.json` history: `character.js` writes unnamed characters (`???`) there as `"<id> <characterid-or-empty>"`.

---

## Step 2 — read a kit from the namespace

Every `_<id>01` namespace has the same skeleton:

- `Config` / `Config_MainControl` / `Config_Support` — combo tags, damage-tag hashes, buff ids, AddAttr ids, param ids, area-effect keys, perk ids. Read these first; they define the kit's vocabulary.
- `ActionScript` (+ `_MainControl` / `_Support`) — button input, energy timers.
- `ParallelScript` (+ variants) — event listeners and perk logic; most perks fire here (receive-damage, before-hit, element-mark trigger, skill-cast).
- `SkillScript_*` — one per skill (`NormalAttack`, `Dodge`, `Rush`, `Skill_MainControl`, `Sciprt_Skill_Support`, `Ultra`).

Always begin with the latest hotfix decompile available under `decompilation/hotfix/`. For this repository, that is currently `decompilation/hotfix/1.14/Hotfix.decompiled.cs` (previous is `1.13/`, oldest is `0.5/` — see version table above). Use an older decompile only when the latest one does not contain the relevant code or when comparing a mechanic's revisions. Do not cite `1.13` (or `0.5`) just because its line numbers match an existing note — re-resolve the symbol in `1.14` and cite that line.

Skill ids (e.g. Karin `15710000` normal, `15731000` main, `15732000` support, `15740000` ult) resolve via `EN/bin/Skill.json` — in the datamine history, since the current tables lack them (see Step 6).

---

## Step 3 — element marks: proc vs apply

The user wants each skill/potential tagged with whether it can **apply** or **proc** an element mark.

- **Proc** = consume a mark already on the enemy: `CheckCanTrigger<Element>Mark` gated by `CheckElementMark(...)` + `CheckTriggerElementMarkCD(...)` + a damage-tag match, then `Trigger<Element>Mark` → `TriggerElementMarkEvent(...)`.
- **Apply** = `AddBuff(<markBuffId>, ...)` on the enemy (Wind mark = `2011`), or a summoned unit that does it.

Trigger-type → effect name mapping lives in `UIText.json` (`LightMark_Trigger_Effect_01` = Lucent, `_02` = Thunderbolt); the numeric types come from `dump.cs` (`31` = Type1, `32` = Type2).

Which *specific skills* proc is decided by their hit tags — see Step 4.

Result for Karin: **procs** the Dark mark (Main Skill + P4's chain tick), never applies one. Result for Eleanor: **applies** the Wind mark (base support jump-attack hits and drone bullets), and **procs** it (base `"137WindTagTrigger"` hits, P7 5th-normal-hit, P11 ult hits, P32 ult hits apply).

## Step 3b — class determination from the proc/apply pattern

A trekker's class is strongly correlated with which mark actions its kit performs (verified against the released roster: Firefly/Minova/Jinglin = Versatile apply + proc, Laru/Shia = Vanguard proc-only, Tilia = Support apply-only):

- Vanguard — can only proc marks (and does so with most abilities).
- Versatile — procs marks in the main slot (main skill) and applies marks in the support slot (support skill).
- Support — can only apply marks.

Procedure: inventory every proc source (`TriggerElementMarkEvent` / `CheckCanTriggerXxxMark` paths) and every apply source (enemy `AddBuff(<markBuffId>)` or a summon that applies it), tag each as main-slot vs support-slot, then match the pattern above. Watch for non-element "marks" (e.g. Karin's Hunting mark `15790012` or P22's detonate debuff `15721011`) — those are not element marks and don't count.

Applied to the researched units: Karin procs the Dark mark (Main Skill + P4 chain tick, `157DarkTagTrigger`) and never applies → Vanguard. Eleanor procs the Wind mark in the main slot (`137WindTagTrigger` base hits, P7, P11) and applies it in the support slot (jump attack, drones, P32) → Versatile.

In the output doc the guess is written as a one-line summary under the character heading (the reader already knows the pattern, so the reasoning is left out).

### Corroborating patterns (from `character.json` actual classes)

The proc/apply pattern is the primary signal, but three more patterns from the released roster firm up the call when one side of it is unobservable (e.g. Karin's support-skill hit tags):

1. Team-wide buff count (potentials that buff a *teammate* — squad stat, main-Trekker shield/energy, same-element allies): Support 5-13 (avg ~9.7), Versatile 0-5 (avg ~1.3), Vanguard 0-2 (avg ~0.4, most have none). Cleanly isolates Support. Do NOT count self-buffs that scale off squad composition or trigger off squadmate actions ("each Terra Trekker in the squad increases X's own stat", "when a squadmate casts...").
2. Common potentials (P41-43): Vanguard = all self/Ultimate buffs ("I get stronger when I ult"); Support = main-Trekker/squad shields and buffs; Versatile = mixed, often with one main-Trekker/squad/summon common. A character with zero non-self commons and zero main-Trekker utility is not a Support.
3. Support-core potentials (P21-24): Vanguard = pure self-damage/combo upgrades; Support = main-Trekker shields/utility; Versatile = self-damage with occasional main-Trekker utility (e.g. Minova's shield).
4. Base support-skill mark language: in the Lux cluster, Versatile support skills apply the mark (Minova, Jinglin), Vanguard support skills trigger it (Laru, Shia).

Applied here: Karin's zero apply paths, all-self commons, 1 team-wide buff (P31; P13 is a squad-gated self buff) and all-self support-cores all agree on Vanguard. Eleanor's code-verified support-slot apply, team-buff commons and 3 team-wide buffs (above the Vanguard max of 2) agree on Versatile.

---

## Step 4 — resolve hit damage tags (CRC32)

`EN/bin/HitDamage.json` stores `DamageTag` as integers hashed with **CRC32 of the tag string**, not Unity's `StringToHash` (which the code-level Config constants use). This is the key trick that turns opaque tag numbers into readable tags:

```python
import zlib
def s32(v): return (v + 0x80000000) % 0x100000000 - 0x80000000
def crc32(s): return s32(zlib.crc32(s.encode()))
# crc32('157DarkTagTrigger') == -220520023 == 0xf2db21a9
```

Karin worked example — from snapshot commit `22217991`, dated **2026-06-30** (the only history snapshot that contains her hits; the auto-updated datamine has removed them since):

- `157300001-003`, `157300011-013` (Main Skill, DamageType 2) and `157300005` (Main Skill, DamageType 1) carry `157DarkTagTrigger` → the Main Skill and **P4's chain tick** proc the Dark mark.
- `157100001` (Normal Attack) carries only `157NrmAtk` → no proc.
- `157400001` (Ultimate) carries `157UltraAtk` → no proc.
- Also resolved: `157FishAtk` (gates P1/P5/P6/P7/P25/P26/P27), `157UltraAtk` (P41/P42), `157SkillMainAtk` (generic main-skill tag), plus one unresolvable common tag on the ult hit.

Eleanor had **no hit data in any snapshot**, so her mark interactions were attributed from code paths instead — say so when this happens.

---

## Step 5 — minions vs special entities

- **Minion/summon** = `ILRuntimeAPI.SummonMonster(...)` with a `SummonCfg`, queryable via `GetAllSummonsById(...)` / `IsPlayerSummoned(...)`; the summoned unit is a `MonsterAdventureActor` with its own AI (shared drone AI: `Config_Drone` + `class Parallel`, `1.13/Hotfix.decompiled.cs:664994-665123` = `1.14/Hotfix.decompiled.cs:670803-670932`; no drone code in `0.5`).
- **Not a minion** = `PlaySpecialProcess(...)` on a `CustomHotFixEntityBase` (e.g. Karin's FishOverload companion, `:682441`); it has no `MonsterSummonInfo` and never appears in summon queries.

Grep the namespace for `SummonMonster|SummonCfg|IsPlayerSummoned` to decide. Result: Eleanor = **yes** (drones, summon id 13700011, max 3); Karin = **no** (fish is a special FX entity).

After finding a real monster summon, inspect the complete `SummonCfg`, especially `useSummonHit` (`UseSummonHit` in `MonsterSummonInfo`). Treat `useSummonHit = false` as the normal case where the minion is the hit source; do not explain or highlight that behavior in the character output. If `useSummonHit = true`, do not add a minion explanation or overview either. Use `docs/minions_combat_analysis.md` as the internal reference when checking the flag: it explains that the flag changes weapon/area hit-source selection and is separate from the minion's inherited actor stats. `summonAttrType` and `summonFollowType` control stat initialization separately. The output may still mention a summon when it is part of a skill mechanic, such as "spawns up to 3 drones," but must not add a separate minion combat overview.

---

## Step 6 — potentials and build grouping

Perk ids follow `51<charnum><slot>xx`: main `01-13`, support `21-33`, common `41-43` (Karin `515701-515743`, Eleanor `513701-513743`).

User's build rule: main-control `01,02,05,06,07` = Build 1, `03,04,08,09,10` = Build 2, `11,12,13` = Generic; support offset by 20 (`21,22,25,26,27`, `23,24,28,29,30`, `31,32,33`); common `41-43` flat.

---

## Step 7 — datamine git history (dated facts)

All unreleased raw data came from `StellaSoraData/.git`. Dates:

- **Char 137 and 157 `unreleased.json` entries** (names `"137 Eleanor"` / `"157 Karin"`, element Ventus / Umbra): added **2026-04-16** (commit `a087da7c`, "temp 1.9"), removed **2026-07-24** (commit `9a498a99`, "sync").
- **Char 162 `unreleased.json` entry** (name `"162 "` = still `???`, star 0, element "Ventus" — an **artifact** of generic material id 20043, not the real element): present in commit `eff8411c`, dated **2026-06-30** ("fix unrelease").
- **Karin hit data** (`HitDamage.json` `157*`): snapshot `22217991`, dated **2026-06-30** — used for the CRC32 resolution in Step 4.
- **Skill ids** (`15710000` etc.): from `EN/bin/Skill.json` at `22217991`, dated **2026-06-30**.
- Current datamine HEAD is `583c2eab`, dated **2026-07-26**; `unreleased.json` is empty and no 137/157/162 tables remain — the auto-update strips unreleased content, so check history before assuming the current tree has anything.

---

## Output document conventions

The final reference doc (`docs/karin-eleanor-pots.md`) must follow these rules:

- No `**` anywhere.
- Titles use a single `#` (e.g. `# Karin (157, Umbra)`, `# Base skills`, `# Main-control potentials`).
- Build subtitles are plain lines flush against the bullets — no blank lines around `Build 1` / `Build 2` / `Generic`.
- Write "AddAttr" for `OnceAdditionalAttribute` grants — never "extra attribute".
- Write "self buff" for buffs that apply only to the character herself.
- Label potentials as `P1`, `P2`, ... (no `513701 (P1)`). The core potentials `P1`, `P2`, `P3`, `P4`, `P21`, `P22`, `P23`, `P24` use `= P#` as the bullet marker (they are "special"); the rest use `- P#`.
- Include everything knowable per potential: trigger tags, buff ids, AddAttr ids, param ids, area-effect keys, cooldowns, and apply/proc mark notes.
- Include a `# Base skills` section (normal attack, main skill, ultimate, support skill) with the same per-skill mark annotations; no separate Dodge or Marks lines unless asked.
- Class guess is one line under the character heading, e.g. `Class guess: Vanguard — procs the Dark mark (Main Skill, P4 chain tick) and never applies one.` No pattern explanation — the reader already knows it.
- Mark unresolved values "id not wired yet".
- Do not add a `# Minion combat overview`. Treat `useSummonHit = false` as ordinary minion-origin behavior and omit it; also omit any explanation when `useSummonHit = true`.
- Don't be overly technical, only refer to the code to offer additional informations, for example variable names or strings that can help to understand the objective of the code.|
- This needs to be a short document, don't overexplain things.

---

## Add missing mechanics

If a character has a persistent state machine, gauge, special target, summon, stance, or other mechanic that cannot be explained clearly as part of one skill, add a separate subsection after `# Base skills`. The subsection should explain the state, how it is filled or applied, the threshold or condition that changes state, what action consumes or clears it, and which skills or potentials interact with it. Do not infer a numeric maximum from the presence of a stack buff: resolve the buff definition if possible, and mark the maximum as unknown when only `HaveBuffNumMax(...)` is visible in the hotfix.

### Example: Karin's energy gauge

Karin's gauge is implemented as stacks of self-buff `15790011`, not as the generic `PlayerSkillCd` energy field. `Config_MainControl` names it `buffId_Energy`, sets the interval to `1` and the increment to `10` (`1.13/Hotfix.decompiled.cs:681562-681568` = `1.14/Hotfix.decompiled.cs:687406-687411`; absent in `0.5/`):

```csharp
public const int buffId_Energy = 15790011;
public static readonly FP addBuffInterval_Energy = 1;
public const int addBuffNum_Energy = 10;
```

The main-control action adds 10 stacks whenever its one-second timer expires (`1.13/Hotfix.decompiled.cs:681927` `AddBuffNum(15790011, 10, ...)` = `1.14/Hotfix.decompiled.cs:687758`):

```csharp
_actor.buffComponent.AddBuffNum(15790011, 10, _actor);
```

When the buff reaches its configured maximum, the buff-get listener binds the Normal button to special skill `15710001` (`1.13/Hotfix.decompiled.cs:682119` `HaveBuffNumMax(15790011)` = `1.14/Hotfix.decompiled.cs:687891`; the maximum itself lives in the `Buff` table, not in the hotfix). In `1.14` the gauge also seeds `100` stacks at enable when `ActorStatus.Default` (`1.14/Hotfix.decompiled.cs:687890-687891`), which `1.13` does not do. Report the visible behavior as "fills by 10 stacks per second and activates at the buff's configured maximum," unless the `Buff` entry for `15790011` is found.

The special normal attack consumes the gauge at skill enable, restores the ordinary Normal skill `15710000`, and, if P4 is owned, applies `15704011` (`1.13/Hotfix.decompiled.cs:682398` `RemoveBuffByBuffId(15790011)` = `1.14/Hotfix.decompiled.cs:688254`):

```csharp
_actor.buffComponent.RemoveBuffByBuffId(15790011);
_actor.GetLogicComponent<PlayerSkillCd>()?.BindSkillIdToButton(ActionKey.Normal, 15710000);
```

This is the complete mechanic to describe: passive stack gain -> maximum-stack conversion to a special Normal Attack -> gauge consumption and button reset. P4 also adds 10 gauge stacks every second while its hunting-chain hit loop is active (`1.13/Hotfix.decompiled.cs:682213` = `1.14/Hotfix.decompiled.cs:688055`), so that interaction belongs in the gauge subsection rather than being left as an unexplained P4 number. The `15790012` hunting mark and `15790013` self-buff are related target/state markers, but they are separate from the gauge and should not be renamed as energy (`1.13/Hotfix.decompiled.cs:681570-681572`/`682009-682017` = `1.14/Hotfix.decompiled.cs:687414-687416`/`687825-687833`).

---

## Verification style

Ground every claim: `file_path:line_number` for the hotfix, table + key for the datamine, commit hash + date for git-history data, and quote the relevant line so it can be checked. When something is inferred (element, missing data, unresolved tags, lore), say so explicitly instead of asserting it.
