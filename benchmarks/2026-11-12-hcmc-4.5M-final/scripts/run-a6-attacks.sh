#!/usr/bin/env bash
# A6: attack and refusal cases (c), (d), (e), (f) on a local chain, plus (b) and (n) since the state
# is there anyway. A 10-plot registry (blockchain/fixtures/demoImport.csv) is issued, transferred and
# revoked through the real API; sign:root stands in for MetaMask (D43). No screenshots: those stay M3.
#   WORK_DIR=<folder outside the repo> bash run-a6-attacks.sh
cd "$(dirname "$0")/../../.." || exit 1
. benchmarks/2026-11-12-hcmc-4.5M-final/scripts/lib.sh
OUT=$PWD/$RUN/data/a6-attacks
mkdir -p "$OUT"
W=$(cygpath -u "${WORK_DIR:?set WORK_DIR outside the repo: bundles carry owner secrets}")
mkdir -p "$W"
DB=land_registry_bench_a6
B=http://localhost:3001/api
export GOV_API_KEY
GOV_API_KEY=$(sed -n 's/^GOV_API_KEY=//p' web-app/backend/.env | tr -d "\"'\r")
trap all_down EXIT
ports_free || { log "FAILED: ports 3001/8545 busy"; exit 1; }

win() { cygpath -w "$1"; }
api() { curl -s -H "x-gov-api-key: $GOV_API_KEY" -H 'content-type: application/json' "$@"; }
# jget '.a.b' < file.json — prints one value (objects as JSON)
jget() { node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const v=eval('JSON.parse(s)'+process.argv[1]);console.log(typeof v==='object'?JSON.stringify(v):v)})" "$1"; }
verify_api() {  # $1 body file, $2 onChain true|false, $3 out file
  node -e "const b=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));b.onChain=process.argv[2]==='true';process.stdout.write(JSON.stringify(b))" "$(win "$1")" "$2" > "$W/body.tmp"
  curl -s -w '\nHTTP %{http_code}\n' -X POST -H 'content-type: application/json' --data-binary @"$W/body.tmp" $B/proof/verify > "$3"
}
verify_chain() { MINE=1 pnpm --filter blockchain exec ts-node scripts/bench/verifyOnChain.ts "$(win "$1")" 2>&1 | grep -E "valid|REVERT"; }
publish_round() {  # $1 label; publishes the whole queue, downloads every archive into $W/$1/
  api -X POST $B/government/changesets > "$OUT/$1-draft.json"
  local id root
  id=$(jget '.id' < "$OUT/$1-draft.json"); root=$(jget '.newRoot' < "$OUT/$1-draft.json")
  node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const c=JSON.parse(s).revocationCalldata;console.log(JSON.stringify(c.propertyIds.map((p,i)=>({propertyId:p,reasonCode:c.reasonCodes[i],detailHash:c.detailHashes[i]}))))})" < "$OUT/$1-draft.json" > "$W/$1-revocations.json"
  if [ "$(cat "$W/$1-revocations.json")" = "[]" ]; then
    NEW_ROOT=$root pnpm --filter blockchain run sign:root > "$OUT/$1-sign.txt" 2>&1
  else
    NEW_ROOT=$root REVOCATIONS_FILE=$(win "$W/$1-revocations.json") pnpm --filter blockchain run sign:root > "$OUT/$1-sign.txt" 2>&1
  fi
  local tx; tx=$(sed -n 's/^txHash *\(0x[0-9a-f]*\).*/\1/p' "$OUT/$1-sign.txt")
  api -X POST $B/government/changesets/$id/confirm -d "{\"txHash\":\"$tx\"}" > "$OUT/$1-confirm.json"
  fetch_archives "$id" "$1"
}
fetch_archives() {  # $1 change set id, $2 label
  mkdir -p "$W/$2"
  api $B/government/changesets/$1/archives > "$OUT/$2-archives.json"
  for code in $(node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const j=JSON.parse(s);(Array.isArray(j)?j:j.items).forEach(a=>console.log(a.officeCode))})" < "$OUT/$2-archives.json"); do
    api -o "$W/$2-$code.zip" $B/government/changesets/$1/archives/$code
    unzip -o -q "$W/$2-$code.zip" -d "$W/$2"
  done
}
latest_round() { api $B/government/changesets | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const j=JSON.parse(s);const a=Array.isArray(j)?j:j.items;console.log(Math.max(...a.filter(r=>r.status==='PUBLISHED').map(r=>r.id)))})"; }

log "fresh registry $DB: migrations, communes, offices"
psqlc "DROP DATABASE IF EXISTS $DB" > /dev/null
docker exec land_registry_postgres createdb -U postgres $DB || exit 1
DATABASE_URL=$(db_url $DB) pnpm --filter backend exec prisma migrate deploy > "$OUT/migrate.txt" 2>&1 || exit 1
DATABASE_URL=$(db_url $DB) pnpm --filter backend run seed:admin-units DVHC_TPHCM.csv --province "TP.HCM" > /dev/null 2>&1 || exit 1
DATABASE_URL=$(db_url $DB) pnpm --filter backend run seed:land-offices > "$W/office-keys.txt" 2>&1 || exit 1

node_up "$OUT" || exit 1
# Hardhat's public test accounts: #0 deploys and is the authority, #1 is the local attester (deploy.ts).
KEY0=$(sed -n 's/^Private Key: *\(0x[0-9a-fA-F]*\).*/\1/p' "$OUT/hardhat-node.log" | sed -n 1p)
KEY1=$(sed -n 's/^Private Key: *\(0x[0-9a-fA-F]*\).*/\1/p' "$OUT/hardhat-node.log" | sed -n 2p)
addr_of() { (cd blockchain && K=$1 node -e "console.log(new (require('ethers').Wallet)(process.env.K).address)"); }
# The root .env may name the Sepolia attester/authority; the local contracts must grant the keys used here.
AUTHORITY_ADDRESS=$(addr_of "$KEY0") ATTESTER_ADDRESS=$(addr_of "$KEY1") \
  pnpm --filter blockchain run deploy:localhost > "$OUT/deploy.txt" 2>&1 || exit 1
export AUTHORITY_PRIVATE_KEY=$KEY0 ATTESTER_PRIVATE_KEY=$KEY1
backend_up $DB "$OUT" || { log "FAILED: backend"; exit 1; }

log "UC-2 import + UC-1 issue 201-210 (round 1)"
CSV=blockchain/fixtures/demoImport.csv
curl -s -H "x-gov-api-key: $GOV_API_KEY" -F "file=@$CSV;type=text/csv" "$B/government/import?dryRun=true" > "$OUT/import-dry.json"
curl -s -H "x-gov-api-key: $GOV_API_KEY" -F "file=@$CSV;type=text/csv" "$B/government/import" > "$OUT/import.json"
api -X POST $B/government/issuance-requests -d '{"propertyIds":["201","202","203","204","205","206","207","208","209","210"]}' > "$OUT/issuance-requests.json"
publish_round round1
R1=$W/round1

log "baseline: a genuine bundle passes"
pnpm --filter blockchain run receipt:verify "$(win "$R1/206/receipt.json")" > "$OUT/baseline-receipt-verify-206.txt" 2>&1
pnpm --filter blockchain run owner:smoke "$(win "$R1/206")" > "$OUT/baseline-owner-smoke-206.txt" 2>&1

log "(f) tampered receipt: area + 1"
rm -rf "$W/f-206" && cp -r "$R1/206" "$W/f-206"
node -e "const f=process.argv[1],fs=require('fs');const r=JSON.parse(fs.readFileSync(f,'utf8'));const before=r.record.area;r.record.area=Number(before)+1;fs.writeFileSync(f,JSON.stringify(r,null,2));console.log('record.area',before,'->',r.record.area)" "$(win "$W/f-206/receipt.json")" > "$OUT/f-tamper.txt"
pnpm --filter blockchain run receipt:verify "$(win "$W/f-206/receipt.json")" >> "$OUT/f-tamper.txt" 2>&1
echo "--- owner:smoke on the tampered bundle" >> "$OUT/f-tamper.txt"
pnpm --filter blockchain run owner:smoke "$(win "$W/f-206")" >> "$OUT/f-tamper.txt" 2>&1

log "(e) replay: bodies for 206, verified fresh, then again after 11 minutes (no root change between)"
pnpm --filter blockchain run proof:bodies "$(win "$R1/206")" "$(win "$W/e-206")" > "$OUT/e-proof-bodies.txt" 2>&1
verify_api "$W/e-206/ownership.verify.json" true "$OUT/e-verify-fresh.txt"
verify_chain "$W/e-206/ownership.verify.json" > "$OUT/e-chain-fresh.txt"
sleep 660
verify_api "$W/e-206/ownership.verify.json" false "$OUT/e-verify-stale-offchain.txt"
verify_api "$W/e-206/ownership.verify.json" true "$OUT/e-verify-stale-onchain.txt"
verify_chain "$W/e-206/ownership.verify.json" > "$OUT/e-chain-stale.txt"

log "(c) old owner after the round: proof for 201 made before its transfer, then the transfer is published"
pnpm --filter blockchain run proof:bodies "$(win "$R1/201")" "$(win "$W/c-201")" > "$OUT/c-proof-bodies-before.txt" 2>&1
verify_api "$W/c-201/ownership.verify.json" true "$OUT/c-verify-before-round.txt"
pnpm --filter blockchain run transfer:smoke "$(win "$R1/201")" > "$OUT/c-transfer-smoke.txt" 2>&1
verify_api "$W/c-201/ownership.verify.json" true "$OUT/c-verify-after-round.txt"
verify_chain "$W/c-201/ownership.verify.json" > "$OUT/c-chain-after-round.txt"
pnpm --filter blockchain run owner:smoke "$(win "$R1/201")" > "$OUT/c-old-owner-smoke.txt" 2>&1
R2=$(latest_round)
fetch_archives "$R2" round2
pnpm --filter blockchain run owner:smoke "$(win "$W/round2/201")" > "$OUT/c-new-owner-smoke.txt" 2>&1

log "(d) + (b) revoke 203: refused while open, gone after the round"
api -X POST $B/government/revocations -d '{"propertyId":"203","reasonCode":1,"detailText":"A6 bench: Nha nuoc thu hoi dat"}' > "$OUT/d-revocation.json"
pnpm --filter blockchain run proof:bodies "$(win "$R1/203")" "$(win "$W/b-203")" > "$OUT/b-proof-bodies-open.txt" 2>&1
verify_api "$W/b-203/ownership.verify.json" true "$OUT/b-verify-open.txt"
verify_chain "$W/b-203/ownership.verify.json" > "$OUT/b-chain-open.txt"
publish_round round3
curl -s -w '\nHTTP %{http_code}\n' $B/proof/203 > "$OUT/d-proof-203.txt"
curl -s $B/records/203/history > "$OUT/d-history-203.json"
(cd blockchain && node -e "
const {ethers}=require('ethers');const d=require('./deployments/localhost.json');
const r=new ethers.Contract(d.contracts.RootRegistry,['function isRevoked(uint256) view returns (bool)'],new ethers.JsonRpcProvider('http://127.0.0.1:8545'));
Promise.all([r.isRevoked(203),r.isRevoked(206)]).then(([a,b])=>console.log('isRevoked(203) =',a,' isRevoked(206) =',b))") > "$OUT/d-isRevoked.txt"
pnpm --filter blockchain run owner:smoke "$(win "$R1/203")" > "$OUT/d-owner-smoke-203.txt" 2>&1

log "(n) default throttle: 70 requests in a burst"
stop_port 3001
( unset THROTTLE_LIMIT; backend_up $DB "$OUT" ) || { log "FAILED: backend (default throttle)"; exit 1; }
for i in $(seq 1 70); do curl -s -o /dev/null -w '%{http_code}\n' $B/records/206; done | sort | uniq -c > "$OUT/n-throttle.txt"
log "A6 DONE"
