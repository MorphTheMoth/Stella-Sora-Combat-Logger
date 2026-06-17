
# Stella Sora Combat Logger

Injects a dll into the game that logs informations about the combat, using it on the live servers is risky, i suggest using the nebula private server https://github.com/Melledy/Nebula.

<table>
  <tr>
    <td width="50%" valign="top">

### Log with Hits, Skill Casts, Buff Applications
<img src="https://github.com/user-attachments/assets/0650373a-0631-4806-9174-11a66e600d4d" width="100%"/>

</td>
    <td width="50%" valign="top">

### Charts for dmg share and buff uptimes
<img src="https://github.com/user-attachments/assets/cb5349ab-5f8e-4de0-a21d-9565d5ed459a" width="100%"/>
<img src="https://github.com/user-attachments/assets/afb4e2e7-6a26-4d5c-a2fa-b1f30066d967" width="100%"/>

</td>
  </tr>
  <tr>
    <td width="50%" valign="top">

### Recalculate every hit's damage removing any combination of effects
<img src="https://github.com/user-attachments/assets/9e2ceb64-dc7d-4208-916d-da1b83d2f5ae" width="100%"/>

</td>
    <td width="50%" valign="top">

### Automatically recalculate the total contribution of each effect
<img src="https://github.com/user-attachments/assets/3694c0f9-e562-4784-8dc3-963b9721bce4" width="100%"/>

</td>
  </tr>
</table>

## Installation

- Download `stellaCombatLogger.dll` from the releases tab https://github.com/MorphTheMoth/Stella-Sora-Combat-Logger/releases
- Download `stellaDllInjector.exe` from https://github.com/MorphTheMoth/StellaSora-Injector/releases
- Put the 2 in the same folder, open a command prompt as administrator and navigate to that folder
- Run `stellaDllInjector.exe stellaCombatLogger.dll` before you open the game
- Open the game

A folder called Stella Sora Combat Logger should get created in %localappdata% with the log files, sanity_log.txt has logs to check if all the hooks went well, http_log.txt has emblems rolls logs, ss_jsonlog has the actual combat logs.

In `log_config.json` there are toggles for logging and for enabling hitboxes.

For linux I had issues with normally injecting a dll, but you can download the stellaCombatLogger-Linux.dll, rename it to `winhttp.dll`, put `WINEDLLOVERRIDES="winhttp=n,b" %command%` in the steam launch options, move the `winhttp.dll` in the game folder inside the wine prefix `/pfx/drive_c/YostarGames/StellaSora_EN/` and wine will inject the dll for you.


## Usage

- To view the logs, download `log_viewer.exe` from the release tab https://github.com/MorphTheMoth/Stella-Sora-Combat-Logger/releases
- run `log_viewer.exe` or `./log_viewer.exe` from command line (if you double click it, it works, but you can only close it from task manager).
- Open http://localhost:9299
- If the log viewer doesn't find the log file automatically, run `./log_viewer.exe "path/to/ss_jsonlog.txt"`



## Build from source

I left the minhook libraries prebuilt already, to rebuild them follow the instructions here https://github.com/TsudaKageyu/minhook

```bash
x86_64-w64-mingw32-g++ -shared \
    -o stellaCombatLogger.dll \
    proxy.cpp logging.cpp http_hooks.cpp \
    -I "./minhook/include" \
    -L "./minhook" \
    -lMinHook -m64 -O2 -std=c++17 \
    -static-libgcc -static-libstdc++ \
    -lole32 -luuid -lwinhttp
```

```bash
x86_64-w64-mingw32-g++ -shared \
    -o stellaCombatLogger-Linux.dll \
    proxy.cpp logging.cpp http_hooks.cpp \
    -I "./minhook/include" \
    -L "./minhook" \
    -lMinHook -m64 -O2 -std=c++17 \
    -static-libgcc -static-libstdc++ \
    -lole32 -luuid -lwinhttp \
    -DWINHTTP_PROXY
```

```bash
x86_64-w64-mingw32-g++ log_viewer.cpp mongoose.c -o log_viewer.exe -std=c++17 -lws2_32 -ladvapi32 -lwininet -static-libgcc -static-libstdc++
```
```bash
g++ log_viewer.cpp mongoose.c -o log_viewer_linux -std=c++17 -lpthread -lcurl
```
