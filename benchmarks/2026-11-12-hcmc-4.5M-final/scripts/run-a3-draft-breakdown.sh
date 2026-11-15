#!/usr/bin/env bash
# A3: where createDraft's time goes. Day 1 of the month is replayed in full, day 2 is only queued
# (2,994 transfers + 950 revocations + 950 re-issues), then createDraft is timed step by step.
cd "$(dirname "$0")/../../.." || exit 1
. benchmarks/2026-11-12-hcmc-4.5M-final/scripts/lib.sh
OUT=$PWD/$RUN/data/a3-draft-breakdown
mkdir -p "$OUT"
DB=${PRISTINE}_a3
trap all_down EXIT
ports_free || { log "FAILED: ports 3001/8545 busy"; exit 1; }

log "clone $PRISTINE -> $DB"
clone_db $PRISTINE $DB || { log "FAILED: clone"; exit 1; }
ROOT=$(sed -n 's/.*"root": *"\([0-9]*\)".*/\1/p' $RUN/data/phase3-hardhat/seed.json)
chain_up "$OUT" "$ROOT" || { log "FAILED: chain"; exit 1; }
backend_up $DB "$OUT" || { log "FAILED: backend"; exit 1; }

log "day 1 in full, day 2 queued only"
DATABASE_URL=$(db_url $DB) STOP_BEFORE_DRAFT_DAY=2 \
  pnpm --filter backend run bench:month > "$OUT/month.txt" 2>&1 || { log "FAILED: bench:month"; exit 1; }
stop_port 3001   # the breakdown runs in its own process; nothing else touches the database

log "createDraft breakdown"
DATABASE_URL=$(db_url $DB) RUNS=3 \
  pnpm --filter backend exec ts-node scripts/bench-draft-breakdown.ts > "$OUT/draft-breakdown.txt" 2>&1 \
  || { log "FAILED: breakdown"; exit 1; }
cp "$(ls -t blockchain/bench/results/*/draft-breakdown.json | head -1)" "$OUT/draft-breakdown.json"
log "A3 DONE"
