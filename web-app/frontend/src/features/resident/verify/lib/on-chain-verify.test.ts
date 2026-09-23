import { describe, expect, it } from 'vitest';

import { decodeVerifierRevert } from './on-chain-verify';

/** A viem-shaped error: the decoded revert sits `depth` levels down `cause`. */
function nested(errorName: string, depth: number, args?: readonly unknown[]): Error {
  const inner = Object.assign(new Error(`reverted with ${errorName}`), {
    data: { errorName, args },
  });
  let error: Error = inner;
  for (let i = 0; i < depth; i++) {
    error = Object.assign(new Error('ContractFunctionExecutionError'), { cause: error });
  }
  return error;
}

describe('decodeVerifierRevert (D33)', () => {
  it('finds the error name several levels down the cause chain', () => {
    for (const depth of [0, 1, 3]) {
      expect(decodeVerifierRevert(nested('InvalidProof', depth)).name).toBe('InvalidProof');
    }
  });

  it('maps all four of the contract’s custom errors', () => {
    for (const name of [
      'InvalidProof',
      'RootMismatch',
      'StaleTimestamp',
      'ZeroAddressDependency',
    ] as const) {
      expect(decodeVerifierRevert(nested(name, 2)).name).toBe(name);
    }
  });

  /**
   * RootMismatch(expected, actual) and StaleTimestamp(claimed, blockTime) are
   * the only place a verifier learns BY HOW MUCH, so the arguments travel.
   */
  it('carries the revert arguments through', () => {
    const decoded = decodeVerifierRevert(nested('RootMismatch', 1, ['0xaa', '0xbb']));

    expect(decoded.args).toEqual(['0xaa', '0xbb']);
  });

  /**
   * The distinction the whole pipeline rests on. Some public RPCs strip revert
   * data; a proof whose verdict could not be READ must not be reported invalid,
   * because that would defame a good proof.
   */
  it('returns Unknown for a plain error rather than inventing a rejection', () => {
    expect(decodeVerifierRevert(new Error('network request failed')).name).toBe('Unknown');
    expect(decodeVerifierRevert(undefined).name).toBe('Unknown');
    expect(decodeVerifierRevert('a string').name).toBe('Unknown');
  });

  it('ignores an error name the contract does not define', () => {
    // A different contract's revert reached us — that is not this verifier's
    // verdict, so it must not be reported as one.
    expect(decodeVerifierRevert(nested('SomeOtherError', 1).valueOf()).name).toBe('Unknown');
  });

  it('gives up rather than walking a cyclic cause chain forever', () => {
    const error = new Error('outer') as Error & { cause?: unknown };
    error.cause = error;

    expect(decodeVerifierRevert(error).name).toBe('Unknown');
  });

  it('keeps the original message for the detail line', () => {
    expect(decodeVerifierRevert(new Error('execution reverted')).message).toBe(
      'execution reverted',
    );
  });
});
