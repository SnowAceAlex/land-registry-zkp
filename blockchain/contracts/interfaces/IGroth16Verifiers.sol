// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * Minimal interfaces for the snarkjs-generated Groth16 verifier contracts
 * (contracts/verifiers/Groth16Verifier{Ownership,Mortgage,Transfer}.sol —
 * auto-synced from circuits/build/, gitignored).
 *
 * The public-input array length is baked into each generated verifier
 * (4 / 5 / 7 — see PUBLIC_SIGNAL_ORDER in shared/circuitInputs.ts, D21),
 * so the three verifyProof signatures differ and need one interface each.
 *
 * LandRegistryVerifier depends only on these interfaces, keeping the
 * hand-written contracts compilable on a checkout where the generated
 * verifiers have not been produced yet (run `circuits:setup` to get them).
 */

interface IOwnershipVerifier {
    function verifyProof(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint[4] calldata _pubSignals
    ) external view returns (bool);
}

interface IMortgageVerifier {
    function verifyProof(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint[5] calldata _pubSignals
    ) external view returns (bool);
}

interface ITransferVerifier {
    function verifyProof(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint[7] calldata _pubSignals
    ) external view returns (bool);
}
