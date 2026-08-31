# How to research a skill, potential, or disc

A practical guide for finding what a character's skill / potential / disc
actually *does* — from the aggregated datamine descriptions, down to the raw
data tables and the game code that executes them
Trust only the actual code, the descriptions are not reliable, in case the two disagree, explain me how they disagree.

---

## Glossary

- **Character** — a playable unit (trekker) with a fixed kit: a normal attack,
  a dodge, a main skill, a support skill, an ultimate, and a set of potentials.
- **Skill** — an ability the character casts in battle. Each character has
  several: normal attack, dodge, main skill, support skill, ultimate.
- **Potential** — a per-character unlockable node. Potentials either give the
  character a **new passive** or **enhance one of their skills** (e.g. "after
  casting the main skill, reload N rounds").
- **Disc** — a generic upgrade **equippable to any character** (like ZZZ's
  W-Engines / Star Rail's light cones). Discs are not tied to one character;
  their effects (main skill, support notes, stat rolls) apply whoever equips
  them.

---

## Resources

| # | Resource | What it gives you |
|---|----------|-------------------|
| 1 | `decompilation/hotfix/<version>/Hotfix.decompiled.cs` (default `1.14/` — see `decompilation/hotfix/README.md` and `docs/how-to-research-unreleased-characters.md` version table; `1.13/` previous, `0.5/` oldest) | The actual **C# implementation of each character's skills**. Each character's code lives in a namespace named `AIScript.Character._[characterid]01` (e.g. Amber → `AIScript.Character._10301`). This is the hot-update (HybridCLR) assembly, fully decompiled — always use `1.14/Hotfix.decompiled.cs` unless you need to match an existing citation or prove historical absence. |
| 2 | `decompilation/decompiled.c` | Ghidra **C decompile of the combat engine** (the AOT `GameAssembly.dll`): damage math (`CalculateNormalDamage`, `GetBothAllInfo`), effect lifecycle, attribute lists. For when you need to know *how* numbers are computed. |
| 3 | `decompilation/out_new` | **Il2CppDumper output** (`dump.cs` with every type, `DummyDll` stubs, `script.json`, `il2cpp.h`, `stringliteral.json`). Use it to resolve the C# names of the engine types, protobuf messages (e.g. `HitDamage`), and RVAs. |
| 4 | `/home/morph/StellaSoraData` | A separate **datamine project** that dumps and aggregates the game's config tables (`EN/bin/*.json`, `CN/bin/*.json`, ... + translated language files under `EN/language/en_US/`). A lot of useful information here, if you find an id, searching in here will give you the raw data tables. |
| 5 | `character.json` | **Aggregated description of every character**: their skills, potentials, talents, and fixed stats, with EN/CN/JP/KR text and the effect params already resolved to tooltips. Start here. |
| 6 | `disc.js` | **Aggregated description of every disc** and its effects. Run it (`node disc.js`) to regenerate `disc.json`; the raw tables are `EN/bin/Disc*.json`. |
| 7 | `EN/bin/HitDamage.json` | **Per-hit data**: each hit entry (id) stores base/Skill/Talent percent & abs amend tables, distance/damage/element type, damage tags, energy charge, etc. A skill's hit is referenced by id. |
| 8 | `EN/bin/EffectValue.json` | **Per-effect data**: the actual effect numbers (effect type/subtype + up to 7 params) behind a skill/potential/buff. |
| 9 | `EN/bin/Buff.json` | **Per-buff data**: buff id, tags, icon, whether it's visible/stacking. Buff *values* live in `BuffValue.json`. |
| 10 | `characterid.json` | **Name → id resolver.** When you say a character's name, look the id up here (e.g. `Amber` → `103`) and use it everywhere below. |
| 11 | `decompilation/CombatAssetsBundles/` | **Asset-bundle extraction:** `AI.json:FCComboGroup` → actual combo clips / hitbox timing (`activeNormalizedTimeRange`, `hitBoxShape…`, `hitDamageId`) from the install's `StreamingAssets/InstallResource/*.unity3d` (`char_*_combos.unity3d`, `char_*_weapons.unity3d` …). Use `extract_combat_bundles.py` + `summarize_combos.py` to get `extracted/<charId>/` JSON — the authoritative hit schedule, not the `Skill.json` `HitDamage` list alone. |


---

## Quick workflow

1. **Resolve the character id** — look the name up in `characterid.json`.
2. **Read the aggregated description** — open `character.json` → `[id]` and read `normalAtk`, `skill`, `supportSkill`, `ultimate`, `potential`.
3. **Dig into the raw tables** for exact numbers.
4. **Read the real implementation** in `Hotfix.decompiled.cs` under `AIScript.Character._[id]01`.
5. **If you need combat math** — check docs/damage_flow_analysis.md grep `decompiled.c` / `out_new/dump.cs`.

The rest of this doc walks each step and explains how the ids connect.

---

## Step 1 — Resolve the character id

`characterid.json` maps name → numeric id. `103` → Amber, `135` → Mystique, etc.

```
{
  "103": "Amber",
  ...
  "135": "Mystique"
}
```

If it is not present, check the unreleased.json, and the git history of both these files.

This id is the root key of everything character-specific:

- `character.json["103"]`
- the C# namespace `AIScript.Character._10301`
- the leading `103` of every skill / hit / effect / buff id that belongs to Amber
  (e.g. normal attack `10310000`, hit `103100001`, effect `10350111`).

---

## Step 2 — Aggregated descriptions (`character.json`)

Each entry looks like:

```jsonc
{
  "id": 103,
  "name": "Amber",
  "star": 4, "element": "Ignis", "class": "Vanguard",
  "normalAtk":  { "id": 10310000, "name": "Duet",          "params": ["9.9%/.../25.7%"], ... },
  "skill":      { "id": 10331000, "name": "Fireworks Jam", "params": ["46%/.../119%", ...], ... },
  "supportSkill": { "id": 10332000, "name": "Bullet Waltz", ... },
  "ultimate":   { "id": 10340000, "name": "Spark of Finality", ... },
  "potential": {
    "mainCore":     [ { "id": 510301, "name": "Dominant Firepower", "params": ["50%"] } ],
    "mainNormal":   [ ... ],
    "supportCore":  [ ... ],
    "supportNormal": [ ... ],
    "common":       [ ... ]
  },
  "talent": [ { "name": ..., "boost": ... } ]
}
```

Notes:

- **Skills** — `id`, translated `name`/`desc`, `damageType`, `effectType`,
  `params` (the `&ParamN&` values from the description, one entry per level
  breakpoint) and `paramsTooltips` (what each param maps to).
- **Potentials** — grouped by slot (`mainCore`, `mainNormal`, `supportCore`,
  `supportNormal`, `common`). Each is an id + name + translated desc + params.
- The datamine scripts (`character.js`) resolved `&ParamN&` placeholders
  against the raw tables, so the desc + params here are already human-readable.

---

## Step 3 — Drill into the raw tables

### Skill → hit damage

`Skill.json` is the hub. It maps a skill id to its implementation and its hits:

```jsonc
"10331000": {
  "Id": 10331000,
  "FCPath": "AIScript.Character._10301.SkillScript_B1_Skill",  // → C# class, see Step 4
  "Type": 3,                                                   // 3 = main skill, 5 = ult, 6 = dodge
  "Param1": "HitDamage,DamageNum,103310002"                    // → HitDamage.json id
}
```

The `ParamN` strings encode lookups into other tables. `HitDamage,<field>,<id>`
means: open `HitDamage.json[id]` and read that field. `103310002` is the hit
entry for Amber's main skill:

```jsonc
"103310002": {
  "Id": 103310002,
  "DamageType": ...,        // enum, resolve via EffectType/damage docs
  "ElementType": ...,       // Ignis etc.
  "SkillPercentAmend": [ ... ],  // % of ATK at each skill level
  "SkillAbsAmend": [ ... ],      // flat bonus per level
  "TalentPercentAmend": [ ... ], // potential-scaled %
  "EnergyCharge": ...,
  ...
}
```

### Effect / buff data

Skills and potentials also reference **effects** and **buffs**:

```jsonc
// Potential.json (raw) → Param1 tells you where the number lives:
"510301": {
  "Id": 510301, "CharId": 103,
  "BriefDesc": "Potential.510301.1",
  "Param1": "EffectValue,NoLevel,10350111,EffectTypeParam1,HdPct"
}

// EffectValue.json
"10350111": {
  "Id": 10350111,
  "EffectType": 12,
  "EffectTypeFirstSubtype": 56,   // attribute/effect category
  "EffectTypeSecondSubtype": 1,
  "EffectTypeParam1": "0.5"       // the actual number (50% here)
}
```

The lookup format is roughly
`<table>,<no-level?,value>,<tableId>,<field>,<format>` — i.e. for Amber's
potential: go to `EffectValue.json[10350111]`, read `EffectTypeParam1` = `0.5`,
format as percent → `50%` (matches `character.json`).

**Buff chain**: an `EffectValue` often applies a buff whose id appears in the
skill's/effect's params or in `Buff.json`:

- `Buff.json` — metadata (tags, icon, visibility).
- `BuffValue.json` — the buff's stat changes/numbers.

**Effect type decode**: the numeric `EffectType` / subtypes are documented in
`docs/Enums.md`. `docs/damage_flow_analysis.md` and
`docs/HitboxAreaHits.md` explain how effects/attributes/snapshots flow through
combat.

---

## Step 4 — The actual implementation (`Hotfix.decompiled.cs`)

This is the *authoritative* source for what a skill does frame by frame.

- Every character has a namespace `AIScript.Character._<id>01`
  (see the `FCPath` from `Skill.json`). Amber → `AIScript.Character._10301`.
- `Skill.json["FCPath"]` tells you exactly which class implements a skill:

```
10310000 → AIScript.Character._10301.SkillScript_NormalAttack   (Type 1)
10320000 → AIScript.Character._10301.SkillScript_Dodge          (Type 6)
10331000 → AIScript.Character._10301.SkillScript_B1_Skill       (Type 3, main)
10332000 → AIScript.Character._10301.SkillScript_B2_Skill       (Type 4, support)
10340000 → AIScript.Character._10301.SkillScript_Ultra          (Type 5, ultimate)
```

- Inside the namespace you'll find the `ActionBehaviour`/`Action` class and the
  `SkillScript_*` classes. The `SkillScript_*` classes hold the real logic:
  which effects they play, the buffs they apply, when they hit.
- If a skill has an unusual mechanic (a dash, a counter, a summon), the code
  here is where it's actually spelled out — the datamine tables only describe
  numbers and generic effects.
- The file is a decompile of the HybridCLR hot-update DLL. See
  `decompilation/hotfix/README.md` for how it was produced and how to
  re-decompile it after a game update.

---

## Step 5 — Asset bundles (the other half of the implementation)

`Skill.json` / `HitDamage.json` only say *which* `HitDamageId`s a skill may use.
*When* they actually fire, the hitbox shape, active duration and projectile
spawning live in Unity asset bundles in the install, not JSON:

- `AI.json:FCComboGroup = Character/<id>/Combos/ComboGroup_Char_<id>` →
  `char_<id>_combos.unity3d` (`ComboGroup_Char_*` + `ComboClip_*` monoBehaviours
  with `comboEventSkins[0].comboEvents[]`: `activeNormalizedTimeRange`,
  `hitBoxShape/Width/Length/Radius/Angle/Offset`, `hitDamageId`, `hitFlags`
  — read at `decompiled.c:3425183` / ticked at `3551461`).
  Summons: `char_<id>_combos_monster.unity3d` (same structure).
- Weapon / bullet prefabs: `char_<id>_weapons.unity3d` (+ `weapons_monster`)
  — `AdventureWeapon.Setup` / `ILRuntimeAPI.Shoot` spawn configs.
- Monster area effects: `mons_*_areaeffect.unity3d`.

Install on this box: `Link to YostarGames/StellaSora_EN/StellaSora_Data/StreamingAssets/InstallResource/` (7213 `.unity3d`, `manifest.json`/`file_versions.dat` index). See
`decompilation/CombatAssetsBundles/ExtractCombatAssetsBundles.md` for the exact
mapping and the allowed combat-only extraction (109 bundles → `extracted/<charId>/`, `155` for Shia). The scripts `extract_combat_bundles.py` (UnityPy) + `summarize_combos.py`
decode FP (`_serializedValue / 2**32`) into `*_summary.json` (`time = nTime * animationLength / playSpeed`). Until these events drive `SimulationEngine` at `LockStep 1/30`, `HitRepeatCatalog` was the guess for normal-attack timing — now removed.

## Step 6 — Combat engine (C) & Il2Cpp dumps

When you need to know *how the damage/effect is computed* (not just what it is):

- **`decompilation/decompiled.c`** — Ghidra C output. Grep for the relevant
  symbols (`AdventureEffect__Execute`, `AttributeList__GetAttributeValue`,
  `CommonHelper__CalculateNormalDamage`, `AdventureActor__GetBothAllInfo`, ...).
  Line numbers / RVAs for the current binary are listed in
  `docs/damage_flow_analysis.md` §7–8.
- **`decompilation/out_new`** — Il2CppDumper output:
  - `dump.cs` — every type from every assembly (`Game.dll`, `GameFramework.dll`,
    ...) with their field layout and protobuf messages (e.g. the `HitDamage`
    protobuf). Use it to name the structs behind `decompiled.c`.
  - `DummyDll/` — stub assemblies ILSpy needs to decompile `Hotfix.dec.dll`.
  - `script.json` — name → RVA map used by the logger's hooks.
- Pipeline notes: `docs/il2cpp-ghidra-pipeline.md`.

---

## Step 7 — Discs

Discs are **not** character-specific; research them from the datamine:

- `disc.js` regenerates `disc.json` from the raw tables
  (`Disc.json`, `DiscIP.json`, `DiscTag.json`, `DiscPromote.json`,
  `MainSkill.json`, `SecondarySkill.json`, `SubNoteSkill.json`, ...).
- Each disc entry in `disc.json` has:
  - `mainSkill` — the equipped main skill (with its own effect/params).
  - `supportNote` — support notes granted at note levels.
  - `stat` — per-level stat rolls (HP/ATK/...).
  - `tag` / `element` / `star` for set/roll filtering.
- The effect ids inside a disc's main skill resolve the same way as character
  skills: `Effect.json` → `EffectValue.json` → `Buff.json`/`BuffValue.json`.
- There is no `AIScript.Character` namespace for discs — their *generic* skill
  logic lives in the `AIScript.*` common code in `Hotfix.decompiled.cs` and the
  engine in `decompiled.c` (see the `SkillSimpleBase` / `AIScript.Skill*`
  classes).

---

## Worked example: Amber's "Fireworks Jam"

1. **Id**: `characterid.json` → `Amber` = `103`.
2. **Description**: `character.json["103"]["skill"]` → "Fireworks Jam",
   id `10331000`, desc with `&Param1& x2` / `&Param2& x4` AoE Ignis skill DMG,
   params per level.
3. **Raw hit**: `Skill.json["10331000"]["FCPath"]` →
   `AIScript.Character._10301.SkillScript_B1_Skill`, and
   `Param1: HitDamage,DamageNum,103310002` → `HitDamage.json["103310002"]` for
   the exact `SkillPercentAmend` numbers per level.
4. **Effect**: the desc's "ATK up" part → `EffectValue.json` (or the buffs in
   `Buff.json`/`BuffValue.json`) — e.g. `10331001` (`EffectTypeParam1: 0.25`).
5. **Implementation**: open `Hotfix.decompiled.cs`, jump to
   `namespace AIScript.Character._10301`, read `SkillScript_B1_Skill` — the
   sweeps, the reload mechanic, the buff application.
6. **Damage math**: if needed, `decompiled.c` →
   `CommonHelper__CalculateNormalDamage` / `AdventureActor__GetBothAllInfo` with
   types from `out_new/dump.cs`.

---

## Handy lookups

- `docs/Enums.md` — damage/effect/attribute enum decode + damage formula.
- `docs/damage_flow_analysis.md` — how effects & attribute snapshots flow.
- `docs/HitboxAreaHits.md` — hitbox / area-hit resolution.
- `docs/il2cpp-ghidra-pipeline.md` — decompile pipeline for `decompiled.c`.
- `decompilation/hotfix/README.md` — how `Hotfix.decompiled.cs` was made.
