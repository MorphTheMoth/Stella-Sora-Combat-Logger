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

using json = nlohmann::json;

// Forward — defined in proxy.cpp / logging.cpp

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
    time_t t = time(nullptr);
    char ts[32];
    strftime(ts, sizeof(ts), "%H:%M:%S", localtime(&t));
    fprintf(g_HttpLog, "[%s] ", ts);
    va_list args;
    va_start(args, fmt);
    vfprintf(g_HttpLog, fmt, args);
    va_end(args);
    fputc('\n', g_HttpLog);
    fflush(g_HttpLog);
}

// =============================================================================
//  Gem attribute table
// =============================================================================

struct GemAttrInfo {
    int32_t attrType;
    int32_t firstSubtype;
    int32_t secondSubtype;
    float   value;
    // Pre-built label for types 12, 37, 7.
    // Empty for type 99 (potential) — resolved at parse time using charId.
    std::string label;
};

static std::unordered_map<int32_t, GemAttrInfo> g_GemAttrTable;
// Item language map — needed at parse time for type-99 potential name lookups
static std::unordered_map<std::string, std::string> g_ItemLang;

// effectAttributeType enum → display name
static const std::unordered_map<int32_t, std::string> kEffectAttrNames = {
    {  1, "ATK"                   },
    {  2, "DEF"                   },
    {  3, "MAXHP"                 },
    {  4, "HITRATE"               },
    {  5, "EVD"                   },
    {  6, "CRITRATE"              },
    {  7, "CRITRESIST"            },
    {  8, "CRITPOWER_P"           },
    {  9, "PENETRATE"             },
    { 10, "DEF_IGNORE"            },
    { 11, "WER"                   },
    { 12, "FER"                   },
    { 13, "SER"                   },
    { 14, "AER"                   },
    { 15, "LER"                   },
    { 16, "DER"                   },
    { 17, "WEE"                   },
    { 18, "FEE"                   },
    { 19, "SEE"                   },
    { 20, "AEE"                   },
    { 21, "LEE"                   },
    { 22, "DEE"                   },
    { 23, "WEP"                   },
    { 24, "FEP"                   },
    { 25, "SEP"                   },
    { 26, "AEP"                   },
    { 27, "LEP"                   },
    { 28, "DEP"                   },
    { 29, "WEI"                   },
    { 30, "FEI"                   },
    { 31, "SEI"                   },
    { 32, "AEI"                   },
    { 33, "LEI"                   },
    { 34, "DEI"                   },
    { 35, "WEERCD"                },
    { 36, "FEERCD"                },
    { 37, "SEERCD"                },
    { 38, "AEERCD"                },
    { 39, "LEERCD"                },
    { 40, "DEERCD"                },
    { 41, "WEIGHT"                },
    { 42, "TOUGHNESS_MAX"         },
    { 43, "TOUGHNESS_DAMAGE_ADJUST"},
    { 44, "SHIELD_MAX"            },
    // 45 intentionally absent (gap in enum)
    { 46, "MOVESPEED"             },
    { 47, "ATKSPD_P"              },
    { 48, "INTENSITY"             },
    { 49, "GENDMG"                },
    { 50, "DMGPLUS"               },
    { 51, "FINALDMG"              },
    { 52, "FINALDMGPLUS"          },
    { 53, "GENDMGRCD"             },
    { 54, "DMGPLUSRCD"            },
    { 55, "SUPPRESS"              },
    { 56, "NORMALDMG"             },
    { 57, "SKILLDMG"              },
    { 58, "ULTRADMG"              },
    { 59, "OTHERDMG"              },
    { 60, "RCDNORMALDMG"          },
    { 61, "RCDSKILLDMG"           },
    { 62, "RCDULTRADMG"           },
    { 63, "RCDOTHERDMG"           },
    { 64, "MARKDMG"               },
    { 65, "RCDMARKDMG"            },
    { 66, "SUMMONDMG"             },
    { 67, "RCDSUMMONDMG"          },
    { 68, "PROJECTILEDMG"         },
    { 69, "RCDPROJECTILEDMG"      },
    { 70, "NORMALCRITRATE"        },
    { 71, "SKILLCRITRATE"         },
    { 72, "ULTRACRITRATE"         },
    { 73, "MARKCRITRATE"          },
    { 74, "SUMMONCRITRATE"        },
    { 75, "PROJECTILECRITRATE"    },
    { 76, "OTHERCRITRATE"         },
    { 77, "NORMALCRITPOWER"       },
    { 78, "SKILLCRITPOWER"        },
    { 79, "ULTRACRITPOWER"        },
    { 80, "MARKCRITPOWER"         },
    { 81, "SUMMONCRITPOWER"       },
    { 82, "PROJECTILECRITPOWER"   },
    { 83, "OTHERCRITPOWER"        },
    { 84, "ENERGY_MAX"            },
    { 85, "SKILL_INTENSITY"       },
    { 86, "TOUGHNESS_BROKEN_DMG"  },
    { 87, "ADD_SHIELD_STRENGTHEN" },
    { 88, "BE_ADD_SHIELD_STRENGTHEN"},
    { 89, "NORMAL_SUPPRESS"       },
    { 90, "SKILL_SUPPRESS"        },
    { 91, "ULTRA_SUPPRESS"        },
    { 92, "MARK_SUPPRESS"         },
    { 93, "SUMMON_SUPPRESS"       },
    { 94, "PROJECTILE_SUPPRESS"   },
    { 95, "OTHER_SUPPRESS"        },
    { 96, "ENV_AMEND"             },
};

static std::string EffectAttrName(int32_t subtype) {
    auto it = kEffectAttrNames.find(subtype);
    return (it != kEffectAttrNames.end()) ? it->second : ("ATTR" + std::to_string(subtype));
}

// Format a float value: values < 1 are shown as a percentage (×100), others as integers.
static std::string FormatValue(float v) {
    char buf[32];
    if (v < 1.0f)
        snprintf(buf, sizeof(buf), "%.0f%%", v * 100.0f);
    else
        snprintf(buf, sizeof(buf), "%.0f", v);
    return buf;
}

// Build the human-readable label for a single attr entry at table-build time
// (types 12, 37, 7). Returns "" for type 99 (needs charId at parse time).
static std::string BuildAttrLabel(int32_t attrType, int32_t firstSubtype,
                                   int32_t /*secondSubtype*/, float value) {
    std::string val = FormatValue(value);
    switch (attrType) {
        case 12: // stat boost
            return val + " " + EffectAttrName(firstSubtype);

        case 37: { // charge efficiency
            const char* slot = (firstSubtype == 1) ? "Main" : "Support";
            return val + " Charge Efficiency (" + slot + ")";
        }

        case 7: { // ability level-up
            const char* names[] = { "?", "AA", "Skill", "Support Skill", "Ultimate" };
            const char* abilityName = (firstSubtype >= 1 && firstSubtype <= 4)
                                      ? names[firstSubtype] : "Ability";
            return std::string(abilityName) + " +" + val;
        }

        case 99: // potential level-up — resolved at parse time
            return "";

        default:
            return "Type" + std::to_string(attrType) + "(" + val + ")";
    }
}

// Resolve a type-99 potential label at parse time using the request's charId.
static std::string ResolvePotentialLabel(const GemAttrInfo& info, int32_t charId) {
    // Key format: "Item.5" + charId + firstSubtype + ".1"
    std::string key = "Item.5" + std::to_string(charId)
                    + std::to_string(info.firstSubtype) + ".1";
    auto it = g_ItemLang.find(key);
    std::string potName = (it != g_ItemLang.end()) ? it->second
                        : ("Potential" + std::to_string(info.firstSubtype));
    return potName + " +" + FormatValue(info.value);
}

// =============================================================================
//  BuildGemAttrTable (public entry point called from InitThread)
// =============================================================================
void BuildGemAttrTable(const std::string& dataRoot) {
    const std::string binPath  = dataRoot + "/EN/bin/";
    const std::string langPath = dataRoot + "/EN/language/en_US/";

    // --- Load files -----------------------------------------------------------
    auto LoadJson = [&](const std::string& path, const char* tag) -> json {
        FILE* f = fopen(path.c_str(), "rb");
        if (!f) { log("[gem] %s not found: %s", tag, path.c_str()); return json{}; }
        fseek(f, 0, SEEK_END); long sz = ftell(f); rewind(f);
        std::string raw(sz, '\0');
        fread(raw.data(), 1, sz, f);
        fclose(f);
        json j = json::parse(raw, nullptr, false);
        if (j.is_discarded()) { log("[gem] %s parse error: %s", tag, path.c_str()); return json{}; }
        return j;
    };

    json jGem     = LoadJson(binPath  + "CharGemAttrValue.json", "CharGemAttrValue");
    json jItemLang = LoadJson(langPath + "Item.json",             "Item lang");

    if (jGem.is_null() || jGem.is_discarded()) return;

    // Cache Item language map for type-99 runtime lookups
    if (!jItemLang.is_null() && !jItemLang.is_discarded()) {
        for (auto& [k, v] : jItemLang.items()) {
            if (v.is_string())
                g_ItemLang[k] = v.get<std::string>();
        }
        log("[gem] Loaded %d item lang entries", (int)g_ItemLang.size());
    }

    // --- Parse CharGemAttrValue entries --------------------------------------
    int built = 0;
    for (auto& [key, entry] : jGem.items()) {
        int32_t id = 0;
        try { id = std::stoi(key); } catch (...) { continue; }

        if (!entry.contains("AttrType")) continue;

        int32_t attrType     = entry.value("AttrType",               0);
        int32_t firstSubtype = entry.value("AttrTypeFirstSubtype",   0);
        int32_t secondSubtype= entry.value("AttrTypeSecondSubtype",  0);
        float   value        = 0.0f;

        if (entry.contains("Value")) {
            try { value = std::stof(entry["Value"].get<std::string>()); }
            catch (...) {}
        }

        std::string label = BuildAttrLabel(attrType, firstSubtype, secondSubtype, value);
        g_GemAttrTable[id] = { attrType, firstSubtype, secondSubtype, value, label };
        ++built;
    }
    log("[gem] Built gem attr table: %d entries", built);
}

// Format one attribute ID for display, given the request's charId (needed for type 99)
static std::string FormatGemAttr(uint32_t attrId, int32_t charId) {
    auto it = g_GemAttrTable.find((int32_t)attrId);
    if (it == g_GemAttrTable.end())
        return "?" + std::to_string(attrId);
    const GemAttrInfo& info = it->second;
    if (info.attrType == 99)
        return ResolvePotentialLabel(info, charId);
    return info.label.empty() ? ("?" + std::to_string(attrId)) : info.label;
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

// Returns charId so the caller can pass it to LogGemRefreshResp
static int32_t LogGemRefreshReq(System_Byte_array* body) {
    if (!body || body->max_length == 0) return 0;
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

    LogHttp("GEM_REFRESH_REQ  CharId=%u  SlotId=%u  GemIndex=%u  LockAttrs=%s",
            charId, slotId, gemIndex + 1, locks);
    return (int32_t)charId;
}

static void LogGemRefreshResp(System_Byte_array* body, int32_t charId) {
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

    // Attributes: flat array of attr IDs — look up each one
    char attrs[1024] = "[]";
    if (!attributes.empty()) {
        int pos = snprintf(attrs, sizeof(attrs), "[");
        for (size_t i = 0; i < attributes.size(); i++) {
            std::string label = FormatGemAttr(attributes[i], charId);
            pos += snprintf(attrs + pos, sizeof(attrs) - pos,
                            "%s%s", i ? ", " : "", label.c_str());
        }
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

    LogHttp("GEM_REFRESH_RESP  Attributes=%s  OverlockCount=%s", attrs, olock);
}

// =============================================================================
//  IL2Cpp string helper
// =============================================================================
static std::string Il2CppStringToUTF8(System_String_o* s) {
    if (!s) return "<null>";
    int32_t len = s->fields._stringLength;
    if (len <= 0 || len > 4096) return "<invalid>";
    const wchar_t* chars = reinterpret_cast<const wchar_t*>(&s->fields._firstChar);
    int sz = WideCharToMultiByte(CP_UTF8, 0, chars, len, nullptr, 0, nullptr, nullptr);
    if (sz <= 0) return "";
    std::string out(sz, '\0');
    WideCharToMultiByte(CP_UTF8, 0, chars, len, out.data(), sz, nullptr, nullptr);
    return out;
}

// =============================================================================
//  Hook: YoStar.SDK.Net.Response..ctor
// =============================================================================
using FnYoStarResponse = void(__fastcall*)(
    YoStar_SDK_Net_Response_object__o*, int64_t,
    YoStar_SDK_Net_ResponseResult_T__o*, YoStar_SDK_Net_Request_o*,
    bool, System_String_o*, void*);
static FnYoStarResponse g_OrigYoStarResponse = nullptr;

static void __fastcall Hook_YoStarResponse(
    YoStar_SDK_Net_Response_object__o* self, int64_t httpCode,
    YoStar_SDK_Net_ResponseResult_T__o* responseResult,
    YoStar_SDK_Net_Request_o* request, bool timeout,
    System_String_o* authInfo, void* method)
{
    g_OrigYoStarResponse(self, httpCode, responseResult, request, timeout, authInfo, method);

    std::string host     = request ? Il2CppStringToUTF8(request->fields._CurrentHost_k__BackingField) : "";
    std::string endpoint = request ? Il2CppStringToUTF8(request->fields._Endpoint_k__BackingField)    : "";
    int32_t resultCode   = responseResult ? responseResult->fields._code_k__BackingField : -1;
    std::string resultMsg = responseResult ? Il2CppStringToUTF8(responseResult->fields._msg_k__BackingField) : "";

    LogHttp("RESPONSE  httpCode=%lld  resultCode=%d  timeout=%d  url=\"%s%s\"  msg=\"%s\"",
            (long long)httpCode, resultCode, (int)timeout,
            host.c_str(), endpoint.c_str(), resultMsg.c_str());
}

// =============================================================================
//  Hook: YoStar.SDK.AliHelper.AliNetHelper$$http
// =============================================================================
using FnAliHttp = void(__fastcall*)(void*, System_String_o*, void*);
static FnAliHttp g_OrigAliHttp = nullptr;

static void __fastcall Hook_AliHttp(void* self, System_String_o* domain, void* method) {
    LogHttp("ALI_SEND  domain=\"%s\"", Il2CppStringToUTF8(domain).c_str());
    g_OrigAliHttp(self, domain, method);
}

// =============================================================================
//  Hook: AliyunSLS.Unity4SLS$$_sls_http
// =============================================================================
using FnSlsHttp = void(__fastcall*)(
    System_String_o*, System_String_o*, int32_t, int32_t, int32_t,
    System_String_o*, bool, int32_t, System_String_o*, void*, int32_t, void*);
static FnSlsHttp g_OrigSlsHttp = nullptr;

static void __fastcall Hook_SlsHttp(
    System_String_o* domain, System_String_o* context,
    int32_t size, int32_t maxTimes, int32_t timeout,
    System_String_o* ip, bool headerOnly, int32_t downloadBytesLimit,
    System_String_o* detect_uid, void* ext, int32_t length, void* method)
{
    LogHttp("SLS_SEND  domain=\"%s\"  size=%d  maxTimes=%d  headerOnly=%d",
            Il2CppStringToUTF8(domain).c_str(), size, maxTimes, (int)headerOnly);
    g_OrigSlsHttp(domain, context, size, maxTimes, timeout,
                  ip, headerOnly, downloadBytesLimit, detect_uid, ext, length, method);
}

// =============================================================================
//  Hook: NovaAPI$$AddSendMsgRequest  (disabled — crashes in combat, kept for ref)
// =============================================================================
using FnNovaAddSendMsg = void(__fastcall*)(int16_t, System_Byte_array*, void*, System_String_o*, void*);
static FnNovaAddSendMsg g_OrigNovaAddSendMsg = nullptr;

static void __fastcall Hook_NovaAddSendMsg(
    int16_t msgId, System_Byte_array* msgBody,
    void* callbackAction, System_String_o* url, void* method)
{
    std::string urlStr = url ? Il2CppStringToUTF8(url) : "<default>";
    int32_t bodyLen = msgBody ? (int32_t)msgBody->max_length : 0;
    LogHttp("NOVA_SEND  msgId=%d  url=\"%s\"  bodyBytes=%d", (int)msgId, urlStr.c_str(), bodyLen);
    g_OrigNovaAddSendMsg(msgId, msgBody, callbackAction, url, method);
}

// =============================================================================
//  Hook: HttpNetworkManager$$AddSendMsgRequest  (disabled — crashes in combat)
// =============================================================================
using FnNetAddSendMsg = void(__fastcall*)(void*, int16_t, System_Byte_array*, void*, System_String_o*, void*);
static FnNetAddSendMsg g_OrigNetAddSendMsg = nullptr;

static void __fastcall Hook_NetAddSendMsg(
    void* self, int16_t msgId, System_Byte_array* msgBody,
    void* callbackAction, System_String_o* url, void* method)
{
    std::string urlStr = url ? Il2CppStringToUTF8(url) : "<default>";
    int32_t bodyLen = msgBody ? (int32_t)msgBody->max_length : 0;
    LogHttp("NET_SEND   msgId=%d  url=\"%s\"  bodyBytes=%d", (int)msgId, urlStr.c_str(), bodyLen);
    g_OrigNetAddSendMsg(self, msgId, msgBody, callbackAction, url, method);
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
        int16_t sendId = sendMsg ? sendMsg->fields.msgId : -1;
        int32_t recvBodyLen = recvMsg->fields.msgBody ? (int32_t)recvMsg->fields.msgBody->max_length : 0;
        //LogHttp("NET_RECV   recvMsgId=%d  sendMsgId=%d  bodyBytes=%d  isNext=%d",
        //        (int)recvId, (int)sendId, recvBodyLen, (int)bIsNext);

        if (recvId == 2505) {
            int32_t charId = 0;
            if (sendMsg && sendMsg->fields.msgBody)
                charId = LogGemRefreshReq(sendMsg->fields.msgBody);
            LogGemRefreshResp(recvMsg->fields.msgBody, charId);
        }
    }
    g_OrigDispatchMsgToLua(self, recvMsg, bIsNext, sendMsg, method);
}

// =============================================================================
//  RVAs — HTTP layer
// =============================================================================
static constexpr uintptr_t RVA_YOSTAR_RESPONSE    = 0x3455A10; // 54876688
static constexpr uintptr_t RVA_ALI_HTTP           = 0x5C5D7F0; // 96851952
static constexpr uintptr_t RVA_SLS_HTTP           = 0x5B83CE0; // 95960288
static constexpr uintptr_t RVA_NOVA_SEND_MSG      = 0x11D2AA0; // 18690208
static constexpr uintptr_t RVA_NET_SEND_MSG       = 0x1310900; // 19990784
static constexpr uintptr_t RVA_NET_DISPATCH_TO_LUA= 0x1311710; // 19994384

// =============================================================================
//  InstallHttpHooks (public entry point called from InitThread)
// =============================================================================
void InstallHttpHooks(uintptr_t base) {
    //InstallHook(base + RVA_YOSTAR_RESPONSE,     reinterpret_cast<void*>(&Hook_YoStarResponse),   (void**)&g_OrigYoStarResponse,   "YoStar$$Response$$ctor");
    //InstallHook(base + RVA_ALI_HTTP,            reinterpret_cast<void*>(&Hook_AliHttp),          (void**)&g_OrigAliHttp,          "AliNetHelper$$http");
    //InstallHook(base + RVA_SLS_HTTP,            reinterpret_cast<void*>(&Hook_SlsHttp),          (void**)&g_OrigSlsHttp,          "AliyunSLS$$_sls_http");
    // These two crash in combat — disabled
    // InstallHook(base + RVA_NOVA_SEND_MSG,    reinterpret_cast<void*>(&Hook_NovaAddSendMsg),   (void**)&g_OrigNovaAddSendMsg,   "NovaAPI$$AddSendMsgRequest");
    // InstallHook(base + RVA_NET_SEND_MSG,     reinterpret_cast<void*>(&Hook_NetAddSendMsg),    (void**)&g_OrigNetAddSendMsg,    "HttpNetworkManager$$AddSendMsgRequest");
    InstallHook(base + RVA_NET_DISPATCH_TO_LUA, reinterpret_cast<void*>(&Hook_DispatchMsgToLua), (void**)&g_OrigDispatchMsgToLua, "HttpNetworkManager$$DispatchMsgToLua");
}
