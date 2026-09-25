/**
 * scripts/generate-issuer-cert.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates the X.509 identity the government portal issues bundles with
 * (D30/D31), chained to a Demo Root CA (D78).
 *
 * Two levels:
 *
 *   pki/root-ca.{key,cert}.pem       Demo Government Root CA — the project plays
 *                                     the Government Root CA. Created once.
 *   certs/issuer.{key,cert}.pem      the land authority's certificate, signed by
 *                                     that root.
 *
 * The root sits at the repo root, outside the backend, on purpose: the CA is a
 * different organisation from the registry, and `IssuerService` never loads its
 * key. The verifier pins `pki/root-ca.cert.pem` at build time; the receipt
 * carries the issuer certificate only — a root taken from the receipt would be
 * one an impostor could supply too.
 *
 * The issuer Subject "O" is what the verifier hashes with keccak256 and compares
 * against `authorityInstitute[publisher]` on-chain, so it must match
 * AUTHORITY_ORG_NAME exactly — the same value scripts/deploy.ts anchored.
 *
 * Usage: pnpm --filter backend run cert:generate
 *   FORCE=1        re-issue the issuer certificate (root kept)
 *   FORCE_ROOT=1   also regenerate the root — every issuer certificate it
 *                  signed, and every receipt carrying one, stops verifying
 */

import { execFileSync } from 'child_process';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

import {
  readOrganizationName,
  TRUSTED_ROOT_CA_RELATIVE_PATH,
  verifyCertificateIssuedBy,
} from '@land-registry/blockchain/shared/issuerIdentity';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
dotenv.config({ path: path.join(REPO_ROOT, '.env') });

const DEFAULT_ORG_NAME = 'So Tai nguyen va Moi truong TP.HCM';
const ROOT_NAME = 'Demo Government Root CA';
const ROOT_VALIDITY_DAYS = 7300;
const ISSUER_VALIDITY_DAYS = 3650;

function openssl(args: string[]): void {
  execFileSync('openssl', args, { stdio: ['ignore', 'ignore', 'inherit'] });
}

function main(): void {
  const orgName = process.env.AUTHORITY_ORG_NAME?.trim() || DEFAULT_ORG_NAME;

  const rootCertPath = path.join(REPO_ROOT, TRUSTED_ROOT_CA_RELATIVE_PATH);
  const rootKeyPath = rootCertPath.replace(/\.cert\.pem$/, '.key.pem');
  const certsDir = path.resolve(__dirname, '..', 'certs');
  const keyPath = path.join(certsDir, 'issuer.key.pem');
  const certPath = path.join(certsDir, 'issuer.cert.pem');

  fs.mkdirSync(path.dirname(rootCertPath), { recursive: true });
  fs.mkdirSync(certsDir, { recursive: true });

  // ── The root: created once ─────────────────────────────────────────────────
  const rootMissing = !fs.existsSync(rootCertPath) || !fs.existsSync(rootKeyPath);
  const newRoot = rootMissing || process.env.FORCE_ROOT === '1';

  if (newRoot) {
    openssl([
      'req',
      '-x509',
      '-quiet',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-sha256',
      '-keyout',
      rootKeyPath,
      '-out',
      rootCertPath,
      '-days',
      String(ROOT_VALIDITY_DAYS),
      '-subj',
      `/C=VN/O=${ROOT_NAME}/CN=${ROOT_NAME}`,
      '-addext',
      'basicConstraints=critical,CA:TRUE',
      '-addext',
      'keyUsage=critical,keyCertSign,cRLSign',
    ]);
    console.log(`Root CA written:\n  key:  ${rootKeyPath}\n  cert: ${rootCertPath}\n`);
  } else {
    console.log(`Root CA kept: ${rootCertPath}\n`);
  }

  // ── The issuer: signed by the root ─────────────────────────────────────────
  // A certificate signed by a root that no longer exists can never chain, so a
  // new root forces a new issuer certificate regardless of FORCE.
  if (fs.existsSync(certPath) && process.env.FORCE !== '1' && !newRoot) {
    const pem = fs.readFileSync(certPath, 'utf8');
    const chained = verifyCertificateIssuedBy(pem, fs.readFileSync(rootCertPath, 'utf8'));
    console.log(
      `${certPath} already exists — refusing to overwrite.\n` +
        (chained.ok
          ? `It chains to "${chained.issuedBy}".\n`
          : `⚠️  It does NOT chain to the root (${chained.reason}) — re-run with FORCE=1.\n`) +
        `Re-run with FORCE=1 if you really want a new key pair ` +
        `(bundles already issued carry the OLD certificate).`,
    );
    return;
  }

  // Subject "O" must round-trip through keccak256 to the on-chain anchor, so it
  // is passed verbatim — no escaping beyond what openssl's -subj requires.
  const subject = `/C=VN/ST=Ho Chi Minh/L=Ho Chi Minh/O=${orgName}/OU=Land Registry/CN=land-registry-issuer`;

  openssl([
    'req',
    '-x509',
    '-quiet',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-sha256',
    '-keyout',
    keyPath,
    '-out',
    certPath,
    '-days',
    String(ISSUER_VALIDITY_DAYS),
    '-subj',
    subject,
    '-CA',
    rootCertPath,
    '-CAkey',
    rootKeyPath,
    '-addext',
    'basicConstraints=critical,CA:FALSE',
    '-addext',
    'keyUsage=critical,digitalSignature',
  ]);

  const certificatePem = fs.readFileSync(certPath, 'utf8');
  const chained = verifyCertificateIssuedBy(certificatePem, fs.readFileSync(rootCertPath, 'utf8'));
  if (!chained.ok) throw new Error(`The new issuer certificate does not chain: ${chained.reason}`);

  console.log(`Issuer certificate written:`);
  console.log(`  key:  ${keyPath}`);
  console.log(`  cert: ${certPath}`);
  console.log(`  O:    ${readOrganizationName(certificatePem)}`);
  console.log(`  chains to "${chained.issuedBy}"`);
  console.log(
    `\nThis O value must match the AUTHORITY_ORG_NAME anchored on-chain, ` +
      `otherwise the Phase 9 verifier will reject the issuer identity.` +
      `\nRebuild the frontend so it pins the root (it is read at build time).`,
  );
}

main();
