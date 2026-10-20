#!/usr/bin/env bash
# rerun.sh — decrypt Hotfix.dll and decompile it to C#.
#
# Usage:
#   ./rerun.sh [GameAssembly.dll] [Hotfix.dll] [--opstable RVA] [--dummy DIR] [-o outdir]
#
# Defaults (via repo-root symlinks):
#   GameAssembly.dll  : decompilation/current/GameAssembly.dll
#   Hotfix.dll        : Link to YostarGames/StellaSora_EN/Persistent_Store/Scripts/Hotfix.dll
#   DummyDll          : decompilation/il2cppDumper_out/DummyDll  (ILSpy reference stubs)
#
# On a NEW game build (GameAssembly.dll changed) the Obfuz opcode table is
# regenerated, so you MUST re-extract it first.  Find the jump-table RVA in the
# ghidra/IDA output (see README.md) and pass --opstable 0x5757b8.  Example:
#
#   ./rerun.sh --opstable 0x5757b8
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../.." && pwd)"
ILSPYCMD="${ILSPYCMD:-$HOME/.dotnet/tools/ilspycmd}"

GA_DEFAULT="$REPO_ROOT/decompilation/current/GameAssembly.dll"
HF_DEFAULT="$REPO_ROOT/Link to YostarGames/StellaSora_EN/Persistent_Store/Scripts/Hotfix.dll"
DD_DEFAULT="$REPO_ROOT/decompilation/il2cppDumper_out/DummyDll"

GA="$GA_DEFAULT"
HF="$HF_DEFAULT"
DD="$DD_DEFAULT"
JT_RVA=""
OUT="$HERE/out"
GA_SET=""
HF_SET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --opstable) JT_RVA="$2"; shift 2;;
    --dummy) DD="$2"; shift 2;;
    -o) OUT="$2"; shift 2;;
    *) 
      if [[ -z "$GA_SET" ]]; then GA="$1"; GA_SET=1
      elif [[ -z "$HF_SET" ]]; then HF="$1"; HF_SET=1
      fi
      shift;;
  esac
done

mkdir -p "$OUT"

if [[ ! -d "$DD" ]]; then
  echo "!! DummyDll reference dir not found: $DD" >&2
  echo "   Generate it with docs/ghidra.md steps 0-1 for the current game build and pass --dummy <dir>." >&2
  exit 1
fi

if [[ -n "$JT_RVA" ]]; then
  echo ">> re-extracting Obfuz opcode table from GameAssembly.dll (jump table @ $JT_RVA)"
  python3 "$HERE/extract_opstable.py" "$GA" "$JT_RVA" -o "$HERE/opstable.json"
fi

echo ">> decrypting CDPH Hotfix.dll"
python3 "$HERE/cdph_dump.py" "$HF" --opstable "$HERE/opstable.json" -o "$OUT/Hotfix.dec.dll"

echo ">> decompiling with ilspycmd (DummyDll references: $DD)"
"$ILSPYCMD" -r "$DD" "$OUT/Hotfix.dec.dll" -o "$OUT"

echo ">> done -> $OUT/Hotfix.dec.decompiled.cs"
