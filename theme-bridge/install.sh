#!/usr/bin/env bash
# Install/update the C2 Home theme bridge as a user service.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/c2-theme-bridge"
BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
TOKEN_FILE="$CONFIG_DIR/token"
CLIENT_FILE="$CONFIG_DIR/client.json"
PORT="${C2_THEME_PORT:-8790}"

command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }
command -v inotifywait >/dev/null || { echo "inotifywait is required (inotify-tools)" >&2; exit 1; }
python3 -c 'import PIL' 2>/dev/null || { echo "Pillow is required for wallpaper resizing" >&2; exit 1; }

mkdir -p "$CONFIG_DIR" "$BIN_DIR" "$UNIT_DIR"
chmod 700 "$CONFIG_DIR"

if [[ ! -s "$TOKEN_FILE" ]]; then
  umask 077
  python3 - <<'PY' >"$TOKEN_FILE"
import secrets
print(secrets.token_urlsafe(32))
PY
fi
chmod 600 "$TOKEN_FILE"
TOKEN="$(tr -d '\n' <"$TOKEN_FILE")"

install -m 0755 "$ROOT/c2_theme_bridge.py" "$BIN_DIR/c2-theme-bridge"

HOST="$(hostname -s 2>/dev/null || hostname)"
# Prefer the physical LAN address; the default route can be a VPN tunnel.
IP="$(ip -4 -o addr show scope global 2>/dev/null | awk '$2 ~ /^(wl|en|eth)/ && $4 ~ /^192\.168\./ {split($4,a,"/"); print a[1]; exit}')"
if [[ -z "$IP" ]]; then
  IP="$(ip -4 route get 192.168.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}')"
fi
URLS="["
[[ -n "$IP" ]] && URLS+="\"http://${IP}:${PORT}\","
[[ -n "$HOST" ]] && URLS+="\"http://${HOST,,}.local:${PORT}\","
URLS="${URLS%,}]"
python3 - "$CLIENT_FILE" "$TOKEN" "$URLS" <<'PY'
import json, sys
path, token, urls = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
with open(path, "w", encoding="utf-8") as f:
    json.dump({"urls": urls, "token": token}, f, indent=2)
    f.write("\n")
PY
chmod 600 "$CLIENT_FILE"

cat >"$UNIT_DIR/c2-theme-bridge.service" <<EOF
[Unit]
Description=C2 Home PC theme bridge
After=graphical-session.target
PartOf=graphical-session.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 %h/.local/bin/c2-theme-bridge --state-dir %h/.local/state/omarchy/current --bind 0.0.0.0 --port ${PORT} --token-file %h/.config/c2-theme-bridge/token
Restart=on-failure
RestartSec=2
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=read-only

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable c2-theme-bridge.service
systemctl --user restart c2-theme-bridge.service
sleep 0.5
if curl -fsS "http://127.0.0.1:${PORT}/api/theme?token=${TOKEN}" >/dev/null; then
  echo "Theme endpoint is responding."
else
  echo "Warning: the service is running but the theme endpoint did not answer." >&2
fi
systemctl --user --no-pager --lines=3 status c2-theme-bridge.service || true

cat <<EOF

Theme bridge installed on port ${PORT}.
Client config: ${CLIENT_FILE}
Token file:    ${TOKEN_FILE}

If the TV cannot connect, allow TCP ${PORT} from the LAN in the firewall:
  sudo ufw allow from 192.168.1.0/24 to any port ${PORT} proto tcp
(or the equivalent rule for your firewall).

Logs: journalctl --user -u c2-theme-bridge -f
EOF
