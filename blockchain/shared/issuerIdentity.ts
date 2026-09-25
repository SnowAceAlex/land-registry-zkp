/**
 * shared/issuerIdentity.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The D30 issuer-identity chain, from the side that can be shared.
 *
 * THE PROBLEM D30 SOLVES. `AccessControl` proves "this address may publish
 * roots" — not "this address belongs to the land authority". Anyone can deploy
 * their own RootRegistry and grant themselves the role. So the issuer signs its
 * own Ethereum address with the private key behind an X.509 certificate, and
 * keccak256 of that certificate's organization name is anchored on-chain. A
 * verifier that checks all three links cannot be fooled by a look-alike
 * deployment.
 *
 * WHY THIS IS SHARED. Three parties verify that chain — the backend at startup,
 * `scripts/tools/verifyReceipt.ts`, and the Phase 9 browser portal. Before this file,
 * the signature format lived as prose in `IssuerService`'s docstring and was
 * re-implemented independently by the script. Prose does not fail a build when
 * the two drift; `issuerSignatureMessage` does.
 *
 * SIGNATURE FORMAT (D34): RSASSA-PKCS1-v1_5 over SHA-256, where the message is
 * the UTF-8 bytes of the EIP-55 checksummed address STRING — not the raw 20
 * bytes — and the output is base64. WebCrypto verifies it with
 * `{ name: 'RSASSA-PKCS1-v1_5' }` and hash SHA-256.
 *
 * Deliberately NOT here: `keccak256(orgName)`. It would make `ethers` a
 * dependency of the shared package, and every caller already has one.
 *
 * ⚠️ `node:crypto` is imported lazily. `X509Certificate` has no browser
 * equivalent (unlike `createHash`, which bundlers polyfill), so a static import
 * would break the Phase 8/9 bundle through the shared barrel. The browser path
 * uses WebCrypto plus its own certificate parser and needs only
 * {@link issuerSignatureMessage} from this module.
 */

/**
 * The exact string whose UTF-8 bytes are signed.
 *
 * @param checksummedAddress the address ALREADY EIP-55 checksummed by the
 *   caller (`ethers.getAddress`). Checksumming is left to the caller precisely
 *   so this module does not need ethers; passing a lowercased address here
 *   produces a signature that will not verify.
 */
export function issuerSignatureMessage(checksummedAddress: string): string {
  return checksummedAddress;
}

/**
 * Read the Subject "O" out of a PEM certificate — the value anchored on-chain.
 *
 * `X509Certificate.subject` is a newline-separated RDN list ("C=VN\nO=…").
 */
export function readOrganizationName(certificatePem: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { X509Certificate } = require('crypto') as typeof import('crypto');
  const subject = new X509Certificate(certificatePem).subject;
  const line = subject.split('\n').find((rdn) => rdn.startsWith('O='));
  if (!line) {
    throw new Error(
      'Issuer certificate has no Subject "O" (organization) field — D30 anchors ' +
        'the organization name, so a certificate without one cannot be used',
    );
  }
  return line.slice('O='.length).trim();
}

/**
 * Check that `signature` really is this certificate's signature over
 * `checksummedAddress`.
 *
 * This is the link that stops someone stapling a real authority's certificate
 * onto their own Ethereum address — without it, the other two checks pass for
 * an impostor who simply copied a genuine certificate out of a public receipt.
 *
 * @param signature base64, as it appears in `receipt.issuer.ethereumAccountSignature`
 */
export function verifyIssuerSignature(
  certificatePem: string,
  checksummedAddress: string,
  signature: string,
): boolean {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require('crypto') as typeof import('crypto');
  const certificate = new nodeCrypto.X509Certificate(certificatePem);
  return nodeCrypto.verify(
    'sha256',
    Buffer.from(issuerSignatureMessage(checksummedAddress), 'utf8'),
    certificate.publicKey,
    Buffer.from(signature, 'base64'),
  );
}

/**
 * Where the pinned root CA certificate lives, relative to the monorepo root
 * (D78). `pki/` sits outside every package on purpose: the CA is a different
 * organisation from the registry, and the registry's backend never loads its
 * key.
 */
export const TRUSTED_ROOT_CA_RELATIVE_PATH = 'pki/root-ca.cert.pem';

/** The pinned root's path — `TRUSTED_ROOT_CA_PATH` first, then the default. */
export function trustedRootPath(repoRoot: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path');
  const override = process.env.TRUSTED_ROOT_CA_PATH?.trim();
  return override ? path.resolve(override) : path.join(repoRoot, TRUSTED_ROOT_CA_RELATIVE_PATH);
}

/**
 * The pinned root CA certificate, or null when none is configured.
 *
 * Absent is not an error: a fresh checkout has no root, and link 1 then reports
 * what it always did before D78 — `not-verifiable`.
 */
export function readTrustedRootPem(repoRoot: string): string | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs');
  const file = trustedRootPath(repoRoot);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

/**
 * Both branches name both fields so the result reads the same in the backend,
 * which compiles without `strictNullChecks` and so cannot narrow on `ok`.
 */
export type IssuanceCheck =
  | { ok: true; issuedBy: string; reason?: undefined }
  | { ok: false; reason: string; issuedBy?: undefined };

/**
 * Link 1 of the D30 chain (D78): was `leafPem` issued by the pinned root?
 *
 * The root must come from the verifier's own configuration, never from the
 * receipt — an impostor can ship a CA of their own exactly as easily as a
 * self-signed certificate. The browser applies the same rules in the same order
 * in `issuer-chain.ts` (`checkIssuedByRoot`); `issuer-chain.test.ts` holds the
 * two to agreement on `ok`. One nuance: `checkIssued` is OpenSSL's
 * X509_check_issued, which also compares key identifiers, so a look-alike root
 * with the same name is refused here one step before the signature check.
 */
export function verifyCertificateIssuedBy(
  leafPem: string,
  rootPem: string,
  now: Date = new Date(),
): IssuanceCheck {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { X509Certificate } = require('crypto') as typeof import('crypto');

  let root: InstanceType<typeof X509Certificate>;
  let leaf: InstanceType<typeof X509Certificate>;
  try {
    root = new X509Certificate(rootPem);
  } catch {
    return { ok: false, reason: 'the pinned root certificate cannot be parsed' };
  }
  try {
    leaf = new X509Certificate(leafPem);
  } catch {
    return { ok: false, reason: 'the issuer certificate cannot be parsed' };
  }

  const inWindow = (cert: InstanceType<typeof X509Certificate>) =>
    now.getTime() >= new Date(cert.validFrom).getTime() &&
    now.getTime() <= new Date(cert.validTo).getTime();

  if (!root.ca) return { ok: false, reason: 'the pinned root is not a CA certificate' };
  if (!inWindow(root))
    return { ok: false, reason: 'the pinned root is outside its validity window' };
  if (!inWindow(leaf)) {
    return { ok: false, reason: 'the issuer certificate is outside its validity window' };
  }
  if (!leaf.checkIssued(root)) {
    return { ok: false, reason: 'the issuer certificate was not issued by the pinned root' };
  }
  if (!leaf.verify(root.publicKey)) {
    return {
      ok: false,
      reason: "the issuer certificate's signature does not verify under the root key",
    };
  }

  return { ok: true, issuedBy: commonName(root.subject) };
}

/** CN, else O, else the whole subject — the name a verifier is shown. */
function commonName(subject: string): string {
  const rdns = subject.split('\n');
  const pick = (key: string) =>
    rdns.find((rdn) => rdn.startsWith(`${key}=`))?.slice(key.length + 1);
  return (pick('CN') ?? pick('O') ?? subject).trim();
}

/** Sign an address with the certificate's private key — the issuer's half. */
export function signIssuerAddress(privateKeyPem: string, checksummedAddress: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require('crypto') as typeof import('crypto');
  return nodeCrypto
    .sign('sha256', Buffer.from(issuerSignatureMessage(checksummedAddress), 'utf8'), privateKeyPem)
    .toString('base64');
}
