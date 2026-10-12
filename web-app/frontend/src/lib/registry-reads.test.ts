import { describe, expect, it } from 'vitest';

import { readIsAttester } from './registry-reads';

const REGISTRY = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const ACCOUNT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const ROLE = '0x' + 'ab'.repeat(32);

describe('readIsAttester (D82)', () => {
  it('asks hasRole with the ATTESTER_ROLE the contract itself names', async () => {
    const calls: { functionName: string; args?: unknown[] }[] = [];
    const client = {
      readContract: async (call: { functionName: string; args?: unknown[] }) => {
        calls.push(call);
        return call.functionName === 'ATTESTER_ROLE' ? ROLE : true;
      },
    } as never;

    await expect(readIsAttester(client, REGISTRY, ACCOUNT)).resolves.toBe(true);
    expect(calls.map((c) => c.functionName)).toEqual(['ATTESTER_ROLE', 'hasRole']);
    expect(calls[1].args).toEqual([ROLE, ACCOUNT]);
  });
});
