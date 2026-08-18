# HybridCLR Hotfix.dll decompilation

`Hotfix.dll` (from `Persistent_Store/Scripts/`) is the game's HybridCLR
hot-update assembly — it contains the actual C# implementation of the
**monster / trekker attack AI** (`AIScript.Monster.*`, `AIScript.Character.*`,
`SkillSimpleBase`, etc.). The enemy skill logic that the combat logger sees
("enemy hit X with skillId Y") is executed here.

## Versioned decompilations

Each decompiled build lives in a versioned subfolder. Outputs per version:

- `Hotfix.dec.dll` — the decrypted .NET assembly (load it in dnSpy / ILSpy /
  ilspycmd). Produced by `tools/cdph/cdph_dump.py`.
- `Hotfix.decompiled.cs` — full decompiled C#. Produced with:
  `ilspycmd -r <Il2CppDumper>/out_new/DummyDll Hotfix.dec.dll -o .`.

| Version | Source | Decompiled C# |
|---------|--------|----------------|
| `1.14/` | current game build (`Persistent_Store/Scripts/Hotfix.dll`, Aug 14) | ~21 MB, 11032 TypeDefs, 0 IL errors, 4 residual type-resolution warnings |
| `1.13/` | previous game build (`Persistent_Store/Scripts/Hotfix.dll`) | ~21 MB, ~4852 types, 0 IL errors, 4 residual type-resolution warnings |
| `0.5/`  | `/home/morph/Downloads/Hotfix.dll` | ~14.8 MB, decrypted with the 1.13 opcode table (key check OK); 123 residual `Unknown result type` comments — ILSpy stack-analysis edge cases on TrueSync/FP expressions (`iFP`/`TSVector2`), readable |

- `scripts/` — everything needed to re-run after a game update (decryptor,
  opcode-table extractor, one-shot `rerun.sh`). See `scripts/README.md`.

## How it's protected

The file is a `CDPH` container (Code Philosophy "Obfuz" + HybridCLR). The
decryption is a tiny interpreted VM whose opcode semantics are **random per
game build** — extracted from the game's `GameAssembly.dll` into
`tools/cdph/opstable.json` (see `tools/cdph/cdph_dump.py` for the full
reconstruction: VM reverse, key check, stream/TypeDef/IL layers).

## First attempt for a new Hotfix.dll

Do not decompile `decompiled.c` just to decompile `Hotfix.dll`. The relevant
part of that C output — the opcode-table lookup and the `"Hello, HybridCLR"`
key check — is the same in every version. Start by running the current
decryptor with the existing `scripts/opstable.json`; the 256-byte key is read
from `Hotfix.dll` itself and the key check confirms whether the current table
works. Only reread the relevant `decompiled.c` code and re-extract the table if
that attempt fails.

## Reproduce

```
python3 ../../tools/cdph/cdph_dump.py "<game>/Persistent_Store/Scripts/Hotfix.dll" -o Hotfix.dec.dll
# DummyDll = Il2CppDumper stubs for the game's AOT assemblies (Game, GameFramework,
# TrueSync, spine-*, Unity...). Without them ILSpy can't resolve referenced types
# and emits ~70k "Unknown result type (missing references)" comments.
~/.dotnet/tools/ilspycmd -r "<Il2CppDumper>/out_new/DummyDll" Hotfix.dec.dll -o .
```

## Why the decompile needs the DummyDll references

`Hotfix.dll` references the game's IL2CPP-compiled assemblies (`Game`,
`GameFramework`, `TrueSync`, `spine-*`, `UIEffect`, ...) which are not shipped
as managed DLLs. ILSpy alone shows `//IL_xxxx: Unknown result type (might be
due to invalid IL or missing references)` on any call into them — the IL itself
is valid, only the referenced types can't be resolved. Passing
`Il2CppDumper/out_new/DummyDll` as a reference path fixes that (70k warnings →
4). The 4 remaining sit in one `FP <= FP` comparison pattern
(`ILRuntimeAPI.CalcDistanceBetweenMonsterAndPlayer`) — an ILSpy stack-analysis
edge case on TrueSync structs, still readable.

## What you can now read

Monster attacks are driven by these tables (from `StellaSoraData .../CN/bin`):
`MonsterAI.json` (`ActionAIPath` → the C# type here) and
`MonsterActionBranch.json` (which `SkillId` fires when). The `SkillId`
resolves into `Skill.json` → `FCPath` → a class like
`AIScript.Monster._50161BianSuCiKe.Skill_Spin_Wind`, whose `DoMainLogic()`
coroutine is the actual attack: `PlayEffect("SpinAttackFX")`,
`BeginDashActorForward(...)`, `PlayAreaEffect("SpinAttackArea", GetPosition())`,
`yield return WaitDashFinish()`, etc.
