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
 * `scripts/verifyReceipt.ts`, and the Phase 9 browser portal. Before this file,
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

/** Sign an address with the certificate's private key — the issuer's half. */
export function signIssuerAddress(privateKeyPem: string, checksummedAddress: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require('crypto') as typeof import('crypto');
  return nodeCrypto
    .sign('sha256', Buffer.from(issuerSignatureMessage(checksummedAddress), 'utf8'), privateKeyPem)
    .toString('base64');
}
