#!/usr/bin/env bash
# A2 (G4): is the stored tree right at 4.5M after the month's 44 rounds?
#  1. rebuild the whole tree from the rows (tree:bootstrap): its root must equal the root the
#     month published round by round (incremental writes = full rebuild);
#  2. sample proofs (spread + plots the month changed) and recompute the root against latestRoot.
cd "$(dirname "$0")/../../.." || exit 1
. benchmarks/2026-11-12-hcmc-4.5M-final/scripts/lib.sh
OUT=$PWD/$RUN/data/a2-tree-check
mkdir -p "$OUT"
DB=${PRISTINE}_hh
trap all_down EXIT
ports_free || { log "FAILED: ports 3001/8545 busy"; exit 1; }

ROOT=$(root_of $DB)
[ -n "$ROOT" ] || { log "FAILED: no published root in $DB"; exit 1; }
log "chain up, publishing the database's root $ROOT"
chain_up "$OUT" "$ROOT" || { log "FAILED: chain"; exit 1; }

log "full rebuild of $DB (tree:bootstrap); the chain is up so the script can exit"
DATABASE_URL=$(db_url $DB) pnpm --filter backend run tree:bootstrap > "$OUT/rebuild.txt" 2>&1 &
BOOT=$!
until grep -q "elapsed:" "$OUT/rebuild.txt" 2>/dev/null || ! kill -0 $BOOT 2>/dev/null; do sleep 10; done
sleep 30
kill -0 $BOOT 2>/dev/null && taskkill //PID "$(cat /proc/$BOOT/winpid)" //T //F >/dev/null 2>&1
REBUILT=$(sed -n 's/^ *root *: *\([0-9]*\).*/\1/p' "$OUT/rebuild.txt")
{ echo "published root (round 44): $ROOT"; echo "rebuilt from rows        : $REBUILT"
  [ "$ROOT" = "$REBUILT" ] && echo "MATCH" || echo "MISMATCH"; } | tee "$OUT/rebuild-compare.txt"
[ "$ROOT" = "$REBUILT" ] || { log "FAILED: rebuilt root differs"; exit 1; }

backend_up $DB "$OUT" || { log "FAILED: backend"; exit 1; }
# Plots the month touched: transferred, re-issued (successors now ISSUED), revoked.
{
  psqld $DB "select \"propertyId\" from transfer_requests where status='PUBLISHED' order by id limit 500"
  psqld $DB "select l.\"successorPropertyId\" from property_lineage l join properties p on p.\"propertyId\" = l.\"successorPropertyId\" where p.status = 'ISSUED' order by 1 limit 500"
  psqld $DB "select \"propertyId\" from properties where status = 'REVOKED' order by id limit 200"
} > "$OUT/extra-ids.txt"

log "proof sample"
EXTRA_IDS_FILE=$(cygpath -w "$OUT/extra-ids.txt") SAMPLE=2000 \
  pnpm --filter blockchain exec ts-node scripts/bench/treeCheck.ts > "$OUT/tree-check.txt" 2>&1
log "proof sample exit $?"
log "A2 DONE"
