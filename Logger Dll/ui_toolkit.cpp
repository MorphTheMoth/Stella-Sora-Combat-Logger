// =============================================================================
//  ui_toolkit.cpp — reusable game-UI cloning toolkit (Lua, via xLua DoString)
// =============================================================================
// __SSL_UI: clone/fit/wire buttons + dropdowns off a panel's own templates.
// Feature chunks (dummy.cpp, future menus) use it through `local UI = __SSL_UI`
// — see the recipe comment at the top of the chunk. Everything is defensive
// (pcall inside) and idempotent: a 0.5 s pump can re-run it while panels
// rebuild themselves underneath.
// No top-level return: this chunk is concatenated in front of feature chunks.

#include "ui_toolkit.h"

static const char* kSslUiToolkitChunk = R"lua(
-- =============================================================================
-- __SSL_UI: tiny toolkit for cloning game UI into panels we don't own.
-- Adding another menu later = clone a button and/or a dropdown off that
-- menu's own templates, e.g.:
--   local btn = UI.clone(tplBtn, tplBtn.transform.parent, 'SSL_MyBtn')
--   UI.place(btn, tplBtn, x, y)             -- same anchor space, own position
--   UI.onClick(btn, function() ... end)
--   local dd = UI.clone(UI.loadNode(prefabPath, nodeNames), parent, 'SSL_MyDD')
--   UI.fillDrop(dd, labels, value, onPick)  -- guarded: safe to call each tick
--   UI.flipUp(dd)                           -- popup grows upward, not off-screen
--   local w = UI.fitBar(dd, refBtn)         -- bar as wide as refBtn
--   UI.fitList(dd, w)                       -- items onto the narrowed width
--   UI.manage(dd)                           -- chevron/sound event fan-out
-- each tick while shown: UI.pollDrop(dd); hiding: UI.closeDrop(dd) first
-- (kills the fullscreen click-eater before deactivating), then SetActive(false).
-- Everything is defensive (pcall inside) and idempotent: a 0.5 s pump can
-- re-run it while the panel rebuilds itself underneath.
-- =============================================================================
if __SSL_UI == nil then __SSL_UI = {} end
if __SSL_UI.drops == nil then __SSL_UI.drops = {} end
if __SSL_UI.tplCache == nil then __SSL_UI.tplCache = {} end
local UI = __SSL_UI
UI.alive = function(go)
  if go == nil then return false end
  local ok, dead = pcall(function() return go:IsNull() end)
  if not ok or dead then return false end
  local ok2, par = pcall(function() return go.transform.parent end)
  return ok2 and par ~= nil
end
UI.find = function(root, name)
  if root == nil then return nil end
  local found = nil
  pcall(function()
    local all = root:GetComponentsInChildren(typeof(CS.UnityEngine.Transform), true)
    local n = (all ~= nil) and all.Length or 0
    for i = 0, n - 1 do
      local t = all[i]
      if t ~= nil and t.gameObject ~= nil and t.gameObject.name == name then found = t.gameObject break end
    end
  end)
  return found
end
-- Unique names: panels re-parse prefabs on reopen and map nodes by DFS name
-- last-write-wins, so a clone keeping e.g. 'txtStartBattle' would hijack the
-- real node's localized binds.
UI.renameTree = function(go)
  pcall(function()
    local all = go:GetComponentsInChildren(typeof(CS.UnityEngine.Transform), true)
    local n = (all ~= nil) and all.Length or 0
    for i = 0, n - 1 do
      local t = all[i]
      if t ~= nil and t ~= go.transform then
        local nm = t.gameObject.name
        if nm:sub(1, 4) ~= 'SSL_' then t.gameObject.name = 'SSL_' .. nm end
      end
    end
  end)
end
-- Reuse a same-named sibling (survives hiding — GameObject.Find skips inactive
-- objects, which would otherwise spawn duplicates), else instantiate fresh.
-- Caller keeps the ref and re-checks UI.alive each tick.
UI.clone = function(tplGo, parentTr, name)
  local exist = parentTr:Find(name)
  if exist ~= nil then return exist.gameObject end
  local go = instantiate(tplGo, parentTr)
  go.name = name
  return go
end
-- Copy the template's anchor space; position/size are ours.
UI.place = function(go, tplGo, x, y, w, h)
  local tRt = tplGo:GetComponent('RectTransform')
  local rt = go:GetComponent('RectTransform')
  if rt == nil or tRt == nil then return end
  rt.anchorMin = tRt.anchorMin
  rt.anchorMax = tRt.anchorMax
  rt.pivot = tRt.pivot
  local sd = tRt.sizeDelta
  if w ~= nil then sd.x = w end
  if h ~= nil then sd.y = h end
  rt.sizeDelta = sd
  rt.anchoredPosition = Vector2(x, y)
end
UI.setText = function(go, s)
  local txt = nil
  pcall(function() txt = go:GetComponentInChildren(typeof(CS.TMPro.TMP_Text), true) end)
  if txt == nil then pcall(function() txt = go:GetComponentInChildren(typeof(CS.UnityEngine.UI.Text), true) end) end
  if txt ~= nil then
    local dok = pcall(function() txt.text = s end)
    if not dok then pcall(function() NovaAPI.SetTMPText(txt, s) end) end
  end
end
UI.buttonComp = function(go)
  local b = nil
  pcall(function() b = go:GetComponent('UIButton') end)
  if b == nil then pcall(function() b = go:GetComponent('Button') end) end
  return b
end
UI.onClick = function(go, fn)
  local b = UI.buttonComp(go)
  if b == nil then error('no Button/UIButton on clone') end
  b.onClick:RemoveAllListeners()
  b.onClick:AddListener(fn)
end
UI.dropComp = function(go)
  if go == nil then return nil end
  local dd = nil
  pcall(function() dd = go:GetComponent('TMP_Dropdown') end)
  if dd == nil then pcall(function() dd = go:GetComponent('Dropdown') end) end
  if dd == nil then pcall(function() dd = go:GetComponentInChildren(typeof(CS.TMPro.TMP_Dropdown), true) end) end
  if dd == nil then pcall(function() dd = go:GetComponentInChildren(typeof(CS.UnityEngine.UI.Dropdown), true) end) end
  return dd
end
-- Load a panel prefab as a plain asset (panelId 0 => never auto-unloaded on
-- panel close) and return one node from it. Cached: the asset outlives panels.
UI.loadNode = function(path, nodeNames)
  if __SSL_UI.tplCache[path] ~= nil then return __SSL_UI.tplCache[path] end
  local GRL = require('Game.Common.Resource.GameResourceLoader')
  local prefab = GRL.LoadAsset(GRL.ResType.Any, path, typeof(CS.UnityEngine.Object), 'UI', 0)
  if prefab == nil then error('prefab load failed: ' .. tostring(path)) end
  local all = prefab:GetComponentsInChildren(typeof(CS.UnityEngine.Transform), true)
  local n = (all ~= nil) and all.Length or 0
  for _, nm in ipairs(nodeNames or {}) do
    for i = 0, n - 1 do
      local t = all[i]
      if t ~= nil and t.gameObject ~= nil and t.gameObject.name == nm then
        __SSL_UI.tplCache[path] = t.gameObject
        return t.gameObject
      end
    end
  end
  error('node not in prefab: ' .. tostring(path))
end
-- Guarded refill, safe to call every tick: rebuilding the option list under
-- an open popup destroys it and strands IsExpanded=true (chevron stuck open),
-- so options are only rebuilt when value/count actually changed. Listeners are
-- re-attached every call (cheap; keeps them fresh across chunk versions).
UI.fillDrop = function(go, labels, value, onPick)
  local dd = UI.dropComp(go)
  if dd == nil then error('no TMP_Dropdown under clone') end
  labels = labels or {}
  -- Signature guard (value + count + first label): the donor template ships
  -- its own options ("Option A/B/C"), so value+count alone can't tell a fresh
  -- clone from a filled one. Skip the rebuild only on a full match; listeners
  -- are still re-attached every call (cheap; keeps them fresh).
  local sig = tostring(value) .. ':' .. tostring(#labels) .. ':' .. tostring(labels[1])
  local e = UI.entryFor(go)
  if e == nil or e.fillSig ~= sig then
    dd:ClearOptions()
    local List_String = CS.System.Collections.Generic.List(CS.System.String)
    local lst = List_String()
    for _, s in ipairs(labels) do lst:Add(s) end
    dd:AddOptions(lst)
    dd.value = value
    if e ~= nil then e.fillSig = sig end
  end
  dd.onValueChanged:RemoveAllListeners()
  if onPick ~= nil then dd.onValueChanged:AddListener(onPick) end
  return true
end
-- The formation screen sits at the bottom of the display, so the stock
-- downward-opening list runs off-screen. Re-anchor it to the TOP edge with a
-- bottom pivot: the list grows upward where there is room.
UI.flipUp = function(go)
  pcall(function()
    local dd = UI.dropComp(go)
    if dd == nil or dd.template == nil then return end
    local t = dd.template
    t.anchorMin = Vector2(0, 1)
    t.anchorMax = Vector2(1, 1)
    t.pivot = Vector2(0.5, 0)
    t.anchoredPosition = Vector2(0, 4)
    -- Stretch anchors + zero x-offset => popup exactly as wide as the bar.
    t.sizeDelta = Vector2(0, t.sizeDelta.y)
  end)
end
-- Fresh lookup each call (a dozen nodes; cheaper than debugging a stale cache).
UI.arrows = function(go)
  if not UI.alive(go) then return nil, nil end
  local up = UI.find(go.transform, 'SSL_imgUp')
  if up == nil then up = UI.find(go.transform, 'imgUp') end
  local dn = UI.find(go.transform, 'SSL_imgDown')
  if dn == nil then dn = UI.find(go.transform, 'imgDown') end
  return up, dn
end
UI.setArrows = function(go, bOpen)
  if not UI.alive(go) then return end
  pcall(function()
    local up, dn = UI.arrows(go)
    if up ~= nil then up:SetActive(not bOpen) end
    if dn ~= nil then dn:SetActive(bOpen) end
  end)
end
UI.entryFor = function(go)
  for _, e in ipairs(__SSL_UI.drops) do
    if e.go == go then return e end
  end
  return nil
end
UI.manage = function(go)
  local drops = {}
  for _, e in ipairs(__SSL_UI.drops) do
    if e.go ~= go and UI.alive(e.go) then drops[#drops + 1] = e end
  end
  if UI.alive(go) then
    -- Preserve the surviving entry (chevron flag + fill signature); only
    -- truly new dropdowns start blank.
    local e = UI.entryFor(go)
    if e == nil then e = { go = go } end
    if e.was == nil then e.was = false end
    drops[#drops + 1] = e
  end
  __SSL_UI.drops = drops
end
UI.pollDrop = function(go)
  if not UI.alive(go) then return false end
  local open = false
  pcall(function()
    local dd = UI.dropComp(go)
    if dd == nil then return end
    open = dd.IsExpanded == true
    UI.setArrows(go, open)
    local e = UI.entryFor(go)
    if e ~= nil then e.was = open end
  end)
  return open
end
UI.closeDrop = function(go)
  if not UI.alive(go) then return end
  pcall(function()
    local dd = UI.dropComp(go)
    if dd == nil then return end
    local open = false
    pcall(function() open = dd.IsExpanded == true end)
    if open then dd:Hide() end
  end)
  -- The swap is otherwise pump-driven; reset it with the close so a
  -- dismissed popup never keeps the open chevron.
  UI.setArrows(go, false)
  pcall(function()
    local e = UI.entryFor(go)
    if e ~= nil then e.was = false end
  end)
end
UI.playSound = function(bOpen)
  pcall(function()
    local s = bOpen and 'ui_common_menu_open' or 'ui_common_menu_close'
    CS.WwiseAudioManager.Instance:PlaySound(s)
  end)
end
-- The C# class only fires 'DropdownOpenState' for GOs named 'Dropdown_List',
-- so in practice the pump does the swapping; this is the no-double-play path
-- in case a future prefab is renamed (mirrors TemplateDropdownCtrl:OnEvent_Open).
UI.onDropEvent = function(_, bOpen)
  bOpen = (bOpen == true)
  pcall(function()
    for _, e in ipairs(__SSL_UI.drops) do
      if UI.alive(e.go) then
        local cur = false
        pcall(function() cur = UI.dropComp(e.go).IsExpanded == true end)
        if bOpen and cur then
          e.was = true
          UI.setArrows(e.go, true)
          UI.playSound(true)
        elseif not bOpen and e.was then
          e.was = false
          UI.setArrows(e.go, false)
          UI.playSound(false)
        end
      end
    end
  end)
end
UI.subEvent = function()
  -- Best-effort unhook of pre-toolkit listeners (same event, old table).
  pcall(function()
    if EventManager.Remove ~= nil then EventManager.Remove('DropdownOpenState', __SSL_TB) end
  end)
  if __SSL_UI.evSub then return end
  pcall(function()
    EventManager.Add('DropdownOpenState', __SSL_UI, __SSL_UI.onDropEvent)
    __SSL_UI.evSub = true
  end)
end
-- Shrink-to-fit text (never enlarge: max = current size).
UI.autoSize = function(labelGo, minSize)
  pcall(function()
    local cap = labelGo:GetComponentInChildren(typeof(CS.TMPro.TMP_Text), true)
    if cap == nil then cap = labelGo:GetComponentInChildren(typeof(CS.UnityEngine.UI.Text), true) end
    if cap == nil then return end
    local mx = 28
    pcall(function() mx = cap.fontSize end)
    cap.enableAutoSizing = true
    cap.fontSizeMin = minSize or 16
    cap.fontSizeMax = mx
  end)
end
-- Shrink the donor bar (462 wide) to the reference button's width and re-place
-- caption/chevron/plate from the prefab's metrics (plate 72, flush right;
-- caption stopping 21 px left of it). Both the ctrl root and the inner
-- Dropdown take the width, so the popup matches too. Returns the width.
UI.fitBar = function(go, refGo)
  local w = 305
  pcall(function()
    if not UI.alive(go) then return end
    local dRt = UI.alive(refGo) and refGo:GetComponent('RectTransform') or nil
    if dRt ~= nil then
      local bw = dRt.rect.width
      if bw == nil or bw < 1 then bw = dRt.sizeDelta.x end
      if bw ~= nil and bw > 1 then w = bw end
    end
    local rt = go:GetComponent('RectTransform')
    local inner = UI.find(go.transform, 'SSL_Dropdown')
    if inner == nil then inner = UI.find(go.transform, 'Dropdown') end
    local hh = 72
    local irt = inner ~= nil and inner:GetComponent('RectTransform') or nil
    if irt ~= nil and irt.sizeDelta.y > 1 then hh = irt.sizeDelta.y end
    if rt ~= nil then rt.sizeDelta = Vector2(w, hh) end
    if irt ~= nil then irt.sizeDelta = Vector2(w, hh) end
    local cx = (w / 2) - 35
    for _, nm in ipairs({ 'SSL_imgBg', 'SSL_imgUp', 'SSL_imgDown' }) do
      local g = UI.find(go.transform, nm)
      if g == nil then g = UI.find(go.transform, nm:sub(5)) end
      if g ~= nil then
        local r = g:GetComponent('RectTransform')
        if r ~= nil then r.anchoredPosition = Vector2(cx, r.anchoredPosition.y) end
      end
    end
    local lbl = UI.find(go.transform, 'SSL_Label')
    if lbl == nil then lbl = UI.find(go.transform, 'Label') end
    if lbl ~= nil then
      local r = lbl:GetComponent('RectTransform')
      if r ~= nil then
        local left = -(w / 2)
        local right = cx - 36 - 21
        r.anchoredPosition = Vector2((left + right) / 2, r.anchoredPosition.y)
        r.sizeDelta = Vector2((right - left) - w, r.sizeDelta.y)
        UI.autoSize(lbl)
      end
    end
    -- The plate is optional decoration; an Image whose sprite didn't resolve
    -- draws a white quad, so hide it rather than show a blank square.
    local bg = UI.find(go.transform, 'SSL_imgBg')
    if bg == nil then bg = UI.find(go.transform, 'imgBg') end
    if bg ~= nil then
      local img = nil
      pcall(function() img = bg:GetComponent('Image') end)
      if img ~= nil then bg:SetActive(img.sprite ~= nil) end
    end
  end)
  return w
end
-- Popup list onto the narrowed bar width w, from live rects: item roots take
-- w (already-correct ones untouched; LayoutElement clamp as backstop), the 2px
-- divider is hidden outright, center-anchored ornaments keep their right-edge
-- distance, and item captions get a centered near-full-width box (the item
-- has no arrow to clear) plus shrink-to-fit. Idempotent.
UI.fitList = function(go, w)
  pcall(function()
    if not UI.alive(go) then return end
    if w == nil or w < 1 then return end
    local all = go:GetComponentsInChildren(typeof(CS.UnityEngine.Transform), true)
    local n = (all ~= nil) and all.Length or 0
    local function baseName(nm)
      if nm ~= nil and nm:sub(-7) == '(Clone)' then return nm:sub(1, -8) end
      return nm
    end
    local function isItem(nm)
      local b = baseName(nm)
      return b == 'SSL_Item ' or b == 'Item '
    end
    local function isLine(nm)
      local b = baseName(nm)
      return b == 'SSL_Item Background' or b == 'Item Background'
    end
    -- Pass 1: checkmark shift, BEFORE items shrink (parents still at old width).
    for i = 0, n - 1 do
      local t = all[i]
      if t ~= nil and t.gameObject ~= nil and not isLine(t.gameObject.name) then
        local par = nil
        pcall(function() par = t.parent end)
        if par ~= nil and par.gameObject ~= nil and isItem(par.gameObject.name) then
          local img = nil
          pcall(function() img = t.gameObject:GetComponent('Image') end)
          if img ~= nil then
            local r = t.gameObject:GetComponent('RectTransform')
            if r ~= nil then
              local amin, amax = r.anchorMin, r.anchorMax
              if amin ~= nil and amax ~= nil
                and math.abs(amin.x - 0.5) < 0.01 and math.abs(amax.x - 0.5) < 0.01 then
                local pr = par.gameObject:GetComponent('RectTransform')
                if pr ~= nil then
                  local pw = pr.rect.width
                  if pw ~= nil and pw - w > 1 then
                    local ap = r.anchoredPosition
                    r.anchoredPosition = Vector2(ap.x - (pw - w) / 2, ap.y)
                  end
                end
              end
            end
          end
        end
      end
    end
    -- Pass 2: divider off, item width, caption box.
    for i = 0, n - 1 do
      local t = all[i]
      if t ~= nil and t.gameObject ~= nil then
        local nm = t.gameObject.name
        local b = baseName(nm)
        local isLbl = (b == 'SSL_Item Label' or b == 'Item Label')
        if isItem(nm) or isLine(nm) or isLbl then
          if isLine(nm) then
            t.gameObject:SetActive(false)
          elseif isLbl then
            local lr = t.gameObject:GetComponent('RectTransform')
            if lr ~= nil then
              local left = -(w / 2) + 16
              local right = (w / 2) - 16
              lr.anchoredPosition = Vector2((left + right) / 2, lr.anchoredPosition.y)
              lr.sizeDelta = Vector2((right - left) - w, lr.sizeDelta.y)
            end
            UI.autoSize(t.gameObject)
          else
            local r = t.gameObject:GetComponent('RectTransform')
            if r ~= nil then
              local cw = r.rect.width
              if cw ~= nil and cw > 1 then
                local sd = r.sizeDelta
                sd.x = sd.x + (w - cw)
                r.sizeDelta = sd
                pcall(function()
                  local le = t.gameObject:GetComponent('LayoutElement')
                  if le ~= nil then le.minWidth = w end
                end)
              end
            end
          end
        end
      end
    end
  end)
end
)lua";

const char* SslUiToolkitChunk() {
    return kSslUiToolkitChunk;
}
