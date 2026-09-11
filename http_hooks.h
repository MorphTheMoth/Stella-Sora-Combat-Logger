#pragma once
#include <cstdint>
#include <string>

// Call once at startup — opens http_log.txt in logDir
void InitHttpLogger(const std::string& logDir);

// Call at shutdown
void ShutdownHttpLogger();

// printf-style line logger (thread-safe; no per-line timestamp)
void LogHttp(const char* fmt, ...);

// Installs all HTTP-layer MinHook hooks. Call after MH_Initialize().
void InstallHttpHooks(uintptr_t base);
