/**
 * test/contracts/RootRegistry.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 4 — RootRegistry: root publication (D29 history semantics) and
 * authority identity anchoring (D30). Runs on a fresh checkout — no
 * trusted-setup artifacts needed.
 */

import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';

const ORG_NAME = 'So Tai nguyen va Moi truong TP.HCM';
const ORG_HASH = ethers.keccak256(ethers.toUtf8Bytes(ORG_NAME));

/** Poseidon roots arrive as bigints; on-chain they are bytes32 (big-endian). */
const asRoot = (value: bigint): string => ethers.toBeHex(value, 32);

describe('contracts/RootRegistry (Phase 4)', () => {
  async function deployFixture() {
    const [admin, authority, outsider] = await ethers.getSigners();
    const registry = await ethers.deployContract('RootRegistry', [admin.address]);
    await registry.registerAuthority(authority.address, ORG_HASH);
    return { registry, admin, authority, outsider };
  }

  describe('publishRoot', () => {
    it('stores the root, bumps the version, and records history (D29)', async () => {
      const { registry, authority } = await loadFixture(deployFixture);

      expect(await registry.rootVersion()).to.equal(0n);
      expect(await registry.latestRoot()).to.equal(asRoot(0n));

      const roots = [111n, 222n, 333n].map(asRoot);
      for (const [i, root] of roots.entries()) {
        await registry.connect(authority).publishRoot(root);
        expect(await registry.latestRoot()).to.equal(root);
        expect(await registry.rootVersion()).to.equal(BigInt(i + 1));
      }

      // D29: every old root stays retrievable by version, none overwritten.
      for (const [i, root] of roots.entries()) {
        expect(await registry.rootHistory(BigInt(i + 1))).to.equal(root);
      }
      expect(await registry.rootHistory(0n)).to.equal(asRoot(0n));

      const block = await ethers.provider.getBlock('latest');
      expect(await registry.lastUpdatedAt()).to.equal(BigInt(block!.timestamp));
    });

    it('emits RootPublished with the previous root and publisher', async () => {
      const { registry, authority } = await loadFixture(deployFixture);
      await registry.connect(authority).publishRoot(asRoot(111n));

      const tx = await registry.connect(authority).publishRoot(asRoot(222n));
      const block = await ethers.provider.getBlock(tx.blockNumber!);
      await expect(tx)
        .to.emit(registry, 'RootPublished')
        .withArgs(asRoot(222n), asRoot(111n), 2n, authority.address, block!.timestamp);
    });

    it('rejects the zero root', async () => {
      const { registry, authority } = await loadFixture(deployFixture);
      await expect(
        registry.connect(authority).publishRoot(asRoot(0n)),
      ).to.be.revertedWithCustomError(registry, 'ZeroRoot');
    });

    it('rejects re-publishing the current root', async () => {
      const { registry, authority } = await loadFixture(deployFixture);
      await registry.connect(authority).publishRoot(asRoot(111n));
      await expect(registry.connect(authority).publishRoot(asRoot(111n)))
        .to.be.revertedWithCustomError(registry, 'DuplicateRoot')
        .withArgs(asRoot(111n));
    });

    it('allows re-publishing an OLDER root (rollback is a new version, not a dup)', async () => {
      const { registry, authority } = await loadFixture(deployFixture);
      await registry.connect(authority).publishRoot(asRoot(111n));
      await registry.connect(authority).publishRoot(asRoot(222n));
      await registry.connect(authority).publishRoot(asRoot(111n));
      expect(await registry.rootVersion()).to.equal(3n);
      expect(await registry.latestRoot()).to.equal(asRoot(111n));
    });

    it('rejects callers without STATE_AUTHORITY_ROLE (admin included)', async () => {
      const { registry, admin, outsider } = await loadFixture(deployFixture);
      for (const caller of [admin, outsider]) {
        await expect(
          registry.connect(caller).publishRoot(asRoot(111n)),
        ).to.be.revertedWithCustomError(registry, 'AccessControlUnauthorizedAccount');
      }
    });
  });

  describe('registerAuthority (D30)', () => {
    it('grants the role and sets the institute anchor in one transaction', async () => {
      const { registry, authority } = await loadFixture(deployFixture);
      const role = await registry.STATE_AUTHORITY_ROLE();
      expect(await registry.hasRole(role, authority.address)).to.equal(true);
      expect(await registry.authorityInstitute(authority.address)).to.equal(ORG_HASH);
    });

    it('emits AuthorityRegistered', async () => {
      const { registry, admin, outsider } = await loadFixture(deployFixture);
      await expect(registry.connect(admin).registerAuthority(outsider.address, ORG_HASH))
        .to.emit(registry, 'AuthorityRegistered')
        .withArgs(outsider.address, ORG_HASH);
    });

    it('rejects the zero address as authority', async () => {
      const { registry, admin } = await loadFixture(deployFixture);
      // Recoverable, but a role granted to address(0) is inert: nobody can sign
      // as it, so the registry would look configured while having no publisher.
      await expect(
        registry.connect(admin).registerAuthority(ethers.ZeroAddress, ORG_HASH),
      ).to.be.revertedWithCustomError(registry, 'ZeroAuthorityAccount');
    });

    it('rejects a zero institute hash', async () => {
      const { registry, admin, outsider } = await loadFixture(deployFixture);
      await expect(
        registry.connect(admin).registerAuthority(outsider.address, ethers.ZeroHash),
      ).to.be.revertedWithCustomError(registry, 'ZeroInstituteHash');
    });

    it('rejects non-admin callers', async () => {
      const { registry, authority, outsider } = await loadFixture(deployFixture);
      await expect(
        registry.connect(authority).registerAuthority(outsider.address, ORG_HASH),
      ).to.be.revertedWithCustomError(registry, 'AccessControlUnauthorizedAccount');
    });

    it('revokeRole removes the role but keeps the anchor (history semantics)', async () => {
      const { registry, admin, authority } = await loadFixture(deployFixture);
      const role = await registry.STATE_AUTHORITY_ROLE();
      await registry.connect(admin).revokeRole(role, authority.address);

      expect(await registry.hasRole(role, authority.address)).to.equal(false);
      // The anchor is data, not permission — D30's off-chain step 4 (hasRole)
      // is what de-authorizes the account.
      expect(await registry.authorityInstitute(authority.address)).to.equal(ORG_HASH);
      await expect(
        registry.connect(authority).publishRoot(asRoot(999n)),
      ).to.be.revertedWithCustomError(registry, 'AccessControlUnauthorizedAccount');
    });
  });
});
