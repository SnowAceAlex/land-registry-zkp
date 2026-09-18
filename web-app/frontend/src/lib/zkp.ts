/**
 * lib/zkp.ts - shared by UC-3 (transfers), UC-5 (proof) and UC-6 (verify)
 * ─────────────────────────────────────────────────────────────────────────────
 * Client-side Groth16 proving AND verification, in a Web Worker.
 *
 * ⚠️  PRIVACY NOTE:
 *   Proof generation MUST happen client-side so the private witness
 *   (ownerSecret, the full record) never leaves the browser. At the government
 *   transfer counter that browser is the officer's, not the owner's (D47) — the
 *   secret still never reaches the backend, which is the claim that holds. On
 *   /resident/proof it is the owner's own machine, so the claim is absolute.
 *   Only the resulting proof + public signals go over the network.
 *
 * WHY A WORKER. fullProve takes seconds (transfer: ~24k constraints) and would
 * freeze the tab — the officer would see a dead page with both parties waiting
 * at the counter. Verification is fast, but it rides the same worker (D59) for
 * a bundling reason rather than a latency one: snarkjs is large, and one worker
 * chunk keeps it out of the page chunk entirely.
 *
 * Both operations go through shared/zkpHelper, the one entry point every other
 * layer uses — proving via generateGroth16Proof, verifying via
 * verifyGroth16ProofWithKey, which takes the vkey this page fetched because a
 * browser cannot read one off disk.
 *
 * ARTIFACTS. The wasm/zkey/vkey are served from public/circuits/<circuit>/,
 * copied there by `circuits:sync-frontend` (run automatically by
 * `circuits:setup`, D55). A missing copy surfaces as a 404 inside the worker
 * and is reported here with `artifactMissing`, so a screen can name the command
 * instead of showing a generic failure.
 *
 * This module imports types only from the shared barrel: snarkjs and
 * circomlibjs load inside the worker chunk, not with the page.
 */

import type {
  CircuitType,
  Groth16Proof,
  ProofInput,
  ProofPackage,
  PublicSignals,
} from '@land-registry/blockchain/shared';

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

/** Message the page posts to the worker — exactly one per worker. */
export type WorkerRequest =
  | {
      kind: 'prove';
      circuitType: CircuitType;
      input: ProofInput;
      wasmUrl: string;
      zkeyUrl: string;
    }
  | {
      kind: 'verify';
      circuitType: CircuitType;
      publicSignals: PublicSignals;
      proof: Groth16Proof;
      vkeyUrl: string;
    };

/** Message the worker posts back — exactly one per request. */
export type WorkerResponse =
  | { ok: true; kind: 'prove'; pkg: ProofPackage }
  | { ok: true; kind: 'verify'; valid: boolean }
  | { ok: false; message: string; artifactMissing?: boolean };

/** Raised when the worker could not fetch an artifact — see D55. */
export class ArtifactMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtifactMissingError';
  }
}

/**
 * Run one request in a fresh worker and terminate it afterwards: snarkjs keeps
 * its own thread pool alive, and a long-lived worker would hold the witness in
 * memory after the counter has moved on.
 */
function runInWorker(request: WorkerRequest): Promise<{ response: WorkerResponse; durationMs: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./zkp.worker.ts', import.meta.url));
    const startedAt = performance.now();

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      worker.terminate();
      const durationMs = Math.round(performance.now() - startedAt);
      if (event.data.ok) {
        resolve({ response: event.data, durationMs });
      } else if (event.data.artifactMissing) {
        reject(new ArtifactMissingError(event.data.message));
      } else {
        reject(new Error(event.data.message));
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'The proving worker stopped unexpectedly'));
    };

    worker.postMessage(request);
  });
}

/** Prove client-side. The witness never leaves this page. */
export async function generateProof(
  circuitType: CircuitType,
  input: ProofInput,
): Promise<{ pkg: ProofPackage; durationMs: number }> {
  const { wasmUrl, zkeyUrl } = circuitArtifactUrls(circuitType, window.location.origin);
  const { response, durationMs } = await runInWorker({
    kind: 'prove',
    circuitType,
    input,
    wasmUrl,
    zkeyUrl,
  });

  if (!response.ok || response.kind !== 'prove') {
    throw new Error('The worker answered a prove request with something else');
  }
  return { pkg: response.pkg, durationMs };
}

/**
 * Verify a proof in this browser, against this deployment's verifying key.
 *
 * This is the verifier's OWN verdict — the page never asks the backend whether
 * a proof is valid (D62). It is a cryptographic check only: freshness (D26) and
 * the root comparison are separate rules the pipeline applies around it (D63).
 */
export async function verifyProofOffChain(
  circuitType: CircuitType,
  publicSignals: PublicSignals,
  proof: Groth16Proof,
): Promise<{ valid: boolean; durationMs: number }> {
  const { vkeyUrl } = circuitArtifactUrls(circuitType, window.location.origin);
  const { response, durationMs } = await runInWorker({
    kind: 'verify',
    circuitType,
    publicSignals,
    proof,
    vkeyUrl,
  });

  if (!response.ok || response.kind !== 'verify') {
    throw new Error('The worker answered a verify request with something else');
  }
  return { valid: response.valid, durationMs };
}
