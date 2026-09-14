/**
 * lib/zkp.worker.ts - the proving worker behind lib/zkp.ts.
 *
 * Receives one ProverRequest, answers with one ProverResponse. Proving goes
 * through shared/zkpHelper's generateGroth16Proof, which accepts URLs in a
 * browser; snarkjs fetches the wasm and zkey itself.
 */

import { generateGroth16Proof } from '@land-registry/blockchain/shared';

import type { ProverRequest, ProverResponse } from './zkp';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ProverRequest>) => void) | null;
  postMessage(message: ProverResponse): void;
};

scope.onmessage = async (event) => {
  const { circuitType, input, wasmUrl, zkeyUrl } = event.data;
  try {
    const pkg = await generateGroth16Proof(input, wasmUrl, zkeyUrl, circuitType);
    scope.postMessage({ ok: true, pkg });
  } catch (error) {
    // An unsatisfied constraint ("Assert Failed") means the witness does not
    // describe a leaf in the tree; a fetch failure means the artifacts were
    // never synced. Either way the page shows this text, never a hang.
    scope.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) });
  }
};
