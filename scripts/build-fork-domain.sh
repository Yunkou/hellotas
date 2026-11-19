#!/usr/bin/env bash
# Build the fork site for the custom root domain (no /hellotas/ prefix).
#
# This only overrides Hugo's baseURL for this output. It does not edit
# hugo.toml or the existing GitHub Actions workflow.
#
# Every run writes CNAME and .nojekyll into the destination so a rebuild
# cannot drop them. This script does not push, deploy, or change DNS/Pages.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/fork-domain.conf"

DEST="${DEST:-$ROOT/public-fork-domain}"
HUGO_BIN="${HUGO_BIN:-hugo}"

if [[ "$FORK_DOMAIN" != "ictfutureintas.com" ]]; then
  echo "Refusing to build: FORK_DOMAIN must be ictfutureintas.com (got: $FORK_DOMAIN)" >&2
  exit 1
fi

if [[ "$FORK_BASEURL" != "https://ictfutureintas.com/" ]]; then
  echo "Refusing to build: FORK_BASEURL must be https://ictfutureintas.com/ (got: $FORK_BASEURL)" >&2
  exit 1
fi

if ! command -v "$HUGO_BIN" >/dev/null 2>&1; then
  echo "hugo not found in PATH (HUGO_BIN=$HUGO_BIN)" >&2
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST"

echo "Building fork domain site"
echo "  source: $ROOT"
echo "  baseURL: $FORK_BASEURL"
echo "  dest: $DEST"

"$HUGO_BIN" --gc --minify \
  --source "$ROOT" \
  --destination "$DEST" \
  --baseURL "$FORK_BASEURL"

# Persist CNAME on every build. Do not rely on static/CNAME, which would also
# leak into the default github.io/hellotas subpath build.
printf '%s\n' "$FORK_DOMAIN" > "$DEST/CNAME"
# GitHub Pages otherwise runs Jekyll over the branch; keep the existing practice.
touch "$DEST/.nojekyll"

SOURCE_SHA="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
SOURCE_BRANCH="$(git -C "$ROOT" branch --show-current 2>/dev/null || echo unknown)"
BUILT_AT="$(TZ=Asia/Shanghai date +'%Y-%m-%dT%H:%M:%S%z' | sed 's/\([0-9][0-9]\)$/:\1/')"
CSS="$(basename "$(ls -1 "$DEST"/css/custom.*.css 2>/dev/null | head -1)" || true)"

python3 - "$DEST/fork-domain-build.json" <<PY
import json, sys
from pathlib import Path
Path(sys.argv[1]).write_text(json.dumps({
    "domain": "$FORK_DOMAIN",
    "baseURL": "$FORK_BASEURL",
    "branch": "$SOURCE_BRANCH",
    "commit": "$SOURCE_SHA",
    "builtAt": "$BUILT_AT",
    "css": "$CSS",
    "cname": "$FORK_DOMAIN",
}, indent=2) + "\n")
PY

# Fail the build if the output is still a /hellotas/ site.
if grep -R -l --include='*.html' --include='*.xml' --include='*.txt' --include='*.json' \
    -E 'href=["'\'']/hellotas/|src=["'\'']/hellotas/' "$DEST" >/tmp/hellotas-path-hits.txt 2>/dev/null; then
  echo "ERROR: built output still contains /hellotas/ asset or link prefixes:" >&2
  cat /tmp/hellotas-path-hits.txt >&2
  exit 1
fi

if ! grep -qx 'ictfutureintas.com' "$DEST/CNAME"; then
  echo "ERROR: CNAME missing or incorrect" >&2
  exit 1
fi

echo "Build ok: $DEST"
echo "  CNAME=$(tr -d '\n' < "$DEST/CNAME")"
echo "  commit=$SOURCE_SHA"
