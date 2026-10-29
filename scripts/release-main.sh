#!/usr/bin/env bash
# Rebuilds main from dev minus the dev-only files below, staged for review (you commit).
# Not a merge: main deletes files dev keeps editing, so a merge would conflict every release.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

DEV_ONLY=(
  .claude
  docs
  scripts/release-main.sh
  DEMO_SEPOLIA.md
  PHASE_9_MANUAL_TEST.md
  PHASE_10_MANUAL_TEST.md
  web-app/frontend/DESIGN.md
  blockchain/scripts/bench
  blockchain/test/scripts/stats.test.ts
  'web-app/backend/scripts/bench-*.ts'
)

if [ -n "$(git status --porcelain)" ]; then
  echo "Commit or stash your changes on $(git branch --show-current) first." >&2
  exit 1
fi

src=$(git rev-parse --short dev)
git switch -q main
git restore --source=dev --staged --worktree -- .
git rm -rq --ignore-unmatch -- "${DEV_ONLY[@]}"
# The bench:* scripts point at files main no longer has.
node -e '
for (const f of process.argv.slice(1)) {
  const pkg = JSON.parse(fs.readFileSync(f, "utf8"));
  for (const k of Object.keys(pkg.scripts)) if (k.startsWith("bench:")) delete pkg.scripts[k];
  fs.writeFileSync(f, JSON.stringify(pkg, null, 2) + "\n");
}' blockchain/package.json web-app/backend/package.json
git add blockchain/package.json web-app/backend/package.json

echo "main now = dev@$src minus dev-only files (staged, not committed)."
echo "Review: git diff --cached --stat   Then: git commit -m \"release: dev@$src\""
