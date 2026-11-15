#!/usr/bin/env bash
# Phase 3 on Hardhat (see ../README.md). Restartable: the seeded database
# land_registry_bench_final is the pristine copy and is never mutated; each run replays on a fresh clone _hh.
cd "$(dirname "$0")/../../.." || exit 1
OUT=$PWD/benchmarks/2026-11-12-hcmc-4.5M-final/data/phase3-hardhat
mkdir -p "$OUT"
PRISTINE=land_registry_bench_final
DB=${PRISTINE}_hh
export BENCH_DB="postgresql://postgres:postgres@localhost:5433/$DB?schema=public"
# Hardhat runs pre-Glamsterdam gas rules: the .env cap (989, Sepolia) would not fit one transaction here.
export CHAIN_NETWORK=localhost RPC_URL=http://127.0.0.1:8545 REVOCATION_CAP=591 THROTTLE_LIMIT=1000000
log() { echo "[$(date +%T)] $*"; }
psqlc() { docker exec land_registry_postgres psql -U postgres -At -c "$1"; }
pid_on() { netstat -ano | awk -v p=":$1" '$2 ~ p"$" && $4=="LISTENING" {print $5; exit}'; }
cleanup() {
  [ -n "${SAMPLER:-}" ] && kill "$SAMPLER" 2>/dev/null
  for port in 3001 8545; do p=$(pid_on $port); [ -n "$p" ] && taskkill //PID "$p" //T //F >/dev/null 2>&1; done
}
fail() { log "FAILED: $*"; cleanup; exit 1; }
wait_port() { for _ in $(seq 1 600); do [ -n "$(pid_on $1)" ] && return 0; sleep 1; done; return 1; }

[ -f "$OUT/seed.json" ] || fail "no seed.json: seed $PRISTINE first"
# node on Windows cannot open /d/... paths, so read the root without it.
ROOT=$(sed -n 's/.*"root": *"\([0-9]*\)".*/\1/p' "$OUT/seed.json")
[ -n "$ROOT" ] || fail "no root in seed.json"
for port in 3001 8545; do [ -n "$(pid_on $port)" ] && fail "port $port busy"; done

log "fresh clones from $PRISTINE"
psqlc "DROP DATABASE IF EXISTS $DB" >/dev/null || fail "drop $DB"
docker exec land_registry_postgres createdb -U postgres -T $PRISTINE $DB || fail "clone $DB"
[ "$(psqlc "select 1 from pg_database where datname='${PRISTINE}_sepolia'")" = 1 ] ||
  docker exec land_registry_postgres createdb -U postgres -T $PRISTINE ${PRISTINE}_sepolia || fail "clone sepolia"

log "start node + deploy + genesis $ROOT"
pnpm --filter blockchain run node > "$OUT/hardhat-node.log" 2>&1 &
wait_port 8545 || fail "hardhat node did not start"
[ -f "$OUT/localhost.json.before" ] || cp blockchain/deployments/localhost.json "$OUT/localhost.json.before"
pnpm --filter blockchain run deploy:localhost > "$OUT/deploy.txt" 2>&1 || fail "deploy"
NEW_ROOT=$ROOT pnpm --filter blockchain run sign:root > "$OUT/genesis.txt" 2>&1 || fail "genesis sign"

log "start backend"
DATABASE_URL=$BENCH_DB pnpm --filter backend run start > "$OUT/backend.log" 2>&1 &
wait_port 3001 || fail "backend did not start"
BPID=$(pid_on 3001); log "backend pid $BPID"
( while true; do m=$(tasklist //FI "PID eq $BPID" //FO CSV //NH 2>/dev/null | awk -F'","' '{gsub(/[",K ]/,"",$5); print $5}');
    echo "$(date +%s),$m"; sleep 2; done ) > "$OUT/backend-rss.csv" &
SAMPLER=$!

log "month replay (22 days)"
DATABASE_URL=$BENCH_DB pnpm --filter backend run bench:month > "$OUT/month.txt" 2>&1 || fail "bench:month"
cp "$(ls -t blockchain/bench/results/*/month.json | head -1)" "$OUT/month.json"
log "month done"

log "confirm breakdown"
DATABASE_URL=$BENCH_DB SAMPLE=200 pnpm --filter backend run bench:confirm-breakdown > "$OUT/confirm-breakdown.txt" 2>&1 || log "breakdown failed (continuing)"

log "proof load"
for c in 1 4 16 50; do CONCURRENCY=$c REQUESTS=2000 SAMPLE=2000 pnpm --filter blockchain run bench:proof-load >> "$OUT/proof-load.txt" 2>&1; done
for c in 1 4 50; do ETAG=1 CONCURRENCY=$c REQUESTS=2000 SAMPLE=2000 pnpm --filter blockchain run bench:proof-load >> "$OUT/proof-load.txt" 2>&1; done
for c in 1 4 16 50; do ROUTE=attestation CONCURRENCY=$c REQUESTS=2000 SAMPLE=2000 pnpm --filter blockchain run bench:proof-load >> "$OUT/proof-load.txt" 2>&1; done

docker exec land_registry_postgres psql -U postgres -d $DB -At -c \
  "select 'db', pg_size_pretty(pg_database_size(current_database())) union all
   select relname, pg_size_pretty(pg_total_relation_size(relid)) from pg_catalog.pg_statio_user_tables order by 1" > "$OUT/db-size-after.txt"

cleanup
cp "$OUT/localhost.json.before" blockchain/deployments/localhost.json
log "ALL DONE"
