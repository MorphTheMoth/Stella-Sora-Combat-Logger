#pragma once

// Reusable game-UI cloning toolkit chunk (defined in ui_toolkit.cpp).
// Concatenated ahead of feature chunks run via RunLuaDoString on the
// Unity main thread. Defines the __SSL_UI table; no top-level return.
const char* SslUiToolkitChunk();
