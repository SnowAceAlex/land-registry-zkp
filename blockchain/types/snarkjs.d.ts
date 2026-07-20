/**
 * snarkjs ships no TypeScript types. Minimal ambient declaration covering the
 * calls this project makes (same approach as shared/circomlibjs.d.ts).
 *
 * Phase 3 will widen this as the full trusted-setup pipeline lands; keep it to
 * what is actually used rather than transcribing the whole API surface.
 */
declare module 'snarkjs' {
  /** A logger shaped like console — snarkjs calls .info/.debug/.error on it. */
  export type SnarkjsLogger = Partial<Record<'debug' | 'info' | 'warn' | 'error', (...args: unknown[]) => void>>;

  export interface R1csInfo {
    nVars: number;
    nOutputs: number;
    nPubInputs: number;
    nPrvInputs: number;
    nLabels: number;
    nConstraints: number;
    prime: bigint;
  }

  export interface Groth16ProofJson {
    pi_a: [string, string, string];
    pi_b: [[string, string], [string, string], [string, string]];
    pi_c: [string, string, string];
    protocol: string;
    curve: string;
  }

  /** Opaque — only ever round-tripped to/from JSON and passed back to verify(). */
  export type VerificationKey = Record<string, unknown>;

  export namespace r1cs {
    function info(r1csPath: string, logger?: SnarkjsLogger): Promise<R1csInfo>;
  }

  export namespace zKey {
    function newZKey(
      r1csPath: string,
      ptauPath: string,
      zkeyPath: string,
      logger?: SnarkjsLogger,
    ): Promise<unknown>;

    function contribute(
      zkeyOldPath: string,
      zkeyNewPath: string,
      contributorName: string,
      entropy: string,
      logger?: SnarkjsLogger,
    ): Promise<unknown>;

    function exportVerificationKey(
      zkeyPath: string,
      logger?: SnarkjsLogger,
    ): Promise<VerificationKey>;

    function exportSolidityVerifier(
      zkeyPath: string,
      templates: { groth16: string },
      logger?: SnarkjsLogger,
    ): Promise<string>;
  }

  export namespace groth16 {
    function fullProve(
      input: Record<string, unknown>,
      wasmPath: string,
      zkeyPath: string,
      logger?: SnarkjsLogger,
    ): Promise<{ proof: Groth16ProofJson; publicSignals: string[] }>;

    function verify(
      vkey: VerificationKey,
      publicSignals: string[],
      proof: Groth16ProofJson,
      logger?: SnarkjsLogger,
    ): Promise<boolean>;
  }
}
