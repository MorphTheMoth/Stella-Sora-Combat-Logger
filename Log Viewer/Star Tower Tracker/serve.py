#!/usr/bin/env python3
import sys, os, time, threading, webbrowser, json, mimetypes
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn

if len(sys.argv) < 2:
    print("usage: python serve.py <path/to/star_tower_log.txt>")
    sys.exit(1)

LOG_PATH  = os.path.abspath(sys.argv[1])
ROOT_DIR  = os.path.dirname(os.path.abspath(__file__))

if not os.path.isfile(LOG_PATH):
    print(f"error: log file not found: {LOG_PATH}")
    sys.exit(1)

_clients = []
_clients_lock = threading.Lock()

def broadcast():
    with _clients_lock:
        for q in _clients:
            q.append(True)

def watch_log():
    last_mtime = None
    while True:
        try:
            mtime = os.path.getmtime(LOG_PATH)
            if last_mtime is not None and mtime != last_mtime:
                print(f"[watch] log changed, broadcasting")
                broadcast()
            last_mtime = mtime
        except OSError:
            pass
        time.sleep(0.5)

MIME_MAP = {
    ".html": "text/html",
    ".css":  "text/css",
    ".js":   "application/javascript",
    ".json": "application/json",
    ".png":  "image/png",
    ".webp": "image/webp",
    ".jpg":  "image/jpeg",
    ".txt":  "text/plain; charset=utf-8",
}

class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?")[0]

        if path in ("/", "/index.html"):
            self.serve_file(os.path.join(ROOT_DIR, "index.html"), "text/html")
        elif path == "/star_tower_log.txt":
            self.serve_file(LOG_PATH, "text/plain; charset=utf-8")
        elif path == "/events":
            self.serve_sse()
        else:
            # Try serving static files from ROOT_DIR
            safe = os.path.normpath(path).lstrip("/")
            filepath = os.path.join(ROOT_DIR, safe)
            if os.path.isfile(filepath) and os.path.commonpath([ROOT_DIR, filepath]) == ROOT_DIR:
                ext = os.path.splitext(filepath)[1].lower()
                mime = MIME_MAP.get(ext, "application/octet-stream")
                self.serve_file(filepath, mime)
            else:
                self.send_error(404)

    def serve_file(self, path, mime):
        try:
            with open(path, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", len(data))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(data)
        except:
            self.send_error(404)

    def serve_sse(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        queue = []
        with _clients_lock:
            _clients.append(queue)
        try:
            while True:
                if queue:
                    queue.clear()
                    self.wfile.write(b"data: update\n\n")
                    self.wfile.flush()
                else:
                    self.wfile.write(b": heartbeat\n\n")
                    self.wfile.flush()
                time.sleep(1)
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            with _clients_lock:
                if queue in _clients:
                    _clients.remove(queue)

    def log_message(self, fmt, *args):
        pass

PORT = 8766
threading.Thread(target=watch_log, daemon=True).start()
print(f"serving on http://localhost:{PORT}")
print(f"log: {LOG_PATH}")
webbrowser.open(f"http://localhost:{PORT}")
ThreadedHTTPServer(("localhost", PORT), Handler).serve_forever()
