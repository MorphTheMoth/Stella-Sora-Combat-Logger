
# Stella Sora Combat Logger

Injects a dll into the game that logs a lot of information about the combat, using it on the live servers is risky, i suggest using the nebula private server https://github.com/Melledy/Nebula.

Currently WIP, I plan to add more things, mainly an easier way to read through the logs.


## Installation

- Download the latest version of `stellaCombatLogger.dll` from the releases tab https://github.com/MorphTheMoth/Stella-Sora-Combat-Logger/releases
- Go to %localappdata%
- `git clone https://github.com/AutumnVN/StellaSoraData/`, or download it as a .zip, and place it there
- Download the latest version of `stellaDllInjector.exe` https://github.com/MorphTheMoth/StellaSora-Injector/releases
- Put the 2 in the same folder, open a command prompt as administrator and navigate to that folder
- Run `stellaDllInjector.exe stellaCombatLogger.dll` before you open the game
- Open the game


## Usage

Once the program runs, it will create a folder in `/AppData/Local/Stella Sora Combat Logger`.
The log file is created there, there's also a config file to select which logs you want.


## Build from source

I left the minhook libraries prebuilt already, to rebuild them follow the instructions here https://github.com/TsudaKageyu/minhook

```bash
x86_64-w64-mingw32-g++ -shared \
    -o stellaCombatLogger.dll \
    proxy.cpp tables.cpp \
    -I "./minhook/include" \
    -L "./minhook" \
    -lMinHook -m64 -O2 -std=c++17 \
    -static-libgcc -static-libstdc++ \
    -lole32 -luuid
```
