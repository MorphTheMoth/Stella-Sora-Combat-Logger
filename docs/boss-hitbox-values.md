# Boss hitbox values (r / h / centerY)

How to get the boss hurtbox radius for a new Blitz / Finale Echoing boss.

## 1. Resolve boss -> model

- `Link to StellaSoraData/EN/bin/ScoreBossControl.json`: find the season (`Id`), read `LevelGroup` (e.g. season 11 = `[24, 25]`).
- `Link to StellaSoraData/EN/bin/ScoreBossLevel.json`: match `Id` in that group -> `MonsterId` (e.g. floor 24 = `6310220`).
- `Link to StellaSoraData/EN/bin/Monster.json`: `MonsterId` -> `FAId` (e.g. `3130101`).
- `Link to StellaSoraData/EN/bin/MonsterSkin.json`: `FAId` -> `Model` (e.g. `Actor/Monster/31301JiJuXie/31301JiJuXie_Actor`), plus `ModelScale` and `ColliderScale` (in myriad, /10000).
- Bundle name is `mons_<3rd model path segment lowercased>.unity3d` (e.g. `mons_31301jijuxie.unity3d`) in `Link to YostarGames/StellaSora_EN/StellaSora_Data/StreamingAssets/InstallResource/`.

## 2. Read the collider

The hurtbox is the `CapsuleCollider` on the GameObject whose name equals the last model segment (`..._Actor`). Ignore the `Green` capsules on child bones.

```python
import UnityPy, os
base="/home/morph/stella sora meter/Link to YostarGames/StellaSora_EN/StellaSora_Data/StreamingAssets/InstallResource"
env=UnityPy.load(os.path.join(base,"mons_31301jijuxie.unity3d"))
gname={o.path_id:o.read().m_Name for o in env.objects if o.type.name=="GameObject"}
for o in env.objects:
    if o.type.name=="CapsuleCollider":
        d=o.read_typetree()
        if gname.get(d['m_GameObject']['m_PathID'])=="31301JiJuXie_Actor":
            print(d['m_Radius'], d['m_Height'], d['m_Center']['y'], d['m_Direction'])
```

- `raw r` = `m_Radius`
- `h` = `m_Height` (total, includes both caps; cylinder length = `max(0, h-2r)`; `h<=2r` means sphere)
- `centerY` = `m_Center.y` (capsule spans `centerY ± h/2`)
- `m_Direction` is `1` (Y) for every boss here

## 3. Scales

`world r = raw r * ModelScale * ColliderScale` (full precision; `ModelScale`/`ColliderScale` are the `/10000` values from `MonsterSkin`). `ColliderScale` is 1.0 for almost everything; check the hotfix for script overrides:

```bash
grep -n "colliderScale" decompilation/hotfix/<version>/Hotfix.decompiled.cs
grep -n "TransformByModelName(\|ChangeModelScale(" decompilation/hotfix/<version>/Hotfix.decompiled.cs
```

Known override: `SkillScript_BeginTransform_Transform` (`_BossID` 6310130/6310190) sets `colliderScale = 3f` for the "Shajuren" form (raw `0.75` -> `2.25`), and sets it before `ChangeModelScale(1.4)`.

Caveats (see conversation history / `decompilation/decompiled.c`):

- The runtime value is `DeterministicCollider._radius`, built in `DeterministicCollider_LoadFromUnityCollider` as `capsuleRadius * colliderScale * transform.lossyScale`. `AdventureActor_OnModelScaleChanged` scales the transform but does NOT rebuild the collider; only `OnColliderScaleChanged` / `OnInit` do. So a visual-only model scale change does not change the hurtbox.
- Whether the base-load rebuild samples `ModelScale` or the prefab's baked local scale is not fully verified; for every boss except Lithe Beauty (`1.2`) and Celsia (`2.0`) they are equal. Furious Stomper Crab has both = 1.8, so `raw 1.00 -> world 1.80`.
- `CheckCircleOverlapCollider` uses the target's `_radius`; `AreaEffectEntity_HitWithOwnerRadius` instead uses `caster.dtCollider.Radius + hitRadiusAmend`, so area-effect hit size is not the target's radius.
