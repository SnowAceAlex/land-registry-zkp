# Land Registry ZKP

> **Pre-thesis / Thesis**: Application of Blockchain in Real Estate Management  
> Privacy-preserving Land Use Rights (LUR) registry using **Merkle tree commitments + Zero-Knowledge Proofs (Groth16)** on Ethereum.

Records live off-chain; only the Merkle root is published on-chain. Owners prove facts about their land — "I own this", "this title is unencumbered and has ≥ N years left", "ownership moved from A to B" — without revealing the record itself.

---

## Architecture Overview

```
land-registry-zkp/
├── blockchain/          # Cryptographic layer: circom circuits, Hardhat contracts, shared ZKP logic
├── web-app/
│   ├── backend/         # NestJS API: LUR record management, Merkle proof endpoints, chain interaction
│   └── frontend/        # Next.js (App Router): government / owner / verifier portals
└── docker-compose.yml   # PostgreSQL 16 (host port 5433)
```

**Design principle**: All Merkle tree / Poseidon hash logic lives exclusively in `blockchain/shared/`. Both `backend` and `frontend` import it from the `@land-registry/blockchain` workspace package — no logic duplication.

**Companion docs**

| Document                           | What it covers                                                                                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`DEPLOYMENT.md`](./DEPLOYMENT.md) | Deploy runbook: local node → Sepolia trial → Sepolia official, plus troubleshooting                                                                            |
| `CODING_ROADMAP.md`                | Locked technical design: schema, circuit layout, contract architecture, and the binding Design Decisions Log (D1–D33) — _author's working copy, not committed_ |
| `THESIS_IMPLEMENTATION_GUIDE.md`   | Academic framing, timeline, evaluation checklist — _author's working copy, not committed_                                                                      |

---

## Current Status

Phases 0–4 of the roadmap are implemented and tested. The cryptographic and on-chain layers are complete; the web application is scaffolded but its service bodies are not written yet.

| Phase | Area                                                                     | Status         |
| ----- | ------------------------------------------------------------------------ | -------------- |
| 0     | Mock data generator, UTC+7 datetime utils                                | ✅ Done        |
| 1     | Merkle layer — Poseidon, fixed-depth-20 sparse tree                      | ✅ Done        |
| 2     | Circuits — `ownership`, `mortgage`, `transfer` (+3 shared templates)     | ✅ Done        |
| 3     | Trusted setup — Groth16 zkey/vkey/verifier export, prove + verify E2E    | ✅ Done        |
| 4     | Smart contracts — `RootRegistry`, `LandRegistryVerifier`, deploy scripts | ✅ Done        |
| 5–6   | Backend — government portal API, owner/proof API                         | ⬜ Not started |
| 7–9   | Frontend — government / owner / verifier portals                         | ⬜ Not started |
| 10–11 | E2E integration, evaluation metrics, thesis writing                      | ⬜ Not started |

**Test suite**: 101 passing (`pnpm run test:blockchain`). On a checkout without trusted-setup artifacts the proof-dependent tests self-skip → 85 passing + 16 pending, never failing.

---

## Prerequisites

| Tool                | Version | Install                                                                     |
| ------------------- | ------- | --------------------------------------------------------------------------- |
| Node.js             | ≥ 20    | https://nodejs.org                                                          |
| pnpm                | ≥ 8     | `npm i -g pnpm`                                                             |
| Rust + Cargo        | stable  | https://rustup.rs                                                           |
| **circom compiler** | ≥ 2.x   | `cargo install circom` _(see note)_                                         |
| Docker Desktop      | latest  | https://www.docker.com/products/docker-desktop — _only needed from Phase 5_ |

> ⚠️ **circom is a Rust binary, NOT an npm package.**  
> Install with `cargo install circom`, verify with `circom --version`.  
> Required to compile circuits and to run the circuit tests. Not needed for the rest of the stack.

---

## Quick Start

Everything below runs from the repo root.

### 1. Clone & install

```bash
git clone <repo-url>
cd land-registry-zkp
cp .env.example .env
pnpm install
```

Nothing in `.env` is required for the local test suite — fill it in when you reach the deploy step.

### 2. Compile the circuits

```bash
pnpm --filter blockchain run circuits:compile
```

Outputs `.r1cs` / `.wasm` / `.sym` into `blockchain/circuits/build/<name>/` and prints the constraint table.

### 3. Run the trusted setup

```bash
pnpm --filter blockchain run circuits:setup
```

⚠️ **Do not skip this.** It produces the proving keys _and_ the three generated `Groth16Verifier*.sol` contracts, all of which are gitignored — a fresh clone does not have them. The step downloads two public Powers-of-Tau files (~18 MB and ~36 MB, cached afterwards), runs the circuit-specific Phase-2 setup, then proves and verifies each circuit end to end.

It also auto-syncs the generated verifiers into `blockchain/contracts/verifiers/` so Hardhat can compile them.

### 4. Compile the contracts

```bash
pnpm run compile
```

Builds all Solidity sources and regenerates the TypeChain bindings.

### 5. Run the tests

```bash
pnpm run test:blockchain
```

Expect **101 passing** (~25s). If you see 85 passing + 16 pending, step 3 did not complete — the proof-dependent tests skipped themselves.

### 6. Deploy (optional)

```bash
pnpm --filter blockchain run node          # terminal 1 — local chain, leave running
```

```bash
pnpm --filter blockchain run deploy:localhost   # terminal 2
pnpm --filter blockchain run chain:smoke:localhost    # health check
```

See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for the full runbook, including Sepolia and Etherscan verification.

### 7. Database — needed from Phase 5 onward

The backend service bodies are not implemented yet, so this is setup-ahead, not a requirement to run anything today.

```bash
pnpm run db:up                             # postgres:16-alpine on host port 5433
pnpm --filter backend prisma migrate dev   # applies the existing migrations
```

> Port **5433** (not 5432) avoids conflicts with other local Postgres instances.

---

## Commands Reference

```bash
# Circuits & proving keys
pnpm --filter blockchain run circuits:compile     # circom → build/ + constraint table
pnpm --filter blockchain run circuits:setup       # trusted setup + verifier sync
pnpm --filter blockchain run verifiers:sync       # re-sync verifiers only (no re-setup)
pnpm --filter blockchain run mock:generate [N]    # regenerate fixtures (default 20 records)

# Contracts
pnpm run compile                                  # hardhat compile + typechain
pnpm run test:blockchain                          # full test suite
pnpm --filter blockchain run node                 # local chain on 127.0.0.1:8545
pnpm --filter blockchain run deploy:localhost     # deploy to that chain
pnpm --filter blockchain run deploy:sepolia       # deploy to Sepolia
pnpm --filter blockchain run chain:smoke:localhost      # verify a live deployment
pnpm --filter blockchain run chain:smoke:sepolia

# Web app (scaffolded, service bodies pending)
pnpm run db:up / db:down                          # docker compose
pnpm run dev:backend                              # NestJS, port 3001
pnpm run dev:frontend                             # Next.js, port 3000
```

---

## Environment Variables

See [`.env.example`](./.env.example) for the full list.

| Variable                               | Description                                               | Needed for     |
| -------------------------------------- | --------------------------------------------------------- | -------------- |
| `SEPOLIA_RPC_URL`                      | Alchemy/Infura RPC for Sepolia                            | Sepolia deploy |
| `PRIVATE_KEY`                          | Deployer wallet private key                               | Sepolia deploy |
| `ETHERSCAN_API_KEY`                    | Source verification via `hardhat verify`                  | Sepolia deploy |
| `AUTHORITY_ADDRESS`                    | Account granted `STATE_AUTHORITY_ROLE` — blank = deployer | Any deploy     |
| `AUTHORITY_ORG_NAME`                   | X.509 Subject `O` anchored on-chain (D30)                 | Any deploy     |
| `DATABASE_URL`                         | PostgreSQL connection (port 5433 via Docker)              | Phase 5+       |
| `NEXT_PUBLIC_CONTRACT_ADDRESS`         | Deployed `RootRegistry` address                           | Phase 7+       |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | From cloud.walletconnect.com                              | Phase 7+       |

---

## Tech Stack

| Layer           | Technology                                                               |
| --------------- | ------------------------------------------------------------------------ |
| ZKP Circuits    | circom 2.2.3                                                             |
| Proof System    | snarkjs (Groth16), Powers-of-Tau from the public Hermez/iden3 ceremony   |
| Merkle Tree     | Hand-written fixed-depth-20 **sparse** tree + Poseidon via `circomlibjs` |
| Smart Contracts | Solidity 0.8.36 + OpenZeppelin 5                                         |
| Contract Dev    | Hardhat 2 (TypeScript) + TypeChain                                       |
| Backend         | NestJS 10 + Prisma 7 + ethers v6                                         |
| Database        | PostgreSQL 16                                                            |
| Frontend        | Next.js 16 (App Router) + React 19 + wagmi + RainbowKit                  |
| Package Manager | pnpm workspaces                                                          |

> The Merkle tree is deliberately **not** `merkletreejs`: that library pads to the next power of two, while the circuits need a fixed depth of 20 regardless of record count. The package was removed from the dependencies once it was confirmed to have zero imports.
