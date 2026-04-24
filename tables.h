#pragma once
#include <cstdint>
#include <string>
#include <unordered_map>
#include <unordered_set>

struct HitInfo {
    std::string charName;
    std::string skillTitle;
    int         hitNum;
};

struct EffectInfo {
    std::string charName;
    std::string label;
    int         levelTypeData;
};

struct SkillInfo {
    std::string ownerName;   // character name, or "" if not a character skill
    std::string skillType;   // "normalAtk", "skill", "supportSkill", "ultimate", or ""
    std::string skillName;   // skill name from character.json, or briefDesc from lang, or ""
    std::string fcPath;      // FCPath from Skill.json, or ""
    int32_t     skillId;
};

extern std::unordered_map<int32_t, HitInfo>     g_HitTable;
extern std::unordered_map<int32_t, EffectInfo>  g_EffectTable;
extern std::unordered_set<int32_t>              g_SuppressedEffects;
extern std::unordered_map<int32_t, std::string> g_CharMap;
extern std::unordered_map<int32_t, std::string> g_ActorNameMap; // dataId (player) or skinId (enemy) -> display name
extern std::unordered_map<int32_t, SkillInfo>   g_SkillTable;

const std::string& ActorDisplayName(int32_t id);
extern void BuildHitTable(const std::string& dataRoot);
