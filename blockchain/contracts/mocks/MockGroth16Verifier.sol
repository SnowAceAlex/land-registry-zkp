// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MockGroth16Verifier
 * @notice Test-only stand-in for the three generated Groth16 verifiers. One
 *         contract implements all three verifyProof signatures (the uint[4] /
 *         uint[5] / uint[7] public-input arrays make them distinct overloads),
 *         returning a settable result — so LandRegistryVerifier's dispatcher
 *         logic (root + timestamp checks, typed errors) is testable on a fresh
 *         checkout without trusted-setup artifacts or real proofs.
 */
contract MockGroth16Verifier {
    bool public result = true;

    function setResult(bool value) external {
        result = value;
    }

    function verifyProof(
        uint[2] calldata,
        uint[2][2] calldata,
        uint[2] calldata,
        uint[4] calldata
    ) external view returns (bool) {
        return result;
    }

    function verifyProof(
        uint[2] calldata,
        uint[2][2] calldata,
        uint[2] calldata,
        uint[5] calldata
    ) external view returns (bool) {
        return result;
    }

    function verifyProof(
        uint[2] calldata,
        uint[2][2] calldata,
        uint[2] calldata,
        uint[7] calldata
    ) external view returns (bool) {
        return result;
    }
}
