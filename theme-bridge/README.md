# PC theme bridge

A read-only Python HTTP/SSE service for the current Omarchy theme. Watches `~/.local/state/omarchy/current` with inotify. The TV takes one snapshot, holds one stream while Home is visible, and closes it when backgrounded. If inotify-tools is unavailable, the server falls back to stat polling; the installer requires inotify-tools.

## Setup

Requirements: Linux/systemd user services, Python 3.11+, Pillow, `inotifywait`, `ip`, and `curl`.

```sh
./theme-bridge/install.sh
systemctl --user status c2-theme-bridge
```

The installer writes a random token and client configuration under `~/.config/c2-theme-bridge/` with restrictive permissions, copies the executable into `~/.local/bin/`, installs a user unit, and restarts the service. It listens on TCP 8790 on all interfaces. It does not change your firewall. Review the script before running it.

Only allow the actual TV address or your trusted LAN in the firewall; substitute your real network. Do not open this port to the Internet. The installer prefers a physical 192.168.* interface over a VPN route, but inspect the generated URLs on networks using a different address range. mDNS depends on your TV/network and is not required when the numeric address works.

The current service unit uses the default home-directory paths above. Custom XDG paths require adjusting the unit's ExecStart as well; do not assume the installer fully supports relocating every path.

## Connect the TV

Create a **private** build using the generated config:

```sh
cd app
C2_THEME_CONFIG="$HOME/.config/c2-theme-bridge/client.json" npm run build
npm run package
```

Deploy it yourself using your trusted development/root access. Settings → Connections → **PC theme** reports `Following PC` when connected and offers **Sync now**. If the PC goes away, the running page keeps the last rendered wallpaper. Palette metadata is cached across page restarts; the downloaded wallpaper is not persistently stored by the launcher.

If the LAN address or token changes, regenerate/review the client config and rebuild your private TV app. A static DHCP lease avoids unnecessary address changes.

## Endpoints

All endpoints require the bearer token, including health. EventSource uses an authenticated query parameter; avoid logging complete URLs.

| Path | Response |
| --- | --- |
| `/api/theme` | Palette, theme and wallpaper versions |
| `/api/wallpaper` | JPEG resized to at most 2560px wide; supports ETag/304 |
| `/events` | `theme` events and periodic SSE heartbeats |
| `/health` | Health/version |

The service accepts no commands or writes. Wallpapers are rendered on the PC and cached by version. The TV reuses the image on palette-only changes.

## Test

```sh
python3 -m unittest discover -s theme-bridge -p 'test_*.py' -v
```

Tests cover bounded theme reading, token enforcement, JPEG resize, ETag/304, initial/changed SSE events, and watcher behavior. A live deployment should additionally validate background/foreground lifecycle and a real theme change.
