// =============================================================================
//  http_hooks.cpp — HTTP-layer hooks, proto parsing, gem attr logging
// =============================================================================
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <cstdint>
#include <cstdio>
#include <cstdarg>
#include <ctime>
#include <mutex>
#include <string>
#include <vector>
#include <unordered_map>
#include "MinHook.h"
#include "game_structs.h"
#include "logging.h"
#include "json.hpp"
#include "http_hooks.h"
#include "star_tower_hooks.h"

using json = nlohmann::json;

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
//  Proto helpers
// =============================================================================
struct ProtoReader {
    const uint8_t* p;
    const uint8_t* end;

    bool ok() const { return p < end; }

    uint64_t varint() {
        uint64_t v = 0; int s = 0;
        while (p < end) {
            uint8_t b = *p++;
            v |= (uint64_t)(b & 0x7F) << s;
            if (!(b & 0x80)) break;
            s += 7;
        }
        return v;
    }

    bool tag(int& field, int& wire) {
        if (p >= end) return false;
        uint64_t t = varint();
        if (t == 0) return false;
        field = (int)(t >> 3);
        wire  = (int)(t & 0x7);
        return true;
    }

    void skip(int wire) {
        if      (wire == 0) varint();
        else if (wire == 2) { uint64_t n = varint(); p += n; }
        else if (wire == 1) p += 8;
        else if (wire == 5) p += 4;
    }

    ProtoReader sub() {
        uint64_t n = varint();
        ProtoReader s{ p, p + n };
        p += n;
        return s;
    }

    std::vector<uint32_t> packed_uint32() {
        auto s = sub();
        std::vector<uint32_t> v;
        while (s.ok()) v.push_back((uint32_t)s.varint());
        return v;
    }
};

static ProtoReader MakeReader(System_Byte_array* body) {
    auto* p = reinterpret_cast<const uint8_t*>(body->m_Items);
    return { p, p + body->max_length };
}

// =============================================================================
//  CharGemRefresh parsers
// =============================================================================
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

    char locks[256] = "[]";
    if (!lockAttrs.empty()) {
        int pos = snprintf(locks, sizeof(locks), "[");
        for (size_t i = 0; i < lockAttrs.size(); i++)
            pos += snprintf(locks + pos, sizeof(locks) - pos,
                            "%s%u", i ? "," : "", lockAttrs[i]);
        snprintf(locks + pos, sizeof(locks) - pos, "]");
    }

    LogHttp("REQ %u %u %u %s", charId, slotId, gemIndex + 1, locks);
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
    char attrs[1024] = "[]";
    if (!attributes.empty()) {
        int pos = snprintf(attrs, sizeof(attrs), "[");
        for (size_t i = 0; i < attributes.size(); i++)
            pos += snprintf(attrs + pos, sizeof(attrs) - pos,
                            "%s%u", i ? "," : "", attributes[i]);
        snprintf(attrs + pos, sizeof(attrs) - pos, "]");
    }

    // OverlockCount: one entry per affix slot
    char olock[256] = "[]";
    if (!overlockCount.empty()) {
        int pos = snprintf(olock, sizeof(olock), "[");
        for (size_t i = 0; i < overlockCount.size(); i++)
            pos += snprintf(olock + pos, sizeof(olock) - pos,
                            "%s%u", i ? "," : "", overlockCount[i]);
        snprintf(olock + pos, sizeof(olock) - pos, "]");
    }

    LogHttp("RESP %s %s", attrs, olock);
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
//  RVAs — HTTP layer
// =============================================================================
static constexpr uintptr_t RVA_NET_DISPATCH_TO_LUA = 0x133EEA0;

// =============================================================================
//  InstallHttpHooks (public entry point called from InitThread)
// =============================================================================
void InstallHttpHooks(uintptr_t base) {
    InstallHook(base + RVA_NET_DISPATCH_TO_LUA, reinterpret_cast<void*>(&Hook_DispatchMsgToLua), (void**)&g_OrigDispatchMsgToLua, "HttpNetworkManager$$DispatchMsgToLua");
}
