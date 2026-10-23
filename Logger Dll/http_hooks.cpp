// =============================================================================
//  http_hooks.cpp — HTTP-layer hooks, proto parsing, gem attr logging
// =============================================================================
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <cstdint>
#include <cstdio>
#include <cstdarg>
#include <cstring>
#include <ctime>
#include <mutex>
#include <string>
#include <vector>
#include "MinHook.h"
#include "game_structs.h"
#include "logging.h"
#include "http_hooks.h"
#include "proto_reader.h"
#include "star_tower_hooks.h"

// =============================================================================
//  HTTP log file
// =============================================================================
static FILE*      g_HttpLog = nullptr;
static std::mutex g_HttpMtx;

void InitHttpLogger(const std::string& logDir) {
    std::string path = logDir + "\\http_log.txt";
    g_HttpLog = fopen(path.c_str(), "a");
    if (g_HttpLog) {
        time_t t = time(nullptr);
        char buf[64];
        strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", localtime(&t));
        fprintf(g_HttpLog, "\n=== Session started %s ===\n", buf);
        fflush(g_HttpLog);
    }
}

void ShutdownHttpLogger() {
    if (g_HttpLog) { fclose(g_HttpLog); g_HttpLog = nullptr; }
}

void LogHttp(const char* fmt, ...) {
    if (!g_HttpLog) return;
    std::lock_guard<std::mutex> lk(g_HttpMtx);
    va_list args;
    va_start(args, fmt);
    vfprintf(g_HttpLog, fmt, args);
    va_end(args);
    fputc('\n', g_HttpLog);
    fflush(g_HttpLog);
}

// =============================================================================
//  CharGemRefresh parsers
// =============================================================================
static std::string FormatU32List(const std::vector<uint32_t>& v) {
    std::string s = "[";
    for (size_t i = 0; i < v.size(); ++i) {
        if (i) s += ',';
        s += std::to_string(v[i]);
    }
    s += ']';
    return s;
}

static void LogGemRefreshReq(System_Byte_array* body) {
    if (!body || body->max_length == 0) return;
    auto r = MakeReader(body);

    uint32_t charId = 0, slotId = 0, gemIndex = 0;
    std::vector<uint32_t> lockAttrs;

    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1: charId   = (uint32_t)r.varint(); break;
            case 2: slotId   = (uint32_t)r.varint(); break;
            case 3: gemIndex = (uint32_t)r.varint(); break;
            case 4:
                if (wire == 2) lockAttrs = r.packed_uint32();
                else           lockAttrs.push_back((uint32_t)r.varint());
                break;
            default: r.skip(wire); break;
        }
    }

    std::string locks = FormatU32List(lockAttrs);
    LogHttp("REQ %u %u %u %s", charId, slotId, gemIndex + 1, locks.c_str());
}

static void LogGemRefreshResp(System_Byte_array* body) {
    if (!body || body->max_length == 0) return;
    auto r = MakeReader(body);

    std::vector<uint32_t> attributes, overlockCount;

    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1:
                if (wire == 2) attributes = r.packed_uint32();
                else           attributes.push_back((uint32_t)r.varint());
                break;
            case 2: r.skip(wire); break; // ChangeInfo sub-message
            case 3:
                if (wire == 2) overlockCount = r.packed_uint32();
                else           overlockCount.push_back((uint32_t)r.varint());
                break;
            default: r.skip(wire); break;
        }
    }

    // Raw attr IDs — no label resolution
    std::string attrs = FormatU32List(attributes);
    std::string olock = FormatU32List(overlockCount);
    LogHttp("RESP %s %s", attrs.c_str(), olock.c_str());
}

// =============================================================================
//  Hook: HttpNetworkManager$$DispatchMsgToLua
// =============================================================================
using FnDispatchMsgToLua = void(__fastcall*)(void*, HttpNetMsg_o*, bool, HttpNetMsg_o*, void*);
static FnDispatchMsgToLua g_OrigDispatchMsgToLua = nullptr;

static void __fastcall Hook_DispatchMsgToLua(
    void* self, HttpNetMsg_o* recvMsg, bool bIsNext,
    HttpNetMsg_o* sendMsg, void* method)
{
    if (recvMsg) {
        int16_t recvId = recvMsg->fields.msgId;

        if (recvId == 2505) {
            if (sendMsg && sendMsg->fields.msgBody)
                LogGemRefreshReq(sendMsg->fields.msgBody);
            LogGemRefreshResp(recvMsg->fields.msgBody);
        }

        if (recvId == 4602 || recvId == 4608 || recvId == 4611 || recvId == 4614) {
            HandleStarTowerMsg(recvId, recvMsg, sendMsg);
        }
    }
    g_OrigDispatchMsgToLua(self, recvMsg, bIsNext, sendMsg, method);
}

// =============================================================================
//  RVA — HTTP layer
// =============================================================================
// HttpNetworkManager$$DispatchMsgToLua is the only AOT method the logger still
// hooks (everything combat-related is HybridCLR-interpreted since 2.0.0).
//     script.json 2.0.0 RVA 0x12F7060
// The prologue check keeps a moved table from hooking garbage.
static constexpr uintptr_t RVA_NET_DISPATCH_TO_LUA = 0x12F7060;
static const uint8_t kDispatchHead[8] = { 0x48, 0x89, 0x6C, 0x24, 0x18, 0x56, 0x41, 0x56 };

static uintptr_t FindDispatchMsgToLua(uintptr_t base) {
    const uintptr_t rva = RVA_NET_DISPATCH_TO_LUA;
    if (std::memcmp(reinterpret_cast<const void*>(base + rva), kDispatchHead,
                    sizeof(kDispatchHead)) == 0)
        return base + rva;
    return 0;
}

// =============================================================================
//  InstallHttpHooks (public entry point called from InitThread)
// =============================================================================
void InstallHttpHooks(uintptr_t base) {
    const uintptr_t target = FindDispatchMsgToLua(base);
    if (!target) {
        log("[init] HttpNetworkManager$$DispatchMsgToLua not found at 0x12F7060 "
            "(prologue mismatch) — HTTP/Star Tower message logs disabled");
        return;
    }
    InstallHook(target, reinterpret_cast<void*>(&Hook_DispatchMsgToLua),
                (void**)&g_OrigDispatchMsgToLua, "HttpNetworkManager$$DispatchMsgToLua");
}
