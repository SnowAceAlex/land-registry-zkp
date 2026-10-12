import { ApiProperty } from '@nestjs/swagger';

/**
 * A status attestation (D82): the registry's EIP-712 signature that this plot's
 * current owner has no open procedure. Staple `{ expiresAt, signature }` into
 * proof.json; verifiers rebuild the rest from the public signals.
 */
export class AttestationResponseDto {
  @ApiProperty({ example: '1' })
  propertyId!: string;

  /** The owner commitment the registry currently records (decimal). */
  @ApiProperty({
    example: '19897067188519289101513059926301937407996214561223222508148918589381936293',
  })
  ownerCommitment!: string;

  /** RootRegistry.latestRoot() at signing time (decimal) — the proof must use this root. */
  @ApiProperty({
    example: '5677530015593700534173836181788122415198283309363871298832210090950018556857',
  })
  merkleRoot!: string;

  /** Unix seconds; at most 600 s after signing. */
  @ApiProperty({ example: '1790000600' })
  expiresAt!: string;

  /** 65-byte ECDSA signature over the EIP-712 StatusAttestation, 0x-hex. */
  @ApiProperty({ example: '0x…' })
  signature!: string;

  /** The signer; verifiers check it holds ATTESTER_ROLE on RootRegistry. */
  @ApiProperty({ example: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' })
  attester!: string;

  /** EIP-712 domain: chain id. */
  @ApiProperty({ example: 31337 })
  chainId!: number;

  /** EIP-712 domain: LandRegistryVerifier, which checks the signature on chain. */
  @ApiProperty({ example: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0' })
  verifyingContract!: string;
}
