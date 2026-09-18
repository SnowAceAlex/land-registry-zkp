import { ApiProperty } from '@nestjs/swagger';

/**
 * public-config.response.dto.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Response shape for `GET /api/public/config` (D58).
 *
 * The key names deliberately mirror `DeploymentRecord` in
 * `blockchain/shared/deployments.ts`, so the browser reads a contract under the
 * same name the deploy script wrote it under.
 */

export class PublicContractsDto {
  @ApiProperty({
    example: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    description: 'RootRegistry — latestRoot, revocations, authorityInstitute, hasRole',
  })
  RootRegistry!: string;

  @ApiProperty({
    example: '0xa513E6E4b8f2a923D98304ec87F64353C4D5C853',
    description: 'LandRegistryVerifier — the verifyOwnership/Mortgage/Transfer dispatcher',
  })
  LandRegistryVerifier!: string;
}

export class PublicConfigResponseDto {
  @ApiProperty({ example: 'localhost', description: 'CHAIN_NETWORK this backend reads' })
  network!: string;

  /**
   * Chain id of that deployment. The resident portal picks its RPC transport
   * from this value; it is not told the RPC URL (see the controller docblock).
   */
  @ApiProperty({ example: 31337 })
  chainId!: number;

  @ApiProperty({ type: PublicContractsDto })
  contracts!: PublicContractsDto;
}
