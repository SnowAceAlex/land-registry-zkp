/**
 * scripts/verifyReceipt.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Checks an issued receipt.json against the live chain — the manual-test
 * counterpart to what the Phase 9 verifier portal will do in the browser.
 *
 * It answers four questions a land owner would actually care about:
 *   1. Is the root in my receipt the one the registry currently considers valid?
 *   2. Does my Merkle proof actually prove my leaf is in that root?
 *   3. Does the publishRoot() transaction it names really exist on chain?
 *   4. Was it issued by an account the registry recognises as an authority,
 *      whose certificate organization matches the on-chain anchor (D30)?
 *
 * A stale root is NOT a failure — it means someone else transferred since, and
 * the owner needs a refreshed proof (§3.1). The output says which case it is.
 *
 * Usage:
 *   pnpm --filter blockchain run receipt:verify <path-to-receipt.json>
 *   (add --network sepolia via the package script to check the testnet)
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ethers } from 'ethers';

import { hashRecord, verifyMerkleProof } from '../shared/merkleTree';
import { hashOffchainMetadata } from '../shared/offchainMetadata';
import { EncumbranceStatus, TenureType, UseType } from '../shared/types';
import { RootRegistry__factory } from '../typechain-types';

const BLOCKCHAIN_DIR = path.resolve(__dirname, '..');

interface Receipt {
  transactionHash: string;
  contractAddress: string;
  rootVersion: number;
  merkleRoot: string;
  propertyId: string;
  leaf: string;
  merkleProof: { siblings: string[]; pathIndices: number[] };
  record: {
    propertyId: string;
    ownerCommitment: string;
    useType: number;
    validityPeriod: string;
    encumbranceStatus: number;
    tenureType: number;
    landUseCode: string;
    landUserType: string | null;
    certificateSerial: string;
    bookEntryNumber: string;
    mapSheetNumber: string | null;
    landOrigin: string | null;
    address: string;
    area: number;
    issuingAuthority: string;
    issueDate: string;
  };
  issuer: {
    ethereumAccount: string;
    ethereumAccountSignature: string;
    IssuerCertificateChain: string;
  };
}

function pass(label: string, detail = ''): void {
  console.log(`  OK    ${label}${detail ? ` — ${detail}` : ''}`);
}

function fail(label: string, detail = ''): void {
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
}

function note(label: string, detail = ''): void {
  console.log(`  note  ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main(): Promise<void> {
  const receiptPath = process.argv[2];
  if (!receiptPath) {
    throw new Error('Usage: receipt:verify <path-to-receipt.json>');
  }

  const receipt: Receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  const network = process.env.CHAIN_NETWORK ?? 'localhost';
  const rpcUrl =
    process.env.RPC_URL ??
    (network === 'sepolia' ? process.env.SEPOLIA_RPC_URL : 'http://127.0.0.1:8545');
  if (!rpcUrl) {
    throw new Error('Set RPC_URL (or SEPOLIA_RPC_URL when CHAIN_NETWORK=sepolia)');
  }

  const deploymentPath = path.join(BLOCKCHAIN_DIR, 'deployments', `${network}.json`);
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const registry = RootRegistry__factory.connect(deployment.contracts.RootRegistry, provider);

  console.log(`\nreceipt:   ${receiptPath}`);
  console.log(`property:  ${receipt.propertyId}`);
  console.log(`network:   ${network} (${rpcUrl})\n`);

  let failures = 0;

  // ── 1. The receipt points at the registry this deployment knows ────────────
  if (receipt.contractAddress.toLowerCase() === deployment.contracts.RootRegistry.toLowerCase()) {
    pass('receipt targets the deployed RootRegistry', receipt.contractAddress);
  } else {
    fail(
      'receipt targets a DIFFERENT contract',
      `${receipt.contractAddress} vs deployed ${deployment.contracts.RootRegistry}`,
    );
    failures++;
  }

  // ── 2. Root freshness ──────────────────────────────────────────────────────
  const latestRoot = BigInt(await registry.latestRoot());
  const latestVersion = Number(await registry.rootVersion());
  const receiptRoot = BigInt(receipt.merkleRoot);

  if (receiptRoot === latestRoot) {
    pass('root matches the current on-chain root', `version ${latestVersion}`);
  } else {
    note(
      'root is STALE — someone published since this bundle was issued',
      `receipt v${receipt.rootVersion} vs on-chain v${latestVersion}. ` +
        'Expected after any transfer; the owner needs a refreshed Merkle proof (§3.1).',
    );
  }

  // ── 3. The record in the receipt is the record that was certified ─────────
  // The leaf is RECOMPUTED from `record` rather than trusted as written. Taking
  // receipt.leaf at face value was the hole: every descriptive field (area,
  // address, landUseCode, …) could be edited and the Merkle proof still passed,
  // because the proof only ever spoke about the leaf number.
  const recomputedLeaf = await hashRecord({
    propertyId: BigInt(receipt.record.propertyId),
    ownerCommitment: BigInt(receipt.record.ownerCommitment),
    useType: receipt.record.useType as UseType,
    validityPeriod: BigInt(receipt.record.validityPeriod),
    encumbranceStatus: receipt.record.encumbranceStatus as EncumbranceStatus,
    tenureType: receipt.record.tenureType as TenureType,
    offchainHash: hashOffchainMetadata({
      landUseCode: receipt.record.landUseCode,
      landUserType: receipt.record.landUserType ?? null,
      certificateSerial: receipt.record.certificateSerial,
      bookEntryNumber: receipt.record.bookEntryNumber,
      mapSheetNumber: receipt.record.mapSheetNumber ?? null,
      landOrigin: receipt.record.landOrigin ?? null,
      address: receipt.record.address,
      area: Number(receipt.record.area).toFixed(2),
      issuingAuthority: receipt.record.issuingAuthority,
      issueDate: receipt.record.issueDate,
    }),
  });

  if (recomputedLeaf === BigInt(receipt.leaf)) {
    pass('record matches the certified leaf', 'no field has been altered');
  } else {
    fail(
      'record does NOT match the leaf — the receipt has been ALTERED',
      'a field such as area, address or landUseCode was edited after issuance',
    );
    failures++;
  }

  // ── 4. The Merkle proof proves what it claims ──────────────────────────────
  const proofValid = await verifyMerkleProof(
    {
      leaf: BigInt(receipt.leaf),
      siblings: receipt.merkleProof.siblings.map((s) => BigInt(s)),
      pathIndices: receipt.merkleProof.pathIndices,
      root: receiptRoot,
    },
    receiptRoot,
  );
  if (proofValid) {
    pass('Merkle proof verifies the leaf against the receipt root');
  } else {
    fail('Merkle proof does NOT verify — the bundle is corrupt');
    failures++;
  }

  if (receipt.merkleProof.siblings.length === 20 && receipt.merkleProof.pathIndices.length === 20) {
    pass('proof has the fixed circuit depth', '20 levels');
  } else {
    fail('proof depth is wrong', `${receipt.merkleProof.siblings.length} siblings`);
    failures++;
  }

  // ── 5. The publish transaction exists ──────────────────────────────────────
  const tx = await provider.getTransaction(receipt.transactionHash);
  if (tx) {
    pass('publishRoot transaction found on chain', `block ${tx.blockNumber}`);
  } else {
    fail('publishRoot transaction not found', receipt.transactionHash);
    failures++;
  }

  // ── 6. Issuer identity (D30) — the off-chain half of the check ─────────────
  const issuerAccount = receipt.issuer.ethereumAccount;
  const role = await registry.STATE_AUTHORITY_ROLE();
  if (await registry.hasRole(role, issuerAccount)) {
    pass('issuer holds STATE_AUTHORITY_ROLE', issuerAccount);
  } else {
    fail('issuer does NOT hold STATE_AUTHORITY_ROLE', issuerAccount);
    failures++;
  }

  const certificate = new crypto.X509Certificate(receipt.issuer.IssuerCertificateChain);
  const orgName = certificate.subject
    .split('\n')
    .find((rdn) => rdn.startsWith('O='))
    ?.slice(2)
    .trim();

  const anchored = await registry.authorityInstitute(issuerAccount);
  const expected = ethers.keccak256(ethers.toUtf8Bytes(orgName ?? ''));
  if (anchored.toLowerCase() === expected.toLowerCase()) {
    pass('certificate organization matches the on-chain anchor', `O="${orgName}"`);
  } else {
    fail('certificate organization does NOT match the on-chain anchor', `O="${orgName}"`);
    failures++;
  }

  // The signature binds the certificate to the Ethereum account. Without it,
  // anyone could staple a real authority's certificate onto their own address.
  const signatureValid = crypto.verify(
    'sha256',
    Buffer.from(ethers.getAddress(issuerAccount), 'utf8'),
    certificate.publicKey,
    Buffer.from(receipt.issuer.ethereumAccountSignature, 'base64'),
  );
  if (signatureValid) {
    pass('ethereumAccountSignature verifies against the certificate key');
  } else {
    fail('ethereumAccountSignature is INVALID');
    failures++;
  }

  // PoC limitation, stated rather than hidden: nothing here checks the
  // certificate against a trusted CA (D30 / Scope 1.5 — it is self-signed).
  note('certificate chain is self-signed', 'no CA validation in the PoC');

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
