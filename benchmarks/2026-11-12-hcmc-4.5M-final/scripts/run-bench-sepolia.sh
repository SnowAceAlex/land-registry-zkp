#!/usr/bin/env bash
# Phase 3.5 on Sepolia: bench contracts, genesis, 5 working days, load. Restores deployments/sepolia.json at the end.
cd "$(dirname "$0")/../../.." || exit 1
OUT=$PWD/benchmarks/2026-11-12-hcmc-4.5M-final/data/phase3-sepolia
mkdir -p "$OUT"
DB=land_registry_bench_final_sepolia
export BENCH_DB="postgresql://postgres:postgres@localhost:5433/$DB?schema=public"
export CHAIN_NETWORK=sepolia REVOCATION_CAP=989 THROTTLE_LIMIT=1000000
DAYS=${DAYS:-5}
log() { echo "[$(date +%T)] $*"; }
pid_on() { netstat -ano | awk -v p=":$1" '$2 ~ p"$" && $4=="LISTENING" {print $5; exit}'; }
restore() { cp "$OUT/sepolia.json.user" blockchain/deployments/sepolia.json && log "restored user sepolia.json"; }
cleanup() {
  [ -n "${SAMPLER:-}" ] && kill "$SAMPLER" 2>/dev/null
  p=$(pid_on 3001); [ -n "$p" ] && taskkill //PID "$p" //T //F >/dev/null 2>&1
}
fail() { log "FAILED: $*"; cleanup; restore; exit 1; }
wait_port() { for _ in $(seq 1 600); do [ -n "$(pid_on $1)" ] && return 0; sleep 1; done; return 1; }
balance() {
  set -a; . ./.env; set +a
  curl -s -X POST "$SEPOLIA_RPC_URL" -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"eth_getBalance","params":["0xc128Eb26F177BB6a3b4374A715be350887ED7726","latest"]}' |
    node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>console.log(Number(BigInt(JSON.parse(s).result))/1e18))"
}

[ -n "$(pid_on 3001)" ] && { log "port 3001 busy"; exit 1; }
cp blockchain/deployments/sepolia.json "$OUT/sepolia.json.user" || { log "no sepolia.json to back up"; exit 1; }
log "balance before: $(balance) ETH" | tee "$OUT/balance.txt"

ROOT=$(sed -n 's/.*"root": *"\([0-9]*\)".*/\1/p' benchmarks/2026-11-12-hcmc-4.5M-final/data/phase3-hardhat/seed.json)
[ -n "$ROOT" ] || fail "no root in seed.json"

log "deploy bench contracts"
pnpm --filter blockchain run deploy:sepolia > "$OUT/deploy.txt" 2>&1 || fail "deploy"
cp blockchain/deployments/sepolia.json "$OUT/sepolia.json.bench"

log "publish genesis $ROOT"
NEW_ROOT=$ROOT pnpm --filter blockchain run sign:root:sepolia > "$OUT/genesis.txt" 2>&1 || fail "genesis"

log "start backend"
DATABASE_URL=$BENCH_DB pnpm --filter backend run start > "$OUT/backend.log" 2>&1 &
wait_port 3001 || fail "backend did not start"
BPID=$(pid_on 3001)
( while true; do m=$(tasklist //FI "PID eq $BPID" //FO CSV //NH 2>/dev/null | awk -F'","' '{gsub(/[",K ]/,"",$5); print $5}');
    echo "$(date +%s),$m"; sleep 2; done ) > "$OUT/backend-rss.csv" &
SAMPLER=$!

log "month replay ($DAYS days)"
DATABASE_URL=$BENCH_DB TRANSFERS=$((2994 * DAYS)) REVOCATIONS=$((950 * DAYS)) DAYS=$DAYS \
  pnpm --filter backend run bench:month > "$OUT/month.txt" 2>&1 || fail "bench:month"
cp "$(ls -t blockchain/bench/results/*/month.json | head -1)" "$OUT/month.json"

log "proof load"
for c in 1 4 16 50; do CONCURRENCY=$c REQUESTS=2000 SAMPLE=2000 pnpm --filter blockchain run bench:proof-load >> "$OUT/proof-load.txt" 2>&1; done
for c in 1 4 50; do ETAG=1 CONCURRENCY=$c REQUESTS=2000 SAMPLE=2000 pnpm --filter blockchain run bench:proof-load >> "$OUT/proof-load.txt" 2>&1; done
for c in 1 4 16 50; do ROUTE=attestation CONCURRENCY=$c REQUESTS=2000 SAMPLE=2000 pnpm --filter blockchain run bench:proof-load >> "$OUT/proof-load.txt" 2>&1; done

log "balance after: $(balance) ETH" | tee -a "$OUT/balance.txt"
cleanup
restore
log "ALL DONE"
