// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title RootRegistry
 * @notice Stores Merkle roots of the Land Use Rights (LUR) registry on-chain.
 *         Authorized state authorities publish new roots; anyone can verify proofs
 *         off-chain by comparing against the stored root.
 *
 * Access Control:
 *  - DEFAULT_ADMIN_ROLE (OZ built-in): can grant / revoke roles
 *  - STATE_AUTHORITY_ROLE: can call publishRoot()
 */
contract RootRegistry is AccessControl {
    // -------------------------------------------------------------------------
    // Roles
    // -------------------------------------------------------------------------

    /// @notice Role granted to state authority accounts that can publish new Merkle roots.
    bytes32 public constant STATE_AUTHORITY_ROLE = keccak256("STATE_AUTHORITY_ROLE");

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// @notice The latest published Merkle root of the LUR dataset.
    bytes32 public latestRoot;

    /// @notice Timestamp of the last root update.
    uint256 public lastUpdatedAt;

    /// @notice Sequential version counter incremented on each root publish.
    uint256 public rootVersion;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event RootPublished(
        bytes32 indexed newRoot,
        bytes32 indexed previousRoot,
        uint256 version,
        address publishedBy,
        uint256 timestamp
    );

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /**
     * @param admin Address that receives DEFAULT_ADMIN_ROLE.
     *              The admin can grant STATE_AUTHORITY_ROLE to authority accounts.
     */
    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // -------------------------------------------------------------------------
    // Core Functions (stub — TODO: implement)
    // -------------------------------------------------------------------------

    /**
     * @notice Publish a new Merkle root of the LUR registry.
     * @dev Only callable by accounts with STATE_AUTHORITY_ROLE.
     *
     * TODO:
     *  1. Validate that newRoot != bytes32(0)
     *  2. Validate that newRoot != latestRoot (no-op guard)
     *  3. Store newRoot as latestRoot
     *  4. Increment rootVersion
     *  5. Update lastUpdatedAt to block.timestamp
     *  6. Emit RootPublished event
     *
     * @param newRoot The new Poseidon Merkle root to publish.
     */
    function publishRoot(bytes32 newRoot) external onlyRole(STATE_AUTHORITY_ROLE) {
        // TODO: implement
    }

    /**
     * @notice Verify that a given leaf is included in the latest published root.
     * @dev This is an on-chain verification helper. The heavy ZKP verification
     *      (Groth16) will be done by a generated snarkjs Verifier contract placed
     *      in contracts/verifiers/. This function handles simple Merkle path checks.
     *
     * TODO:
     *  1. Accept a Merkle proof (sibling hashes + path indices)
     *  2. Recompute the root from the leaf + proof path
     *  3. Compare recomputed root against latestRoot
     *  4. Return true if they match, false otherwise
     *
     * NOTE: For Groth16 ZKP verification, deploy the auto-generated Verifier.sol
     *       from snarkjs into contracts/verifiers/ and call it from here.
     *
     * @param leaf        The leaf hash (Poseidon hash of the LUR record)
     * @param proof       Array of sibling hashes along the Merkle path
     * @param pathIndices Array of 0/1 values indicating left/right at each level
     * @return isValid    True if the leaf is in the current Merkle root
     */
    function verifyProof(
        bytes32 leaf,
        bytes32[] calldata proof,
        uint256[] calldata pathIndices
    ) external view returns (bool isValid) {
        // TODO: implement Merkle path verification
        // Pseudocode:
        //   bytes32 computed = leaf;
        //   for (uint i = 0; i < proof.length; i++) {
        //     if (pathIndices[i] == 0) computed = hash(computed, proof[i]);
        //     else computed = hash(proof[i], computed);
        //   }
        //   return computed == latestRoot;
    }
}
