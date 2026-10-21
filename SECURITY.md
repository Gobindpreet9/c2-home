# Security and private builds

## What is intentionally absent

- SSH private/public keys and known-host records, SSAP pairing keys, developer passphrases.
- Real Jellyfin/Moonfin access tokens, user IDs, server addresses, or account names.
- PC bridge tokens and `client.json`; generated `theme-config.js` files.
- Screenshots, logs, network inventories, firmware dumps, binary backups, generated IPKs.

## Build defaults

A standard build writes an empty theme configuration. It does not read `~/.config/c2-theme-bridge/client.json` automatically. Set `C2_THEME_CONFIG` only for a private local build. All build outputs and release packages are ignored by Git even when they contain no credential.

The bridge token is a bearer capability granting read access to the current wallpaper and palette. It is **not** a TV root credential. Nevertheless, treat it as private: do not paste authenticated URLs into issues, logs, screenshots, or release notes. Never expose the bridge to the Internet. On plain LAN HTTP, the token is not encrypted in transit; use only a trusted network or arrange TLS separately. CORS is permissive for the TV webview; authentication is still required on every endpoint.

An authenticated client can download the selected wallpaper. Do not select sensitive images while serving untrusted clients. The server is read-only but is not hardened for hostile Internet traffic or denial-of-service attacks.

## TV credentials

The launcher clears the password field after sign-in, and does not save the password. To survive restarts, it stores the server URL, access token, user ID and name in native TV preferences. Rooted-TV access can read those preferences. Sign out to clear the session and revoke server sessions if a device is lost.

## Before a push

1. Stage source and documentation only; review `git diff --cached --stat` and the full diff.
2. Run `python3 tools/check_public_tree.py` and the tests.
3. Check any new images/fixtures manually; text secret checks do not inspect image pixels.
4. Never override `.gitignore` for generated builds, logs, credentials, or device backups.

If a real credential is published, revoke/rotate it first; deleting it from the latest commit does not erase history or cached copies. Report suspected leaks without posting the credential itself.
