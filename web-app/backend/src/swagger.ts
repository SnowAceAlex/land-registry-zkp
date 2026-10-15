import { INestApplication, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { GOV_API_KEY_HEADER, GOV_API_KEY_SECURITY } from './common/api-key.guard';

/**
 * swagger.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * OpenAPI docs for the backend, served at /api/docs (JSON at /api/docs-json).
 */

/** Swagger is off in production unless explicitly enabled — it lists the state
 *  authority's endpoints, so it should not be public by default. */
export function isSwaggerEnabled(): boolean {
  return process.env.ENABLE_SWAGGER === '1' || process.env.NODE_ENV !== 'production';
}

export function setupSwagger(app: INestApplication): string | null {
  if (!isSwaggerEnabled()) {
    return null;
  }

  const config = new DocumentBuilder()
    .setTitle('Land Registry ZKP — API')
    .setDescription(
      [
        'Privacy-preserving Land Use Rights registry: off-chain records, on-chain Merkle root,',
        'Groth16 proofs.',
        '',
        '**Roles.** `Government` endpoints belong to the state authority and are gated by an API key —',
        'press **Authorize** and paste `GOV_API_KEY` (the head office) or a land office key (D86).',
        'A branch acts only on plots in its own area. Every `Transfers` route is gated too: the',
        'transfer is an officer action at the counter (D47). `Records`, `Proof` and `Public` are',
        'unguarded — a land owner or a buyer calls them, not an officer (D39).',
        '',
        '**Numbers are decimal strings.** Property ids, commitments, Merkle roots and leaves are',
        'BN254 field elements — far beyond `Number.MAX_SAFE_INTEGER` — so they cross the API as',
        'strings and are parsed as `bigint`. `validityPeriod` of `"0"` is the sentinel for land',
        'held in perpetuity, not a 1970 date.',
        '',
        '**What this page cannot do.** Submitting a transfer needs a real Groth16 proof built from',
        "both parties' secrets; generate it with `pnpm --filter blockchain run transfer:smoke`.",
      ].join('\n'),
    )
    .setVersion('0.1.0')
    .addApiKey({ type: 'apiKey', name: GOV_API_KEY_HEADER, in: 'header' }, GOV_API_KEY_SECURITY)
    .addTag(
      'Government',
      'State authority: bulk import, issuance requests, revocations, registration rounds and archives',
    )
    .addTag('Operations', 'The shared queue and the operations console (D87, D89)')
    .addTag(
      'Transfers',
      'The transfer counter: preview, submit, then an officer approves or rejects',
    )
    .addTag('Records', 'Read-only registry queries, plot history and certificate lineage')
    .addTag('Proof', 'Fresh Merkle proofs, status attestations and proof verification (D39, D82)')
    .addTag('Public', 'Chain id and contract addresses for the resident portal (D58)')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  const path = 'api/docs';

  SwaggerModule.setup(path, app, document, {
    swaggerOptions: {
      // Keeps the API key across reloads — this page is used for repeated
      // manual testing, and re-authorizing every time is pure friction.
      persistAuthorization: true,
      tagsSorter: 'alpha',
      docExpansion: 'list',
    },
    customSiteTitle: 'Land Registry ZKP API',
  });

  new Logger('Swagger').log(`OpenAPI docs mounted at /${path}`);
  return path;
}
