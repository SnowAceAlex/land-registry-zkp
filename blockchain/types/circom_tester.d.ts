/**
 * circom_tester ships no TypeScript types. Minimal ambient declaration covering
 * only what the circuit tests use (same approach as shared/circomlibjs.d.ts).
 *
 * Lives in types/ rather than test/ so Hardhat's mocha glob (test/**\/*.ts)
 * doesn't try to load a .d.ts as a test file.
 */
declare module 'circom_tester/wasm/tester' {
  /** A witness is the flat signal vector produced by the wasm calculator. */
  export type Witness = bigint[];

  export interface WasmTesterOptions {
    /** Extra `-l` include paths passed to circom (needed for circomlib). */
    include?: string | string[];
    /** Compile output dir. Defaults to a temp dir cleaned up on exit. */
    output?: string;
    /** Set false to reuse a previous build in `output`. Default true. */
    recompile?: boolean;
    /**
     * When the .circom file has no `component main`, circom_tester generates
     * one from these — lets us test a bare template (e.g. MerkleProof(20))
     * without committing a wrapper circuit just for tests.
     */
    templateName?: string;
    templateParams?: (string | number)[];
    templatePublicSignals?: string[];
  }

  export interface WasmTester {
    calculateWitness(
      input: Record<string, unknown>,
      sanityCheck?: boolean,
    ): Promise<Witness>;
    /** Throws if any R1CS constraint is unsatisfied by the witness. */
    checkConstraints(witness: Witness): Promise<void>;
    /** Throws if a named output signal doesn't equal the expected value. */
    assertOut(witness: Witness, expected: Record<string, unknown>): Promise<void>;
    loadSymbols(): Promise<void>;
    loadConstraints(): Promise<void>;
    /** Number of R1CS constraints — populated by loadConstraints(). */
    constraints?: unknown[];
  }

  export default function wasm_tester(
    circomInput: string,
    options?: WasmTesterOptions,
  ): Promise<WasmTester>;
}
