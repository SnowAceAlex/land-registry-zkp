# Land Registry ZKP

> **Pre-thesis / Thesis**: Application of Blockchain in Real Estate Management  
> Privacy-preserving Land Use Rights (LUR) registry using **Merkle tree + Zero-Knowledge Proofs (Groth16)** on Ethereum.

---

## Architecture Overview

```
land-registry-zkp/
├── blockchain/          # Cryptographic layer: circom circuits, Hardhat contracts, shared ZKP logic
├── web-app/
│   ├── backend/         # NestJS API: LUR record management, Merkle proof endpoints, chain interaction
│   └── frontend/        # Next.js (App Router): owner dashboard, verifier interface
└── docker-compose.yml   # PostgreSQL 16 (host port 5433)
```

**Design principle**: All Merkle tree / Poseidon hash logic lives exclusively in `blockchain/shared/`. Both `backend` and `frontend` import it from the `@land-registry/blockchain` workspace package — no logic duplication.

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 18 | https://nodejs.org |
| pnpm | ≥ 8 | `npm i -g pnpm` |
| Docker Desktop | latest | https://www.docker.com/products/docker-desktop |
| Rust + Cargo | stable | https://rustup.rs |
| **circom compiler** | ≥ 2.x | `cargo install circom` *(see note below)* |

> ⚠️ **circom is a Rust binary, NOT an npm package.**  
> Install it with: `cargo install circom`  
> Verify: `circom --version`  
> This is required before compiling any `.circom` circuit files (not needed for the initial setup skeleton).

---

## Quick Start

### 1. Clone & Install Dependencies

```bash
git clone <repo-url>
cd land-registry-zkp

# Copy and fill environment variables
cp .env.example .env

# Install all workspace dependencies from root
pnpm install
```

### 2. Start PostgreSQL via Docker

```bash
# Starts postgres:16-alpine on host port 5433
docker compose up -d

# Verify it's running
docker compose ps
```

> Port **5433** is used (not 5432) to avoid conflicts with other local projects.

### 3. Run Prisma Migrations (first time)

```bash
# From root — targets the backend package
pnpm --filter backend prisma migrate dev --name init
```

### 4. Run Each Package

```bash
# Compile Solidity contracts (blockchain package)
pnpm --filter blockchain hardhat compile

# Start NestJS backend (port 3001)
pnpm --filter backend run start:dev

# Start Next.js frontend (port 3000)
pnpm --filter frontend run dev
```

Or use root shortcuts:
```bash
pnpm run db:up          # Start Docker Postgres
pnpm run compile        # Compile contracts
pnpm run dev:backend    # Start backend
pnpm run dev:frontend   # Start frontend
```

---

## Recommended Development Order

Follow this sequence to avoid dependency blockers:

### Phase 1 — Blockchain Layer (`blockchain/`)
1. Implement `shared/types.ts` — define `LURRecord`, `ProofInput`, `MerkleProofData`
2. Implement `shared/merkleTree.ts` — Poseidon-based Merkle tree (circomlibjs + merkletreejs)
3. Implement `shared/zkpHelper.ts` — snarkjs Groth16 wrapper
4. Write and compile circom circuits: `circuits/common/merkleProof.circom` → `circuits/ownership.circom` etc.
5. Run trusted setup: download powers-of-tau `.ptau` → `blockchain/ptau/`
6. Implement and test `contracts/RootRegistry.sol` via Hardhat

### Phase 2 — Backend (`web-app/backend/`)
> Requires: Docker Postgres running, Phase 1 shared logic done

1. Finalize Prisma schema, run `prisma migrate dev`
2. Implement `records.service.ts` — CRUD for LUR records
3. Implement `chain.service.ts` — connect ethers.js, call `RootRegistry`
4. Implement `proof.service.ts` — generate Merkle proofs using `@land-registry/blockchain`

### Phase 3 — Frontend (`web-app/frontend/`)
> Requires: Backend running

1. Configure wagmi + RainbowKit in `lib/wallet.ts`
2. Implement `lib/api.ts` — calls to NestJS backend
3. Implement `lib/zkp.ts` — client-side proof generation via snarkjs
4. Build owner dashboard (`app/owner/page.tsx`)
5. Build verifier interface (`app/verifier/page.tsx`)

---

## Environment Variables

See [`.env.example`](./.env.example) for all required variables.

Key variables:
| Variable | Description |
|----------|-------------|
| `SEPOLIA_RPC_URL` | Alchemy/Infura RPC for Sepolia testnet |
| `PRIVATE_KEY` | Deployer wallet private key |
| `DATABASE_URL` | PostgreSQL connection (default: port 5433 via Docker) |
| `NEXT_PUBLIC_CONTRACT_ADDRESS` | Deployed `RootRegistry` address |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | From cloud.walletconnect.com |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| ZKP Circuits | circom 2.x |
| Proof System | snarkjs (Groth16) |
| Merkle Tree | merkletreejs + Poseidon (circomlibjs) |
| Smart Contracts | Solidity 0.8.24 + OpenZeppelin |
| Contract Dev | Hardhat (TypeScript) |
| Backend | NestJS + Prisma + ethers.js |
| Database | PostgreSQL 16 |
| Frontend | Next.js 14 (App Router) + wagmi + RainbowKit |
| Package Manager | pnpm workspaces |
