# HybridCLR Hotfix.dll decompilation

`Hotfix.dll` (from `Persistent_Store/Scripts/`) is the game's HybridCLR hot-update assembly — it contains the actual C# implementation of the **monster / trekker attack AI** (`AIScript.Monster.*`, `AIScript.Character.*`, `SkillSimpleBase`, etc.). The enemy skill logic that the combat logger sees ("enemy hit X with skillId Y") is executed here.

## Versioned decompilations

Each decompiled build lives in a versioned subfolder. Outputs per version:

- `Hotfix.decompiled.cs` — full decompiled C# (the checked-in artifact). Regenerate with `scripts/rerun.sh`, which decrypts `Hotfix.dll` and decompiles it with `ilspycmd` against the `DummyDll/` stubs in `decompilation/il2cppDumper_out`.

| Version | Source | Decompiled C# |
|---------|--------|----------------|
| `2.0.0/` | current game build (`Persistent_Store/Scripts/Hotfix.dll`, mtime Oct 19, `LOCAL_GAME_VERSION 2.0.0`; key check OK with the Jul 21 opcode table, no re-extract needed). **`GameAssembly.dll` changed this build** (md5 `be9c5f631fadbadf14a524c0a4aec4c2`, 126519808 B) → new AOT dump + fresh `DummyDll/` stubs in `decompilation/versions/2.0.0/dumper/`, which the C# was decompiled against | ~31.6 MB, 14948 TypeDef rows, 89334 method bodies, 4 residual type-resolution warnings; +8.9 MB / +338271 lines of C# vs 1.16.1, 53 new namespaces and 0 removed (`AIScript.Monster._72014KuiLeiShiTi`/`_72015KuiLeiBiaoQiang`/`_72016KuiLeiJuNu`/`_73001KuiLeiShi_Mainline`, `_31701MoFaZhen`/`_31801FeiLong`, `_70061WuYu.BigHeadGhost`/`BoomGhost`/`HorrorGhost`/`MageGhost`, `_90001SaoDiJiQiRen`/`_90013WuRenJi`, `AdventureBehaviour`, character `_16101` + its `FangWeiBiao`/`JuDian` summons, `_12101`, `AIScript.Soldier.SoldierPlayerPassive`) |
| `1.16.1/` | current game build (`Persistent_Store/Scripts/Hotfix.dll`, mtime Oct 4, `LOCAL_GAME_VERSION 1.16.1`; key check OK with the Jul 21 `GameAssembly.dll` opcode table, no re-extract needed; `GameAssembly.dll` itself byte-identical to 1.15, md5 `6c39fe8ed4109397d6841aae79c33860`, so no AOT re-decompile) | ~22 MB, 11731 TypeDef rows, 65411 method bodies; 1-line diff vs 1.16.0 (`TowerDefenseGameplayBase.OnPressUp`: `blockInput \|\| (dragState == None && mouseFollower.IsPointerOverClickableUI())` guard simplified to `blockInput`) |
| `1.16.0/` | previous game build (`Persistent_Store/Scripts/Hotfix.dll`, mtime Sep 29, `LOCAL_GAME_VERSION 1.16.0`; key check OK with the Jul 21 `GameAssembly.dll` opcode table, no re-extract needed; `GameAssembly.dll` itself byte-identical to 1.15, md5 `6c39fe8ed4109397d6841aae79c33860`, so no AOT re-decompile) | ~22 MB, 11731 TypeDef rows, 65411 method bodies, 4 residual type-resolution warnings; +183887 bytes of decompiled C# vs 1.15.1, EP9 content (EP9/GaoDa9_5 level+group controllers, `AIScript.Monster._31101GeLeiHuoEn`/`_18011LiMingFaShi`/`_30921JuJiShou`/`_31102LieQuan` 9_x skill sets, BossRush `_31301JiJuXie` ultra, trial levels 139 + skin-trial 126) |
| `1.15.1/` | previous game build (`Persistent_Store/Scripts/Hotfix.dll`, mtime Sep 18, `LOCAL_GAME_VERSION 1.15.1`; key check OK with the Jul 21 `GameAssembly.dll` opcode table, no re-extract needed) | ~22 MB, 11579 TypeDef rows, 64718 method bodies, 4 residual type-resolution warnings; +1955 bytes of decompiled C# vs 1.15, boss-logic-only diff (XiaoMoXiang/JuXingMoXiang joint-drill controller) |
| `1.15/` | previous game build (`Persistent_Store/Scripts/Hotfix.dll`, Sep 7; version string not embedded in the DLL this build — dated file, key check OK with the Jul 21 `GameAssembly.dll` opcode table) | ~22 MB, 11579 TypeDef rows, 5202 decompiled types, 0 IL errors, 4 residual type-resolution warnings |
| `1.14.1/` | previous game build (`Persistent_Store/Scripts/Hotfix.dll`, Aug 28, `GAME_VER 1.14.1` `RES_VER 2608281349`) | ~21 MB, 11035 TypeDefs, 0 IL errors, 4 residual type-resolution warnings |
| `1.14/` | previous game build (`Persistent_Store/Scripts/Hotfix.dll`, Aug 14) | ~21 MB, 11032 TypeDefs, 0 IL errors, 4 residual type-resolution warnings |
| `1.13/` | previous game build (`Persistent_Store/Scripts/Hotfix.dll`) | ~21 MB, ~4852 types, 0 IL errors, 4 residual type-resolution warnings |
| `0.5/`  | file in a beta version of the game | ~14.8 MB, decrypted with the 1.13 opcode table (key check OK); 123 residual `Unknown result type` comments — ILSpy stack-analysis edge cases on TrueSync/FP expressions (`iFP`/`TSVector2`), readable |

- `scripts/` — everything needed to re-run after a game update (decryptor, opcode-table extractor, one-shot `rerun.sh`). See `scripts/README.md`.

## How it's protected

The file is a `CDPH` container (Code Philosophy "Obfuz" + HybridCLR). The decryption is a tiny interpreted VM whose opcode semantics are **random per game build** — extracted from the game's `GameAssembly.dll` into `tools/cdph/opstable.json` (see `tools/cdph/cdph_dump.py` for the full reconstruction: VM reverse, key check, stream/TypeDef/IL layers).

## First attempt for a new Hotfix.dll

Do not decompile `decompiled.c` just to decompile `Hotfix.dll`. The relevant part of that C output — the opcode-table lookup and the `"Hello, HybridCLR"` key check — is the same in every version. Start by running the current decryptor with the existing `scripts/opstable.json`; the 256-byte key is read from `Hotfix.dll` itself and the key check confirms whether the current table works. Only reread the relevant `decompiled.c` code and re-extract the table if that attempt fails.

## Reproduce

Run `scripts/rerun.sh` (see `scripts/README.md`): it decrypts `Persistent_Store/Scripts/Hotfix.dll` with the CDPH decryptor and decompiles it with `ilspycmd`, using the `DummyDll/` stubs from `decompilation/il2cppDumper_out` (i.e. `decompilation/current/dumper/DummyDll`) as references. Without those stubs ILSpy can't resolve the game's AOT assemblies (`Game`, `GameFramework`, `TrueSync`, `spine-*`, Unity…) and emits ~70k "Unknown result type (missing references)" comments.

When the patch also ships a new `GameAssembly.dll` (as 2.0.0 did), the stubs must come from that build, not the old one: run `docs/ghidra.md` steps 0–1 (decrypt metadata + Il2CppDumper into `decompilation/versions/<ver>/`) and pass the result with `--dummy decompilation/versions/<ver>/dumper/DummyDll`, or point `decompilation/current` at the new version first. Stale stubs still decompile, but every type that changed shape shows up as a spurious `Unknown result type`.

## Why the decompile needs the DummyDll references

`Hotfix.dll` references the game's IL2CPP-compiled assemblies (`Game`, `GameFramework`, `TrueSync`, `spine-*`, `UIEffect`, ...) which are not shipped as managed DLLs. ILSpy alone shows `//IL_xxxx: Unknown result type (might be due to invalid IL or missing references)` on any call into them — the IL itself is valid, only the referenced types can't be resolved. Passing `decompilation/il2cppDumper_out/DummyDll` as a reference path fixes that (70k warnings → 4). The 4 remaining sit in one `FP <= FP` comparison pattern (`ILRuntimeAPI.CalcDistanceBetweenMonsterAndPlayer`) — an ILSpy stack-analysis edge case on TrueSync structs, still readable.

## Asset-bundle layer (hit timing / hitbox / weapons)

`Skill.json` / `HitDamage.json` only say *which* `HitDamageId`s are involved. *When* they hit and with what shape lives in Unity asset bundles in the install (`StellaSora_Data/StreamingAssets/InstallResource/`; 7213 `.unity3d`, `manifest.json` index):

- `AI.json:FCComboGroup = Character/<id>/Combos/ComboGroup_Char_<id>` → `char_<id>_combos.unity3d` (`ComboGroup_Char_*` + `ComboClip_*` monoBehaviours with `comboEventSkins[0].comboEvents[]`: `activeNormalizedTimeRange`, `hitBoxShape/Width/Length/Radius/Angle/Offset`, `hitDamageId`, `hitFlags` read at `decompiled.c:3425183` / `HitBox` tick  `decompiled.c:3551461`). Summons: `char_<id>_combos_monster.unity3d`, weapons: `char_<id>_weapons*.unity3d`, monster areas: `mons_*_areaeffect.unity3d`.

Extracted immutably under `../CombatAssetsBundles/extracted/<charId>/` (`155` for Shia) via `../CombatAssetsBundles/extract_combat_bundles.py` (UnityPy) and decoded in `*_summary.json` by `summarize_combos.py` (`time = nTime * animationLength / playSpeed`). See that folder's `ExtractCombatAssetsBundles.md` for the full mapping, filtering rationale (combat-only, no models/textures/fx) and `//100` id grouping.

## What you can now read

Monster attacks are driven by these tables (from `StellaSoraData .../CN/bin`): `MonsterAI.json` (`ActionAIPath` → the C# type here) and `MonsterActionBranch.json` (which `SkillId` fires when). The `SkillId` resolves into `Skill.json` → `FCPath` → a class like `AIScript.Monster._50161BianSuCiKe.Skill_Spin_Wind`, whose `DoMainLogic()` coroutine is the actual attack: `PlayEffect("SpinAttackFX")`, `BeginDashActorForward(...)`, `PlayAreaEffect("SpinAttackArea", GetPosition())`, `yield return WaitDashFinish()`, etc.
