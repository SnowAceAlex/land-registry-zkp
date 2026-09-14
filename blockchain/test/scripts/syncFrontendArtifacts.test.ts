/**
 * test/scripts/syncFrontendArtifacts.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * D55 — the browser proves with copies of the circuit artifacts served from
 * web-app/frontend/public/circuits/. A copy that silently lands in the wrong
 * place, or quietly keeps a stale .zkey, produces proofs the on-chain verifier
 * rejects; so what is under test is the destination layout and that a missing
 * source fails loudly instead of leaving the old copy in place.
 *
 * Runs against temporary directories — never the real build output.
 */

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { syncFrontendArtifacts } from '../../scripts/circuits/syncFrontendArtifacts';

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

describe('syncFrontendArtifacts (D55)', () => {
  let root: string;
  let buildDir: string;
  let destinationRoot: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-frontend-'));
    buildDir = path.join(root, 'build', 'ownership');
    destinationRoot = path.join(root, 'public', 'circuits');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('copies wasm, zkey and verification key into public/circuits/<circuit>/', () => {
    writeFile(path.join(buildDir, 'ownership_js', 'ownership.wasm'), 'wasm-bytes');
    writeFile(path.join(buildDir, 'ownership.zkey'), 'zkey-bytes');
    writeFile(path.join(buildDir, 'verification_key.json'), '{"protocol":"groth16"}');

    const written = syncFrontendArtifacts('ownership', { buildDir, destinationRoot });

    const destination = path.join(destinationRoot, 'ownership');
    expect(written).to.deep.equal([
      path.join(destination, 'ownership.wasm'),
      path.join(destination, 'ownership.zkey'),
      path.join(destination, 'verification_key.json'),
    ]);
    expect(fs.readFileSync(path.join(destination, 'ownership.wasm'), 'utf8')).to.equal(
      'wasm-bytes',
    );
    expect(fs.readFileSync(path.join(destination, 'ownership.zkey'), 'utf8')).to.equal(
      'zkey-bytes',
    );
    expect(fs.readFileSync(path.join(destination, 'verification_key.json'), 'utf8')).to.equal(
      '{"protocol":"groth16"}',
    );
  });

  it('refuses to sync when the trusted setup has not produced a zkey, naming the fix', () => {
    writeFile(path.join(buildDir, 'ownership_js', 'ownership.wasm'), 'wasm-bytes');
    writeFile(path.join(buildDir, 'verification_key.json'), '{}');

    expect(() => syncFrontendArtifacts('ownership', { buildDir, destinationRoot })).to.throw(
      /ownership\.zkey[\s\S]*circuits:setup/,
    );
  });

  it('copies nothing when any source is missing, so a stale set is never half-replaced', () => {
    writeFile(path.join(destinationRoot, 'ownership', 'ownership.wasm'), 'old-wasm');
    writeFile(path.join(buildDir, 'ownership_js', 'ownership.wasm'), 'new-wasm');

    expect(() => syncFrontendArtifacts('ownership', { buildDir, destinationRoot })).to.throw();
    expect(
      fs.readFileSync(path.join(destinationRoot, 'ownership', 'ownership.wasm'), 'utf8'),
    ).to.equal('old-wasm');
  });
});
