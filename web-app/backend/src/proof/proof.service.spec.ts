import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Property } from '@prisma/client';

/**
 * Only the snarkjs call is mocked. Everything else — Poseidon, the sparse tree,
 * freshness, circuit-type inference — runs for real, so these tests exercise the
 * actual leaf hashing rather than a stand-in for it. `verifyGroth16Proof` is the
 * one exception because it needs the gitignored trusted-setup artifacts (D32),
 * which a unit run must not depend on.
 */
jest.mock('@land-registry/blockchain/shared', () => ({
  ...jest.requireActual('@land-registry/blockchain/shared'),
  verifyGroth16Proof: jest.fn(),
}));

import {
  MerkleProofData,
  PUBLIC_SIGNAL_ORDER,
  TREE_DEPTH,
  buildTree,
  generateMerkleProof,
  nowUnixTimestamp,
  verifyGroth16Proof,
} from '@land-registry/blockchain/shared';

import { ChainService, ProofRejectedError } from '../chain/chain.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProofService } from './proof.service';
import { TreeService } from '../tree/tree.service';
import { VerifyProofDto } from './dto/proof.dto';
import { makeProperty } from '../../test/factories';
import { toLURRecord } from '../records/record.mapper';

const mockedVerifyGroth16Proof = verifyGroth16Proof as jest.MockedFunction<
  typeof verifyGroth16Proof
>;

const CHAIN_VERSION = 3;
const REGISTRY_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';

/** A dummy proof body — nothing under test ever inspects its contents. */
const PROOF = { pi_a: ['1', '2'], pi_b: [['3', '4']], pi_c: ['5', '6'], protocol: 'groth16' };

/**
 * The registry as three issued properties, with the cached proof columns filled
 * in the way RootService writes them after a publish.
 */
async function makeRegistry(): Promise<{
  properties: Property[];
  root: bigint;
  cachedRows: Property[];
}> {
  const properties = ['1', '2', '10'].map((propertyId) => makeProperty({ propertyId }));
  const tree = await buildTree(properties.map(toLURRecord));

  const cachedRows = await Promise.all(
    properties.map(async (property) => {
      const proof = await generateMerkleProof(tree, toLURRecord(property));
      return {
        ...property,
        leaf: proof.leaf.toString(),
        merkleProof: {
          siblings: proof.siblings.map((s) => s.toString()),
          pathIndices: proof.pathIndices,
        },
        rootVersion: CHAIN_VERSION,
      } as Property;
    }),
  );

  return { properties, root: tree.root, cachedRows };
}

interface Harness {
  service: ProofService;
  buildCurrentTree: jest.Mock;
  verifyOnChain: jest.Mock;
}

function makeService(row: Property | null, latestRoot: bigint, rows: Property[] = []): Harness {
  const prisma = {
    property: { findUnique: jest.fn().mockResolvedValue(row) },
  } as unknown as PrismaService;

  const real = new TreeService({
    property: { findMany: jest.fn().mockResolvedValue(rows) },
  } as unknown as PrismaService);
  const buildCurrentTree = jest.fn(() => real.buildCurrentTree());
  const tree = {
    buildCurrentTree,
    proofFor: real.proofFor.bind(real),
  } as unknown as TreeService;

  const verifyOnChain = jest.fn().mockResolvedValue(true);
  const chain = {
    getLatestRoot: jest.fn().mockResolvedValue(latestRoot),
    getRootVersion: jest.fn().mockResolvedValue(CHAIN_VERSION),
    rootRegistryAddress: REGISTRY_ADDRESS,
    verifyOnChain,
  } as unknown as ChainService;

  return { service: new ProofService(prisma, tree, chain), buildCurrentTree, verifyOnChain };
}

/** Public signals for an ownership proof, fresh and against `root` by default. */
function ownershipSignals(root: bigint, timestamp = nowUnixTimestamp()): string[] {
  return [root.toString(), '1', makeProperty().ownerCommitment!, timestamp.toString()];
}

beforeEach(() => {
  mockedVerifyGroth16Proof.mockReset();
  mockedVerifyGroth16Proof.mockResolvedValue(true);
});

describe('ProofService.getMerkleProof — cache-first, self-healing (D40)', () => {
  it('serves the cached proof when its rootVersion matches the chain', async () => {
    const { root, cachedRows } = await makeRegistry();
    const { service, buildCurrentTree } = makeService(cachedRows[0], root, cachedRows);

    const result = await service.getMerkleProof('1');

    expect(result.source).toBe('cache');
    expect(result.inSync).toBe(true);
    expect(result.rootVersion).toBe(CHAIN_VERSION);
    expect(result.merkleRoot).toBe(root.toString());
    expect(result.siblings).toHaveLength(TREE_DEPTH);
    expect(result.pathIndices).toHaveLength(TREE_DEPTH);
    expect(result.contractAddress).toBe(REGISTRY_ADDRESS);
    // The whole point of the cache: no tree is rebuilt on the hot path.
    expect(buildCurrentTree).not.toHaveBeenCalled();
  });

  it('rebuilds when the cached proof belongs to an older root version', async () => {
    const { root, cachedRows } = await makeRegistry();
    // What the row looks like after someone else transferred and the DB write
    // that refreshes the cache has not landed yet.
    const stale = { ...cachedRows[0], rootVersion: CHAIN_VERSION - 1 };
    const { service, buildCurrentTree } = makeService(stale, root, cachedRows);

    const result = await service.getMerkleProof('1');

    expect(result.source).toBe('rebuilt');
    expect(buildCurrentTree).toHaveBeenCalledTimes(1);
    // Rebuilt or cached, the answer is the same proof — that equivalence is
    // what makes the cache safe to prefer.
    expect(result.merkleRoot).toBe(root.toString());
    expect(result.leaf).toBe(cachedRows[0].leaf);
    expect(result.siblings).toEqual((cachedRows[0].merkleProof as { siblings: string[] }).siblings);
  });

  it('rebuilds when the property has never been cached', async () => {
    const { properties, root, cachedRows } = await makeRegistry();
    const { service, buildCurrentTree } = makeService(properties[0], root, cachedRows);

    expect((await service.getMerkleProof('1')).source).toBe('rebuilt');
    expect(buildCurrentTree).toHaveBeenCalledTimes(1);
  });

  it('reports inSync: false and a null rootVersion when the DB is ahead of the chain', async () => {
    const { properties, cachedRows } = await makeRegistry();
    const { service } = makeService(properties[0], 999n, cachedRows);

    const result = await service.getMerkleProof('1');

    expect(result.inSync).toBe(false);
    // An unpublished root has no version, and inventing one would put a
    // meaningless number into a refreshed receipt.
    expect(result.rootVersion).toBeNull();
    expect(result.onChain.root).toBe('999');
  });

  it('rebuilds around a corrupt cache instead of failing — a row can lie about its version', async () => {
    const { root, cachedRows } = await makeRegistry();
    const corrupt = {
      ...cachedRows[0],
      merkleProof: {
        ...(cachedRows[0].merkleProof as { siblings: string[]; pathIndices: number[] }),
        siblings: Array(20).fill('0'),
      },
    } as Property;
    const { service, buildCurrentTree } = makeService(corrupt, root, cachedRows);

    const result = await service.getMerkleProof('1');

    // The tree can answer this correctly in milliseconds, so blocking the owner
    // until an officer republishes would be an outage we inflicted on ourselves.
    expect(result.source).toBe('rebuilt');
    expect(buildCurrentTree).toHaveBeenCalledTimes(1);
    expect(result.siblings).toEqual((cachedRows[0].merkleProof as { siblings: string[] }).siblings);
  });

  it('refuses to hand out a rebuilt proof that does not verify — the fault is deeper', async () => {
    const { root, cachedRows } = await makeRegistry();
    const { service } = makeService(
      { ...cachedRows[0], leaf: null, merkleProof: null } as Property,
      root,
      cachedRows,
    );

    // No cache to fall back on, and the tree itself hands back something that
    // does not verify. Unreachable in practice — which is the point of asserting
    // it stays a loud 503 rather than a proof nobody can use.
    (service as unknown as { rebuild: () => Promise<MerkleProofData> }).rebuild = async () => ({
      leaf: 1n,
      siblings: Array<bigint>(20).fill(0n),
      pathIndices: Array<number>(20).fill(0),
      root,
    });

    await expect(service.getMerkleProof('1')).rejects.toThrow(ServiceUnavailableException);
  });

  it('404s an unknown property', async () => {
    const { service } = makeService(null, 1n);
    await expect(service.getMerkleProof('999')).rejects.toThrow(NotFoundException);
  });

  it('400s a property that is imported but not issued — it has no leaf', async () => {
    const notIssued = makeProperty({
      propertyId: '1',
      ownerCommitment: null,
      issuedAt: null,
      status: 'IMPORTED',
    });
    const { service } = makeService(notIssued, 1n);
    await expect(service.getMerkleProof('1')).rejects.toThrow(BadRequestException);
  });

  it('410s a revoked property — not 404, and never returns a stale cached proof', async () => {
    const revoked = makeProperty({
      propertyId: '1001',
      status: 'REVOKED',
      ownerCommitment: 'c1',
      leaf: 'stale-leaf',
      merkleProof: { siblings: [], pathIndices: [] },
      rootVersion: CHAIN_VERSION,
    });
    const { service } = makeService(revoked, 1n);

    await expect(service.getMerkleProof('1001')).rejects.toMatchObject({ status: 410 });
  });
});

describe('ProofService.verify', () => {
  const ROOT = 12345n;

  function dto(overrides: Partial<VerifyProofDto> = {}): VerifyProofDto {
    return {
      proof: PROOF,
      publicSignals: ownershipSignals(ROOT),
      ...overrides,
    } as VerifyProofDto;
  }

  it('accepts a fresh, valid proof against the current root', async () => {
    const { service } = makeService(null, ROOT);

    const result = await service.verify(dto());

    expect(result.valid).toBe(true);
    expect(result.circuitType).toBe('ownership');
    expect(result.checks).toEqual({
      cryptographic: true,
      freshness: true,
      rootMatchesChain: true,
      onChain: null,
    });
    // The disclosed set IS the selective disclosure — it must be exactly the
    // circuit's public signals and nothing else.
    expect(Object.keys(result.disclosed)).toEqual([...PUBLIC_SIGNAL_ORDER.ownership]);
    expect(result.disclosed.merkleRoot).toBe(ROOT.toString());
  });

  it('rejects a replayed proof whose timestamp is outside the tolerance (D26)', async () => {
    const { service } = makeService(null, ROOT);
    const twoYearsAgo = nowUnixTimestamp() - 63_072_000n;

    // The cryptographic check would pass — that is exactly the danger.
    await expect(
      service.verify(dto({ publicSignals: ownershipSignals(ROOT, twoYearsAgo) })),
    ).rejects.toMatchObject({
      response: { reason: 'StaleTimestamp', valid: false },
    });
  });

  it('rejects a proof made against a superseded root', async () => {
    const { service } = makeService(null, ROOT);

    await expect(
      service.verify(dto({ publicSignals: ownershipSignals(999n) })),
    ).rejects.toMatchObject({
      response: { reason: 'RootMismatch', details: { expected: '12345', actual: '999' } },
    });
  });

  it('rejects a cryptographically invalid proof', async () => {
    mockedVerifyGroth16Proof.mockResolvedValue(false);
    const { service } = makeService(null, ROOT);

    await expect(service.verify(dto())).rejects.toMatchObject({
      response: { reason: 'InvalidProof' },
    });
  });

  it('infers the circuit from the public-signal count', async () => {
    const { service } = makeService(null, ROOT);
    const mortgage = [...ownershipSignals(ROOT), '157680000'];

    expect((await service.verify(dto({ publicSignals: mortgage }))).circuitType).toBe('mortgage');
  });

  it('400s when a stated circuitType contradicts the signal count', async () => {
    const { service } = makeService(null, ROOT);

    await expect(service.verify(dto({ circuitType: 'transfer' }))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('400s a signal count no circuit produces', async () => {
    const { service } = makeService(null, ROOT);

    await expect(service.verify(dto({ publicSignals: ['1', '2'] }))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('asks the contract too when onChain is requested', async () => {
    const { service, verifyOnChain } = makeService(null, ROOT);

    const result = await service.verify(dto({ onChain: true }));

    expect(verifyOnChain).toHaveBeenCalledWith('ownership', PROOF, expect.any(Array));
    expect(result.checks.onChain).toBe(true);
  });

  it('surfaces a contract rejection with the contract reason (D33)', async () => {
    const { service, verifyOnChain } = makeService(null, ROOT);
    verifyOnChain.mockRejectedValue(
      new ProofRejectedError('StaleTimestamp', 'outside tolerance', { claimed: '1' }),
    );

    await expect(service.verify(dto({ onChain: true }))).rejects.toMatchObject({
      response: { reason: 'StaleTimestamp', details: { claimed: '1' } },
    });
  });

  it('reports missing trusted-setup artifacts as a server problem, not a bad proof', async () => {
    const enoent = Object.assign(new Error('no such file'), { code: 'ENOENT' });
    mockedVerifyGroth16Proof.mockRejectedValue(enoent);
    const { service } = makeService(null, ROOT);

    await expect(service.verify(dto())).rejects.toThrow(ServiceUnavailableException);
    await expect(service.verify(dto())).rejects.not.toThrow(UnprocessableEntityException);
  });
});
