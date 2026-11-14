#!/usr/bin/env python3
"""Generate the ultimate TL vs NoTL timing table for every character.

Reads the live combo bundles (`char_<id>_combos.unity3d`) with UnityPy and writes:

    docs/ult_animations.md   mechanics + column legend + one-row-per-character table
    docs/ult_timing.tsv      the same rows, machine readable

Only dependency: UnityPy (`pip install UnityPy`).

Every column is derived from data, never hand-entered:

    TL    sum over compositeComboClips[*] of ComboClip.animationLength / playSpeed
          for the base '<id>_Ultra_TL' combo (variants P41/P42/P43/T2/T3/H6 skipped)
    NoTL  same for '<id>_Ultra_NoTL'
    Witch sum over the NoTL block clips of (activeNormalizedTimeRange.y - x) *
          animationLength for events with type == 10 (Combo.Event.EventType.FrozenTime)
    Clock Boss Blitz logic-clock delta, TL vs NoTL (NoTL net of Witch); negative means
          the full-animation ult costs less clock

Characters with no `<id>_Ultra_TL` / `<id>_Ultra_NoTL` pair are appended to the doc's
skipped list with the reason, because some ults genuinely have no full/short split
(162 uses two stance variants, `Ultra_Qing` / `Ultra_Zhong`) and some combo bundles keep
their clips in another bundle (external references).
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys

try:
    import UnityPy
except ImportError:  # pragma: no cover - dependency hint
    sys.exit("UnityPy missing: pip install UnityPy")

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_NAMES = os.path.join(
    os.path.dirname(os.path.dirname(REPO)), "Nebula-Record-Builder", "data", "characterid.json"
)
DEFAULT_BUNDLE_DIRS = [
    "/home/morph/.steam/Link to compatdata/3296660908/pfx/drive_c/YostarGames/"
    "StellaSora_EN/Persistent_Store/AssetBundles",
    "/home/morph/.steam/Link to compatdata/3296660908/pfx/drive_c/YostarGames/"
    "StellaSora_EN/StellaSora_Data/StreamingAssets/InstallResource",
]

# variant suffixes that are conditional branches, not the base ult animation
VARIANT_TAGS = ("P41", "P42", "P43", "T2", "T3", "H6")
# 997xx / 998xx / 999xx are test characters
SKIP_CHAR_PREFIX = ("99",)


def fp(value):
    """Serialized fixed-point (32.32) -> float; already-float values pass through."""
    if isinstance(value, dict):
        return float(value.get("_serializedValue", 0)) / 2 ** 32
    return float(value or 0)


def bundle_objects(path):
    """[(path_id, typetree)] for every readable MonoBehaviour in the bundle."""
    try:
        env = UnityPy.load(path)
    except Exception:
        return []
    out = []
    for obj in env.objects:
        if str(obj.type) != "114":  # MonoBehaviour
            continue
        try:
            tree = obj.read_typetree()
        except Exception:
            # patched/delta bundles in Persistent_Store can be unreadable
            continue
        out.append((obj.path_id, tree))
    return out


def is_base_tag(tag, kind):
    """True for the base Ultra_TL / Ultra_NoTL actionTag (not a conditional variant)."""
    if any(v in tag for v in VARIANT_TAGS):
        return False
    if kind == "tl":
        return ("TL" in tag and "NoTL" not in tag) or "TimelineOn" in tag
    return "NoTL" in tag or "TimelineOff" in tag


def base_combo(combos, kind):
    """(tag, clip names) of the base ult combo for the TL or NoTL path."""
    candidates = [(len(tag), tag, clips) for tag, clips in combos if is_base_tag(tag, kind)]
    candidates.sort()
    if candidates:
        return candidates[0][1], candidates[0][2]
    # some characters carry no actionTag on the ult combo: match on the clip name
    for tag, clips in combos:
        first = clips[0]
        if kind == "tl" and ("_TL" in first or "TimelineOn" in first) and "NoTL" not in first:
            return tag, clips
        if kind == "nt" and ("_NoTL" in first or "TimelineOff" in first):
            return tag, clips
    return None, None


def block_duration(clips, clip_trees):
    """Summed `animationLength / playSpeed` of a chained combo block, or None."""
    total = 0.0
    found = False
    for name in clips:
        clip = clip_trees.get(name)
        if not clip:
            continue
        found = True
        length = fp(clip.get("animationLength"))
        speed = fp(clip.get("playSpeed")) or 1.0
        total += length / speed
    return total if found else None


def frozen_time(clips, clip_trees):
    """Sum of FrozenTime (type 10) windows over a block, in seconds."""
    total = 0.0
    for name in clips:
        clip = clip_trees.get(name)
        if not clip:
            continue
        length = fp(clip.get("animationLength"))
        for skin in clip.get("comboEventSkins") or []:
            for event in skin.get("comboEvents") or []:
                if event.get("type") != 10:
                    continue
                rng = event.get("activeNormalizedTimeRange") or {}
                total += (fp(rng.get("y")) - fp(rng.get("x"))) * length
    return total


def character_from_bundle(path, names):
    """(row, None) on success, (None, reason) when this bundle cannot produce a row."""
    objects = bundle_objects(path)
    if not objects:
        return None, "bundle unreadable (patched delta bundle?)"
    name_by_id = {pid: (tree.get("m_Name") or "") for pid, tree in objects}
    clip_trees = {
        tree.get("m_Name"): tree
        for _, tree in objects
        if tree.get("m_Name") and "animationLength" in tree
    }
    group = next((tree for _, tree in objects if "combos" in tree), None)
    if group is None:
        return None, "no ComboGroup"
    assert isinstance(group, dict)

    combos = []
    external = False
    for combo in group["combos"]:
        clip_names = []
        for entry in combo.get("compositeComboClips") or []:
            ref = entry.get("comboClip") or {}
            if ref.get("m_FileID", 0) != 0:
                external = True
                continue
            name = name_by_id.get(ref.get("m_PathID"))
            if name:
                clip_names.append(name)
        if clip_names:
            combos.append((combo.get("actionTag") or "", clip_names))
    if not combos:
        return None, "clips live in another bundle (external references)" if external else "no combos"

    tl_tag, tl_clips = base_combo(combos, "tl")
    nt_tag, nt_clips = base_combo(combos, "nt")
    note = None
    if not tl_clips or not nt_clips:
        # No full/short split: ults with stance variants (162 Alina, Ultra_Qing/Ultra_Zhong).
        # Fall back to one ultra combo used for both columns, documented in the row note.
        singles = [(tag, clips) for tag, clips in combos
                   if "Ultra" in tag and not any(v in tag for v in VARIANT_TAGS)]
        singles.sort(key=lambda item: (0 if "Zhong" in item[0] else 1, len(item[0])))
        fallback = block_duration(singles[0][1], clip_trees) if singles else None
        if fallback is None:
            ultra_tags = sorted({tag for tag, _ in combos if "Ultra" in tag})
            detail = f" (ult tags: {', '.join(ultra_tags)})" if ultra_tags else ""
            return None, f"no _Ultra_TL / _Ultra_NoTL pair{detail}"
        single_tag, single_clips = singles[0]
        variants = []
        for tag, clips in singles:
            duration = block_duration(clips, clip_trees)
            if duration is not None:
                variants.append(f"`{tag}` {duration:.2f} s / freeze "
                                f"{frozen_time(clips, clip_trees):.2f} s")
        char_id = re.search(r"char_(\d{5})_combos", os.path.basename(path)).group(1)
        short = char_id[:3]
        return {
            "char": short,
            "name": names.get(short, "?"),
            "tl": fallback,
            "nt": fallback,
            "freeze": frozen_time(single_clips, clip_trees),
            "tl_tag": single_tag,
            "nt_tag": single_tag,
            "single": True,
            "note": (f"no _TL/_NoTL split; both columns = {single_tag} (the default stance), and "
                     "the Witch freeze applies in both modes, so the clock delta is 0. "
                     f"Stance variants: {'; '.join(variants)}"),
        }, None
    tl = block_duration(tl_clips, clip_trees)
    nt = block_duration(nt_clips, clip_trees)
    if tl is None or nt is None:
        return None, "ult clips unresolved"

    char_id = re.search(r"char_(\d{5})_combos", os.path.basename(path)).group(1)
    short = char_id[:3]
    return {
        "char": short,
        "name": names.get(short, "?"),
        "tl": tl,
        "nt": nt,
        "freeze": frozen_time(nt_clips, clip_trees),
        "tl_tag": tl_tag,
        "nt_tag": nt_tag,
        "note": note,
    }, None


DOC_HEADER = r"""# Ultimate animations: full (`_TL`) vs short (`_NoTL`) timing

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
"""


def render(rows):
    lines = [
        "| Char | TL | NoTL | Witch | Clock Δ (TL vs NoTL) |",
        "|---|---|---|---|---|",
    ]
    for row in rows:
        freeze_tl = row["freeze"] if row.get("single") else 0.0
        tl_clk = max(0.0, row["tl"] - freeze_tl)
        nt_clk = max(0.0, row["nt"] - row["freeze"])
        lines.append(
            f"| {row['name']} ({row['char']}) | {row['tl']:.2f} | {row['nt']:.2f} | "
            f"{row['freeze']:.2f} | {tl_clk - nt_clk:+.2f} |"
        )
    return "\n".join(lines)


def render_tsv(rows):
    header = ["char", "name", "tl", "notl", "witch", "clock_delta"]
    out = ["\t".join(header)]
    for row in rows:
        freeze_tl = row["freeze"] if row.get("single") else 0.0
        tl_clk = max(0.0, row["tl"] - freeze_tl)
        nt_clk = max(0.0, row["nt"] - row["freeze"])
        out.append("\t".join([
            row["char"], row["name"],
            f"{row['tl']:.3f}", f"{row['nt']:.3f}", f"{row['freeze']:.3f}",
            f"{tl_clk - nt_clk:+.3f}",
        ]))
    return "\n".join(out)


def collect(bundle_dirs, names):
    """One row per character; skins deduped in favour of the base `XX01` bundle."""
    chosen = {}
    skipped = {}
    for base in bundle_dirs:
        for path in sorted(glob.glob(os.path.join(base, "char_*_combos.unity3d"))):
            match = re.search(r"char_(\d{5})_combos", os.path.basename(path))
            if not match:
                continue
            char_id = match.group(1)
            short = char_id[:3]
            if short.startswith(SKIP_CHAR_PREFIX):
                continue
            current = chosen.get(short)
            if current and current[0].endswith("01"):
                continue  # base skin already won
            row, reason = character_from_bundle(path, names)
            if row:
                chosen[short] = (char_id, row)
                skipped.pop(short, None)
            elif short not in chosen:
                skipped[short] = (char_id, reason)
    rows = [row for _, row in chosen.values()]
    rows.sort(key=lambda r: int(r["char"]))
    skipped = {k: v for k, v in skipped.items() if k not in chosen}
    return rows, skipped


def main(argv=None):
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument("--names", default=DEFAULT_NAMES, help="characterid.json")
    parser.add_argument("--bundle-dir", action="append", dest="bundle_dirs",
                        help="game AssetBundles dir (repeatable; Persistent_Store first)")
    parser.add_argument("--md", default=os.path.join(REPO, "docs", "ult_animations.md"))
    parser.add_argument("--tsv", default=os.path.join(REPO, "docs", "ult_timing.tsv"))
    args = parser.parse_args(argv)

    bundle_dirs = args.bundle_dirs or DEFAULT_BUNDLE_DIRS
    if os.path.exists(args.names):
        names = json.load(open(args.names))
    else:
        print(f"warning: {args.names} missing, character names left blank", file=sys.stderr)
        names = {}

    rows, skipped = collect(bundle_dirs, names)
    if not rows:
        sys.exit(f"no rows: check --bundle-dir ({', '.join(bundle_dirs)})")

    footer = f"\n{len(rows)} characters."
    notes = [(r["char"], r["name"], r["note"]) for r in rows if r.get("note")]
    if notes:
        footer += "\n\nRows without a full/short split:\n\n"
        footer += "\n".join(f"- {char} ({name}): {note}" for char, name, note in notes)
    if skipped:
        footer += "\n\nNot in the table (no full/short pair in the bundle):\n\n"
        footer += "\n".join(
            f"- {char_id} ({names.get(short, '?')}): {reason}"
            for short, (char_id, reason) in sorted(skipped.items())
        )
    footer += "\n"

    os.makedirs(os.path.dirname(args.md), exist_ok=True)
    with open(args.md, "w") as fh:
        fh.write(DOC_HEADER + "\n## Table\n\n" + render(rows) + "\n" + footer)
    with open(args.tsv, "w") as fh:
        fh.write(render_tsv(rows) + "\n")
    print(f"{len(rows)} characters ({len(skipped)} skipped) -> {args.md}, {args.tsv}")


if __name__ == "__main__":
    main()
