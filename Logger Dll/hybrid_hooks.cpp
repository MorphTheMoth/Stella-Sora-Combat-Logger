// =============================================================================
//  HybridCLR hotfix attach layer — implementation
// =============================================================================
//  See include/hybrid_hooks.h for the architecture and docs/hybrid_hooks.md for
//  the full layouts.  Everything below is grounded in the 2.0.0
//  `GameAssembly.dll` (game base 0x180000000) and the upstream HybridCLR sources
//  (hybridclr/interpreter/{Interpreter_Execute.cpp, Engine.cpp,
//  InterpreterModule.cpp, InterpreterDefs.h, InterpreterUtil.cpp}):
//
//    Interpreter::Execute(const MethodInfo*, StackObject* args, void* ret)
//        RVA 0x64E270 — found through the "CallInterpDelegate" literal.
//    InterpFrameGroup::EnterFrameFromInterpreter(this, const MethodInfo*,
//        StackObject* argBase)
//        RVA 0x64E1C0 — pushes an interpreted→interpreted callee frame.
//    InterpFrameGroup::LeaveFrame(this) -> InterpFrame*
//        RVA 0x662410 — the interpreter's return event, called from every
//        ret/unwind handler in Execute before the callee frame is popped.
//
//  Key struct offsets (verified against the 2.0.0 image):
//    MethodInfo     : name +0x18, klass +0x20, interpData +0x58
//    Il2CppClass    : name +0x10, namespaze +0x18, methods +0x98
//    InterpMethodInfo: args +0x08, argStackObjectSize +0x20, retStackObjectSize
//                     +0x24, maxStackSize +0x2C, argCount/codeLength +0x30,
//                     evalStackBaseOffset +0x38
//    MethodArgDesc  : {u8 passbyValWhenInvoke, u8 type, u16 stackObjectSize}
//    MachineState   : _stackTopIdx +0x0C, _frameBase +0x18, _frameTopIdx +0x20
//    InterpFrame    : method +0x00, stackBasePtr +0x08, ret +0x18, stride 0x40
//    InterpFrameGroup: _machineState* +0x00
// =============================================================================

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <algorithm>
#include <atomic>
#include <cstring>
#include <mutex>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "MinHook.h"
#include "logging.h"
#include "game_structs.h"
#include "hybrid_hooks.h"

namespace hybrid {

// ---------------------------------------------------------------------------
//  Constants / offsets
// ---------------------------------------------------------------------------
static constexpr int kOffMiName       = 0x18;
static constexpr int kOffMiKlass      = 0x20;
static constexpr int kOffMiInterpData = 0x58;

static constexpr int kOffImiArgs              = 0x08;
static constexpr int kOffImiArgStackObjSize   = 0x20;
static constexpr int kOffImiRetStackObjSize   = 0x24;
static constexpr int kOffImiMaxStackSize      = 0x2C;
static constexpr int kOffImiArgCount          = 0x30;
static constexpr int kOffImiEvalStackBase     = 0x38;

static constexpr int kOffMsFrameTopIdx = 0x20;   // _frameTopIdx (frame count)
static constexpr int kOffMsFrameBase   = 0x18;   // _frameBase
static constexpr int kFrameStride      = 0x40;   // sizeof(InterpFrame)
static constexpr int kOffFrameStackBase = 0x08;  // InterpFrame::stackBasePtr

static constexpr int kMaxArgs    = 32;   // metadata args we accept (incl. `this`)
static constexpr int kMaxSlots   = 40;   // slots a call may occupy
static constexpr int kMaxPending = 8;
static constexpr int kMaxTargets = 64;   // g_retSlotChecked / g_retSlotBad capacity

static constexpr uintptr_t kRvaExecuteFallback = 0x64E270;   // 2.0.0
static constexpr uintptr_t kRvaEnterFallback   = 0x64E1C0;   // 2.0.0
static constexpr uintptr_t kRvaLeaveFallback   = 0x662410;   // 2.0.0

// ---------------------------------------------------------------------------
//  Module / PE helpers
// ---------------------------------------------------------------------------
static uintptr_t g_base = 0;
static uintptr_t g_execAddr = 0;
static uintptr_t g_enterAddr = 0;
static uintptr_t g_leaveAddr = 0;
static bool      g_installed = false;
static bool      g_detected = false;

static inline bool PlausiblePtr(const void* p) {
    auto v = reinterpret_cast<uintptr_t>(p);
    return v >= 0x10000 && (v & 7) == 0 && v < 0x00007FFFFFFFFFFF;
}

// True when [p, p+n) is committed and readable.  `Il2CppClass::field_count` can
// over-report for hotfix classes, so the field iteration below can walk past the
// real array; a garbage name pointer there must not be dereferenced.
static bool ReadableRange(const void* p, size_t n) {
    auto addr = reinterpret_cast<uintptr_t>(p);
    if (addr < 0x10000) return false;
    MEMORY_BASIC_INFORMATION mbi{};
    if (VirtualQuery(p, &mbi, sizeof(mbi)) == 0) return false;
    if (mbi.State != MEM_COMMIT) return false;
    if (mbi.Protect & (PAGE_NOACCESS | PAGE_GUARD)) return false;
    auto regionEnd = reinterpret_cast<uintptr_t>(mbi.BaseAddress) + mbi.RegionSize;
    return addr + n <= regionEnd;
}

// Metadata strings (method/class names) live in the mapped global-metadata blob
// and are byte-packed, so they must not be alignment-checked.
static bool PlausibleName(const char* s) {
    auto v = reinterpret_cast<uintptr_t>(s);
    if (v < 0x10000 || v >= 0x00007FFFFFFFFFFF) return false;
    if (!ReadableRange(s, 200)) return false;
    for (int i = 0; i < 200; i++) {
        unsigned char c = (unsigned char)s[i];
        if (c == 0) return i > 0;
        if (c < 0x20 || c > 0x7E) return false;
    }
    return false;   // no terminator within 200 bytes
}

static bool ReadPtrAt(uintptr_t addr, uintptr_t* out) {
    // All pointers fed to this helper come from the interpreter itself (the
    // MethodInfo of a live call), so a plausibility check is enough; SEH is not
    // available in the MinGW build.
    if (addr < 0x10000 || (addr & 7)) return false;
    *out = *reinterpret_cast<uintptr_t*>(addr);
    return true;
}

struct Section { uintptr_t begin; size_t size; bool exec; };

static int ReadSections(Section* out, int maxSections) {
    auto* dos = reinterpret_cast<IMAGE_DOS_HEADER*>(g_base);
    if (dos->e_magic != IMAGE_DOS_SIGNATURE) return 0;
    auto* nt = reinterpret_cast<IMAGE_NT_HEADERS64*>(g_base + dos->e_lfanew);
    if (nt->Signature != IMAGE_NT_SIGNATURE) return 0;
    int n = 0;
    auto* sec = IMAGE_FIRST_SECTION(nt);
    for (int i = 0; i < nt->FileHeader.NumberOfSections && n < maxSections; i++) {
        out[n].begin = g_base + sec[i].VirtualAddress;
        out[n].size  = sec[i].Misc.VirtualSize;
        out[n].exec  = (sec[i].Characteristics & IMAGE_SCN_MEM_EXECUTE) != 0;
        n++;
    }
    return n;
}

// .pdata (RUNTIME_FUNCTION) lookup: the image ships ~366k entries in 2.0.0.
// RUNTIME_FUNCTION is 12 bytes — {BeginAddress, EndAddress, UnwindInfoAddress};
// an 8-byte struct makes the count and every entry wrong.
struct RuntimeFunc { uint32_t begin; uint32_t end; uint32_t unwind; };
static_assert(sizeof(RuntimeFunc) == 12, "RUNTIME_FUNCTION must be 12 bytes");

static bool LoadFunctionTable(std::vector<RuntimeFunc>& out) {
    auto* dos = reinterpret_cast<IMAGE_DOS_HEADER*>(g_base);
    if (dos->e_magic != IMAGE_DOS_SIGNATURE) return false;
    auto* nt = reinterpret_cast<IMAGE_NT_HEADERS64*>(g_base + dos->e_lfanew);
    if (nt->Signature != IMAGE_NT_SIGNATURE) return false;
    auto& dir = nt->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_EXCEPTION];
    if (!dir.VirtualAddress || !dir.Size) return false;
    auto* rf = reinterpret_cast<RuntimeFunc*>(g_base + dir.VirtualAddress);
    size_t count = dir.Size / sizeof(RuntimeFunc);
    out.assign(rf, rf + count);
    return true;
}

// Function containing `va` (RVA space), from a preloaded table.
static bool FuncBounds(const std::vector<RuntimeFunc>& table, uintptr_t va,
                       uintptr_t* begin, uintptr_t* end) {
    uint32_t rva = (uint32_t)(va - g_base);
    size_t lo = 0, hi = table.size();
    while (lo < hi) {
        size_t mid = (lo + hi) / 2;
        if (table[mid].begin <= rva) lo = mid + 1; else hi = mid;
    }
    if (lo == 0) return false;
    const RuntimeFunc& f = table[lo - 1];
    if (rva < f.begin || rva >= f.end) return false;
    *begin = g_base + f.begin;
    *end   = g_base + f.end;
    return true;
}

// ---------------------------------------------------------------------------
//  Interpreter discovery
// ---------------------------------------------------------------------------
// "CallInterpDelegate" is a literal the interpreter error path formats; the
// interpreter entry is the only function that references it (3 xrefs in 2.0.0).
static bool FindStringRefs(const char* needle, std::vector<uintptr_t>* strVas,
                           int maxHits) {
    Section secs[16];
    int n = ReadSections(secs, 16);
    size_t len = std::strlen(needle);
    for (int i = 0; i < n; i++) {
        auto* p = reinterpret_cast<uint8_t*>(secs[i].begin);
        if (secs[i].size < len) continue;
        for (size_t off = 0; off + len <= secs[i].size; off++) {
            if (p[off] != (uint8_t)needle[0]) continue;
            if (std::memcmp(p + off, needle, len) != 0) continue;
            if (p[off + len] != 0) continue;            // must be the full literal
            strVas->push_back(secs[i].begin + off);
            if ((int)strVas->size() >= maxHits) return true;
        }
    }
    return !strVas->empty();
}

static bool IsRipLeaBefore(const uint8_t* code, size_t pos) {
    // pos = offset of the disp32; the lea is `48/4C 8D <modrm>` 3 bytes before.
    if (pos < 3) return false;
    uint8_t b0 = code[pos - 3], b1 = code[pos - 2], b2 = code[pos - 1];
    if (b0 != 0x48 && b0 != 0x4C) return false;
    if (b1 != 0x8D) return false;
    return (b2 & 0xC7) == 0x05;                          // mod=00, rm=101 (RIP)
}

// Locate `Interpreter::Execute`.  Primary: xref to the "CallInterpDelegate"
// literal.  Fallback: the version-keyed RVA, sanity-checked by shape.
static bool FindExecute(uintptr_t* out) {
    std::vector<RuntimeFunc> table;
    LoadFunctionTable(table);

    std::vector<uintptr_t> strVas;
    if (FindStringRefs("CallInterpDelegate", &strVas, 4)) {
        Section secs[16];
        int n = ReadSections(secs, 16);
        std::unordered_map<uintptr_t, int> votes;
        for (int i = 0; i < n; i++) {
            if (!secs[i].exec) continue;
            auto* code = reinterpret_cast<uint8_t*>(secs[i].begin);
            for (size_t off = 0; off + 4 <= secs[i].size; off++) {
                if (!IsRipLeaBefore(code, off)) continue;
                int32_t disp;
                std::memcpy(&disp, code + off, 4);
                uintptr_t target = secs[i].begin + off + 4 + (int64_t)disp;
                for (uintptr_t sv : strVas) {
                    if (target != sv) continue;
                    uintptr_t fbeg, fend;
                    if (FuncBounds(table, secs[i].begin + off, &fbeg, &fend))
                        votes[fbeg]++;
                }
            }
        }
        uintptr_t best = 0;
        int bestVotes = 0;
        uintptr_t bestSize = 0;
        for (auto& kv : votes) {
            uintptr_t fbeg, fend;
            if (!FuncBounds(table, kv.first, &fbeg, &fend)) continue;
            if (fend - fbeg < 20000) continue;           // the interpreter is huge
            if (kv.second > bestVotes) {
                bestVotes = kv.second; best = kv.first; bestSize = fend - fbeg;
            }
        }
        if (best) {
            log("[hybrid] Interpreter::Execute @ 0x%llX (%llu bytes, %d literal xref(s))",
                (unsigned long long)best, (unsigned long long)bestSize, bestVotes);
            *out = best;
            return true;
        }
        log("[hybrid] CallInterpDelegate literal found (%d) but no xref resolved", (int)strVas.size());
    } else {
        log("[hybrid] CallInterpDelegate literal not found");
    }

    uintptr_t cand = g_base + kRvaExecuteFallback;
    uintptr_t fbeg, fend;
    if (FuncBounds(table, cand, &fbeg, &fend) && cand == fbeg && (fend - fbeg) > 20000) {
        log("[hybrid] Interpreter::Execute @ 0x%llX (version-table RVA 0x%llX)",
            (unsigned long long)cand, (unsigned long long)kRvaExecuteFallback);
        *out = cand;
        return true;
    }
    return false;
}

// Does the function at `va` contain `mov r64, [reg+0x58]` (method->interpData)?
static bool HasInterpDataLoad(uintptr_t va, uintptr_t end) {
    for (uintptr_t p = va; p + 3 <= end; p++) {
        auto* b = reinterpret_cast<const uint8_t*>(p);
        if (b[0] == 0x48 && b[1] == 0x8B && (b[2] & 0xC0) == 0x40 && b[3] == 0x58)
            return true;
    }
    return false;
}

// Does it contain `mov [reg+0x58], r64` — i.e. does it *cache* interpData?
// InterpreterModule::GetInterpMethodInfo does exactly that (`method->interpData =
// imi` at the end), while EnterFrameFromInterpreter only reads the field.  Without
// this test both functions score identically (both read +0x58, both are small,
// both are called from Execute) and the choice would be arbitrary.
static bool HasInterpDataStore(uintptr_t va, uintptr_t end) {
    for (uintptr_t p = va; p + 3 <= end; p++) {
        auto* b = reinterpret_cast<const uint8_t*>(p);
        if (b[0] == 0x48 && b[1] == 0x89 && (b[2] & 0xC0) == 0x40 && b[3] == 0x58)
            return true;
    }
    return false;
}

// Locate `InterpFrameGroup::EnterFrameFromInterpreter` among Execute's direct
// call targets.  Shape tests: .pdata function start, <= 512 bytes, contains the
// interpData load and at least two calls, and is called from Execute at least
// twice.
static bool FindEnterFrame(uintptr_t execBeg, uintptr_t execEnd, uintptr_t* out) {
    std::vector<RuntimeFunc> table;
    LoadFunctionTable(table);

    std::unordered_map<uintptr_t, int> callCount;
    auto* code = reinterpret_cast<const uint8_t*>(execBeg);
    for (uintptr_t p = execBeg; p + 5 <= execEnd; p++) {
        if (code[p - execBeg] != 0xE8) continue;
        int32_t rel;
        std::memcpy(&rel, code + (p - execBeg) + 1, 4);
        uintptr_t target = p + 5 + (int64_t)rel;
        if (target < g_base || target >= g_base + 0x10000000) continue;
        callCount[target]++;
    }

    struct Scored { int score; uintptr_t va; int calls; };
    std::vector<Scored> scored;
    for (auto& kv : callCount) {
        uintptr_t cand = kv.first;
        uintptr_t fbeg, fend;
        if (!FuncBounds(table, cand, &fbeg, &fend)) continue;
        if (cand != fbeg) continue;
        size_t size = (size_t)(fend - fbeg);
        if (size < 64 || size > 512) continue;
        if (HasInterpDataStore(fbeg, fend)) continue;   // GetInterpMethodInfo, not the frame push
        int score = 0;
        if (HasInterpDataLoad(fbeg, fend)) score += 3;
        if (kv.second >= 2) score += 2;
        if (kv.second >= 5) score += 1;
        if (score >= 5) scored.push_back({ score, cand, kv.second });
    }
    // Deterministic order: best score first, then lowest address.
    std::sort(scored.begin(), scored.end(), [](const Scored& a, const Scored& b) {
        if (a.score != b.score) return a.score > b.score;
        return a.va < b.va;
    });
    if (!scored.empty()) {
        const Scored& pick = scored.front();
        log("[hybrid] EnterFrameFromInterpreter @ 0x%llX (score %d, %d calls from Execute, %d candidate(s))",
            (unsigned long long)pick.va, pick.score, pick.calls, (int)scored.size());
        *out = pick.va;
        return true;
    }

    uintptr_t cand = g_base + kRvaEnterFallback;
    uintptr_t fbeg, fend;
    if (FuncBounds(table, cand, &fbeg, &fend) && cand == fbeg && (fend - fbeg) >= 64 &&
        (fend - fbeg) <= 512 && HasInterpDataLoad(cand, fend) && !HasInterpDataStore(cand, fend)) {
        log("[hybrid] EnterFrameFromInterpreter @ 0x%llX (version-table RVA 0x%llX)",
            (unsigned long long)cand, (unsigned long long)kRvaEnterFallback);
        *out = cand;
        return true;
    }
    return false;
}

// Locate `InterpFrameGroup::LeaveFrame` — the interpreter's only return event.
// Every `ret`/unwind handler in Execute has the same shape:
//
//     49 8B 7F 18     mov  rdi, [r15+0x18]   ; _curRet = frame->ret
//     48 8D 4D 50     lea  rcx, [rbp+0x50]   ; &interpFrameGroup
//     E8 rel32        call LeaveFrame
//
// (r15 is the current InterpFrame, rbp the Execute frame).  Nine handlers carry
// that shape in 2.0.0 and all of them call the same function, so a vote is
// unambiguous; the shape is only a locator — the target is still validated
// against .pdata as a function start of plausible size.
static bool FindLeaveFrame(uintptr_t execBeg, uintptr_t execEnd, uintptr_t* out) {
    std::vector<RuntimeFunc> table;
    LoadFunctionTable(table);

    static const uint8_t kPat[] = { 0x49, 0x8B, 0x7F, 0x18, 0x48, 0x8D, 0x4D, 0x50, 0xE8 };
    constexpr size_t kPatLen = sizeof(kPat);

    std::unordered_map<uintptr_t, int> votes;
    auto* code = reinterpret_cast<const uint8_t*>(execBeg);
    for (uintptr_t p = execBeg; p + kPatLen + 4 <= execEnd; p++) {
        if (std::memcmp(code + (p - execBeg), kPat, kPatLen) != 0) continue;
        int32_t rel;
        std::memcpy(&rel, code + (p - execBeg) + kPatLen, 4);
        uintptr_t target = p + kPatLen + 4 + (int64_t)rel;
        if (target < g_base || target >= g_base + 0x10000000) continue;
        votes[target]++;
    }

    uintptr_t best = 0;
    int bestVotes = 0;
    for (auto& kv : votes) {
        uintptr_t fbeg, fend;
        if (!FuncBounds(table, kv.first, &fbeg, &fend)) continue;
        if (kv.first != fbeg) continue;
        size_t size = (size_t)(fend - fbeg);
        if (size < 0x40 || size > 0x400) continue;
        if (kv.second > bestVotes) { bestVotes = kv.second; best = kv.first; }
    }
    if (best && bestVotes >= 2) {
        log("[hybrid] LeaveFrame @ 0x%llX (%d ret-handler calls, %d candidate(s))",
            (unsigned long long)best, bestVotes, (int)votes.size());
        *out = best;
        return true;
    }

    uintptr_t cand = g_base + kRvaLeaveFallback;
    uintptr_t fbeg, fend;
    if (FuncBounds(table, cand, &fbeg, &fend) && cand == fbeg &&
        (fend - fbeg) >= 0x40 && (fend - fbeg) <= 0x400) {
        log("[hybrid] LeaveFrame @ 0x%llX (version-table RVA 0x%llX)",
            (unsigned long long)cand, (unsigned long long)kRvaLeaveFallback);
        *out = cand;
        return true;
    }
    return false;
}

bool Detect(uintptr_t gameBase) {
    if (g_detected) return g_execAddr != 0;
    g_base = gameBase;
    if (!g_base) return false;
    std::vector<RuntimeFunc> table;
    if (!LoadFunctionTable(table) || table.empty()) {
        log("[hybrid] no .pdata function table — cannot locate the interpreter");
        return false;
    }
    log("[hybrid] .pdata: %d functions", (int)table.size());
    if (!FindExecute(&g_execAddr)) {
        log("[hybrid] interpreter entry not found; hotfix hooks unavailable");
        return false;
    }
    uintptr_t fbeg, fend;
    if (!FuncBounds(table, g_execAddr, &fbeg, &fend)) return false;
    if (!FindEnterFrame(fbeg, fend, &g_enterAddr)) {
        // Not fatal: native entries still work, interpreted->interpreted calls
        // are not observable.
        log("[hybrid] EnterFrameFromInterpreter not identified — "
            "interpreted->interpreted hooks disabled (native entries still hooked)");
    }
    if (!FindLeaveFrame(fbeg, fend, &g_leaveAddr)) {
        // Not fatal, but deferred After bodies then fall back to the next
        // interpreter event, which is only safe while the caller frame is
        // still on the stack (FlushPending drops them otherwise).
        log("[hybrid] LeaveFrame not identified — deferred bodies use the "
            "next interpreter event (bodies whose caller already returned are dropped)");
    }
    g_detected = true;
    return true;
}

// ---------------------------------------------------------------------------
//  Argument layout
// ---------------------------------------------------------------------------
static const char* MethodName(const void* method);
static void* MethodKlass(const void* method);

struct ImiInfo {
    void*    args;              // MethodArgDesc*
    uint32_t argStackObjectSize;
    uint32_t retStackObjectSize;
    uint32_t maxStackSize;
    uint32_t evalStackBaseOffset;   // slot index of the eval stack base, i.e. the
                                    // return slot for a non-void method
    uint32_t argCount;
};

static bool ReadImi(const void* method, ImiInfo* out) {
    uintptr_t imi;
    if (!ReadPtrAt(reinterpret_cast<uintptr_t>(method) + kOffMiInterpData, &imi)) return false;
    if (!imi || (imi & 7)) return false;
    out->args = *reinterpret_cast<void**>(imi + kOffImiArgs);
    out->argStackObjectSize = *reinterpret_cast<uint32_t*>(imi + kOffImiArgStackObjSize);
    out->retStackObjectSize = (*reinterpret_cast<uint32_t*>(imi + kOffImiRetStackObjSize)) & 0x00FFFFFF;
    out->maxStackSize = *reinterpret_cast<uint32_t*>(imi + kOffImiMaxStackSize);
    out->evalStackBaseOffset = *reinterpret_cast<uint32_t*>(imi + kOffImiEvalStackBase);
    out->argCount = (*reinterpret_cast<uint32_t*>(imi + kOffImiArgCount)) & 0xFF;
    return true;
}

// Slot index of every metadata argument (index 0 is `this` for instance
// methods, matching ImiInfo::args[0] as used by InterpreterModule).
// `MethodArgDesc::stackObjectSize` is in StackObject units; value types that do
// not fit one slot (e.g. TrueSync.TSVector2 = 16 bytes) occupy two, their bytes
// stored inline.
static bool ComputeArgOffsets(const void* method, int* offsets, int* argCount,
                              int* slotCount) {
    ImiInfo imi;
    if (!ReadImi(method, &imi)) return false;
    if (!imi.args || imi.argCount == 0 || imi.argCount > (uint32_t)kMaxArgs) return false;
    auto* descs = reinterpret_cast<const uint8_t*>(imi.args);
    int slot = 0;
    for (uint32_t i = 0; i < imi.argCount; i++) {
        uint8_t passByVal = descs[i * 4 + 0];
        uint16_t size = *reinterpret_cast<const uint16_t*>(descs + i * 4 + 2);
        int step = passByVal ? 1 : (int)size;
        if (step <= 0) return false;
        if (slot + step > kMaxSlots) return false;
        offsets[i] = slot;
        slot += step;
    }
    if ((uint32_t)slot != imi.argStackObjectSize) {
        log("[hybrid] arg layout mismatch for '%s': computed %d slots, imi says %u",
            PlausibleName(MethodName(method)) ? MethodName(method) : "?",
            slot, imi.argStackObjectSize);
        return false;
    }
    *argCount = (int)imi.argCount;
    *slotCount = slot;
    return true;
}

// ---------------------------------------------------------------------------
//  Registry
// ---------------------------------------------------------------------------
struct CacheRec {
    const void* method;
    int         target;        // index into g_targets, -1 = resolved non-target
    int         argCount;
    int         slotCount;
    // Where the callee's return value sits while the frame is still pushed:
    // `evalStackBaseOffset` slots from `InterpFrame::stackBasePtr`.  Only filled
    // for targets whose body needs the engine result (`needsRealOrig`) and whose
    // return fits one StackObject; everything else falls back to DupCall.
    int         retOffset;
    bool        captureReturn;
    int         off[kMaxArgs];
};

static const TargetDesc* g_targets = nullptr;
static int               g_targetCount = 0;

static constexpr int kCacheSize = 8192;      // power of two
static std::atomic<CacheRec*> g_cache[kCacheSize];
static std::mutex g_resolveMutex;
// Authoritative store: every method seen so far.  The array above is only a
// fast path (two methods hashing to the same slot must not re-resolve/allocate
// on every call), and CacheRec objects are never freed.
static std::unordered_map<const void*, CacheRec*> g_resolvedMap;

static std::mutex g_klassMutex;
static std::unordered_map<std::string, void*> g_klassByName;
static std::unordered_map<std::string, void*> g_methodByName;

static void LearnClass(void* klass) {
    if (!PlausiblePtr(klass)) return;
    const char* name = reinterpret_cast<Il2CppClass*>(klass)->_1.name;
    if (!PlausibleName(name)) return;
    std::lock_guard<std::mutex> lk(g_klassMutex);
    auto it = g_klassByName.find(name);
    if (it == g_klassByName.end()) g_klassByName.emplace(name, klass);
}

static int MatchTarget(void* klass, const char* methodName) {
    const char* klassName = klass
        ? reinterpret_cast<Il2CppClass*>(klass)->_1.name : nullptr;
    if (!klassName) return -1;
    for (int i = 0; i < g_targetCount; i++) {
        if (std::strcmp(g_targets[i].klass, klassName) != 0) continue;
        if (std::strcmp(g_targets[i].method, methodName) != 0) continue;
        return i;
    }
    return -1;
}

// ---------------------------------------------------------------------------
//  Struct-layout verification
// ---------------------------------------------------------------------------
// 2.0.0 moved the whole Nova.Client data model (AdventureActor, HitDamage,
// Effect, …) out of the AOT image into the hotfix assembly, so their instance
// layouts are now defined by the hotfix metadata while game_structs.h still
// carries the offsets generated from the 1.15 AOT dump.  The hook bodies read
// those structs, so verify the offsets the bodies depend on against the runtime
// FieldInfo table once per class, and fail safe (no bodies) if one moved.
//
// FieldInfo (il2cpp-class-internals.h, Unity 2019-2022):
//     +0x00 const char* name
//     +0x08 const Il2CppType* type
//     +0x10 Il2CppClass* parent
//     +0x18 int32_t offset
//     +0x1C uint32_t token
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Winvalid-offsetof"

struct FieldCheck { const char* klass; const char* field; int32_t expected; };

static const FieldCheck g_fieldChecks[] = {
    // Fields whose *offset* the hook bodies depend on when they dereference
    // pointers straight out of these structs.
    { "AdventureActor",   "_dataID_k__BackingField",
      (int32_t)offsetof(AdventureActor_o, fields._dataID_k__BackingField) },
    { "AdventureActor",   "attributeList",
      (int32_t)offsetof(AdventureActor_o, fields.attributeList) },
    { "AdventureActor",   "specialAttributeList",
      (int32_t)offsetof(AdventureActor_o, fields.specialAttributeList) },
    { "MonsterSummonInfo", "_SummonActor_k__BackingField",
      (int32_t)offsetof(MonsterSummonInfo_o, fields._SummonActor_k__BackingField) },
    { "MonsterSummonInfo", "_Entity_k__BackingField",
      (int32_t)offsetof(MonsterSummonInfo_o, fields._Entity_k__BackingField) },
    { "AreaEffectEntity", "_owner_k__BackingField",
      (int32_t)offsetof(AreaEffectEntity_o, fields._owner_k__BackingField) },
    { "AreaEffectEntity", "_fxPlayer_k__BackingField",
      (int32_t)offsetof(AreaEffectEntity_o, fields._fxPlayer_k__BackingField) },
    { "HitDamage",        "id_",
      (int32_t)offsetof(Nova_Client_HitDamage_o, fields.id_) },
    { "HitDamage",        "damageBonusType_",
      (int32_t)offsetof(Nova_Client_HitDamage_o, fields.damageBonusType_) },
    { "Effect",           "id_",
      (int32_t)offsetof(Nova_Client_Effect_o, fields.id_) },
    { "EffectValue",      "id_",
      (int32_t)offsetof(Nova_Client_EffectValue_o, fields.id_) },
    { "BuffEffect",       "id_",
      (int32_t)offsetof(Nova_Client_BuffEffect_o, fields.id_) },

    // Pointer fields dereferenced by the hit path (BuildHitJson / effect and buff
    // lists).  Any of these moving must disable logging, not crash.
    { "ActorAdditionalAttrInfo", "attributeWithElementOrDamageTypeDict",
      (int32_t)offsetof(ActorAdditionalAttrInfo_o, fields.attributeWithElementOrDamageTypeDict) },
    { "ActorAdditionalAttrInfo", "_attributeList_k__BackingField",
      (int32_t)offsetof(ActorAdditionalAttrInfo_o, fields._attributeList_k__BackingField) },
    { "ActorEffectManage", "effectsDict",
      (int32_t)offsetof(ActorEffectManage_o, fields.effectsDict) },
    { "ActorEffectManage", "_actor",
      (int32_t)offsetof(ActorEffectManage_o, fields._actor) },
    { "ActorEffectManage", "_timeTriggerEffects",
      (int32_t)offsetof(ActorEffectManage_o, fields._timeTriggerEffects) },
    { "AdventureActor",   "buffComponent",
      (int32_t)offsetof(AdventureActor_o, fields.buffComponent) },
    { "AdventureActor",   "effectManage",
      (int32_t)offsetof(AdventureActor_o, fields.effectManage) },
    { "AdventureEffect",  "_effectConfig_k__BackingField",
      (int32_t)offsetof(AdventureEffect_o, fields._effectConfig_k__BackingField) },
    { "AdventureEffect",  "_effectValueConfig_k__BackingField",
      (int32_t)offsetof(AdventureEffect_o, fields._effectValueConfig_k__BackingField) },
    { "AdventureEffect",  "_effectStack",
      (int32_t)offsetof(AdventureEffect_o, fields._effectStack) },
    { "AdventureEffect",  "_owner",
      (int32_t)offsetof(AdventureEffect_o, fields._owner) },
    { "AdventureEffect",  "_fromActor",
      (int32_t)offsetof(AdventureEffect_o, fields._fromActor) },
    { "AdventureEffectBase", "_effect",
      (int32_t)offsetof(AdventureEffectBase_o, fields._effect) },
    { "BuffEntity",       "_buffCom",
      (int32_t)offsetof(BuffEntity_o, fields._buffCom) },
    { "BuffEntity",       "buffConfig",
      (int32_t)offsetof(BuffEntity_o, fields.buffConfig) },
    { "BuffCom",          "_BuffList_k__BackingField",
      (int32_t)offsetof(BuffCom_o, fields._BuffList_k__BackingField) },
    { "AttributeList",    "entries",
      (int32_t)offsetof(AttributeList_o, fields.entries) },
    { "AdventureSkill",   "_owner_k__BackingField",
      (int32_t)offsetof(AdventureSkill_o, fields._owner_k__BackingField) },
};
#pragma GCC diagnostic pop

static constexpr int kFieldInfoStride = 0x20;
static std::atomic<bool> g_layoutOk{true};
// Il2CppClass::fields is an array of FieldInfo structs in il2cpp, but the dumper
// types it as void*; decide once at runtime by checking which interpretation
// yields printable names, so a layout change cannot make the probe itself crash.
static int g_fieldsArePointers = -1;   // -1 = undecided, 0 = array, 1 = pointer array
static std::unordered_map<const void*, bool> g_layoutChecked;

static void* ClassFieldEntry(void* klassPtr, int index) {
    auto* klass = reinterpret_cast<Il2CppClass*>(klassPtr);
    auto* base = reinterpret_cast<uint8_t*>(klass->_1.fields);
    if (!base) return nullptr;
    if (g_fieldsArePointers < 0) {
        // Decide with the first entry of this class: as an array of FieldInfo
        // structs the first qword is the name pointer; as an array of pointers it
        // is a FieldInfo* whose first qword is the name pointer.
        const char* nameIfStruct = *reinterpret_cast<const char* const*>(base);
        void* firstIfPtr = *reinterpret_cast<void* const*>(base);
        const char* nameIfPtr = (PlausiblePtr(firstIfPtr) && ReadableRange(firstIfPtr, 0x20))
            ? *reinterpret_cast<const char* const*>(firstIfPtr) : nullptr;
        bool okStruct = PlausibleName(nameIfStruct);
        bool okPtr = PlausibleName(nameIfPtr);
        g_fieldsArePointers = (okStruct || !okPtr) ? 0 : 1;
    }
    if (g_fieldsArePointers == 1) {
        auto* arr = reinterpret_cast<void**>(base);
        return arr[index];
    }
    return base + (size_t)index * kFieldInfoStride;
}

// game_structs.h (Il2CppDumper) sanitises compiler-generated names:
// `<owner>k__BackingField` is written `_owner_k__BackingField`.  Compare both
// forms, otherwise every auto-property check reports "not found".
static bool FieldNameMatches(const char* runtimeName, const char* want) {
    if (std::strcmp(runtimeName, want) == 0) return true;
    static const char kSuffix[] = "_k__BackingField";
    const size_t wantLen = std::strlen(want);
    const size_t suffixLen = sizeof(kSuffix) - 1;
    if (wantLen <= suffixLen) return false;
    if (std::strcmp(want + wantLen - suffixLen, kSuffix) != 0) return false;
    const size_t base = wantLen - suffixLen;          // includes the leading '_'
    if (base < 2) return false;
    char alt[128];
    if (base + suffixLen >= sizeof(alt)) return false;
    alt[0] = '<';
    std::memcpy(alt + 1, want + 1, base - 1);
    std::memcpy(alt + base, ">k__BackingField", suffixLen + 1);
    return std::strcmp(runtimeName, alt) == 0;
}

// Look up a field's runtime offset.  A class's FieldInfo array holds only its
// *own* fields, so inherited fields (e.g. MonsterSummonInfo._Entity, declared on
// LogicComponent) require walking the base chain; inherited fields keep the same
// offset in the derived instance.
//
// This is the expensive scan: every entry name goes through PlausibleName() ->
// VirtualQuery, ~22 us per lookup for the big HotfixDataController maps, and the
// hit path did ~185 lookups/s.  Layouts are fixed once the class is loaded, so
// FieldOffsetOf() memoizes positive results per (class, field name); misses are
// not cached (a class can legitimately be queried before its metadata is ready).
static bool FieldOffsetOfUncached(void* klassPtr, const char* fieldName, int32_t* out,
                                  void** declaring) {
    auto* klass = reinterpret_cast<Il2CppClass*>(klassPtr);
    for (int depth = 0; klass && depth < 16; depth++) {
        int count = klass->_2.field_count;
        if (count > 0 && count <= 20000) {
            for (int i = 0; i < count; i++) {
                void* fi = ClassFieldEntry(klass, i);
                if (!fi) break;
                const char* n = *reinterpret_cast<const char* const*>(fi);
                // Own fields come first; a non-name entry means we left the real array.
                if (!PlausibleName(n)) break;
                if (!FieldNameMatches(n, fieldName)) continue;
                *out = *reinterpret_cast<int32_t*>(reinterpret_cast<uint8_t*>(fi) + 0x18);
                if (declaring) *declaring = klass;
                return true;
            }
        }
        klass = klass->_1.parent;
    }
    return false;
}

struct FieldOffsetMemo {
    std::string name;
    int32_t     off;
    void*       declaring;
};

static std::mutex g_fieldMemoMutex;
static std::unordered_map<const void*, std::vector<FieldOffsetMemo>> g_fieldMemo;

static bool FieldOffsetOf(void* klassPtr, const char* fieldName, int32_t* out,
                           void** declaring = nullptr) {
    if (!klassPtr || !fieldName) return false;
    {
        std::lock_guard<std::mutex> lk(g_fieldMemoMutex);
        auto it = g_fieldMemo.find(klassPtr);
        if (it != g_fieldMemo.end()) {
            for (const auto& m : it->second) {
                if (m.name == fieldName) {
                    *out = m.off;
                    if (declaring) *declaring = m.declaring;
                    return true;
                }
            }
        }
    }

    int32_t off = 0;
    void* decl = nullptr;
    if (!FieldOffsetOfUncached(klassPtr, fieldName, &off, &decl)) return false;

    {
        std::lock_guard<std::mutex> lk(g_fieldMemoMutex);
        auto& vec = g_fieldMemo[klassPtr];
        for (const auto& m : vec) {                 // another thread won the race
            if (m.name == fieldName) {
                *out = m.off;
                if (declaring) *declaring = m.declaring;
                return true;
            }
        }
        vec.push_back({fieldName, off, decl});
    }
    *out = off;
    if (declaring) *declaring = decl;
    return true;
}

// Public: field offset inside a live object (walks the object's own class and
// base chain).  Used for objects whose runtime class differs from the header
// (the captured GameDataController object is a HotfixDataController in 2.0.0).
int32_t FieldOffsetInObject(const void* obj, const char* fieldName) {
    if (!obj || !fieldName) return -1;
    void* klass = *reinterpret_cast<void* const*>(obj);
    if (!PlausiblePtr(klass)) return -1;
    int32_t off = 0;
    if (!FieldOffsetOf(klass, fieldName, &off)) return -2;
    return off;
}

void* ClassByName(const char* klassName) {
    if (!klassName) return nullptr;
    std::lock_guard<std::mutex> lk(g_klassMutex);
    auto it = g_klassByName.find(klassName);
    return it == g_klassByName.end() ? nullptr : it->second;
}

void* ReadStaticFieldPtr(void* klassPtr, const char* fieldName,
                         const char** declaringName) {
    if (!PlausiblePtr(klassPtr) || !fieldName) return nullptr;

    // The field may be declared on a base class (SceneSingleton<T>.g_instance),
    // and a static field's offset is relative to *that* class's static block.
    void* declaring = nullptr;
    int32_t off = 0;
    if (!FieldOffsetOf(klassPtr, fieldName, &off, &declaring)) return nullptr;

    auto* klass = reinterpret_cast<Il2CppClass*>(declaring);
    if (declaringName) {
        const char* n = klass->_1.name;
        *declaringName = PlausibleName(n) ? n : "?";
    }
    if (off < 0) return nullptr;                 // instance field, not static
    if (!klass->static_fields) return nullptr;    // class not initialized yet
    const uint32_t size = klass->_2.static_fields_size;
    if (size != 0 && (uint32_t)off + (uint32_t)sizeof(void*) > size) {
        static bool warned = false;
        if (!warned) {
            warned = true;
            log("[gizmo] %s.%s: offset +0x%X outside static_fields (size 0x%X) — "
                "ignoring", klass->_1.name, fieldName, off, size);
        }
        return nullptr;
    }
    return *reinterpret_cast<void**>(reinterpret_cast<uint8_t*>(klass->static_fields) + off);
}

static void DumpClassLayout(void* klassPtr) {
    auto* klass = reinterpret_cast<Il2CppClass*>(klassPtr);
    const char* name = klass->_1.name;
    log("[layout] class %s: instance_size=0x%X fields=%u",
        PlausibleName(name) ? name : "?", klass->_2.instance_size,
        (unsigned)klass->_2.field_count);
    int count = klass->_2.field_count;
    if (count <= 0) return;
    if (count > 2000) count = 2000;
    for (int i = 0; i < count; i++) {
        void* fi = ClassFieldEntry(klassPtr, i);
        if (!fi) { log("[layout]   (stopped at entry %d: no field)", i); break; }
        auto* p = reinterpret_cast<const uint8_t*>(fi);
        const char* n = *reinterpret_cast<const char* const*>(p);
        void* type = *reinterpret_cast<void* const*>(p + 0x08);
        int32_t off = *reinterpret_cast<const int32_t*>(p + 0x18);
        // `field_count` over-reports for hotfix classes (PlayerAdventureActor:
        // 80 reported, 36 real), so stop at the first entry that is not a field.
        if (!PlausibleName(n)) { log("[layout]   (stopped at entry %d: no name)", i); break; }
        if (off < -1 || off > 0x1000000) { log("[layout]   (stopped at entry %d: offset %d)", i, off); break; }
        log("[layout]   %+6d (0x%X) %-40s ty=%u type=0x%llX",
            off, (uint32_t)off, n,
            type ? ((*reinterpret_cast<const uint32_t*>(reinterpret_cast<uint8_t*>(type) + 0x08) >> 16) & 0xFF) : 0u,
            (unsigned long long)reinterpret_cast<uintptr_t>(type));
    }
}

static std::unordered_map<const void*, bool> g_dumped;

// Dump the class and its base chain (offsets of inherited fields are relative to
// the base instance, so the whole chain is needed to rebuild a struct).
static void DumpClassAndParents(void* klassPtr, int maxParents) {
    auto* klass = reinterpret_cast<Il2CppClass*>(klassPtr);
    for (int i = 0; klass && i <= maxParents; i++) {
        if (!g_dumped.emplace(klass, true).second) break;
        DumpClassLayout(klass);
        klass = klass->_1.parent;
    }
}

// Runs once per class (under g_resolveMutex).  Bodies stop running as soon as a
// check cannot be confirmed, so a moved offset degrades to a clear log instead
// of a crash.
static void VerifyClassLayout(void* klassPtr) {
    if (!g_layoutChecked.emplace(klassPtr, true).second) return;
    auto* klass = reinterpret_cast<Il2CppClass*>(klassPtr);
    const char* name = klass->_1.name;
    if (!PlausibleName(name)) return;

    // Only dump when asked to: a MISMATCH / missing field dumps the chain itself
    // (below), and `hotfix_layout_probe` dumps every interpreted class.
    if (g_Cfg.hotfix_layout_probe) DumpClassLayout(klassPtr);

    for (const FieldCheck& c : g_fieldChecks) {
        if (std::strcmp(c.klass, name) != 0) continue;
        int32_t got = 0;
        if (!FieldOffsetOf(klassPtr, c.field, &got)) {
            log("[layout] %s.%s: not found in the runtime class — hotfix logging disabled "
                "(game_structs.h is stale for this class; layout dumped above)",
                name, c.field);
            g_layoutOk.store(false, std::memory_order_relaxed);
            DumpClassAndParents(klassPtr, 6);
            continue;
        }
        if (got == c.expected) {
            log("[layout] %s.%s OK (+0x%X)", name, c.field, got);
        } else {
            log("[layout] %s.%s MISMATCH: game_structs.h +0x%X, runtime +0x%X — "
                "hotfix logging disabled; re-run with hotfix_layout_probe=1 to dump every class",
                name, c.field, c.expected, got);
            g_layoutOk.store(false, std::memory_order_relaxed);
            DumpClassAndParents(klassPtr, 6);
        }
    }
}

static const char* MethodName(const void* method) {
    return *reinterpret_cast<const char* const*>(
        reinterpret_cast<uintptr_t>(method) + kOffMiName);
}

static void* MethodKlass(const void* method) {
    return *reinterpret_cast<void* const*>(
        reinterpret_cast<uintptr_t>(method) + kOffMiKlass);
}

// Defined with the outgoing-call helpers; used from ResolveMethod to remember
// every interpreted method by name (see LearnMethodName).
static void LearnMethodName(void* klass, const char* methodName, void* method);

// Cold path: identify `method`, learn its class, build the argument layout.
static CacheRec* ResolveMethod(const void* method) {
    std::lock_guard<std::mutex> lk(g_resolveMutex);

    int idx = (int)((reinterpret_cast<uintptr_t>(method) >> 4) & (kCacheSize - 1));
    CacheRec* cached = g_cache[idx].load(std::memory_order_relaxed);
    if (cached && cached->method == method) return cached;

    auto known = g_resolvedMap.find(method);
    if (known != g_resolvedMap.end()) {
        g_cache[idx].store(known->second, std::memory_order_release);   // re-fill fast path
        return known->second;
    }

    const char* name = MethodName(method);
    if (!PlausibleName(name)) name = nullptr;
    void* klass = MethodKlass(method);
    if (!PlausiblePtr(klass)) klass = nullptr;
    if (klass) LearnClass(klass);
    if (klass) VerifyClassLayout(klass);
    // Also remember every method we see by name: some hotfix classes expose only
    // a prefix of their metadata methods in klass->methods (see LearnMethodName).
    if (klass && name) LearnMethodName(klass, name, const_cast<void*>(method));

    int target = (name && klass) ? MatchTarget(klass, name) : -1;

    ImiInfo probe;
    if (target >= 0 && !ReadImi(method, &probe)) {
        // `interpData` is filled in by the interpreter itself on the very first
        // native entry (PREPARE_NEW_FRAME_FROM_NATIVE runs *after* our detour),
        // so the first call of a method can arrive before its layout exists.
        // Do not cache a negative result — the next call resolves normally.
        return nullptr;
    }

    auto* rec = new CacheRec();
    rec->method = method;
    rec->target = target;
    rec->argCount = 0;
    rec->slotCount = 0;
    rec->retOffset = 0;
    rec->captureReturn = false;
    std::memset(rec->off, 0, sizeof(rec->off));
    ComputeArgOffsets(method, rec->off, &rec->argCount, &rec->slotCount);

    if (rec->target >= 0) {
        const TargetDesc& d = g_targets[rec->target];
        if (rec->argCount != d.argCount) {
            log("[hybrid] '%s.%s' arg count mismatch: metadata %d, expected %d — target disabled",
                d.klass, d.method, rec->argCount, d.argCount);
            rec->target = -1;
        } else if (rec->slotCount == 0) {
            log("[hybrid] '%s.%s': argument layout unavailable (interpData not ready) — target disabled",
                d.klass, d.method);
            rec->target = -1;
        } else {
            // `needsRealOrig` bodies need the engine's result.  On the internal
            // path the value is read from the callee frame at LeaveFrame (see
            // ReadReturnValue): the interpreter copies it into `frame->ret` only
            // after LeaveFrame returns, so it is still in the frame here.  That
            // works for a one-slot return (i64 / reference); anything else keeps
            // the duplicate call.
            rec->retOffset = (int)probe.evalStackBaseOffset;
            rec->captureReturn = d.needsRealOrig &&
                                 rec->target < kMaxTargets &&
                                 probe.retStackObjectSize == 1 &&
                                 probe.evalStackBaseOffset < probe.maxStackSize;
            if (d.needsRealOrig && !rec->captureReturn) {
                log("[hybrid] '%s.%s': return not capturable from the frame "
                    "(ret slots %u, eval base %u, max stack %u) — deferred bodies "
                    "re-ask the engine call",
                    d.klass, d.method, (unsigned)probe.retStackObjectSize,
                    (unsigned)probe.evalStackBaseOffset, (unsigned)probe.maxStackSize);
            }
            log("[hybrid] target ready: %s.%s (args %d, slots %d, %s%s)",
                d.klass, d.method, rec->argCount, rec->slotCount,
                d.mode == Mode::Entry ? "entry" : "after",
                d.needsRealOrig ? (rec->captureReturn ? ", ret from frame" : ", ret re-asked") : "");
        }
    }

    g_resolvedMap.emplace(method, rec);
    g_cache[idx].store(rec, std::memory_order_release);
    return rec;
}

static inline CacheRec* Lookup(const void* method) {
    int idx = (int)((reinterpret_cast<uintptr_t>(method) >> 4) & (kCacheSize - 1));
    CacheRec* r = g_cache[idx].load(std::memory_order_acquire);
    if (r && r->method == method) return r;
    return ResolveMethod(method);
}

// ---------------------------------------------------------------------------
//  Per-thread state
// ---------------------------------------------------------------------------
struct Pending {
    const CacheRec* rec;
    int             slotCount;
    int             depth;      // frame index the callee frame occupies
    StackObject     slots[kMaxSlots];
};

static __thread Pending  tls_pend[kMaxPending];
static __thread int      tls_pendN = 0;
static __thread void*    tls_machineState = nullptr;
static __thread const void* tls_curMethod = nullptr;
static __thread bool     tls_retValid = false;
static __thread int64_t  tls_retValue = 0;
static std::atomic<int>  g_droppedBodies{0};   // deferred bodies dropped as unsafe

// One-time per-target check of the return-slot assumption (see VerifyReturnSlot).
// `bad` makes every later hit fall back to DupCall, i.e. the pre-slot behaviour.
static std::atomic<bool> g_retSlotChecked[kMaxTargets]{};
static std::atomic<bool> g_retSlotBad[kMaxTargets]{};

static inline int32_t FrameDepth() {
    if (!tls_machineState) return -1;
    return *reinterpret_cast<int32_t*>(reinterpret_cast<uintptr_t>(tls_machineState) + kOffMsFrameTopIdx);
}

bool    CurrentRetValid()  { return tls_retValid; }
int64_t CurrentRetValue()  { return tls_retValue; }

// ---------------------------------------------------------------------------
//  Detours
// ---------------------------------------------------------------------------
using FnExecute    = void  (__fastcall*)(const void* method, StackObject* args, void* ret);
using FnEnterFrame = void* (__fastcall*)(void* frameGroup, const void* method, StackObject* argBase);
using FnLeaveFrame = void* (__fastcall*)(void* frameGroup);

static FnExecute    g_origExecute    = nullptr;
static FnEnterFrame g_origEnterFrame = nullptr;
static FnLeaveFrame g_origLeaveFrame = nullptr;

static void RunBody(const CacheRec* rec, const StackObject* slots, void* ret) {
    // Fail safe: if a struct the bodies read has moved in this game build
    // (VerifyClassLayout), stop running bodies instead of dereferencing garbage.
    if (!g_layoutOk.load(std::memory_order_relaxed)) return;
    const TargetDesc& d = g_targets[rec->target];
    const void* prevMethod = tls_curMethod;
    bool prevValid = tls_retValid;
    int64_t prevValue = tls_retValue;
    tls_curMethod = rec->method;
    d.body(const_cast<void*>(rec->method), slots, rec->off, ret);
    tls_curMethod = prevMethod;
    tls_retValid = prevValid;
    tls_retValue = prevValue;
}

// Run one queued After body.  The entry is copied out first: the body may call
// back into the interpreter, which queues new entries into the slot this one
// occupied.
static void RunPending(const Pending& p) {
    const CacheRec* rec = p.rec;
    StackObject slots[kMaxSlots];
    std::memcpy(slots, p.slots, sizeof(StackObject) * p.slotCount);
    bool prevValid = tls_retValid;
    int64_t prevValue = tls_retValue;
    tls_retValid = false;      // fallback flush: no frame to read the result from
    tls_retValue = 0;          // -> the body's original-call adapter re-asks
    RunBody(rec, slots, nullptr);
    tls_retValid = prevValid;
    tls_retValue = prevValue;
}

static void FlushPending(int32_t depth) {
    // Pop first, run after: a body can call back into the interpreter and queue
    // new entries, which must not disturb this loop.
    while (tls_pendN > 0) {
        Pending& p = tls_pend[tls_pendN - 1];
        if (depth >= 0 && depth > p.depth) break;      // callee still on the stack
        if (depth >= 0 && depth < p.depth) {
            // The caller frame is gone as well, so its locals — the body's
            // `out`/`ref` targets — have been released and may already belong to
            // a newer frame.  LeaveFrame normally flushes these in time; drop
            // instead of replaying against stale pointers.
            if (g_droppedBodies.fetch_add(1) == 0) {
                log("[hybrid] dropped a deferred body whose caller frame had already returned (%s)",
                    p.rec && PlausibleName(MethodName(p.rec->method)) ? MethodName(p.rec->method) : "?");
            }
            tls_pendN--;
            continue;
        }
        tls_pendN--;
        RunPending(p);
    }
}

static void QueueAfter(const CacheRec* rec, const StackObject* slots, int32_t depth) {
    if (tls_pendN >= kMaxPending) {                    // try to drain finished ones
        FlushPending(depth);
        if (tls_pendN >= kMaxPending) return;          // 8 nested After-targets: drop
    }
    Pending& p = tls_pend[tls_pendN++];
    p.rec = rec;
    p.slotCount = rec->slotCount;
    p.depth = depth;
    std::memcpy(p.slots, slots, sizeof(StackObject) * rec->slotCount);
}

// Read a one-slot return value out of the still-pushed callee frame.  Every
// `ret` handler in Execute does `void* _curRet = frame->ret;` then
// `frame = LeaveFrame();` and only then `Copy8(_curRet, localVarBase + __ret)`
// (HybridCLR Interpreter_Execute.cpp, SET_RET_AND_LEAVE_FRAME), with
// `localVarBase == frame->stackBasePtr` of the callee.  For a non-void method the
// transpiler asserts `evalStackTop == 1` at RET and emits `__ret =
// evalStackBaseOffset`, so the value sits in that slot while the frame is pushed.
// Reading it here gives the exact engine result with one execution; only when
// this fails (no frame / unreadable slot / multi-slot return) does the body fall
// back to DupCall.
static bool ReadReturnValue(const CacheRec* rec, const uint8_t* frame, int64_t* out) {
    if (!rec || !rec->captureReturn || !frame) return false;
    void* stackBase = *reinterpret_cast<void* const*>(frame + kOffFrameStackBase);
    if (!PlausiblePtr(stackBase)) return false;
    // No ReadableRange() here: the frame is the interpreter's own live frame
    // (committed stack) and retOffset was bounds-checked against maxStackSize at
    // resolve time.  A VirtualQuery per hit only re-proved what the frame
    // already guarantees.
    auto* src = reinterpret_cast<const uint8_t*>(stackBase) +
                (size_t)rec->retOffset * sizeof(StackObject);
    std::memcpy(out, src, sizeof(int64_t));
    return true;
}

// One-time per target, on the first hit whose value came from the frame slot:
// repeat the call through the interpreter and compare.  Both run at the same
// point (callee frame still pushed, caller frame alive), so an idempotent method
// must produce the same value; a mismatch marks the target so every later hit
// uses DupCall.  This turns a wrong slot assumption into one warning line plus
// the pre-slot behaviour instead of silently wrong numbers for the whole session.
// The comparison is done before the body runs, so the body still logs the frame
// value on this hit (the duplicate's own out-parameter writes are identical).
static int64_t VerifyReturnSlot(const CacheRec* rec, const StackObject* slots, int64_t captured) {
    if (rec->target < 0 || rec->target >= kMaxTargets) return captured;
    if (g_retSlotChecked[rec->target].load(std::memory_order_relaxed)) return captured;

    uint64_t a[kMaxArgs];
    for (int i = 0; i < rec->argCount; i++) a[i] = slots[rec->off[i]].v;

    const void* prevMethod = tls_curMethod;
    bool     prevValid = tls_retValid;
    int64_t  prevValue = tls_retValue;
    tls_curMethod = rec->method;
    tls_retValid = false;
    tls_retValue = 0;
    int64_t dup = DupCall(a, rec->argCount);
    tls_curMethod = prevMethod;
    tls_retValid = prevValid;
    tls_retValue = prevValue;

    // Set last: a thread that races this one repeats the check (harmless) rather
    // than using an unverified slot while another thread is still comparing.
    g_retSlotChecked[rec->target].store(true, std::memory_order_relaxed);

    const char* name = PlausibleName(MethodName(rec->method)) ? MethodName(rec->method) : "?";
    if (dup != captured) {
        g_retSlotBad[rec->target].store(true, std::memory_order_relaxed);
        log("[hybrid] return-slot check: %s read 0x%llX from the frame but the "
            "duplicate call returned 0x%llX — target falls back to the duplicate call",
            name, (unsigned long long)captured, (unsigned long long)dup);
        return dup;      // this hit stays consistent with the duplicate's out params
    }
    log("[hybrid] return-slot check: %s OK (0x%llX)",
        name, (unsigned long long)captured);
    return captured;
}

// `LeaveFrame` is the interpreter's only return event (called from every
// `ret`/unwind handler right before the callee frame is popped).  Flushing a
// queued After body here, instead of from the next interpreter event, keeps the
// caller frame — and therefore the caller's `out`/`ref` slots — alive while the
// body runs.
//
// The body runs *before* the original LeaveFrame, i.e. with the callee frame
// still pushed: the machine stack top then already sits above that frame, so
// anything the body invokes can only allocate above it.  After the pop it could
// cover the callee's eval stack, including the return slot at
// `stackBasePtr + evalStackBaseOffset`.
//
// That still-pushed frame is also what makes the return value observable:
// `needsRealOrig` bodies get it from ReadReturnValue instead of re-running the
// method.  DupCall remains only for the fallback flush in FlushPending (when
// LeaveFrame was not hooked) and for multi-slot returns.
static void* __fastcall Hook_LeaveFrame(void* frameGroup) {
    void* ms = frameGroup ? *reinterpret_cast<void**>(frameGroup) : nullptr;
    if (ms) tls_machineState = ms;

    int32_t leaving = -1;
    if (ms) {
        const int32_t top = *reinterpret_cast<int32_t*>(
            reinterpret_cast<uintptr_t>(ms) + kOffMsFrameTopIdx);
        leaving = top - 1;
    }

    const CacheRec* rec = nullptr;
    StackObject slots[kMaxSlots];
    const uint8_t* leavingFrame = nullptr;
    if (leaving >= 0) {
        // The frame being popped is still at _frameBase[_frameTopIdx - 1].
        if (auto* base = *reinterpret_cast<void**>(
                reinterpret_cast<uintptr_t>(ms) + kOffMsFrameBase)) {
            leavingFrame = reinterpret_cast<const uint8_t*>(base) +
                           (size_t)leaving * kFrameStride;
        }
        // Any queued frame above the one being popped is already gone; drop it.
        while (tls_pendN > 0 && tls_pend[tls_pendN - 1].depth > leaving) {
            tls_pendN--;
        }
        if (tls_pendN > 0) {
            Pending& p = tls_pend[tls_pendN - 1];
            // Match both the frame index and the frame's method: the index alone
            // would also match a frame that reused the slot in a later call
            // chain, whose caller memory is unrelated to the snapshotted slots.
            const void* frameMethod = leavingFrame
                ? *reinterpret_cast<const void* const*>(leavingFrame) : nullptr;
            if (p.depth == leaving && p.rec && frameMethod == p.rec->method) {
                rec = p.rec;
                std::memcpy(slots, p.slots, sizeof(StackObject) * p.slotCount);
                tls_pendN--;
            } else if (p.depth == leaving) {
                // Same slot, different method: the queued callee was already
                // popped without us seeing it.  Run nothing.
                if (g_droppedBodies.fetch_add(1) == 0) {
                    log("[hybrid] dropped a deferred body whose callee frame was not the one leaving (%s)",
                        p.rec && PlausibleName(MethodName(p.rec->method)) ? MethodName(p.rec->method) : "?");
                }
                tls_pendN--;
            }
        }
    }

    if (rec) {
        bool prevValid = tls_retValid;
        int64_t prevValue = tls_retValue;
        tls_retValid = false;
        tls_retValue = 0;
        int64_t captured = 0;
        if (rec->target >= 0 && rec->target < kMaxTargets &&
            g_targets[rec->target].needsRealOrig &&
            !g_retSlotBad[rec->target].load(std::memory_order_relaxed) &&
            ReadReturnValue(rec, leavingFrame, &captured)) {
            captured = VerifyReturnSlot(rec, slots, captured);
            tls_retValid = true;
            tls_retValue = captured;
        }
        RunBody(rec, slots, nullptr);
        tls_retValid = prevValid;
        tls_retValue = prevValue;
    }

    return g_origLeaveFrame(frameGroup);
}

static void* __fastcall Hook_EnterFrame(void* frameGroup, const void* method,
                                        StackObject* argBase) {
    if (frameGroup) {
        void* ms = *reinterpret_cast<void**>(frameGroup);
        if (ms) tls_machineState = ms;                 // InterpFrameGroup::_machineState
    }
    // Index the callee frame will occupy (i.e. before the push).  Needed for the
    // pending-flush condition and for queueing After bodies.
    const int32_t depthBefore = FrameDepth();

    CacheRec* rec = Lookup(method);

    // Push the frame FIRST, then run/queue the body.  `argBase` is a raw pointer
    // into the caller's eval stack and only becomes stable once the callee frame
    // holds it (the machine state relocates `stackBasePtr` on stack growth); a
    // body that calls back into the interpreter (ResolveHitSource, the
    // CalculateNormalDamage helpers, …) before the push could grow/relocate the
    // stack and leave EnterFrameFromInterpreter writing a stale stackBasePtr.
    void* frame = g_origEnterFrame(frameGroup, method, argBase);

    FlushPending(depthBefore);
    if (rec && rec->target >= 0) {
        const TargetDesc& d = g_targets[rec->target];
        if (d.mode == Mode::Entry) RunBody(rec, argBase, nullptr);
        else                       QueueAfter(rec, argBase, depthBefore);
    }
    return frame;
}

static void __fastcall Hook_Execute(const void* method, StackObject* args, void* ret) {
    // Safe position: nothing on the interpreter stack refers to this call yet.
    FlushPending(FrameDepth());

    CacheRec* rec = Lookup(method);
    if (!rec || rec->target < 0) {
        g_origExecute(method, args, ret);
        return;
    }
    const TargetDesc& d = g_targets[rec->target];

    if (d.needsRealOrig) {
        // Run the real call first so the body can pick the result up through its
        // original-call adapter (which reuses the captured return value).
        g_origExecute(method, args, ret);
        bool prevValid = tls_retValid;
        int64_t prevValue = tls_retValue;
        tls_retValid = (ret != nullptr);
        tls_retValue = (ret != nullptr) ? *reinterpret_cast<int64_t*>(ret) : 0;
        RunBody(rec, args, ret);
        tls_retValid = prevValid;
        tls_retValue = prevValue;
        return;
    }

    if (d.mode == Mode::Entry) {
        RunBody(rec, args, nullptr);
        g_origExecute(method, args, ret);
    } else {
        g_origExecute(method, args, ret);
        bool prevValid = tls_retValid;
        int64_t prevValue = tls_retValue;
        tls_retValid = (ret != nullptr);
        tls_retValue = (ret != nullptr) ? *reinterpret_cast<int64_t*>(ret) : 0;
        RunBody(rec, args, ret);
        tls_retValid = prevValid;
        tls_retValue = prevValue;
    }
}

// ---------------------------------------------------------------------------
//  Outgoing calls
// ---------------------------------------------------------------------------
// Compare a MethodInfo's name without requiring the whole 200-byte window
// PlausibleName() insists on: the metadata blob is byte-packed, so a name can
// end near the end of a committed region and still be perfectly valid.  Only
// the bytes we actually compare have to be readable.
static bool MethodNameIs(const void* method, const char* want) {
    const char* mn = MethodName(method);
    auto v = reinterpret_cast<uintptr_t>(mn);
    if (v < 0x10000 || v >= 0x00007FFFFFFFFFFF) return false;
    if (!ReadableRange(mn, 64)) return false;
    return std::strcmp(mn, want) == 0;   // reads at most strlen(want)+1 bytes
}

static void* FindMethodInClass(void* klassPtr, const char* methodName) {
    if (!PlausiblePtr(klassPtr)) return nullptr;
    auto* klass = reinterpret_cast<Il2CppClass*>(klassPtr);
    for (int depth = 0; depth < 32 && klass; depth++) {
        auto* methods = reinterpret_cast<void**>(klass->_1.methods);
        uint32_t count = klass->_2.method_count;
        // Scan the whole array: `method_count` is not a reliable length.  For
        // hotfix classes it can over-report (trailing nulls) and it can also
        // under-report — HotfixDataController exposes 935 of its ~3.5k methods.
        // Methods outside the array are covered by the learned-name fallback
        // (LookupLearnedMethod).
        for (uint32_t i = 0; methods && i < count; i++) {
            // Guard against an over-reported count whose backing block ends
            // early — a read past the region would fault.
            if (!ReadableRange(methods + i, sizeof(void*))) break;
            void* m = methods[i];
            if (!m || (reinterpret_cast<uintptr_t>(m) & 7)) continue;
            if (!ReadableRange(m, 0x60)) continue;
            if (MethodNameIs(m, methodName)) return m;
        }
        klass = klass->_1.parent;
    }
    return nullptr;
}

// One-shot explanation of a failed lookup, so a name mismatch or an incomplete
// class method array is visible instead of the feature silently going quiet.
static void LogMethodMiss(void* klassPtr, const char* methodName) {
    if (!PlausiblePtr(klassPtr)) {
        log("[hybrid] method lookup: %s — class pointer unusable", methodName);
        return;
    }
    auto* klass = reinterpret_cast<Il2CppClass*>(klassPtr);
    const char* kn = PlausibleName(klass->_1.name) ? klass->_1.name : "?";
    log("[hybrid] method lookup: %s.%s not found (class reports %u methods)",
        kn, methodName, (unsigned)klass->_2.method_count);
}

// Record name→MethodInfo for every interpreted method the hooks see.  Not all
// hotfix classes expose their full metadata method list through
// `klass->_1.methods` (2.0.0's HotfixDataController registers 935 entries while
// the class declares ~3.5k), so a class-array scan alone can miss real methods.
// The interpreter hands us the MethodInfo of everything that actually runs —
// which is exactly the set we call back into (GetOnceAdditionalAttribute &
// co. run from the game's own AddAttr).
static void LearnMethodName(void* klass, const char* methodName, void* method) {
    if (!klass || !method || !methodName) return;
    const char* kn = reinterpret_cast<Il2CppClass*>(klass)->_1.name;
    if (!PlausibleName(kn)) return;
    std::lock_guard<std::mutex> lk(g_klassMutex);
    std::string key(kn);
    key += '.';
    key += methodName;
    g_methodByName.emplace(std::move(key), method);
    std::string bare("#");
    bare += methodName;
    g_methodByName.emplace(std::move(bare), method);
}

// Fallback lookup in the executed-method table.  Verifies the declaring class
// name so a same-named method on another class can never be picked.
static void* LookupLearnedMethod(const char* klassName, const char* methodName) {
    std::string bare("#");
    bare += methodName;
    void* m = nullptr;
    {
        std::lock_guard<std::mutex> lk(g_klassMutex);
        auto it = g_methodByName.find(bare);
        if (it == g_methodByName.end()) return nullptr;
        m = it->second;
    }
    void* mk = MethodKlass(m);
    if (!PlausiblePtr(mk)) return nullptr;
    const char* kn = reinterpret_cast<Il2CppClass*>(mk)->_1.name;
    if (!kn || std::strcmp(kn, klassName) != 0) return nullptr;
    return m;
}

static std::string MethodKey(const char* klassName, const char* methodName) {
    std::string key;
    key.reserve(64);
    key += klassName;
    key += '.';
    key += methodName;
    return key;
}

static void* LookupMethodCache(const std::string& key) {
    std::lock_guard<std::mutex> lk(g_klassMutex);
    auto it = g_methodByName.find(key);
    return it == g_methodByName.end() ? nullptr : it->second;
}

static bool FirstSighting(std::unordered_set<std::string>& seen, const std::string& key) {
    static std::mutex mtx;
    std::lock_guard<std::mutex> lk(mtx);
    return seen.insert(key).second;
}

// Per-call-site resolved-method cache.  The GDC adapters call the same handful
// of methods by literal name for every attribute row; without this, every call
// built a "Class.Method" std::string, took g_klassMutex and hashed it.  Keyed by
// (runtime class | class-name pointer, method-name pointer) — callers pass
// string literals, so the identity is stable for the process lifetime.  Only
// successful lookups are cached (a class may not be learned yet).
struct ResolvedMethodEntry {
    const void* klass;
    const char* klassName;
    const char* methodName;
    void*       method;
};
static constexpr int kResolvedMethodCache = 16;
static ResolvedMethodEntry g_resolvedMethodCache[kResolvedMethodCache];
static std::atomic<int>    g_resolvedMethodCacheN{0};

static void* ResolveMethodCached(const void* klass, const char* klassName,
                                 const char* methodName) {
    const int n = g_resolvedMethodCacheN.load(std::memory_order_acquire);
    for (int i = 0; i < n; i++) {
        const ResolvedMethodEntry& e = g_resolvedMethodCache[i];
        if (e.methodName == methodName && e.klass == klass && e.klassName == klassName)
            return e.method;
    }
    return nullptr;
}

static void CacheResolvedMethod(const void* klass, const char* klassName,
                                const char* methodName, void* method) {
    const int i = g_resolvedMethodCacheN.load(std::memory_order_relaxed);
    if (i >= kResolvedMethodCache) return;
    g_resolvedMethodCache[i] = {klass, klassName, methodName, method};
    g_resolvedMethodCacheN.store(i + 1, std::memory_order_release);
}

// Shared tail of both resolvers: class-chain scan, learned-name fallback,
// one-shot miss log, cache the result.
static void* ResolveMethodInClass(void* klass, const char* klassName,
                                  const char* methodName, const std::string& key) {
    void* m = FindMethodInClass(klass, methodName);
    if (!m) m = LookupLearnedMethod(klassName, methodName);
    if (!m) {
        static std::unordered_set<std::string> seen;
        if (FirstSighting(seen, key)) LogMethodMiss(klass, methodName);
        return nullptr;
    }
    std::lock_guard<std::mutex> lk(g_klassMutex);
    g_methodByName.emplace(key, m);
    return m;
}

static void* ResolveGameMethod(const char* klassName, const char* methodName) {
    if (void* m = ResolveMethodCached(nullptr, klassName, methodName)) return m;

    const std::string key = MethodKey(klassName, methodName);
    if (void* m = LookupMethodCache(key)) {
        CacheResolvedMethod(nullptr, klassName, methodName, m);
        return m;
    }

    void* klass = nullptr;
    {
        std::lock_guard<std::mutex> lk(g_klassMutex);
        auto it = g_klassByName.find(klassName);
        if (it != g_klassByName.end()) klass = it->second;
    }
    if (!klass) {
        static std::unordered_set<std::string> seen;
        if (FirstSighting(seen, key))
            log("[hybrid] method lookup: class '%s' not learned yet (%s)", klassName, methodName);
        return nullptr;
    }
    void* m = ResolveMethodInClass(klass, klassName, methodName, key);
    if (m) CacheResolvedMethod(nullptr, klassName, methodName, m);
    return m;
}

// Same lookup, but the class comes straight from the live object, so no class
// table / name spelling is involved.  Cached under the class's own runtime name.
static void* ResolveMethodOnObject(void* obj, const char* methodName) {
    if (!PlausiblePtr(obj)) return nullptr;
    void* klass = *reinterpret_cast<void**>(obj);          // Il2CppObject::klass
    if (!PlausiblePtr(klass)) return nullptr;
    if (void* m = ResolveMethodCached(klass, nullptr, methodName)) return m;
    const char* kn = reinterpret_cast<Il2CppClass*>(klass)->_1.name;
    if (!PlausibleName(kn)) return nullptr;

    const std::string key = MethodKey(kn, methodName);
    if (void* m = LookupMethodCache(key)) {
        CacheResolvedMethod(klass, nullptr, methodName, m);
        return m;
    }
    void* m = ResolveMethodInClass(klass, kn, methodName, key);
    if (m) CacheResolvedMethod(klass, nullptr, methodName, m);
    return m;
}

int64_t DupCall(const uint64_t* argValues, int argCount) {
    const void* method = tls_curMethod;
    if (!method || !g_origExecute || argCount <= 0 || argCount > kMaxArgs) return 0;
    CacheRec* rec = Lookup(method);
    if (!rec || rec->target < 0 || rec->argCount != argCount) return 0;
    StackObject slots[kMaxSlots];
    std::memset(slots, 0, sizeof(slots));
    for (int i = 0; i < argCount; i++)
        slots[rec->off[i]].v = argValues[i];
    uint64_t ret = 0;
    g_origExecute(method, slots, &ret);
    return (int64_t)ret;
}

// Shared tail: build the argument slots from the metadata layout and invoke.
// `retStackObjectSize` is in StackObject units (HybridCLR's GetTypeArgDesc:
// reference returns are 1), so the 4-slot cap only rejects oversized value-type
// returns; a refusal is logged.
// Same, but memoize the metadata argument layout per method: the layout is
// immutable once interpData exists, and InvokeOnMethod is called once per
// attribute row.
struct ArgLayoutEntry {
    const void* method;
    int count;
    int slots;
    int off[kMaxArgs];
};
static constexpr int kArgLayoutCache = 16;
static ArgLayoutEntry g_argLayoutCache[kArgLayoutCache];
static std::atomic<int> g_argLayoutCacheN{0};

static bool ArgOffsetsFor(const void* method, int* off, int* count, int* slots) {
    const int n = g_argLayoutCacheN.load(std::memory_order_acquire);
    for (int i = 0; i < n; i++) {
        const ArgLayoutEntry& e = g_argLayoutCache[i];
        if (e.method != method) continue;
        *count = e.count;
        *slots = e.slots;
        std::memcpy(off, e.off, sizeof(int) * e.count);
        return true;
    }
    if (!ComputeArgOffsets(method, off, count, slots)) return false;
    const int i = g_argLayoutCacheN.load(std::memory_order_relaxed);
    if (i < kArgLayoutCache) {
        g_argLayoutCache[i].method = method;
        g_argLayoutCache[i].count  = *count;
        g_argLayoutCache[i].slots  = *slots;
        std::memcpy(g_argLayoutCache[i].off, off, sizeof(int) * *count);
        g_argLayoutCacheN.store(i + 1, std::memory_order_release);
    }
    return true;
}

static uint64_t InvokeOnMethod(void* method, const char* klassName, const char* methodName,
                               const uint64_t* args, int argCount, const char* dbgName) {
    int off[kMaxArgs];
    int count = 0, slots = 0;
    if (!ArgOffsetsFor(method, off, &count, &slots) || count != argCount) {
        static std::atomic<int> warn{0};
        if (warn.fetch_add(1) < 8)
            log("[hybrid] %s: cannot build arguments for %s.%s (metadata %d, call %d)",
                dbgName, klassName, methodName, count, argCount);
        return 0;
    }
    ImiInfo imi{};
    if (!ReadImi(method, &imi) || imi.retStackObjectSize > 4) {
        static std::atomic<int> warn{0};
        if (warn.fetch_add(1) < 8)
            log("[hybrid] %s: unusable return layout for %s.%s (%u slots)",
                dbgName, klassName, methodName, (unsigned)imi.retStackObjectSize);
        return 0;
    }

    StackObject buf[kMaxSlots];
    std::memset(buf, 0, sizeof(buf));
    for (int i = 0; i < argCount; i++)
        buf[off[i]].v = args[i];

    uint64_t ret = 0;
    g_origExecute(method, buf, &ret);
    return ret;
}

uint64_t CallGameMethod(const char* klassName, const char* methodName,
                        const uint64_t* args, int argCount, const char* dbgName) {
    if (!g_origExecute || !klassName) return 0;
    void* method = ResolveGameMethod(klassName, methodName);
    if (!method) return 0;                       // logged once by the resolver
    return InvokeOnMethod(method, klassName, methodName, args, argCount, dbgName);
}

uint64_t CallGameMethodOnObject(void* obj, const char* methodName,
                                const uint64_t* args, int argCount, const char* dbgName) {
    if (!g_origExecute || !obj || !methodName) return 0;
    void* method = ResolveMethodOnObject(obj, methodName);
    if (!method) return 0;                       // logged once by the resolver
    const char* kn = reinterpret_cast<Il2CppClass*>(*reinterpret_cast<void**>(obj))->_1.name;
    return InvokeOnMethod(method, kn, methodName, args, argCount, dbgName);
}

// ---------------------------------------------------------------------------
//  Install
// ---------------------------------------------------------------------------
bool InstallAll(const TargetDesc* targets, int count) {
    if (g_installed) return true;
    if (!g_detected) return false;

    g_targets = targets;
    g_targetCount = count;

    MH_STATUS s = MH_CreateHook(reinterpret_cast<void*>(g_execAddr),
                                reinterpret_cast<void*>(&Hook_Execute),
                                reinterpret_cast<void**>(&g_origExecute));
    if (s != MH_OK) {
        log("[hybrid] MH_CreateHook(Interpreter::Execute) failed: %d", (int)s);
        return false;
    }
    s = MH_EnableHook(reinterpret_cast<void*>(g_execAddr));
    if (s != MH_OK) {
        log("[hybrid] MH_EnableHook(Interpreter::Execute) failed: %d", (int)s);
        return false;
    }
    log("[hybrid] hooked Interpreter::Execute @ 0x%llX", (unsigned long long)g_execAddr);

    if (g_enterAddr) {
        s = MH_CreateHook(reinterpret_cast<void*>(g_enterAddr),
                          reinterpret_cast<void*>(&Hook_EnterFrame),
                          reinterpret_cast<void**>(&g_origEnterFrame));
        if (s == MH_OK) s = MH_EnableHook(reinterpret_cast<void*>(g_enterAddr));
        if (s != MH_OK) {
            log("[hybrid] MH_CreateHook(EnterFrameFromInterpreter) failed: %d — "
                "interpreted->interpreted hooks disabled", (int)s);
            g_enterAddr = 0;
        } else {
            log("[hybrid] hooked EnterFrameFromInterpreter @ 0x%llX", (unsigned long long)g_enterAddr);
        }
    }

    if (g_leaveAddr) {
        s = MH_CreateHook(reinterpret_cast<void*>(g_leaveAddr),
                          reinterpret_cast<void*>(&Hook_LeaveFrame),
                          reinterpret_cast<void**>(&g_origLeaveFrame));
        if (s == MH_OK) s = MH_EnableHook(reinterpret_cast<void*>(g_leaveAddr));
        if (s != MH_OK) {
            log("[hybrid] MH_CreateHook(LeaveFrame) failed: %d — deferred bodies fall "
                "back to the next interpreter event", (int)s);
            g_leaveAddr = 0;
            g_origLeaveFrame = nullptr;
        } else {
            log("[hybrid] hooked LeaveFrame @ 0x%llX", (unsigned long long)g_leaveAddr);
        }
    }

    g_installed = true;
    log("[hybrid] attach layer active (%d targets registered)", g_targetCount);
    return true;
}

bool Active() { return g_installed && g_Cfg.hotfix_hooks; }

} // namespace hybrid
