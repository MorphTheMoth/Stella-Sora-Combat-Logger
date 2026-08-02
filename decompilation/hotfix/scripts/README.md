# Re-running the Hotfix.dll decompilation after a game update

Everything needed to regenerate the decrypted DLL and the decompiled C# from a
new game build lives in `scripts/`.

```
scripts/
  extract_opstable.py   # Obfuz VM opcode table from GameAssembly.dll
  cdph_dump.py          # CDPH decryptor -> standard .NET DLL
  opstable.json         # opcode table for the current build
  rerun.sh              # one-shot: decrypt + decompile
```

## Normal re-run (same game build)

```bash
./scripts/rerun.sh
```

This decrypts `Hotfix.dll` and decompiles with `ilspycmd` against the
`DummyDll` reference stubs. Output lands in `scripts/out/`.

## After a game update (new GameAssembly.dll)

The Obfuz VM's opcode table is **regenerated per build**, so `opstable.json`
becomes stale and the key check (`"Hello, HybridCLR"`) will fail. Re-extract it:

1. **Find the jump-table RVA in the new `decompilation/decompiled.c`** (or the
   ghidra/IDA project used to make it):
   - grep for `Hello, HybridCLR` → the `LoadCDPHHeader` function (the one that
     does the 16-byte key check). It calls the **VM dispatcher** (`DecryptBlock`)
     to decrypt that check.
   - open the VM dispatcher body and find the jump-table lookup, e.g.:

     ```c
     (*(code *)((ulonglong)*(uint *)(&DAT_1805757b8 + (ulonglong)*opcode * 4) + 0x180000000))();
     ```

     `DAT_1805757b8` means the 256-entry table sits at **RVA `0x5757b8`**
     (the symbol is `image_base + rva`, image base is `0x180000000`).
   - if you are working from raw disassembly instead, the dispatcher looks like:

     ```asm
     movzx eax, byte ptr [rsi + rbp]            ; opcode = program[pc]
     mov    eax, dword ptr [r14 + rax*4 + 0x5757b8]   ; jump table
     add    rax, r14
     jmp    rax
     ```

2. **Re-extract the table**:

   ```bash
   python3 scripts/extract_opstable.py <new GameAssembly.dll> 0x5757b8 \
       -o scripts/opstable.json
   ```

   (capstone required: `pip install capstone`.)

3. **Re-run**:

   ```bash
   ./scripts/rerun.sh --opstable 0x5757b8
   ```

   Passing `--opstable` makes rerun.sh repeat step 2 automatically.

## Notes

- If the decompiled.c RVA layout changed such that `extract_opstable.py` can't
  find the table, pass the new image base with a manual edit to
  `DEFAULT_IMAGE_BASE` in the script, or point it at the RVA directly.
- The game's own assemblies (`Game`, `GameFramework`, `TrueSync`, `spine-*`, …)
  are IL2CPP-compiled and only exist as `DummyDll` stubs; they give ILSpy type
  names but not implementations. The IL/metadata decrypts exactly; the C# is a
  semantic reconstruction (see the top-level README).
- `ilspycmd` needs the `DummyDll` folder as a reference path, otherwise you get
  ~70k `//IL_xxxx: Unknown result type (missing references)` comments.
