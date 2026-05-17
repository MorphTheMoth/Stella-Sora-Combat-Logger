#include <cstdio>
#include <cstdlib>
#include <ctime>
#include <string>
#include <fstream>
#include <sstream>
#include <mutex>
#include <vector>
#include <algorithm>

#ifdef _WIN32
    #define WIN32_LEAN_AND_MEAN
    #include <windows.h>
    #include <shlobj.h>
    #include <shellapi.h>
#else
    #include <unistd.h>
    #include <pwd.h>
    #include <sys/types.h>
#endif

#include "mongoose.h"
#include "json.hpp"

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
//  Global log file path
// =============================================================================
std::string LOG_FILE;

std::string GetDefaultLogPath() {
#ifdef _WIN32
    char path[MAX_PATH];
    if (SHGetFolderPathA(NULL, CSIDL_LOCAL_APPDATA, NULL, 0, path) == S_OK)
        return std::string(path) + "\\Stella Sora Combat Logger\\ss_jsonlog.txt";
    return std::string("ss_jsonlog.txt");
#else
    printf("No log file in the arguments, usage: `log_viewer [path/to/ss_jsonlog.txt]`\n");
    exit(0);
#endif
}

// =============================================================================
//  Thread-safe file reading
// =============================================================================
std::mutex file_mutex;

// Returns a JSON object: { "events": [...], "totalLines": N }
std::string ReadJsonLog(size_t after = 0) {
    std::lock_guard<std::mutex> lock(file_mutex);
    std::ifstream file(LOG_FILE);
    if (!file.is_open()) return "{\"events\":[],\"totalLines\":0}";

    json arr = json::array();
    std::string line;
    size_t totalLines = 0;
    
    // Count total lines first (excluding empty/comment lines)
    std::ifstream countFile(LOG_FILE);
    std::string dummy;
    while (std::getline(countFile, dummy)) {
        if (!dummy.empty() && dummy[0] != '=') totalLines++;
    }
    
    // Now read and parse only lines after `after`
    size_t currentLine = 0;
    while (std::getline(file, line)) {
        if (line.empty() || line[0] == '=') continue;
        if (currentLine >= after) {
            try {
                arr.push_back(json::parse(line));
            } catch (...) {}
        }
        currentLine++;
    }
    
    json result;
    result["events"] = arr;
    result["totalLines"] = totalLines;
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
//  Mongoose event handler
// =============================================================================
static void fn(struct mg_connection *c, int ev, void *ev_data) {
    if (ev == MG_EV_HTTP_MSG) {
        struct mg_http_message *hm = (struct mg_http_message *) ev_data;

        std::string uri    = MgStrToStd(hm->uri);
        std::string method = MgStrToStd(hm->method);
        std::string query  = MgStrToStd(hm->query);
        std::string remote = RemoteAddr(c);

        if (uri == "/") {
            std::ifstream file("ui.html");
            if (file.good()) {
                std::stringstream buffer;
                buffer << file.rdbuf();
                std::string html = buffer.str();
                mg_http_reply(c, 200, "Content-Type: text/html\r\n", "%s", html.c_str());
                HttpLog(200, method, uri, query, remote);
            } else {
                mg_http_reply(c, 404, "Content-Type: text/html\r\n",
                    "<html><body><h1>ui.html not found</h1></body></html>");
                HttpLog(404, method, uri, query, remote);
            }
        } else if (uri.find("/api/log") == 0) {
            size_t after = 0;
            struct mg_str q = hm->query;
            char after_buf[32] = {0};
            if (mg_http_get_var(&q, "after", after_buf, sizeof(after_buf)) > 0) {
                after = static_cast<size_t>(std::stoull(after_buf));
            }
            std::string body = ReadJsonLog(after);
            mg_http_reply(c, 200, "Content-Type: application/json\r\n", "%s", body.c_str());
            HttpLog(200, method, uri, query, remote);
        } else if (uri == "/clear") {
            std::ofstream clear(LOG_FILE, std::ios::trunc);
            clear.close();
            mg_http_reply(c, 200, "Content-Type: application/json\r\n", "{\"ok\":true}");
            HttpLog(200, method, uri, query, remote);
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
    if (argc > 1) {
        LOG_FILE = argv[1];
    } else {
        LOG_FILE = GetDefaultLogPath();
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
    std::ifstream testFile(LOG_FILE);
    if (!testFile.good()) {
        ServerLog("WARNING: File does not exist: %s", LOG_FILE.c_str());
    }
#endif

    ServerLog("Reading log from: %s", LOG_FILE.c_str());
    mg_log_set(MG_LL_NONE);

    struct mg_mgr mgr;
    mg_mgr_init(&mgr);

    const char* url = "http://0.0.0.0:9299";
    mg_http_listen(&mgr, url, fn, NULL);

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
