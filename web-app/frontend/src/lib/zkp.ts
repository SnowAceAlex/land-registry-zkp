/**
 * lib/zkp.ts - shared by UC-3 (transfers), UC-5 (proof) and UC-6 (verify)
 * ─────────────────────────────────────────────────────────────────────────────
 * Client-side Groth16 proving, in a Web Worker.
 *
 * ⚠️  PRIVACY NOTE:
 *   Proof generation MUST happen client-side so the private witness
 *   (ownerSecret, the full record) never leaves the browser. At the government
 *   transfer counter that browser is the officer's, not the owner's (D47) — the
 *   secret still never reaches the backend, which is the claim that holds.
 *   Only the resulting proof + public signals go over the network.
 *
 * WHY A WORKER. fullProve takes seconds (transfer: ~24k constraints) and would
 * freeze the tab — the officer would see a dead page with both parties waiting
 * at the counter. The worker calls shared/zkpHelper's generateGroth16Proof, so
 * proving still goes through the one entry point every other layer uses.
 *
 * ARTIFACTS. The wasm/zkey are served from public/circuits/<circuit>/, copied
 * there by `circuits:sync-frontend` (run automatically by `circuits:setup`,
 * D55). A missing copy surfaces as a 404 inside the worker, reported here.
 *
 * This module imports types only from the shared barrel: snarkjs and
 * circomlibjs load inside the worker chunk, not with the page.
 */

import type { CircuitType, ProofInput, ProofPackage } from '@land-registry/blockchain/shared';

export interface CircuitArtifactUrls {
  wasmUrl: string;
  zkeyUrl: string;
  vkeyUrl: string;
}

/**
 * Absolute URLs of one circuit's artifacts. Absolute on purpose: a
 * root-relative path inside a worker resolves against the worker script's
 * location in `/_next/static/chunks/`, which is not where the files are.
 */
export function circuitArtifactUrls(circuitType: CircuitType, origin: string): CircuitArtifactUrls {
  const base = `${origin}/circuits/${circuitType}`;
  return {
    wasmUrl: `${base}/${circuitType}.wasm`,
    zkeyUrl: `${base}/${circuitType}.zkey`,
    vkeyUrl: `${base}/verification_key.json`,
  };
}

/** Message the page posts to the worker. */
export interface ProverRequest {
  circuitType: CircuitType;
  input: ProofInput;
  wasmUrl: string;
  zkeyUrl: string;
}

/** Message the worker posts back — exactly one per request. */
export type ProverResponse = { ok: true; pkg: ProofPackage } | { ok: false; message: string };

/**
 * Prove in a fresh worker and terminate it afterwards: snarkjs keeps its own
 * thread pool alive, and a long-lived worker would hold the witness in memory
 * after the counter has moved on.
 */
export function generateProof(
  circuitType: CircuitType,
  input: ProofInput,
): Promise<{ pkg: ProofPackage; durationMs: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./zkp.worker.ts', import.meta.url));
    const startedAt = performance.now();

    worker.onmessage = (event: MessageEvent<ProverResponse>) => {
      worker.terminate();
      if (event.data.ok) {
        resolve({ pkg: event.data.pkg, durationMs: Math.round(performance.now() - startedAt) });
      } else {
        reject(new Error(event.data.message));
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'The proving worker stopped unexpectedly'));
    };

    const { wasmUrl, zkeyUrl } = circuitArtifactUrls(circuitType, window.location.origin);
    worker.postMessage({ circuitType, input, wasmUrl, zkeyUrl } satisfies ProverRequest);
  });
}
