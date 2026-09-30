import { expect } from 'chai';
import { ethers } from 'hardhat';
import { RootRegistry } from '../../typechain-types';

describe('RootRegistry — owner freeze (D79)', () => {
  let registry: RootRegistry;

  const C_A = 111n;
  const C_B = 222n;

  beforeEach(async () => {
    const [admin] = await ethers.getSigners();
    const factory = await ethers.getContractFactory('RootRegistry');
    registry = await factory.deploy(admin.address);
    await registry.registerAuthority(admin.address, ethers.keccak256(ethers.toUtf8Bytes('IU')));
  });

  it('records the frozen commitment and emits Frozen', async () => {
    await expect(registry.freezeOwners([1001n], [C_A]))
      .to.emit(registry, 'Frozen')
      .withArgs(1001n, C_A);
    expect(await registry.frozenOwner(1001n)).to.equal(C_A);
  });

  it('reads 0 for a property that was never frozen', async () => {
    expect(await registry.frozenOwner(42n)).to.equal(0n);
  });

  it('overwrites an entry — the next owner of a transferred plot', async () => {
    await registry.freezeOwners([1001n], [C_A]);
    await registry.freezeOwners([1001n], [C_B]);
    expect(await registry.frozenOwner(1001n)).to.equal(C_B);
  });

  it('accepts the same value twice, so a retried signature cannot fail', async () => {
    await registry.freezeOwners([1001n], [C_A]);
    await expect(registry.freezeOwners([1001n], [C_A])).to.not.be.reverted;
  });

  it('rejects a zero commitment — 0 is the "not frozen" sentinel', async () => {
    await expect(registry.freezeOwners([1001n], [0n])).to.be.revertedWithCustomError(
      registry,
      'ZeroOwnerCommitment',
    );
  });

  it('rejects arrays of different lengths', async () => {
    await expect(registry.freezeOwners([1001n, 1002n], [C_A])).to.be.revertedWithCustomError(
      registry,
      'FreezeArrayLengthMismatch',
    );
  });

  it('unfreezes, emitting the commitment that was lifted', async () => {
    await registry.freezeOwners([1001n], [C_A]);
    await expect(registry.unfreezeOwners([1001n]))
      .to.emit(registry, 'Unfrozen')
      .withArgs(1001n, C_A);
    expect(await registry.frozenOwner(1001n)).to.equal(0n);
  });

  it('refuses to unfreeze a property that is not frozen', async () => {
    await expect(registry.unfreezeOwners([1001n]))
      .to.be.revertedWithCustomError(registry, 'NotFrozen')
      .withArgs(1001n);
  });

  it('reads many entries in one call', async () => {
    await registry.freezeOwners([1n, 3n], [C_A, C_B]);
    expect([...(await registry.frozenOwnersOf([1n, 2n, 3n]))]).to.deep.equal([C_A, 0n, C_B]);
  });

  it('only a state authority may freeze or unfreeze', async () => {
    const [, stranger] = await ethers.getSigners();
    await expect(
      registry.connect(stranger).freezeOwners([1n], [C_A]),
    ).to.be.revertedWithCustomError(registry, 'AccessControlUnauthorizedAccount');

    await registry.freezeOwners([1n], [C_A]);
    await expect(registry.connect(stranger).unfreezeOwners([1n])).to.be.revertedWithCustomError(
      registry,
      'AccessControlUnauthorizedAccount',
    );
  });

  it('does not touch the root', async () => {
    await registry.freezeOwners([1n], [C_A]);
    expect(await registry.rootVersion()).to.equal(0n);
  });

  it('measures gas for one freeze, a batch of 200 and one unfreeze', async () => {
    const one = await (await registry.freezeOwners([1n], [C_A])).wait();
    const ids = Array.from({ length: 200 }, (_, i) => BigInt(10_000 + i));
    const batch = await (await registry.freezeOwners(ids, ids.map(() => C_B))).wait();
    const lift = await (await registry.unfreezeOwners([1n])).wait();

    console.table({
      freeze1: one!.gasUsed.toString(),
      freeze200: batch!.gasUsed.toString(),
      unfreeze1: lift!.gasUsed.toString(),
    });
    // MAX_FREEZES_PER_TX (200) must stay far below a 30M block.
    expect(batch!.gasUsed).to.be.lessThan(10_000_000n);
  });
});
