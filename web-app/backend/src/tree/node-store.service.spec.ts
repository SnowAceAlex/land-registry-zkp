import { Prisma } from '@prisma/client';
import { nodeKey } from '@land-registry/blockchain/shared';

import { NodeStoreService, WRITE_CHUNK_SIZE, chunk } from './node-store.service';

/**
 * Only the pure half is covered here — chunking and statement construction.
 * Anything that actually talks to Postgres is verified by the manual runbooks
 * and by the bench harness, which is the standing rule for this package: a unit
 * test with a mocked database proves the mock behaves, not the query.
 *
 * What IS worth pinning here: the number of statements a write produces (a
 * regression to one-statement-per-row is exactly the bug D72 exists to remove)
 * and the quoting of `index`, which is a PostgreSQL keyword and fails only at
 * runtime.
 */
function stubPrisma() {
  const calls: Prisma.Sql[] = [];
  return {
    calls,
    client: {
      $executeRaw: (sql: Prisma.Sql) => {
        calls.push(sql);
        return sql as unknown as Prisma.PrismaPromise<number>;
      },
    },
  };
}

function service() {
  const stub = stubPrisma();
  // TreeService is only reached by `bootstrap()`, which this spec never calls —
  // it needs a live database, so it is covered by the runbook and the harness.
  return { stub, svc: new NodeStoreService(stub.client as never, undefined as never) };
}

describe('chunk', () => {
  it('splits into full chunks plus a remainder', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns nothing for an empty list — no empty statement is ever built', () => {
    expect(chunk([], 10)).toEqual([]);
  });

  it('keeps a list shorter than the chunk size in one piece', () => {
    expect(chunk([1, 2], 10)).toEqual([[1, 2]]);
  });
});

describe('NodeStoreService.applyStatements', () => {
  it('writes nothing when the overlay is empty', () => {
    const { svc } = service();
    expect(svc.applyStatements({ root: 0n, touched: new Map(), removed: [] })).toHaveLength(0);
  });

  it('emits one upsert statement per chunk of touched nodes', () => {
    const { svc } = service();
    const touched = new Map<string, bigint>();
    for (let i = 0; i < WRITE_CHUNK_SIZE + 1; i++) touched.set(nodeKey(0, i), BigInt(i + 1));

    expect(svc.applyStatements({ root: 1n, touched, removed: [] })).toHaveLength(2);
  });

  it('emits one delete statement per chunk of removed nodes', () => {
    const { svc } = service();
    const removed = Array.from({ length: WRITE_CHUNK_SIZE + 1 }, (_, i) => nodeKey(1, i));

    expect(svc.applyStatements({ root: 1n, touched: new Map(), removed })).toHaveLength(2);
  });

  it('deletes before inserting, so ordering never depends on overlay contents', () => {
    const { stub, svc } = service();
    svc.applyStatements({
      root: 1n,
      touched: new Map([[nodeKey(0, 9), 42n]]),
      removed: [nodeKey(0, 8)],
    });

    const sql = stub.calls.map((call) => call.strings.join(''));
    expect(sql[0]).toContain('DELETE');
    expect(sql[1]).toContain('INSERT');
  });

  it('quotes the index column — it is a PostgreSQL keyword', () => {
    const { stub, svc } = service();
    svc.applyStatements({
      root: 1n,
      touched: new Map([[nodeKey(3, 4), 5n]]),
      removed: [nodeKey(2, 1)],
    });

    for (const call of stub.calls) {
      expect(call.strings.join('')).toContain('"index"');
    }
  });

  it('stores hashes as decimal strings, matching every other hash column', () => {
    const { stub, svc } = service();
    svc.applyStatements({ root: 1n, touched: new Map([[nodeKey(3, 4), 12345n]]), removed: [] });

    expect(stub.calls[0].values).toContain('12345');
  });

  it('carries each node coordinate into the statement as a parameter', () => {
    const { stub, svc } = service();
    svc.applyStatements({ root: 1n, touched: new Map([[nodeKey(7, 131), 9n]]), removed: [] });

    // height and index go through as bound parameters, not string interpolation
    expect(stub.calls[0].values).toContain(7);
    expect(stub.calls[0].values).toContain(131);
  });

  it('upserts rather than inserts — a node that already exists must be overwritten', () => {
    const { stub, svc } = service();
    svc.applyStatements({ root: 1n, touched: new Map([[nodeKey(1, 2), 3n]]), removed: [] });

    expect(stub.calls[0].strings.join('')).toContain('ON CONFLICT');
  });
});
