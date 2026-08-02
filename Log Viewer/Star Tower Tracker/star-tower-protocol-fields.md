# Star Tower — Client-Visible Network Protocol Fields

All data the server sends to the client in the Star Tower game mode. These are the exact protobuf fields serialized in each response message. Odds and internal server logic are **not** included — only what the client receives.

---

## Message 4602 — `star_tower_apply_succeed_ack` (Enter Tower)

Sent when a Star Tower run starts.

```
StarTowerApplyResp {
  info:        StarTowerInfo  // 1 (see below)
  lastId:      uint32         // 2 — Tower definition ID selected
  coinQty:     uint32         // 4 — Starting tower coin balance
  infos:       repeated SubNoteSkillInfo  // 5 — (unused by game)
  fateCardId:  uint32         // 6 — (unused)
  newFateCard: bool           // 7 — (unused)
  sweepTicket: uint32         // 8 — (unused)
  sweepTicketUndated: uint32  // 9 — (unused)
  change:      ChangeInfo     // 15 — Item deltas (express pass consumed)
}
```

---

## Message 4611 — `star_tower_info_succeed_ack` (Poll State)

Sent when the client requests current game state mid-run. Contains the same `StarTowerInfo` as above.

```
StarTowerInfo {
  meta:   StarTowerMeta
  room:   StarTowerRoom
  bag:    StarTowerBag
}

StarTowerMeta {
  id:                 uint32  // 1 — Tower instance ID
  charHp:             uint32  // 2 — Party HP (-1 = full)
  teamLevel:          uint32  // 3 — Current team level
  teamExp:            uint32  // 4 — Current team exp
  chars:              repeated StarTowerChar  // 5 — 3 characters
  discs:              repeated StarTowerDisc  // 6 — 6 discs
  dateLen:            uint32  // 7 — Date info counter
  clientData:         string  // 8 — Client state data
  activeSecondaryIds: repeated uint32  // 9 — Active secondary skill IDs
  nPCInteractions:    uint32  // 10 — NPC events interacted with
  towerGrowthNodes:   repeated uint32  // 11 — Growth node bitfield
  resurrectionCnt:    uint32  // 12
  totalTime:          uint32  // 14 — Accumulated battle time (ms?)
  totalDamages:       repeated uint64  // 15 — Damage total per char
  buildId:            uint64  // 16 — Unique build record ID (varint)
  dataVersion:        uint32  // 17
}

StarTowerChar {
  id:            uint32  // 1 — Character template ID
  gems:          repeated StarTowerCharGem  // 2
  level:         uint32  // 3
  skillLvs:      repeated uint32  // 4 — Skill levels by slot index
  affinityLevel: uint32  // 5
  advance:       uint32  // 6 — Breakthrough rank
  talentNodes:   bytes   // 7 — Bitfield of unlocked talent nodes
}

StarTowerCharGem {
  attributes:    repeated uint32  // 1
  slotId:        uint32  // 2
  overlockCount: repeated uint32  // 3
}

StarTowerDisc {
  id:    uint32  // Disc template ID
  level: uint32
  phase: uint32
  star:  uint32
}

StarTowerRoom {
  data:  StarTowerRoomData
  cases: repeated StarTowerRoomCase  // Interactive elements in room
}

StarTowerRoomData {
  floor:      uint32  // 1 — Current floor number
  mapId:      uint32  // 2 — Scene/map ID
  paramId:    uint32  // 3
  roomType:   uint32  // 4 — See RoomType enum
  mapParam:   string  // 5 — Map parameter
  mapTableId: uint32  // 6 — Map data table ID
}

StarTowerBag {
  items:      repeated TowerItemInfo    // Sub-note skills
  potentials: repeated PotentialInfo    // Active potentials
  res:        repeated TowerResInfo     // Resources (tower coins)
  fateCard:   repeated FateCardInfo
}

TowerItemInfo { tid: uint32, qty: int32 }
PotentialInfo { tid: uint32, level: int32 }
TowerResInfo  { tid: uint32, qty: int32 }
```

---

## Message 4608 — `star_tower_interact_succeed_ack` (All Interactions)

Sent for every player action in a room (battle, potential select, shop, door, NPC event, etc.).

```
StarTowerInteractResp {
  id:      uint32  // 1 — The case ID being interacted with
  cases:   repeated StarTowerRoomCase  // 2 — New cases spawned by this interaction
  change:  ChangeInfo           // 3 — All inventory deltas from the action
  data:    TowerChangeData      // 4 — Sub-note skill / secondary skill changes

  // Exactly one of these response sub-messages is set:
  battleEndResp:          InteractBattleEndResp  // 8
  enterResp:              InteractEnterResp      // 7
  selectResp:             InteractSelectResp     // 9
  strengthenMachineResp:  InteractStrengthenMachineResp  // 10
  settle:                 SettleDataResp         // 14
  nilResp:                Nil                    // 15
}
```

### Sub-messages

```
TowerChangeData {
  infos:       repeated SubNoteSkillInfo   // New/changed sub-note skills
  secondaries: repeated ActiveSecondaryChange  // Secondary skill activations
}

SubNoteSkillInfo {
  tid:  uint32
  qty:  int32
  luckyLevel: uint32
  new:  bool
}

ActiveSecondaryChange {
  secondaryId: uint32
  active:      bool
}

InteractBattleEndResp {
  victory: VictoryData  // (OR defeat: DefeatData)
}

VictoryData {
  exp:        uint32  // 1
  lv:         uint32  // 2 — New team level after level-up
  battleTime: uint32  // 10 — Total accumulated battle time
}

InteractEnterResp {
  room: StarTowerRoom  // The full new room state
}

InteractSelectResp {
  resp:                       Success
  selectSpecialPotentialCase: SelectSpecialPotentialCaseData
  selectPotentialCase:        SelectPotentialCaseData
  selectFateCardCase:         SelectFateCardCaseData
  hawkerCase:                 HawkerCaseData
}

Success {
  items:          repeated ItemTpl  // 1
  optionsResult:  bool              // 2
  fateCard:       repeated FateCardInfo  // 3
  subNoteSkills:  repeated SubNoteSkillInfo  // 4
  optionsParamId: uint32  // 5 — For question-type NPC events
  affinityChange: repeated NPCAffinityChange  // 6
}

InteractStrengthenMachineResp {
  buySucceed: bool
}

SettleDataResp {
  totalTime:       uint32
  npcInteraction:  uint32
  build:           StarTowerBuildInfo  // The final build record
  change:          ChangeInfo
  towerRewards:    repeated ItemTpl    // Journey tickets, research materials
  totalDamages:    repeated uint64
  awards:          repeated FirstAward  // First-clear bonuses
  reward:          repeated NPCAffinityLevelReward
}
```

---

## Message 4614 — `star_tower_give_up_succeed_ack` (Give Up)

```
StarTowerGiveUpResp {
  floor:          uint32  // Floors cleared
  potentialCnt:   uint32  // Total potentials obtained
  npcInteraction: uint32
  totalTime:      uint32
  build:          StarTowerBuildInfo
  change:         ChangeInfo
  towerRewards:   repeated ItemTpl
  totalDamages:   repeated uint64
  reward:         repeated NPCAffinityLevelReward
}
```

---

## Room Cases (embeds inside `StarTowerRoom.cases`)

Each `StarTowerRoomCase` has an `id: uint32` and **one** of these case data types:

| CaseType | Proto Field | Fields Sent |
|----------|-------------|-------------|
| `Battle` (1) | `BattleCase` | `subNoteSkillNum: uint32` (expected sub-note drops), `timeLimit: bool`, `fateCard: bool` |
| `OpenDoor` (2) | `DoorCase` | `floor: uint32` (next floor #), `type: uint32` (next room type) |
| `PotentialSelect` (3) | `SelectPotentialCase` | `teamLevel: uint32`, `infos: repeated PotentialInfo` (up to 3), `luckyIds: repeated uint32`, `canReRoll: bool`, `reRollPrice: uint32`, `newIds: repeated uint32`, `type: uint32` |
| `FateCardSelect` (4) | `SelectFateCardCase` | (not implemented in this server) |
| `SelectSpecialPotential` (7) | `SelectSpecialPotentialCase` | `teamLevel: uint32`, `ids: repeated uint32` (up to 3 potential IDs), `canReRoll: bool`, `reRollPrice: uint32`, `newIds: repeated uint32` |
| `NpcEvent` (6) | `SelectOptionsEventCase` | `evtId: uint32`, `nPCId: uint32`, `options: repeated uint32` (up to 4), `infos: repeated NPCAffinityInfo`, `failedIdxes: repeated uint32`, `done: bool` |
| `RecoveryHP` (8) | `RecoveryHPCase` | (empty — just a marker) |
| `NpcRecoveryHP` (9) | `NpcRecoveryHPCase` | `effectId: uint32` (default 989970 = 50% restore) |
| `Hawker` (10) | `HawkerCase` | `list: repeated HawkerGoods`, `canReRoll: bool`, `reRollTimes: uint32`, `reRollPrice: uint32`, `purchase: repeated uint32` (sold SIDs) |
| `StrengthenMachine` (11) | `StrengthenMachineCase` | `firstFree: bool`, `discount: uint32`, `times: uint32` |
| `SyncHP` (13) | `SyncHPCase` | (empty — just a marker) |

```
HawkerGoods {
  sid:      uint32
  type:     uint32  // 1 = potential selector, 2 = sub-notes
  idx:      uint32  // Shop goods template ID
  goodsId:  uint32  // Item template ID
  price:    uint32  // Display price (pre-discount)
  discount: uint32  // Discounted price (if present)
  charPos:  uint32  // 0 = random, 1-3 = specific character slot
  tag:      uint32
}

NPCAffinityInfo {
  nPCId:    uint32
  affinity: uint32
}
```

---

## Build Records (embedded in settle/give-up)

```
StarTowerBuildInfo {
  brief:  StarTowerBuildBrief
  detail: StarTowerBuildDetail
}

StarTowerBuildBrief {
  id:          uint32
  name:        string
  lock:        bool
  preference:  bool
  score:       uint32
  discIds:     repeated uint32  // 6 disc IDs
  chars:       repeated TowerBuildChar
}

TowerBuildChar {
  charId:       uint32
  potentialCnt: uint32
}

StarTowerBuildDetail {
  potentials:      repeated BuildPotential
  subNoteSkills:   repeated ItemTpl
  activeSecondaryIds: repeated uint32
}

BuildPotential {
  potentialId: uint32
  level:       uint32
}
```

---

## Push Notifications

| Msg ID | Name | Likely Content |
|--------|------|----------------|
| 10015 | `star_tower_book_potential_notify` | Potential book data changes |
| 10016 | `star_tower_book_event_notify` | Tower book event updates |
| -10021 | `st_clear_all_star_tower_notify` | Clear all tower state |
| -10011 | `star_tower_sub_note_skill_info_notify` | Sub-note skill info update |

---

## RoomType Enum Values

```
BattleRoom       = 0
EliteBattleRoom  = 1
BossRoom         = 2
FinalBossRoom    = 3
DangerRoom       = 4
HorrorRoom       = 5
ShopRoom         = 6
EventRoom        = 7
UnifyBattleRoom  = 15
```

## CaseType Enum Values

```
Battle                 = 1
OpenDoor               = 2
PotentialSelect        = 3
FateCardSelect         = 4
NoteSelect             = 5
NpcEvent               = 6
SelectSpecialPotential = 7
RecoveryHP             = 8
NpcRecoveryHP          = 9
Hawker                 = 10
StrengthenMachine      = 11
DoorDanger             = 12
SyncHP                 = 13
```

---

## Source Files (primary references)

All fields above are traced from these source files in the Nebula server at `/home/morph/stella sora meter/Nebula/`:

| File | What it defines |
|------|----------------|
| `src/generated/.../proto/PublicStarTower.java` | All StarTower protobuf message classes and their fields |
| `src/generated/.../proto/StarTowerInteract.java` | `StarTowerInteractResp` message |
| `src/generated/.../proto/StarTowerApply.java` | `StarTowerApplyResp` message |
| `src/generated/.../proto/StarTowerGiveUp.java` | `StarTowerGiveUpResp` message |
| `src/main/.../game/tower/StarTowerGame.java` | `toProto()` — serializes game state into the messages |
| `src/main/.../game/tower/StarTowerBuild.java` | Build record proto serialization |
| `src/main/.../game/tower/room/StarTowerBaseRoom.java` | Room data proto |
| `src/main/.../game/tower/cases/*.java` | Each case type's proto encoding |
| `src/main/.../server/handlers/HandlerStarTower*.java` | Response construction for each message |
| `src/main/.../game/tower/room/RoomType.java` | Room type enum |
| `src/main/.../game/tower/cases/CaseType.java` | Case type enum |
