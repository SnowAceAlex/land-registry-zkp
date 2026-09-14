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
    const entry = await registry.revocations(1001n);
    expect(entry.reasonCode).to.equal(3);
    expect(entry.detailHash).to.equal(DETAIL);
    expect(entry.rootVersion).to.equal(1n);
    expect(entry.revokedAt).to.be.greaterThan(0n);
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

    // Verify each property stored with its own reason code and detail hash
    const entry1 = await registry.revocations(propertyId1);
    expect(entry1.reasonCode).to.equal(reasonCode1);
    expect(entry1.detailHash).to.equal(DETAIL);
    expect(entry1.rootVersion).to.equal(1n);

    const entry2 = await registry.revocations(propertyId2);
    expect(entry2.reasonCode).to.equal(reasonCode2);
    expect(entry2.detailHash).to.equal(DETAIL_2);
    expect(entry2.rootVersion).to.equal(1n);

    // Verify both PropertyRevoked events are emitted with correct arguments
    await expect(tx)
      .to.emit(registry, 'PropertyRevoked')
      .withArgs(propertyId1, reasonCode1, DETAIL, 1n);
    await expect(tx)
      .to.emit(registry, 'PropertyRevoked')
      .withArgs(propertyId2, reasonCode2, DETAIL_2, 1n);
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

  it('keeps a full change-set batch (D56: 50 revocations) far below the block gas limit', async () => {
    // Mirrors MAX_REVOCATIONS_PER_CHANGESET in web-app/backend/src/government/
    // changeset.service.ts. The contract itself has no length cap, so a batch
    // past the block gas limit would revert wholesale — the backend cap exists
    // to stop that, and this is the number that justifies its value.
    const batch = 50;
    const propertyIds = Array.from({ length: batch }, (_, i) => 2000n + BigInt(i));

    const gas = await registry.publishRootWithRevocations.estimateGas(
      ROOT_A,
      propertyIds,
      propertyIds.map(() => 1),
      propertyIds.map(() => DETAIL),
    );

    console.log(`      publishRootWithRevocations × ${batch}: ${gas} gas`);
    // A third of a 30M block: leaves headroom for gas price spikes and for the
    // estimate being lower than a real mined call.
    expect(gas).to.be.lessThan(10_000_000n);
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
