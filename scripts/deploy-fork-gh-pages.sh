#!/usr/bin/env bash
# Fast-forward only publish of a fork-domain build to origin/gh-pages.
#
# Same process as previous aggregate preview publishes: Hugo output is
# rsynced into the existing gh-pages worktree, committed, and pushed
# to origin/gh-pages. This does not push fork main, does not touch
# upstream, and does not change Pages settings via API.
#
# WARNING: Pushing a CNAME file to the GitHub Pages source branch (gh-pages)
# can immediately enable the custom domain. GitHub reads CNAME and may:
#   - set Settings > Pages > Custom domain to ictfuturesintas.com
#   - start HTTPS certificate issuance
#   - redirect https://yunkou.github.io/hellotas/ to the custom domain
# This is not a no-op static-file update. Saving a custom domain in the
# GitHub UI may also add a CNAME commit on origin/gh-pages. This script
# therefore fetches first and fast-forwards the worktree to that tip
# before copying files. It never force-pushes, and it never runs
# git reset --hard or git clean.
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

leave_worktree_and_stop() {
  local reason="$1"
  cat >&2 <<MSG
${reason}

The gh-pages worktree was left as it is. This script will not run
git reset --hard or git clean.

Inspect:
  git -C ${WORKDIR_ABS:-$WORKDIR} status
  git -C ${WORKDIR_ABS:-$WORKDIR} log -3 --oneline

If you decide to restore the last commit yourself, that is a separate
confirmation. One way is:

  git -C ${WORKDIR_ABS:-$WORKDIR} checkout -- .
  git -C ${WORKDIR_ABS:-$WORKDIR} clean -fd

git reset --hard is destructive and is not run here. After the worktree
is clean and contains the latest origin/gh-pages tip, re-run this script.
MSG
  exit 1
}

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

ORIGIN_URL="$(git -C "$WORKDIR" config --get remote.origin.url 2>/dev/null || true)"
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
  leave_worktree_and_stop "Refusing to publish: local $BRANCH and origin/gh-pages have diverged."
fi

REMOTE_TIP="$(git -C "$WORKDIR" rev-parse origin/gh-pages)"

# Replace site files but never the worktree's .git. -a keeps dotfiles from DEST
# (.nojekyll, CNAME). CNAME is always in DEST, so a rebuild cannot drop it.
if ! rsync -a --delete --exclude '.git' --exclude '.git/' "$DEST/" "$WORKDIR/"; then
  leave_worktree_and_stop "Copy into the gh-pages worktree failed."
fi
if ! grep -qx 'ictfuturesintas.com' "$WORKDIR/CNAME"; then
  leave_worktree_and_stop "CNAME missing or incorrect after copy."
fi
if [[ ! -f "$WORKDIR/.nojekyll" ]]; then
  leave_worktree_and_stop ".nojekyll missing after copy."
fi

git -C "$WORKDIR" add -A
if git -C "$WORKDIR" diff --cached --quiet; then
  echo "No changes to publish"
  exit 0
fi

git -C "$WORKDIR" commit -m "Preview fork domain ${FORK_DOMAIN} from ${SOURCE_BRANCH} @ ${SOURCE_SHA}"

if ! git -C "$WORKDIR" merge-base --is-ancestor "$REMOTE_TIP" HEAD; then
  leave_worktree_and_stop "Refusing to push: HEAD is not a fast-forward of the fetched origin/gh-pages tip ${REMOTE_TIP}."
fi

# Re-check the live remote tip just before push. If it moved, fetch and
# only continue when the new tip is still an ancestor of HEAD. Otherwise
# stop and leave the worktree; re-run after it is clean and up to date.
# git push has no --ff-only option; use a plain push and refuse force.
git -C "$WORKDIR" fetch origin gh-pages
NEW_TIP="$(git -C "$WORKDIR" rev-parse origin/gh-pages)"
if [[ "$NEW_TIP" != "$REMOTE_TIP" ]]; then
  echo "Remote origin/gh-pages moved ${REMOTE_TIP} -> ${NEW_TIP} before push."
  if git -C "$WORKDIR" merge-base --is-ancestor "$NEW_TIP" HEAD; then
    echo "New tip is still an ancestor of HEAD; continuing with a plain push."
  else
    leave_worktree_and_stop "Refusing to push or force: origin/gh-pages changed and is no longer an ancestor of HEAD. Fetch has been done; this script will not reset or rebuild over the worktree. Restore or integrate locally, then re-run so the copy is remade on the latest tip."
  fi
fi

echo "About to push HEAD to origin/gh-pages (plain git push; no --force)."
echo "This can enable the Pages custom domain ${FORK_DOMAIN}."
git -C "$WORKDIR" push origin HEAD:gh-pages
