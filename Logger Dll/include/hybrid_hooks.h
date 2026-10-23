#pragma once

// =============================================================================
//  HybridCLR hotfix attach layer
// =============================================================================
//  Since game 2.0.0 the whole combat/AI implementation lives in the HybridCLR
//  interpreted assembly `Hotfix.dll`, not in the AOT image (`GameAssembly.dll`):
//  there are no `Nova.Client` combat classes in the AOT dump any more, so the
//  old `g_base + RVA_xxx` hooks and outgoing calls have nothing to attach to
//  (they were removed in favour of this layer).
//
//  Interpreted methods have no stable native address per method.  All native to
//  interpreted entries (AOT -> hotfix bridges, delegates, reflection) funnel
//  through the single interpreter entry point
//      void Interpreter::Execute(const MethodInfo* method, StackObject* args, void* ret)
//  and interpreted -> interpreted calls are inlined in Execute's loop, each of
//  them pushing a frame through
//      InterpFrame* InterpFrameGroup::EnterFrameFromInterpreter(
//                        InterpFrameGroup* this, const MethodInfo* method,
//                        StackObject* argBase)
//  and each of them retiring through the interpreter's only return event
//      InterpFrame* InterpFrameGroup::LeaveFrame(InterpFrameGroup* this)
//  (called from every `ret` / unwind handler in Execute right before the callee
//  frame is popped).  "After the call" bodies are flushed from LeaveFrame, while
//  the caller frame — and therefore the caller's `out`/`ref` slots — is still
//  alive; see `hybrid::Mode::After` below.
//
//  This layer locates those three functions at load time, installs MinHook
//  detours on them, resolves the hooked methods by metadata name and hands the
//  raw argument slots to proxy.cpp's existing hook bodies.  It also provides the
//  outgoing calls the backend still needs (`GameDataController`,
//  `CommonHelper`, `ActorHelper` helpers) by resolving the method by name and
//  invoking it through the saved `Interpreter::Execute`.
// =============================================================================

#include <cstdint>

namespace hybrid {

// Raw interpreter stack slot (HybridCLR `union StackObject`).
struct StackObject { uint64_t v; };

// Small readers for the slot payloads.  The interpreter stores the argument
// payload inline in the slot; narrow types (bool / byte enums) live in the low
// byte only, so they are masked (the upper bytes are not guaranteed to be
// meaningful).
inline int32_t I32 (const StackObject* s, int off) { return (int32_t)(uint32_t)s[off].v; }
inline int64_t I64 (const StackObject* s, int off) { return (int64_t)s[off].v; }
inline uint8_t U8  (const StackObject* s, int off) { return (uint8_t)s[off].v; }
inline int8_t  I8  (const StackObject* s, int off) { return (int8_t)s[off].v; }
inline int16_t I16 (const StackObject* s, int off) { return (int16_t)s[off].v; }
inline bool    Bool(const StackObject* s, int off) { return (uint8_t)s[off].v != 0; }
inline void*   Ptr (const StackObject* s, int off) { return (void*)s[off].v; }
inline float   F32 (const StackObject* s, int off) { float f; uint32_t u = (uint32_t)s[off].v; __builtin_memcpy(&f, &u, 4); return f; }
inline double  F64 (const StackObject* s, int off) { double d; __builtin_memcpy(&d, &s[off].v, 8); return d; }

// When the body of a hooked method runs.
enum class Mode {
    // At call entry, with the arguments as passed.  The engine call itself is
    // forwarded after the body ran (so the AOT behaviour of "hook runs first,
    // then the original" is preserved).
    Entry,
    // After the call returned.  Interpreted -> interpreted calls are retired
    // through `InterpFrameGroup::LeaveFrame`, which the layer hooks: the body is
    // queued with a snapshot of the argument slots and flushed when that frame
    // is popped, i.e. while the caller frame (which owns the `out`/`ref`
    // targets) is still alive.  On the native entry path the body simply runs
    // after forward(…) returned.  The original-call adapters are no-ops except
    // for `needsRealOrig` targets, which re-ask the engine call.
    After,
};

struct TargetDesc {
    const char* klass;        // metadata class name (simple name, no namespace)
    const char* method;       // metadata method name
    int         argCount;     // expected imi->argCount, `this` included when instance
    bool        isStatic;     // false => argOffsets[0] is `this`
    Mode        mode;
    // The hook body needs the engine call's result or post state through its
    // `g_OrigX` slot.  In the interpreted->interpreted path that is answered by
    // a second (duplicate) call through the interpreter, so this must only be
    // set for verified-idempotent getters/calculators.  The duplicate call is
    // made from the callee's LeaveFrame, i.e. with the caller still on the
    // stack, so the caller's `out`/`ref` slots are valid (a later duplicate can
    // land on top of them and overwrite the call's own arguments).
    bool        needsRealOrig;
    // Receives the arguments.  `argOffsets[k]` is the slot index of metadata
    // argument k (0 = `this` for instance methods); `ret` points at the return
    // value for native entries, otherwise nullptr.
    void      (*body)(void* methodInfo, const StackObject* slots, const int* argOffsets, void* ret);
};

// Locate Interpreter::Execute / EnterFrameFromInterpreter inside GameAssembly.
// Safe to call before MH_Initialize(); does not install anything.
bool Detect(uintptr_t gameBase);

// Install the interpreter detours and register `targets`.
// Must be called after MH_Initialize().  Returns true when at least the native
// entry hook is live.
bool InstallAll(const TargetDesc* targets, int count);

// ---------------------------------------------------------------------------
//  Outgoing calls (the only way into hotfix code now)
// ---------------------------------------------------------------------------
// `args` holds one uint64 per parameter slot, in metadata order (`this` first
// for instance methods).  Returns the raw return value (0 when the method could
// not be resolved / invoked, after logging the reason once).
uint64_t CallGameMethod(const char* klassName, const char* methodName,
                        const uint64_t* args, int argCount, const char* dbgName);

// Same, but the declaring class is taken from the object itself instead of the
// learned class table (`*(void**)obj` is Il2CppObject::klass).  Preferred for
// instance methods on huge classes: HotfixDataController declares thousands of
// methods, and its interpreted image is not guaranteed to be in the learned
// table under the same name the caller uses.
uint64_t CallGameMethodOnObject(void* obj, const char* methodName,
                                const uint64_t* args, int argCount, const char* dbgName);

// ---------------------------------------------------------------------------
//  Field offset lookup (for objects whose class layout changed between versions,
//  e.g. the captured GameDataController object is a HotfixDataController in
//  2.0.0).  Returns the offset inside the object, -1 when `obj` is unusable and
//  -2 when the class is fine but has no such field (treat as absent).
// ---------------------------------------------------------------------------
int32_t FieldOffsetInObject(const void* obj, const char* fieldName);

// ---------------------------------------------------------------------------
//  Class / static field lookup (debug-gizmo singleton)
// ---------------------------------------------------------------------------
// Il2CppClass* of a hotfix class the attach layer has already seen as the
// declaring class of an interpreted method (nullptr before that).  Used for
// `AdventureModuleDebugHelper`, whose messages (Update/Awake) start running
// with the level scene, so the class is learned shortly after load.
void* ClassByName(const char* klassName);

// Read a static reference field by name, walking the class's base chain; the
// value comes out of the declaring class's `static_fields` block.  This is how
// `SceneSingleton<AdventureModuleDebugHelper>.g_instance` is read: the singleton
// is a runtime-inflated generic over a hotfix type, so it has no AOT get_Instance
// address and its MethodInfo is not interpreted — a static-field read is the
// only stable route.  Returns nullptr when the class is unknown, the field does
// not exist, or the class has not been initialized yet; `declaringName` (when
// given) receives the runtime name of the class that declares the field, which
// shows whether the inflated generic base was found.
void* ReadStaticFieldPtr(void* klassPtr, const char* fieldName,
                         const char** declaringName = nullptr);

// ---------------------------------------------------------------------------
//  Called from the hook bodies (proxy.cpp)
// ---------------------------------------------------------------------------
// The MethodInfo of the call whose body is running on this thread (nullptr
// outside a body).
void*    CurrentMethod();
// Native-entry duplicate-call support: when the hooked call arrived through
// Interpreter::Execute the engine call already produced its result and the
// body's original-call adapter returns it instead of re-running the method.
bool     CurrentRetValid();
int64_t  CurrentRetValue();
// Re-run the currently-running method through the interpreter with freshly
// built argument values (`args[k]` = metadata argument k, one uint64 per slot).
// Used by bodies whose original-call result is required but which were entered
// through the interpreted->interpreted path.  Only for idempotent methods.  Call
// sites must hold the caller frame alive: the arguments include the caller's
// `out`/`ref` pointers, and a duplicate call made after the caller returned can
// allocate its own frame on top of them and overwrite its own arguments.
int64_t  DupCall(const uint64_t* args, int argCount);

// True when the hotfix attach layer is active (detected and enabled by config).
bool Active();

} // namespace hybrid
