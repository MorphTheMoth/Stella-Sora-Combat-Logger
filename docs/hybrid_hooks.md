# Hotfix (HybridCLR) attach layer

`Logger Dll/hybrid_hooks.cpp` + `Logger Dll/include/hybrid_hooks.h`, wired into `Logger Dll/proxy.cpp` by `InstallHybridLayer()` / `InstallHybridOrigStubs()` / the `Hy*` adapters.

## Why this exists

Up to 1.16.1 the combat implementation was AOT-compiled into `GameAssembly.dll`, so every logger hook was a per-method RVA hook (`InstallHook(g_base + RVA_xxx, ...)`) and every call *into* the game was a direct call to `g_base + RVA_xxx`.

In 2.0.0 the combat/AI implementation moved into the HybridCLR-interpreted assembly `Hotfix.dll`: the 2.0.0 AOT dump has no `Nova.Client` combat classes at all, and the old RVAs point at unrelated code. Interpreted methods have no stable native address per method, so both halves of the old design (hooks and outgoing calls) needed a different attach point.

Verified statements this design rests on (2.0.0 image, base `0x180000000`; upstream sources in `/tmp/opencode/hybridclr-src/`):

- All native → interpreted entries funnel through one function, `void Interpreter::Execute(const MethodInfo* methodInfo, StackObject* args, void* ret)` (`hybridclr/interpreter/Interpreter.h:34`). It is called by the per-signature managed2native bridges, by `InterpreterInvoke` / `Managed2NativeCallByReflectionInvoke` and by `InterpreterDelegateInvoke` — and an AOT→hotfix call *is* one of those bridges, because an interpreted method's `methodPointer` is `InterpreterModule::GetMethodPointer(method)`, not an address in `Hotfix.dll`.
- Interpreted → interpreted calls never touch `methodPointer` / `invoker_method`: the interpreter's `CALL_INTERP_*` opcodes expand `PREPARE_NEW_FRAME_FROM_INTERPRETER`, which pushes the callee frame by calling `InterpFrame* InterpFrameGroup::EnterFrameFromInterpreter(InterpFrameGroup* this, const MethodInfo* method, StackObject* argBase)` and then `goto LoopStart` (`Interpreter_Execute.cpp`). So a per-method `methodPointer` swap cannot observe hotfix-internal calls; the frame push is the only shared, per-call hook point.
- `PREPARE_NEW_FRAME_FROM_INTERPRETER` (`Interpreter_Execute.cpp` ~1397) does `imi = newMethodInfo->interpData ? (InterpMethodInfo*)newMethodInfo->interpData : GetInterpMethodInfo(newMethodInfo)` and sets `ip = ipBase = imi->codes` **before** returning from `EnterFrameFromInterpreter`. Call redirection or engine-call suppression through the frame hook is therefore impossible; the layer only observes and forwards.
- Call sites, for reference: `Interpreter::Execute` RVA `0x64E270` (62,428 bytes), found from the `"CallInterpDelegate"` literal at VA `0x186ABD278` (three RIP-relative xrefs inside it). `EnterFrameFromInterpreter` RVA `0x64E1C0` (172 bytes), called from `Execute`; it loads `method->interpData` (`+0x58`), `imi->maxStackSize` (`+0x2C`) and `imi->argStackObjectSize` (`+0x20`), writes `{method, argBase}` into the new frame at frame `+0x00` / `+0x08`, then calls `MachineState::AllocStackSlot` (`0x18064C350`) and `PushFrame` (`0x180662950`).

## How the two functions are located at load

`hybrid::Detect()` runs once in `InitThread`, before the hotfix assembly exists (both targets are plain native code in `GameAssembly.dll`, so that is fine):

1. Parse `.pdata` (`IMAGE_DIRECTORY_ENTRY_EXCEPTION`) into `{begin, end}` ranges. **`RUNTIME_FUNCTION` is 12 bytes** (`BeginAddress`, `EndAddress`, `UnwindInfoAddress`) — declaring an 8-byte struct makes every lookup wrong, which shows up as `CallInterpDelegate literal found (1) but no xref resolved` even though the xref exists. That exact mistake cost one game run; the struct now carries a `static_assert(sizeof(RuntimeFunc) == 12)`.
2. Find the `"CallInterpDelegate"` literal, then scan `.text` for `lea reg, [rip+disp32]` instructions (byte form `48/4C 8D <modrm with mod=00,rm=101>`) whose target equals the literal, and vote on the *.pdata* function containing each xref. Require the winner to be a function start larger than 20 KB. Fallback: the version-table RVA `0x64E270` (`.pdata` start + >20 KB), which is what a 2.0.0 run reports when the literal scan is inconclusive.
3. Within `Interpreter::Execute`'s range, collect direct `call` targets and keep functions that are `.pdata` starts of 64..512 bytes, are called at least twice, and read `method->interpData` (`48 8B <mod=01 disp8> 58`). **Two** functions match that in 2.0.0: `EnterFrameFromInterpreter` (`0x64E1C0`, 172 B, 9 calls) and `InterpreterModule::GetInterpMethodInfo` (`0x65D840`, 285 B, 14 calls, the lazy `interpData` resolver Execute calls from its prologue). They are told apart by a store test: `GetInterpMethodInfo` *writes* `method->interpData` (`48 89 <mod=01 disp8> 58`) as its cache, while the frame-enter only reads the field. Candidates are scored (interpData read +3, ≥2 calls +2, ≥5 calls +1) and sorted by score then address, so the choice is deterministic; the log line reports `score`, call count and candidate count.
4. On failure the internal hook is skipped with a log line and the native-entry hook still installs; if `Execute` itself is not found, `InstallHybridLayer()` returns false and the legacy path takes over (guarded by its own prologue check).

## Layouts used

| object | offsets |
| --- | --- |
| `MethodInfo` | `methodPointer` `0x00`, `virtualMethodPointer` `0x08`, `invoker_method` `0x10`, `name` `0x18`, `klass` `0x20`, `token` `0x48`, `flags` `0x4C`, `iflags` `0x4E`, `slot` `0x50`, `parameters_count` `0x52`, `interpData` `0x58` (vanilla il2cpp prefix preserved, HybridCLR fields appended) |
| `InterpMethodInfo` | `codes` `0x00`, `args` `0x08`, `resolveDatas` `0x10`, `exClauses` `0x18`, `argStackObjectSize` `0x20`, `retStackObjectSize` `0x24` (24 bits), `localStackSize` `0x28`, `maxStackSize` `0x2C`, `argCount` `0x30` (low 8 bits), `codeLength` `0x30` (high 24), `localVarBaseOffset` `0x34`, `evalStackBaseOffset` `0x38`, `exClauseCount` `0x3C` |
| `MethodArgDesc` | `{u8 passbyValWhenInvoke, u8 type, u16 stackObjectSize}` (4 bytes, `stackObjectSize` is in StackObject units) |
| `MachineState` | `_stackBase` `0x00`, `_stackSize` `0x08`, `_stackTopIdx` `0x0C`, `_localPoolBottomIdx` `0x10`, `_frameBase` `0x18`, `_frameTopIdx` `0x20`, `_frameCount` `0x24` |
| `InterpFrameGroup` | `_machineState` `0x00` (so `*(void**)this` is the current thread's `MachineState`) |
| `InterpFrame` | `method` `0x00`, `stackBasePtr` `0x08`, `ret` `0x18`, `ip` `0x20`, stride `0x40` |

## Argument model

Arguments are read/written as raw `StackObject` slots (`union StackObject`, 8 bytes) in metadata order, with `this` occupying slot 0 for instance methods — this matches `actualParamCount = methodInfo->parameters_count + instanceCall` and `MethodArgDesc* argDescs = imi->args + isInstanceMethod` (`InterpreterModule.cpp:423`) in HybridCLR, and it is why each target's `argCount` in `g_HybridTargets[]` is `parameters + 1` for instance methods.

Per-argument slot width comes from the descriptors: reference types and by-ref parameters occupy one slot (`passbyValWhenInvoke` true), a value type occupies `stackObjectSize` slots with its bytes stored inline (`TrueSync.FP` = 8 bytes = 1 slot, `TrueSync.TSVector2` = 16 bytes = 2 slots). `ComputeArgOffsets()` walks the descriptors and **validates `sum(slots) == imi->argStackObjectSize`**; a mismatch is logged and the target is disabled rather than misread. The expected `argCount` per target is validated the same way, so a wrong entry in the table degrades to a single log line instead of corrupting a hook body.

Narrow types live in the low byte of the slot (the upper bytes are not guaranteed), so the readers in `hybrid_hooks.h` mask: `Bool()` / `U8()` / `I8()` / `I16()` / `I32()` / `I64()` / `Ptr()` / `F32()` / `F64()`.

## Two attach paths, two modes

`InstallAll()` installs MinHook detours on `Interpreter::Execute` (native entries) and on `EnterFrameFromInterpreter` (interpreted → interpreted). Both resolve the `MethodInfo*` through a cache → `ResolveMethod()` cold path, which reads `name`/`klass`, learns the class in `g_klassByName`, and matches `g_HybridTargets[]`.

- `Mode::Entry` — the body runs at call entry with the arguments as passed; the layer then forwards the engine call (native path) or the frame push (internal path). This is the old "hook runs first, then the original" behaviour.
- `Mode::After` — the body runs after the call returned. There is no return event for interpreted → interpreted calls (`LeaveFrame` is inlined inside the interpreter loop), so those bodies are *queued* (`QueueAfter`) with a snapshot of the argument slots and the callee's frame index (`MachineState._frameTopIdx` before the push, i.e. the index the callee frame occupies), and are flushed as soon as a later interpreter event observes `_frameTopIdx <= queued index` (i.e. the callee frame is gone). On the native path an `After` body simply runs after `g_origExecute` returned, with `ret` available.

Nesting is handled LIFO, and the queue is per-thread (`__thread`), as is the pending depth, the current method, and the captured return value.

Ordering detail for the internal path: `Hook_EnterFrame` calls the real `EnterFrameFromInterpreter` **first** and only then runs the body / flushes pending entries. Before the push, `argBase` is a raw pointer into the caller's eval stack that the callee frame has not captured yet, and bodies do call back into the game (`ResolveHitSource` → `ActorHelper.IsUseHitFromSummon`, the `CalculateNormalDamage` helpers, the duplicate call). Running them in that window is unnecessary risk; after the push the frame owns `argBase` and `MachineState` keeps it valid, and the callee's bytecode still has not executed (the interpreter resumes after the hook returns), so `Mode::Entry` semantics are unchanged. The flush uses the pre-push depth so "the callee frame is gone" is still decided correctly.

### Original calls inside the bodies

The engine call itself is performed by the layer, so a body must not call it a second time: `InstallHybridOrigStubs()` points every `g_OrigX` at a matching no-op (that is why the legacy `g_OrigX` globals became adapters). Two targets are exceptions, because their bodies consume the call's result:

- `CommonHelper.CalculateNormalDamage` — the body logs the damage value and the 16 out parameters.
- `HotfixDataController.GetMonster` — the body applies the dummy-model skin to the returned table row (Blitz test-stage feature).

For those, `needsRealOrig = true` and the adapter returns the value the engine call produced: on the native path the layer captures `*(int64_t*)ret` before running the body; on the interpreted → interpreted path (no return event) it repeats the call through the saved `Interpreter::Execute` with freshly built slots (`DupCall`). Repeating is only sound for verified-idempotent methods: `CalculateNormalDamage` only writes the static from/to attribute caches (see `docs/damage_flow_analysis.md`), and `GetMonster` is a table lookup. The duplicate call also re-writes the out parameters through the caller's own pointers, which keeps the logged values mutually consistent even when a deferred body runs a little later.

## Outgoing calls into the hotfix

Nothing in the game hands the logger a `MethodInfo*` for `HotfixDataController` / `CommonHelper` / `ActorHelper`, so resolution is observation-based and lazy, with no AOT anchors:

1. `ResolveMethod()` calls `LearnClass()` for *every* interpreted method it sees, so `g_klassByName` fills up with the hotfix classes actually being executed (including `ActorHelper`, which is never a hook target).
2. `CallGameMethod(klass, method, args, argCount, dbg)` looks the class up by name, walks `klass->_1.methods[0.._2.method_count)` and up the `parent` chain comparing `MethodInfo.name`, caches the result, then builds `StackObject` slots from `args[]` (using the same descriptor-driven layout) and invokes the method through the saved `Interpreter::Execute`, returning the raw return slot value.
3. `CallGameMethodOnObject(obj, method, …)` is the same, but takes the declaring class from the object (`*(void**)obj` is `Il2CppObject::klass`) instead of the learned table. Prefer it for instance methods on the giant data-controller class — see below.
4. Until a method resolves, the call returns 0 and the caller degrades exactly as the legacy code did when the RVA was missing: `ResolveHitSource()` returns the source unchanged, and the attribute-dict enrichment is skipped.

Used for `HotfixDataController.GetOnceAdditionalAttribute` / `GetOnceAdditionalAttributeValue`, `CommonHelper.GetValueConfigIdByLevelType` and `ActorHelper.IsUseHitFromSummon`. Note that in 2.0.0 `IsUseHitFromSummon` is declared `bool IsUseHitFromSummon(this LogicEntity entity, out AdventureActor summoner)` — the out parameter is an `AdventureActor`, not the `PlayerAdventureActor` the 1.15 AOT signature used; slot-wise both are one pointer, and `PlayerAdventureActor` derives from `AdventureActor`, so the existing body keeps working.

### Method-array walking (this cost one silent regression)

`HotfixDataController` declares ~3.5k methods (2,945 explicit + ~545 property getters in `Hotfix.2.0.0.decompiled.cs:111393-163383`); `GetOnceAdditionalAttribute` sits 65% of the way in.

The first attempt at this assumed the old `count < 5000` guard and `limit = 2048` cap were hiding it. That was wrong. A temporary probe (miss log with `method_count` / density / last index plus the first and last method names) showed the real shape at runtime:

```
[hybrid] method lookup: HotfixDataController.GetOnceAdditionalAttribute not found (method_count=935)
[hybrid]   method[0] = get_AchievementData
[hybrid]   method[1] = GetAchievement
…
```

`method_count` is **935** and the array is dense (every entry scanned was a valid `MethodInfo`) — the runtime class simply does not expose the full metadata method list, and the two `GetOnceAdditionalAttribute*` lookups fall outside it. (The array that *is* there runs in decompile order, so it is the hotfix class, not an AOT shadow.) `CommonHelper` (73 methods) and `ActorHelper` (28) are unaffected, which is why exactly one feature went quiet. The probe itself is gone; what remains is a one-line `[hybrid] method lookup: <Class>.<Method> not found (class reports N methods)` per missing name.

Two things follow:

- `FindMethodInClass()` still scans the whole `methods[0..method_count)` array and *skips* null / unreadable / odd-named entries instead of breaking on the first one, with a `ReadableRange(&methods[i], sizeof(void*))` guard on the array slot itself (the array is `calloc`'d by `Class::Init`; an over-reported count leaves nulls, not out-of-bounds entries).
- Since a class array can be incomplete, `ResolveMethod()` now records every interpreted method it sees in the same name table `LearnMethodName()` builds: `"Class.Method"` plus a bare `"#Method"` key. `LookupLearnedMethod()` is the fallback both resolvers use when the class scan misses, and it verifies the learned MethodInfo's declaring class name before returning it, so a same-named method on another class can never be picked. This is exactly the set we need to call back into — the attr-dict lookups run from the game's own `ActorAdditionalAttrInfo.AddAttr`, i.e. they have already executed (interp→interp, so `EnterFrameFromInterpreter` saw them) by the time the first hit asks for a value.

Name comparison uses `MethodNameIs()`, not `PlausibleName()`: the latter insists on 200 readable bytes, but the metadata blob is byte-packed, so a valid name can end closer than that to a page/region end. Only the bytes actually compared have to be readable.

`InvokeOnMethod` refuses a method whose `retStackObjectSize` exceeds 4 slots — that field is in **StackObject units** (HybridCLR `GetTypeArgDesc` gives 1 for references, i64 and byrefs), so the cap only rejects oversized value-type returns; the refusal is logged now instead of returning 0 silently.

## Struct layout verification (2.0.0-specific)

2.0.0 did not only move the combat *methods* to the hotfix: the whole `Nova.Client` data model went with them. `AdventureActor`, `LogicEntity`, `MonsterSummonInfo`, `AreaEffectEntity`, `AdventureWeapon`, `BuffEntity`, `MonsterInfo` and the protobuf config classes (`HitDamage`, `Effect`, `EffectValue`, `BuffEffect`) have **no type declaration** in `versions/2.0.0/dumper/dump.cs` (`grep -c "class <Name>\b"` = 0 for all of them, and `grep -c HitDamage 2.0.0/dumper/il2cpp.h` = 0; the only `HitDamage` strings left in `dump.cs` are the `HitDamageID` property of another message). They are no longer AOT types. Their instance layout is therefore computed by HybridCLR from the hotfix metadata, while `Logger Dll/include/game_structs.h` still carries the offsets generated from the 1.15 AOT dump, and the hook bodies read those structs directly (`adventureActorId()`, `CollectEffectIds()`, `Hook_CopyBattleData`, `Hook_ParseSummonCfg`, the damage enricher, …).

`VerifyClassLayout()` therefore checks the offsets the bodies depend on against the runtime `FieldInfo` table once per observed class:

```
FieldInfo: +0x00 name, +0x08 type, +0x10 parent, +0x18 offset, +0x1C token
```

The check list is `g_fieldChecks[]` — the pointer-carrying fields the bodies dereference (`AdventureActor._dataID` / `.attributeList` / `.specialAttributeList` / `.stateAttributeList` / `.actorInfo`, `AreaEffectEntity._owner` / `._fxPlayer`, `MonsterSummonInfo._SummonActor` / `._Entity`, `AdventureWeapon._owner`, `BuffEntity.buffUidLs` / `.fromActors`, `HitDamage.id_`, `Effect.id_`, `EffectValue.id_`, `BuffEffect.id_`), each compared against `offsetof()` of the struct the bodies actually compile against. **Compiler-generated names must be compared in both spellings**: Il2CppDumper writes `<owner>k__BackingField` as `_owner_k__BackingField`, so a naive `strcmp` reports every auto-property as "not found" (that false alarm appeared in the first 2.0.0 run). Outcomes:

- `[layout] AdventureActor._dataID_k__BackingField OK (+0x1A8)` — the 1.15 layout still holds, logging proceeds.
- `[layout] … MISMATCH: game_structs.h +0x1A8, runtime +0x1B0` or `… not found in the runtime class` — a field moved or the class was reshaped. Bodies are suppressed from then on (`RunBody` returns early), so a stale offset degrades to a clear log instead of dereferencing garbage, and the class's runtime layout is dumped.

`FieldOffsetOf()` searches the class's own `FieldInfo` array and then walks the base chain, because a derived class's array only contains its **own** fields — `MonsterSummonInfo._Entity` is declared on `LogicComponent`, so a lookup restricted to `MonsterSummonInfo` false-alarms "not found" (that mistake disabled every body in one run, right after skill casts and buffs had started logging).

Field iteration also has to be bounded: for hotfix classes `Il2CppClass::field_count` can over-report (`PlayerAdventureActor` reports 80, has 36 own fields), so the field dump and the field lookup stop at the first entry whose name is not a plausible string (and `PlausibleName()` validates readability with `VirtualQuery` first, since walking into adjacent heap and dereferencing a garbage name pointer crashed one run). That stop-at-first-garbage rule is correct for `fields` (the real entries are a dense prefix) but was **wrong for `methods`** — see the method-array section above.

### Reordered members (2.0.0 `ActorAdditionalAttrInfo`)

Moving the code to the hotfix also let data classes be reordered, which offsets cannot absorb. `ActorAdditionalAttrInfo` is the one that bit:

```csharp
// 2.0.0 (Hotfix.decompiled.cs:889)
private Dictionary<int, FDP> attributeWithElementOrDamageTypeDict = new ...;   // now first
public AttributeList attributeList { get; } = new AttributeList();             // now second
public bool forceCrit { get; set; }                                            // now third/fourth
```

1.15 AOT was the other way round (`<attributeList>` `0x10`, `<forceCrit>` `0x18`, `<forceMissDamage>` `0x19`, dictionary `0x20`). So the damage body's `fromAdditionalAttrInfo->fields.attributeWithElementOrDamageTypeDict` read a *bool* (offset `0x20`) and `ReadElemDict()` dereferenced it as a `Dictionary*` — the crash on the first hit.

Two mitigations, both in place:

- `game_structs.h` now carries the 2.0.0 order for `ActorAdditionalAttrInfo_Fields`, so any remaining struct-based reads are correct;
- `ReadObjectFieldPtr(obj, name)` (logging.h) resolves a pointer field's offset from the object's **own runtime class** via `hybrid::FieldOffsetInObject()`, walking the base chain, and returns nullptr when the field does not exist instead of using a stale offset. It is used for the `ActorAdditionalAttrInfo` dictionary + attributeList and for the `GameDataController` maps, because the captured GDC object is a `HotfixDataController` in 2.0.0 (whose `EffectValue_Map` / `OnceAdditionalAttributeValue_Map` are at different offsets).

The check table also covers the pointer fields the hit path dereferences (`ActorAdditionalAttrInfo.*`, `ActorEffectManage.effectsDict/_actor/_timeTriggerEffects`, `AdventureActor.buffComponent/effectManage`, `AdventureEffect._effectConfig/_effectValueConfig/_effectStack/_owner/_fromActor`, `AdventureEffectBase._effect`, `BuffEntity._buffCom/buffConfig`, `BuffCom._BuffList`, `AttributeList.entries`, `AdventureSkill._owner`), so any further reorder disables logging with a dump instead of faulting.
- On a failed check the class and its base chain are dumped (once), so a version with moved offsets can be repaired from a single run. `hotfix_layout_probe: true` additionally dumps every other interpreted class it sees.

Dump format: `[layout]   <offset> (0x<off>) <name> ty=<Il2CppType enum> type=0x<ptr>`, preceded by `[layout] class <Name>: instance_size=0x<N> fields=<n>`. Field names are the raw metadata names, i.e. `<owner>k__BackingField` for auto-properties, which is what pairs them with the C# source for a struct rebuild.

`ClassFieldEntry()` decides at runtime whether `Il2CppClass::fields` is an array of `FieldInfo` structs (il2cpp reality) or an array of pointers (as the dumper types it `void*`), by checking which interpretation yields printable names, so the probe cannot crash on that ambiguity.

Caveat: the check runs when the class is first *observed* as the owner of an interpreted method, which is normally well before the first body of that class runs, but the window is not zero — a body that runs earlier and reads a moved field would still misbehave. If a build ever reports a mismatch, run the probe and regenerate the offsets before enabling logging again.

## Verification status

Verified against the 2.0.0 binary/decompile (static):

- interpreter entry + frame-enter RVAs, their call shape and the layouts above;
- every target class/method name and parameter list exists in `decompilation/hotfix/2.0.0/Hotfix.decompiled.cs` with the recorded arity (`CommonHelper.CalculateNormalDamage` = 22 parameters + static, `AdventureWeapon.Setup` = 8 parameters + `this`, …);
- `MethodArgDesc`-driven slot layout matches HybridCLR's own `argStackObjectSize` accounting (runtime-validated per target);
- the hook bodies' struct offsets are checked against the runtime `FieldInfo` table at load (`VerifyClassLayout`, see above) and logging is disabled with a loud log if one moved — needed because the entire `Nova.Client` data model is hotfix-defined in 2.0.0;
- the two attach points were re-confirmed from the finished 2.0.0 `decompiled.c` and from the binary: `Interpreter::Execute` is `void FUN_18064e270(longlong method, undefined8 *args, longlong ret)` (reads `method->interpData` at `+0x58`, `AllocStackSlot(imi->maxStackSize)`, `PushFrame`, `frame->ret = param_3`, `ip = imi->codes`, then a 0x44D-entry opcode dispatch table) and has **1785** direct call sites in `.text` (the native/AOT bridges); `EnterFrameFromInterpreter` (`0x64E1C0`, 172 B) has **9** call sites, all inside the interpreter at `0x180650D..0x180652382`, i.e. the interpreted→interpreted path really does go through that function rather than being inlined.

Verified in game (2.0.0):

- the discovery finds the same two functions at load time (the log prints `[hybrid] Interpreter::Execute @ 0x…` and `EnterFrameFromInterpreter @ 0x…`; the version-keyed fallback RVA is used if the literal scan fails);
- `[hybrid] target ready: <Class>.<Method> (args N, slots M, entry|after)` for all 23 targets — a missing line means that target was disabled (arg count or layout mismatch) and shows the metadata values to fix the table with;
- deferred (`after`) bodies flush at the expected time (casts, buffs, effects and hits log in the right order);
- all `[layout] … OK` checks pass, and the outgoing calls (`GetOnceAdditionalAttribute`, `GetOnceAdditionalAttributeValue`, `GetValueConfigIdByLevelType`, `IsUseHitFromSummon`) resolve and return the same values the 1.15 AOT path produced.

To check a run, grep the log for `[hybrid]`. `hotfix_hooks` in the config enables/disables the layer (default true); when it is disabled the hotfix build simply installs no combat hooks, and when the interpreter is not detected (≤1.16.1) the legacy RVA path is used unchanged.

## 2.0.0 symbol audit (old RVAs / names)

Every constant in the legacy `RVA_*` table was re-checked against `versions/2.0.0/dumper/script.json` (396,325 `ScriptMethod` entries), `versions/2.0.0/dumper/dump.cs` and `hotfix/2.0.0/Hotfix.decompiled.cs`:

| legacy symbol (1.15) | 1.15 RVA | still in 2.0.0 AOT | 2.0.0 hotfix target |
| --- | --- | --- | --- |
| `AdventureEffect$$OnInit` | `0x113E6D0` | no | `AdventureEffect.OnInit` |
| `AdventureEffectBase$$OnClear` | `0x1139B40` | no | `AdventureEffectBase.OnClear` |
| `HittedAdditionalAttriFix$$Execute` | `0x114A730` | no | `HittedAdditionalAttriFix.Execute` |
| `AdventureLevelController$$UpdateLogic` | `0x118EF10` | no | `AdventureLevelController.UpdateLogic` |
| `ActorEffectManage$$OnBattleStart` | `0x10450B0` | no | `ActorEffectManage.OnBattleStart` |
| `AdventureLevelController$$SpawnSkill` | `0x118DA40` | no | `AdventureLevelController.SpawnSkill` |
| `BuffEffectBase$$OnInit` | `0x16F6B80` | no | `BuffEffectBase.OnInit` |
| `BuffEntity$$BuffExcute` | `0x16FA360` | no | `BuffEntity.BuffExcute` |
| `CommonHelper$$CalculateNormalDamage` | `0x11213B0` | no | `CommonHelper.CalculateNormalDamage` |
| `MonsterActionState$$OnEnter` | `0x1119F30` | no | `MonsterActionState.OnEnter` |
| `AdventureModuleController$$ClearData` | `0x15DF600` | no | `AdventureModuleController.ClearData` |
| `AdventureModuleHelper$$EnterScoreBossFloor` | `0x11B46D0` | no | `AdventureModuleHelper.EnterScoreBossFloor` |
| `AdventureActor$$GetBothAllInfo` | `0x123EDF0` | no | `AdventureActor.GetBothAllInfo` |
| `AreaEffectEntity$$CopyBattleData` | `0x16AADA0` | no | `AreaEffectEntity.CopyBattleData` |
| `AdventureWeapon$$Setup` | `0x1727CC0` | no | `AdventureWeapon.Setup` |
| `FakeAdventureActor$$SetAttrInfo` | `0x1373550` | no | `FakeAdventureActor.SetAttrInfo` |
| `MonsterAdventureActor$$SetPlayerSummonAttrInfo` | `0x137BB80` | no | `MonsterAdventureActor.SetPlayerSummonAttrInfo` |
| `…SetPlayerSummonAttrInfoBySnapshot` | `0x137B6B0` | no | `MonsterAdventureActor.SetPlayerSummonAttrInfoBySnapshot` |
| `MonsterCloneAdventureActor$$SetAttr` | `0x149F820` | no | `MonsterCloneAdventureActor.SetAttr` |
| `MonsterSummonInfo$$ParseSummonCfg` | `0x14A0490` | no | `MonsterSummonInfo.ParseSummonCfg` |
| `PlayerAdventureActor$$SavePlayerAttributeSnapshot` | `0x14A9B80` | no | `PlayerAdventureActor.SavePlayerAttributeSnapshot` |
| `GameDataController$$GetHitDamage` | `0x1296E60` | no | **renamed class** → `HotfixDataController.GetHitDamage` |
| `GameDataController$$GetMonster` | `0x1298160` | no | `HotfixDataController.GetMonster` |
| `GameDataController$$GetOnceAdditionalAttribute` | `0x1298660` | no | `HotfixDataController.GetOnceAdditionalAttribute` |
| `GameDataController$$GetOnceAdditionalAttributeValue` | `0x12984E0` | no | `HotfixDataController.GetOnceAdditionalAttributeValue` |
| `GameDataController$$GetEffectValue` | `0x1296860` | no | `HotfixDataController.GetEffectValue` (**unused** — nothing references this constant any more) |
| `CommonHelper$$GetValueConfigIdByLevelType` | `0x1126950` | no | `CommonHelper.GetValueConfigIdByLevelType` |
| `ActorHelper$$IsUseHitFromSummon` | `0x110BFC0` | no | `ActorHelper.IsUseHitFromSummon(this LogicEntity, out AdventureActor)` |
| `HttpNetworkManager$$DispatchMsgToLua` | `0x133EEA0` | **YES, moved** → `0x12F7060` | — |
| `get_Instance` impl (gizmos) | `0x14830` | **no** — the address now holds unrelated code (`47 4A 00 48 89 03 …`, 1.15 had `48 83 EC 28 48 8B 41 20 …`), and `AdventureModuleDebugHelper` is gone from the AOT metadata | — |
| `AdventureModuleDebugHelper.get_Instance` `MethodInfo` global | `0x71F4C18` | **no** — that location is now a method/vtable table (`0x18072B690`, `0x1847F5E00`, …), 1.15 held different data; the type the logger asked for no longer exists | — |

Notes:

- `GameDataController` *as a type* still exists in the AOT image (it is the config loader now) but has none of the combat/cache accessors; the object the logger captures is a `HotfixDataController`, so matching on the old name would never succeed (which is why the table uses the hotfix name).
- Only one legacy hook still points at AOT code: `HttpNetworkManager$$DispatchMsgToLua`. Same signature and byte-identical prologue (`48 89 6C 24 18 56 41 56`), so `http_hooks.cpp` now probes `0x12F7060` then `0x133EEA0` and disables the HTTP/Star Tower message logs if neither matches.
- The whole 1.15-derived table is now guarded: `LegacyRvaTableMatches()` requires the 1.15 prologues at `RVA_EFFECT_ON_INIT`/`RVA_CALC_NORMAL_DAMAGE` before any AOT hook is installed, so a build where the interpreter attach layer fails cannot hook unrelated 2.0.0 code (the 2.0.0 bytes at those RVAs are completely different: `24 30 48 85 C9 0F 85 3E 0E 00 00 45` / `05 48 8B 88 B8 00 00 00 48 8B 11 48`).

Non-RVA game dependencies that were re-checked:

- `HttpNetMsg` is still AOT with identical offsets (`msgId` `0x10`, `msgBody` `0x18`) in 1.15 and 2.0.0, so the HTTP hook body and `star_tower_hooks.cpp` keep working.
- `GameAssembly.dll` still exports 386 symbols, 241 of them `il2cpp_*` (identical count in both versions); all 21 exports used by `EnsureIl2CppExports()` (origin catalog / Lua DoString) are present.
- `xlua.LuaEnv`, `LuaManager` (with `<luaEnv>k__BackingField` at `0x20`) are still AOT and unchanged.
- The Lua patches (`arenafix.cpp` `PlayerInfinityTowerData:CheckOpenDay`, `dummy.cpp` `PlayerScoreBossData:SendScoreBossSettleReq`, `RegionBossFormationCtrl`) exist in the 2.0.0 Lua dump (`StellaSoraData Makostar/Lua`), with the same module paths and function names.

## Known limitations

- **Game gizmos** (`player_gizmo`, `hitbox_gizmo`, …) stay off in hotfix mode: they need the AOT generic singleton `SceneSingleton<AdventureModuleDebugHelper>.get_Instance` plus its engine-patched `MethodInfo` global (`RVA_GET_INSTANCE_IMPL` `0x14830`, `RVA_ADM_GET_INSTANCE_METHODINFO` `0x71F4C18`), neither of which survives into the hotfix image. `GetDebugHelperInstance()` logs this once.
- **Dummy mode / call suppression** is unchanged in scope: the legacy `monster_dummy_mode` path only rewrites data read from configuration, it never suppressed an engine call. Redirecting or suppressing interpreted calls from the frame hook is not possible (see above), so no suppression was attempted.
- `GetMonster`'s dummy skin on the interpreted → interpreted path mutates the row returned by the duplicate call; if the game's `GetMonster` ever returns a fresh object per call, the mutation would not be seen by the engine (the native path is exact). Blitz-only feature, marked uncertain.
- A deferred body reads the caller's memory through the argument snapshot; `out`/`ref` pointers may have been overwritten by the caller before the flush runs. `CalculateNormalDamage` is immune (the duplicate call rewrites them); the other `after` targets read object fields and identities, not `out` parameters.
