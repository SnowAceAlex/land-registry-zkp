#!/usr/bin/env bash
# Phase 2.4/2.5 + wallet balance. Reads RPC URL and keys from .env without echoing them.
cd "$(dirname "$0")/../../.." || exit 1
OUT=benchmarks/2026-11-12-hcmc-4.5M-final/data/phase2
mkdir -p "$OUT"
set -a; . ./.env; set +a
MAINNET=https://ethereum-rpc.publicnode.com
rpc() { curl -s -X POST "$1" -H 'content-type: application/json' --data "$2"; }

for net in mainnet sepolia; do
  url=$MAINNET; [ $net = sepolia ] && url=$SEPOLIA_RPC_URL
  rpc "$url" '{"jsonrpc":"2.0","id":1,"method":"eth_getBlockByNumber","params":["latest",false]}' > "$OUT/latest-block-$net.json"
  rpc "$url" '{"jsonrpc":"2.0","id":1,"method":"eth_feeHistory","params":["0x400","latest",[10,50,90]]}' > "$OUT/feehistory-$net.json"
done
curl -s https://api.coinbase.com/v2/prices/ETH-USD/spot > "$OUT/eth-usd.json"

# Deployer + authority balance on Sepolia (addresses derived from the keys by node, keys never printed)
for k in PRIVATE_KEY AUTHORITY_PRIVATE_KEY; do
  addr=$(cd blockchain && node -e "const {Wallet}=require('ethers');console.log(new Wallet(process.env.$k).address)")
  bal=$(rpc "$SEPOLIA_RPC_URL" "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getBalance\",\"params\":[\"$addr\",\"latest\"]}")
  echo "$k $addr $bal" >> "$OUT/sepolia-balances.txt"
done

node -e "
const fs=require('fs');const d='$OUT';
for (const n of ['mainnet','sepolia']) {
  const b=JSON.parse(fs.readFileSync(d+'/latest-block-'+n+'.json')).result;
  const f=JSON.parse(fs.readFileSync(d+'/feehistory-'+n+'.json')).result;
  const base=f.baseFeePerGas.map(x=>Number(BigInt(x)))/1;
  const bs=f.baseFeePerGas.map(x=>Number(BigInt(x))/1e9).sort((a,b)=>a-b);
  const p=(a,q)=>a[Math.floor(q*(a.length-1))];
  const tip=f.reward.map(r=>Number(BigInt(r[1]))/1e9).sort((a,b)=>a-b);
  console.log(n,'block',parseInt(b.number),new Date(parseInt(b.timestamp)*1000).toISOString(),
    'glamsterdam',('blockAccessListHash' in b),'gasLimit',parseInt(b.gasLimit),
    'baseFee p10/p50/p90 gwei',p(bs,.1).toFixed(4),p(bs,.5).toFixed(4),p(bs,.9).toFixed(4),'tip p50',p(tip,.5).toFixed(4));
}
for (const l of fs.readFileSync(d+'/sepolia-balances.txt','utf8').trim().split('\n')) {
  const [k,a,j]=[l.split(' ')[0],l.split(' ')[1],l.split(' ').slice(2).join(' ')];
  console.log(k,a,'balance ETH',Number(BigInt(JSON.parse(j).result))/1e18);
}
console.log('ETH-USD',JSON.parse(fs.readFileSync(d+'/eth-usd.json')).data.amount);
" | tee "$OUT/summary.txt"
