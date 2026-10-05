/**
 * shared/statusAttestation.ts — the backend's signed "no open procedure" note (D82).
 *
 * The one EIP-712 definition: the backend signs it (ethers), the contract
 * rebuilds it, UC-6 recovers it (viem). Keep it free of runtime imports (D67).
 */

/** Same window as proof freshness (D26); the contract refuses a longer expiry. */
export const ATTESTATION_TTL_SECONDS = 600;

export const ATTESTER_ROLE_NAME = 'ATTESTER_ROLE';

export const STATUS_ATTESTATION_TYPES = {
  StatusAttestation: [
    { name: 'propertyId', type: 'uint256' },
    { name: 'ownerCommitment', type: 'uint256' },
    { name: 'merkleRoot', type: 'uint256' },
    { name: 'expiresAt', type: 'uint64' },
  ],
};

export interface StatusAttestationMessage {
  propertyId: bigint;
  ownerCommitment: bigint;
  merkleRoot: bigint;
  expiresAt: bigint;
}

/** What `proof.json` carries; the rest is rebuilt from the public signals. */
export interface AttestationStaple {
  /** Unix seconds, decimal string. */
  expiresAt: string;
  /** 65-byte ECDSA signature, 0x-hex. */
  signature: string;
}

// Same indices in ownership and mortgage (D21); the test pins them to PUBLIC_SIGNAL_ORDER.
const ROOT_INDEX = 0;
const PROPERTY_ID_INDEX = 1;
const OWNER_COMMITMENT_INDEX = 2;

export function statusAttestationDomain(chainId: number | bigint, verifyingContract: string) {
  return {
    name: 'LandRegistryVerifier',
    version: '1',
    chainId: BigInt(chainId),
    verifyingContract,
  };
}

export function statusAttestationTypedData(
  chainId: number | bigint,
  verifyingContract: string,
  message: StatusAttestationMessage,
) {
  return {
    domain: statusAttestationDomain(chainId, verifyingContract),
    types: STATUS_ATTESTATION_TYPES,
    primaryType: 'StatusAttestation' as const,
    message,
  };
}

/** Rebuild the signed message from a proof, the way the contract does. */
export function attestationMessageFromSignals(
  circuitType: 'ownership' | 'mortgage',
  publicSignals: readonly string[],
  expiresAt: string | bigint,
): StatusAttestationMessage {
  if (circuitType !== 'ownership' && circuitType !== 'mortgage') {
    throw new Error(
      `A status attestation belongs to an ownership or mortgage proof, not ${circuitType}`,
    );
  }
  return {
    propertyId: BigInt(publicSignals[PROPERTY_ID_INDEX]),
    ownerCommitment: BigInt(publicSignals[OWNER_COMMITMENT_INDEX]),
    merkleRoot: BigInt(publicSignals[ROOT_INDEX]),
    expiresAt: BigInt(expiresAt),
  };
}
