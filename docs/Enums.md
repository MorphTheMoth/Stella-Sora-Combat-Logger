// Namespace: 
public enum GameEnum.trigger // TypeDefIndex: 4348
{
	// Fields
	public int value__; // 0x0
	public const GameEnum.trigger NONE = 0;
	public const GameEnum.trigger NOTHING = 1;
	public const GameEnum.trigger HITTING = 2;
	public const GameEnum.trigger BEHIT = 3;
	public const GameEnum.trigger KILLENEMY = 4;
	public const GameEnum.trigger CRIT = 5;
	public const GameEnum.trigger CASTSKILL = 6;
	public const GameEnum.trigger GETBUFF = 7;
	public const GameEnum.trigger REMOVEBUFF = 8;
	public const GameEnum.trigger ENTERBATTLE = 9;
	public const GameEnum.trigger LEAVEBATTLE = 10;
	public const GameEnum.trigger BECRIT = 11;
	public const GameEnum.trigger BEGIN_RELOAD = 12;
	public const GameEnum.trigger FINISH_RELOAD = 13;
	public const GameEnum.trigger EFFECT_EXECUTE = 18;
	public const GameEnum.trigger CERTAIN_TIME_INTERVAL = 19;
	public const GameEnum.trigger CASTSKILLEND = 20;
	public const GameEnum.trigger HP_CHANGE = 21;
	public const GameEnum.trigger ON_IMMUNE_DEAD = 22;
	public const GameEnum.trigger DAMAGE_CAUSE_DEAD = 23;
	public const GameEnum.trigger PERFECT_DODGE = 24;
	public const GameEnum.trigger BATTLE_WIN = 25;
	public const GameEnum.trigger SWICH_PLAYER = 26;
	public const GameEnum.trigger TO_BREAK_ALLSHIELD = 27;
	public const GameEnum.trigger BE_BREAK_ALLSHIELD = 28;
	public const GameEnum.trigger BE_BREAK_CERTAINSHIELD = 29;
	public const GameEnum.trigger BE_FINISH_CERTAINSHIELD = 30;
	public const GameEnum.trigger BREAK_TOUGHNESS = 31;
	public const GameEnum.trigger TRIGGER_MARK = 32;
	public const GameEnum.trigger ULTIMATE_ENERGY_CHANGE = 33;
	public const GameEnum.trigger ATTACKING = 34;
	public const GameEnum.trigger BEATTACK = 35;
	public const GameEnum.trigger SUMMONED_DIED = 36;
	public const GameEnum.trigger SUMMON = 37;
	public const GameEnum.trigger ADD_SHIELD = 38;
	public const GameEnum.trigger GET_SHIELD = 39;
	public const GameEnum.trigger IN_BATTLE_STATE = 40;
	public const GameEnum.trigger ANY_ACTOR_TRIGGER_MARK = 41;
}



-------------------------------------


// Namespace: 
public enum GameEnum.takeEffect // TypeDefIndex: 4349
{
	// Fields
	public int value__; // 0x0
	public const GameEnum.takeEffect NONE = 0;
	public const GameEnum.takeEffect DEFAULT = 1;
	public const GameEnum.takeEffect HEALTHUP = 2;
	public const GameEnum.takeEffect HEALTHDOWN = 3;
	public const GameEnum.takeEffect CARRYBUFFID = 4;
	public const GameEnum.takeEffect CARRYBUFFGROUP = 5;
	public const GameEnum.takeEffect CARRYBUFFIDENTIFYING = 6;
	public const GameEnum.takeEffect SKILLSLOTTYPE = 7;
	public const GameEnum.takeEffect HITELEMENTTYPE = 8;
	public const GameEnum.takeEffect DISTANCETYPE = 9;
	public const GameEnum.takeEffect ACTORELEMENTTYPE = 10;
	public const GameEnum.takeEffect CERTAINBUFFID = 11;
	public const GameEnum.takeEffect CERTAINBUFFGROUPID = 12;
	public const GameEnum.takeEffect CERTAINBUFFTAG = 13;
	public const GameEnum.takeEffect CERTAINSHIELDID = 14;
	public const GameEnum.takeEffect NEARBY_ACTOR_LARGE_OR_EQUAL = 15;
	public const GameEnum.takeEffect NEARBY_ACTOR_LESS_OR_EQUAL = 16;
	public const GameEnum.takeEffect CERTAIN_SKILL_ID = 17;
	public const GameEnum.takeEffect HAVE_SHIELD = 18;
	public const GameEnum.takeEffect NO_SHIELD = 19;
	public const GameEnum.takeEffect LEAVE_STAGE = 20;
	public const GameEnum.takeEffect HIT_TARGET_MOREOREQUAL_THAN = 21;
	public const GameEnum.takeEffect HIT_TARGET_LESSOREQUAL_THAN = 22;
	public const GameEnum.takeEffect BUFF_NUM = 23;
	public const GameEnum.takeEffect PROBOBILITY_UP = 24;
	public const GameEnum.takeEffect CERTAIN_LEVEL_TYPE = 25;
	public const GameEnum.takeEffect CERTAIN_EFFECT_ID = 26;
	public const GameEnum.takeEffect CERTAIN_EFFECT_TAG = 27;
	public const GameEnum.takeEffect CERTAIN_MONSTER_EPICTYPE = 28;
	public const GameEnum.takeEffect TIME_INTERVAL = 29;
	public const GameEnum.takeEffect CHARACTER_JOBCLASS = 30;
	public const GameEnum.takeEffect ROGUELIKE_LEVELSTYLE = 31;
	public const GameEnum.takeEffect CERTAIN_MONSTER_TAG = 32;
	public const GameEnum.takeEffect TARGET_CONTAIN_TAG = 33;
	public const GameEnum.takeEffect DAMAGE_CONTAIN_TAG = 34;
	public const GameEnum.takeEffect DISTANCE_LESSOREQUAL_THAN = 35;
	public const GameEnum.takeEffect DISTANCE_MOREOREQUAL_THAN = 36;
	public const GameEnum.takeEffect CERTAIN_FACTION_TYPE = 37;
	public const GameEnum.takeEffect IN_FORWARDAREA = 38;
	public const GameEnum.takeEffect CERTAIN_HITDAMAGEID = 39;
	public const GameEnum.takeEffect HAVE_FRIENDLY_SUMMONS = 40;
	public const GameEnum.takeEffect SELF_BE_MIANCONTROL = 41;
	public const GameEnum.takeEffect SELF_BE_ASSISTANT = 42;
	public const GameEnum.takeEffect CERTAIN_TYPE_ASSISTANT_IN_BATTLE = 43;
	public const GameEnum.takeEffect CERTAIN_MARK_ELMENT_TYPE = 44;
	public const GameEnum.takeEffect ULTIMATE_ENERGY_MOREOREQUAL_THAN = 45;
	public const GameEnum.takeEffect SELF_HP_PERCENT_MOREOREQUAL_THAN = 46;
	public const GameEnum.takeEffect ULTIMATE_ENERGY_LESSOREQUAL_THAN = 47;
	public const GameEnum.takeEffect IS_TOUGHNESS_BROKEN = 48;
	public const GameEnum.takeEffect DAMAGE_NOT_NORMAL = 49;
	public const GameEnum.takeEffect WEAKELEMENTTYPE = 50;
	public const GameEnum.takeEffect CERTAIN_MARK_TYPE = 51;
	public const GameEnum.takeEffect BE_MIANCONTROL = 52;
	public const GameEnum.takeEffect BE_ASSISTANT = 53;
	public const GameEnum.takeEffect CERTAIN_DAMAGETYPE = 54;
	public const GameEnum.takeEffect ASSISTANT_IN_BATTLE = 55;
}



-------------------------------------


// Namespace: 
public enum GameEnum.damageType // TypeDefIndex: 4323
{
	// Fields
	public int value__; // 0x0
	public const GameEnum.damageType NONE = 0;
	public const GameEnum.damageType NORMAL = 1;
	public const GameEnum.damageType SKILL = 2;
	public const GameEnum.damageType ULTIMATE = 3;
	public const GameEnum.damageType OTHER = 4;
	public const GameEnum.damageType MARK = 5;
	public const GameEnum.damageType PROJECTILE = 6;
	public const GameEnum.damageType SUMMON = 7;
}



-------------------------------------


// Namespace: 
public enum GameEnum.effectType // TypeDefIndex: 4350
{
	// Fields
	public int value__; // 0x0
	public const GameEnum.effectType STATE_CAHNGE = 1;
	public const GameEnum.effectType CURRENTCD = 2;
	public const GameEnum.effectType CD = 3;
	public const GameEnum.effectType ADDBUFF = 6;
	public const GameEnum.effectType ADD_SKILL_LV = 7;
	public const GameEnum.effectType SET_SKILL_LV = 8;
	public const GameEnum.effectType IMM_BUFF = 9;
	public const GameEnum.effectType ADDSKILLAMOUNT = 10;
	public const GameEnum.effectType RESUMSKILLAMOUNT = 11;
	public const GameEnum.effectType ATTR_FIX = 12;
	public const GameEnum.effectType REMOVE_BUFF = 13;
	public const GameEnum.effectType EFFECT_CD_FIX = 14;
	public const GameEnum.effectType EFFECT_MAX_CD_FIX = 15;
	public const GameEnum.effectType AMEND_NO_COST = 16;
	public const GameEnum.effectType DAMAGE_IMM_ACC = 17;
	public const GameEnum.effectType EFFECT_MUL = 18;
	public const GameEnum.effectType EFFECT_HP_RECOVRY = 19;
	public const GameEnum.effectType KILL_IMMEDIATELY = 21;
	public const GameEnum.effectType ADD_BUFF_DURATION_EXISTING = 22;
	public const GameEnum.effectType HIT_ELEMENT_TYPE_EXTEND = 23;
	public const GameEnum.effectType CHANGE_EFFECT_RATE = 24;
	public const GameEnum.effectType ADD_TAG = 25;
	public const GameEnum.effectType EFFECT_HP_REVERTTO = 27;
	public const GameEnum.effectType EFFECT_HP_ABSORB = 28;
	public const GameEnum.effectType CHANGE_BUFF_LAMINATEDNUM = 29;
	public const GameEnum.effectType CHANGE_BUFF_TIME = 30;
	public const GameEnum.effectType SPECIAL_ATTR_FIX = 34;
	public const GameEnum.effectType AMMO_FIX = 35;
	public const GameEnum.effectType MONSTER_ATTR_FIX = 36;
	public const GameEnum.effectType PLAYER_ATTR_FIX = 37;
	public const GameEnum.effectType IMMUNE_DEAD = 38;
	public const GameEnum.effectType ENTER_TRANSPARENT = 39;
	public const GameEnum.effectType UNABLE_RECOVER_ENERGY = 40;
	public const GameEnum.effectType CLEAR_MONSTER_AI_BRANCH_CD = 41;
	public const GameEnum.effectType ADD_SHIELD = 42;
	public const GameEnum.effectType REDUCE_HP_BY_CURRENTHP = 43;
	public const GameEnum.effectType REDUCE_HP_BY_MAXHP = 44;
	public const GameEnum.effectType HITTED_ADDITIONAL_ATTR_FIX = 45;
	public const GameEnum.effectType ATTR_ASSIGNMENT = 46;
	public const GameEnum.effectType CAST_AREAEFFECT = 47;
	public const GameEnum.effectType PASSIVE_SKILL = 48;
	public const GameEnum.effectType IMM_CERTAIN_HITDAMAGEID = 49;
	public const GameEnum.effectType STATE_AMOUNT = 50;
	public const GameEnum.effectType DROP_ITEM_PICKUP_RANGE_FIX = 51;
	public const GameEnum.effectType ELEMENTTYPE_ATTR_FIX = 52;
	public const GameEnum.effectType DAMAGETYPE_ATTR_FIX = 53;
	public const GameEnum.effectType HITTED_ADDITIONAL_ELEMENTTYPE_ATTR_FIX = 54;
	public const GameEnum.effectType HITTED_ADDITIONAL_DAMAGETYPE_ATTR_FIX = 55;
	public const GameEnum.effectType ELEMENTTYPE_ATTR_PERCENT_FIX = 56;
	public const GameEnum.effectType DAMAGETYPE_ATTR_PERCENT_FIX = 57;
	public const GameEnum.effectType HITTED_ADDITIONAL_ELEMENTTYPE_ATTR_PERCENT_FIX = 58;
	public const GameEnum.effectType HITTED_ADDITIONAL_DAMAGETYPE_ATTR_PERCENT_FIX = 59;
	public const GameEnum.effectType ELEMENTTYPE_ATTR_ASSIGNMENT = 60;
	public const GameEnum.effectType DAMAGETYPE_ATTR_ASSIGNMENT = 61;
	public const GameEnum.effectType ELEMENTTYPE_ATTR_PERCENT_ASSIGNMENT = 62;
	public const GameEnum.effectType DAMAGETYPE_ATTR_PERCENT_ASSIGNMENT = 63;
}



-------------------------------------


// Namespace: 
public enum GameEnum.effectAttributeType // TypeDefIndex: 4346
{
	// Fields
	public int value__; // 0x0
	public const GameEnum.effectAttributeType NONE = 0;
	public const GameEnum.effectAttributeType ATK = 1;
	public const GameEnum.effectAttributeType DEF = 2;
	public const GameEnum.effectAttributeType MAXHP = 3;
	public const GameEnum.effectAttributeType HITRATE = 4;
	public const GameEnum.effectAttributeType EVD = 5;
	public const GameEnum.effectAttributeType CRITRATE = 6;
	public const GameEnum.effectAttributeType CRITRESIST = 7;
	public const GameEnum.effectAttributeType CRITPOWER_P = 8;
	public const GameEnum.effectAttributeType PENETRATE = 9;
	public const GameEnum.effectAttributeType DEF_IGNORE = 10;
	public const GameEnum.effectAttributeType WER = 11;
	public const GameEnum.effectAttributeType FER = 12;
	public const GameEnum.effectAttributeType SER = 13;
	public const GameEnum.effectAttributeType AER = 14;
	public const GameEnum.effectAttributeType LER = 15;
	public const GameEnum.effectAttributeType DER = 16;
	public const GameEnum.effectAttributeType WEE = 17;
	public const GameEnum.effectAttributeType FEE = 18;
	public const GameEnum.effectAttributeType SEE = 19;
	public const GameEnum.effectAttributeType AEE = 20;
	public const GameEnum.effectAttributeType LEE = 21;
	public const GameEnum.effectAttributeType DEE = 22;
	public const GameEnum.effectAttributeType WEP = 23;
	public const GameEnum.effectAttributeType FEP = 24;
	public const GameEnum.effectAttributeType SEP = 25;
	public const GameEnum.effectAttributeType AEP = 26;
	public const GameEnum.effectAttributeType LEP = 27;
	public const GameEnum.effectAttributeType DEP = 28;
	public const GameEnum.effectAttributeType WEI = 29;
	public const GameEnum.effectAttributeType FEI = 30;
	public const GameEnum.effectAttributeType SEI = 31;
	public const GameEnum.effectAttributeType AEI = 32;
	public const GameEnum.effectAttributeType LEI = 33;
	public const GameEnum.effectAttributeType DEI = 34;
	public const GameEnum.effectAttributeType WEERCD = 35;
	public const GameEnum.effectAttributeType FEERCD = 36;
	public const GameEnum.effectAttributeType SEERCD = 37;
	public const GameEnum.effectAttributeType AEERCD = 38;
	public const GameEnum.effectAttributeType LEERCD = 39;
	public const GameEnum.effectAttributeType DEERCD = 40;
	public const GameEnum.effectAttributeType WEIGHT = 41;
	public const GameEnum.effectAttributeType TOUGHNESS_MAX = 42;
	public const GameEnum.effectAttributeType TOUGHNESS_DAMAGE_ADJUST = 43;
	public const GameEnum.effectAttributeType SHIELD_MAX = 44;
	public const GameEnum.effectAttributeType MOVESPEED = 46;
	public const GameEnum.effectAttributeType ATKSPD_P = 47;
	public const GameEnum.effectAttributeType INTENSITY = 48;
	public const GameEnum.effectAttributeType GENDMG = 49;
	public const GameEnum.effectAttributeType DMGPLUS = 50;
	public const GameEnum.effectAttributeType FINALDMG = 51;
	public const GameEnum.effectAttributeType FINALDMGPLUS = 52;
	public const GameEnum.effectAttributeType GENDMGRCD = 53;
	public const GameEnum.effectAttributeType DMGPLUSRCD = 54;
	public const GameEnum.effectAttributeType SUPPRESS = 55;
	public const GameEnum.effectAttributeType NORMALDMG = 56;
	public const GameEnum.effectAttributeType SKILLDMG = 57;
	public const GameEnum.effectAttributeType ULTRADMG = 58;
	public const GameEnum.effectAttributeType OTHERDMG = 59;
	public const GameEnum.effectAttributeType RCDNORMALDMG = 60;
	public const GameEnum.effectAttributeType RCDSKILLDMG = 61;
	public const GameEnum.effectAttributeType RCDULTRADMG = 62;
	public const GameEnum.effectAttributeType RCDOTHERDMG = 63;
	public const GameEnum.effectAttributeType MARKDMG = 64;
	public const GameEnum.effectAttributeType RCDMARKDMG = 65;
	public const GameEnum.effectAttributeType SUMMONDMG = 66;
	public const GameEnum.effectAttributeType RCDSUMMONDMG = 67;
	public const GameEnum.effectAttributeType PROJECTILEDMG = 68;
	public const GameEnum.effectAttributeType RCDPROJECTILEDMG = 69;
	public const GameEnum.effectAttributeType NORMALCRITRATE = 70;
	public const GameEnum.effectAttributeType SKILLCRITRATE = 71;
	public const GameEnum.effectAttributeType ULTRACRITRATE = 72;
	public const GameEnum.effectAttributeType MARKCRITRATE = 73;
	public const GameEnum.effectAttributeType SUMMONCRITRATE = 74;
	public const GameEnum.effectAttributeType PROJECTILECRITRATE = 75;
	public const GameEnum.effectAttributeType OTHERCRITRATE = 76;
	public const GameEnum.effectAttributeType NORMALCRITPOWER = 77;
	public const GameEnum.effectAttributeType SKILLCRITPOWER = 78;
	public const GameEnum.effectAttributeType ULTRACRITPOWER = 79;
	public const GameEnum.effectAttributeType MARKCRITPOWER = 80;
	public const GameEnum.effectAttributeType SUMMONCRITPOWER = 81;
	public const GameEnum.effectAttributeType PROJECTILECRITPOWER = 82;
	public const GameEnum.effectAttributeType OTHERCRITPOWER = 83;
	public const GameEnum.effectAttributeType ENERGY_MAX = 84;
	public const GameEnum.effectAttributeType SKILL_INTENSITY = 85;
	public const GameEnum.effectAttributeType TOUGHNESS_BROKEN_DMG = 86;
	public const GameEnum.effectAttributeType ADD_SHIELD_STRENGTHEN = 87;
	public const GameEnum.effectAttributeType BE_ADD_SHIELD_STRENGTHEN = 88;
	public const GameEnum.effectAttributeType NORMAL_SUPPRESS = 89;
	public const GameEnum.effectAttributeType SKILL_SUPPRESS = 90;
	public const GameEnum.effectAttributeType ULTRA_SUPPRESS = 91;
	public const GameEnum.effectAttributeType MARK_SUPPRESS = 92;
	public const GameEnum.effectAttributeType SUMMON_SUPPRESS = 93;
	public const GameEnum.effectAttributeType PROJECTILE_SUPPRESS = 94;
	public const GameEnum.effectAttributeType OTHER_SUPPRESS = 95;
	public const GameEnum.effectAttributeType ENV_AMEND = 96;
	public const GameEnum.effectAttributeType MAX = 97;
}



-------------------------------------


// Namespace: 
public enum GameEnum.levelTypeData // TypeDefIndex: 4367
{
	// Fields
	public int value__; // 0x0
	public const GameEnum.levelTypeData None = 0;
	public const GameEnum.levelTypeData Exclusive = 1;
	public const GameEnum.levelTypeData Actor = 2;
	public const GameEnum.levelTypeData SkillSlot = 3;
	public const GameEnum.levelTypeData BreakCount = 4;
	public const GameEnum.levelTypeData Note = 5;
	public const GameEnum.levelTypeData DiscSkill = 6;
	public const GameEnum.levelTypeData BuildLevel = 7;
	public const GameEnum.levelTypeData SoldierLevel = 8;
}

