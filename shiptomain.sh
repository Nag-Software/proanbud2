#!/usr/bin/env bash
# Run from your repo root (folder with package.json), with
# notifications-popover.patch placed next to it.
# Applies the change, pushes the branch, opens a PR, and merges into main.
set -euo pipefail
BRANCH="claude/notifications-popup-sidebar-zptcdp"
BASE="main"
PATCH="notifications-popover.patch"
TITLE="Add desktop notifications popover to sidebar bell"

[ -f package.json ] || { echo "Run me from the repo root (no package.json here)."; exit 1; }
[ -f "$PATCH" ]     || { echo "Put $PATCH next to package.json first."; exit 1; }

# 1) Get onto the feature branch and apply the change.
git fetch origin "$BASE" "$BRANCH" 2>/dev/null || true
git rev-parse --verify "$BRANCH" >/dev/null 2>&1 && git checkout "$BRANCH" || git checkout -b "$BRANCH"
if ! git am "$PATCH"; then
  git am --abort 2>/dev/null || true
  git apply "$PATCH"; git add -A; git commit -m "$TITLE"
fi

# 2) Push the branch.
git push -u origin "$BRANCH"

# 3) Open the PR and merge into main (needs the GitHub CLI 'gh', logged in).
if command -v gh >/dev/null 2>&1; then
  gh pr create --base "$BASE" --head "$BRANCH" --title "$TITLE" \
    --body "Adds a modern desktop notifications popover to the sidebar bell (panel of recent customer messages, unread badge, mark-all-read, realtime, deep-link to the conversation)." \
    2>/dev/null || echo "(PR may already exist — continuing to merge.)"
  gh pr merge "$BRANCH" --merge \
    || echo ">> Auto-merge blocked (likely branch protection). Open the PR on GitHub and click 'Merge'."
else
  echo ">> Branch pushed. 'gh' CLI not found — open a PR ${BRANCH} -> ${BASE} on GitHub and click Merge."
fi

echo
echo "When merged, refresh your local main:  git checkout main && git pull"
echo "Restart dev clean:                      rm -rf .next && npm run dev"
