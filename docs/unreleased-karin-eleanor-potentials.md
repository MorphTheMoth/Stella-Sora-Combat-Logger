# Karin & Eleanor — unreleased character potential breakdown

Both characters are unreleased (no current datamine entries; full code lives in
the hotfix: `_15701` at `Hotfix.decompiled.cs:680972-682838`, `_13701` at
`:708314-709935`). Reconstructed from code; buff/AddAttr ids still `0`-stubbed
in the shipped build are marked "id not wired yet". Mark annotations: "procs"
means the skill/potential's hits carry the element-mark trigger tag — Karin's
resolved from the datamine history (hit tags are CRC32-hashed), Eleanor's from
code paths.

Elements: Karin = Umbra (Dark), Eleanor = Ventus (Wind).

---

# Karin (157, Umbra)
Class guess: Vanguard — procs the Dark mark only (Main Skill, P4 chain tick); no apply path anywhere, all three commons are self/Ultimate buffs, and team-wide buff count (2) is far below Support's 5-15.

# Base skills
- Normal Attack (`15710000`) — randomly picks one of 2 combo stages (`Atk1`/`Atk2`) and fires a fish bullet `Bullet_157_NrmAtk_1` from an offset; with P3 vs the Hunting target it becomes `Atk_P3` and fires up to 4 fish bullets scaled by stacks.
- Main Skill (`15731000`, `Skill_Main`) — gains super armor (buff `1004`), then launches a flying blade at the target that detonates (`AreaEffect_157_SkillMain_ShotBoom`); its hits carry the `157DarkTagTrigger` tag and proc the Dark mark.
- Support Skill (`15732000`, `Skill_Sup`) — fires fish bullets from 4 flanking positions/angles and re-acquires the main trekker's target.
- Ultimate (`15740000`, `Ultra_TL`/`Ultra_NoTL`) — invincible, super-armored, immune to control; as the AI assist it traces the active player's target.

# Main-control potentials
Build 1
= P1 — on your own `"157FishAtk"`-tagged hits (internal CD via param `15701011`) triggers the AoE `AreaEffect_157_P1_FishAtk` at the target.
= P2 — when the Main Skill ends, grants self buff `15702011`, which spawns the FishOverload companion (`157SkillMainP2FishObject`): it orbits Karin (radius 4, 180°/s), and every 1s darts out toward the target, spawning `AreaEffect_157_P2_FishAtk` after 0.4s, lingering 0.2s, then returning. Effect ends with the buff.
- P5 — every 5th SKILL-type damage instance (CD via `15705011`) triggers `AreaEffect_157_P5_FishAtk` at a random point in a radius-3 circle around the target.
- P6 — `"157FishAtk"`-tagged hits grant self buff `15706011`.
- P7 — `"157FishAtk"`-tagged hits on a monster carrying the Dark Chain debuff (buffTag `"DarkAnSuo"`, buffs `5031`+`5041`) grant an AddAttr (`15707001`).
Build 2
= P3 — on marking a Hunting target: grants 3 stacks of self buff `15703011` (one decays every `15703011` seconds) plus self buff `15703012`. Vs the Hunting target the normal attack becomes `Atk_P3`; the `"157pugong"` shot and the `"157diaoshe"` volley fire 1–4 fish bullets (`Bullet_157_NrmAtk_1` / `Bullet_157_P3_DiaoShe1-4`) at offsets/random points scaled by current stacks.
= P4 — the Hunting chain link (FX `157_SuoLian_P4`) becomes damaging: while linked, every 1s it does a `RectangleAreaHit` (`hitDamageId 157300005`, width 2) along the link, grants +10 Energy, and extends the Hunting mark duration (`15704011`); the chain tick hit also carries `157DarkTagTrigger` and procs the Dark mark.
- P8 — when the Hunting target changes, triggers `AreaEffect_157_P8_HuntBreak` at the old target and grants self buff `15708011`.
- P9 — any hit (no tag gate) on a Dark-chained monster grants an AddAttr (`15709001`).
- P10 — triggering the Dark mark specifically on your current Hunting target grants self buff `15710011`.
Generic
- P11 — triggering any Dark mark grants self buff `15711011`.
- P12 — +1 dodge charge via `SetSkillTotalSection(A, original+1)` and grants self buff `15712011` whenever the dodge skill is enabled (`:681078`, `:682057`).
- P13 — all-Umbra squad → grants buff `15713011` on every Umbra ally.

# Support potentials
Build 1
= P21 — support bullets upgraded to `Bullet_157_Skill_Sup_P21_Fish1` (and with P25 → `..._P21_Fish1_P25`).
= P22 — `"157SkillSupFishAtk"`-tagged hits toggle debuff `15721011` on the monster; if it's already marked, the mark is removed and the monster is hit with `hitDamageId 157300014` (`fx_15701_hit_ToothBoom`) — a detonate-once pattern.
- P25 — `"157FishAtk"`-tagged hits grant an AddAttr (`15725001`); also upgrades support bullets.
- P26 — `"157FishAtk"`-tagged hits grant self buff `15726011`.
- P27 — `"157FishAtk"`-tagged hits on Normal or Elite monsters grant an AddAttr (`15727001`).
Build 2
= P23 — support combo upgraded to `Skill_Sup_P23`, adding the extra chain FX `fx_15701_base_Skill_Sup_Line_*_P23_*`.
= P24 — `"157SkillSupHuiWu"`-tagged hits trigger up to 4 extra `AreaEffect_157_P24_Boom` per support cast (counter resets on the `"157RestartP24"` event).
- P28 — `"157HuiWu"`-tagged hits grant self buff `15728011`; each such hit then consumes its stacks to grant an AddAttr (`15728001` × stacks).
- P29 — `"157HuiWu"`-tagged hits on Elite/Boss monsters grant an AddAttr (`15729001`).
- P30 — an Umbra teammate casting their support skill (slot B) grants self buff `15730011`.
Generic
- P31 — all-Umbra squad → grants buff `15731011` on every Umbra ally.
- P32 — self buff `15732011` while casting the support skill.
- P33 — self buff `15733011`, stacked once per Umbra teammate.

# Common potentials
- P41 — hits on Elite/Boss monsters tagged `"157UltraAtk"` grant an AddAttr (`15741001`).
- P42 — while the Ultimate is active, periodically (`15742011`) fires `15742012` bubble bullets (`Bullet_157_P42_ShuiPao`) at random points in a radius-3 ring around the active player's target; stops when the ult's `"157P42PenSheEnd"` event fires.
- P43 — self buff `15743011` while the Ultimate is active.

---

# Eleanor (137, Ventus)
Class guess: Versatile — procs the Wind mark in the main slot (base `137WindTagTrigger` hits, P7, P11) and applies it in the support slot (jump attack, drones, P32).

# Base skills
- Normal Attack (`13710000`) — 5-hit combo (`Atk1`-`Atk5`); when Armed Energy reaches the threshold it is consumed for the special Cross-Slash (`Atk_Sp` family). Energy procs (+20, CD-gated) also lob grenades with P2.
- Main Skill (`13731000`, `Skill_Main`) — enters Alert (State buff `13700011`) and pulses rotating rings around her.
- Support Skill (`13732000`, `Skill_Sup`) — jump attack: leaps toward the main trekker's target and detonates jump explosions; its hits apply the Wind mark (`2011`). Every 3rd jump spawns a Drone (up to 3) whose bullets also apply the Wind mark.
- Ultimate (`13740000`, `Ultra_TL`/`Ultra_NoTL`) — fires a 15-shot volley cycling 7 Bessel bullets around the target; each landing bullet spawns an indexed explosion.

# Main-control potentials
Build 1
= P1 — while in Alert (State buff `13700011`), reduces the Armed-Energy proc CD by `13701011`; enables the special-attack variant `Atk_Sp_P1`; Cross-Slash-tagged (`"137ShiZiZhanAtk"`) hits grant an AddAttr (`13701011`).
= P2 — keeps an Armed-Energy reserve (`13702011`), so the special attack triggers at `100 − reserve` energy; every energy proc also fires a grenade (`Bullet_137_P2_ShouLei`) at the target (scatter radius 3, or 4 forward if no target).
- P5 — enables the special-attack variants `Atk_Sp_P5` and `Atk_Sp_P1_P5`; Cross-Slash hits on Elite/Boss monsters grant an AddAttr (`13705001`).
- P6 — performing the special attack grants self buff `13706011`.
- P7 — your normal-attack 5th hit (`"137NrmAktEnd"`) triggers the Wind mark (AoE `AreaEffect_137_WindMark1_Bloom`, radius 1.5); casting the Main Skill also grants a buff (id not wired yet).
Build 2
= P3 — performing the special attack grants self buff `13703011`; changes the Alert ring to the P3 variants (`AreaEffect_137_MainSkill_Ring_In_P3` / `..._Ring_OutAtk_P3`, faster 0.66s cycle).
= P4 — enables Alert spread: per-target `"137MainUavAtk"`+`"137Self"` hits are counted while Alert is up; 2 hits on the same target within 1s trigger a spread AoE at it (`AreaEffect_137_MainSkill_Ring_OutAtk_P4` family); casting the Main Skill grants self buff `13704011`.
- P8 — Alert-tagged hits grant an AddAttr (`13708001`); Alert spread uses the P8 key (`..._Ring_OutAtk_P8...`, combined `_P3P8` when P3 is also on).
- P9 — casting the Main Skill searches enemies within radius 4 and grants self buff `13709011` per enemy found.
- P10 — `"137NrmAtk"`-tagged hits grant self buff `13710011` (CD 1s).
Generic
- P11 — Ultimate hits (`"137UltraAtk"`) trigger the Wind mark.
- P12 — on dodge end, reduces the dodge (slot A) cooldown resume time by `totalUseInterval × 13712011 / 100` percent — a dodge CD reduction, not an extra charge.
- P13 — when any Wind trekker triggers a Wind mark, grants buff `13713011` on every Wind ally.

# Support potentials
Build 1
= P21 — each jump-attack spawns a chain of extra jump-explosions (`AreaEffect_137_Skill_Support_JumpAtk`) along 4 directions with growing offset (2 × 2^(k/4), 0.1s steps).
= P22 — every jump-explosion scales its size with its explosion index (`1 + 513722 × index / 100`), stacking bonus hits up to a cap of 30 (`onceId 51372201`).
- P25 — jump-attacks pull each enemy once per jump session toward the anchor (`ForceMoveByDistanceToPosition`, strength 3, distance 3, pullSpeed 15, pull level 4); jump-attack hits also grant an AddAttr (id not wired yet).
- P26 — jump-attack hits grant self buff (id not wired yet).
- P27 — jump-attack hits grant a damage AddAttr and a toughness AddAttr (ids not wired yet).
Build 2
= P23 — spawning a drone resets the lifetime of all active drones; drone bullets scale from stacked self buffs; jump-attacks also grant a buff.
= P24 — drone bullets (`"137_DroneBullet"`) hitting the main trekker's target accumulate; after 3 hits (0.5s CD) triggers the AoE `AreaEffect_137_Support_DroneAccumulate`; drones also gain an attack-speed self buff per active drone.
- P28 — drones use the upgraded attack combo `Atk1_513728`; drone hits grant an AddAttr (id not wired yet).
- P29 — drone hits on toughness-broken monsters grant an AddAttr (id not wired yet).
- P30 — drone hits grant an AddAttr (id not wired yet).
Generic
- P31 — when a Wind trekker triggers a Wind mark, grants a self buff (id not wired yet).
- P32 — Ultimate hits apply the Wind mark (`2011`) to the target.
- P33 — grants a buff on every Wind ally (id not wired yet).

# Common potentials
- P41 — pressing the Ultimate grants a buff on every Wind ally (id not wired yet).
- P42 — Ultimate hits stack debuff on the target (id not wired yet); subsequent Ultimate hits consume the stacks to grant an AddAttr (id not wired yet).
- P43 — a Wind ally casting their skill/support (slot B or C) grants a self buff (id not wired yet).
