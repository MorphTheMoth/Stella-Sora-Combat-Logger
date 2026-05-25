#!/usr/bin/env python3
import sys
import os
import time
import threading
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn

if len(sys.argv) < 2:
    print("usage: python serve.py <path/to/http_log.txt>")
    sys.exit(1)

LOG_PATH  = os.path.abspath(sys.argv[1])
HTML_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gem_viewer.html")

if not os.path.isfile(LOG_PATH):
    print(f"error: log file not found: {LOG_PATH}")
    sys.exit(1)
if not os.path.isfile(HTML_PATH):
    print(f"error: gem_viewer.html not found next to serve.py")
    sys.exit(1)

# ── SSE clients ──────────────────────────────────────────────────────────────
_clients = []
_clients_lock = threading.Lock()

def broadcast():
    with _clients_lock:
        for q in _clients:
            q.append(True)

# ── File watcher thread ──────────────────────────────────────────────────────
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

# ── Threaded HTTP server ─────────────────────────────────────────────────────
class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self.serve_file(HTML_PATH, "text/html")
        elif self.path == "/http_log.txt":
            self.serve_file(LOG_PATH, "text/plain; charset=utf-8")
        elif self.path == "/events":
            self.serve_sse()
        else:
            self.send_error(404)

    def serve_file(self, path, mime):
        with open(path, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", len(data))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

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
            # heartbeat loop — no initial ping so onmessage doesn't fire on connect
            while True:
                if queue:
                    queue.clear()
                    self.wfile.write(b"data: update\n\n")
                    self.wfile.flush()
                else:
                    # comment line keeps connection alive without triggering onmessage
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

# ── Main ─────────────────────────────────────────────────────────────────────
PORT = 8765
threading.Thread(target=watch_log, daemon=True).start()
print(f"serving on http://localhost:{PORT}")
print(f"log: {LOG_PATH}")
webbrowser.open(f"http://localhost:{PORT}")
ThreadedHTTPServer(("localhost", PORT), Handler).serve_forever()
