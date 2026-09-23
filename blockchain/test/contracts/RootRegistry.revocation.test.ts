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

  /**
   * The cap the backend actually applies (D56, re-measured at D73). MUST match
   * `MAX_REVOCATIONS_PER_CHANGESET` in
   * `web-app/backend/src/government/changeset.service.ts` — the two packages
   * cannot import each other, so this is a double-entry ledger:
   * `changeset.service.spec.ts` pins the value on the backend side, this test
   * pins what that value costs in gas.
   */
  const BACKEND_CAP = 150;

  /**
   * Half of a 30M block. Leaves room for a gas-price spike, for other
   * transactions in the same block, and for estimateGas coming in under a real
   * mined call.
   */
  const HALF_BLOCK_GAS = 15_000_000n;

  /**
   * Rungs to print. Only the cap is asserted; the rest are Chapter 5 data.
   *
   * 180 and 190 bracket a measured ceiling: on this dev network `estimateGas`
   * itself gives up somewhere between them ("Transaction ran out of gas"),
   * while the block gas limit reports 60,000,000 and the sender's balance is
   * nowhere near exhausted. The cause is not established here — what is
   * established is that a batch that large cannot even be priced on the
   * network the officer's wallet talks to in development, which is reason
   * enough not to build one.
   */
  const LADDER = [50, 100, 150, 180, 190, 200];

  it('measures the revocation gas ladder (D73 — the table goes in Chapter 5)', async () => {
    // `registry` comes from the beforeEach above, with the default signer
    // already granted STATE_AUTHORITY_ROLE. estimateGas only, so reusing ROOT_A
    // across rungs is safe: nothing is ever mined, and the "no duplicate root"
    // rule is never reached.
    const estimateFor = async (batch: number): Promise<bigint> => {
      const propertyIds = Array.from({ length: batch }, (_, i) => 2000n + BigInt(i));
      return registry.publishRootWithRevocations.estimateGas(
        ROOT_A,
        propertyIds,
        propertyIds.map(() => 1),
        propertyIds.map(() => DETAIL),
      );
    };

    const blockGasLimit = (await ethers.provider.getBlock('latest'))!.gasLimit;
    console.log(`      network block gas limit: ${blockGasLimit}`);

    for (const batch of LADDER) {
      try {
        const gas = await estimateFor(batch);
        console.log(
          `      publishRootWithRevocations × ${batch}: ${gas} gas ` +
            `(${(Number(gas) / batch).toFixed(0)}/item)`,
        );
      } catch (error) {
        // A rung that cannot be estimated at all. Reported rather than thrown:
        // it is the most useful number on the ladder — the point past which a
        // batch reverts wholesale and publishes nothing, which is the failure
        // mode the backend cap exists to prevent.
        console.log(
          `      publishRootWithRevocations × ${batch}: NOT ESTIMABLE — ` +
            `${(error as Error).message.split('\n')[0]}`,
        );
      }
    }

    // The only assertion: what the backend will actually send stays under half
    // a block. The other rungs exist to be read, not to be contracts.
    expect(await estimateFor(BACKEND_CAP)).to.be.lessThan(HALF_BLOCK_GAS);
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
