#!/usr/bin/env bash
# A1 (G3): one archive per branch (D88). The 4.5M plots are spread round-robin over the 38
# branches, so every round splits into 38 ZIPs; three working days are replayed and compared
# with days 1-3 of the month run, where every plot fell to HQ (one ZIP per round).
cd "$(dirname "$0")/../../.." || exit 1
. benchmarks/2026-11-12-hcmc-4.5M-final/scripts/lib.sh
OUT=$PWD/$RUN/data/a1-branches
mkdir -p "$OUT"
DB=${PRISTINE}_a1
KEYS=${KEYS_FILE:?set KEYS_FILE to a path outside the repo: seed:land-offices prints office keys}
trap all_down EXIT
ports_free || { log "FAILED: ports 3001/8545 busy"; exit 1; }

log "clone $PRISTINE -> $DB"
clone_db $PRISTINE $DB || { log "FAILED: clone"; exit 1; }
log "seed admin units + land offices"
DATABASE_URL=$(db_url $DB) pnpm --filter backend run seed:admin-units DVHC_TPHCM.csv --province "TP.HCM" > "$OUT/seed-admin-units.txt" 2>&1 \
  || { log "FAILED: seed:admin-units"; exit 1; }
DATABASE_URL=$(db_url $DB) pnpm --filter backend run seed:land-offices > "$KEYS" 2>&1 || { log "FAILED: seed:land-offices"; exit 1; }
awk -F'\t' 'NF < 2' "$KEYS" > "$OUT/seed-land-offices.txt"   # every line but the "CODE<TAB>key" ones

log "spread plots over the 38 branches"
start=$(date +%s)
psqld $DB "UPDATE properties p SET \"landOfficeId\" = b.id
  FROM (SELECT id, row_number() OVER (ORDER BY code) - 1 AS k FROM land_offices WHERE kind = 'BRANCH') b
  WHERE b.k = abs(hashtext(p.\"propertyId\")) % 38" > "$OUT/spread.txt"
# Hash, not id % 38: bench:month picks every 380th plot (= 38 x 10), so id % 38 put a whole day in one branch.
echo "seconds: $(( $(date +%s) - start ))" >> "$OUT/spread.txt"
# The UPDATE leaves 4.5M dead row versions; without this the table and its indexes are ~2x the
# pristine size and the first attempt's confirm transaction ran 326 s (> Prisma's 120 s) — an
# artefact of this setup step, not of the per-branch split. Compact back to the pristine layout.
start=$(date +%s)
psqld $DB "VACUUM (FULL, ANALYZE) properties" >> "$OUT/spread.txt"
echo "vacuum full seconds: $(( $(date +%s) - start )); properties now $(psqld $DB "select pg_size_pretty(pg_total_relation_size('properties'))")" >> "$OUT/spread.txt"
psqld $DB "SELECT o.code, count(*) FROM properties p JOIN land_offices o ON o.id = p.\"landOfficeId\" GROUP BY 1 ORDER BY 1" >> "$OUT/spread.txt"

ROOT=$(sed -n 's/.*"root": *"\([0-9]*\)".*/\1/p' $RUN/data/phase3-hardhat/seed.json)
log "chain up, genesis $ROOT (the office is not in the leaf, so the root is unchanged)"
chain_up "$OUT" "$ROOT" || { log "FAILED: chain"; exit 1; }
backend_up $DB "$OUT" || { log "FAILED: backend"; exit 1; }
BPID=$(pid_on 3001)
( while true; do m=$(tasklist //FI "PID eq $BPID" //FO CSV //NH 2>/dev/null | awk -F'","' '{gsub(/[",K ]/,"",$5); print $5}');
    echo "$(date +%s),$m"; sleep 2; done ) > "$OUT/backend-rss.csv" &
SAMPLER=$!

log "3 working days"
DATABASE_URL=$(db_url $DB) TRANSFERS=$((2994 * 3)) REVOCATIONS=$((950 * 3)) DAYS=3 \
  pnpm --filter backend run bench:month > "$OUT/month.txt" 2>&1 || { kill $SAMPLER; log "FAILED: bench:month"; exit 1; }
kill $SAMPLER
cp "$(ls -t blockchain/bench/results/*/month.json | head -1)" "$OUT/month.json"

log "archive sizes"
Q="SELECT a.\"changeSetId\", count(*) AS archives, sum(a.\"propertyCount\") AS plots,
     round(sum(octet_length(a.zip)) / 1048576.0, 1) AS mb,
     round(min(octet_length(a.zip)) / 1024.0) AS min_kb, round(max(octet_length(a.zip)) / 1024.0) AS max_kb
   FROM change_set_archives a GROUP BY 1 ORDER BY 1"
{ echo "== A1 (38 branches)"; psqld $DB "$Q"
  echo "== month run, rounds 1-6 (HQ only)"; psqld ${PRISTINE}_hh "${Q/ORDER BY 1/HAVING a.\"changeSetId\" <= 6 ORDER BY 1}"
} > "$OUT/archives.txt"
psqld $DB "SELECT o.code, a.\"propertyCount\", octet_length(a.zip) FROM change_set_archives a JOIN land_offices o ON o.id = a.\"officeId\" WHERE a.\"changeSetId\" = (SELECT min(\"changeSetId\") FROM change_set_archives) ORDER BY 1" > "$OUT/archives-round1-by-office.txt"
log "A1 DONE"
