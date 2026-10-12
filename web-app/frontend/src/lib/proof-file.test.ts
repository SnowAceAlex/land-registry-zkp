import { describe, expect, it } from 'vitest';

import { ProofFileError, assertProofPackage, parseProofFile } from './proof-file';

/** A well-formed snarkjs proof: pi_a/pi_c are 3 coordinates, pi_b is 3 pairs. */
function proof() {
  return {
    pi_a: ['1', '2', '1'],
    pi_b: [
      ['3', '4'],
      ['5', '6'],
      ['1', '0'],
    ],
    pi_c: ['7', '8', '1'],
    protocol: 'groth16',
    curve: 'bn128',
  };
}

const signals = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1));

function body(overrides: Record<string, unknown> = {}) {
  return { circuitType: 'ownership', proof: proof(), publicSignals: signals(4), ...overrides };
}

const STAPLE = { expiresAt: '1790000600', signature: '0x' + '1b'.repeat(65) };

describe('parseProofFile / assertProofPackage — status attestation (D82)', () => {
  it('keeps a well-formed attestation on an ownership proof', () => {
    expect(assertProofPackage(body({ attestation: STAPLE })).attestation).toEqual(STAPLE);
  });

  it('accepts a file without one — the pipeline, not the parser, rejects it', () => {
    expect(assertProofPackage(body()).attestation).toBeUndefined();
  });

  it('refuses a malformed attestation as a shape error', () => {
    for (const attestation of [
      { expiresAt: 'soon', signature: STAPLE.signature },
      { expiresAt: STAPLE.expiresAt, signature: '0x1234' },
      'yes',
    ]) {
      expect(() => assertProofPackage(body({ attestation }))).toThrow(ProofFileError);
    }
  });

  it('ignores an attestation on a transfer proof', () => {
    const transfer = body({
      circuitType: 'transfer',
      publicSignals: signals(7),
      attestation: STAPLE,
    });
    expect(assertProofPackage(transfer).attestation).toBeUndefined();
  });
});

describe('parseProofFile / assertProofPackage', () => {
  // proof:bodies and transfer:smoke write exactly this shape, `onChain` and all.
  it('accepts the verify body proof:bodies writes, extra keys included', () => {
    const pkg = parseProofFile(JSON.stringify({ ...body(), onChain: false }));

    expect(pkg.circuitType).toBe('ownership');
    expect(pkg.publicSignals).toEqual(signals(4));
    expect(pkg.proof.pi_b[0]).toEqual(['3', '4']);
    // Only the three fields of a ProofPackage survive; `onChain` is not one.
    expect(Object.keys(pkg).sort()).toEqual(['circuitType', 'proof', 'publicSignals']);
  });

  it('infers the circuit from the signal count when the file omits it', () => {
    expect(parseProofFile(JSON.stringify(body({ circuitType: undefined }))).circuitType).toBe(
      'ownership',
    );
    expect(
      parseProofFile(JSON.stringify({ proof: proof(), publicSignals: signals(5) })).circuitType,
    ).toBe('mortgage');
    expect(
      parseProofFile(JSON.stringify({ proof: proof(), publicSignals: signals(7) })).circuitType,
    ).toBe('transfer');
  });

  it('rejects a signal count no circuit produces, listing the ones that exist', () => {
    const call = () =>
      parseProofFile(JSON.stringify({ proof: proof(), publicSignals: signals(6) }));

    expect(call).toThrow(ProofFileError);
    expect(call).toThrow(/6 public signals match no circuit/);
    // The counts are printed from PUBLIC_SIGNAL_ORDER, not hard-coded here.
    expect(call).toThrow(/4 \(ownership\)/);
    expect(call).toThrow(/7 \(transfer\)/);
    expect(codeOf(call)).toBe('unknown-circuit');
  });

  // An edited file must be refused, not silently reinterpreted: the declared
  // type is what a person reads, the count is what the vkey is shaped by.
  it('rejects a declared type that contradicts the signal count', () => {
    const call = () => parseProofFile(JSON.stringify(body({ circuitType: 'mortgage' })));

    expect(call).toThrow(/says circuitType "mortgage" but carries 4/);
    expect(codeOf(call)).toBe('circuit-mismatch');
  });

  it('rejects text that is not JSON', () => {
    expect(codeOf(() => parseProofFile('not json'))).toBe('invalid-json');
    expect(codeOf(() => parseProofFile(''))).toBe('invalid-json');
  });

  it('rejects a JSON value that is not an object', () => {
    expect(codeOf(() => parseProofFile('[]'))).toBe('invalid-shape');
    expect(codeOf(() => parseProofFile('42'))).toBe('invalid-shape');
    expect(codeOf(() => parseProofFile('null'))).toBe('invalid-shape');
  });

  it('rejects a truncated or malformed proof', () => {
    const truncatedPiB = {
      ...proof(),
      pi_b: [
        ['3', '4'],
        ['5', '6'],
      ],
    };
    expect(codeOf(() => assertProofPackage(body({ proof: truncatedPiB })))).toBe('invalid-shape');

    const shortPiA = { ...proof(), pi_a: ['1', '2'] };
    expect(codeOf(() => assertProofPackage(body({ proof: shortPiA })))).toBe('invalid-shape');

    expect(codeOf(() => assertProofPackage(body({ proof: undefined })))).toBe('invalid-shape');
  });

  it('rejects field elements that are not decimal strings', () => {
    const hexPiA = { ...proof(), pi_a: ['0x01', '2', '1'] };
    expect(codeOf(() => assertProofPackage(body({ proof: hexPiA })))).toBe('invalid-shape');

    expect(codeOf(() => assertProofPackage(body({ publicSignals: ['1', 2, '3', '4'] })))).toBe(
      'invalid-shape',
    );
    expect(codeOf(() => assertProofPackage(body({ publicSignals: [] })))).toBe('invalid-shape');
    expect(codeOf(() => assertProofPackage(body({ publicSignals: 'nope' })))).toBe('invalid-shape');
  });

  it('agrees with parseProofFile on the same value', () => {
    const value = body();
    expect(assertProofPackage(value)).toEqual(parseProofFile(JSON.stringify(value)));
  });
});

function codeOf(call: () => unknown): string | undefined {
  try {
    call();
    return undefined;
  } catch (error) {
    return error instanceof ProofFileError ? error.code : `not-a-ProofFileError: ${String(error)}`;
  }
}
