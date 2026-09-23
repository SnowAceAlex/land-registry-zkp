/**
 * features/resident/verify/lib/issuer-chain.ts — the browser half of D30.
 *
 * The question this answers is not "is the proof valid" but "is the registry
 * that published this root the authority it claims to be". Without it a
 * verifier can be shown a perfectly valid proof against a perfectly valid root
 * of a contract somebody deployed themselves that morning.
 *
 * Four links, verified here rather than on chain because the contract only
 * ANCHORS the identity (D30): X.509 signatures are RSA-2048 or P-256, neither
 * of which is secp256k1, so checking them on chain would be absurdly expensive.
 *
 *   1. certificate   — parses, and is inside its validity window
 *   2. organization  — keccak256(Subject O) equals authorityInstitute[publisher]
 *   3. signature     — the certificate's key signed the publisher's address
 *   4. role          — the publisher holds STATE_AUTHORITY_ROLE
 *
 * ⚠️ LINK 1 IS NEVER REPORTED AS `pass`. The PoC certificate is self-signed
 *    (`cert:generate`), so there is no chain to a trusted CA to validate, and a
 *    green tick there would be the most load-bearing claim on the page told
 *    wrong. It reports `not-verifiable`, and `trust-summary.ts` downgrades the
 *    overall verdict accordingly. `verifyReceipt.ts` does the same thing on the
 *    Node side, emitting a note rather than a pass.
 *
 * @peculiar/x509 is imported DYNAMICALLY so it loads only when a verifier
 * actually supplies a receipt: measured at 194 kB in its own chunk, and the
 * verify page is 550 kB without it.
 *
 * ⚠️ `reflect-metadata` MUST be imported before it, and is not optional
 *    dressing. @peculiar/x509 v2 builds on tsyringe, which throws at module
 *    initialisation if `Reflect.getMetadata` is missing — "tsyringe requires a
 *    reflect polyfill". `next build` cannot catch this, because the failure is
 *    at runtime rather than at bundling: the panel would simply have been blank
 *    in a browser. Both imports stay inside `loadX509()` so the polyfill shares
 *    the same lazy chunk and never loads for a verifier who supplies no
 *    receipt.
 *
 * `blockchain/shared/issuerIdentity.ts` is Node-only — `X509Certificate` has no
 * browser equivalent — so the only thing reused from it is
 * `issuerSignatureMessage`, which is a pure string function and the single
 * definition of WHICH BYTES get signed.
 */

import { type Address, type Hex, type PublicClient, getAddress, keccak256, toBytes } from 'viem';

import { issuerSignatureMessage } from '@land-registry/blockchain/shared/issuerIdentity';
import type { IssuerBlock } from '@land-registry/blockchain/shared/receipt';
import { readAuthorityAnchor } from '@/lib/registry-reads';

/**
 * Load the certificate parser, polyfill first.
 *
 * The one place either import happens, so the ordering cannot be got wrong in
 * a second call site. See the header for why the order matters.
 */
export async function loadX509(): Promise<typeof import('@peculiar/x509')> {
  await import('reflect-metadata');
  return import('@peculiar/x509');
}

export type IssuerLink = 'certificate' | 'organization' | 'signature' | 'role';

export type LinkState =
  | 'pass'
  /** Checked and wrong — the strongest negative signal on the page. */
  | 'fail'
  /** Could not be checked: the chain or the certificate was unreadable. */
  | 'unavailable'
  /** Checkable in principle, not in this deployment. Link 1 only. */
  | 'not-verifiable';

export interface IssuerChainReport {
  account: string;
  organizationName?: string;
  notBefore?: Date;
  notAfter?: Date;
  /** True when Subject equals Issuer — why link 1 is `not-verifiable`. */
  selfSigned?: boolean;
  links: Record<IssuerLink, LinkState>;
  /** Untranslated detail for whichever link failed, when there is one. */
  detail?: string;
}

/**
 * PEM → DER bytes. Tolerates a chain by taking the FIRST certificate.
 *
 * The `<ArrayBuffer>` argument is not decoration: since TypeScript 5.7
 * `Uint8Array` is generic over its backing buffer, and WebCrypto's
 * `BufferSource` excludes a `SharedArrayBuffer`-backed one. Without it the
 * bytes cannot be handed to `crypto.subtle.verify`.
 */
export function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const match = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/.exec(pem);
  if (!match) throw new Error('Not a PEM certificate');
  return base64ToBytes(match[1].replace(/\s+/g, ''));
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * The exact bytes the issuer signed (D34e).
 *
 * The EIP-55 checksummed form, not the lowercase one: the same address written
 * either way produces different UTF-8 bytes and therefore a different
 * signature. `getAddress` normalises whatever the receipt carried.
 */
export function issuerSignaturePayload(account: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(issuerSignatureMessage(getAddress(account)));
}

/** keccak256 of the organization name, as `registerAuthority` anchored it. */
export function organizationHash(organizationName: string): Hex {
  return keccak256(toBytes(organizationName));
}

export async function verifyIssuerChain(args: {
  issuer: IssuerBlock;
  client: PublicClient;
  registry: Address;
}): Promise<IssuerChainReport> {
  const { issuer, client, registry } = args;

  const report: IssuerChainReport = {
    account: issuer.ethereumAccount,
    links: {
      certificate: 'unavailable',
      organization: 'unavailable',
      signature: 'unavailable',
      role: 'unavailable',
    },
  };

  // ── Link 1: the certificate itself ────────────────────────────────────────
  let certificate: import('@peculiar/x509').X509Certificate;
  try {
    const { X509Certificate } = await loadX509();
    certificate = new X509Certificate(issuer.IssuerCertificateChain);
  } catch (error) {
    report.detail = error instanceof Error ? error.message : String(error);
    return report;
  }

  report.notBefore = certificate.notBefore;
  report.notAfter = certificate.notAfter;
  report.selfSigned = certificate.subject === certificate.issuer;

  const now = Date.now();
  const inWindow = now >= certificate.notBefore.getTime() && now <= certificate.notAfter.getTime();
  // Expired is a real failure and is reported as one. A valid window is NOT a
  // pass, because the CA chain behind it is what a pass would be claiming.
  report.links.certificate = inWindow ? 'not-verifiable' : 'fail';

  const [org] = certificate.subjectName.getField('O');
  if (org) report.organizationName = org;

  // ── Links 2 and 4: what the contract anchored ─────────────────────────────
  let anchor: Awaited<ReturnType<typeof readAuthorityAnchor>> | undefined;
  try {
    anchor = await readAuthorityAnchor(client, registry, getAddress(issuer.ethereumAccount));
  } catch (error) {
    // Chain unreachable: these two links stay `unavailable`, never `fail`.
    report.detail = error instanceof Error ? error.message : String(error);
  }

  if (anchor) {
    report.links.role = anchor.hasAuthorityRole ? 'pass' : 'fail';
    if (org) {
      report.links.organization =
        organizationHash(org).toLowerCase() === anchor.instituteHash.toLowerCase()
          ? 'pass'
          : 'fail';
    }
  }

  // ── Link 3: the certificate's key signed this Ethereum address ────────────
  try {
    const key = await certificate.publicKey.export(
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      ['verify'],
    );
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      base64ToBytes(issuer.ethereumAccountSignature),
      issuerSignaturePayload(issuer.ethereumAccount),
    );
    report.links.signature = valid ? 'pass' : 'fail';
  } catch (error) {
    report.links.signature = 'unavailable';
    report.detail ??= error instanceof Error ? error.message : String(error);
  }

  return report;
}
