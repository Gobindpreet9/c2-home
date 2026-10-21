#!/usr/bin/env bash
# Build a patched Moonfin webOS release and stage the artifacts.
# This script never touches the TV; deployment stays a separate, explicit step.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PATCH_DIR="$ROOT/moonfin-patch"
REPO_URL="${MOONFIN_REPO_URL:-https://github.com/Moonfin-Client/Smart-TV.git}"
CACHE_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}/c2-home"
WORK_ROOT="${MOONFIN_WORK_ROOT:-$CACHE_ROOT}"
CLONE="${MOONFIN_CLONE:-$WORK_ROOT/moonfin-src}"
NODE_BIN="${MOONFIN_NODE_BIN:-$(dirname "$(command -v node || printf '/usr/bin/node')")}"
CHECK=0
FORCE=0
TAG=""

usage() {
  cat <<'EOF'
Usage: ./moonfin-patch/update.sh [--check] [--force] [tag]

  tag        Upstream tag to build (for example 2.11.0). Default: latest release.
  --check    Fetch the tag and verify the patch applies; do not install/build.
  --force    Replace an existing worktree or staged artifact directory.

Environment overrides: MOONFIN_CLONE, MOONFIN_WORK_ROOT, MOONFIN_NODE_BIN,
MOONFIN_REPO_URL.
EOF
}

while (($#)); do
  case "$1" in
    --check) CHECK=1 ;;
    --force) FORCE=1 ;;
    -h|--help) usage; exit 0 ;;
    -*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [[ -n "$TAG" ]]; then
        echo "Only one tag may be supplied." >&2
        exit 2
      fi
      TAG="$1"
      ;;
  esac
  shift
done

command -v git >/dev/null || { echo "git is required" >&2; exit 1; }
command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }

if [[ ! -d "$CLONE/.git" ]]; then
  echo "Cloning $REPO_URL"
  mkdir -p "$(dirname "$CLONE")"
  git clone --filter=blob:none "$REPO_URL" "$CLONE"
fi

echo "Fetching tags from origin"
git -C "$CLONE" fetch --tags --prune --quiet

if [[ -z "$TAG" ]]; then
  echo "Resolving latest release"
  TAG="$(curl -fsSL https://api.github.com/repos/Moonfin-Client/Smart-TV/releases/latest \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["tag_name"])' 2>/dev/null || true)"
  if [[ -z "$TAG" ]]; then
    TAG="$(git -C "$CLONE" ls-remote --tags --refs origin \
      | awk -F/ '{print $NF}' \
      | grep -E '^v?[0-9]+\.[0-9]+\.[0-9]+$' \
      | sed 's/^v//' \
      | sort -V \
      | tail -1)"
  fi
fi

VERSION="${TAG#v}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Tag must look like 2.11.0 (got: $TAG)" >&2
  exit 2
fi

if git -C "$CLONE" rev-parse -q --verify "refs/tags/$VERSION" >/dev/null; then
  REF="refs/tags/$VERSION"
elif git -C "$CLONE" rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null; then
  REF="refs/tags/v$VERSION"
else
  echo "Tag $VERSION (or v$VERSION) was not found upstream." >&2
  exit 2
fi

PATCH="$(find "$PATCH_DIR" -maxdepth 2 -name 'moonfin-deeplink-*.patch' -print | sort -V | tail -1)"
if [[ -z "$PATCH" || ! -f "$PATCH" ]]; then
  echo "No moonfin-deeplink-*.patch found under $PATCH_DIR" >&2
  exit 2
fi

BUILD="$WORK_ROOT/moonfin-build-$VERSION"
if [[ -e "$BUILD" ]]; then
  if [[ "$FORCE" != 1 ]]; then
    echo "Build directory already exists: $BUILD" >&2
    echo "Re-run with --force to replace it." >&2
    exit 2
  fi
  git -C "$CLONE" worktree remove --force "$BUILD" 2>/dev/null || rm -rf "$BUILD"
fi

echo "Creating worktree for $VERSION at $BUILD"
git -C "$CLONE" worktree add --detach --quiet "$BUILD" "$REF"

echo "Applying $(basename "$PATCH")"
if git -C "$BUILD" apply --check "$PATCH"; then
  git -C "$BUILD" apply "$PATCH"
elif git -C "$BUILD" apply --3way "$PATCH"; then
  echo "Patch applied with 3-way merge."
else
  echo
  echo "Patch does not apply to $VERSION." >&2
  echo "The worktree is left at $BUILD for a manual rebase." >&2
  echo "Keep packages/app/src/services/deepLink.js, then re-add the import and" >&2
  echo "useDeepLink(...) line in packages/app/src/App/App.js." >&2
  echo "Try: git -C \"$BUILD\" apply --reject \"$PATCH\" and inspect the .rej files." >&2
  exit 3
fi

if ! grep -q "useDeepLink({enabled: isAuthenticated" "$BUILD/packages/app/src/App/App.js" \
  || [[ ! -f "$BUILD/packages/app/src/services/deepLink.js" ]]; then
  echo "Patched tree is missing the deep-link hook or module." >&2
  exit 3
fi

if [[ "$CHECK" == 1 ]]; then
  echo "PATCH_OK $VERSION (verified; worktree removed)"
  git -C "$CLONE" worktree remove --force "$BUILD"
  exit 0
fi

if [[ ! -x "$NODE_BIN/node" ]]; then
  echo "Node 22 was not found at $NODE_BIN" >&2
  echo "Set MOONFIN_NODE_BIN to a directory containing node/npm." >&2
  exit 1
fi
export PATH="$NODE_BIN:$PATH"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_MAJOR" != 22 ]]; then
  echo "Node 22 is required by this Enact toolchain; got $(node --version)" >&2
  exit 1
fi

echo "Installing dependencies"
(cd "$BUILD" && npm install --no-audit --no-fund) 2>&1 | tee "$WORK_ROOT/moonfin-build-$VERSION.npm.log"

echo "Building webOS package"
(cd "$BUILD" && npm run build:webos) 2>&1 | tee "$WORK_ROOT/moonfin-build-$VERSION.build.log"

IPK="$(find "$BUILD" -maxdepth 2 -name '*.ipk' -type f | sort | tail -1)"
if [[ -z "$IPK" ]]; then
  echo "Build completed without producing an IPK." >&2
  exit 1
fi
if [[ ! -d "$BUILD/dist" ]]; then
  echo "Build completed without a dist directory." >&2
  exit 1
fi

OUT="${MOONFIN_OUT_DIR:-$PATCH_DIR/builds/$VERSION}"
if [[ -e "$OUT" && "$FORCE" != 1 ]]; then
  echo "Artifact directory already exists: $OUT" >&2
  echo "Re-run with --force to replace it." >&2
  exit 2
fi
mkdir -p "$OUT"
if [[ "$FORCE" == 1 ]]; then
  # Keep hand-written notes; replace only generated artifacts.
  find "$OUT" -maxdepth 1 -type f ! -name "README.md" -delete
fi

git -C "$BUILD" add -N packages/app/src/services/deepLink.js
git -C "$BUILD" diff --src-prefix=a/ --dst-prefix=b/ -- \
  packages/app/src/App/App.js \
  packages/app/src/services/deepLink.js > "$OUT/moonfin-deeplink-$VERSION.patch"

cp "$BUILD/packages/app/src/services/deepLink.js" "$OUT/deepLink.js"
cp "$IPK" "$OUT/"
tar -cf "$OUT/moonfin-dist-$VERSION.tar" -C "$BUILD/dist" .

{
  echo "base_tag=$VERSION"
  echo "commit=$(git -C "$BUILD" rev-parse HEAD)"
  echo "node=$(node --version)"
  echo "built=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "ipk=$(basename "$IPK")"
  echo "ipk_sha256=$(sha256sum "$IPK" | awk '{print $1}')"
} > "$OUT/BUILD.txt"
sha256sum "$OUT"/* > "$OUT/SHA256SUMS"

cat <<EOF

Built Moonfin $VERSION
  artifacts: $OUT
  worktree:  $BUILD
  IPK:       $(basename "$IPK")

Nothing was deployed. Before installing:
  1. Back up the current app directory.
  2. Close Moonfin.
  3. Replace the app directory contents with the included dist tar.
  4. chown -R 1001:1001 the app directory.
  5. Compare packages/build-webos/service with the installed service; update it too if it changed.

Verify login, library, both deep-link cards (cold and while running), and playback before calling it done.
EOF
