#pragma once
#include <cstdint>
#include <string>
#include "game_structs.h"

void InitStarTowerLogger(const std::string& logDir);
void ShutdownStarTowerLogger();
void HandleStarTowerMsg(int16_t recvMsgId, HttpNetMsg_o* recvMsg, HttpNetMsg_o* sendMsg);
