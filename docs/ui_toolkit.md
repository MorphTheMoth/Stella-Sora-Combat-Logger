# ui_toolkit — reusable game-UI cloning toolkit

`Logger Dll/ui_toolkit.cpp` holds a Lua chunk (raw string, exposed via `include/ui_toolkit.h` as `SslUiToolkitChunk()`), concatenated **ahead of** feature chunks in `EnsureScoreBossTestButton` (`dummy.cpp`). Same pattern as `arenafix.cpp`. It defines the `__SSL_UI` table; features use it through `local UI = __SSL_UI`.

## Recipe (new menu button/dropdown)

```lua
local btn = UI.clone(tplBtn, tplBtn.transform.parent, 'SSL_MyBtn')
UI.place(btn, tplBtn, x, y)              -- same anchor space, own position
UI.onClick(btn, function() ... end)
local dd = UI.clone(UI.loadNode(prefabPath, nodeNames), parent, 'SSL_MyDD')
UI.fillDrop(dd, labels, value, onPick)   -- tick-safe guarded refill
UI.flipUp(dd)                            -- popup grows upward, not off-screen
local w = UI.fitBar(dd, refBtn)          -- bar as wide as refBtn
UI.fitList(dd, w)                        -- items onto the narrowed width
UI.manage(dd)                            -- chevron/sound tracking
-- each tick while shown: UI.pollDrop(dd)
-- hiding: UI.closeDrop(dd) first, then SetActive(false)
```

Helpers: `alive`, `find` (DFS by name), `renameTree` (`SSL_` prefix), `clone` (reuse-or-create), `place`, `setText` (TMP → legacy → NovaAPI), `buttonComp`/`onClick`, `dropComp`, `loadNode` (cached prefab node), `fillDrop`, `flipUp`, `arrows`/`setArrows`, `manage`/`pollDrop`/`closeDrop`, `playSound`, `onDropEvent`/`subEvent`, `autoSize` (shrink-to-fit text), `fitBar`, `fitList`.

## Game UI facts

- Lua runs only via xLua `DoString` on the **Unity main thread** (WM_TIMER pump, room-transition hooks). Never re-enter Lua from C++ that Lua called (e.g. `EnterScoreBossFloor`).
- Panels re-parse prefabs on reopen; `BaseCtrl` maps nodes by DFS name **last-write-wins** — a clone keeping a native name hijacks localized binds. Always `renameTree`.
- Clone into the **template's own parent/anchor space**, mirror the native `activeSelf`, `SetAsLastSibling` for draw order.
- An open `TMP_Dropdown` spawns a **fullscreen Blocker**: `closeDrop` (Hide) **before** deactivating, or all clicks die.
- `DropdownOpenState` only fires for GOs named `Dropdown_List` — poll `IsExpanded` instead; the event subscription is just a no-double-play path.
- Load foreign prefabs with panelId `0` (never auto-unloaded); `loadNode` caches the asset node.
- Never `ClearOptions` under an open popup — it strands `IsExpanded=true` (chevron stuck open). `fillDrop` refills only on value/count/first-label change.
- `RectTransform.sizeDelta` is relative to anchors: read live `rect.width` for deltas, never hardcode donor metrics.
- Text: bar captions clear the chevron plate (asymmetric box); item labels get a centered near-full-width box (no arrow in items). `autoSize` shrinks, never enlarges.
