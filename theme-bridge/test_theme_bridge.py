"""Tests for the C2 Home PC theme bridge."""
import http.client
import json
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path

from PIL import Image

import c2_theme_bridge as bridge


def make_state(root: Path, theme="test-theme", accent="#3264eb", size=(1200, 800)):
    theme_dir = root / "theme"
    theme_dir.mkdir(parents=True, exist_ok=True)
    (root / "theme.name").write_text(theme + "\n")
    (theme_dir / "colors.toml").write_text(
        f'mode = "light"\naccent = "{accent}"\nforeground = "#212121"\nbackground = "#fafafa"\n'
    )
    image_path = theme_dir / "background.jpg"
    Image.new("RGB", size, "#d0c0b0").save(image_path, "JPEG")
    link = root / "background"
    if link.exists() or link.is_symlink():
        link.unlink()
    link.symlink_to(image_path)
    return root


def start_server(root: Path, max_width=2560):
    state = bridge.ThemeState(root)
    state.refresh()
    broadcaster = bridge.Broadcaster()
    server = bridge.BridgeServer(("127.0.0.1", 0), bridge.Handler, state,
                                 broadcaster, "test-token", max_width)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, state, broadcaster


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = make_state(Path(self.tmp.name))

    def tearDown(self):
        self.tmp.cleanup()

    def test_snapshot_reads_palette_and_wallpaper_identity(self):
        snapshot = bridge.read_snapshot(self.root)
        self.assertEqual(snapshot.theme, "test-theme")
        self.assertEqual(snapshot.accent, "#3264eb")
        self.assertEqual(snapshot.foreground, "#212121")
        self.assertEqual(snapshot.mode, "light")
        self.assertTrue(snapshot.wallpaper_version)
        self.assertTrue(snapshot.theme_version)
        self.assertEqual(snapshot.wallpaper_path.name, "background.jpg")

    def test_http_requires_token_and_serves_theme(self):
        server, _, _ = start_server(self.root)
        port = server.server_port
        try:
            conn = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
            conn.request("GET", "/api/theme")
            self.assertEqual(conn.getresponse().status, 401)
            conn.close()

            conn = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
            conn.request("GET", "/api/theme?token=test-token")
            response = conn.getresponse()
            body = json.loads(response.read())
            self.assertEqual(response.status, 200)
            self.assertEqual(body["theme"], "test-theme")
            self.assertEqual(body["wallpaper"], "/api/wallpaper?v=" + body["wallpaperVersion"])
            self.assertEqual(response.getheader("Access-Control-Allow-Origin"), "*")
            conn.close()
        finally:
            server.shutdown()
            server.server_close()

    def test_wallpaper_is_resized_and_has_etag(self):
        server, _, _ = start_server(self.root, max_width=2560)
        port = server.server_port
        try:
            conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
            conn.request("GET", "/api/wallpaper?token=test-token")
            response = conn.getresponse()
            data = response.read()
            etag = response.getheader("ETag")
            self.assertEqual(response.status, 200)
            self.assertEqual(response.getheader("Content-Type"), "image/jpeg")
            self.assertTrue(data.startswith(b"\xff\xd8\xff"))
            self.assertIsNotNone(etag)
            conn.close()

            conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
            conn.request("GET", "/api/wallpaper?token=test-token",
                         headers={"If-None-Match": etag})
            response = conn.getresponse()
            self.assertEqual(response.status, 304)
            self.assertEqual(response.read(), b"")
            conn.close()
        finally:
            server.shutdown()
            server.server_close()

    def test_large_wallpaper_is_capped(self):
        make_state(self.root, size=(4000, 3000))
        snapshot = bridge.read_snapshot(self.root)
        data, mime = bridge.render_wallpaper(snapshot, 2560)
        self.assertEqual(mime, "image/jpeg")
        with Image.open(__import__("io").BytesIO(data)) as image:
            self.assertLessEqual(image.width, 2560)
            self.assertEqual(image.format, "JPEG")

    def test_sse_sends_initial_and_changed_state(self):
        server, state, broadcaster = start_server(self.root)
        port = server.server_port
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        try:
            conn.request("GET", "/events?token=test-token")
            response = conn.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(response.getheader("Content-Type"), "text/event-stream; charset=utf-8")
            event = read_event(response)
            self.assertEqual(event["event"], "theme")
            first = json.loads(event["data"])
            self.assertEqual(first["theme"], "test-theme")

            (self.root / "theme.name").write_text("changed-theme\n")
            (self.root / "theme" / "colors.toml").write_text(
                'mode = "dark"\naccent = "#ff8800"\nforeground = "#eeeeee"\nbackground = "#111111"\n'
            )
            self.assertTrue(state.refresh())
            broadcaster.publish(state.current())
            event = read_event(response)
            changed = json.loads(event["data"])
            self.assertEqual(changed["theme"], "changed-theme")
            self.assertEqual(changed["accent"], "#ff8800")
        finally:
            conn.close()
            server.shutdown()
            server.server_close()

    def test_watcher_notices_theme_change(self):
        state = bridge.ThemeState(self.root)
        state.refresh()
        broadcaster = bridge.Broadcaster()
        stop = threading.Event()
        watcher = bridge.StateWatcher(state, broadcaster, stop)
        watcher.start()
        try:
            time.sleep(0.3)
            (self.root / "theme.name").write_text("watched-theme\n")
            deadline = time.time() + 4
            while time.time() < deadline and state.current().theme != "watched-theme":
                time.sleep(0.05)
            self.assertEqual(state.current().theme, "watched-theme")
        finally:
            stop.set()
            watcher.join(timeout=3)


def read_event(response):
    event = None
    data = []
    while True:
        line = response.readline().decode().rstrip("\n")
        if line == "":
            if event is not None:
                return {"event": event, "data": "\n".join(data)}
            continue
        if line.startswith("event: "):
            event = line[7:]
        elif line.startswith("data: "):
            data.append(line[6:])
        elif line.startswith(":"):
            continue


if __name__ == "__main__":
    unittest.main()
