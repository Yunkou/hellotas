#!/usr/bin/env bash
# Fast-forward only publish of a fork-domain build to origin/gh-pages.
#
# Same process as previous aggregate preview publishes: Hugo output is
# rsynced into the existing gh-pages worktree, committed, and pushed
# fast-forward-only to origin/gh-pages. This does not push fork main,
# does not touch upstream, and does not change Pages settings via API.
#
# WARNING: Pushing a CNAME file to the GitHub Pages source branch (gh-pages)
# can immediately enable the custom domain. GitHub reads CNAME and may:
#   - set Settings > Pages > Custom domain to ictfuturesintas.com
#   - start HTTPS certificate issuance
#   - redirect https://yunkou.github.io/hellotas/ to the custom domain
# This is not a no-op static-file update. Saving a custom domain in the
# GitHub UI may also add a CNAME commit on origin/gh-pages. This script
# therefore fetches first and fast-forwards the worktree to that tip
# before copying files. It never force-pushes or resets past a conflict.
#
# Usage:
#   DEST=/path/to/public-fork-domain ./scripts/build-fork-domain.sh
#   GH_PAGES_WORKDIR=/path/to/hellotas-gh-pages \
#     I_UNDERSTAND_CNAME_ENABLES_PAGES_DOMAIN=yes \
#     ./scripts/deploy-fork-gh-pages.sh
#   DRY_RUN=1 ...  # validate only; no fetch/merge/rsync/commit/push
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/fork-domain.conf"
DEST="${DEST:-$ROOT/public-fork-domain}"
WORKDIR="${GH_PAGES_WORKDIR:-}"
DRY_RUN="${DRY_RUN:-}"

if [[ "${I_UNDERSTAND_CNAME_ENABLES_PAGES_DOMAIN:-}" != "yes" ]]; then
  cat >&2 <<MSG
Refusing to deploy.

Pushing CNAME=$FORK_DOMAIN to gh-pages can immediately enable the GitHub
Pages custom domain and is not a no-op static-file update.

When DNS/Pages are ready and the owner has approved a publish:

  I_UNDERSTAND_CNAME_ENABLES_PAGES_DOMAIN=yes \\
    GH_PAGES_WORKDIR=/path/to/gh-pages-worktree \\
    $0

MSG
  exit 2
fi

if [[ -z "$WORKDIR" ]]; then
  echo "GH_PAGES_WORKDIR must be the existing gh-pages worktree" >&2
  exit 1
fi
if [[ ! -d "$WORKDIR/.git" && ! -f "$WORKDIR/.git" ]]; then
  echo "GH_PAGES_WORKDIR is not a git worktree: $WORKDIR" >&2
  exit 1
fi

# Do not operate on the source checkout or any non-Pages worktree.
WORKDIR_ABS="$(cd "$WORKDIR" && pwd)"
if [[ "$WORKDIR_ABS" == "$ROOT" ]]; then
  echo "Refusing: GH_PAGES_WORKDIR is the source worktree" >&2
  exit 1
fi

ORIGIN_URL="$(git -C "$WORKDIR" remote get-url origin 2>/dev/null || true)"
case "$ORIGIN_URL" in
  https://github.com/Yunkou/hellotas.git|git@github.com:Yunkou/hellotas.git)
    ;;
  *)
    echo "Refusing: origin is not Yunkou/hellotas (got: ${ORIGIN_URL:-empty})" >&2
    exit 1
    ;;
esac

BRANCH="$(git -C "$WORKDIR" branch --show-current)"
case "$BRANCH" in
  preview/gh-pages-aggregate-20261110|gh-pages)
    ;;
  *)
    echo "Refusing: worktree branch must be the Pages branch, not $BRANCH" >&2
    exit 1
    ;;
esac

if [[ "$BRANCH" == "main" ]]; then
  echo "Refusing: will not publish from main" >&2
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

if [[ -n "$(git -C "$WORKDIR" status --porcelain)" ]]; then
  echo "Refusing: gh-pages worktree has uncommitted changes; not overwriting them" >&2
  git -C "$WORKDIR" status -sb >&2
  exit 1
fi

SOURCE_SHA="$(git -C "$ROOT" rev-parse HEAD)"
SOURCE_BRANCH="$(git -C "$ROOT" branch --show-current)"
echo "Source: $SOURCE_BRANCH @ $SOURCE_SHA"
echo "Pages worktree: $WORKDIR_ABS ($BRANCH)"
echo "origin: $ORIGIN_URL"

if [[ "$DRY_RUN" == "1" ]]; then
  echo "DRY_RUN=1: checks passed; not fetching, rsyncing, committing, or pushing."
  exit 0
fi

# Fetch first. GitHub may have added a CNAME commit when the custom domain
# was saved. Fast-forward the worktree to that tip; never force or reset.
git -C "$WORKDIR" fetch origin gh-pages
if git -C "$WORKDIR" merge-base --is-ancestor origin/gh-pages HEAD; then
  echo "Worktree already contains origin/gh-pages"
elif git -C "$WORKDIR" merge-base --is-ancestor HEAD origin/gh-pages; then
  echo "Fast-forwarding worktree to origin/gh-pages"
  git -C "$WORKDIR" merge --ff-only origin/gh-pages
else
  echo "Refusing to publish: local $BRANCH and origin/gh-pages have diverged" >&2
  git -C "$WORKDIR" log --oneline -3 HEAD >&2
  git -C "$WORKDIR" log --oneline -3 origin/gh-pages >&2
  exit 1
fi

# Restore the last commit if we fail after copying files and before a successful commit.
restore=""
cleanup() {
  if [[ "$restore" == "1" ]]; then
    echo "Publish failed after copy; restoring worktree to last commit" >&2
    git -C "$WORKDIR" reset --hard HEAD
    git -C "$WORKDIR" clean -fd -e .git
  fi
}
trap cleanup EXIT

restore=1
# Replace site files but never the worktree's .git. -a keeps dotfiles from DEST
# (.nojekyll, CNAME). CNAME is always in DEST, so a rebuild cannot drop it.
rsync -a --delete --exclude '.git' --exclude '.git/' "$DEST/" "$WORKDIR/"
if ! grep -qx 'ictfuturesintas.com' "$WORKDIR/CNAME"; then
  echo "Refusing to commit: CNAME missing after rsync" >&2
  exit 1
fi
if [[ ! -f "$WORKDIR/.nojekyll" ]]; then
  echo "Refusing to commit: .nojekyll missing after rsync" >&2
  exit 1
fi

git -C "$WORKDIR" add -A
if git -C "$WORKDIR" diff --cached --quiet; then
  restore=0
  echo "No changes to publish"
  exit 0
fi

git -C "$WORKDIR" commit -m "Preview fork domain ${FORK_DOMAIN} from ${SOURCE_BRANCH} @ ${SOURCE_SHA}"
restore=0

if ! git -C "$WORKDIR" merge-base --is-ancestor origin/gh-pages HEAD; then
  echo "Refusing to push: commit would not fast-forward origin/gh-pages" >&2
  exit 1
fi

echo "About to fast-forward push HEAD to origin/gh-pages."
echo "This can enable the Pages custom domain ${FORK_DOMAIN}."
git -C "$WORKDIR" push --ff-only origin HEAD:gh-pages
