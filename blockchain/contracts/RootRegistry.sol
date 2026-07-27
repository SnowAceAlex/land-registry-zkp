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

    // TODO (D30, Phase 4): anchor issuer identity on-chain to close the
    //   "is this address really the state authority?" gap. Add:
    //     mapping(address => bytes32) public authorityInstitute;
    //   Set authorityInstitute[account] = keccak256(bytes(orgName)) at the moment
    //   STATE_AUTHORITY_ROLE is granted (orgName = X.509 Subject "O"). Keep it a
    //   mapping, NOT a single immutable — the system anchors multiple authorities
    //   (e.g. one Sở TN&MT per province). The contract only STORES this anchor;
    //   X.509 chain + ethereumAccountSignature verification stays OFF-CHAIN in the
    //   verifier portal (Phase 9) — RSA-2048 / ECDSA P-256 != secp256k1, so on-chain
    //   verification is far too costly. See CODING_ROADMAP.md §0 (D30) + §3.

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
     *
     * TODO (D11, Phase 4): DELETE this Merkle-path-only function (and this comment)
     *      entirely. Merkle inclusion is already proven INSIDE the ZK circuits;
     *      a separate on-chain path check is redundant and wastes gas. It survives
     *      here only as a leftover stub — the description below predates D11 and is
     *      no longer the intended design. See CODING_ROADMAP.md §0 (D11) + §3.
     *
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
