import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ethers } from 'ethers';

import { ChainService } from '../chain/chain.service';
import { backendDir } from '../common/paths';

/**
 * IssuerService
 * ─────────────────────────────────────────────────────────────────────────────
 * Produces the `issuer` block of receipt.json (§3.1) — the chain of evidence
 * that lets a verifier decide whether to trust a published root at all (D30).
 *
 * The problem it solves: AccessControl proves "this address may publish roots",
 * not "this address belongs to the land authority". Anyone can deploy their own
 * registry and grant themselves the role. So the issuer signs its own Ethereum
 * address with the private key of an X.509 certificate, and the certificate's
 * organization name is anchored on-chain. A verifier that checks all three
 * links (cert → CA, keccak256(O) → authorityInstitute, signature → cert key)
 * cannot be fooled by a look-alike deployment.
 *
 * SIGNATURE FORMAT (D34) — the Phase 9 browser verifier must mirror this
 * exactly: RSASSA-PKCS1-v1_5 over SHA-256, message = the UTF-8 bytes of the
 * EIP-55 checksummed address string (not the raw 20 bytes), output base64.
 * WebCrypto verifies it with algorithm { name: 'RSASSA-PKCS1-v1_5' } and
 * hash SHA-256.
 */

export interface IssuerBlock {
  ethereumAccount: string;
  ethereumAccountSignature: string;
  /** PEM. Field name keeps [SmartCert]'s capital I — inherited, not a typo. */
  IssuerCertificateChain: string;
}

@Injectable()
export class IssuerService implements OnModuleInit {
  private readonly logger = new Logger(IssuerService.name);

  private privateKeyPem!: string;
  private certificatePem!: string;
  private organizationName!: string;

  constructor(private readonly chain: ChainService) {}

  async onModuleInit(): Promise<void> {
    const certsDir = path.join(backendDir(), 'certs');
    const keyPath = process.env.ISSUER_KEY_PATH ?? path.join(certsDir, 'issuer.key.pem');
    const certPath = process.env.ISSUER_CERT_PATH ?? path.join(certsDir, 'issuer.cert.pem');

    if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
      throw new Error(
        `Issuer certificate not found (${certPath}). Run ` +
          `\`pnpm --filter backend run cert:generate\` first — bundles cannot be ` +
          `issued without an issuer identity (D30).`,
      );
    }

    this.privateKeyPem = fs.readFileSync(keyPath, 'utf8');
    this.certificatePem = fs.readFileSync(certPath, 'utf8');
    this.organizationName = readOrganizationName(this.certificatePem);

    this.logger.log(`issuer certificate loaded — O="${this.organizationName}"`);
    await this.warnIfAnchorMismatch();
  }

  /** X.509 Subject "O" — the value keccak256-anchored on-chain (D30). */
  get orgName(): string {
    return this.organizationName;
  }

  get certificateChainPem(): string {
    return this.certificatePem;
  }

  /**
   * Sign an Ethereum address with the certificate's private key.
   * @param address checksummed by the caller-independent EIP-55 rule so the
   *   verifier signs/verifies over the exact same bytes regardless of the
   *   casing the address arrived in.
   */
  signEthereumAccount(address: string): string {
    const checksummed = ethers.getAddress(address);
    return crypto
      .sign('sha256', Buffer.from(checksummed, 'utf8'), this.privateKeyPem)
      .toString('base64');
  }

  /** The `issuer` block embedded in every receipt.json. */
  buildIssuerBlock(): IssuerBlock {
    const ethereumAccount = this.chain.authorityAddress;
    return {
      ethereumAccount,
      ethereumAccountSignature: this.signEthereumAccount(ethereumAccount),
      IssuerCertificateChain: this.certificatePem,
    };
  }

  /**
   * A mismatch here means every bundle issued would fail the Phase 9 identity
   * check — worth one loud line at startup rather than a mystery at verify time.
   */
  private async warnIfAnchorMismatch(): Promise<void> {
    try {
      const account = this.chain.authorityAddress;
      const onChain = await this.chain.getAuthorityInstitute(account);
      const expected = ethers.keccak256(ethers.toUtf8Bytes(this.organizationName));

      if (onChain.toLowerCase() !== expected.toLowerCase()) {
        this.logger.error(
          `identity anchor mismatch for ${account}: certificate O="${this.organizationName}" ` +
            `hashes to ${expected}, but the contract stores ${onChain}. ` +
            `Issued bundles will FAIL the Phase 9 issuer check — regenerate the certificate ` +
            `with the AUTHORITY_ORG_NAME used at deploy time.`,
        );
      } else {
        this.logger.log(`identity anchor verified on-chain for ${account}`);
      }
    } catch (error) {
      this.logger.warn(`could not verify identity anchor: ${(error as Error).message}`);
    }
  }
}

/**
 * Read the Subject "O" out of a PEM certificate.
 * `X509Certificate.subject` is a newline-separated RDN list ("C=VN\nO=...").
 */
export function readOrganizationName(certificatePem: string): string {
  const subject = new crypto.X509Certificate(certificatePem).subject;
  const line = subject.split('\n').find((rdn) => rdn.startsWith('O='));
  if (!line) {
    throw new Error(
      'Issuer certificate has no Subject "O" (organization) field — D30 anchors ' +
        'the organization name, so a certificate without one cannot be used',
    );
  }
  return line.slice('O='.length).trim();
}
