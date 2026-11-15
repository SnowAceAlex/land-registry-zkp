#!/usr/bin/env bash
# Chains the restartable bench stages: seed.json (from the seed and bootstrap logs), Hardhat month, Sepolia days.
cd "$(dirname "$0")/../../.." || exit 1
E=benchmarks/2026-11-12-hcmc-4.5M-final/scripts
OUT=benchmarks/2026-11-12-hcmc-4.5M-final/data/phase3-hardhat
log() { echo "[$(date +%T)] $*"; }

if [ ! -f "$OUT/seed.json" ]; then
  node -e "
const fs=require('fs');const o='$OUT';
const seed=fs.readFileSync(o+'/seed.txt','utf8'), boot=fs.readFileSync(o+'/bootstrap.txt','utf8');
const num=(re,s)=>{const m=s.match(re); if(!m) throw new Error('missing '+re); return m[1].replace(/,/g,'');};
const report={kind:'seed',note:'rows from the 12/11 seed run (interrupted by a machine shutdown during the tree build); tree rebuilt by tree:bootstrap on the same rows',
  treeDepth:24,count:4500000,layout:'scattered',
  rowsMs:Math.round(parseFloat(num(/rows inserted in ([0-9.]+)s/,seed))*1000),
  bootstrapMs:Math.round(parseFloat(num(/elapsed: ([0-9.]+)s/,boot))*1000),
  leaves:Number(num(/leaves : ([0-9,]+)/,boot)),nodes:Number(num(/nodes  : ([0-9,]+)/,boot)),
  root:num(/root   : ([0-9]+)/,boot)};
fs.writeFileSync(o+'/seed.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));" || { log "FAILED: seed.json"; exit 1; }
  docker exec land_registry_postgres psql -U postgres -At -c \
    "select pg_size_pretty(pg_database_size('land_registry_bench_final'))" > "$OUT/db-size-seed.txt"
fi

log "hardhat stage"
bash $E/run-bench-hardhat.sh || { log "FAILED: hardhat stage"; exit 1; }
log "sepolia stage"
bash $E/run-bench-sepolia.sh || { log "FAILED: sepolia stage"; exit 1; }
log "ALL STAGES DONE"
