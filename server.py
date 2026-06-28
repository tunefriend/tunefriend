#!/usr/bin/env python3
"""TuneFriend — static file server + Subsonic API proxy for CORS."""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MAX_BODY = 50 * 1024 * 1024  # 50 MB for audio streams


class TuneFriendHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/proxy":
            self._handle_proxy(parsed)
            return
        if parsed.path == "/api/health":
            self._json_response({"ok": True, "app": "TuneFriend"})
            return
        return super().do_GET()

    def _handle_proxy(self, parsed):
        qs = urllib.parse.parse_qs(parsed.query)
        server = (qs.get("server") or [""])[0].rstrip("/")
        endpoint = (qs.get("endpoint") or [""])[0]

        if not server or not endpoint:
            self._json_response({"error": "Missing server or endpoint"}, 400)
            return

        if not endpoint.endswith(".view"):
            self._json_response({"error": "Invalid endpoint"}, 400)
            return

        proxy_params = {k: v[0] for k, v in qs.items() if k not in ("server", "endpoint")}
        target = f"{server}/rest/{endpoint}?{urllib.parse.urlencode(proxy_params)}"

        try:
            req = urllib.request.Request(target, headers={"User-Agent": "TuneFriend/1.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = resp.read(MAX_BODY + 1)
                if len(body) > MAX_BODY:
                    self._json_response({"error": "Response too large"}, 502)
                    return
                content_type = resp.headers.get("Content-Type", "application/octet-stream")
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Cache-Control", "no-cache")
                cl = resp.headers.get("Content-Length")
                if cl:
                    self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        except urllib.error.HTTPError as e:
            self._json_response({"error": f"Upstream HTTP {e.code}"}, 502)
        except urllib.error.URLError as e:
            self._json_response({"error": f"Cannot reach server: {e.reason}"}, 502)
        except Exception as e:
            self._json_response({"error": str(e)}, 500)

    def _json_response(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def guess_type(self, path):
        ctype = super().guess_type(path)
        if path.endswith(".js"):
            return "application/javascript"
        if path.endswith(".json"):
            return "application/json"
        if path.endswith(".svg"):
            return "image/svg+xml"
        return ctype


def main():
    parser = argparse.ArgumentParser(description="TuneFriend music app server")
    parser.add_argument("--host", default="0.0.0.0", help="Bind address (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8765, help="Port (default: 8765)")
    args = parser.parse_args()

    os.chdir(ROOT)
    server = HTTPServer((args.host, args.port), TuneFriendHandler)
    print(f"TuneFriend running at http://{args.host}:{args.port}")
    print(f"  On your phone, open: http://<your-computer-ip>:{args.port}")
    print("  Press Ctrl+C to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        server.server_close()


if __name__ == "__main__":
    main()