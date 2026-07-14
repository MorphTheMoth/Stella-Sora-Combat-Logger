// =============================================================================
//  star_tower_hooks.cpp — Star Tower network message logging
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
#include "json.hpp"
#include "game_structs.h"
#include "star_tower_hooks.h"

using json = nlohmann::json;

// =============================================================================
//  Log file
// =============================================================================
static FILE*      g_StarLog = nullptr;
static std::mutex g_StarMtx;

void InitStarTowerLogger(const std::string& logDir) {
    std::string path = logDir + "\\star_tower_log.txt";
    g_StarLog = fopen(path.c_str(), "a");
    if (g_StarLog) {
        time_t t = time(nullptr);
        char buf[64];
        strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", localtime(&t));
        fprintf(g_StarLog, "\n=== Session started %s ===\n", buf);
        fflush(g_StarLog);
    }
}

void ShutdownStarTowerLogger() {
    if (g_StarLog) { fclose(g_StarLog); g_StarLog = nullptr; }
}

static void LogStarTower(const char* fmt, ...) {
    if (!g_StarLog) return;
    std::lock_guard<std::mutex> lk(g_StarMtx);
    va_list args;
    va_start(args, fmt);
    vfprintf(g_StarLog, fmt, args);
    va_end(args);
    fputc('\n', g_StarLog);
    fflush(g_StarLog);
}

static void LogStarJson(const char* prefix, const json& j) {
    if (!g_StarLog) return;
    std::lock_guard<std::mutex> lk(g_StarMtx);
    std::string s = j.dump(-1, ' ', false, json::error_handler_t::replace);
    fprintf(g_StarLog, "%s %s\n", prefix, s.c_str());
    fflush(g_StarLog);
}

// =============================================================================
//  ProtoReader
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

    uint32_t fixed32() {
        uint32_t v = 0;
        if (p + 4 <= end) {
            v = (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
                ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
            p += 4;
        }
        return v;
    }

    uint64_t fixed64() {
        uint64_t v = 0;
        if (p + 8 <= end) {
            v = (uint64_t)p[0] | ((uint64_t)p[1] << 8) |
                ((uint64_t)p[2] << 16) | ((uint64_t)p[3] << 24) |
                ((uint64_t)p[4] << 32) | ((uint64_t)p[5] << 40) |
                ((uint64_t)p[6] << 48) | ((uint64_t)p[7] << 56);
            p += 8;
        }
        return v;
    }

    ProtoReader sub() {
        uint64_t n = varint();
        ProtoReader s{ p, p + n };
        p += n;
        return s;
    }

    std::string str() {
        uint64_t n = varint();
        std::string s(reinterpret_cast<const char*>(p), n);
        p += n;
        return s;
    }

    std::vector<uint32_t> packed_uint32() {
        auto s = sub();
        std::vector<uint32_t> v;
        while (s.ok()) v.push_back((uint32_t)s.varint());
        return v;
    }

    std::vector<uint64_t> packed_uint64() {
        auto s = sub();
        std::vector<uint64_t> v;
        while (s.ok()) v.push_back(s.varint());
        return v;
    }
};

static ProtoReader MakeReader(System_Byte_array* body) {
    if (!body || body->max_length == 0) return { nullptr, nullptr };
    auto* p = reinterpret_cast<const uint8_t*>(body->m_Items);
    return { p, p + body->max_length };
}

// =============================================================================
//  JSON helpers
// =============================================================================
static json arr()  { return json::array(); }
static json obj()  { return json::object(); }

// =============================================================================
//  ChangeInfo parser (simplified — extracts type_urls from Any entries)
// =============================================================================
static json ParseChangeInfo(ProtoReader r) {
    json result = obj();
    json props = arr();

    int field, wire;
    while (r.tag(field, wire)) {
        if (field == 1 && wire == 2) {
            // repeated Any props
            auto sub = r.sub();
            json prop = obj();
            int pf, pw;
            std::string typeUrl;
            while (sub.tag(pf, pw)) {
                if (pf == 1 && pw == 2) {
                    typeUrl = sub.str();
                } else if (pf == 2 && pw == 2) {
                    uint64_t n = sub.p[0] | ((uint64_t)(sub.p[1]) << 8);
                    // Try to peek value length from the Any's value bytes
                    sub.skip(pw);
                } else {
                    sub.skip(pw);
                }
            }
            if (!typeUrl.empty())
                props.push_back(typeUrl);
        } else {
            r.skip(wire);
        }
    }

    result["props"] = props;
    return result;
}

// =============================================================================
//  Sub-note skill info
// =============================================================================
static json ParseSubNoteSkillInfo(ProtoReader r) {
    json j = obj();
    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1: j["tid"]       = (uint32_t)r.varint(); break;
            case 2: j["qty"]       = (int32_t)r.varint();   break;
            case 3: j["new"]       = r.varint() != 0;        break;
            case 4: j["luckyLevel"]= (uint32_t)r.varint();   break;
            default: r.skip(wire); break;
        }
    }
    return j;
}

// =============================================================================
//  ActiveSecondaryChange
// =============================================================================
static json ParseActiveSecondaryChange(ProtoReader r) {
    json j = obj();
    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1: j["secondaryId"] = (uint32_t)r.varint(); break;
            case 2: j["active"]      = r.varint() != 0;      break;
            default: r.skip(wire); break;
        }
    }
    return j;
}

// =============================================================================
//  TowerChangeData
// =============================================================================
static json ParseTowerChangeData(ProtoReader r) {
    json j = obj();
    json infos = arr(), secondaries = arr();
    int field, wire;
    while (r.tag(field, wire)) {
        if (field == 1 && wire == 2) {
            infos.push_back(ParseSubNoteSkillInfo(r.sub()));
        } else if (field == 2 && wire == 2) {
            secondaries.push_back(ParseActiveSecondaryChange(r.sub()));
        } else {
            r.skip(wire);
        }
    }
    j["infos"] = infos;
    j["secondaries"] = secondaries;
    return j;
}

// =============================================================================
//  ItemTpl
// =============================================================================
static json ParseItemTpl(ProtoReader r) {
    json j = obj();
    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1: j["tid"] = (uint32_t)r.varint(); break;
            case 2: j["qty"] = (int32_t)r.varint();   break;
            default: r.skip(wire); break;
        }
    }
    return j;
}

// =============================================================================
//  TowerItemInfo / PotentialInfo / TowerResInfo
// =============================================================================
static json ParseTowerItemInfo(ProtoReader r) {
    json j = obj();
    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1: j["tid"] = (uint32_t)r.varint(); break;
            case 2: j["qty"] = (int32_t)r.varint();   break;
            default: r.skip(wire); break;
        }
    }
    return j;
}

static json ParsePotentialInfo(ProtoReader r) {
    json j = obj();
    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1: j["tid"]   = (uint32_t)r.varint(); break;
            case 2: j["level"] = (int32_t)r.varint();   break;
            default: r.skip(wire); break;
        }
    }
    return j;
}

static json ParseTowerResInfo(ProtoReader r) {
    json j = obj();
    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1: j["tid"] = (uint32_t)r.varint(); break;
            case 2: j["qty"] = (int32_t)r.varint();   break;
            default: r.skip(wire); break;
        }
    }
    return j;
}

static json ParseFateCardInfo(ProtoReader r) {
    json j = obj();
    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1: j["tid"]   = (uint32_t)r.varint(); break;
            case 2: j["level"] = (uint32_t)r.varint();  break;
            case 3: j["star"]  = (uint32_t)r.varint();  break;
            case 4: j["exp"]   = (uint32_t)r.varint();  break;
            case 5: j["new"]   = r.varint() != 0;       break;
            default: r.skip(wire); break;
        }
    }
    return j;
}

// =============================================================================
//  StarTowerBag
// =============================================================================
static json ParseStarTowerBag(ProtoReader r) {
    json j = obj();
    json items = arr(), potentials = arr(), res = arr(), fateCards = arr();
    int field, wire;
    while (r.tag(field, wire)) {
        if (field == 1 && wire == 2) {
            items.push_back(ParseTowerItemInfo(r.sub()));
        } else if (field == 2 && wire == 2) {
            potentials.push_back(ParsePotentialInfo(r.sub()));
        } else if (field == 3 && wire == 2) {
            res.push_back(ParseTowerResInfo(r.sub()));
        } else if (field == 4 && wire == 2) {
            fateCards.push_back(ParseFateCardInfo(r.sub()));
        } else {
            r.skip(wire);
        }
    }
    j["items"] = items;
    j["potentials"] = potentials;
    j["res"] = res;
    j["fateCards"] = fateCards;
    return j;
}

// =============================================================================
//  StarTowerCharGem
// =============================================================================
static json ParseStarTowerCharGem(ProtoReader r) {
    json j = obj();
    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1:
                if (wire == 2) j["attributes"] = r.packed_uint32();
                else { json a = arr(); a.push_back((uint32_t)r.varint()); j["attributes"] = a; }
                break;
            case 2: j["slotId"] = (uint32_t)r.varint(); break;
            case 3:
                if (wire == 2) j["overlockCount"] = r.packed_uint32();
                else { json a = arr(); a.push_back((uint32_t)r.varint()); j["overlockCount"] = a; }
                break;
            default: r.skip(wire); break;
        }
    }
    return j;
}

// =============================================================================
//  StarTowerChar
// =============================================================================
static json ParseStarTowerChar(ProtoReader r) {
    json j = obj();
    json gems = arr();
    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1: j["id"]            = (uint32_t)r.varint(); break;
            case 2: if (wire == 2) gems.push_back(ParseStarTowerCharGem(r.sub())); else r.skip(wire); break;
            case 3: j["level"]         = (uint32_t)r.varint(); break;
            case 4:
                if (wire == 2) j["skillLvs"] = r.packed_uint32();
                else { json a = arr(); a.push_back((uint32_t)r.varint()); j["skillLvs"] = a; }
                break;
            case 5: j["affinityLevel"] = (uint32_t)r.varint(); break;
            case 6: j["advance"]       = (uint32_t)r.varint(); break;
            case 7:
                if (wire == 2) j["talentNodes"] = r.str();
                else r.skip(wire);
                break;
            default: r.skip(wire); break;
        }
    }
    j["gems"] = gems;
    return j;
}

// =============================================================================
//  StarTowerDisc
// =============================================================================
static json ParseStarTowerDisc(ProtoReader r) {
    json j = obj();
    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1: j["id"]    = (uint32_t)r.varint(); break;
            case 2: j["level"] = (uint32_t)r.varint(); break;
            case 3: j["phase"] = (uint32_t)r.varint(); break;
            case 4: j["star"]  = (uint32_t)r.varint(); break;
            default: r.skip(wire); break;
        }
    }
    return j;
}

// =============================================================================
//  StarTowerMeta
// =============================================================================
static json ParseStarTowerMeta(ProtoReader r) {
    json j = obj();
    json chars = arr(), discs = arr();
    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1:  j["id"]               = (uint32_t)r.varint(); break;
            case 2:  j["charHp"]           = (uint32_t)r.varint(); break;
            case 3:  j["teamLevel"]        = (uint32_t)r.varint(); break;
            case 4:  j["teamExp"]          = (uint32_t)r.varint(); break;
            case 5:  if (wire == 2) chars.push_back(ParseStarTowerChar(r.sub())); else r.skip(wire); break;
            case 6:  if (wire == 2) discs.push_back(ParseStarTowerDisc(r.sub())); else r.skip(wire); break;
            case 7:  j["dateLen"]          = (uint32_t)r.varint(); break;
            case 8:  if (wire == 2) j["clientData"] = r.str(); else r.skip(wire); break;
            case 9:
                if (wire == 2) j["activeSecondaryIds"] = r.packed_uint32();
                else { json a = arr(); a.push_back((uint32_t)r.varint()); j["activeSecondaryIds"] = a; }
                break;
            case 10: j["npcInteractions"]  = (uint32_t)r.varint(); break;
            case 11:
                if (wire == 2) j["towerGrowthNodes"] = r.packed_uint32();
                else { json a = arr(); a.push_back((uint32_t)r.varint()); j["towerGrowthNodes"] = a; }
                break;
            case 12: j["resurrectionCnt"]  = (uint32_t)r.varint(); break;
            case 14: j["totalTime"]        = (uint32_t)r.varint(); break;
            case 15:
                if (wire == 2) j["totalDamages"] = r.packed_uint64();
                else r.skip(wire);
                break;
            case 16: j["buildId"]          = r.varint();            break;
            case 17: j["dataVersion"]      = (uint32_t)r.varint(); break;
            default: r.skip(wire); break;
        }
    }
    j["chars"] = chars;
    j["discs"] = discs;
    return j;
}

// =============================================================================
//  StarTowerRoomData
// =============================================================================
static json ParseStarTowerRoomData(ProtoReader r) {
    json j = obj();
    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1: j["floor"]      = (uint32_t)r.varint(); break;
            case 2: j["mapId"]      = (uint32_t)r.varint(); break;
            case 3: j["paramId"]    = (uint32_t)r.varint(); break;
            case 4: j["roomType"]   = (uint32_t)r.varint(); break;
            case 5: if (wire == 2) j["mapParam"] = r.str(); else r.skip(wire); break;
            case 6: j["mapTableId"] = (uint32_t)r.varint(); break;
            default: r.skip(wire); break;
        }
    }
    return j;
}

// =============================================================================
//  Case type parsers
// =============================================================================
static json ParseBattleCase(ProtoReader r) {
    json j = obj(); j["caseType"] = 1;
    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1: j["timeLimit"]       = r.varint() != 0;       break;
            case 2: j["fateCard"]        = r.varint() != 0;       break;
            case 3: j["subNoteSkillNum"] = (uint32_t)r.varint();  break;
            default: r.skip(wire); break;
        }
    }
    return j;
}

static json ParseDoorCase(ProtoReader r) {
    json j = obj(); j["caseType"] = 2;
    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1: j["floor"] = (uint32_t)r.varint(); break;
            case 2: j["type"]  = (uint32_t)r.varint(); break;
            default: r.skip(wire); break;
        }
    }
    return j;
}

static json ParseSelectPotentialCase(ProtoReader r) {
    json j = obj(); j["caseType"] = 3;
    json infos = arr();
    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1:
                if (wire == 2) infos.push_back(ParsePotentialInfo(r.sub()));
                else r.skip(wire);
                break;
            case 2:  j["teamLevel"]   = (uint32_t)r.varint();  break;
            case 3:  j["newIds"]      = r.packed_uint32();     break;
            case 12: j["luckyIds"]    = r.packed_uint32();     break;
            case 13: j["canReRoll"]   = r.varint() != 0;       break;
            case 14: j["reRollPrice"] = (uint32_t)r.varint();  break;
            case 15: j["type"]        = (uint32_t)r.varint();  break;
            default: r.skip(wire); break;
        }
    }
    j["infos"] = infos;
    return j;
}

static json ParseSelectSpecialPotentialCase(ProtoReader r) {
    json j = obj(); j["caseType"] = 7;
    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1: j["ids"]         = r.packed_uint32();     break;
            case 2: j["teamLevel"]   = (uint32_t)r.varint();  break;
            case 3: j["newIds"]      = r.packed_uint32();     break;
            case 7: j["canReRoll"]   = r.varint() != 0;       break;
            case 8: j["reRollPrice"] = (uint32_t)r.varint();  break;
            default: r.skip(wire); break;
        }
    }
    return j;
}

static json ParseNPCAffinityInfo(ProtoReader r) {
    json j = obj();
    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1: j["npcId"]    = (uint32_t)r.varint(); break;
            case 2: j["affinity"] = (uint32_t)r.varint(); break;
            default: r.skip(wire); break;
        }
    }
    return j;
}

static json ParseNpcEventCase(ProtoReader r) {
    json j = obj(); j["caseType"] = 6;
    json optionsList = arr(), npcInfos = arr(), failedArr = arr();
    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1: j["evtId"]  = (uint32_t)r.varint(); break;
            case 2: optionsList = r.packed_uint32();    break;
            case 3: failedArr   = r.packed_uint32();    break;
            case 4: j["npcId"]  = (uint32_t)r.varint(); break;
            case 5: j["done"]   = r.varint() != 0;      break;
            case 6:
                if (wire == 2) npcInfos.push_back(ParseNPCAffinityInfo(r.sub()));
                else r.skip(wire);
                break;
            default: r.skip(wire); break;
        }
    }
    j["options"] = optionsList;
    j["failedIdxes"] = failedArr;
    j["npcs"] = npcInfos;
    return j;
}

static json ParseRecoveryHPCase(ProtoReader r) {
    json j = obj(); j["caseType"] = 8;
    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1: j["effectId"] = (uint32_t)r.varint(); break;
            default: r.skip(wire); break;
        }
    }
    return j;
}

static json ParseNpcRecoveryHPCase(ProtoReader r) {
    json j = obj(); j["caseType"] = 9;
    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1: j["effectId"] = (uint32_t)r.varint(); break;
            default: r.skip(wire); break;
        }
    }
    return j;
}

static json ParseHawkerGoods(ProtoReader r) {
    json j = obj();
    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1: j["sid"]      = (uint32_t)r.varint();  break;
            case 2: j["idx"]      = (uint32_t)r.varint();  break;
            case 3: j["charPos"]  = (uint32_t)r.varint();  break;
            case 4: j["price"]    = (int32_t)r.varint();    break;
            case 5: j["discount"] = (int32_t)r.varint();    break;
            case 6: j["type"]     = (uint32_t)r.varint();  break;
            case 7: j["goodsId"]  = (uint32_t)r.varint();  break;
            case 15:j["tag"]      = (uint32_t)r.varint();  break;
            default: r.skip(wire); break;
        }
    }
    return j;
}

static json ParseHawkerCase(ProtoReader r) {
    json j = obj(); j["caseType"] = 10;
    json list = arr();
    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1:
                if (wire == 2) list.push_back(ParseHawkerGoods(r.sub()));
                else r.skip(wire);
                break;
            case 2: j["purchase"]    = r.packed_uint32();     break;
            case 7: j["canReRoll"]   = r.varint() != 0;       break;
            case 8: j["reRollPrice"] = (uint32_t)r.varint();  break;
            case 9: j["reRollTimes"]  = (uint32_t)r.varint(); break;
            default: r.skip(wire); break;
        }
    }
    j["list"] = list;
    return j;
}

static json ParseStrengthenMachineCase(ProtoReader r) {
    json j = obj(); j["caseType"] = 11;
    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1: j["times"]     = (uint32_t)r.varint();  break;
            case 7: j["firstFree"] = r.varint() != 0;       break;
            case 8: j["discount"]  = (uint32_t)r.varint();  break;
            default: r.skip(wire); break;
        }
    }
    return j;
}

static json ParseSyncHPCase(ProtoReader r) {
    json j = obj(); j["caseType"] = 13;
    return j;
}

// =============================================================================
//  StarTowerRoomCase
// =============================================================================
static json ParseOneRoomCase(ProtoReader r) {
    int field, wire;
    uint32_t caseId = 0;
    json caseData;

    while (r.tag(field, wire)) {
        if (field == 1) {
            caseId = (uint32_t)r.varint();
        } else if (wire == 2) {
            switch (field) {
                case 2:  caseData = ParseBattleCase(r.sub());                  break;
                case 3:  caseData = ParseDoorCase(r.sub());                    break;
                case 4:  caseData = ParseSelectSpecialPotentialCase(r.sub());  break;
                case 5:  caseData = ParseSelectPotentialCase(r.sub());         break;
                case 6:  caseData = ParseSelectPotentialCase(r.sub());         break; // FateCard
                case 8:  caseData = ParseNpcEventCase(r.sub());                break;
                case 9:  caseData = ParseRecoveryHPCase(r.sub());              break;
                case 10: caseData = ParseNpcRecoveryHPCase(r.sub());           break;
                case 11: caseData = ParseHawkerCase(r.sub());                  break;
                case 12: caseData = ParseStrengthenMachineCase(r.sub());       break;
                case 15: caseData = ParseSyncHPCase(r.sub());                  break;
                default: r.skip(wire); break;
            }
        } else {
            r.skip(wire);
        }
    }

    if (!caseData.is_null()) {
        caseData["id"] = caseId;
        return caseData;
    }
    json j = obj();
    j["id"] = caseId;
    return j;
}

// =============================================================================
//  StarTowerRoom
// =============================================================================
static json ParseStarTowerRoom(ProtoReader r) {
    json j = obj();
    json cases = arr();
    int field, wire;
    while (r.tag(field, wire)) {
        if (field == 1 && wire == 2) {
            j["data"] = ParseStarTowerRoomData(r.sub());
        } else if (field == 2 && wire == 2) {
            cases.push_back(ParseOneRoomCase(r.sub()));
        } else {
            r.skip(wire);
        }
    }
    j["cases"] = cases;
    return j;
}

// =============================================================================
//  StarTowerInfo (top-level in apply resp)
// =============================================================================
static json ParseStarTowerInfo(ProtoReader r) {
    json j = obj();
    int field, wire;
    while (r.tag(field, wire)) {
        if (field == 1 && wire == 2) {
            j["meta"] = ParseStarTowerMeta(r.sub());
        } else if (field == 2 && wire == 2) {
            j["room"] = ParseStarTowerRoom(r.sub());
        } else if (field == 3 && wire == 2) {
            j["bag"] = ParseStarTowerBag(r.sub());
        } else {
            r.skip(wire);
        }
    }
    return j;
}

// =============================================================================
//  StarTowerBuildBrief / BuildDetail / BuildPotential / TowerBuildChar
// =============================================================================
static json ParseTowerBuildChar(ProtoReader r) {
    json j = obj();
    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1: j["charId"]       = (uint32_t)r.varint(); break;
            case 2: j["potentialCnt"] = (uint32_t)r.varint(); break;
            default: r.skip(wire); break;
        }
    }
    return j;
}

static json ParseBuildPotential(ProtoReader r) {
    json j = obj();
    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1: j["potentialId"] = (uint32_t)r.varint(); break;
            case 2: j["level"]       = (uint32_t)r.varint(); break;
            default: r.skip(wire); break;
        }
    }
    return j;
}

static json ParseStarTowerBuildBrief(ProtoReader r) {
    json j = obj();
    json chars = arr();
    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1: j["id"]   = r.fixed64();              break;
            case 2: j["name"] = r.str();                  break;
            case 3: j["lock"] = r.varint() != 0;          break;
            case 4: j["preference"] = r.varint() != 0;    break;
            case 5: j["score"]   = (uint32_t)r.varint();  break;
            case 6: j["discIds"] = r.packed_uint32();     break;
            case 7:
                if (wire == 2) chars.push_back(ParseTowerBuildChar(r.sub()));
                else r.skip(wire);
                break;
            case 8: j["starTowerId"] = (uint32_t)r.varint(); break;
            default: r.skip(wire); break;
        }
    }
    j["chars"] = chars;
    return j;
}

static json ParseStarTowerBuildDetail(ProtoReader r) {
    json j = obj();
    json potentials = arr(), subNotes = arr();
    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1:
                if (wire == 2) potentials.push_back(ParseBuildPotential(r.sub()));
                else r.skip(wire);
                break;
            case 2:
                if (wire == 2) subNotes.push_back(ParseItemTpl(r.sub()));
                else r.skip(wire);
                break;
            case 3: j["activeSecondaryIds"] = r.packed_uint32(); break;
            default: r.skip(wire); break;
        }
    }
    j["potentials"] = potentials;
    j["subNoteSkills"] = subNotes;
    return j;
}

static json ParseStarTowerBuildInfo(ProtoReader r) {
    json j = obj();
    int field, wire;
    while (r.tag(field, wire)) {
        if (field == 1 && wire == 2) {
            j["brief"] = ParseStarTowerBuildBrief(r.sub());
        } else if (field == 2 && wire == 2) {
            j["detail"] = ParseStarTowerBuildDetail(r.sub());
        } else if (field == 3) {
            j["buildCoin"] = (uint32_t)r.varint();
        } else {
            r.skip(wire);
        }
    }
    return j;
}

// =============================================================================
//  VictoryData
// =============================================================================
static json ParseVictoryData(ProtoReader r) {
    json j = obj();
    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1:  j["exp"]        = (uint32_t)r.varint(); break;
            case 2:  j["lv"]         = (uint32_t)r.varint(); break;
            case 10: j["battleTime"] = (uint32_t)r.varint(); break;
            default: r.skip(wire); break;
        }
    }
    return j;
}

// =============================================================================
//  NPCAffinityChange
// =============================================================================
static json ParseNPCAffinityChange(ProtoReader r) {
    json j = obj();
    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1: j["npcId"]    = (uint32_t)r.varint(); break;
            case 2: j["affinity"] = (uint32_t)r.varint(); break;
            default: r.skip(wire); break;
        }
    }
    return j;
}

// =============================================================================
//  Success (InteractSelectResp.Resp)
// =============================================================================
static json ParseSuccess(ProtoReader r) {
    json j = obj();
    json items = arr(), fateCards = arr(), subNotes = arr(), affinities = arr();
    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1:
                if (wire == 2) items.push_back(ParseItemTpl(r.sub()));
                else r.skip(wire);
                break;
            case 2: j["optionsResult"]  = r.varint() != 0;       break;
            case 3:
                if (wire == 2) fateCards.push_back(ParseFateCardInfo(r.sub()));
                else r.skip(wire);
                break;
            case 4:
                if (wire == 2) subNotes.push_back(ParseSubNoteSkillInfo(r.sub()));
                else r.skip(wire);
                break;
            case 5: j["optionsParamId"] = (uint32_t)r.varint();  break;
            case 6:
                if (wire == 2) affinities.push_back(ParseNPCAffinityChange(r.sub()));
                else r.skip(wire);
                break;
            default: r.skip(wire); break;
        }
    }
    j["items"] = items;
    j["fateCard"] = fateCards;
    j["subNoteSkills"] = subNotes;
    j["affinityChange"] = affinities;
    return j;
}

// =============================================================================
//  InteractSelectResp
// =============================================================================
static json ParseInteractSelectResp(ProtoReader r) {
    json j = obj();
    int field, wire;
    while (r.tag(field, wire)) {
        if (field == 1 && wire == 2) {
            j["resp"] = ParseSuccess(r.sub());
        } else if (field == 2 && wire == 2) {
            j["selectSpecialPotentialCase"] = ParseSelectSpecialPotentialCase(r.sub());
        } else if (field == 3 && wire == 2) {
            j["selectPotentialCase"] = ParseSelectPotentialCase(r.sub());
        } else if (field == 4 && wire == 2) {
            j["selectFateCardCase"] = ParseSelectPotentialCase(r.sub());
        } else if (field == 5 && wire == 2) {
            j["hawkerCase"] = ParseHawkerCase(r.sub());
        } else {
            r.skip(wire);
        }
    }
    return j;
}

// =============================================================================
//  SettleDataResp
// =============================================================================
static json ParseSettleDataResp(ProtoReader r) {
    json j = obj();
    json awards = arr(), rewards = arr(), items = arr();
    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1:
                if (wire == 2) j["change"] = ParseChangeInfo(r.sub());
                else r.skip(wire);
                break;
            case 2:
                if (wire == 2) j["build"] = ParseStarTowerBuildInfo(r.sub());
                else r.skip(wire);
                break;
            case 3:
                if (wire == 2) {
                    auto sub = r.sub();
                    json award = obj();
                    int af, aw;
                    while (sub.tag(af, aw)) {
                        if (af == 1) award["towerId"] = (uint32_t)sub.varint();
                        else if (af == 2) {
                            if (!award.contains("rewards")) award["rewards"] = arr();
                            award["rewards"].push_back(ParseItemTpl(sub.sub()));
                        } else sub.skip(aw);
                    }
                    awards.push_back(award);
                } else r.skip(wire);
                break;
            case 4: {
                auto sub = r.sub();
                json reward = obj();
                int rf, rw;
                while (sub.tag(rf, rw)) {
                    if (rf == 1) reward["npcId"] = (uint32_t)sub.varint();
                    else if (rf == 2) reward["level"] = (uint32_t)sub.varint();
                    else if (rf == 3) {
                        if (!reward.contains("rewards")) reward["rewards"] = arr();
                        reward["rewards"].push_back(ParseItemTpl(sub.sub()));
                    } else sub.skip(rw);
                }
                rewards.push_back(reward);
                break;
            }
            case 5:  j["npcInteraction"] = (uint32_t)r.varint(); break;
            case 14: j["totalTime"]      = (uint32_t)r.varint(); break;
            case 15: j["totalDamages"]   = r.packed_uint64();    break;
            case 6:
                if (wire == 2) items.push_back(ParseItemTpl(r.sub()));
                else r.skip(wire);
                break;
            default: r.skip(wire); break;
        }
    }
    j["awards"] = awards;
    j["reward"] = rewards;
    j["towerRewards"] = items;
    return j;
}

// =============================================================================
//  Request parsers
// =============================================================================
static void LogStarTowerReq(int16_t sendId, System_Byte_array* body) {
    if (!body || body->max_length == 0) {
        json j = obj();
        j["msgId"] = (int)sendId;
        LogStarJson("SEND", j);
        return;
    }

    auto r = MakeReader(body);

    if (sendId == 4601) {
        // StarTowerApplyReq
        json j = obj();
        j["msgId"] = 4601;
        int field, wire;
        while (r.tag(field, wire)) {
            switch (field) {
                case 1:  j["towerId"]      = (uint32_t)r.varint(); break;
                case 2:  j["formationId"]  = (uint32_t)r.varint(); break;
                case 3:  j["charHp"]       = (uint32_t)r.varint(); break;
                case 4:  j["mapId"]        = (uint32_t)r.varint(); break;
                case 5:  j["paramId"]      = (uint32_t)r.varint(); break;
                case 6:  j["mapParam"]     = r.str();              break;
                case 7:  j["mapTableId"]   = (uint32_t)r.varint(); break;
                case 15: j["sweep"]        = r.varint() != 0;      break;
                default: r.skip(wire); break;
            }
        }
        LogStarJson("SEND", j);

    } else if (sendId == 4607) {
        // StarTowerInteractReq
        json j = obj();
        j["msgId"] = 4607;
        int field, wire;
        while (r.tag(field, wire)) {
            if (field == 1) {
                j["caseId"] = (uint32_t)r.varint();
            } else if (wire == 2) {
                switch (field) {
                    case 2: { // EnterReq
                        json enter = obj();
                        auto sr = r.sub();
                        int ef, ew;
                        while (sr.tag(ef, ew)) {
                            switch (ef) {
                                case 1: enter["mapId"]      = (uint32_t)sr.varint(); break;
                                case 2: enter["paramId"]    = (uint32_t)sr.varint(); break;
                                case 3: enter["dateLen"]    = (uint32_t)sr.varint(); break;
                                case 4: enter["clientData"] = sr.str();              break;
                                case 5: enter["mapParam"]   = sr.str();              break;
                                case 6: enter["mapTableId"] = (uint32_t)sr.varint(); break;
                                case 7: enter["dataVersion"]= (uint32_t)sr.varint(); break;
                                default: sr.skip(ew); break;
                            }
                        }
                        j["action"] = "enter";
                        j["enter"] = enter;
                        break;
                    }
                    case 3: { // BattleEndReq
                        json battle = obj();
                        auto sr = r.sub();
                        int bf, bw;
                        while (sr.tag(bf, bw)) {
                            switch (bf) {
                                case 2: battle["defeat"] = sr.varint() != 0; break;
                                case 1:
                                    if (bw == 2) {
                                        auto vict = sr.sub();
                                        json victJson = ParseVictoryData(vict);
                                        battle["victory"] = victJson;
                                    } else sr.skip(bw);
                                    break;
                                default: sr.skip(bw); break;
                            }
                        }
                        j["action"] = "battleEnd";
                        j["battle"] = battle;
                        break;
                    }
                    case 4: { // SelectReq
                        json sel = obj();
                        auto sr = r.sub();
                        int sf, sw;
                        while (sr.tag(sf, sw)) {
                            switch (sf) {
                                case 1: sel["index"]  = (uint32_t)sr.varint(); break;
                                case 2: sel["reRoll"] = sr.varint() != 0;      break;
                                default: sr.skip(sw); break;
                            }
                        }
                        j["action"] = "select";
                        j["select"] = sel;
                        break;
                    }
                    case 5: { // RecoveryHPReq
                        json rec = obj();
                        auto sr = r.sub();
                        int rf, rw;
                        while (sr.tag(rf, rw)) {
                            switch (rf) {
                                case 1: rec["hp"] = (uint32_t)sr.varint(); break;
                                default: sr.skip(rw); break;
                            }
                        }
                        j["action"] = "recoveryHP";
                        j["recoveryHP"] = rec;
                        break;
                    }
                    case 6: { // HawkerReq
                        json hawk = obj();
                        auto sr = r.sub();
                        int hf, hw;
                        while (sr.tag(hf, hw)) {
                            switch (hf) {
                                case 1: hawk["sid"]    = (uint32_t)sr.varint(); break;
                                case 2: hawk["reRoll"] = sr.varint() != 0;      break;
                                default: sr.skip(hw); break;
                            }
                        }
                        j["action"] = "hawker";
                        j["hawker"] = hawk;
                        break;
                    }
                    default: r.skip(wire); break;
                }
            } else {
                r.skip(wire);
            }
        }
        LogStarJson("SEND", j);

    } else {
        // 4610 (info_req) or 4613 (give_up_req) — empty
        json j = obj();
        j["msgId"] = (int)sendId;
        LogStarJson("SEND", j);
    }
}

// =============================================================================
//  Response parsers
// =============================================================================
static void LogStarTowerApplyResp(System_Byte_array* body) {
    if (!body || body->max_length == 0) return;
    auto r = MakeReader(body);

    json j = obj();
    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1:
                if (wire == 2) {
                    auto& infoJson = j["info"];
                    infoJson = ParseStarTowerInfo(r.sub());
                    // Flatten key meta/room info to top level for convenience
                    if (infoJson.contains("meta")) {
                        j["teamLevel"] = infoJson["meta"].value("teamLevel", 0u);
                        j["charHp"]    = infoJson["meta"].value("charHp", 0u);
                        j["chars"]     = infoJson["meta"].value("chars", arr());
                        j["discs"]     = infoJson["meta"].value("discs", arr());
                        j["activeSecondaryIds"] = infoJson["meta"].value("activeSecondaryIds", arr());
                        j["towerGrowthNodes"]   = infoJson["meta"].value("towerGrowthNodes", arr());
                    }
                    if (infoJson.contains("room") && infoJson["room"].contains("data")) {
                        j["floor"]    = infoJson["room"]["data"].value("floor", 0u);
                        j["roomType"] = infoJson["room"]["data"].value("roomType", 0u);
                    }
                } else r.skip(wire);
                break;
            case 2: j["towerId"]     = (uint32_t)r.varint(); break;
            case 4: j["coinQty"]     = (uint32_t)r.varint(); break;
            case 5:
                if (wire == 2) {
                    if (!j.contains("infos")) j["infos"] = arr();
                    j["infos"].push_back(ParseSubNoteSkillInfo(r.sub()));
                } else r.skip(wire);
                break;
            case 15:
                if (wire == 2) j["change"] = ParseChangeInfo(r.sub());
                else r.skip(wire);
                break;
            default: r.skip(wire); break;
        }
    }
    LogStarJson("RUN", j);
}

static void LogStarTowerInteractResp(System_Byte_array* body) {
    if (!body || body->max_length == 0) return;
    auto r = MakeReader(body);

    json j = obj();
    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1: j["caseId"] = (uint32_t)r.varint(); break;
            case 2:
                if (wire == 2) {
                    if (!j.contains("cases")) j["cases"] = arr();
                    j["cases"].push_back(ParseOneRoomCase(r.sub()));
                } else r.skip(wire);
                break;
            case 3:
                if (wire == 2) j["change"] = ParseChangeInfo(r.sub());
                else r.skip(wire);
                break;
            case 4:
                if (wire == 2) j["data"] = ParseTowerChangeData(r.sub());
                else r.skip(wire);
                break;
            case 7:
                if (wire == 2) {
                    j["action"] = "enter";
                    auto sr = r.sub();
                    int ef, ew;
                    while (sr.tag(ef, ew)) {
                        if (ef == 1 && ew == 2) j["room"] = ParseStarTowerRoom(sr.sub());
                        else sr.skip(ew);
                    }
                } else r.skip(wire);
                break;
            case 8:
                if (wire == 2) {
                    j["action"] = "battle";
                    auto sr = r.sub();
                    int bf, bw;
                    while (sr.tag(bf, bw)) {
                        if (bf == 1 && bw == 2) {
                            j["victory"] = true;
                            auto v = ParseVictoryData(sr.sub());
                            j["exp"] = v.value("exp", 0u);
                            j["level"] = v.value("lv", 0u);
                            j["battleTime"] = v.value("battleTime", 0u);
                        } else if (bf == 2) {
                            j["defeat"] = sr.varint() != 0;
                        } else {
                            sr.skip(bw);
                        }
                    }
                } else r.skip(wire);
                break;
            case 9:
                if (wire == 2) {
                    j["action"] = "select";
                    j["selectResp"] = ParseInteractSelectResp(r.sub());
                } else r.skip(wire);
                break;
            case 10:
                if (wire == 2) {
                    j["action"] = "strengthen";
                    auto sr = r.sub();
                    int sf, sw;
                    while (sr.tag(sf, sw)) {
                        switch (sf) {
                            case 1: j["buySucceed"] = sr.varint() != 0; break;
                            default: sr.skip(sw); break;
                        }
                    }
                } else r.skip(wire);
                break;
            case 14:
                if (wire == 2) {
                    j["action"] = "settle";
                    j["settle"] = ParseSettleDataResp(r.sub());
                } else r.skip(wire);
                break;
            case 15: j["nil"] = true; r.skip(wire); break;
            default: r.skip(wire); break;
        }
    }
    LogStarJson("RECV", j);
}

static void LogStarTowerGiveUpResp(System_Byte_array* body) {
    if (!body || body->max_length == 0) return;
    auto r = MakeReader(body);

    json j = obj();
    json rewards = arr();
    int field, wire;
    while (r.tag(field, wire)) {
        switch (field) {
            case 1:
                if (wire == 2) j["change"] = ParseChangeInfo(r.sub());
                else r.skip(wire);
                break;
            case 2:
                if (wire == 2) j["build"] = ParseStarTowerBuildInfo(r.sub());
                else r.skip(wire);
                break;
            case 3: {
                auto sr = r.sub();
                json rew = obj();
                int rf, rw;
                while (sr.tag(rf, rw)) {
                    if (rf == 1) rew["npcId"] = (uint32_t)sr.varint();
                    else if (rf == 2) rew["level"] = (uint32_t)sr.varint();
                    else if (rf == 3) {
                        if (!rew.contains("rewards")) rew["rewards"] = arr();
                        rew["rewards"].push_back(ParseItemTpl(sr.sub()));
                    } else sr.skip(rw);
                }
                rewards.push_back(rew);
                break;
            }
            case 4:  j["npcInteraction"] = (uint32_t)r.varint(); break;
            case 5:
                if (wire == 2) {
                    if (!j.contains("towerRewards")) j["towerRewards"] = arr();
                    j["towerRewards"].push_back(ParseItemTpl(r.sub()));
                } else r.skip(wire);
                break;
            case 12: j["floor"]  = (uint32_t)r.varint(); break;
            case 13: j["potentialCnt"] = (uint32_t)r.varint(); break;
            case 14: j["totalTime"]    = (uint32_t)r.varint(); break;
            case 15: j["totalDamages"] = r.packed_uint64();    break;
            default: r.skip(wire); break;
        }
    }
    j["reward"] = rewards;
    LogStarJson("END", j);
}

// =============================================================================
//  HandleStarTowerMsg — entry point called from http_hooks.cpp
// =============================================================================
void HandleStarTowerMsg(int16_t recvMsgId, HttpNetMsg_o* recvMsg, HttpNetMsg_o* sendMsg) {
    // Log the request first
    if (sendMsg && sendMsg->fields.msgBody) {
        LogStarTowerReq(sendMsg->fields.msgId, sendMsg->fields.msgBody);
    }

    // Log the response
    if (recvMsg && recvMsg->fields.msgBody) {
        switch (recvMsgId) {
            case 4602: LogStarTowerApplyResp(recvMsg->fields.msgBody);   break;
            case 4608: LogStarTowerInteractResp(recvMsg->fields.msgBody); break;
            case 4611: /* skip poll */                                    break;
            case 4614: LogStarTowerGiveUpResp(recvMsg->fields.msgBody);   break;
        }
    }
}
