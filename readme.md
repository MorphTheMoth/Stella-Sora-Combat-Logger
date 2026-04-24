
# Stella Sora Combat Logger

Injects a dll into the game that logs a lot of information about the combat, using it on the live servers is risky, i suggest using the nebula private server https://github.com/Melledy/Nebula.

Currently WIP, I plan to add more things, mainly an easier way to read through the logs.


## Installation

- download `winhttp.dll` from the releases tab
- put `winhttp.dll` in the game folder
- go to %localappdata%
- `git clone https://github.com/AutumnVN/StellaSoraData/`, or download it as a .zip, and place it there

## Usage

once the program runs, it will create a folder in `/AppData/Local/Stella Sora Combat Logger`, the log file is created there, and there's also a config file to select which logs you want.

## Build from source

I left the minhook libraries prebuilt already, to rebuild them follow the instructions here https://github.com/TsudaKageyu/minhook

```bash
x86_64-w64-mingw32-g++ -shared \
    -o winhttp.dll \
    proxy.cpp tables.cpp \
    -I "./minhook/include" \
    -L "./minhook" \
    -lMinHook -m64 -O2 -std=c++17 \
    -static-libgcc -static-libstdc++ \
    -lole32 -luuid
```
