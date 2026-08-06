import { Controller, Get, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import {
  ApiGoneResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';

import { BundleClaimService } from './bundle-claim.service';

/**
 * BundlesController — one-time bundle download.
 * Base path: /api/bundles
 *
 * Deliberately NOT behind the government API key: the recipient is the land
 * owner, not an official. The claim token in the URL is the capability, and it
 * works exactly once (see BundleClaimService.claim).
 *
 * Lives in IssuanceModule rather than the government portal because handing a
 * bundle to its owner is the last step of issuing it, not an act of the state
 * authority.
 */
@ApiTags('Bundles')
@Controller('bundles')
export class BundlesController {
  constructor(private readonly bundles: BundleClaimService) {}

  @Get('claim/:token')
  @ApiOperation({
    summary: 'Download an issued bundle (single use)',
    description:
      'Returns bundle-<propertyId>.zip containing receipt.json (shareable), secret.json ' +
      '(the ownerSecret — never share), certificate.pdf and a README. The row is deleted ' +
      'before the bytes are sent, so the link works exactly once and the secret stops existing ' +
      'server-side (D34). No API key: the token IS the capability.',
  })
  @ApiParam({
    name: 'token',
    description: '64-character hex claim token from the issue-batch response',
    example: 'a4638d869008df08b02d6744ffec1e4933c29742ee1cd0e50e26ca5cd4eb2b97',
  })
  @ApiProduces('application/zip')
  // @Res() means Nest cannot infer the response, so the binary body is declared
  // explicitly — without this swagger-ui shows no download link.
  @ApiOkResponse({
    description: 'The bundle ZIP',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiNotFoundResponse({ description: 'Unknown token, or the bundle was already downloaded' })
  @ApiGoneResponse({ description: 'The link expired (7-day TTL) and the bundle was deleted' })
  async claim(@Param('token') token: string, @Res() res: Response): Promise<void> {
    const { propertyId, zip } = await this.bundles.claim(token);

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="bundle-${propertyId}.zip"`,
      'Content-Length': String(zip.length),
      // The response carries an ownerSecret — keep it out of every cache.
      'Cache-Control': 'no-store',
    });
    res.end(zip);
  }
}
