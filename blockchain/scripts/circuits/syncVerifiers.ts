/**
 * scripts/circuits/syncVerifiers.ts   (pnpm --filter blockchain run verifiers:sync)
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 4 — copy the snarkjs-generated Groth16 verifiers from
 * circuits/build/<name>/ into contracts/verifiers/ so Hardhat compiles them.
 *
 * snarkjs names every exported contract `Groth16Verifier`, so deploying three
 * of them through `ethers.getContractFactory('Groth16Verifier')` would be
 * ambiguous. The sync renames each contract after its file
 * (Groth16VerifierOwnership / ...Mortgage / ...Transfer) while copying.
 *
 * The synced .sol files are GITIGNORED, like every other trusted-setup
 * artifact: their verification-key constants are baked from the .zkey, which is
 * itself gitignored and regenerated with fresh entropy on every circuits:setup
 * run. Committing them would invite a silent proving-key/verifier mismatch.
 * circuits:setup runs this sync automatically; run verifiers:sync standalone to
 * re-sync without redoing the setup.
 *
 * The hand-written contracts depend only on contracts/interfaces/
 * IGroth16Verifiers.sol, so a checkout without the synced files still compiles.
 */

import * as fs from 'fs';
import * as path from 'path';

import { BLOCKCHAIN_DIR, buildDirFor } from './trustedSetup';

export const CIRCUIT_NAMES = ['ownership', 'mortgage', 'transfer'] as const;

const VERIFIERS_DIR = path.join(BLOCKCHAIN_DIR, 'contracts', 'verifiers');

/** `ownership` → `Groth16VerifierOwnership` — matches trustedSetup's file naming. */
function verifierContractName(circuit: string): string {
  return `Groth16Verifier${circuit.charAt(0).toUpperCase()}${circuit.slice(1)}`;
}

/**
 * Copy circuits/build/<circuit>/Groth16Verifier<Name>.sol into
 * contracts/verifiers/, renaming the contract identifier after the file.
 * Returns the destination path.
 */
export function syncVerifier(circuit: string): string {
  const contractName = verifierContractName(circuit);
  const sourcePath = path.join(buildDirFor(circuit), `${contractName}.sol`);
  const destinationPath = path.join(VERIFIERS_DIR, `${contractName}.sol`);

  if (!fs.existsSync(sourcePath)) {
    throw new Error(
      `Missing ${path.relative(BLOCKCHAIN_DIR, sourcePath)}. ` +
        `Run "pnpm --filter blockchain run circuits:setup" first.`,
    );
  }

  const source = fs.readFileSync(sourcePath, 'utf8');
  const marker = 'contract Groth16Verifier {';
  if (!source.includes(marker)) {
    throw new Error(
      `${path.relative(BLOCKCHAIN_DIR, sourcePath)} does not contain "${marker}" — ` +
        `the snarkjs verifier template changed; update syncVerifiers.ts to match.`,
    );
  }

  const renamed = source.replace(marker, `contract ${contractName} {`);
  const header =
    `// AUTO-GENERATED from circuits/build/${circuit}/ by scripts/circuits/syncVerifiers.ts — DO NOT EDIT.\n` +
    `// Regenerate via: pnpm --filter blockchain run circuits:setup   (re-sync only: verifiers:sync)\n` +
    `// Contract renamed from Groth16Verifier to ${contractName} to disambiguate the three circuits.\n`;

  fs.mkdirSync(VERIFIERS_DIR, { recursive: true });
  fs.writeFileSync(destinationPath, header + renamed);
  return destinationPath;
}

/** Sync all three circuits; returns the destination paths. */
export function syncAllVerifiers(): string[] {
  return CIRCUIT_NAMES.map((circuit) => syncVerifier(circuit));
}

if (require.main === module) {
  try {
    for (const destination of syncAllVerifiers()) {
      console.log(`synced → ${path.relative(BLOCKCHAIN_DIR, destination)}`);
    }
    console.log('Run "pnpm run compile" to (re)build artifacts + typechain types.');
  } catch (error) {
    console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
