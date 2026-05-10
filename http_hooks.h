#pragma once
#include <cstdint>
#include <string>

// Call once at startup — opens http_log.txt in logDir
void InitHttpLogger(const std::string& logDir);

// Call at shutdown
void ShutdownHttpLogger();

// printf-style line logger (thread-safe, timestamped)
void LogHttp(const char* fmt, ...);

// Loads CharGemAttrValue.json + Item language file for attribute name resolution.
// Call after BuildHitTable so the same dataRoot convention is used.
void BuildGemAttrTable(const std::string& dataRoot);

// Installs all HTTP-layer MinHook hooks. Call after MH_Initialize().
void InstallHttpHooks(uintptr_t base);
