/**
 * scripts/tools/verifyReceipt.ts
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

import * as fs from 'fs';
import * as path from 'path';
import { ethers } from 'ethers';

import { loadDeployment, resolveRpcUrl } from '../../shared/deployments';
import {
  readOrganizationName,
  readTrustedRootPem,
  trustedRootPath,
  verifyCertificateIssuedBy,
  verifyIssuerSignature,
} from '../../shared/issuerIdentity';
import { hashRecord, TREE_DEPTH, verifyMerkleProof } from '../../shared/merkleTree';
import { Receipt, receiptToLURRecord } from '../../shared/receipt';
import { RootRegistry__factory } from '../../typechain-types';
import { BLOCKCHAIN_DIR } from '../lib/paths';
import { CheckReport } from '../lib/report';

async function main(): Promise<void> {
  const receiptPath = process.argv[2];
  if (!receiptPath) {
    throw new Error('Usage: receipt:verify <path-to-receipt.json>');
  }

  const receipt: Receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  const network = process.env.CHAIN_NETWORK ?? 'localhost';
  const rpcUrl = resolveRpcUrl(network);
  const deployment = loadDeployment(BLOCKCHAIN_DIR, network);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const registry = RootRegistry__factory.connect(deployment.contracts.RootRegistry, provider);

  console.log(`\nreceipt:   ${receiptPath}`);
  console.log(`property:  ${receipt.propertyId}`);
  console.log(`network:   ${network} (${rpcUrl})\n`);

  const report = new CheckReport();

  // ── 1. The receipt points at the registry this deployment knows ────────────
  report.check(
    receipt.contractAddress.toLowerCase() === deployment.contracts.RootRegistry.toLowerCase(),
    'receipt targets the deployed RootRegistry',
    receipt.contractAddress,
    `${receipt.contractAddress} vs deployed ${deployment.contracts.RootRegistry}`,
  );

  // ── 2. Root freshness ──────────────────────────────────────────────────────
  const latestRoot = BigInt(await registry.latestRoot());
  const latestVersion = Number(await registry.rootVersion());
  const receiptRoot = BigInt(receipt.merkleRoot);

  if (receiptRoot === latestRoot) {
    report.pass('root matches the current on-chain root', `version ${latestVersion}`);
  } else {
    report.note(
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
  const recomputedLeaf = await hashRecord(receiptToLURRecord(receipt.record));

  report.check(
    recomputedLeaf === BigInt(receipt.leaf),
    'record matches the certified leaf',
    'no field has been altered',
    'the receipt has been ALTERED — a field such as area, address or landUseCode ' +
      'was edited after issuance',
  );

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
  report.check(
    proofValid,
    'Merkle proof verifies the leaf against the receipt root',
    '',
    'the bundle is corrupt',
  );

  report.check(
    receipt.merkleProof.siblings.length === TREE_DEPTH &&
      receipt.merkleProof.pathIndices.length === TREE_DEPTH,
    'proof has the fixed circuit depth',
    `${TREE_DEPTH} levels`,
    `${receipt.merkleProof.siblings.length} siblings, expected ${TREE_DEPTH}`,
  );

  // ── 5. The publish transaction exists ──────────────────────────────────────
  const tx = await provider.getTransaction(receipt.transactionHash);
  report.check(
    tx !== null,
    'publishRoot transaction found on chain',
    tx ? `block ${tx.blockNumber}` : '',
    receipt.transactionHash,
  );

  // ── 6. Issuer identity (D30) — the off-chain half of the check ─────────────
  const issuerAccount = receipt.issuer.ethereumAccount;
  const role = await registry.STATE_AUTHORITY_ROLE();
  report.check(
    await registry.hasRole(role, issuerAccount),
    'issuer holds STATE_AUTHORITY_ROLE',
    issuerAccount,
    issuerAccount,
  );

  const orgName = readOrganizationName(receipt.issuer.IssuerCertificateChain);
  const anchored = await registry.authorityInstitute(issuerAccount);
  const expected = ethers.keccak256(ethers.toUtf8Bytes(orgName));
  report.check(
    anchored.toLowerCase() === expected.toLowerCase(),
    'certificate organization matches the on-chain anchor',
    `O="${orgName}"`,
    `O="${orgName}" hashes to ${expected}, contract stores ${anchored}`,
  );

  // The signature binds the certificate to the Ethereum account. Without it,
  // anyone could staple a real authority's certificate onto their own address.
  report.check(
    verifyIssuerSignature(
      receipt.issuer.IssuerCertificateChain,
      ethers.getAddress(issuerAccount),
      receipt.issuer.ethereumAccountSignature,
    ),
    'ethereumAccountSignature verifies against the certificate key',
    '',
    'the certificate does not belong to this Ethereum account',
  );

  // Link 1 (D78): the certificate must have been issued by the root CA this
  // machine pins — never a root taken from the receipt, which an impostor
  // controls. No pinned root is a note, not a failure: nothing to check against.
  const repoRoot = path.resolve(BLOCKCHAIN_DIR, '..');
  const rootPem = readTrustedRootPem(repoRoot);
  if (rootPem === null) {
    report.note(
      'no pinned root CA — certificate origin not checked',
      `expected at ${trustedRootPath(repoRoot)}; run \`pnpm --filter backend run cert:generate\``,
    );
  } else {
    const chained = verifyCertificateIssuedBy(receipt.issuer.IssuerCertificateChain, rootPem);
    report.check(
      chained.ok,
      'issuer certificate chains to the pinned root CA',
      `issued by "${chained.issuedBy}"`,
      chained.reason,
    );
  }

  process.exit(report.summarise());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
