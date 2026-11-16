#!/usr/bin/env bash
# Fast-forward only publish of a fork-domain build to origin/gh-pages.
#
# THIS SCRIPT IS PREPARED FOR A LATER APPROVED RUN. It is not safe to
# treat as "just copying static files".
#
# WARNING: Pushing a CNAME file to the GitHub Pages source branch (gh-pages)
# can immediately enable the custom domain. GitHub reads CNAME and may:
#   - set Settings > Pages > Custom domain to ictfuturesintas.com
#   - start HTTPS certificate issuance
#   - redirect https://yunkou.github.io/hellotas/ to the custom domain
# Do not run this while Cloudflare DNS is incomplete, or while the Pages
# custom domain should stay empty. DNS and Pages settings are a separate
# step and are not performed by this script.
#
# Safety rules:
#   - Fast-forward only to origin/gh-pages (refuses otherwise; never force-pushes)
#   - Does not push fork main, does not change Pages config via API
#   - Does not sync with upstream main
#   - Copies the fork-domain build including CNAME and .nojekyll
#
# Later approved usage:
#   DEST=/path/to/public-fork-domain ./scripts/build-fork-domain.sh
#   GH_PAGES_WORKDIR=/path/to/hellotas-gh-pages \
#     I_UNDERSTAND_CNAME_ENABLES_PAGES_DOMAIN=yes \
#     ./scripts/deploy-fork-gh-pages.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/fork-domain.conf"
DEST="${DEST:-$ROOT/public-fork-domain}"
WORKDIR="${GH_PAGES_WORKDIR:-}"

if [[ "${I_UNDERSTAND_CNAME_ENABLES_PAGES_DOMAIN:-}" != "yes" ]]; then
  cat >&2 <<MSG
Refusing to deploy.

Pushing CNAME=$FORK_DOMAIN to gh-pages can immediately enable the GitHub
Pages custom domain and is not a no-op static-file update.

This script was only prepared. To run it later, after DNS/Pages are ready
and the owner has explicitly approved a publish:

  I_UNDERSTAND_CNAME_ENABLES_PAGES_DOMAIN=yes \\
    GH_PAGES_WORKDIR=/path/to/gh-pages-worktree \\
    $0

MSG
  exit 2
fi

if [[ -z "$WORKDIR" || ! -d "$WORKDIR/.git" && ! -f "$WORKDIR/.git" ]]; then
  echo "GH_PAGES_WORKDIR must be an existing gh-pages worktree" >&2
  exit 1
fi

if [[ ! -f "$DEST/CNAME" ]]; then
  echo "Missing $DEST/CNAME — run scripts/build-fork-domain.sh first" >&2
  exit 1
fi
if ! grep -qx 'ictfuturesintas.com' "$DEST/CNAME"; then
  echo "Refusing to publish: $DEST/CNAME is not ictfuturesintas.com" >&2
  exit 1
fi
if [[ ! -f "$DEST/index.html" || ! -f "$DEST/.nojekyll" ]]; then
  echo "Fork-domain build looks incomplete: $DEST" >&2
  exit 1
fi

SOURCE_SHA="$(git -C "$ROOT" rev-parse HEAD)"
BRANCH="$(git -C "$WORKDIR" branch --show-current)"

git -C "$WORKDIR" fetch origin gh-pages
if ! git -C "$WORKDIR" merge-base --is-ancestor origin/gh-pages HEAD; then
  echo "Refusing to publish: $WORKDIR is not a fast-forward of origin/gh-pages" >&2
  git -C "$WORKDIR" log --oneline -3 HEAD
  git -C "$WORKDIR" log --oneline -3 origin/gh-pages
  exit 1
fi

# Replace site files but never the worktree's .git. CNAME is in DEST, so it is kept.
rsync -a --delete --exclude '.git' --exclude '.git/' "$DEST/" "$WORKDIR/"
if ! grep -qx 'ictfuturesintas.com' "$WORKDIR/CNAME"; then
  echo "Refusing to commit: CNAME missing after rsync" >&2
  exit 1
fi

git -C "$WORKDIR" add -A
if git -C "$WORKDIR" diff --cached --quiet; then
  echo "No changes to publish"
  exit 0
fi

git -C "$WORKDIR" commit -m "Preview fork domain ${FORK_DOMAIN} from ${BRANCH:-source} @ ${SOURCE_SHA}"

if ! git -C "$WORKDIR" merge-base --is-ancestor origin/gh-pages HEAD; then
  echo "Refusing to push: commit would not fast-forward origin/gh-pages" >&2
  exit 1
fi

echo "About to fast-forward push HEAD to origin/gh-pages."
echo "This can enable the Pages custom domain ${FORK_DOMAIN}."
git -C "$WORKDIR" push origin HEAD:gh-pages
