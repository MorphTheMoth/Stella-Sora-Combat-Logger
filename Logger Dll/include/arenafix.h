#pragma once

// Menace Arena (InfinityTower) open-day bypass chunk (defined in arenafix.cpp).
// Concatenated in front of other Lua chunks run via RunLuaDoString on the
// Unity main thread. No top-level return.
const char* InfinityTowerOpenPatch();
