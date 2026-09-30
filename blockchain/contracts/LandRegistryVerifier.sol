// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RootRegistry} from "./RootRegistry.sol";
import {
    IOwnershipVerifier,
    IMortgageVerifier,
    ITransferVerifier
} from "./interfaces/IGroth16Verifiers.sol";

/**
 * @title LandRegistryVerifier
 * @notice On-chain verification entry point for the three LUR circuits (D12).
 *         Each verify function:
 *           1. runs the Groth16 pairing check on the matching generated verifier,
 *           2. requires the proof's Merkle root public signal to equal the
 *              registry's latestRoot (only the latest root is valid — D29),
 *           3. requires the proof's currentTimestamp public signal to be within
 *              TIMESTAMP_TOLERANCE_SECONDS of block.timestamp (D9/D26) — the
 *              timestamp is a prover-chosen public input, so without this check
 *              a proof generated back when an expired title was still valid
 *              verifies perfectly,
 *           4. (ownership and mortgage only) requires the proof's owner not to
 *              be frozen by a pending transfer or revocation (D79) — the check
 *              that closes the window between the counter and the change set.
 *         On success it returns true; on any failure it reverts with a typed
 *         error so callers can tell WHY a proof was rejected.
 *
 * Public-signal indexing (D21): the constants below mirror PUBLIC_SIGNAL_ORDER
 * in shared/circuitInputs.ts — the single TS-side source of truth, asserted by
 * the circuit tests. Solidity cannot import it, so the integration tests
 * cross-check these indices against PUBLIC_SIGNAL_ORDER positionally.
 *
 *   index | ownership       | mortgage                 | transfer
 *   ------+-----------------+--------------------------+-------------------------
 *     0   | merkleRoot      | merkleRoot               | oldMerkleRoot
 *     1   | propertyId      | propertyId               | newMerkleRoot
 *     2   | ownerCommitment | ownerCommitment          | propertyId
 *     3   | currentTimestamp| currentTimestamp         | oldOwnerCommitment
 *     4   | —               | minRequiredRemainingTerm | newOwnerCommitment
 *     5   | —               | —                        | currentTimestamp
 *     6   | —               | —                        | minRequiredRemainingTerm
 */
contract LandRegistryVerifier {
    // -------------------------------------------------------------------------
    // Configuration
    // -------------------------------------------------------------------------

    RootRegistry public immutable registry;
    IOwnershipVerifier public immutable ownershipVerifier;
    IMortgageVerifier public immutable mortgageVerifier;
    ITransferVerifier public immutable transferVerifier;

    /// @notice Max |currentTimestamp - block.timestamp|, in seconds. Mirrors
    ///         PROOF_TIMESTAMP_TOLERANCE_SECONDS (600n) in shared/datetime.ts —
    ///         Solidity cannot import TS, so the two constants are kept equal by
    ///         convention and cross-checked in the Hardhat tests (D26).
    uint256 public constant TIMESTAMP_TOLERANCE_SECONDS = 600;

    // Public-signal indices (D21) — see the table in the contract natspec.
    uint256 internal constant OWNERSHIP_ROOT_INDEX = 0;
    uint256 internal constant OWNERSHIP_TIMESTAMP_INDEX = 3;
    uint256 internal constant MORTGAGE_ROOT_INDEX = 0;
    uint256 internal constant MORTGAGE_TIMESTAMP_INDEX = 3;
    uint256 internal constant TRANSFER_OLD_ROOT_INDEX = 0;
    uint256 internal constant TRANSFER_TIMESTAMP_INDEX = 5;
    uint256 internal constant OWNERSHIP_PROPERTY_ID_INDEX = 1;
    uint256 internal constant OWNERSHIP_COMMITMENT_INDEX = 2;
    uint256 internal constant MORTGAGE_PROPERTY_ID_INDEX = 1;
    uint256 internal constant MORTGAGE_COMMITMENT_INDEX = 2;

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    /// @notice The Groth16 pairing check failed — the proof is cryptographically invalid.
    error InvalidProof();
    /// @notice The proof's root public signal is not the registry's latest root.
    error RootMismatch(bytes32 expected, bytes32 actual);
    /// @notice The proof's currentTimestamp is outside the tolerance window (replay guard).
    error StaleTimestamp(uint256 claimed, uint256 blockTime);
    /// @notice D79: the proof's owner is frozen by a transfer/revocation not yet published.
    error OwnerFrozen(uint256 propertyId);
    /// @notice A constructor dependency was the zero address.
    error ZeroAddressDependency();

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(
        RootRegistry _registry,
        IOwnershipVerifier _ownershipVerifier,
        IMortgageVerifier _mortgageVerifier,
        ITransferVerifier _transferVerifier
    ) {
        // These four are immutable: a zero address here cannot be corrected
        // afterwards, only redeployed around. Every verify* call would revert on
        // the call to a non-contract, with no hint as to which dependency was
        // wrong. Cheap one-time check for an otherwise unfixable deployment.
        if (
            address(_registry) == address(0) ||
            address(_ownershipVerifier) == address(0) ||
            address(_mortgageVerifier) == address(0) ||
            address(_transferVerifier) == address(0)
        ) {
            revert ZeroAddressDependency();
        }

        registry = _registry;
        ownershipVerifier = _ownershipVerifier;
        mortgageVerifier = _mortgageVerifier;
        transferVerifier = _transferVerifier;
    }

    // -------------------------------------------------------------------------
    // Verification
    // -------------------------------------------------------------------------

    /**
     * @notice Verify an ownership proof against the current registry state.
     * @return True on success; reverts with a typed error otherwise.
     */
    function verifyOwnership(
        uint[2] calldata a,
        uint[2][2] calldata b,
        uint[2] calldata c,
        uint[4] calldata pubSignals
    ) external view returns (bool) {
        if (!ownershipVerifier.verifyProof(a, b, c, pubSignals)) revert InvalidProof();
        _requireLatestRoot(pubSignals[OWNERSHIP_ROOT_INDEX]);
        _requireFreshTimestamp(pubSignals[OWNERSHIP_TIMESTAMP_INDEX]);
        _requireNotFrozen(
            pubSignals[OWNERSHIP_PROPERTY_ID_INDEX],
            pubSignals[OWNERSHIP_COMMITMENT_INDEX]
        );
        return true;
    }

    /**
     * @notice Verify a mortgage (clean-title + sufficient remaining term) proof.
     * @dev pubSignals[4] (minRequiredRemainingTerm) is not checked on-chain: it
     *      is the threshold the owner chose to prove (D16) — the bank reads it
     *      off the public signals and judges whether it meets their policy.
     * @return True on success; reverts with a typed error otherwise.
     */
    function verifyMortgage(
        uint[2] calldata a,
        uint[2][2] calldata b,
        uint[2] calldata c,
        uint[5] calldata pubSignals
    ) external view returns (bool) {
        if (!mortgageVerifier.verifyProof(a, b, c, pubSignals)) revert InvalidProof();
        _requireLatestRoot(pubSignals[MORTGAGE_ROOT_INDEX]);
        _requireFreshTimestamp(pubSignals[MORTGAGE_TIMESTAMP_INDEX]);
        _requireNotFrozen(
            pubSignals[MORTGAGE_PROPERTY_ID_INDEX],
            pubSignals[MORTGAGE_COMMITMENT_INDEX]
        );
        return true;
    }

    /**
     * @notice Verify a transfer proof against the CURRENT (pre-transfer) root.
     * @dev Only oldMerkleRoot (index 0) must equal latestRoot. newMerkleRoot
     *      (index 1) is deliberately NOT required to be published yet — this is
     *      the check the state authority runs BEFORE calling
     *      registry.publishRoot(newRoot) (two-step transfer flow, §3). Once the
     *      new root is published, the same proof no longer verifies here,
     *      because its oldMerkleRoot has stopped being latest.
     * @return True on success; reverts with a typed error otherwise.
     */
    function verifyTransfer(
        uint[2] calldata a,
        uint[2][2] calldata b,
        uint[2] calldata c,
        uint[7] calldata pubSignals
    ) external view returns (bool) {
        if (!transferVerifier.verifyProof(a, b, c, pubSignals)) revert InvalidProof();
        _requireLatestRoot(pubSignals[TRANSFER_OLD_ROOT_INDEX]);
        _requireFreshTimestamp(pubSignals[TRANSFER_TIMESTAMP_INDEX]);
        return true;
    }

    // -------------------------------------------------------------------------
    // Internal checks
    // -------------------------------------------------------------------------

    /// @dev Poseidon roots are BN254 field elements (< 2^254), so the uint256
    ///      public signal always round-trips safely through bytes32.
    function _requireLatestRoot(uint256 rootSignal) internal view {
        bytes32 latest = registry.latestRoot();
        if (bytes32(rootSignal) != latest) revert RootMismatch(latest, bytes32(rootSignal));
    }

    /// @dev Two-sided freshness check (D26): a future-dated timestamp is not
    ///      currently exploitable, but an open upper bound would silently
    ///      become a hole if a future circuit read the timestamp the other way.
    function _requireFreshTimestamp(uint256 claimed) internal view {
        uint256 drift = claimed > block.timestamp
            ? claimed - block.timestamp
            : block.timestamp - claimed;
        if (drift > TIMESTAMP_TOLERANCE_SECONDS) {
            revert StaleTimestamp(claimed, block.timestamp);
        }
    }

    /// @dev Last check (D79: owner frozen by a pending procedure). Not used by verifyTransfer —
    ///      approve() verifies a transfer after its plot is frozen.
    function _requireNotFrozen(uint256 propertyId, uint256 ownerCommitment) internal view {
        uint256 frozen = registry.frozenOwner(propertyId);
        if (frozen != 0 && frozen == ownerCommitment) revert OwnerFrozen(propertyId);
    }
}
