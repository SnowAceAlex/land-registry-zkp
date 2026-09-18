/**
 * lib/zkp.worker.ts - the proving and verifying worker behind lib/zkp.ts.
 *
 * Receives one WorkerRequest, answers with one WorkerResponse. Both operations
 * go through shared/zkpHelper: `generateGroth16Proof`, which accepts URLs in a
 * browser because snarkjs fetches the wasm and zkey itself, and
 * `verifyGroth16ProofWithKey`, which takes the vkey this worker fetched —
 * `verifyGroth16Proof` reads it from disk and cannot run here (D59).
 *
 * snarkjs is imported here and nowhere else on the client, so it stays in the
 * worker chunk.
 */

// Subpath: the worker needs snarkjs, but not circomlibjs, which the barrel
// would drag in through merkleTree.ts.
import {
  generateGroth16Proof,
  verifyGroth16ProofWithKey,
} from '@land-registry/blockchain/shared/zkpHelper';

import type { WorkerRequest, WorkerResponse } from './zkp';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
};

/**
 * Fetch and parse a verification key.
 *
 * A 404 here means `circuits:sync-frontend` was never run for this deployment
 * (D55). It is flagged separately because it is not a verification failure and
 * must never be shown as one: nothing is wrong with the proof.
 */
async function fetchVkey(vkeyUrl: string): Promise<Record<string, unknown>> {
  const res = await fetch(vkeyUrl, { cache: 'force-cache' });
  if (!res.ok) {
    throw new ArtifactMissing(
      `Could not load ${vkeyUrl} (HTTP ${res.status}). This deployment is missing its ` +
        `circuit artifacts — run \`pnpm --filter blockchain run circuits:sync-frontend\`.`,
    );
  }
  return (await res.json()) as Record<string, unknown>;
}

class ArtifactMissing extends Error {}

scope.onmessage = async (event) => {
  const request = event.data;
  try {
    if (request.kind === 'prove') {
      const { circuitType, input, wasmUrl, zkeyUrl } = request;
      const pkg = await generateGroth16Proof(input, wasmUrl, zkeyUrl, circuitType);
      scope.postMessage({ ok: true, kind: 'prove', pkg });
      return;
    }

    const { publicSignals, proof, vkeyUrl } = request;
    const vkey = await fetchVkey(vkeyUrl);
    const valid = await verifyGroth16ProofWithKey(vkey, publicSignals, proof);
    scope.postMessage({ ok: true, kind: 'verify', valid });
  } catch (error) {
    // An unsatisfied constraint ("Assert Failed") means the witness does not
    // describe a leaf in the tree; a fetch failure means the artifacts were
    // never synced. Either way the page shows this text, never a hang.
    scope.postMessage({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      artifactMissing: error instanceof ArtifactMissing,
    });
  }
};
