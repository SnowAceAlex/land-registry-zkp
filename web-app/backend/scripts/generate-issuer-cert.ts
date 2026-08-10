/**
 * scripts/generate-issuer-cert.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates the self-signed X.509 certificate the government portal issues
 * bundles with (D30/D31).
 *
 * The Subject "O" (organization) field is what matters: the verifier portal
 * (Phase 9) hashes it with keccak256 and compares against
 * `authorityInstitute[publisher]` stored on-chain. It must therefore match
 * AUTHORITY_ORG_NAME exactly — the same value scripts/deploy.ts anchored.
 *
 * PoC limitation (Scope 1.5, same spirit as D13/D14): this is self-signed, not
 * issued by a real CA. A production deployment would use a certificate from a
 * government CA and the verifier would validate the full chain.
 *
 * Usage: pnpm --filter backend run cert:generate
 */

import { execFileSync } from 'child_process';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

const DEFAULT_ORG_NAME = 'So Tai nguyen va Moi truong TP.HCM';
const VALIDITY_DAYS = 3650;

function main(): void {
  const orgName = process.env.AUTHORITY_ORG_NAME?.trim() || DEFAULT_ORG_NAME;
  const certsDir = path.resolve(__dirname, '..', 'certs');
  const keyPath = path.join(certsDir, 'issuer.key.pem');
  const certPath = path.join(certsDir, 'issuer.cert.pem');

  fs.mkdirSync(certsDir, { recursive: true });

  if (fs.existsSync(certPath) && process.env.FORCE !== '1') {
    console.log(
      `${certPath} already exists — refusing to overwrite.\n` +
        `Re-run with FORCE=1 if you really want a new key pair ` +
        `(bundles already issued carry the OLD certificate).`,
    );
    return;
  }

  // Subject "O" must round-trip through keccak256 to the on-chain anchor, so it
  // is passed verbatim — no escaping beyond what openssl's -subj requires.
  const subject = `/C=VN/ST=Ho Chi Minh/L=Ho Chi Minh/O=${orgName}/OU=Land Registry/CN=land-registry-issuer`;

  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-keyout',
      keyPath,
      '-out',
      certPath,
      '-days',
      String(VALIDITY_DAYS),
      '-nodes',
      '-sha256',
      '-subj',
      subject,
    ],
    { stdio: 'inherit' },
  );

  console.log(`\nIssuer certificate written:`);
  console.log(`  key:  ${keyPath}`);
  console.log(`  cert: ${certPath}`);
  console.log(`  O:    ${orgName}`);
  console.log(
    `\nThis O value must match the AUTHORITY_ORG_NAME anchored on-chain, ` +
      `otherwise the Phase 9 verifier will reject the issuer identity.`,
  );
}

main();
