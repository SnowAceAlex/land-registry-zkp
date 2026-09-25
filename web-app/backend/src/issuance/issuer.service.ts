import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { ethers } from 'ethers';
import {
  IssuerBlock,
  readOrganizationName,
  readTrustedRootPem,
  signIssuerAddress,
  trustedRootPath,
  verifyCertificateIssuedBy,
} from '@land-registry/blockchain/shared';

import { ChainService } from '../chain/chain.service';
import { backendDir, repoRoot } from '../common/paths';

/**
 * IssuerService
 * ─────────────────────────────────────────────────────────────────────────────
 * Produces the `issuer` block of receipt.json (§3.1) — the chain of evidence
 * that lets a verifier decide whether to trust a published root at all (D30).
 *
 * This service owns the ISSUING half: loading the certificate, signing, and
 * failing loudly at startup if the on-chain anchor disagrees. The verifying half
 * and the D34 signature format itself live in
 * `@land-registry/blockchain/shared` (`issuerIdentity.ts`), because the script
 * and the Phase 9 browser portal verify the same signature and must derive the
 * same bytes — a rule stated only in prose is a rule that eventually differs
 * between its implementations.
 */

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
    this.warnIfNotChained();
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
   * @param address checksummed here by the EIP-55 rule so signer and verifier
   *   cover the exact same bytes regardless of the casing it arrived in.
   */
  signEthereumAccount(address: string): string {
    return signIssuerAddress(this.privateKeyPem, ethers.getAddress(address));
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
   * D78: a certificate the pinned root did not issue fails link 1 in every
   * verifier, so every bundle would be rejected. Loud, but not fatal — the
   * backend only reads the root's CERTIFICATE (never its key, which belongs to
   * the CA), and a missing root is a fresh checkout, not a fault.
   */
  private warnIfNotChained(): void {
    const rootPem = readTrustedRootPem(repoRoot());
    if (rootPem === null) {
      this.logger.warn(
        `no root CA at ${trustedRootPath(repoRoot())} — verifiers built without it ` +
          `will report the issuer certificate as unverifiable. Run \`cert:generate\`.`,
      );
      return;
    }

    const chained = verifyCertificateIssuedBy(this.certificatePem, rootPem);
    if (chained.ok) {
      this.logger.log(`issuer certificate chains to "${chained.issuedBy}"`);
    } else {
      this.logger.error(
        `issuer certificate does not chain to the pinned root CA: ${chained.reason}. ` +
          `Issued bundles will FAIL the verifier's certificate check — ` +
          `re-run \`FORCE=1 pnpm --filter backend run cert:generate\`.`,
      );
    }
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
