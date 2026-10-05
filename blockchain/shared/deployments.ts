/**
 * shared/deployments.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Reads `blockchain/deployments/<network>.json` — the record `scripts/chain/deploy.ts`
 * writes — so every consumer talks to the deployment that was actually made
 * rather than to addresses copied into env by hand.
 *
 * WHY THIS IS SHARED. The backend's ChainService, `scripts/chain/smokeDeployment.ts`
 * and `scripts/tools/verifyReceipt.ts` each declared their own `DeploymentRecord` and
 * their own loader. The three had already drifted — one of them knew about
 * `deployedAt` and the others did not — which is the mild version of the
 * failure mode: the bad version is a consumer reading a field the writer
 * stopped emitting and getting `undefined` at runtime instead of a type error.
 *
 * ⚠️ `fs` is imported lazily, exactly as `verifyGroth16Proof` does it. This
 * module is re-exported from `shared/index.ts`, and a static `fs` import would
 * pull Node's filesystem into the Phase 8/9 browser bundle. Nothing in the
 * browser calls `loadDeployment` — the frontend gets its address from
 * `NEXT_PUBLIC_CONTRACT_ADDRESS` — but the barrel must stay importable there.
 */

import * as path from 'path';

export type ChainNetwork = 'localhost' | 'sepolia' | 'hardhat';

/** The shape `scripts/chain/deploy.ts` writes. Adding a field here is a contract change. */
export interface DeploymentRecord {
  network: string;
  chainId: number;
  /** ISO timestamp of the deploy run. */
  deployedAt: string;
  deployer: string;
  /** D30 — the account granted STATE_AUTHORITY_ROLE and its anchored identity. */
  authority: {
    address: string;
    orgName: string;
    instituteHash: string;
  };
  /** D82 — the account granted ATTESTER_ROLE (absent in records older than D82). */
  attester?: string;
  /** Contract name → address, e.g. `RootRegistry`, `LandRegistryVerifier`. */
  contracts: Record<string, string>;
}

/** `blockchain/deployments/<network>.json` for the given package root. */
export function deploymentPath(blockchainDir: string, network: string): string {
  return path.join(blockchainDir, 'deployments', `${network}.json`);
}

/**
 * @param blockchainDir absolute path to the `blockchain/` package root
 * @throws when the network has never been deployed to — with the command that
 *   fixes it, since that is the only useful thing to say at this point.
 */
export function loadDeployment(blockchainDir: string, network: string): DeploymentRecord {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs');
  const recordPath = deploymentPath(blockchainDir, network);

  if (!fs.existsSync(recordPath)) {
    throw new Error(
      `No deployment record at ${recordPath}. Deploy to this network first ` +
        `(pnpm --filter blockchain run deploy:${network}) — see DEPLOYMENT.md.`,
    );
  }
  return JSON.parse(fs.readFileSync(recordPath, 'utf8')) as DeploymentRecord;
}

/**
 * The RPC endpoint for a network, honouring the same env overrides everywhere.
 *
 * `RPC_URL` wins so a single variable can point the whole stack at a fork or a
 * tunnelled node without touching per-network settings.
 */
export function resolveRpcUrl(network: string): string {
  if (process.env.RPC_URL) return process.env.RPC_URL;

  if (network === 'sepolia') {
    const url = process.env.SEPOLIA_RPC_URL;
    if (!url) {
      throw new Error('CHAIN_NETWORK=sepolia requires SEPOLIA_RPC_URL (or RPC_URL) to be set');
    }
    return url;
  }
  return 'http://127.0.0.1:8545';
}
