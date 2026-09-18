import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { PublicConfigService } from './public-config.service';
import { PublicConfigResponseDto } from './dto/public-config.response.dto';

/**
 * PublicConfigController — `/api/public/*`
 * ─────────────────────────────────────────────────────────────────────────────
 * One route, and it is the resident analogue of D54: the portal learns which
 * chain and which contracts to read from the API, never from a `NEXT_PUBLIC_`
 * copy baked into its bundle at build time.
 *
 * ⚠️ NOT GUARDED, on purpose (D58) — and therefore carrying no
 * `@ApiSecurity(GOV_API_KEY_SECURITY)`, since that decorator must mirror
 * `@UseGuards(ApiKeyGuard)` exactly. The resident portal is logged-out by
 * design (D39/D49) and cannot reach `GET /api/government/status`, which is the
 * only other place `chainId` and the verifier address are published. Contract
 * addresses are public on-chain data; a verifier that cannot find the contract
 * cannot verify anything.
 *
 * Three things this route deliberately does NOT serve:
 *
 *  1. The RPC URL. `resolveRpcUrl()` may carry a provider key, and handing that
 *     to a logged-out page leaks it. The browser picks its own transport from
 *     `chainId`, the way features/government/wallet/wallet-config.ts does.
 *  2. The authority's address. `/government/status` has it, behind the key. A
 *     verifier does not need it: it reads `issuer.ethereumAccount` out of the
 *     receipt it was handed, then checks `hasRole` on chain itself.
 *  3. Any root or rootVersion. Those are chain reads the browser makes for
 *     itself — taking them from this server would be trusting this server,
 *     which is the one thing the verifier flow exists to avoid (D62).
 *
 * Throttling stays at the global 60/minute (AppModule). This is one small read
 * per page load, nothing like the whole-tree rebuild that earned
 * `GET /api/proof/:propertyId` its own 12/minute bucket.
 */
@ApiTags('Public')
@Controller('public')
export class PublicConfigController {
  constructor(private readonly publicConfigService: PublicConfigService) {}

  @Get('config')
  @ApiOperation({
    summary: 'Chain id and contract addresses for the logged-out resident portal',
    description:
      'What a browser needs to read RootRegistry and LandRegistryVerifier directly: the network ' +
      'name, the chain id, and the two contract addresses. No RPC URL (it may carry a provider ' +
      'key — the client picks its transport by chainId), no authority address, and no root: the ' +
      'root is a chain read the verifier must make itself.',
  })
  @ApiOkResponse({ type: PublicConfigResponseDto })
  config(): PublicConfigResponseDto {
    return this.publicConfigService.chainConfig();
  }
}
