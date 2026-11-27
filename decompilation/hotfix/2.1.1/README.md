# 2.1.1

Game version `2.1.1` (`prefs.dat` `LOCAL_GAME_VERSION 2.1.1`, `LOCAL_CLIENT_VERSION 2.0.0`, install updated 2026-11-27). Mirrors `2.1.0b/`.

## Inputs

- `Hotfix.dll` — `Persistent_Store/Scripts/Hotfix.dll`, md5 `ddb199640bd9000ecfb1741dbcf86f5c`, 17677800 B, mtime 2026-11-25 18:03. Differs from 2.1.0b (`6104bb68d7d32eaebb50bf7f227d4fe9`, 17677152 B) → **new build**, `$RES_VER:2611251801`, `$GAME_VER:2.1.1`.
- `Hotfix.dec.dll` — `scripts/cdph_dump.py --opstable scripts/opstable.json`, key check OK (same opcode table, no re-extract). md5 `b3864227579308d0e309059f903cd7c9`, 17677800 B.
- `Hotfix.decompiled.cs` — `ilspycmd` 10.1.1.8388, md5 `bcb10eda4b5bd2d1887a872cb08bbff4`, 31888984 B / 1147983 lines.
- Reference stubs: `decompilation/versions/2.0.0/dumper/DummyDll` (via `decompilation/il2cppDumper_out`). The install's `GameAssembly.dll` is still md5 `be9c5f631fadbadf14a524c0a4aec4c2`, byte-identical to 2.0.0 — no new `versions/` folder, no opcode-table re-extract.

## Counts

`TypeDef` rows **15008** (unchanged), method bodies **89791** (+3 vs 2.1.0b), 0 namespaces added/removed (431 both), no new `AIScript.Character._<id>` namespace → no new playable character.

Diff vs `2.1.0b/Hotfix.decompiled.cs`: **30 hunks, +123 / −84 lines** — a tuning hotfix, not a content patch.

## Combat-relevant

- **`AIScript.Monster._30931HaSaNa`** — boss-rush kit wired to real buffs: `Parallel_BossRush.buff_8`/`buff_9` are no longer `0` but `631029010` / `631029020`, and `SkillScript_DustSpraying` / `_Burrow` / `_DustExplosion_Transform` now add and remove those ids instead of `AddBuff(0)` / `RemoveBuffByBuffId(0)`. `HasActiveShield(actor)` grew an `excludeShieldId` parameter so the shield check ignores its own shield (`SkillScript_Burrow` passes `adventureActorRemoveShield.shieldId`).
- **`AIScript.Monster._Wind._50301MaoDa`** — `Wind_Action_Lv2_TraceHunt` / `_TraceHuntHard`: `Stage2RequireLevel` 10 → 15, `initCd9` 30 → 0, and the `GotoCastskill(Skill_Attack05)` call is gone.
- **`AIScript.Monster._50581DuoBiTaiDeng`** — one `Parallel_BossRush` hunk (same shape as HaSaNa's).
- **`AIScript.Character._16101` (Leafia)** — `Config.rotationSpeed` 60 → 90 (the mainline/else branch that hardcoded 90 is now one `BeginLookAtMonsterTarget(duration − 1, rotationSpeed)` call); `Summoned.JuDian` area-effect tuning: `AreaEffectCount_Follow` 15 → 12, `BlastTimes_Follow` 4 → 8, `BlastInterval_Follow` 4.5 → 1.5, `BlastTimes_Outside` 3 → 5, `BlastInterval_Outside` 6 → 3, `BlastTimes_Spin` 12 → 8, `BlastRadius_Spin` 7.5 → 6.25, and the per-device `addAreaEffectCount_Spin` scaling plus the `chargeCount >= 3` follow-up explosion were removed.
- `MonsterSummonData` — two data-field hunks (summon table reshape).

## Non-combat

- `AdventurePlayerController.InputEnable()` block re-ordered inside the same guard.

**No logger hook target changed** (`Hook_BuffEntityExcute`, `HY_BuffEntityExcute`, `Hook_HitDamage`, the area-effect and attribute hooks are untouched).
