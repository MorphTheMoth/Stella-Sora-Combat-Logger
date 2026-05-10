#include <cstdio>
#include <cstdlib>
#include <string>
#include <fstream>
#include <sstream>
#include <mutex>
#include <vector>
#include <algorithm>   // for min

#ifdef _WIN32
    #define WIN32_LEAN_AND_MEAN
    #include <windows.h>
    #include <shlobj.h>
#else
    #include <unistd.h>
    #include <pwd.h>
    #include <sys/types.h>
#endif

#include "mongoose.h"
#include "json.hpp"

using json = nlohmann::json;

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
    printf("No log file in the arguments, usage: ./log_viewer [path/to/ss_jsonlog.txt]");
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
//  Mongoose event handler
// =============================================================================
static void fn(struct mg_connection *c, int ev, void *ev_data) {
    if (ev == MG_EV_HTTP_MSG) {
        struct mg_http_message *hm = (struct mg_http_message *) ev_data;
        std::string uri(hm->uri.buf, hm->uri.len);
        
        if (uri == "/") {
            // Serve ui.html from the same directory as the executable
            std::ifstream file("ui.html");
            if (file.good()) {
                std::stringstream buffer;
                buffer << file.rdbuf();
                std::string html = buffer.str();
                mg_http_reply(c, 200, "Content-Type: text/html\r\n", "%s", html.c_str());
            } else {
                mg_http_reply(c, 200, "Content-Type: text/html\r\n", 
                    "<html><body><h1>ui.html not found</h1></body></html>");
            }
        } else if (uri.find("/api/log") == 0) {
            // Check for ?after= parameter
            size_t after = 0;
            struct mg_str query = hm->query;
            char after_buf[32] = {0};
            if (mg_http_get_var(&query, "after", after_buf, sizeof(after_buf)) > 0) {
                after = static_cast<size_t>(std::stoull(after_buf));
            }
            std::string json = ReadJsonLog(after);
            mg_http_reply(c, 200, "Content-Type: application/json\r\n", "%s", json.c_str());
        } else {
            mg_http_reply(c, 404, "", "Not Found");
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
    
    printf("Reading log from: %s\n", LOG_FILE.c_str());
    
    struct mg_mgr mgr;
    mg_mgr_init(&mgr);
    
    const char* url = "http://0.0.0.0:8080";
    mg_http_listen(&mgr, url, fn, NULL);
    
    printf("Server running at %s\n", url);
    printf("Press Ctrl+C to stop.\n");
    
    for (;;) mg_mgr_poll(&mgr, 1000);
    
    mg_mgr_free(&mgr);
    return 0;
}
