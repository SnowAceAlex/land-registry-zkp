import {
  BadRequestException,
  GoneException,
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
  PUBLIC_SIGNAL_ORDER,
  TREE_DEPTH,
  buildTree,
  generateMerkleProof,
  hashRecord,
  nowUnixTimestamp,
  proofFrom,
  readerFromTree,
  verifyGroth16Proof,
} from '@land-registry/blockchain/shared';

import { ChainService, ProofRejectedError } from '../chain/chain.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProofService } from './proof.service';
import { NodeStoreService } from '../tree/node-store.service';
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
 * The registry as three issued properties, with the `leaf` and `rootVersion`
 * columns filled the way a confirmed round writes them. No cached proof: since
 * D72 the tree is the node table, and `leaf` is the only column left.
 */
async function makeRegistry(): Promise<{
  properties: Property[];
  root: bigint;
  rows: Property[];
}> {
  const properties = ['1', '2', '10'].map((propertyId) => makeProperty({ propertyId }));
  const tree = await buildTree(properties.map(toLURRecord));

  const rows = await Promise.all(
    properties.map(async (property) => {
      const proof = await generateMerkleProof(tree, toLURRecord(property));
      return { ...property, leaf: proof.leaf.toString(), rootVersion: CHAIN_VERSION } as Property;
    }),
  );

  return { properties, root: tree.root, rows };
}

interface Harness {
  service: ProofService;
  proofFor: jest.Mock;
  verifyOnChain: jest.Mock;
  getFrozenOwners: jest.Mock;
}

/**
 * `NodeStoreService` is stood in for, but its ARITHMETIC is not: `proofFor`
 * below runs the real `proofFrom` over a real `buildTree`, so Poseidon, the
 * sparse-tree traversal and the D41 leaf placement all execute for real. What
 * is faked is only the SQL — a unit test against a mocked database would prove
 * the mock behaves, which is why the query itself is left to the runbook.
 *
 * `storedRoot` is separate from the tree's root on purpose: the service is
 * supposed to notice when the climbed path and the stored root node disagree,
 * and that is only testable if the two can be made to differ.
 */
async function makeService(
  row: Property | null,
  latestRoot: bigint,
  rows: Property[] = [],
  storedRoot?: bigint,
): Promise<Harness> {
  const prisma = {
    property: { findUnique: jest.fn().mockResolvedValue(row) },
  } as unknown as PrismaService;

  const tree = await buildTree(rows.map(toLURRecord));
  const proofFor = jest.fn(async (property: Property) =>
    proofFrom(
      Number(property.propertyId),
      await hashRecord(toLURRecord(property)),
      readerFromTree(tree),
    ),
  );
  const nodes = {
    rootNow: jest.fn().mockResolvedValue(storedRoot ?? tree.root),
    proofFor,
  } as unknown as NodeStoreService;

  const verifyOnChain = jest.fn().mockResolvedValue(true);
  const getFrozenOwners = jest.fn().mockResolvedValue(new Map());
  const chain = {
    getLatestRoot: jest.fn().mockResolvedValue(latestRoot),
    getRootVersion: jest.fn().mockResolvedValue(CHAIN_VERSION),
    rootRegistryAddress: REGISTRY_ADDRESS,
    verifyOnChain,
    getFrozenOwners,
  } as unknown as ChainService;

  return { service: new ProofService(prisma, nodes, chain), proofFor, verifyOnChain, getFrozenOwners };
}

/** Public signals for an ownership proof, fresh and against `root` by default. */
function ownershipSignals(root: bigint, timestamp = nowUnixTimestamp()): string[] {
  return [root.toString(), '1', makeProperty().ownerCommitment!, timestamp.toString()];
}

beforeEach(() => {
  mockedVerifyGroth16Proof.mockReset();
  mockedVerifyGroth16Proof.mockResolvedValue(true);
});

describe('ProofService.getMerkleProof — read from the node table (D72)', () => {
  it('serves the proof for an issued plot', async () => {
    const { root, rows } = await makeRegistry();
    const { service, proofFor } = await makeService(rows[0], root, rows);

    const result = await service.getMerkleProof('1');

    expect(result.source).toBe('nodes');
    expect(result.inSync).toBe(true);
    expect(result.rootVersion).toBe(CHAIN_VERSION);
    expect(result.merkleRoot).toBe(root.toString());
    expect(result.leaf).toBe(rows[0].leaf);
    expect(result.siblings).toHaveLength(TREE_DEPTH);
    expect(result.pathIndices).toHaveLength(TREE_DEPTH);
    expect(result.contractAddress).toBe(REGISTRY_ADDRESS);
    // One read of the node table, and nothing else. There is no second path to
    // fall into any more — which is the whole of D72 on this route.
    expect(proofFor).toHaveBeenCalledTimes(1);
  });

  it('never depends on the cached `leaf` column — the proof is computed from the record', async () => {
    const { root, rows } = await makeRegistry();
    // A row whose cached leaf is a lie. The answer must not change: `leaf` is
    // bookkeeping, the record is the truth (D72 repurposed these columns).
    const lying = { ...rows[0], leaf: '12345' } as Property;
    const { service } = await makeService(lying, root, rows);

    const result = await service.getMerkleProof('1');

    expect(result.leaf).toBe(rows[0].leaf);
    expect(result.merkleRoot).toBe(root.toString());
  });

  it('reports inSync: false and a null rootVersion when the DB is ahead of the chain', async () => {
    const { rows } = await makeRegistry();
    const { service } = await makeService(rows[0], 999n, rows);

    const result = await service.getMerkleProof('1');

    expect(result.inSync).toBe(false);
    // An unpublished root has no version, and inventing one would put a
    // meaningless number into a refreshed receipt.
    expect(result.rootVersion).toBeNull();
    expect(result.onChain.root).toBe('999');
  });

  it('503s when the climbed path and the stored root node disagree', async () => {
    const { root, rows } = await makeRegistry();
    // Two independent paths through the same table: the proof climbs up from
    // the leaf through stored siblings, `rootNow()` reads the stored root. They
    // can only differ if the table was written partially — and then every proof
    // served from it is worthless, so this must be loud rather than silent.
    const { service } = await makeService(rows[0], root, rows, root + 1n);

    await expect(service.getMerkleProof('1')).rejects.toThrow(ServiceUnavailableException);
  });

  it('404s an unknown property', async () => {
    const { service } = await makeService(null, 1n);
    await expect(service.getMerkleProof('999')).rejects.toThrow(NotFoundException);
  });

  it('400s a property that is imported but not issued — it has no leaf', async () => {
    const notIssued = makeProperty({
      propertyId: '1',
      ownerCommitment: null,
      issuedAt: null,
      status: 'IMPORTED',
    });
    const { service } = await makeService(notIssued, 1n);
    await expect(service.getMerkleProof('1')).rejects.toThrow(BadRequestException);
  });

  it('410s a revoked property — not 404, and never a proof into a tree it left', async () => {
    const revoked = makeProperty({
      propertyId: '1',
      status: 'REVOKED',
      leaf: null,
      rootVersion: null,
    });
    const { service } = await makeService(revoked, 1n);
    await expect(service.getMerkleProof('1')).rejects.toThrow(GoneException);
  });
});

describe('ProofService.conditionalProof — the validator is guessable (D74)', () => {
  it('serves the proof when the client has no validator', async () => {
    const { root, rows } = await makeRegistry();
    const { service } = await makeService(rows[0], root, rows);

    const { etag, proof } = await service.conditionalProof('1', undefined);

    expect(etag).toBe(`"v${CHAIN_VERSION}-p1"`);
    expect(proof?.merkleRoot).toBe(root.toString());
  });

  it('answers not-modified when the validator matches', async () => {
    const { root, rows } = await makeRegistry();
    const { service, proofFor } = await makeService(rows[0], root, rows);

    const { proof } = await service.conditionalProof('1', `"v${CHAIN_VERSION}-p1"`);

    expect(proof).toBeUndefined();
    // The saving that matters: no node lookups and no Poseidon hashing.
    expect(proofFor).not.toHaveBeenCalled();
  });

  /**
   * The window between the wallet publishing and confirm() writing the nodes:
   * the chain is a version ahead of the table. A validator on that answer would
   * let every later revalidation 304 an `inSync: false` body — past confirm(),
   * until the next publish.
   */
  it('gives no validator to an answer that is out of sync with the chain', async () => {
    const { rows } = await makeRegistry();
    const { service } = await makeService(rows[0], 999n, rows);

    const { etag, proof } = await service.conditionalProof('1', undefined);

    expect(proof?.inSync).toBe(false);
    expect(etag).toBeUndefined();
  });

  it('serves the proof again once the root version has moved', async () => {
    const { root, rows } = await makeRegistry();
    const { service } = await makeService(rows[0], root, rows);

    const { proof } = await service.conditionalProof('1', `"v${CHAIN_VERSION - 1}-p1"`);

    expect(proof).toBeDefined();
  });

  it('404s an unknown plot even when the client presents the CURRENT validator', async () => {
    // The validator is `"v<version>-p<id>"` — public and deterministic, so
    // anyone can write one down for a plot they have never been served. If the
    // comparison came before the lookup, this would be a 304 about a resource
    // that does not exist.
    const { service } = await makeService(null, 1n);

    await expect(
      service.conditionalProof('999999', `"v${CHAIN_VERSION}-p999999"`),
    ).rejects.toThrow(NotFoundException);
  });

  it('410s a revoked plot even with the current validator — the one that matters', async () => {
    // A verifier polling with a guessed validator must still be told the
    // certificate was reclaimed. A 304 here would hide a revocation for as long
    // as the caller kept asking.
    const revoked = makeProperty({ propertyId: '1', status: 'REVOKED', leaf: null });
    const { service } = await makeService(revoked, 1n);

    await expect(service.conditionalProof('1', `"v${CHAIN_VERSION}-p1"`)).rejects.toThrow(
      GoneException,
    );
  });

  it('400s an imported-but-not-issued plot even with the current validator', async () => {
    const notIssued = makeProperty({
      propertyId: '1',
      ownerCommitment: null,
      issuedAt: null,
      status: 'IMPORTED',
    });
    const { service } = await makeService(notIssued, 1n);

    await expect(service.conditionalProof('1', `"v${CHAIN_VERSION}-p1"`)).rejects.toThrow(
      BadRequestException,
    );
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
    const { service } = await makeService(null, ROOT);

    const result = await service.verify(dto());

    expect(result.valid).toBe(true);
    expect(result.circuitType).toBe('ownership');
    expect(result.checks).toEqual({
      cryptographic: true,
      freshness: true,
      rootMatchesChain: true,
      ownerNotFrozen: true,
      onChain: null,
    });
    // The disclosed set IS the selective disclosure — it must be exactly the
    // circuit's public signals and nothing else.
    expect(Object.keys(result.disclosed)).toEqual([...PUBLIC_SIGNAL_ORDER.ownership]);
    expect(result.disclosed.merkleRoot).toBe(ROOT.toString());
  });

  it('rejects a replayed proof whose timestamp is outside the tolerance (D26)', async () => {
    const { service } = await makeService(null, ROOT);
    const twoYearsAgo = nowUnixTimestamp() - 63_072_000n;

    // The cryptographic check would pass — that is exactly the danger.
    await expect(
      service.verify(dto({ publicSignals: ownershipSignals(ROOT, twoYearsAgo) })),
    ).rejects.toMatchObject({
      response: { reason: 'StaleTimestamp', valid: false },
    });
  });

  it('rejects a proof made against a superseded root', async () => {
    const { service } = await makeService(null, ROOT);

    await expect(
      service.verify(dto({ publicSignals: ownershipSignals(999n) })),
    ).rejects.toMatchObject({
      response: { reason: 'RootMismatch', details: { expected: '12345', actual: '999' } },
    });
  });

  it('rejects a cryptographically invalid proof', async () => {
    mockedVerifyGroth16Proof.mockResolvedValue(false);
    const { service } = await makeService(null, ROOT);

    await expect(service.verify(dto())).rejects.toMatchObject({
      response: { reason: 'InvalidProof' },
    });
  });

  it('infers the circuit from the public-signal count', async () => {
    const { service } = await makeService(null, ROOT);
    const mortgage = [...ownershipSignals(ROOT), '157680000'];

    expect((await service.verify(dto({ publicSignals: mortgage }))).circuitType).toBe('mortgage');
  });

  it('400s when a stated circuitType contradicts the signal count', async () => {
    const { service } = await makeService(null, ROOT);

    await expect(service.verify(dto({ circuitType: 'transfer' }))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('400s a signal count no circuit produces', async () => {
    const { service } = await makeService(null, ROOT);

    await expect(service.verify(dto({ publicSignals: ['1', '2'] }))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('asks the contract too when onChain is requested', async () => {
    const { service, verifyOnChain } = await makeService(null, ROOT);

    const result = await service.verify(dto({ onChain: true }));

    expect(verifyOnChain).toHaveBeenCalledWith('ownership', PROOF, expect.any(Array));
    expect(result.checks.onChain).toBe(true);
  });

  it('surfaces a contract rejection with the contract reason (D33)', async () => {
    const { service, verifyOnChain } = await makeService(null, ROOT);
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
    const { service } = await makeService(null, ROOT);

    await expect(service.verify(dto())).rejects.toThrow(ServiceUnavailableException);
    await expect(service.verify(dto())).rejects.not.toThrow(UnprocessableEntityException);
  });

  it('rejects a proof whose owner is frozen by a pending procedure (D79)', async () => {
    const { service, getFrozenOwners } = await makeService(null, ROOT);
    getFrozenOwners.mockResolvedValue(new Map([['1', BigInt(makeProperty().ownerCommitment!)]]));

    await expect(service.verify(dto())).rejects.toMatchObject({
      response: { reason: 'OwnerFrozen', valid: false, details: { propertyId: '1' } },
    });
  });

  it('reports RootMismatch before OwnerFrozen — the same order as the contract', async () => {
    const { service, getFrozenOwners } = await makeService(null, ROOT);
    getFrozenOwners.mockResolvedValue(new Map([['1', BigInt(makeProperty().ownerCommitment!)]]));

    await expect(
      service.verify(dto({ publicSignals: ownershipSignals(999n) })),
    ).rejects.toMatchObject({ response: { reason: 'RootMismatch' } });
  });

  it('accepts the next owner of a frozen plot — a different commitment', async () => {
    const { service, getFrozenOwners } = await makeService(null, ROOT);
    getFrozenOwners.mockResolvedValue(new Map([['1', 999n]]));

    expect((await service.verify(dto())).checks.ownerNotFrozen).toBe(true);
  });

  it('does not apply the freeze to a transfer proof, as verifyTransfer does not', async () => {
    const { service, getFrozenOwners } = await makeService(null, ROOT);
    const commitment = makeProperty().ownerCommitment!;
    getFrozenOwners.mockResolvedValue(new Map([['1', BigInt(commitment)]]));
    const transfer = [
      ROOT.toString(),
      '6',
      '1',
      commitment,
      '7',
      nowUnixTimestamp().toString(),
      '0',
    ];

    const result = await service.verify(dto({ publicSignals: transfer }));

    expect(result.checks.ownerNotFrozen).toBeNull();
    expect(getFrozenOwners).not.toHaveBeenCalled();
  });
});
