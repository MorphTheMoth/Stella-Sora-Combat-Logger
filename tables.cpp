// =============================================================================
//  tables.cpp — HitDamage / Effect lookup table construction
// =============================================================================
#include <cstdint>
#include <cstdio>
#include <array>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>
#include "json.hpp"

using json = nlohmann::json;

// Forward declaration — defined in proxy.cpp
void Log(const char* fmt, ...);

#include "tables.h"

// Definitions (extern declarations are in tables.h)
std::unordered_map<int32_t, HitInfo>     g_HitTable;
std::unordered_map<int32_t, std::string> g_CharMap;
std::unordered_map<int32_t, EffectInfo>  g_EffectTable;
std::unordered_set<int32_t>              g_SuppressedEffects;
std::unordered_map<int32_t, std::string> g_ActorNameMap;
std::unordered_map<int32_t, SkillInfo>   g_SkillTable;

// =============================================================================
//  Shared prefixes used across multiple passes
// =============================================================================

static const std::array<std::string, 4> kBuffPrefixes = {
    "Buff,LevelUp,",
    "Effect,LevelUp,",
    "EffectValue,NoLevel,",
    "BuffValue,NoLevel,",
};

static const std::string kHitDamagePrefix = "HitDamage,DamageNum,";

// =============================================================================
//  Low-level helpers
// =============================================================================

// Read an entire file into a string. Returns false if the file can't be opened.
static bool ReadFile(const std::string& path, std::string& out) {
    FILE* f = fopen(path.c_str(), "rb");
    if (!f) return false;
    fseek(f, 0, SEEK_END);
    long sz = ftell(f);
    rewind(f);
    out.resize(sz);
    fread(out.data(), 1, sz, f);
    fclose(f);
    return true;
}

// Read and parse a JSON file. Returns a discarded json on any failure and logs the error.
static json LoadJson(const std::string& path, const char* tag) {
    std::string raw;
    if (!ReadFile(path, raw)) {
        Log("%s %s not found", tag, path.c_str());
        return json::parse("", nullptr, false); // discarded
    }
    json j = json::parse(raw, nullptr, false);
    if (j.is_discarded())
        Log("%s %s parse error", tag, path.c_str());
    return j;
}

// Read and parse a pair of files (data + language). Returns false if either fails.
// On failure both output jsons are left in a discarded state.
static bool LoadJsonPair(const std::string& dataPath, const std::string& langPath,
                         const char* tag, json& jData, json& jLang) {
    jData = LoadJson(dataPath, tag);
    if (jData.is_discarded()) return false;
    jLang = LoadJson(langPath, tag);
    return !jLang.is_discarded();
}

// =============================================================================
//  Domain helpers
// =============================================================================

// Look up a character name from jChar by integer ID. Returns "?" if not found.
static std::string CharName(const json& jChar, int32_t charId) {
    auto it = jChar.find(std::to_string(charId));
    if (it != jChar.end() && it->contains("name"))
        return (*it)["name"].get<std::string>();
    return "?";
}

// Resolve a localisation key stored at jObj[field] against a language map.
// Returns "?" if the field or the key is absent.
static std::string ResolveLocKey(const json& jObj, const std::string& field,
                                 const json& jLang) {
    if (!jObj.contains(field)) return "?";
    std::string key = jObj[field].get<std::string>();
    auto it = jLang.find(key);
    return (it != jLang.end()) ? it->get<std::string>() : "?";
}

// Extract the ID token from a prefixed param string like "Buff,LevelUp,<id>[,...]".
// Returns 0 on failure.
static int32_t ExtractPrefixedId(const std::string& param, const std::string& prefix) {
    if (param.rfind(prefix, 0) != 0) return 0;
    size_t start = prefix.size();
    size_t comma = param.find(',', start);
    std::string idStr = (comma == std::string::npos)
                        ? param.substr(start)
                        : param.substr(start, comma - start);
    try { return std::stoi(idStr); } catch (...) { return 0; }
}

// Iterate ParamN fields (Param1, Param2, …) of a JSON object, calling visitor
// for each value until no more ParamN fields exist.
// visitor signature: bool(const std::string& paramValue)  — return true to stop early.
template<typename Visitor>
static void ForEachParam(const json& jObj, Visitor&& visitor) {
    for (int n = 1; ; ++n) {
        std::string key = "Param" + std::to_string(n);
        if (!jObj.contains(key)) break;
        if (visitor(jObj[key].get<std::string>())) break;
    }
}

// For each ParamN in jObj, check whether it matches any of kBuffPrefixes and
// extract the embedded ID. Calls onMatch(prefix, effId) for the first matching
// prefix found in each param. All params are always visited; onMatch's return
// value only stops checking further prefixes for that one param (mirroring the
// original inner-loop break).
template<typename OnMatch>
static void ForEachBuffParam(const json& jObj, OnMatch&& onMatch) {
    ForEachParam(jObj, [&](const std::string& param) -> bool {
        for (const std::string& prefix : kBuffPrefixes) {
            int32_t id = ExtractPrefixedId(param, prefix);
            if (id) { onMatch(prefix, id); break; } // break prefix loop, not param loop
        }
        return false; // always continue to next param
    });
}
// Insert an effect into g_EffectTable only if it isn't already there (or is
// unresolved — label == "?").
static void InsertEffect(int32_t id, const std::string& charName,
                         const std::string& label, int ldt,
                         bool overwriteUnresolved = false) {
    auto it = g_EffectTable.find(id);
    if (it == g_EffectTable.end()) {
        g_EffectTable[id] = { charName, label, ldt };
    } else if (overwriteUnresolved && it->second.label == "?") {
        it->second = { charName, label, ldt };
    }
}

// =============================================================================
//  ActorDisplayName
// =============================================================================

const std::string& ActorDisplayName(int32_t id) {
    static const std::string kUnknown = "?";
    auto it = g_ActorNameMap.find(id);
    return (it != g_ActorNameMap.end()) ? it->second : kUnknown;
}

// =============================================================================
//  BuildEffectTable — forward declaration (defined after BuildSkillTable)
// =============================================================================

static void BuildSkillTable(const std::string& dataRoot, const json& jChar);
static void BuildEffectTable(const std::string& dataRoot,
                              const json& jSkill, const json& jSkillLang,
                              const json& jChar,  const json& jPotential);

// =============================================================================
//  BuildEffectTable helpers
// =============================================================================

// Pre-build a set of effect IDs found in an array field of every entry in jSource,
// and also add them to g_SuppressedEffects.
static void CollectAndSuppressEffectIds(const json& jSource, const std::string& arrayField,
                                        std::unordered_set<int32_t>& out) {
    for (auto& [key, val] : jSource.items()) {
        if (!val.contains(arrayField)) continue;
        for (auto& idVal : val[arrayField]) {
            int32_t id = idVal.get<int32_t>();
            out.insert(id);
            g_SuppressedEffects.insert(id);
        }
    }
}

// Build a map: buffId -> skill title, by scanning every skill's ParamN for kBuffPrefixes.
static std::unordered_map<int32_t, std::string>
BuildBuffIdToSkillTitle(const json& jSkill, const json& jSkillLang) {
    std::unordered_map<int32_t, std::string> result;
    for (auto& [skey, sval] : jSkill.items()) {
        ForEachBuffParam(sval, [&](const std::string& /*prefix*/, int32_t buffId) {
            if (result.count(buffId) == 0)
                result[buffId] = ResolveLocKey(sval, "Title", jSkillLang);
        });
    }
    return result;
}

// Build a reverse map: effectId -> MainSkill localised name, from jMainSkill EffectId arrays.
static std::unordered_map<int32_t, std::string>
BuildEffectIdToDiscName(const json& jMainSkill, const json& jMainSkillLang) {
    std::unordered_map<int32_t, std::string> result;
    for (auto& [msKey, msVal] : jMainSkill.items()) {
        if (!msVal.contains("EffectId") || !msVal.contains("Name")) continue;
        std::string discName = ResolveLocKey(msVal, "Name", jMainSkillLang);
        for (auto& effIdVal : msVal["EffectId"])
            result[effIdVal.get<int32_t>()] = discName;
    }
    return result;
}

// Generic "source pass": iterate jSource entries, resolve a display name via
// nameResolver(entry) -> string, then walk ParamN fields for buff-prefixed IDs
// and insert into g_EffectTable with the given label prefix.
// Skips entries where name resolves to "?".
template<typename NameResolver>
static int SourcePass(const json& jSource, const std::string& labelPrefix,
                      NameResolver&& nameResolver, int ldt = 0) {
    int count = 0;
    for (auto& [key, val] : jSource.items()) {
        std::string name = nameResolver(val);
        if (name == "?") continue;
        std::string fullLabel = labelPrefix.empty() ? name : labelPrefix + name;

        ForEachBuffParam(val, [&](const std::string& /*prefix*/, int32_t effId) {
            if (!effId || g_EffectTable.count(effId)) return;
            g_EffectTable[effId] = { "?", fullLabel, ldt };
            ++count;
        });
    }
    return count;
}

// =============================================================================
//  BuildEffectTable
// =============================================================================

static void BuildEffectTable(const std::string& dataRoot,
                              const json& jSkill, const json& jSkillLang,
                              const json& jChar,  const json& jPotential)
{
    // --- Load required files ------------------------------------------------
    const std::string binPath  = dataRoot + "/EN/bin/";
    const std::string langPath = dataRoot + "/EN/language/en_US/";

    json jEffect        = LoadJson(binPath  + "Effect.json",        "[effect]");
    json jItem          = LoadJson(binPath  + "Item.json",          "[effect]");
    json jItemLang      = LoadJson(langPath + "Item.json",          "[effect]");
    json jMainSkill     = LoadJson(binPath  + "MainSkill.json",     "[effect]");
    json jMainSkillLang = LoadJson(langPath + "MainSkill.json",     "[effect]");
    json jFloorBuff     = LoadJson(binPath  + "FloorBuff.json",     "[effect]");
    json jSubNote       = LoadJson(binPath  + "SubNoteSkill.json",  "[effect]");
    json jAffinityLevel = LoadJson(binPath  + "AffinityLevel.json", "[effect]");

    if (jEffect.is_discarded()    || jItem.is_discarded()     || jItemLang.is_discarded() ||
        jMainSkill.is_discarded() || jMainSkillLang.is_discarded() ||
        jFloorBuff.is_discarded() || jSubNote.is_discarded()  || jAffinityLevel.is_discarded())
        return;

    // --- Pre-build suppression sets -----------------------------------------
    std::unordered_set<int32_t> subNoteEffectIds;
    CollectAndSuppressEffectIds(jSubNote,       "EffectId", subNoteEffectIds);

    std::unordered_set<int32_t> affinityEffectIds;
    CollectAndSuppressEffectIds(jAffinityLevel, "Effect",   affinityEffectIds);

    // --- Pre-build buff-id -> skill title map --------------------------------
    auto buffIdToSkillTitle = BuildBuffIdToSkillTitle(jSkill, jSkillLang);

    // --- Direct pass: effect IDs referenced in Skill.json with no levelTypeData
    for (auto& [skey, sval] : jSkill.items()) {
        std::string skillTitle = ResolveLocKey(sval, "Title", jSkillLang);

        int32_t charId = 0;
        try { charId = std::stoi(skey) / 100000; } catch (...) {}
        std::string charName = CharName(jChar, charId);

        ForEachBuffParam(sval, [&](const std::string& /*prefix*/, int32_t effId) {
            if (!effId || g_EffectTable.count(effId)) return;
            g_EffectTable[effId] = { charName, skillTitle, 3 };
        });
    }

    // --- Main Effect.json loop ----------------------------------------------
    int built = 0;
    for (auto& [key, effEntry] : jEffect.items()) {
        if (!effEntry.contains("levelTypeData")) continue;
        int32_t configId = std::stoi(key);
        int ldt = effEntry["levelTypeData"].get<int>();

        if (ldt == 5 && subNoteEffectIds.count(configId))  continue;
        if (affinityEffectIds.count(configId))              continue;

        std::string charName = CharName(jChar, configId / 100000);
        std::string label    = "?";

        if (ldt == 1 && effEntry.contains("LevelData")) {
            int32_t levelData = effEntry["LevelData"].get<int32_t>();
            auto iit = jItem.find(std::to_string(levelData));
            if (iit != jItem.end())
                label = ResolveLocKey(*iit, "Title", jItemLang);
        } else if (ldt == 3) {
            auto tit = buffIdToSkillTitle.find(configId);
            if (tit != buffIdToSkillTitle.end())
                label = tit->second;
        }

        g_EffectTable[configId] = { charName, label, ldt };
        ++built;
    }

    // --- MainSkill fallback pass --------------------------------------------
    int discBuilt = 0;
    for (auto& [msKey, msVal] : jMainSkill.items()) {
        if (!msVal.contains("EffectId") || !msVal.contains("Name")) continue;
        std::string discLabel = ResolveLocKey(msVal, "Name", jMainSkillLang);
        if (discLabel != "?") discLabel = "Disc: " + discLabel;

        for (auto& effIdVal : msVal["EffectId"]) {
            int32_t effId = effIdVal.get<int32_t>();
            InsertEffect(effId, "?", discLabel, 0, /*overwriteUnresolved=*/true);
            ++discBuilt;
        }
    }

    // --- EffectValue.json pass ----------------------------------------------
    {
        json jEffectValue = LoadJson(binPath + "EffectValue.json", "[effect]");
        if (!jEffectValue.is_discarded()) {
            auto effectIdToDiscName = BuildEffectIdToDiscName(jMainSkill, jMainSkillLang);

            for (auto& [evKey, evVal] : jEffectValue.items()) {
                int32_t evId = std::stoi(evKey);
                for (int n = 1; ; ++n) {
                    std::string paramKey = "EffectTypeParam" + std::to_string(n);
                    if (!evVal.contains(paramKey)) break;
                    int32_t referencedId = 0;
                    try { referencedId = std::stoi(evVal[paramKey].get<std::string>()); }
                    catch (...) { continue; }
                    if (!referencedId || g_EffectTable.count(referencedId)) continue;

                    auto dit = effectIdToDiscName.find(evId);
                    if (dit != effectIdToDiscName.end() && dit->second != "?") {
                        g_EffectTable[referencedId] = { "?", "Disc: " + dit->second, 0 };
                        ++discBuilt;
                    }
                }
            }
        }
    }

    // --- TravelerDuelChallengeAffix pass ------------------------------------
    {
        json jAffix, jAffixLang;
        if (LoadJsonPair(binPath  + "TravelerDuelChallengeAffix.json",
                         langPath + "TravelerDuelChallengeAffix.json",
                         "[effect]", jAffix, jAffixLang)) {
            auto nameResolver = [&](const json& val) {
                return ResolveLocKey(val, "Name", jAffixLang);
            };
            int n = SourcePass(jAffix, "Affix: ", nameResolver);
            Log("[effect] Built affix entries: %d", n);
        }
    }

    // --- FloorBuff suppression ----------------------------------------------
    for (auto& [fbKey, fbVal] : jFloorBuff.items()) {
        if (!fbVal.contains("EffectId")) continue;
        for (auto& effIdVal : fbVal["EffectId"])
            g_SuppressedEffects.insert(effIdVal.get<int32_t>());
    }

    // --- CharGemAttrValue (Emblems) suppression -----------------------------
    {
        json jGem = LoadJson(binPath + "CharGemAttrValue.json", "[effect]");
        if (!jGem.is_discarded()) {
            for (auto& [gkey, gval] : jGem.items()) {
                if (gval.contains("EffectId"))
                    g_SuppressedEffects.insert(gval["EffectId"].get<int32_t>());
            }
        }
    }

    // --- Monster buff suppression -------------------------------------------
    {
        json jBuffVal = LoadJson(binPath + "BuffValue.json", "[effect]");
        if (!jBuffVal.is_discarded()) {
            std::unordered_map<int32_t, std::vector<int32_t>> buffValEffects;
            for (auto& [bvKey, bvVal] : jBuffVal.items()) {
                if (!bvVal.contains("Effects")) continue;
                int32_t bvId = std::stoi(bvKey);
                for (auto& effIdVal : bvVal["Effects"])
                    buffValEffects[bvId].push_back(effIdVal.get<int32_t>());
            }

            json jMonster = LoadJson(binPath + "Monster.json", "[effect]");
            if (!jMonster.is_discarded()) {
                for (auto& [mKey, mVal] : jMonster.items()) {
                    if (!mVal.contains("BuffIds")) continue;
                    for (auto& buffIdVal : mVal["BuffIds"]) {
                        auto bit = buffValEffects.find(buffIdVal.get<int32_t>());
                        if (bit != buffValEffects.end())
                            for (int32_t effId : bit->second)
                                g_SuppressedEffects.insert(effId);
                    }
                }
            }
        }
    }

    // --- Buff.json pass -----------------------------------------------------
    {
        json jBuff = LoadJson(binPath + "Buff.json", "[effect]");
        if (!jBuff.is_discarded()) {
            // Reverse map: buffId -> { potKey, charId }
            struct PotRef { std::string potKey; int32_t charId; };
            std::unordered_map<int32_t, PotRef> buffIdToPotRef;

            static const std::string kBVPrefix = "BuffValue,NoLevel,";
            if (!jPotential.is_discarded()) {
                for (auto& [potKey, potVal] : jPotential.items()) {
                    int32_t charId = potVal.contains("CharId")
                                     ? potVal["CharId"].get<int32_t>() : 0;
                    ForEachParam(potVal, [&](const std::string& param) -> bool {
                        int32_t buffId = ExtractPrefixedId(param, kBVPrefix);
                        if (buffId && !buffIdToPotRef.count(buffId))
                            buffIdToPotRef[buffId] = { potKey, charId };
                        return false;
                    });
                }
            }

            json jItemRoot = LoadJson(dataRoot + "/item.json", "[effect]");
            json jDisc     = LoadJson(dataRoot + "/disc.json",  "[effect]");
            int buffBuilt = 0;

            // Pre-build disc icon map: "214004" -> label, for Icon_DiscBuff_ lookups.
            // mainSkill    -> "Disc: <discName>"
            // secondarySkillN -> "Disc-Harmony: <discName> - <skillName>"
            static const std::string kDiscBufPrefix = "Icon/Buff/Icon_DiscBuff_";
            std::unordered_map<std::string, std::string> discIconToLabel;
            if (!jDisc.is_discarded()) {
                static const std::array<std::string, 4> kSecFields = {
                    "secondarySkill1", "secondarySkill2", "secondarySkill3", "secondarySkill4"
                };
                // Helper: extract the numeric suffix after the last '_' in an icon string.
                auto iconSuffix = [](const std::string& s) -> std::string {
                    size_t pos = s.rfind('_');
                    return (pos != std::string::npos) ? s.substr(pos + 1) : s;
                };
                for (auto& [dkey, dval] : jDisc.items()) {
                    std::string discName = dval.contains("name")
                                           ? dval["name"].get<std::string>() : "?";
                    if (discName == "?") continue;

                    // Both the Buff Icon and the disc skill icon share the same numeric
                    // suffix (e.g. "214004"), so key the map on that.
                    if (dval.contains("mainSkill")) {
                        const auto& ms = dval["mainSkill"];
                        if (ms.contains("icon"))
                            discIconToLabel[iconSuffix(ms["icon"].get<std::string>())]
                                = "Disc: " + discName;
                    }
                    for (const std::string& field : kSecFields) {
                        if (!dval.contains(field)) continue;
                        const auto& ss = dval[field];
                        if (!ss.contains("icon")) continue;
                        std::string skillName = ss.contains("name")
                                                ? ss["name"].get<std::string>() : "?";
                        if (skillName == "?") continue;
                        discIconToLabel[iconSuffix(ss["icon"].get<std::string>())]
                            = "Disc-Harmony: " + discName + " - " + skillName;
                    }
                }
            }

            for (auto& [bkey, bval] : jBuff.items()) {
                int32_t buffId = 0;
                try { buffId = std::stoi(bkey); } catch (...) { continue; }
                if (!buffId || g_EffectTable.count(buffId)) continue;

                // Path 1: Potential reverse-map lookup (existing behaviour)
                {
                    auto pit = buffIdToPotRef.find(buffId);
                    if (pit != buffIdToPotRef.end()) {
                        std::string label    = "?";
                        std::string charName = "?";
                        if (!jItemRoot.is_discarded()) {
                            auto iit = jItemRoot.find(pit->second.potKey);
                            if (iit != jItemRoot.end() && iit->contains("name"))
                                label = (*iit)["name"].get<std::string>();
                        }
                        if (label != "?") {
                            if (pit->second.charId)
                                charName = CharName(jChar, pit->second.charId);
                            g_EffectTable[buffId] = { charName, label, -1 };
                            ++buffBuilt;
                            continue;
                        }
                    }
                }

                // Path 2: Icon_DiscBuff_ lookup — match numeric suffix against disc skill icons
                if (bval.contains("Icon")) {
                    std::string icon = bval["Icon"].get<std::string>();
                    if (icon.rfind(kDiscBufPrefix, 0) == 0) {
                        std::string suffix = icon.substr(kDiscBufPrefix.size());
                        auto dit = discIconToLabel.find(suffix);
                        if (dit != discIconToLabel.end()) {
                            g_EffectTable[buffId] = { "?", dit->second, -1 };
                            ++buffBuilt;
                        }
                    }
                }
            }
            Log("[effect] Built buff entries: %d", buffBuilt);
        }
    }

    // --- BuffValue.json pass (via Potential kBuffPrefixes) ------------------
    // BuffValue entries (e.g. 11051011) whose Effects[] IDs appear in Potential
    // ParamN via kBuffPrefixes. The BuffValue configId itself is what gets logged,
    // and the label comes from item.json keyed by the Potential entry that
    // references the child effect ID.
    {
        json jBuffValue = LoadJson(binPath + "BuffValue.json", "[effect]");
        if (!jBuffValue.is_discarded() && !jPotential.is_discarded()) {
            // Reverse map: effectId (from kBuffPrefixes) -> { potKey, charId }
            struct PotRef { std::string potKey; int32_t charId; };
            std::unordered_map<int32_t, PotRef> effectIdToPotRef;
            for (auto& [potKey, potVal] : jPotential.items()) {
                int32_t charId = potVal.contains("CharId")
                                 ? potVal["CharId"].get<int32_t>() : 0;
                ForEachBuffParam(potVal, [&](const std::string& /*prefix*/, int32_t effId) {
                    if (effId && !effectIdToPotRef.count(effId))
                        effectIdToPotRef[effId] = { potKey, charId };
                });
            }

            json jItemRoot = LoadJson(dataRoot + "/item.json", "[effect]");
            int bvBuilt = 0;

            for (auto& [bvKey, bvVal] : jBuffValue.items()) {
                int32_t bvId = 0;
                try { bvId = std::stoi(bvKey); } catch (...) { continue; }
                if (!bvId || g_EffectTable.count(bvId)) continue;
                if (!bvVal.contains("Effects")) continue;

                // Check if any child effect ID is referenced by a Potential entry
                for (auto& effIdVal : bvVal["Effects"]) {
                    int32_t effId = effIdVal.get<int32_t>();
                    auto pit = effectIdToPotRef.find(effId);
                    if (pit == effectIdToPotRef.end()) continue;

                    std::string label    = "?";
                    std::string charName = "?";
                    if (!jItemRoot.is_discarded()) {
                        auto iit = jItemRoot.find(pit->second.potKey);
                        if (iit != jItemRoot.end() && iit->contains("name"))
                            label = (*iit)["name"].get<std::string>();
                    }
                    if (label == "?") continue;

                    if (pit->second.charId)
                        charName = CharName(jChar, pit->second.charId);

                    g_EffectTable[bvId] = { charName, label, -1 };
                    ++bvBuilt;
                    break; // first matched child effect is enough
                }
            }
            Log("[effect] Built BuffValue-via-Potential entries: %d", bvBuilt);
        }
    }

    // --- Potential.json pass (effect IDs in ParamN) -------------------------
    {
        json jItemRoot = LoadJson(dataRoot + "/item.json", "[effect]");
        if (!jPotential.is_discarded() && !jItemRoot.is_discarded()) {
            for (auto& [potKey, potVal] : jPotential.items()) {
                std::string charName = potVal.contains("CharId")
                    ? CharName(jChar, potVal["CharId"].get<int32_t>()) : "?";

                ForEachBuffParam(potVal, [&](const std::string& /*prefix*/, int32_t effId) {
                    if (!effId || g_EffectTable.count(effId)) return;
                    std::string label = "?";
                    auto iit = jItemRoot.find(potKey);
                    if (iit != jItemRoot.end() && iit->contains("name"))
                        label = (*iit)["name"].get<std::string>();
                    g_EffectTable[effId] = { charName, label, -1 };
                });
            }
        }
    }

    // --- Word.json pass -----------------------------------------------------
    {
        json jWord, jWordLang;
        if (LoadJsonPair(binPath  + "Word.json",
                         langPath + "Word.json",
                         "[effect]", jWord, jWordLang)) {
            auto nameResolver = [&](const json& val) {
                return ResolveLocKey(val, "Title", jWordLang);
            };
            int n = SourcePass(jWord, "Word: ", nameResolver);
            Log("[effect] Built word entries: %d", n);
        }
    }

    // --- Talent.json pass ---------------------------------------------------
    {
        json jTalent, jTalentLang;
        if (LoadJsonPair(binPath  + "Talent.json",
                         langPath + "Talent.json",
                         "[effect]", jTalent, jTalentLang)) {
            int talentBuilt = 0;
            for (auto& [tkey, tval] : jTalent.items()) {
                std::string talentTitle = ResolveLocKey(tval, "Title", jTalentLang);
                if (talentTitle == "?") continue;

                int32_t charId = 0;
                try { charId = std::stoi(tkey) / 10000; } catch (...) {}
                std::string charName = CharName(jChar, charId);

                ForEachBuffParam(tval, [&](const std::string& /*prefix*/, int32_t effId) {
                    if (!effId || g_EffectTable.count(effId)) return;
                    g_EffectTable[effId] = { charName, "Talent: " + talentTitle, 0 };
                    ++talentBuilt;
                });
            }
            Log("[effect] Built talent entries: %d", talentBuilt);
        }
    }

    // --- SecondarySkill.json pass (Disc-Harmony effects) --------------------
    // Each SecondarySkill entry has a GroupId that maps to a secondarySkillN
    // inside disc.json. Label format: "Disc-Harmony: <discName> - <skillName>"
    {
        json jSecSkill = LoadJson(binPath + "SecondarySkill.json", "[effect]");
        json jDisc     = LoadJson(dataRoot + "/disc.json",          "[effect]");

        if (!jSecSkill.is_discarded() && !jDisc.is_discarded()) {
            // Pre-build: groupId -> { discName, skillName }
            struct DiscSkillInfo { std::string discName; std::string skillName; };
            std::unordered_map<int32_t, DiscSkillInfo> groupIdToInfo;

            static const std::array<std::string, 4> kSecSkillFields = {
                "secondarySkill1", "secondarySkill2", "secondarySkill3", "secondarySkill4"
            };
            for (auto& [dkey, dval] : jDisc.items()) {
                std::string discName = dval.contains("name")
                                       ? dval["name"].get<std::string>() : "?";
                for (const std::string& field : kSecSkillFields) {
                    if (!dval.contains(field)) continue;
                    const auto& ss = dval[field];
                    if (!ss.contains("id")) continue;
                    int32_t groupId   = ss["id"].get<int32_t>();
                    std::string sname = ss.contains("name")
                                        ? ss["name"].get<std::string>() : "?";
                    groupIdToInfo[groupId] = { discName, sname };
                }
            }

            int harmonyBuilt = 0;
            for (auto& [ssKey, ssVal] : jSecSkill.items()) {
                int32_t configId = 0;
                try { configId = std::stoi(ssKey); } catch (...) { continue; }
                if (!configId || g_EffectTable.count(configId)) continue;
                if (!ssVal.contains("GroupId")) continue;

                int32_t groupId = ssVal["GroupId"].get<int32_t>();
                auto git = groupIdToInfo.find(groupId);
                if (git == groupIdToInfo.end()) continue;

                std::string label = "Disc-Harmony: " + git->second.discName
                                    + " - " + git->second.skillName;
                g_EffectTable[configId] = { "?", label, 0 };
                ++harmonyBuilt;
            }
            Log("[effect] Built harmony (SecondarySkill) entries: %d", harmonyBuilt);
        }
    }

    // --- Hardcoded effects --------------------------------------------------
    g_EffectTable[990050012] = { "Enemy", "Defense Broken", -1 };

    Log("[effect] Built effect table: %d entries (%d disc, %d suppressed)",
        built + discBuilt, discBuilt, (int)g_SuppressedEffects.size());
}

// =============================================================================
//  BuildSkillTable
// =============================================================================

static void BuildSkillTable(const std::string& dataRoot, const json& jChar) {
    // Case 1: known character skills from character.json
    static const std::array<std::string, 4> kSkillTypes = {
        "normalAtk", "skill", "supportSkill", "ultimate"
    };
    for (auto& [ckey, cval] : jChar.items()) {
        if (!cval.contains("name")) continue;
        std::string charName = cval["name"].get<std::string>();
        for (const std::string& stype : kSkillTypes) {
            if (!cval.contains(stype)) continue;
            const auto& sval = cval[stype];
            if (!sval.contains("id") || !sval.contains("name")) continue;
            int32_t skillId   = sval["id"].get<int32_t>();
            std::string sname = sval["name"].get<std::string>();
            g_SkillTable[skillId] = { charName, stype, sname, "", skillId };
        }
    }
    Log("[skill] Built character skill entries: %d", (int)g_SkillTable.size());

    // Case 2: everything else from Skill.json + language file
    const std::string binPath  = dataRoot + "/EN/bin/";
    const std::string langPath = dataRoot + "/EN/language/en_US/";

    json jSkill, jLang;
    if (!LoadJsonPair(binPath + "Skill.json", langPath + "Skill.json",
                      "[skill]", jSkill, jLang))
        return;

    int fallbackBuilt = 0;
    for (auto& [skey, sval] : jSkill.items()) {
        int32_t skillId = std::stoi(skey);
        if (g_SkillTable.count(skillId)) continue;

        std::string fcPath    = sval.value("FCPath", "");
        std::string briefDesc = ResolveLocKey(sval, "BriefDesc", jLang);
        if (briefDesc == "?") briefDesc = "";

        g_SkillTable[skillId] = { "", "", briefDesc, fcPath, skillId };
        ++fallbackBuilt;
    }
    Log("[skill] Built fallback skill entries: %d", fallbackBuilt);
}

// =============================================================================
//  BuildHitTable (public entry point)
// =============================================================================

void BuildHitTable(const std::string& dataRoot) {
    const std::string binPath  = dataRoot + "/EN/bin/";
    const std::string langPath = dataRoot + "/EN/language/en_US/";

    json jHit, jSkill, jLang, jChar;
    jHit   = LoadJson(binPath  + "HitDamage.json", "[lookup]");
    jSkill = LoadJson(binPath  + "Skill.json",      "[lookup]");
    jLang  = LoadJson(langPath + "Skill.json",      "[lookup]");
    jChar  = LoadJson(dataRoot + "/character.json", "[lookup]");

    if (jHit.is_discarded() || jSkill.is_discarded() ||
        jLang.is_discarded() || jChar.is_discarded())
        return;

    // Optional Potential.json
    std::string rawPotential;
    ReadFile(binPath + "Potential.json", rawPotential);
    json jPotential = rawPotential.empty()
                      ? json{}
                      : json::parse(rawPotential, nullptr, false);
    if (jPotential.is_discarded()) jPotential = json{};

    // Build char map and actor name map from character.json
    for (auto& [ckey, cval] : jChar.items()) {
        if (!cval.contains("name")) continue;
        try {
            int32_t id = std::stoi(ckey);
            std::string name = cval["name"].get<std::string>();
            g_CharMap[id]      = name;
            g_ActorNameMap[id] = name;
        } catch (...) {}
    }

    // Build actor name map: enemy skinId -> model basename (from MonsterSkin.json)
    {
        json jMonsterSkin = LoadJson(binPath + "MonsterSkin.json", "[lookup]");
        if (!jMonsterSkin.is_discarded()) {
            int skinBuilt = 0;
            for (auto& [skey, sval] : jMonsterSkin.items()) {
                if (!sval.contains("Id") || !sval.contains("Model")) continue;
                int32_t skinId    = sval["Id"].get<int32_t>();
                std::string model = sval["Model"].get<std::string>();
                size_t slash      = model.rfind('/');
                g_ActorNameMap[skinId] = (slash != std::string::npos)
                                         ? model.substr(slash + 1) : model;
                ++skinBuilt;
            }
            Log("[lookup] Built monster skin map: %d entries", skinBuilt);
        }
    }

    // Main HitDamage loop
    int built = 0;
    for (auto& [key, hitEntry] : jHit.items()) {
        int32_t hitId  = std::stoi(key);
        int32_t charId = hitId / 1000000;

        std::string charName   = CharName(jChar, charId);
        std::string skillTitle = "?";
        int         hitNum     = 0;

        // Resolve the skill that references this hitId via its ParamN fields.
        auto ResolveSkill = [&](json::const_iterator sit) {
            skillTitle = ResolveLocKey(*sit, "Title", jLang);
            int idx = 0;
            ForEachParam(*sit, [&](const std::string& val) -> bool {
                if (val.rfind(kHitDamagePrefix, 0) == 0) {
                    ++idx;
                    if (std::stoi(val.substr(kHitDamagePrefix.size())) == hitId)
                        hitNum = idx;
                }
                return false;
            });
        };

        // Search all skills for a param that equals "HitDamage,DamageNum,<hitId>".
        std::string needle = kHitDamagePrefix + std::to_string(hitId);
        for (auto sit = jSkill.begin(); sit != jSkill.end(); ++sit) {
            bool found = false;
            ForEachParam(*sit, [&](const std::string& val) -> bool {
                return (found = (val == needle));
            });
            if (found) { ResolveSkill(sit); break; }
        }

        g_HitTable[hitId] = { charName, skillTitle, hitNum };
        ++built;
    }

    // Potential.json pass: HitDamage IDs referenced in ParamN
    {
        json jItemRoot = LoadJson(dataRoot + "/item.json", "[lookup]");
        if (!jPotential.is_discarded() && !jItemRoot.is_discarded()) {
            int potBuilt = 0;
            for (auto& [potKey, potVal] : jPotential.items()) {
                std::string itemName = "?";
                {
                    auto iit = jItemRoot.find(potKey);
                    if (iit != jItemRoot.end() && iit->contains("name"))
                        itemName = (*iit)["name"].get<std::string>();
                }
                if (itemName == "?") continue;

                std::string charName = potVal.contains("CharId")
                    ? CharName(jChar, potVal["CharId"].get<int32_t>()) : "?";

                ForEachParam(potVal, [&](const std::string& param) -> bool {
                    int32_t hitId = ExtractPrefixedId(param, kHitDamagePrefix);
                    if (!hitId) return false;

                    auto existing = g_HitTable.find(hitId);
                    if (existing != g_HitTable.end() && existing->second.skillTitle != "?")
                        return false;

                    // Count which hit index this is within this potential entry
                    int hitNum = 0, hitIdx = 0;
                    ForEachParam(potVal, [&](const std::string& mv) -> bool {
                        int32_t mvId = ExtractPrefixedId(mv, kHitDamagePrefix);
                        if (mvId) {
                            ++hitIdx;
                            if (mvId == hitId) hitNum = hitIdx;
                        }
                        return false;
                    });

                    g_HitTable[hitId] = { charName, itemName, hitNum };
                    ++potBuilt;
                    return false;
                });
            }
            Log("[lookup] Built potential hit entries: %d", potBuilt);
        }
    }

    Log("[lookup] Built hit table: %d entries", built);

    BuildEffectTable(dataRoot, jSkill, jLang, jChar, jPotential);
    BuildSkillTable(dataRoot, jChar);
}
