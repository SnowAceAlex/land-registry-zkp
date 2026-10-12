/**
 * lib/status-attestation.ts — check a stapled status attestation in the browser (D82).
 *
 * Off-chain twin of LandRegistryVerifier._requireAttested. The signer is only
 * RECOVERED here; whether it holds ATTESTER_ROLE is a chain read
 * (`readIsAttester`), so the verifier still never asks the backend (D62).
 */

import { type Address, type Hex, recoverTypedDataAddress } from 'viem';

import type { ProofPackage } from '@land-registry/blockchain/shared/types';
import {
  ATTESTATION_TTL_SECONDS,
  attestationMessageFromSignals,
  statusAttestationTypedData,
} from '@land-registry/blockchain/shared/statusAttestation';

export type AttestationCheck =
  | { ok: true; signer: Address }
  | { ok: false; reason: 'AttestationExpired' | 'InvalidAttestation' };

/** Expiry and signature; the role check is left to the caller's chain read. */
export async function checkAttestation(
  pkg: ProofPackage,
  chainId: number,
  verifier: Address,
  now: bigint,
): Promise<AttestationCheck> {
  if (pkg.circuitType === 'transfer' || !pkg.attestation) {
    return { ok: false, reason: 'InvalidAttestation' };
  }

  const expiresAt = BigInt(pkg.attestation.expiresAt);
  if (now > expiresAt) return { ok: false, reason: 'AttestationExpired' };
  // Same cap as the contract: a leaked key cannot sign a long-lived note.
  if (expiresAt > now + BigInt(ATTESTATION_TTL_SECONDS)) {
    return { ok: false, reason: 'InvalidAttestation' };
  }

  const typed = statusAttestationTypedData(
    chainId,
    verifier,
    attestationMessageFromSignals(pkg.circuitType, pkg.publicSignals, expiresAt),
  );
  try {
    const signer = await recoverTypedDataAddress({
      ...typed,
      signature: pkg.attestation.signature as Hex,
    } as never);
    return { ok: true, signer };
  } catch {
    return { ok: false, reason: 'InvalidAttestation' };
  }
}
