import { expect } from 'chai';
import { ethers } from 'hardhat';
import { RootRegistry } from '../../typechain-types';

describe('RootRegistry — revocations (D45)', () => {
  let registry: RootRegistry;

  const ROOT_A = ethers.zeroPadValue('0x01', 32);
  const ROOT_B = ethers.zeroPadValue('0x02', 32);
  const DETAIL = ethers.keccak256(ethers.toUtf8Bytes('tranh chấp thừa kế'));
  const DETAIL_2 = ethers.keccak256(ethers.toUtf8Bytes('vi phạm quy hoạch'));

  beforeEach(async () => {
    const [admin] = await ethers.getSigners();
    const factory = await ethers.getContractFactory('RootRegistry');
    registry = await factory.deploy(admin.address);
    await registry.registerAuthority(admin.address, ethers.keccak256(ethers.toUtf8Bytes('IU')));
  });

  it('publishes the root and records each revocation', async () => {
    await registry.publishRootWithRevocations(ROOT_A, [1001n], [3], [DETAIL]);

    expect(await registry.latestRoot()).to.equal(ROOT_A);
    expect(await registry.isRevoked(1001n)).to.equal(true);
    expect(await registry.isRevoked(1002n)).to.equal(false); // same 256-bit word, untouched
  });

  it('emits PropertyRevoked per property', async () => {
    await expect(registry.publishRootWithRevocations(ROOT_A, [1001n], [1], [DETAIL]))
      .to.emit(registry, 'PropertyRevoked')
      .withArgs(1001n, 1, DETAIL, 1n);
  });

  it('still emits RootPublished, so the root path is unchanged', async () => {
    await expect(registry.publishRootWithRevocations(ROOT_A, [1001n], [1], [DETAIL])).to.emit(
      registry,
      'RootPublished',
    );
  });

  it('accepts an empty revocation list (a plain publish)', async () => {
    await registry.publishRootWithRevocations(ROOT_A, [], [], []);
    expect(await registry.latestRoot()).to.equal(ROOT_A);
  });

  it('revokes two distinct properties with correct per-index wiring', async () => {
    const propertyId1 = 1001n;
    const propertyId2 = 1002n;
    const reasonCode1 = 2;
    const reasonCode2 = 4;

    const tx = await registry.publishRootWithRevocations(
      ROOT_A,
      [propertyId1, propertyId2],
      [reasonCode1, reasonCode2],
      [DETAIL, DETAIL_2],
    );

    expect(await registry.isRevoked(propertyId1)).to.equal(true);
    expect(await registry.isRevoked(propertyId2)).to.equal(true);

    // Verify both PropertyRevoked events are emitted with correct arguments
    await expect(tx)
      .to.emit(registry, 'PropertyRevoked')
      .withArgs(propertyId1, reasonCode1, DETAIL, 1n);
    await expect(tx)
      .to.emit(registry, 'PropertyRevoked')
      .withArgs(propertyId2, reasonCode2, DETAIL_2, 1n);
  });

  it('keeps every bit of a word independent, across rounds (D91)', async () => {
    // 511 = bit 255 of word 1, 512 = bit 0 of word 2: both ends of the shift.
    await registry.publishRootWithRevocations(ROOT_A, [511n, 512n], [1, 1], [DETAIL, DETAIL]);
    // 510 shares word 1 with 511, so this round updates a non-empty word.
    await registry.publishRootWithRevocations(ROOT_B, [510n], [1], [DETAIL]);

    for (const id of [510n, 511n, 512n]) expect(await registry.isRevoked(id)).to.equal(true);
    for (const id of [509n, 513n]) expect(await registry.isRevoked(id)).to.equal(false);
  });

  it('rejects mismatched array lengths', async () => {
    await expect(
      registry.publishRootWithRevocations(ROOT_A, [1001n, 1002n], [1], [DETAIL]),
    ).to.be.revertedWithCustomError(registry, 'RevocationArrayLengthMismatch');
  });

  it('rejects an out-of-range reason code', async () => {
    await expect(
      registry.publishRootWithRevocations(ROOT_A, [1001n], [0], [DETAIL]),
    ).to.be.revertedWithCustomError(registry, 'InvalidReasonCode');
    await expect(
      registry.publishRootWithRevocations(ROOT_B, [1001n], [6], [DETAIL]),
    ).to.be.revertedWithCustomError(registry, 'InvalidReasonCode');
  });

  it('rejects revoking the same property twice', async () => {
    await registry.publishRootWithRevocations(ROOT_A, [1001n], [1], [DETAIL]);
    await expect(
      registry.publishRootWithRevocations(ROOT_B, [1001n], [1], [DETAIL]),
    ).to.be.revertedWithCustomError(registry, 'AlreadyRevoked');
  });

  it('rejects a duplicate propertyId inside one call', async () => {
    await expect(
      registry.publishRootWithRevocations(ROOT_A, [1001n, 1001n], [1, 1], [DETAIL, DETAIL]),
    ).to.be.revertedWithCustomError(registry, 'AlreadyRevoked');
  });

  it('rejects a caller without STATE_AUTHORITY_ROLE', async () => {
    const [, outsider] = await ethers.getSigners();
    await expect(
      registry.connect(outsider).publishRootWithRevocations(ROOT_A, [1001n], [1], [DETAIL]),
    ).to.be.revertedWithCustomError(registry, 'AccessControlUnauthorizedAccount');
  });

  /**
   * D91: the worst-case ceiling printed below minus HEADROOM. Must equal
   * DEFAULT_REVOCATION_CAP in web-app/backend/src/government/changeset.service.ts.
   */
  const BACKEND_CAP = 591;

  /** D91: the cap stays this many plots under the measured worst-case ceiling. */
  const HEADROOM = 50;

  /** EIP-7825 per-transaction gas cap; Hardhat prices storage pre-Glamsterdam. */
  const TX_GAS_CAP = 16_777_216n;

  // One plot per 256-bit word, so every revocation creates a slot: the worst case.
  const wordIds = (n: number, bit: bigint) =>
    Array.from({ length: n }, (_, i) => BigInt(i + 1) * 256n + bit);

  it('measures the revocation ceiling (D91 — the numbers go in Chapter 5)', async () => {
    const estimateFor = (root: string, ids: bigint[]) =>
      registry.publishRootWithRevocations.estimateGas(
        root,
        ids,
        ids.map(() => 1),
        ids.map(() => DETAIL),
      );
    const fits = (n: number) =>
      estimateFor(ROOT_A, wordIds(n, 7n)).then(
        (gas) => gas <= TX_GAS_CAP,
        () => false, // the network will not even price it
      );

    // Largest worst-case round one transaction carries.
    let ceiling = 0;
    let hi = 2048;
    while (ceiling < hi) {
      const mid = Math.ceil((ceiling + hi) / 2);
      if (await fits(mid)) ceiling = mid;
      else hi = mid - 1;
    }
    const base = await estimateFor(ROOT_A, []);
    const fresh = await estimateFor(ROOT_A, wordIds(100, 7n));
    console.log(`      worst-case ceiling: ${ceiling} revocations/tx`);
    console.log(`      new words: ${(Number(fresh - base) / 100).toFixed(0)} gas/item`);

    // Steady state: the same words already hold one revoked plot each.
    const prep = wordIds(100, 7n);
    await registry.publishRootWithRevocations(
      ROOT_A,
      prep,
      prep.map(() => 1),
      prep.map(() => DETAIL),
    );
    const steadyBase = await estimateFor(ROOT_B, []);
    const steady = await estimateFor(ROOT_B, wordIds(100, 8n));
    console.log(`      existing words: ${(Number(steady - steadyBase) / 100).toFixed(0)} gas/item`);

    // The only assertion: the backend's cap stays HEADROOM plots under the ceiling.
    expect(BACKEND_CAP + HEADROOM).to.be.at.most(ceiling);
  });

  it('still rejects a zero or duplicate root', async () => {
    await expect(
      registry.publishRootWithRevocations(ethers.ZeroHash, [], [], []),
    ).to.be.revertedWithCustomError(registry, 'ZeroRoot');
    await registry.publishRootWithRevocations(ROOT_A, [], [], []);
    await expect(
      registry.publishRootWithRevocations(ROOT_A, [], [], []),
    ).to.be.revertedWithCustomError(registry, 'DuplicateRoot');
  });
});
