/**
 * circomlibjs ships no TypeScript types. Minimal ambient declaration covering
 * only what this project uses (buildPoseidon + the poseidon callable/F field).
 */
declare module 'circomlibjs' {
  export interface PoseidonField {
    toString(value: unknown, radix?: number): string;
  }

  export interface Poseidon {
    (inputs: (bigint | number | string)[]): unknown;
    F: PoseidonField;
  }

  export function buildPoseidon(): Promise<Poseidon>;
}
