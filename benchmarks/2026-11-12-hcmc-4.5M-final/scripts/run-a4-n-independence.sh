#!/usr/bin/env bash
# A4: does a round's cost depend on the size of the registry (D72)? The same three working days
# (2,994 transfers + 950 revocations + 950 re-issues each) on 100k plots, contiguous and scattered,
# compared with days 1-3 of the 4.5M month.
cd "$(dirname "$0")/../../.." || exit 1
. benchmarks/2026-11-12-hcmc-4.5M-final/scripts/lib.sh
trap all_down EXIT
ports_free || { log "FAILED: ports 3001/8545 busy"; exit 1; }

for LAYOUT in scattered contiguous; do
  OUT=$PWD/$RUN/data/a4-n-independence/$LAYOUT-100k
  mkdir -p "$OUT"
  DB=land_registry_bench_100k_$LAYOUT
  # Contiguous ids 1..100000 leave no room at id+1, so replacements go past the last id.
  OFFSET=1; [ $LAYOUT = contiguous ] && OFFSET=100000

  log "$LAYOUT: fresh database $DB"
  psqlc "DROP DATABASE IF EXISTS $DB" > /dev/null
  docker exec land_registry_postgres createdb -U postgres $DB || { log "FAILED: createdb"; exit 1; }
  DATABASE_URL=$(db_url $DB) pnpm --filter backend exec prisma migrate deploy > "$OUT/migrate.txt" 2>&1 \
    || { log "FAILED: migrate"; exit 1; }
  node_up "$OUT" || { log "FAILED: node"; exit 1; }
  log "$LAYOUT: seed 100k"
  DATABASE_URL=$(db_url $DB) COUNT=100000 LAYOUT=$LAYOUT \
    pnpm --filter backend run bench:seed > "$OUT/seed.txt" 2>&1 || { log "FAILED: seed"; exit 1; }
  ROOT=$(sed -n 's/^ *root *: *\([0-9]*\).*/\1/p' "$OUT/seed.txt")
  deploy_genesis "$OUT" "$ROOT" || { log "FAILED: deploy"; exit 1; }
  backend_up $DB "$OUT" || { log "FAILED: backend"; exit 1; }

  log "$LAYOUT: 3 working days"
  DATABASE_URL=$(db_url $DB) TRANSFERS=$((2994 * 3)) REVOCATIONS=$((950 * 3)) DAYS=3 SUCCESSOR_OFFSET=$OFFSET \
    pnpm --filter backend run bench:month > "$OUT/month.txt" 2>&1 || { log "FAILED: bench:month"; exit 1; }
  cp "$(ls -t blockchain/bench/results/*/month.json | head -1)" "$OUT/month.json"
  psqld $DB "select count(*) from merkle_nodes" > "$OUT/nodes-after.txt"
  all_down
done
log "A4 DONE"
