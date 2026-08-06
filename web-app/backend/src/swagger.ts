import { INestApplication, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * swagger.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * OpenAPI docs for the backend, served at /api/docs (JSON at /api/docs-json).
 */

export const GOV_API_KEY_SECURITY = 'gov-api-key';

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
        '**Roles.** `Government` endpoints belong to the state authority and are gated by a static',
        'API key — press **Authorize** and paste the value of `GOV_API_KEY`. `Transfers` is split',
        'deliberately: computing a projected root reveals nothing and needs no judgement, so',
        'preview/submit are open, while approving a transfer is the step that requires a person',
        'at the authority.',
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
    .addApiKey({ type: 'apiKey', name: 'x-gov-api-key', in: 'header' }, GOV_API_KEY_SECURITY)
    .addTag('Government', 'State authority: bulk import, batch issuance, root publishing')
    .addTag('Transfers', 'Two-step transfer flow — automatic preview, human approval')
    .addTag('Bundles', 'One-time owner bundle download')
    .addTag('Records', 'Read-only registry queries')
    .addTag('Proof', 'Merkle proof issuance — not implemented yet (Phase 6)')
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
