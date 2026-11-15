#!/usr/bin/env bash
# The follow-ups one after another: each needs the whole machine and ports 3001/8545.
#   KEYS_FILE=… CSV_DIR=… WORK_DIR=… (all outside the repo) bash run-followups.sh
cd "$(dirname "$0")/../../.." || exit 1
S=benchmarks/2026-11-12-hcmc-4.5M-final/scripts
D=benchmarks/2026-11-12-hcmc-4.5M-final/data
log() { echo "[$(date +%T)] $*"; }
run() {
  local name=$1; shift
  log "start $name"
  if "$@" > "$D/run-$name.log" 2>&1; then log "done $name"; else log "FAILED $name (see run-$name.log)"; fi
}
run a2 bash $S/run-a2-tree-check.sh
run a3 bash $S/run-a3-draft-breakdown.sh
run a1 bash $S/run-a1-branches.sh
run a4 bash $S/run-a4-n-independence.sh
run a5 bash $S/run-a5-import.sh
run a6 bash $S/run-a6-attacks.sh
log "FOLLOW-UPS DONE"
