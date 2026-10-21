# C2 Home

An artwork-led Home launcher for a rooted LG webOS TV, built around Moonfin, Moonlight, YouTube, and two HDMI inputs. Includes an event-driven Omarchy theme bridge and a small Moonfin item-deep-link patch.

## Features

- Smoked-glass dock, serif clock, weather, remote navigation, and optional Continue watching shelf.
- One merged shelf, at most three cards; items at 85% or above give way to next-up episodes.
- Native webOS app launches and preferences, with explicit unavailable-device errors in a desktop browser.
- PC palette and wallpaper synchronization: inotify → SSE while Home is visible, one snapshot on wake, bounded reconnects, and a crossfaded TV-sized wallpaper.
- Small Moonfin patch that handles item launch parameters on cold start and relaunch.

## Build and test

Requirements: Python 3.11+, Pillow, Node.js with `node:test` support (Node 22 is used for the Moonfin build), and npm. Packaging uses the pinned webOS CLI in `app/package-lock.json`.

```sh
python3 -m pip install -r requirements.txt
cd app
npm ci
npm run build
npm test
python3 -m unittest discover -s tests -p 'test_*.py'
npm run package
python3 build_home_variant.py
cd ..
python3 -m unittest discover -s theme-bridge -p 'test_*.py'
```

The normal build creates `app/dist/` with **no bridge credential**. The package goes into `app/releases/`. `build_home_variant.py` creates the privileged Home-id variant in `app/homeapp/`; it does **not** install or modify a TV.

To include your own bridge configuration in a **private local build**, opt in explicitly:

```sh
cd app
C2_THEME_CONFIG="$HOME/.config/c2-theme-bridge/client.json" npm run build
npm run package
```

That opt-in embeds a bearer credential in the output. Never publish that directory or IPK. See [security notes](SECURITY.md).

## Components

| Path | Purpose |
| --- | --- |
| `design-preview-glass.html` | Design source used by the launcher builder; includes original abstract fallback art |
| `app/src/` | Runtime, device/network adapters, settings, theme client, and styles |
| `app/tests/` | Node regression suite and Python build-privacy tests |
| `app/tools/pair_tv.cjs` | Reusable loopback credential-broker component; no live device controller |
| `theme-bridge/` | Read-only PC bridge, installer, and HTTP/SSE tests |
| `moonfin-patch/` | Source patch and build/update helper; no upstream binaries |
| `docs/TV.md` | Deployment boundaries, safety, and known limitations |

See [theme-bridge/README.md](theme-bridge/README.md) and [moonfin-patch/UPDATE.md](moonfin-patch/UPDATE.md) for component setup.

## TV support and limits

This is a personal project tested on an LG C2. A desktop preview is not a TV emulator. Installing a normal development app does not replace system Home; replacing Home is a separate privileged operation. Firmware-specific work requires a tested rollback path.

Short Home/app-exit behavior was validated on the original installation. Long Home currently invokes the TV's stock magnifier, not LG Home. HDMI 2 still needs an external-controller end-to-end check. No automated rooting or Home-takeover installer is shipped here.

## Publication hygiene

This repository is a curated source export with fresh Git history. It does not include device keys, pairing state, user profiles, viewing history, diagnostic captures, machine-specific deployment scripts, binary app backups, private configuration, or generated TV packages. Test identities and addresses are synthetic. The original personal wallpaper is replaced by generated abstract art.

`python3 tools/check_public_tree.py` checks tracked files for disallowed artifacts and common credential patterns. It is an additional check, not a guarantee that arbitrary future edits are safe.

## Third-party material

Liberation Serif ships with its OFL notice in `app/src/LiberationSerif-OFL.txt`. The Moonfin patch targets `Moonfin-Client/Smart-TV`; its upstream MPL-2.0 license is retained under `moonfin-patch/LICENSE.upstream`. See [NOTICE.md](NOTICE.md). No blanket license is assigned to the original launcher source by this publication.
