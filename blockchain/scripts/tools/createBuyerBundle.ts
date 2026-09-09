/**
 * scripts/tools/createBuyerBundle.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Creates a ready-to-use bundle (receipt.json + secret.json) for the buyer
 * after a transfer has been published on-chain.
 *
 * Usage:
 *   pnpm --filter blockchain run bundle:buyer <original-bundle-dir> <buyer-secret> [out-dir]
 *
 * Example:
 *   pnpm --filter blockchain run bundle:buyer bundles/b2 142180644374671002705865094078679040625424712395800384724292556060244418588 bundles/b2_buyer
 */
import * as fs from 'fs';
import * as path from 'path';

import { poseidonHash } from '../../shared/merkleTree';
import { Receipt } from '../../shared/receipt';
import { abort, getJson } from '../lib/http';

interface RefreshedProof {
  leaf: string;
  merkleRoot: string;
  rootVersion: number | null;
  siblings: string[];
  pathIndices: number[];
  onChain: { root: string; version: number };
  source: 'cache' | 'rebuilt';
}

async function main(): Promise<void> {
  const origDir = process.argv[2];
  const buyerSecretStr = process.argv[3];
  const outDir = process.argv[4] ?? origDir;

  if (!origDir || !buyerSecretStr) {
    throw new Error('Usage: bundle:buyer <original-bundle-dir> <buyer-secret> [out-dir]');
  }

  const receiptPath = path.join(origDir, 'receipt.json');
  if (!fs.existsSync(receiptPath)) {
    throw new Error(`Missing ${receiptPath} — point to the previous bundle directory`);
  }

  const origReceipt: Receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  const propertyId = origReceipt.propertyId;
  const buyerSecret = BigInt(buyerSecretStr);
  const buyerCommitment = await poseidonHash([buyerSecret]);

  console.log(`\nGenerating buyer bundle for property ${propertyId}...`);
  console.log(`  buyer secret:     ${buyerSecret.toString()}`);
  console.log(`  buyer commitment: ${buyerCommitment.toString()}`);

  // Fetch current proof from backend
  const proofRes = await getJson<RefreshedProof>(`/proof/${propertyId}`);
  if (proofRes.status >= 400) abort('fetch proof', proofRes);
  const refreshed = proofRes.body;

  // Build updated receipt
  const newReceipt: Receipt = {
    ...origReceipt,
    rootVersion: refreshed.rootVersion ?? refreshed.onChain.version,
    merkleRoot: refreshed.merkleRoot,
    leaf: refreshed.leaf,
    merkleProof: {
      siblings: refreshed.siblings,
      pathIndices: refreshed.pathIndices,
    },
    record: {
      ...origReceipt.record,
      ownerCommitment: buyerCommitment.toString(),
    },
  };

  const secretFile = {
    propertyId: propertyId.toString(),
    ownerSecret: buyerSecret.toString(),
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'receipt.json'), JSON.stringify(newReceipt, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'secret.json'), JSON.stringify(secretFile, null, 2), 'utf8');

  // If certificate.pdf or README.txt exists in origDir, copy them over
  for (const extra of ['certificate.pdf', 'README.txt']) {
    const src = path.join(origDir, extra);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(outDir, extra));
    }
  }

  console.log(`\n✔ Buyer bundle successfully written to: ${outDir}`);
  console.log(`  receipt.json (root version ${newReceipt.rootVersion})`);
  console.log(`  secret.json  (buyer secret)`);
  console.log(`\nYou can now test with:\n  pnpm --filter blockchain run proof:bodies "${outDir}"\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
