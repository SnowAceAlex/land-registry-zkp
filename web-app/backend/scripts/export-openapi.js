const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3001;
const URL = process.env.OPENAPI_URL || `http://localhost:${PORT}/api/docs-json`;
const OUT = path.resolve(__dirname, '..', 'openapi.json');

async function main() {
  let response;
  try {
    response = await fetch(URL);
  } catch (error) {
    throw new Error(
      `Could not reach ${URL} — start the backend first (pnpm run dev:backend).\n${error.message}`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `${URL} returned HTTP ${response.status}. ` +
      `Swagger is disabled when NODE_ENV=production unless ENABLE_SWAGGER=1.`,
    );
  }

  const spec = await response.json();
  const pathCount = Object.keys(spec.paths || {}).length;
  const schemaCount = Object.keys((spec.components && spec.components.schemas) || {}).length;

  // An empty schema section means the CLI plugin did not run — the spec would
  // look fine but document no request/response bodies at all.
  if (schemaCount === 0) {
    console.warn(
      'WARNING: no component schemas in the spec. The @nestjs/swagger plugin ' +
      'may not be enabled in nest-cli.json, or the server is running stale build output.',
    );
  }

  fs.writeFileSync(OUT, JSON.stringify(spec, null, 2));
  console.log(`Wrote ${OUT}`);
  console.log(`  ${pathCount} paths, ${schemaCount} schemas`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
