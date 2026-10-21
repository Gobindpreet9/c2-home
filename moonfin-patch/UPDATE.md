# Updating the Moonfin deep-link patch

The supplied patch targets upstream Moonfin 2.10.0 from `Moonfin-Client/Smart-TV`. It adds `packages/app/src/services/deepLink.js` plus an import and hook invocation in `App.js`. Only patch source is published; no compiled Moonfin package or private server session is included.

## Check or build

Requirements: git, curl, Python 3, and Node 22/npm for a full upstream build. A full build downloads upstream dependencies; run it only when you intend to do that.

```sh
./moonfin-patch/update.sh --check 2.10.0
# Build a specific release:
./moonfin-patch/update.sh 2.10.0
# Resolve the latest upstream release and build it:
./moonfin-patch/update.sh
```

The helper uses `${XDG_CACHE_HOME:-$HOME/.cache}/c2-home` for its clone/worktrees. Override `MOONFIN_WORK_ROOT`, `MOONFIN_CLONE`, or `MOONFIN_NODE_BIN` when needed. `MOONFIN_OUT_DIR` overrides the ignored `moonfin-patch/builds/<version>/` output. A check still fetches upstream Git data but does not run npm or deploy anything.

It fetches the requested tag, checks/applies the newest source patch (with a three-way fallback), verifies the hook, and builds/stages the IPK, dist tar, regenerated patch, build metadata and hashes. **It never deploys.** `--force` replaces a worktree or generated output; do not point overrides at valuable directories.

If the patch fails, inspect the retained worktree. Upstream changes often move one of these two lines:

```js
import {useDeepLink} from '../services/deepLink';
```

```js
useDeepLink({enabled: isAuthenticated && !!user?.Id, api, onItem: handleSelectItem});
```

Keep the patch small, review rebased changes, and retain upstream license notices. Do not assume a newer Moonfin version is compatible without exercising it.

## Deployment and rollback

Use your own trusted webOS installation process. Back up the current application and proxy-service directories first, close Moonfin, and preserve the actual installed owner/mode. Compare the upstream service too; replacing only app files is unsafe if the service changed. Do not blindly copy ownership IDs from somebody else's TV.

Keep session/storage data separate from packaged files. Never package server tokens, passwords, or native preference exports. Read back deployed hashes before claiming an update succeeded.

Verify signed-in startup, library, cold/warm item deep links, ordinary tile launch with no stale item, playback, Back, and settings. If any required behavior fails, restore the verified backup. Builds may differ byte-for-byte because the upstream bundle includes generated identifiers; record each actual output hash rather than promising reproducibility.
