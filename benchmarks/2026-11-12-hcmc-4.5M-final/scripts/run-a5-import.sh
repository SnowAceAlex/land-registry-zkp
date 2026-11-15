#!/usr/bin/env bash
# A5: CSV import throughput (UC-2). Files of 1k, 10k and 50k rows from mock:generate go through
# POST /api/government/import, first as a dry run, then for real, each into a fresh registry that
# already holds the commune catalog and the 41 offices (so every row is resolved to its branch).
cd "$(dirname "$0")/../../.." || exit 1
. benchmarks/2026-11-12-hcmc-4.5M-final/scripts/lib.sh
OUT=$PWD/$RUN/data/a5-import
mkdir -p "$OUT"
CSV_DIR=${CSV_DIR:?set CSV_DIR to a folder outside the repo for the generated CSVs and office keys}
TEMPLATE=land_registry_bench_import_template
GOV_API_KEY=$(sed -n 's/^GOV_API_KEY=//p' web-app/backend/.env | tr -d "\"'\r")
trap 'all_down; [ -d "$CSV_DIR/fixtures.user" ] && cp -r "$CSV_DIR/fixtures.user/." blockchain/fixtures/' EXIT
ports_free || { log "FAILED: ports 3001/8545 busy"; exit 1; }

log "template database: migrations + communes + offices"
psqlc "DROP DATABASE IF EXISTS $TEMPLATE" > /dev/null
docker exec land_registry_postgres createdb -U postgres $TEMPLATE || exit 1
DATABASE_URL=$(db_url $TEMPLATE) pnpm --filter backend exec prisma migrate deploy > "$OUT/migrate.txt" 2>&1 || exit 1
DATABASE_URL=$(db_url $TEMPLATE) pnpm --filter backend run seed:admin-units DVHC_TPHCM.csv --province "TP.HCM" > "$OUT/seed-admin-units.txt" 2>&1 || exit 1
DATABASE_URL=$(db_url $TEMPLATE) pnpm --filter backend run seed:land-offices > "$CSV_DIR/office-keys.txt" 2>&1 || exit 1
awk -F'\t' 'NF < 2' "$CSV_DIR/office-keys.txt" > "$OUT/seed-land-offices.txt"

# mock:generate overwrites blockchain/fixtures: keep the user's copy, restored on exit.
mkdir -p "$CSV_DIR/fixtures.user" && cp -r blockchain/fixtures/. "$CSV_DIR/fixtures.user/"
for N in 1000 10000 50000; do
  pnpm --filter blockchain run mock:generate $N > /dev/null 2>&1 || { log "FAILED: mock:generate $N"; exit 1; }
  cp blockchain/fixtures/mockImport.csv "$CSV_DIR/import-$N.csv"
  echo "import-$N.csv rows=$(( $(wc -l < "$CSV_DIR/import-$N.csv") - 1 )) bytes=$(wc -c < "$CSV_DIR/import-$N.csv") sha256=$(sha256sum "$CSV_DIR/import-$N.csv" | cut -c1-16)" >> "$OUT/files.txt"
done
cp -r "$CSV_DIR/fixtures.user/." blockchain/fixtures/

node_up "$OUT" || exit 1
for N in 1000 10000 50000; do
  DB=land_registry_bench_import_$N
  clone_db $TEMPLATE $DB || exit 1
  backend_up $DB "$OUT" || { log "FAILED: backend"; exit 1; }
  for MODE in dry commit; do
    Q=""; [ $MODE = dry ] && Q="?dryRun=true"
    T=$(curl -s -o "$OUT/import-$N-$MODE.json" -w "%{http_code} %{time_total}" -X POST \
      -H "x-gov-api-key: $GOV_API_KEY" -F "file=@$(cygpath -w "$CSV_DIR/import-$N.csv");type=text/csv" \
      "http://localhost:3001/api/government/import$Q")
    echo "rows=$N mode=$MODE http_seconds=$T" | tee -a "$OUT/timings.txt"
  done
  echo "rows=$N in_db=$(psqld $DB "select count(*) from properties") with_office=$(psqld $DB "select count(*) from properties where \"landOfficeId\" is not null")" | tee -a "$OUT/timings.txt"
  stop_port 3001
done
log "A5 DONE"
