import { Injectable } from '@nestjs/common';

import { ChainService } from '../chain/chain.service';
import { PublicConfigResponseDto } from './dto/public-config.response.dto';

/**
 * PublicConfigService (D58)
 * ─────────────────────────────────────────────────────────────────────────────
 * The chain identity a logged-out page needs to read the registry for itself.
 *
 * Values come from ChainService's getters rather than a second
 * `loadDeployment()` call, because those getters honour the
 * `ROOT_REGISTRY_ADDRESS` / `LAND_REGISTRY_VERIFIER_ADDRESS` overrides. A
 * browser must never be told to read a different contract than this backend
 * reads — that divergence would show up as an unexplainable RootMismatch.
 */
@Injectable()
export class PublicConfigService {
  constructor(private readonly chain: ChainService) {}

  /**
   * ⚠️ Enumerate the fields explicitly and keep it that way. The D50 lesson was
   * that a spread (`{...deployment}`) publishes every future field by default;
   * `DeploymentRecord` also carries `deployer` and the `authority` block, and
   * neither belongs on an unguarded route.
   */
  chainConfig(): PublicConfigResponseDto {
    return {
      network: this.chain.network,
      chainId: this.chain.chainId,
      contracts: {
        RootRegistry: this.chain.rootRegistryAddress,
        LandRegistryVerifier: this.chain.landRegistryVerifierAddress,
      },
    };
  }
}
