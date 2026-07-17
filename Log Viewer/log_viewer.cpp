#include <cstdio>
#include <cstdlib>
#include <ctime>
#include <string>
#include <fstream>
#include <sstream>
#include <mutex>
#include <vector>
#include <algorithm>
#include <set>
#include <filesystem>

#ifdef _WIN32
    #define WIN32_LEAN_AND_MEAN
    #include <windows.h>
    #include <shlobj.h>
    #include <shellapi.h>
#else
    #include <unistd.h>
    #include <pwd.h>
    #include <sys/types.h>
    #include <sys/stat.h>
    #include <dirent.h>
#endif

#include "mongoose.h"
#include "../json.hpp"

using json = nlohmann::json;

// =============================================================================
//  Logging
// =============================================================================

static std::mutex log_mutex;
static void HttpLog(int status, const std::string& method, const std::string& uri,
                    const std::string& query, const std::string& remote_addr) {
    // Timestamp: HH:MM:SS
    time_t now = time(nullptr);
    struct tm* t = localtime(&now);
    char ts[16];
    strftime(ts, sizeof(ts), "%H:%M:%S", t);

    // Colour codes (skipped on Windows unless ANSI is enabled)
#ifndef _WIN32
    const char* col_reset  = "\033[0m";
    const char* col_status = (status >= 500) ? "\033[31m"   // red
                           : (status >= 400) ? "\033[33m"   // yellow
                           :                   "\033[32m";  // green
    const char* col_dim    = "\033[2m";
#else
    const char* col_reset  = "";
    const char* col_status = "";
    const char* col_dim    = "";
#endif

    std::string full_uri = query.empty() ? uri : uri + "?" + query;

    std::lock_guard<std::mutex> lk(log_mutex);
    printf("%s[%s]%s %s%-3d%s  %-6s %s  %s%s%s\n",
           col_dim,    ts,          col_reset,
           col_status, status,      col_reset,
           method.c_str(),
           full_uri.c_str(),
           col_dim, remote_addr.c_str(), col_reset);
    fflush(stdout);
}

static void ServerLog(const char* fmt, ...) {
    time_t now = time(nullptr);
    struct tm* t = localtime(&now);
    char ts[16];
    strftime(ts, sizeof(ts), "%H:%M:%S", t);

    std::lock_guard<std::mutex> lk(log_mutex);
#ifndef _WIN32
    printf("\033[2m[%s]\033[0m \033[36m*\033[0m ", ts);
#else
    printf("[%s] * ", ts);
#endif
    va_list ap;
    va_start(ap, fmt);
    vprintf(fmt, ap);
    va_end(ap);
    printf("\n");
    fflush(stdout);
}

// =============================================================================
//  Files Whitelist
// =============================================================================

static std::set<std::string> g_static_files;
// Populate the set by scanning a directory once at startup.
void ScanStaticFolder(const std::string& folder) {
    namespace fs = std::filesystem;
    g_static_files.clear();
    try {
        for (const auto& entry : fs::directory_iterator(folder)) {
            if (entry.is_regular_file()) {
                std::string name = entry.path().filename().string();
                if (name.empty() || name[0] == '.') continue;
                if (name.find('/') != std::string::npos ||
                    name.find('\\') != std::string::npos) continue;
                g_static_files.insert(name);
            }
        }
        ServerLog("Static file whitelist: %zu files scanned from %s",
                  g_static_files.size(), folder.c_str());
    } catch (...) {
        ServerLog("Could not scan static folder '%s'", folder.c_str());
    }
}

std::string GetContentType(const std::string& filename) {
    auto ext_pos = filename.rfind('.');
    if (ext_pos == std::string::npos) return "application/octet-stream";
    std::string ext = filename.substr(ext_pos);
    if (ext == ".html" || ext == ".htm")  return "text/html";
    if (ext == ".js")                     return "application/javascript";
    if (ext == ".css")                    return "text/css";
    if (ext == ".json")                   return "application/json";
    return "application/octet-stream";
}

// =============================================================================
//  Global log file path
// =============================================================================
std::string LOG_FILE;
static std::string g_saved_logs_dir;  // non-empty overrides SavedLogsDir()
static bool g_local_mode = false;

static std::string EMBLEM_LOG_PATH;
static std::string ASCENSION_LOG_PATH;
static const std::string EMBLEM_DIR = "Emblem Tracker";
static const std::string ASCENSION_DIR = "Star Tower Tracker";

static const char* REMOTE_BASE =
    "https://raw.githubusercontent.com/MorphTheMoth/Stella-Sora-Combat-Logger/refs/heads/main/Log%20Viewer";

// =============================================================================
//  Remote file fetch — WinINet on Windows, libcurl on Linux
// =============================================================================
#ifdef _WIN32
#include <wininet.h>

static std::string FetchRemoteFile(const std::string& url) {
    ServerLog("Fetching: %s", url.c_str());
    std::string result;

    HINTERNET hInet = InternetOpenA("LogViewer/1.0",
                                    INTERNET_OPEN_TYPE_PRECONFIG,
                                    NULL, NULL, 0);
    if (!hInet) {
        ServerLog("FetchRemoteFile: InternetOpen failed (%lu)", GetLastError());
        return result;
    }

    HINTERNET hUrl = InternetOpenUrlA(hInet, url.c_str(), NULL, 0,
                                      INTERNET_FLAG_SECURE |
                                      INTERNET_FLAG_RELOAD |
                                      INTERNET_FLAG_NO_CACHE_WRITE,
                                      0);
    if (!hUrl) {
        ServerLog("FetchRemoteFile: InternetOpenUrl failed (%lu)", GetLastError());
        InternetCloseHandle(hInet);
        return result;
    }

    char buf[8192];
    DWORD bytesRead = 0;
    while (InternetReadFile(hUrl, buf, sizeof(buf), &bytesRead) && bytesRead > 0)
        result.append(buf, bytesRead);

    InternetCloseHandle(hUrl);
    InternetCloseHandle(hInet);
    return result;
}

#else
#include <curl/curl.h>

static size_t curl_write_cb(char* ptr, size_t size, size_t nmemb, void* userdata) {
    static_cast<std::string*>(userdata)->append(ptr, size * nmemb);
    return size * nmemb;
}

static std::string FetchRemoteFile(const std::string& url) {
    ServerLog("Fetching: %s", url.c_str());
    std::string result;

    CURL* curl = curl_easy_init();
    if (!curl) {
        ServerLog("FetchRemoteFile: curl_easy_init failed");
        return result;
    }

    curl_easy_setopt(curl, CURLOPT_URL,            url.c_str());
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION,  curl_write_cb);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA,      &result);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT,        10L);

    CURLcode res = curl_easy_perform(curl);
    if (res != CURLE_OK) {
        ServerLog("FetchRemoteFile: curl error: %s", curl_easy_strerror(res));
        result.clear();
    } else {
        long http_code = 0;
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &http_code);
        if (http_code != 200) {
            ServerLog("FetchRemoteFile: HTTP %ld for %s", http_code, url.c_str());
            result.clear();
        }
    }

    curl_easy_cleanup(curl);
    return result;
}
#endif

std::string GetDefaultLogPath() {
#ifdef _WIN32
    char path[MAX_PATH];
    if (SHGetFolderPathA(NULL, CSIDL_LOCAL_APPDATA, NULL, 0, path) == S_OK)
        return std::string(path) + "\\Stella Sora Combat Logger\\ss_jsonlog.txt";
    return std::string("ss_jsonlog.txt");
#else
    return "/dev/shm/StellaSoraLogger/ss_jsonlog.txt";
#endif
}

// =============================================================================
//  Line index - maps logical line numbers to byte offsets in LOG_FILE
// =============================================================================
std::mutex file_mutex;

struct LineIndex {
    // offsets[i] = byte offset where logical line i begins.
    // A "logical line" is any non-empty line that doesn't start with '='.
    std::vector<std::streampos> offsets;
    std::streampos              eof_offset = 0;
    bool                        valid      = false;
};

static LineIndex g_index;

// Full scan - only runs once (or after /clear). Holds file_mutex.
static void RebuildIndex(std::ifstream& file) {
    g_index.offsets.clear();
    g_index.valid = false;
    file.clear();
    file.seekg(0, std::ios::beg);
    std::string line;
    while (true) {
        std::streampos pos = file.tellg();
        if (!std::getline(file, line)) break;
        if (line.empty() || line[0] == '=') continue;
        g_index.offsets.push_back(pos);
    }
    file.clear();
    file.seekg(0, std::ios::end);
    g_index.eof_offset = file.tellg();
    g_index.valid = true;
}

// Cheap incremental scan - only reads bytes appended since last call. Holds file_mutex.
static void ExtendIndex(std::ifstream& file) {
    file.clear();
    file.seekg(0, std::ios::end);
    std::streampos current_eof = file.tellg();
    if (current_eof < g_index.eof_offset) {
        // File was truncated/recreated — rebuild from scratch.
        g_index.valid = false;
        g_index.offsets.clear();
        g_index.eof_offset = 0;
        return;
    }
    if (current_eof == g_index.eof_offset) return;
    file.clear();
    file.seekg(g_index.eof_offset);
    std::string line;
    while (true) {
        std::streampos pos = file.tellg();
        if (!std::getline(file, line)) break;
        if (line.empty() || line[0] == '=') continue;
        g_index.offsets.push_back(pos);
    }
    file.clear();
    file.seekg(0, std::ios::end);
    g_index.eof_offset = file.tellg();
}

// Call after /clear so the next read triggers a fresh RebuildIndex.
static void InvalidateIndex() {
    std::lock_guard<std::mutex> lock(file_mutex);
    g_index.valid = false;
    g_index.offsets.clear();
    g_index.eof_offset = 0;
}

// Returns { "events": [...], "totalLines": N, "nextAfter": N }.
// After the first full scan the index is only extended by new bytes,
// and each poll jumps straight to `after` via seekg - no full-file scan.
std::string ReadJsonLog(size_t after = 0) {
    std::lock_guard<std::mutex> lock(file_mutex);

    std::ifstream file(LOG_FILE);
    if (!file.is_open()) return "{\"events\":[],\"totalLines\":0}";

    if (!g_index.valid)
        RebuildIndex(file);
    else
        ExtendIndex(file);

    // ExtendIndex may have invalidated the index on truncation — rebuild if so.
    if (!g_index.valid) RebuildIndex(file);

    size_t totalLines = g_index.offsets.size();

    json arr = json::array();
    size_t nextAfter = after;
    if (after < totalLines) {
        file.clear();
        file.seekg(g_index.offsets[after]);
        if (file.fail()) {
            // Index is stale (file was truncated externally). Rebuild next time.
            g_index.valid = false;
            g_index.offsets.clear();
            g_index.eof_offset = 0;
        } else {
            std::string line;
            int maxLines = 250, read = 0;
            while (read < maxLines && std::getline(file, line)) {
                if (line.empty() || line[0] == '=') continue;
                try { arr.push_back(json::parse(line)); } catch (...) {}
                ++read;
            }
            nextAfter = after + read;
        }
    } else {
        nextAfter = totalLines;
    }

    json result;
    result["events"]     = arr;
    result["totalLines"] = totalLines;
    result["nextAfter"]  = nextAfter;
    return result.dump();
}

// =============================================================================
//  Helpers
// =============================================================================
static std::string MgStrToStd(struct mg_str s) {
    return s.buf ? std::string(s.buf, s.len) : std::string();
}

static std::string RemoteAddr(struct mg_connection* c) {
    char buf[64] = {};
    if (c->rem.is_ip6) {
        const uint8_t* b = c->rem.addr.ip;
        snprintf(buf, sizeof(buf),
            "[%02x%02x:%02x%02x:%02x%02x:%02x%02x:%02x%02x:%02x%02x:%02x%02x:%02x%02x]:%u",
            b[0],b[1],b[2],b[3],b[4],b[5],b[6],b[7],
            b[8],b[9],b[10],b[11],b[12],b[13],b[14],b[15],
            static_cast<unsigned>(mg_ntohs(c->rem.port)));
    } else {
        const uint8_t* b = c->rem.addr.ip;
        snprintf(buf, sizeof(buf), "%u.%u.%u.%u:%u",
            b[0], b[1], b[2], b[3],
            static_cast<unsigned>(mg_ntohs(c->rem.port)));
    }
    return std::string(buf);
}

// =============================================================================
//  Saved logs helpers
// =============================================================================

// Returns the "saved logs" folder path, always sibling to LOG_FILE,
// unless g_saved_logs_dir was set explicitly (when a directory was passed).
static std::string SavedLogsDir() {
    if (!g_saved_logs_dir.empty())
        return g_saved_logs_dir;
#ifdef _WIN32
    size_t sep = LOG_FILE.find_last_of("\\/");
#else
    size_t sep = LOG_FILE.find_last_of('/');
#endif
    std::string base = (sep != std::string::npos) ? LOG_FILE.substr(0, sep + 1) : "";
    return base + "saved logs";
}

// Ensures the "saved logs" folder exists. Returns true on success.
static bool EnsureSavedLogsDir() {
    std::string dir = SavedLogsDir();
#ifdef _WIN32
    DWORD attr = GetFileAttributesA(dir.c_str());
    if (attr == INVALID_FILE_ATTRIBUTES)
        return CreateDirectoryA(dir.c_str(), NULL) != 0;
    return (attr & FILE_ATTRIBUTE_DIRECTORY) != 0;
#else
    struct stat st;
    if (stat(dir.c_str(), &st) == 0)
        return S_ISDIR(st.st_mode);
    return mkdir(dir.c_str(), 0755) == 0;
#endif
}

// Returns the full path for a saved log file given a plain name.
static std::string SavedLogPath(const std::string& name) {
#ifdef _WIN32
    return SavedLogsDir() + "\\" + name + ".txt";
#else
    return SavedLogsDir() + "/" + name + ".txt";
#endif
}

// Returns the path to the live levelMap.txt (same directory as LOG_FILE).
static std::string LevelMapPath() {
#ifdef _WIN32
    size_t sep = LOG_FILE.find_last_of("\\/");
#else
    size_t sep = LOG_FILE.find_last_of('/');
#endif
    std::string dir = (sep != std::string::npos) ? LOG_FILE.substr(0, sep + 1) : "";
    return dir + "levelMap.txt";
}

// Returns the path to the shared saved logs levelMap.txt.
static std::string SavedLevelMapPath() {
    return SavedLogsDir() + "/levelMap.txt";
}

// Sanitise the name: strip path separators and dots that could escape the dir.
static std::string SanitiseName(const std::string& raw) {
    std::string out;
    out.reserve(raw.size());
    for (char ch : raw) {
        if (ch == '/' || ch == '\\' || ch == '.' || ch == ':') continue;
        out += ch;
    }
    return out;
}

// Reads the current log file and copies it verbatim to "saved logs/<name>.txt".
// Also merges the live levelMap.txt into the shared saved logs/levelMap.txt.
static bool SaveCurrentLog(const std::string& name, std::string& errMsg) {
    if (name.empty()) { errMsg = "empty name"; return false; }
    if (!EnsureSavedLogsDir()) { errMsg = "could not create saved logs folder"; return false; }

    std::ifstream src(LOG_FILE, std::ios::binary);
    if (!src.is_open()) { errMsg = "source log not readable"; return false; }

    std::string dest_path = SavedLogPath(name);
    std::ofstream dst(dest_path, std::ios::binary | std::ios::trunc);
    if (!dst.is_open()) { errMsg = "could not write " + dest_path; return false; }

    dst << src.rdbuf();

    // Merge live levelMap.txt into saved logs/levelMap.txt
    std::string liveLmPath = LevelMapPath();
    std::string savedLmPath = SavedLevelMapPath();

    // Load live levelMap
    json liveArr = json::array();
    {
        std::ifstream lmFile(liveLmPath);
        if (lmFile.is_open()) {
            lmFile.seekg(0, std::ios::end);
            long sz = lmFile.tellg();
            if (sz > 0) {
                lmFile.seekg(0, std::ios::beg);
                std::string buf(sz, '\0');
                lmFile.read(&buf[0], sz);
                try { liveArr = json::parse(buf); } catch (...) {}
            }
        }
    }

    if (liveArr.empty()) return true; // nothing to merge

    // Load saved levelMap (may not exist yet)
    json savedArr = json::array();
    {
        std::ifstream lmFile(savedLmPath);
        if (lmFile.is_open()) {
            lmFile.seekg(0, std::ios::end);
            long sz = lmFile.tellg();
            if (sz > 0) {
                lmFile.seekg(0, std::ios::beg);
                std::string buf(sz, '\0');
                lmFile.read(&buf[0], sz);
                try { savedArr = json::parse(buf); } catch (...) {}
            }
        }
    }

    // Build set of existing IDs in saved
    std::set<int32_t> savedIds;
    for (const auto& entry : savedArr) {
        if (entry.contains("id"))
            savedIds.insert(entry["id"].get<int32_t>());
    }

    // Append new entries from live
    for (const auto& entry : liveArr) {
        if (entry.contains("id")) {
            int32_t id = entry["id"].get<int32_t>();
            if (!savedIds.count(id)) {
                savedArr.push_back(entry);
                savedIds.insert(id);
            }
        }
    }

    // Write merged result
    {
        std::ofstream out(savedLmPath, std::ios::trunc);
        if (out.is_open()) {
            out << savedArr.dump();
        }
    }

    return true;
}

// Like ReadJsonLog but for a saved (static) file - builds a local offset index
// on each call so it can seekg directly to `after` without scanning from the top.
std::string ReadJsonLogFrom(const std::string& path, size_t after = 0) {
    std::lock_guard<std::mutex> lock(file_mutex);
    std::ifstream file(path);
    if (!file.is_open()) return "{\"events\":[],\"totalLines\":0}";

    // Build a local line-offset index for this file.
    std::vector<std::streampos> offsets;
    std::string line;
    while (true) {
        std::streampos pos = file.tellg();
        if (!std::getline(file, line)) break;
        if (line.empty() || line[0] == '=') continue;
        offsets.push_back(pos);
    }

    size_t totalLines = offsets.size();
    json arr = json::array();
    size_t nextAfter = after;

    if (after < totalLines) {
        file.clear();
        file.seekg(offsets[after]);
        int maxLines = 250, read = 0;
        while (read < maxLines && std::getline(file, line)) {
            if (line.empty() || line[0] == '=') continue;
            try { arr.push_back(json::parse(line)); } catch (...) {}
            ++read;
        }
        nextAfter = after + read;
    } else {
        nextAfter = totalLines;
    }

    json result;
    result["events"]     = arr;
    result["totalLines"] = totalLines;
    result["nextAfter"]  = nextAfter;
    return result.dump();
}

// =============================================================================
//  RawByteTailer — tracks byte offset for raw-text log files
// =============================================================================
class RawByteTailer {
public:
    RawByteTailer() {}
    explicit RawByteTailer(const std::string& path) : m_path(path) {}

    void setPath(const std::string& path) { m_path = path; }
    const std::string& path() const { return m_path; }
    bool isConfigured() const { return !m_path.empty(); }

    struct TailResult {
        std::string text;
        size_t nextOffset = 0;
        size_t totalSize  = 0;
    };

    TailResult tail(size_t after) {
        std::lock_guard<std::mutex> lock(m_mutex);
        TailResult r;
        r.nextOffset = after;

        std::ifstream file(m_path, std::ios::binary | std::ios::ate);
        if (!file.is_open()) return r;

        r.totalSize = static_cast<size_t>(file.tellg());
        if (r.totalSize < after) {
            r.nextOffset = 0;
            r.totalSize = 0;
            return r;
        }

        size_t bytes = r.totalSize - after;
        if (after == 0 && bytes > 1024 * 1024)  bytes = 1024 * 1024;
        else if (after > 0 && bytes > 256 * 1024) bytes = 256 * 1024;

        file.seekg(static_cast<std::streamoff>(after));
        r.text.resize(bytes);
        file.read(&r.text[0], bytes);
        r.text.resize(static_cast<size_t>(file.gcount()));
        r.nextOffset = after + r.text.size();
        return r;
    }

private:
    std::string m_path;
    std::mutex m_mutex;
};

static RawByteTailer g_emblem_tailer;
static RawByteTailer g_ascension_tailer;

// =============================================================================
//  SSE client tracking
// =============================================================================
enum SseLogType { SSE_MAIN = 0, SSE_EMBLEM = 1, SSE_ASCENSION = 2 };

struct SseClient {
    struct mg_connection* conn;
    SseLogType type;
    size_t lastOffset;
    std::string savedLogPath;  // empty = live log; non-empty = read from this path
};

static std::vector<SseClient> g_sse_clients;

static void RemoveSseClient(struct mg_connection* c) {
    auto it = std::remove_if(g_sse_clients.begin(), g_sse_clients.end(),
        [c](const SseClient& sc) { return sc.conn == c; });
    g_sse_clients.erase(it, g_sse_clients.end());
}

static void sendSseHeartbeat(struct mg_connection* c) {
    mg_send(c, ": heartbeat\n\n", 13);
}

static void sendRawTextSse(struct mg_connection* c, const std::string& text) {
    std::string frame;
    std::istringstream iss(text);
    std::string line;
    while (std::getline(iss, line))
        frame += "data: " + line + "\n";
    frame += "\n";
    mg_send(c, frame.c_str(), frame.size());
}

static void sendJsonSse(struct mg_connection* c, const json& j) {
    std::string payload = j.dump();
    std::string frame = "data: " + payload + "\n\n";
    mg_send(c, frame.c_str(), frame.size());
}

static const char SSE_HEADERS[] =
    "HTTP/1.1 200 OK\r\n"
    "Content-Type: text/event-stream\r\n"
    "Cache-Control: no-cache\r\n"
    "Connection: keep-alive\r\n"
    "\r\n";

static void sse_timer_cb(void* arg) {
    for (size_t i = 0; i < g_sse_clients.size(); ) {
        auto& client = g_sse_clients[i];
        bool advance = true;

        if (client.type == SSE_EMBLEM && g_emblem_tailer.isConfigured()) {
            auto r = g_emblem_tailer.tail(client.lastOffset);
            if (r.nextOffset > client.lastOffset) {
                sendRawTextSse(client.conn, r.text);
                client.lastOffset = r.nextOffset;
            } else {
                sendSseHeartbeat(client.conn);
            }
        } else if (client.type == SSE_ASCENSION && g_ascension_tailer.isConfigured()) {
            auto r = g_ascension_tailer.tail(client.lastOffset);
            if (r.nextOffset > client.lastOffset) {
                sendRawTextSse(client.conn, r.text);
                client.lastOffset = r.nextOffset;
            } else {
                sendSseHeartbeat(client.conn);
            }
        } else if (client.type == SSE_MAIN) {
            std::string body = client.savedLogPath.empty()
                ? ReadJsonLog(client.lastOffset)
                : ReadJsonLogFrom(client.savedLogPath, client.lastOffset);
            json j;
            try { j = json::parse(body); } catch (...) {}
            size_t nextAfter = j.value("nextAfter", client.lastOffset);
            if (nextAfter > client.lastOffset) {
                sendJsonSse(client.conn, j);
                client.lastOffset = nextAfter;
            } else {
                sendSseHeartbeat(client.conn);
            }
        } else {
            sendSseHeartbeat(client.conn);
        }

        if (advance) ++i;
    }
}

// =============================================================================
//  Mongoose event handler
// =============================================================================
static void fn(struct mg_connection *c, int ev, void *ev_data) {
    if (ev == MG_EV_CLOSE) {
        RemoveSseClient(c);
    } else if (ev == MG_EV_HTTP_MSG) {
        struct mg_http_message *hm = (struct mg_http_message *) ev_data;

        std::string uri    = MgStrToStd(hm->uri);
        std::string method = MgStrToStd(hm->method);
        std::string query  = MgStrToStd(hm->query);
        std::string remote = RemoteAddr(c);

        if (uri == "/" || g_static_files.count(uri.substr(1)) > 0) {
            std::string filename = (uri == "/") ? "index.html" : uri.substr(1);

            if (!g_local_mode) {
                // Remote mode – proxy from GitHub
                std::string url = std::string(REMOTE_BASE);
                url += (uri == "/") ? "/index.html" : uri;
                std::string body = FetchRemoteFile(url);
                if (!body.empty()) {
                    std::string ct_header = "Content-Type: " +
                        GetContentType(filename) + "\r\n";
                    mg_http_reply(c, 200, ct_header.c_str(), "%s", body.c_str());
                    HttpLog(200, method, uri, query, remote);
                } else {
                    mg_http_reply(c, 502, "Content-Type: text/plain\r\n", "Failed to fetch remote file");
                    HttpLog(502, method, uri, query, remote);
                }
            } else {
                // Local mode – read from disk
                std::string filepath = filename;
                std::ifstream file(filepath);
                if (file.good()) {
                    std::stringstream buffer;
                    buffer << file.rdbuf();
                    std::string body = buffer.str();
                    std::string ct_header = "Content-Type: " +
                        GetContentType(filename) + "\r\n";
                    mg_http_reply(c, 200, ct_header.c_str(), "%s", body.c_str());
                    HttpLog(200, method, uri, query, remote);
                } else {
                    mg_http_reply(c, 404, "Content-Type: text/plain\r\n", "File not found");
                    HttpLog(404, method, uri, query, remote);
                }
            }
        } else if (uri.find("/api/log") == 0) {
            size_t after = 0;
            struct mg_str q = hm->query;
            char after_buf[32] = {0};
            if (mg_http_get_var(&q, "after", after_buf, sizeof(after_buf)) > 0) {
                after = static_cast<size_t>(std::stoull(after_buf));
            }

            // If ?savedlog=<name> is present, serve that saved file instead.
            char savedlog_buf[256] = {0};
            std::string body;
            if (mg_http_get_var(&q, "savedlog", savedlog_buf, sizeof(savedlog_buf)) > 0) {
                std::string safe_name = SanitiseName(std::string(savedlog_buf));
                std::string saved_path = SavedLogPath(safe_name);
                std::ifstream check(saved_path);
                if (check.good()) {
                    body = ReadJsonLogFrom(saved_path, after);
                    mg_http_reply(c, 200, "Content-Type: application/json\r\nCache-Control: no-cache\r\n", "%s", body.c_str());
                    HttpLog(200, method, uri, query, remote);
                } else {
                    mg_http_reply(c, 404, "Content-Type: application/json\r\nCache-Control: no-cache\r\n",
                        "{\"error\":\"saved log not found\"}");
                    HttpLog(404, method, uri, query, remote);
                }
            } else {
                body = ReadJsonLog(after);
                mg_http_reply(c, 200, "Content-Type: application/json\r\nCache-Control: no-cache\r\n", "%s", body.c_str());
                HttpLog(200, method, uri, query, remote);
            }
        } else if (uri == "/api/levelmap") {
            std::string lmPath;
            char savedlog_buf[256] = {0};
            struct mg_str q = hm->query;
            if (mg_http_get_var(&q, "savedlog", savedlog_buf, sizeof(savedlog_buf)) > 0) {
                lmPath = SavedLevelMapPath();
            } else {
                lmPath = LevelMapPath();
            }

            std::ifstream lmFile(lmPath);
            if (lmFile.is_open()) {
                // Read entire file as proper JSON
                lmFile.seekg(0, std::ios::end);
                long sz = lmFile.tellg();
                lmFile.seekg(0, std::ios::beg);
                std::string body(sz, '\0');
                lmFile.read(&body[0], sz);

                // Validate it's a JSON array, wrap in {"entries":...} if needed
                try {
                    json arr = json::parse(body);
                    json result;
                    result["entries"] = arr;
                    body = result.dump();
                } catch (...) {
                    // Not valid JSON — return empty
                    body = "{\"entries\":[]}";
                }

                mg_http_reply(c, 200, "Content-Type: application/json\r\nCache-Control: no-cache\r\n", "%s", body.c_str());
                HttpLog(200, method, uri, query, remote);
            } else {
                mg_http_reply(c, 200, "Content-Type: application/json\r\nCache-Control: no-cache\r\n", "{\"entries\":[]}");
                HttpLog(200, method, uri, query, remote);
            }
        } else if (uri == "/savelog" && method == "POST") {
            // Expect JSON body: { "name": "<save name>" }
            std::string req_body = MgStrToStd(hm->body);
            std::string save_name;
            try {
                json j = json::parse(req_body);
                save_name = SanitiseName(j.value("name", ""));
            } catch (...) {}

            if (save_name.empty()) {
                mg_http_reply(c, 400, "Content-Type: application/json\r\nCache-Control: no-cache\r\n",
                    "{\"error\":\"missing or invalid name\"}");
                HttpLog(400, method, uri, query, remote);
            } else {
                std::string errMsg;
                if (SaveCurrentLog(save_name, errMsg)) {
                    ServerLog("Saved log as: %s", SavedLogPath(save_name).c_str());
                    std::string ok = "{\"ok\":true,\"file\":\"" + SavedLogPath(save_name) + "\"}";
                    mg_http_reply(c, 200, "Content-Type: application/json\r\nCache-Control: no-cache\r\n", "%s", ok.c_str());
                    HttpLog(200, method, uri, query, remote);
                } else {
                    std::string err = "{\"error\":\"" + errMsg + "\"}";
                    mg_http_reply(c, 500, "Content-Type: application/json\r\nCache-Control: no-cache\r\n", "%s", err.c_str());
                    HttpLog(500, method, uri, query, remote);
                }
            }
        } else if (uri == "/savedlogslist") {
            json names = json::array();
#ifdef _WIN32
            std::string pattern = SavedLogsDir() + "\\*.txt";
            WIN32_FIND_DATAA fd;
            HANDLE hFind = FindFirstFileA(pattern.c_str(), &fd);
            if (hFind != INVALID_HANDLE_VALUE) {
                do {
                    std::string fname = fd.cFileName;
                    // Strip ".txt" suffix
                    if (fname.size() > 4)
                        names.push_back(fname.substr(0, fname.size() - 4));
                } while (FindNextFileA(hFind, &fd));
                FindClose(hFind);
            }
#else
            DIR* dir = opendir(SavedLogsDir().c_str());
            if (dir) {
                struct dirent* entry;
                while ((entry = readdir(dir)) != nullptr) {
                    std::string fname = entry->d_name;
                    if (fname.size() > 4 && fname.substr(fname.size() - 4) == ".txt")
                        names.push_back(fname.substr(0, fname.size() - 4));
                }
                closedir(dir);
            }
#endif
            std::string body = json{{"logs", names}}.dump();
            mg_http_reply(c, 200, "Content-Type: application/json\r\nCache-Control: no-cache\r\n", "%s", body.c_str());
            HttpLog(200, method, uri, query, remote);
        } else if (uri == "/clear") {
            char savedlog_buf[256] = {0};
            struct mg_str q = hm->query;
            if (mg_http_get_var(&q, "savedlog", savedlog_buf, sizeof(savedlog_buf)) > 0) {
                // Move saved log to cleared_log.txt instead of deleting.
                std::string safe_name = SanitiseName(std::string(savedlog_buf));
                std::string saved_path = SavedLogPath(safe_name);
                std::ifstream check(saved_path);
                if (check.good()) {
                    check.close();
                    EnsureSavedLogsDir();
                    std::string cleared_path = SavedLogsDir() + "/cleared_log.txt";
                    std::rename(saved_path.c_str(), cleared_path.c_str());
                    ServerLog("Saved log moved to cleared_log.txt: %s", cleared_path.c_str());
                    mg_http_reply(c, 200, "Content-Type: application/json\r\nCache-Control: no-cache\r\n", "{\"ok\":true}");
                } else {
                    mg_http_reply(c, 404, "Content-Type: application/json\r\nCache-Control: no-cache\r\n", "{\"error\":\"file not found\"}");
                }
            } else {
                // Copy live log to cleared_log.txt (may be on a different fs), then truncate.
                EnsureSavedLogsDir();
                std::string cleared_path = SavedLogsDir() + "/cleared_log.txt";
                {
                    std::ifstream src(LOG_FILE, std::ios::binary);
                    if (src.good()) {
                        std::ofstream dst(cleared_path, std::ios::binary | std::ios::trunc);
                        dst << src.rdbuf();
                        ServerLog("Live log copied to cleared_log.txt: %s", cleared_path.c_str());
                    }
                }
                std::ofstream clear(LOG_FILE, std::ios::trunc);
                clear.close();
                InvalidateIndex();
                mg_http_reply(c, 200, "Content-Type: application/json\r\nCache-Control: no-cache\r\n", "{\"ok\":true}");
            }
            HttpLog(200, method, uri, query, remote);
        } else if (uri == "/cutlog") {
            struct mg_str q = hm->query;
            char offset_buf[32] = {0};
            size_t cutOffset = 0;
            if (mg_http_get_var(&q, "offset", offset_buf, sizeof(offset_buf)) > 0) {
                cutOffset = static_cast<size_t>(std::stoull(offset_buf));
            }

            std::lock_guard<std::mutex> lock(file_mutex);

            std::ifstream file(LOG_FILE);
            if (!file.is_open()) {
                mg_http_reply(c, 500, "Content-Type: application/json\r\nCache-Control: no-cache\r\n",
                    "{\"error\":\"cannot open log file\"}");
                HttpLog(500, method, uri, query, remote);
            } else {
                if (!g_index.valid) RebuildIndex(file);

                if (cutOffset >= g_index.offsets.size()) {
                    mg_http_reply(c, 400, "Content-Type: application/json\r\nCache-Control: no-cache\r\n",
                        "{\"error\":\"offset out of range\"}");
                    HttpLog(400, method, uri, query, remote);
                } else {
                    std::streampos byteOffset = g_index.offsets[cutOffset];
                    file.clear();
                    file.seekg(byteOffset);

                    std::stringstream buffer;
                    buffer << file.rdbuf();
                    std::string rest = buffer.str();
                    file.close();

                    std::ofstream out(LOG_FILE, std::ios::trunc);
                    out << rest;
                    out.close();

                    g_index.valid = false;
                    g_index.offsets.clear();
                    g_index.eof_offset = 0;

                    mg_http_reply(c, 200, "Content-Type: application/json\r\nCache-Control: no-cache\r\n",
                        "{\"ok\":true}");
                    HttpLog(200, method, uri, query, remote);
                }
            }
        } else if (uri == "/events") {
            struct mg_str q = hm->query;
            char after_buf[32] = {0};
            size_t after = 0;
            if (mg_http_get_var(&q, "after", after_buf, sizeof(after_buf)) > 0)
                after = static_cast<size_t>(std::stoull(after_buf));

            char savedlog_buf[256] = {0};
            std::string savedLogPath;
            if (mg_http_get_var(&q, "savedlog", savedlog_buf, sizeof(savedlog_buf)) > 0) {
                std::string safe_name = SanitiseName(std::string(savedlog_buf));
                std::string saved_path = SavedLogPath(safe_name);
                std::ifstream check(saved_path);
                if (!check.good()) {
                    mg_http_reply(c, 404, "Content-Type: application/json\r\nCache-Control: no-cache\r\n",
                        "{\"error\":\"saved log not found\"}");
                    HttpLog(404, method, uri, query, remote);
                    return;
                }
                savedLogPath = saved_path;
            }

            mg_send(c, SSE_HEADERS, sizeof(SSE_HEADERS) - 1);

            std::string body = savedLogPath.empty()
                ? ReadJsonLog(after)
                : ReadJsonLogFrom(savedLogPath, after);
            json j;
            try { j = json::parse(body); } catch (...) {}
            size_t nextAfter = j.value("nextAfter", after);

            if (after < nextAfter)
                sendJsonSse(c, j);
            else
                sendSseHeartbeat(c);

            SseClient sc;
            sc.conn = c;
            sc.type = SSE_MAIN;
            sc.lastOffset = nextAfter;
            sc.savedLogPath = savedLogPath;
            g_sse_clients.push_back(sc);
            HttpLog(200, method, uri, query, remote);
        } else if (uri == "/emblems" || uri == "/emblems/") {
            std::string fp = EMBLEM_DIR + "/gem_viewer.html";
            std::ifstream file(fp);
            if (file.good()) {
                std::stringstream buf; buf << file.rdbuf();
                mg_http_reply(c, 200, "Content-Type: text/html\r\n", "%s", buf.str().c_str());
                HttpLog(200, method, uri, query, remote);
            } else {
                mg_http_reply(c, 404, "", "Not Found");
                HttpLog(404, method, uri, query, remote);
            }
        } else if (uri.size() >= 9 && uri.compare(0, 9, "/emblems/") == 0) {
            std::string rest = uri.substr(9);
            if (rest == "log") {
                if (EMBLEM_LOG_PATH.empty()) {
                    ServerLog("GET /emblems/log — EMBLEM_LOG_PATH is empty (no -emblemlog set, default not found)");
                    mg_http_reply(c, 404, "Content-Type: text/plain\r\n", "Emblem log not configured");
                    HttpLog(404, method, uri, query, remote);
                } else {
                    ServerLog("GET /emblems/log — trying to read: %s", EMBLEM_LOG_PATH.c_str());
                    std::ifstream file(EMBLEM_LOG_PATH);
                    if (file.good()) {
                        std::stringstream buf; buf << file.rdbuf();
                        mg_http_reply(c, 200, "Content-Type: text/plain; charset=utf-8\r\nCache-Control: no-cache\r\n",
                            "%s", buf.str().c_str());
                        HttpLog(200, method, uri, query, remote);
                    } else {
                        ServerLog("GET /emblems/log — file NOT FOUND at path: %s", EMBLEM_LOG_PATH.c_str());
                        mg_http_reply(c, 404, "Content-Type: text/plain\r\n", "Log file not found");
                        HttpLog(404, method, uri, query, remote);
                    }
                }
            } else if (rest == "events") {
                if (!g_emblem_tailer.isConfigured()) {
                    ServerLog("GET /emblems/events — emblem tailer not configured (no log file to watch)");
                    mg_http_reply(c, 503, "Content-Type: text/plain\r\n", "Emblem log not configured");
                    HttpLog(503, method, uri, query, remote);
                } else {
                    struct mg_str q = hm->query;
                    char after_buf[32] = {0};
                    size_t after = 0;
                    if (mg_http_get_var(&q, "after", after_buf, sizeof(after_buf)) > 0)
                        after = static_cast<size_t>(std::stoull(after_buf));

                    mg_send(c, SSE_HEADERS, sizeof(SSE_HEADERS) - 1);
                    auto r = g_emblem_tailer.tail(after);
                    if (r.nextOffset > after)
                        sendRawTextSse(c, r.text);
                    else
                        sendSseHeartbeat(c);

                    SseClient sc;
                    sc.conn = c;
                    sc.type = SSE_EMBLEM;
                    sc.lastOffset = r.nextOffset;
                    g_sse_clients.push_back(sc);
                    HttpLog(200, method, uri, query, remote);
                }
            } else {
                if (rest.find("..") != std::string::npos) {
                    mg_http_reply(c, 404, "", "Not Found");
                    HttpLog(404, method, uri, query, remote);
                } else {
                    std::string fp = EMBLEM_DIR + "/" + rest;
                    std::ifstream file(fp);
                    if (file.good()) {
                        std::stringstream buf; buf << file.rdbuf();
                        std::string ct = "Content-Type: " + GetContentType(rest) + "\r\n";
                        mg_http_reply(c, 200, ct.c_str(), "%s", buf.str().c_str());
                        HttpLog(200, method, uri, query, remote);
                    } else {
                        mg_http_reply(c, 404, "", "Not Found");
                        HttpLog(404, method, uri, query, remote);
                    }
                }
            }
        } else if (uri == "/ascension" || uri == "/ascension/") {
            std::string fp = ASCENSION_DIR + "/index.html";
            std::ifstream file(fp);
            if (file.good()) {
                std::stringstream buf; buf << file.rdbuf();
                mg_http_reply(c, 200, "Content-Type: text/html\r\n", "%s", buf.str().c_str());
                HttpLog(200, method, uri, query, remote);
            } else {
                mg_http_reply(c, 404, "", "Not Found");
                HttpLog(404, method, uri, query, remote);
            }
        } else if (uri.size() >= 11 && uri.compare(0, 11, "/ascension/") == 0) {
            std::string rest = uri.substr(11);
            if (rest == "log") {
                if (ASCENSION_LOG_PATH.empty()) {
                    ServerLog("GET /ascension/log — ASCENSION_LOG_PATH is empty (no -ascensionlog set, default not found)");
                    mg_http_reply(c, 404, "Content-Type: text/plain\r\n", "Ascension log not configured");
                    HttpLog(404, method, uri, query, remote);
                } else {
                    ServerLog("GET /ascension/log — trying to read: %s", ASCENSION_LOG_PATH.c_str());
                    std::ifstream file(ASCENSION_LOG_PATH);
                    if (file.good()) {
                        std::stringstream buf; buf << file.rdbuf();
                        mg_http_reply(c, 200, "Content-Type: text/plain; charset=utf-8\r\nCache-Control: no-cache\r\n",
                            "%s", buf.str().c_str());
                        HttpLog(200, method, uri, query, remote);
                    } else {
                        ServerLog("GET /ascension/log — file NOT FOUND at path: %s", ASCENSION_LOG_PATH.c_str());
                        mg_http_reply(c, 404, "Content-Type: text/plain\r\n", "Log file not found");
                        HttpLog(404, method, uri, query, remote);
                    }
                }
            } else if (rest == "events") {
                if (!g_ascension_tailer.isConfigured()) {
                    ServerLog("GET /ascension/events — ascension tailer not configured (no log file to watch)");
                    mg_http_reply(c, 503, "Content-Type: text/plain\r\n", "Ascension log not configured");
                    HttpLog(503, method, uri, query, remote);
                } else {
                    struct mg_str q = hm->query;
                    char after_buf[32] = {0};
                    size_t after = 0;
                    if (mg_http_get_var(&q, "after", after_buf, sizeof(after_buf)) > 0)
                        after = static_cast<size_t>(std::stoull(after_buf));

                    mg_send(c, SSE_HEADERS, sizeof(SSE_HEADERS) - 1);
                    auto r = g_ascension_tailer.tail(after);
                    if (r.nextOffset > after)
                        sendRawTextSse(c, r.text);
                    else
                        sendSseHeartbeat(c);

                    SseClient sc;
                    sc.conn = c;
                    sc.type = SSE_ASCENSION;
                    sc.lastOffset = r.nextOffset;
                    g_sse_clients.push_back(sc);
                    HttpLog(200, method, uri, query, remote);
                }
            } else {
                if (rest.find("..") != std::string::npos) {
                    mg_http_reply(c, 404, "", "Not Found");
                    HttpLog(404, method, uri, query, remote);
                } else {
                    std::string fp = ASCENSION_DIR + "/" + rest;
                    std::ifstream file(fp);
                    if (file.good()) {
                        std::stringstream buf; buf << file.rdbuf();
                        std::string ct = "Content-Type: " + GetContentType(rest) + "\r\n";
                        mg_http_reply(c, 200, ct.c_str(), "%s", buf.str().c_str());
                        HttpLog(200, method, uri, query, remote);
                    } else {
                        mg_http_reply(c, 404, "", "Not Found");
                        HttpLog(404, method, uri, query, remote);
                    }
                }
            }
        } else {
            mg_http_reply(c, 404, "", "Not Found");
            HttpLog(404, method, uri, query, remote);
        }
    }
}

// =============================================================================
//  Main
// =============================================================================
int main(int argc, char** argv) {
    // Scan all arguments: last arg that doesn't start with '-' is the log path;
    // '-local' anywhere enables local file serving mode.
    // '-emblemlog <path>' and '-ascensionlog <path>' configure tracker logs.
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "-local")
            g_local_mode = true;
        else if (arg == "-emblemlog" && i + 1 < argc)
            EMBLEM_LOG_PATH = argv[++i];
        else if (arg == "-ascensionlog" && i + 1 < argc)
            ASCENSION_LOG_PATH = argv[++i];
        else
            LOG_FILE = argv[i];
    }

    // If a directory was passed, use it for saved logs and read live log from the default path.
    if (!LOG_FILE.empty()) {
        struct stat st;
        if (stat(LOG_FILE.c_str(), &st) == 0 && S_ISDIR(st.st_mode)) {
            g_saved_logs_dir = LOG_FILE + "/saved logs";
            LOG_FILE = GetDefaultLogPath();
        }
    }

    if (LOG_FILE.empty())
        LOG_FILE = GetDefaultLogPath();

    // Default emblems/ascension logs to the same folder as the saved logs folder
    // (i.e. the directory containing LOG_FILE, or the user-passed directory if one was given).
    {
        std::string base_dir;
        if (!g_saved_logs_dir.empty()) {
            // User passed a directory — derive base_dir from it (strip "/saved logs" suffix)
            const std::string suffix = "/saved logs";
            if (g_saved_logs_dir.size() > suffix.size() &&
                g_saved_logs_dir.compare(g_saved_logs_dir.size() - suffix.size(),
                    suffix.size(), suffix) == 0) {
                base_dir = g_saved_logs_dir.substr(0,
                    g_saved_logs_dir.size() - suffix.size()) + "/";
            }
        }
        if (base_dir.empty()) {
            size_t sep = LOG_FILE.find_last_of("\\/");
            base_dir = (sep != std::string::npos) ? LOG_FILE.substr(0, sep + 1) : "";
        }
        ServerLog("LOG_FILE: %s  =>  base_dir for emblem/ascension defaults: \"%s\"",
            LOG_FILE.c_str(), base_dir.c_str());
        if (EMBLEM_LOG_PATH.empty()) {
            EMBLEM_LOG_PATH = base_dir + "http_log.txt";
            ServerLog("EMBLEM_LOG_PATH defaulted to: %s", EMBLEM_LOG_PATH.c_str());
        }
        if (ASCENSION_LOG_PATH.empty()) {
            ASCENSION_LOG_PATH = base_dir + "star_tower_log.txt";
            ServerLog("ASCENSION_LOG_PATH defaulted to: %s", ASCENSION_LOG_PATH.c_str());
        }
    }

    if (!g_local_mode)
        ServerLog("Fetching files automatically from github, run with \"-local\" to use local files.");
    ScanStaticFolder(".");

    {
        std::ifstream ef(EMBLEM_LOG_PATH);
        if (ef.good()) {
            g_emblem_tailer.setPath(EMBLEM_LOG_PATH);
            ServerLog("Emblem log: %s", EMBLEM_LOG_PATH.c_str());
        } else {
            ServerLog("Emblem log NOT FOUND: %s", EMBLEM_LOG_PATH.c_str());
        }
    }
    {
        std::ifstream af(ASCENSION_LOG_PATH);
        if (af.good()) {
            g_ascension_tailer.setPath(ASCENSION_LOG_PATH);
            ServerLog("Ascension log: %s", ASCENSION_LOG_PATH.c_str());
        } else {
            ServerLog("Ascension log NOT FOUND: %s", ASCENSION_LOG_PATH.c_str());
        }
    }
    // Check if file or folder exists
#ifdef _WIN32
    std::string folderPath = LOG_FILE;
    size_t lastSlash = folderPath.find_last_of("\\/");
    if (lastSlash != std::string::npos) {
        folderPath = folderPath.substr(0, lastSlash);
        DWORD attr = GetFileAttributesA(folderPath.c_str());
        if (attr == INVALID_FILE_ATTRIBUTES || !(attr & FILE_ATTRIBUTE_DIRECTORY)) {
            ServerLog("WARNING: Folder does not exist: %s", folderPath.c_str());
            ServerLog("It gets created after you open the game once.");
            ServerLog("If it still doesn't find it, run: log_viewer.exe \"path/to/ss_jsonlog.txt\"");
        }
    }
    DWORD fileAttr = GetFileAttributesA(LOG_FILE.c_str());
    if (fileAttr == INVALID_FILE_ATTRIBUTES) {
        ServerLog("WARNING: File does not exist: %s", LOG_FILE.c_str());
    }
#else
    {
        std::string folderPath = "/dev/shm/StellaSoraLogger";
        struct stat st;
        if (stat(folderPath.c_str(), &st) != 0) {
            mkdir(folderPath.c_str(), 0755);
            ServerLog("Created log directory: %s", folderPath.c_str());
        }
    }
    std::ifstream testFile(LOG_FILE);
    if (!testFile.good()) {
        ServerLog("WARNING: File does not exist: %s", LOG_FILE.c_str());
    }
#endif

    ServerLog("Reading log from: %s", LOG_FILE.c_str());
    ServerLog("Mode: %s", g_local_mode ? "local (serving files from disk)" : "remote (serving files from GitHub)");
    mg_log_set(MG_LL_NONE);

    struct mg_mgr mgr;
    mg_mgr_init(&mgr);

    const char* url = "http://0.0.0.0:9299";
    mg_http_listen(&mgr, url, fn, NULL);

    mg_timer_add(&mgr, 500, MG_TIMER_REPEAT, sse_timer_cb, &mgr);

    ServerLog("Listening on http://localhost:9299");
    ServerLog("Press Ctrl+C to stop.");

#ifndef _WIN32
    system("xdg-open http://localhost:9299 &");
    printf("\n\033[2m%-10s %-6s  %-24s  %s\033[0m\n", "time", "code", "path", "remote");
    printf("\033[2m%.10s %.6s  %.24s  %.16s\033[0m\n",
           "----------","------","------------------------","----------------");
#else
    ShellExecuteA(NULL, "open", "http://localhost:9299", NULL, NULL, SW_SHOWNORMAL);
    printf("\n%-10s %-6s  %-24s  %s\n", "time", "code", "path", "remote");
#endif

    for (;;) mg_mgr_poll(&mgr, 1000);

    mg_mgr_free(&mgr);
    return 0;
}
