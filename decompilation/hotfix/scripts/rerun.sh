#!/usr/bin/env bash
# rerun.sh — decrypt Hotfix.dll and decompile it to C#.
#
# Usage:
#   ./rerun.sh [GameAssembly.dll] [Hotfix.dll] [--opstable RVA] [-o outdir]
#
# Defaults (paths relative to this repo / the game install):
#   GameAssembly.dll  : /home/morph/stella sora meter/dll/Il2CppDumper-net7-v6.7.46/GameAssembly.dll
#   Hotfix.dll        : /home/morph/stella sora meter/Link to YostarGames/StellaSora_EN/Persistent_Store/Scripts/Hotfix.dll
#   DummyDll          : <Il2CppDumper>/out_new/DummyDll   (ILSpy reference stubs)
#
# On a NEW game build (GameAssembly.dll changed) the Obfuz opcode table is
# regenerated, so you MUST re-extract it first.  Find the jump-table RVA in the
# ghidra/IDA output (see README.md) and pass --opstable 0x5757b8.  Example:
#
#   ./rerun.sh --opstable 0x5757b8
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ILSPYCMD="${ILSPYCMD:-$HOME/.dotnet/tools/ilspycmd}"

GA_DEFAULT="/home/morph/stella sora meter/dll/Il2CppDumper-net7-v6.7.46/GameAssembly.dll"
HF_DEFAULT="/home/morph/stella sora meter/Link to YostarGames/StellaSora_EN/Persistent_Store/Scripts/Hotfix.dll"
DD_DEFAULT="/home/morph/stella sora meter/dll/Il2CppDumper-net7-v6.7.46/out_new/DummyDll"

GA="$GA_DEFAULT"
HF="$HF_DEFAULT"
DD="$DD_DEFAULT"
JT_RVA=""
OUT="$HERE/out"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --opstable) JT_RVA="$2"; shift 2;;
    -o) OUT="$2"; shift 2;;
    *) 
      if [[ -z "$GA_SET" ]]; then GA="$1"; GA_SET=1
      elif [[ -z "$HF_SET" ]]; then HF="$1"; HF_SET=1
      fi
      shift;;
  esac
done

mkdir -p "$OUT"

if [[ -n "$JT_RVA" ]]; then
  echo ">> re-extracting Obfuz opcode table from GameAssembly.dll (jump table @ $JT_RVA)"
  python3 "$HERE/extract_opstable.py" "$GA" "$JT_RVA" -o "$HERE/opstable.json"
fi

echo ">> decrypting CDPH Hotfix.dll"
python3 "$HERE/cdph_dump.py" "$HF" --opstable "$HERE/opstable.json" -o "$OUT/Hotfix.dec.dll"

echo ">> decompiling with ilspycmd (DummyDll references: $DD)"
"$ILSPYCMD" -r "$DD" "$OUT/Hotfix.dec.dll" -o "$OUT"

echo ">> done -> $OUT/Hotfix.dec.decompiled.cs"
