#!/usr/bin/env python3
"""Build the Home-id variant of the launcher for the Home takeover."""
import json, shutil
from pathlib import Path

ROOT = Path(__file__).parent
SRC = ROOT / "dist"
OUT = ROOT / "homeapp"

if OUT.exists():
    shutil.rmtree(OUT)
OUT.mkdir()

for p in SRC.iterdir():
    if p.name == "appinfo.json":
        continue
    if p.is_dir():
        shutil.copytree(p, OUT / p.name)
    else:
        shutil.copy2(p, OUT / p.name)

manifest = {
    "id": "com.webos.app.home",
    "version": "1.0.0",
    "vendor": "Personal project",
    "type": "web",
    "main": "index.html",
    "title": "Home",
    "icon": "icon.png",
    "largeIcon": "large-icon.png",
    "iconColor": "#173326",
    "bgColor": "#0b100d",
    "resolution": "1920x1080",
    "visible": False,
    "inspectable": True,
    "disableBackHistoryAPI": True,
    "appCategory": ["home"],
    "requiredACG": ["application.launcher", "application.query"],
    "requiredPermissions": [
        "applications",
        "applications.launcher",
        "applications.operation",
        "applications.internal",
        "launcher.status",
        "launcher.control",
    ],
}
(OUT / "appinfo.json").write_text(json.dumps(manifest, indent=2) + "\n")

missing = [n for n in ["index.html", "runtime.js", "settings.js", "theme-sync.js", "theme-config.js", "production.css", "wallpaper.jpg", "icon.png", "large-icon.png"] if not (OUT / n).exists()]
if missing:
    raise SystemExit("missing: " + ", ".join(missing))
json.loads((OUT / "appinfo.json").read_text())
print(json.dumps({"output": str(OUT), "files": len(list(OUT.iterdir())), "manifest": manifest}, indent=2))
