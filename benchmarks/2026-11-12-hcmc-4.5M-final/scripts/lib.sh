#!/usr/bin/env bash
# Shared helpers for the follow-up runs (A1–A6). Sourced by run-a*.sh after they cd to the repo root.
RUN=benchmarks/2026-11-12-hcmc-4.5M-final
PRISTINE=land_registry_bench_final
export CHAIN_NETWORK=localhost RPC_URL=http://127.0.0.1:8545 REVOCATION_CAP=591 THROTTLE_LIMIT=1000000

log() { echo "[$(date +%T)] $*"; }
psqlc() { docker exec land_registry_postgres psql -U postgres -At -c "$1"; }
psqld() { docker exec land_registry_postgres psql -U postgres -d "$1" -At -c "$2"; }
db_url() { echo "postgresql://postgres:postgres@localhost:5433/$1?schema=public"; }
pid_on() { netstat -ano | awk -v p=":$1" '$2 ~ p"$" && $4=="LISTENING" {print $5; exit}'; }
wait_port() { for _ in $(seq 1 600); do [ -n "$(pid_on "$1")" ] && return 0; sleep 1; done; return 1; }
stop_port() {
  local p; p=$(pid_on "$1"); [ -n "$p" ] && taskkill //PID "$p" //T //F >/dev/null 2>&1
  for _ in $(seq 1 30); do [ -z "$(pid_on "$1")" ] && return 0; sleep 1; done; return 0
}
ports_free() { [ -z "$(pid_on 3001)" ] && [ -z "$(pid_on 8545)" ]; }
clone_db() { psqlc "DROP DATABASE IF EXISTS $2" >/dev/null && docker exec land_registry_postgres createdb -U postgres -T "$1" "$2"; }
root_of() { psqld "$1" "select \"newRoot\" from change_sets where status='PUBLISHED' order by id desc limit 1"; }

# deployments/localhost.json is untracked: keep the user's copy once, put it back after every run.
LOCAL_BACKUP=$RUN/data/localhost.json.user
[ -f "$LOCAL_BACKUP" ] || cp blockchain/deployments/localhost.json "$LOCAL_BACKUP"

# Fresh Hardhat node ($1 out dir). Scripts that boot a Nest context (bench:seed) need it up first.
node_up() {
  pnpm --filter blockchain run node > "$1/hardhat-node.log" 2>&1 &
  wait_port 8545
}
# Fresh contracts and one published root. $1 out dir, $2 root (decimal).
deploy_genesis() {
  pnpm --filter blockchain run deploy:localhost > "$1/deploy.txt" 2>&1 || return 1
  NEW_ROOT=$2 pnpm --filter blockchain run sign:root > "$1/genesis.txt" 2>&1
}
chain_up() { node_up "$1" && deploy_genesis "$1" "$2"; }

# Backend on database $1, log in $2. Extra env (keys for A6) comes from the caller.
backend_up() {
  DATABASE_URL=$(db_url "$1") pnpm --filter backend run start > "$2/backend.log" 2>&1 &
  wait_port 3001
}

all_down() {
  stop_port 3001
  stop_port 8545
  cp "$LOCAL_BACKUP" blockchain/deployments/localhost.json
}
