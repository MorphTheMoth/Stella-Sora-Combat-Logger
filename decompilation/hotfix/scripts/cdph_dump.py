#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
cdph_dump.py — full decryption of CodePhilosophy "Obfuz" + HybridCLR protected
.NET hot-update assemblies (the `CDPH` container format).

Reverses the scheme this game (Stella Sora) uses for `Persistent_Store/Scripts/Hotfix.dll`:

    CDPH container
      u32 magic "CDPH"
      u32 version (== 1)
      256-byte  key
      8 x instruction vectors (u32 len + bytes, 4-aligned), indexed 0..7
      custom CLI/section header
      image bytes (single section, identity mapped from file offset 0x490)

    Every "decryption" is a tiny interpreted VM.  The program is one of the
    instruction vectors; each program byte is an opcode that dispatches through
    a 256-entry jump table into one of ~13 generated handlers.  A handler
    mutates one byte (or swaps two) of the block at `index = C1 % length`
    using `key[K]` and a per-opcode constant C2.  The opcode semantics are
    game-specific (regenerated per build); this repo ships the extracted table
    (`opstable.json`) as data.

    Execution model (recovered from FUN_1805739f0 / FUN_180608730):
      loop over each program byte (opcode):
        apply opcode's operation to the block
      modulus for index arithmetic = the LENGTH of the block being decrypted.

    Layers applied by the game (and therefore replicated here, in this order):
      1. bulk     4 metadata streams, 0x100-byte blocks:
                     #Strings <- vec[1], #Blob <- vec[2], #US <- vec[3], #~ <- vec[5]
      2. per-string #US   bodies  <- vec[4], 0x10-byte blocks  (length prefix plaintext)
      3. per-row    TypeDef rows <- vec[6], one call per row (modulus = row size)
      4. per-method IL code     <- vec[7], 0x10-byte blocks (IL header plaintext)
      5. the first 16 bytes of the CLI region decrypt to "Hello, HybridCLR"
         using the 256-byte table [~0,~1,..] as the program.

    Output: a standard .NET PE32 DLL (single section, identity mapping) with all
    metadata streams and IL bodies decrypted, ready for dnSpy / ilspycmd.

Usage:
    python3 cdph_dump.py Hotfix.dll [-o out.dll]
"""

import json
import os
import struct
import sys


def load_opstable(path):
    return {int(k): tuple(v) for k, v in json.load(open(path)).items()}


def ror8(v, n):
    n &= 7
    return ((v >> n) | (v << (8 - n))) & 0xFF


def decrypt_block(block, key, n, opcodes, OPS):
    """One VM pass over `block` with modulus `n` (== len(block) in the game)."""
    b = bytearray(block)
    for op in opcodes:
        kind, C1, K, C2 = OPS[op]
        if kind == 'xor':
            i = C1 % n
            b[i] ^= key[K] ^ (C2 & 0xFF)
        elif kind == 'xor_direct':
            i = C1 % n
            b[i] ^= key[K]
        elif kind == 'not_xor':
            i = C1 % n
            b[i] = (~b[i] ^ key[K]) & 0xFF
        elif kind == 'combined':
            i1 = C1 % n
            i2 = ((key[K] + C2) & 0xFFFFFFFF) % n
            t = (b[i2] - 1) & 0xFF
            b[i1] = (b[i1] - t) & 0xFF
            b[i2] = t
        elif kind == 'addconst':
            i = C1 % n
            b[i] = (b[i] + ((C2 & 0xFF) - key[K])) & 0xFF
        elif kind == 'swap':
            i1 = C1 % n
            i2 = ((key[K] + C2) & 0xFFFFFFFF) % n
            b[i1], b[i2] = b[i2], b[i1]
        elif kind == 'ror':
            i = C1 % n
            b[i] = ror8(b[i], key[K] + C2)
        else:
            raise ValueError('unknown op kind %r' % kind)
    return bytes(b)


def decrypt_data(opcodes, key, data, block_len, OPS):
    """Chunked decrypt: the game splits the target into `block_len` chunks and
    runs one VM pass per chunk (modulus = actual chunk length)."""
    out = bytearray(data)
    for off in range(0, len(data), block_len):
        chunk = bytes(out[off:off + block_len])
        out[off:off + len(chunk)] = decrypt_block(chunk, key, len(chunk), opcodes, OPS)
    return bytes(out)


class CDPH:
    def __init__(self, path, opstable_path=None):
        self.path = path
        self.img = open(path, 'rb').read()
        assert self.img[:4] == b'CDPH', 'not a CDPH file'
        self.ver = struct.unpack_from('<I', self.img, 4)[0]
        assert self.ver == 1, 'unsupported CDPH version %d' % self.ver
        self.key = bytearray(self.img[16:16 + 256])
        self.instrs = []
        off = 0x110
        for _ in range(8):
            ln = struct.unpack_from('<I', self.img, off)[0]
            self.instrs.append(bytes(self.img[off + 4:off + 4 + ln]))
            off = (off + 4 + ln + 3) & ~3
        self.cli = off
        if opstable_path is None:
            opstable_path = os.path.join(os.path.dirname(__file__), 'opstable.json')
        self.OPS = load_opstable(opstable_path)

        # CLI region (first 16 bytes = the "Hello, HybridCLR" key check)
        check = bytes(self.img[self.cli:self.cli + 16])
        table = bytes((~i) & 0xFF for i in range(256))
        self.keycheck = decrypt_block(check, bytes(self.key), 16, table, self.OPS)
        assert self.keycheck == b'Hello, HybridCLR', 'key check failed'

        self.entrypoint = struct.unpack_from('<I', self.img, self.cli + 0x10)[0]
        self.md_rva = struct.unpack_from('<I', self.img, self.cli + 0x14)[0]
        self.md_size = struct.unpack_from('<I', self.img, self.cli + 0x18)[0]
        self.nsec = struct.unpack_from('<I', self.img, self.cli + 0x1c)[0]
        secs = []
        p = self.cli + 0x28
        for _ in range(self.nsec):
            rva = struct.unpack_from('<I', self.img, p - 8)[0]
            foff = struct.unpack_from('<I', self.img, p)[0]
            size = struct.unpack_from('<I', self.img, p + 4)[0]
            secs.append((rva, foff, size))
            p += 16
        self.secs = secs
        self.image_end = max(f + s for r, f, s in secs)
        self.image = bytearray(self.image_end)
        for r, f, s in secs:
            self.image[f:f + s] = self.img[f:f + s]
        self.meta = bytearray(self.image[self.md_rva:self.md_rva + self.md_size])

    # ------------------------------------------------------------------ #
    # metadata streams
    # ------------------------------------------------------------------ #
    def parse_streams(self):
        m = self.meta
        assert m[:4] == b'BSJB'
        vlen = struct.unpack_from('<I', m, 12)[0]
        nstreams = struct.unpack_from('<H', m, 16 + vlen + 2)[0]
        sp = 16 + vlen + 4
        out = {}
        for _ in range(nstreams):
            soff, ssize = struct.unpack_from('<II', m, sp)
            name = bytes(m[sp + 8:sp + 8 + 32]).split(b'\0')[0].decode('ascii')
            out[name] = (soff, ssize)
            sp += 8 + ((len(name) + 1 + 3) & ~3)
        return out

    def decrypt_streams(self):
        """Layer 1: bulk decrypt the 4 metadata streams."""
        self.streams = self.parse_streams()
        for name, vec in [('#~', 5), ('#Strings', 1), ('#US', 3), ('#Blob', 2)]:
            soff, ssize = self.streams[name]
            seg = bytes(self.meta[soff:soff + ssize])
            self.meta[soff:soff + ssize] = decrypt_data(
                self.instrs[vec], self.key, seg, 0x100, self.OPS)

    def decrypt_us(self):
        """Layer 2: per-string #US bodies with vec[4], 0x10-byte blocks."""
        soff, ssize = self.streams['#US']
        u = bytearray(self.meta[soff:soff + ssize])
        i = 0
        while i + 1 < len(u):
            v = u[i]
            if v < 0x80:
                i2, ln = i + 1, v
            elif v < 0xc0:
                i2, ln = i + 2, ((v & 0x3f) << 8) | u[i + 1]
            else:
                i2, ln = i + 4, (((v & 0x1f) << 24) | (u[i + 1] << 16) | (u[i + 2] << 8) | u[i + 3])
            if i2 + ln > len(u):
                break
            u[i2:i2 + ln] = decrypt_data(self.instrs[4], self.key, bytes(u[i2:i2 + ln]), 0x10, self.OPS)
            i = i2 + ln
        self.meta[soff:soff + ssize] = u

    # ------------------------------------------------------------------ #
    # tables
    # ------------------------------------------------------------------ #
    def parse_tables(self):
        t = self.meta[self.streams['#~'][0]:self.streams['#~'][0] + self.streams['#~'][1]]
        # Tables stream header (ECMA-335 II.24.2.6): Reserved(4), MajorVersion(1),
        # MinorVersion(1), HeapSizes(1), Reserved(1), Valid(8), Sorted(8), RowCounts...
        self.heapSizes = t[6]  # byte 6, not 4!
        self.valid = struct.unpack_from('<Q', t, 8)[0]
        self.sorted = struct.unpack_from('<Q', t, 16)[0]
        self.rows = {}
        idx = 24
        for tid in range(64):
            if self.valid >> tid & 1:
                self.rows[tid] = struct.unpack_from('<I', t, idx)[0]
                idx += 4
        self.rowbase = idx
        return t

    def hs(self, name):
        return 4 if self.heapSizes & {'S': 1, 'G': 2, 'B': 4}[name] else 2

    def tab_idx(self, tid):
        return 4 if self.rows.get(tid, 0) >= 0x10000 else 2

    def coded(self, bits, tabs):
        return 4 if max((self.rows.get(x, 0) for x in tabs), default=0) >= (0x10000 >> bits) else 2

    # ECMA-335 row sizes.  Module uses 2-byte EncId/EncBaseId (HybridCLR), size 12.
    def row_sizes(self):
        return {
            0: 2 + self.hs('S') + self.hs('G') + 2 + 2,
            1: self.coded(2, [0x00, 0x1a, 0x23, 0x01]) + self.hs('S') + self.hs('S'),
            2: 4 + self.hs('S') + self.hs('S') + self.coded(2, [0x01, 0x02, 0x1b]) + self.tab_idx(0x04) + self.tab_idx(0x06),
            4: 2 + self.hs('S') + self.hs('B'),
            6: 4 + 2 + 2 + self.hs('S') + self.hs('B') + self.tab_idx(0x08),
        }

    def table_offsets(self, tids=(0, 1, 2, 4, 6)):
        rs = self.row_sizes()
        offs = {}
        pos = self.rowbase
        for tid in sorted(self.rows):
            if tid in tids:
                offs[tid] = pos
            pos += self.rows[tid] * rs.get(tid, 0)
        return offs

    def decrypt_typedef_rows(self):
        """Layer 3: per-row TypeDef decryption with vec[6], modulus = row size."""
        t = self.meta[self.streams['#~'][0]:self.streams['#~'][0] + self.streams['#~'][1]]
        t = bytearray(t)
        rs = self.row_sizes()[2]
        offs = self.table_offsets()
        base = offs[2]
        for r in range(self.rows[2]):
            p = base + r * rs
            t[p:p + rs] = decrypt_block(bytes(t[p:p + rs]), self.key, rs, self.instrs[6], self.OPS)
        soff = self.streams['#~'][0]
        self.meta[soff:soff + len(t)] = t

    def rebuild_standard_metadata(self):
        """Re-emit the metadata with ECMA-standard table row sizes.

        HybridCLR writes the Module row with 2-byte EncId/EncBaseId (12 bytes);
        System.Reflection.Metadata expects the standard 16.  All other tables are
        standard, so only the Module row needs padding.  The #~ stream grows by
        4 and the remaining streams shift; stream headers are updated.
        """
        m = self.meta
        vlen = struct.unpack_from('<I', m, 12)[0]
        nstreams = struct.unpack_from('<H', m, 16 + vlen + 2)[0]
        # collect (name, data) in order
        sp = 16 + vlen + 4
        order = []
        for _ in range(nstreams):
            soff, ssize = struct.unpack_from('<II', m, sp)
            name = bytes(m[sp + 8:sp + 8 + 32]).split(b'\0')[0].decode('ascii')
            order.append((name, bytes(m[soff:soff + ssize])))
            sp += 8 + ((len(name) + 1 + 3) & ~3)
        # pad Module row inside #~: Gen(2) Name(4) Mvid(2) EncId(2) EncBaseId(2) -> 16 bytes
        ts = dict(order)['#~']
        module_row_end = 0x78 + 8          # header(0x78) + Gen+Name+Mvid
        new_ts = ts[:module_row_end] + b'\0' * 8 + ts[module_row_end + 4:]
        data = dict(order)
        data['#~'] = new_ts
        # build new metadata root
        header_len = sp - (16 + vlen + 4)
        new_meta = bytearray()
        new_meta += m[:16 + vlen + 4]      # signature/version/reserved/flags/streams
        new_meta += m[16 + vlen + 4:16 + vlen + 4 + header_len]  # copy stream headers (offsets fixed later)
        # compute new stream offsets
        pos = 16 + vlen + 4 + header_len
        pos = (pos + 3) & ~3
        offsets = {}
        for name, _ in order:
            size = len(data[name])
            offsets[name] = pos
            pos = pos + size
            pos = (pos + 3) & ~3
        # write stream headers with new offsets
        sp = 16 + vlen + 4
        for name, _ in order:
            struct.pack_into('<II', new_meta, sp, offsets[name], len(data[name]))
            sp += 8 + ((len(name) + 1 + 3) & ~3)
        # append stream data
        for name, _ in order:
            d = data[name]
            pad = (4 - (len(new_meta) % 4)) % 4
            new_meta += b'\0' * pad
            new_meta += d
        self.meta = bytearray(new_meta)
        self.streams = {k: (offsets[k], len(data[k])) for k, _ in order}
        self.md_size = len(self.meta)

    def decrypt_il(self):
        """Layer 4: per-method IL code with vec[7], 0x10-byte blocks.

        Iterates the MethodDef table; for each non-zero RVA parses the method
        header (tiny/fat) and decrypts only the code bytes in place.
        """
        # rebuild the table region of meta for MethodDef parsing
        t = bytes(self.meta[self.streams['#~'][0]:self.streams['#~'][0] + self.streams['#~'][1]])
        md_rs = self.row_sizes()[6]
        offs = self.table_offsets()
        mdbase = offs[6]
        mdrows = self.rows[6]
        n = 0
        seen = set()
        for r in range(mdrows):
            row = t[mdbase + r * md_rs:mdbase + (r + 1) * md_rs]
            rva = struct.unpack_from('<I', row, 0)[0]
            if rva == 0 or rva in seen:
                continue
            seen.add(rva)
            self._decrypt_method(rva)
            n += 1
        return n

    def _decrypt_method(self, rva):
        img = self.image
        if rva + 1 > self.image_end:
            return
        b0 = img[rva]
        if (b0 & 0x03) == 0x02:
            # tiny method: 1-byte header, code follows
            cs = b0 >> 2
            code_off = rva + 1
        else:
            # fat method: 12 (or 16) byte header
            size = (struct.unpack_from('<H', img, rva)[0] >> 12) & 0xF
            header_len = size * 4
            if rva + header_len + 4 > self.image_end:
                return
            cs = struct.unpack_from('<I', img, rva + 4)[0]
            code_off = rva + header_len
        if code_off + cs > self.image_end:
            return
        code = bytes(img[code_off:code_off + cs])
        dec = decrypt_data(self.instrs[7], self.key, code, 0x10, self.OPS)
        img[code_off:code_off + cs] = dec

    # ------------------------------------------------------------------ #
    # output
    # ------------------------------------------------------------------ #
    def reconstruct_pe(self):
        """Build a standard PE32 DLL around the decrypted image.

        Single section at RVA 0x400 (identity file mapping preserved, so all
        metadata/method RVAs stay valid).  The COR20 header is placed at RVA
        0x460 inside the section.
        """
        # commit decrypted metadata back into the image
        self.image[self.md_rva:self.md_rva + self.md_size] = self.meta
        section_rva = 0x400
        end = max(self.image_end, self.md_rva + self.md_size)
        section_size = end - section_rva
        out = bytearray(section_rva)  # headers + padding
        # COR20 / CLI header at RVA 0x400 (section start; image content is ≥0x490)
        cli_rva = section_rva
        cli = bytearray(0x48)
        struct.pack_into('<I', cli, 0x00, 0x48)          # cb
        struct.pack_into('<H', cli, 0x04, 2)             # MajorRuntimeVersion
        struct.pack_into('<H', cli, 0x06, 5)             # MinorRuntimeVersion
        struct.pack_into('<I', cli, 0x08, self.md_rva)   # metadata RVA
        struct.pack_into('<I', cli, 0x0c, self.md_size)  # metadata size
        struct.pack_into('<I', cli, 0x10, 0)             # flags
        struct.pack_into('<I', cli, 0x14, self.entrypoint)
        assert cli_rva + len(cli) <= section_rva + 0x90
        # section content: COR20 header + padding + decrypted image (identity)
        content = bytearray(0x90)
        content[0:0x48] = cli
        content += bytes(self.image[0x490:self.image_end])
        if len(content) < section_size:
            content += b'\0' * (section_size - len(content))
        raw_size = len(content)

        pe = bytearray(section_rva)  # headers fill up to the section start
        # DOS header
        pe[0:2] = b'MZ'
        struct.pack_into('<I', pe, 0x3c, 0x80)
        # PE signature
        pe[0x80:0x84] = b'PE\0\0'
        coff = 0x84
        struct.pack_into('<H', pe, coff + 0, 0x14c)        # machine x86
        struct.pack_into('<H', pe, coff + 2, 1)            # sections
        struct.pack_into('<I', pe, coff + 4, 0)            # timestamp
        struct.pack_into('<I', pe, coff + 8, 0)            # ptr to symtab
        struct.pack_into('<I', pe, coff + 12, 0)           # num symbols
        struct.pack_into('<H', pe, coff + 16, 0xe0)        # optional header size
        struct.pack_into('<H', pe, coff + 18, 0x2102)      # characteristics: dll + 32bit + exec
        opt = coff + 20
        struct.pack_into('<H', pe, opt + 0, 0x10b)         # PE32 magic
        struct.pack_into('<B', pe, opt + 2, 0)             # linker major
        struct.pack_into('<B', pe, opt + 3, 0)             # linker minor
        struct.pack_into('<I', pe, opt + 4, 0)             # size of code
        struct.pack_into('<I', pe, opt + 8, 0)             # size of init data
        struct.pack_into('<I', pe, opt + 12, 0)            # size of uninit data
        struct.pack_into('<I', pe, opt + 16, 0)            # entry point
        struct.pack_into('<I', pe, opt + 20, section_rva)  # base of code
        struct.pack_into('<I', pe, opt + 24, 0x10000000)   # image base
        struct.pack_into('<I', pe, opt + 28, 0x200)        # section alignment
        struct.pack_into('<I', pe, opt + 32, 0x200)        # file alignment
        struct.pack_into('<H', pe, opt + 40, 4)            # OS version
        struct.pack_into('<H', pe, opt + 42, 0)
        struct.pack_into('<H', pe, opt + 48, 4)            # subsystem version
        struct.pack_into('<H', pe, opt + 50, 0)
        struct.pack_into('<I', pe, opt + 56, section_rva + raw_size)  # size of image
        struct.pack_into('<I', pe, opt + 60, section_rva)   # size of headers
        struct.pack_into('<I', pe, opt + 64, 0)            # checksum
        struct.pack_into('<H', pe, opt + 68, 2)            # subsystem: GUI
        struct.pack_into('<H', pe, opt + 70, 0x8160)       # dll characteristics
        struct.pack_into('<I', pe, opt + 88, 0)            # loader flags
        struct.pack_into('<I', pe, opt + 92, 16)           # number of rva+sizes
        # data directories: 14 = COM descriptor
        dd = opt + 96
        for i in range(16):
            struct.pack_into('<II', pe, dd + i * 8, 0, 0)
        struct.pack_into('<II', pe, dd + 14 * 8, cli_rva, len(cli))
        # section table
        sec = opt + 0xe0
        pe[sec:sec + 8] = b'.text\0\0\0'
        struct.pack_into('<I', pe, sec + 8, section_size)  # virtual size
        struct.pack_into('<I', pe, sec + 12, section_rva)
        struct.pack_into('<I', pe, sec + 16, raw_size)     # raw size
        struct.pack_into('<I', pe, sec + 20, section_rva)  # raw ptr (identity)
        struct.pack_into('<I', pe, sec + 24, 0)            # relocs
        struct.pack_into('<I', pe, sec + 28, 0)            # line numbers
        struct.pack_into('<H', pe, sec + 32, 0)
        struct.pack_into('<H', pe, sec + 34, 0)
        struct.pack_into('<I', pe, sec + 36, 0x60000020)   # code|exec|read
        pe += content
        return bytes(pe)


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('input', help='CDPH-protected Hotfix.dll')
    ap.add_argument('-o', '--output', default=None)
    ap.add_argument('--opstable', default=None)
    args = ap.parse_args()

    c = CDPH(args.input, args.opstable)
    print('CDPH version %d, key check OK' % c.ver)
    print('instructions lens:', [len(x) for x in c.instrs])
    print('metadata RVA 0x%x size 0x%x, sections %d' % (c.md_rva, c.md_size, c.nsec))
    c.decrypt_streams()
    print('streams:', {k: (hex(v[0]), hex(v[1])) for k, v in c.streams.items()})
    c.decrypt_us()
    c.parse_tables()
    print('heapSizes 0x%x valid tables: %s' % (c.heapSizes, [hex(i) for i in range(64) if c.valid >> i & 1]))
    print('TypeDef rows %d, row size %d' % (c.rows[2], c.row_sizes()[2]))
    c.decrypt_typedef_rows()
    n = c.decrypt_il()
    print('decrypted %d method bodies' % n)
    # NOTE: HybridCLR writes the Module row as 12 bytes (2-byte EncId/EncBaseId).
    # System.Reflection.Metadata / ilspycmd (10.x) accept this as-is, so the
    # metadata is left in its original position (no stream relocation, no
    # Module-row padding).  Padding the row (rebuild_standard_metadata) shifts
    # every subsequent table by 4 bytes and corrupts the string heap.
    pe = c.reconstruct_pe()
    out = args.output or os.path.splitext(args.input)[0] + '.dec.dll'
    with open(out, 'wb') as f:
        f.write(pe)
    print('wrote %s (%d bytes)' % (out, len(pe)))


if __name__ == '__main__':
    main()
