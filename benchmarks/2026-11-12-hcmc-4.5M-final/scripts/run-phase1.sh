#!/usr/bin/env bash
# Phase 1 (see ../README.md): tests, builds, lint, constraints, Node proving.
cd "$(dirname "$0")/../../.." || exit 1
OUT=benchmarks/2026-11-12-hcmc-4.5M-final/data/phase1
mkdir -p "$OUT"
step() { echo "=== $1 ($(date +%T))"; }

step "blockchain tests";  pnpm run test:blockchain            > "$OUT/tests-blockchain.txt" 2>&1; echo "exit $?"
cp blockchain/circuits/build/gas-metrics.json "$OUT/gas-metrics.json"
step "backend tests";     pnpm --filter backend run test       > "$OUT/tests-backend.txt" 2>&1; echo "exit $?"
step "frontend tests";    pnpm --filter frontend run test      > "$OUT/tests-frontend.txt" 2>&1; echo "exit $?"
step "backend build";     pnpm --filter backend run build      > "$OUT/build-backend.txt" 2>&1; echo "exit $?"
step "frontend build";    pnpm --filter frontend run build     > "$OUT/build-frontend.txt" 2>&1; echo "exit $?"
step "lint";              pnpm run lint                        > "$OUT/lint-root.txt" 2>&1; echo "exit $?"
step "frontend lint";     pnpm --filter frontend run lint      > "$OUT/lint-frontend.txt" 2>&1; echo "exit $?"
step "circuits compile";  pnpm --filter blockchain run circuits:compile > "$OUT/circuits-compile.txt" 2>&1; echo "exit $?"
step "bench prove";       ITERATIONS=10 pnpm --filter blockchain run bench:prove > "$OUT/bench-prove.txt" 2>&1; echo "exit $?"
ls -la web-app/frontend/public/circuits/*/ > "$OUT/artifact-sizes.txt"
step "done"
