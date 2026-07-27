// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title RootRegistry
 * @notice Stores Merkle roots of the Land Use Rights (LUR) registry on-chain.
 *         Authorized state authorities publish new roots; proofs are verified
 *         against the stored root either off-chain (snarkjs) or on-chain via
 *         LandRegistryVerifier (D12). Merkle inclusion itself is proven INSIDE
 *         the ZK circuits, so this contract deliberately has no Merkle-path
 *         verification function (D11).
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

    /// @notice The latest published Merkle root of the LUR dataset — the only
    ///         root proofs are verified against (D29 default).
    bytes32 public latestRoot;

    /// @notice Timestamp of the last root update.
    uint256 public lastUpdatedAt;

    /// @notice Sequential version counter incremented on each root publish.
    ///         Version 0 means "no root published yet".
    uint256 public rootVersion;

    /// @notice Full root history by version, starting at 1 (D29). Old roots are
    ///         never deleted — they merely stop being `latestRoot`. Issued
    ///         bundles carry their `rootVersion` so a stale Merkle proof can be
    ///         detected against this history.
    mapping(uint256 => bytes32) public rootHistory;

    /// @notice Identity anchor per authority (D30): keccak256 of the X.509
    ///         Subject "O" (organization name), set atomically with the
    ///         STATE_AUTHORITY_ROLE grant in registerAuthority(). The contract
    ///         only STORES this anchor — X.509 chain + ethereumAccountSignature
    ///         verification happens off-chain in the verifier portal (Phase 9):
    ///         RSA-2048 / ECDSA P-256 are not secp256k1 and are far too costly
    ///         to verify on-chain. Anchors are never cleared, even if the role
    ///         is later revoked; off-chain verifiers must also check hasRole().
    mapping(address => bytes32) public authorityInstitute;

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

    event AuthorityRegistered(address indexed account, bytes32 instituteHash);

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    /// @notice publishRoot(0x0) — the zero root is the "nothing published" sentinel.
    error ZeroRoot();
    /// @notice publishRoot() with the root that is already latest — no-op guard.
    error DuplicateRoot(bytes32 root);
    /// @notice registerAuthority() with an empty institute hash.
    error ZeroInstituteHash();

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /**
     * @param admin Address that receives DEFAULT_ADMIN_ROLE.
     *              The admin registers authority accounts via registerAuthority().
     */
    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // -------------------------------------------------------------------------
    // Core Functions
    // -------------------------------------------------------------------------

    /**
     * @notice Publish a new Merkle root of the LUR registry.
     * @dev Only callable by accounts with STATE_AUTHORITY_ROLE.
     * @param newRoot The new Poseidon Merkle root (a BN254 field element, so it
     *                always fits in bytes32).
     */
    function publishRoot(bytes32 newRoot) external onlyRole(STATE_AUTHORITY_ROLE) {
        if (newRoot == bytes32(0)) revert ZeroRoot();
        if (newRoot == latestRoot) revert DuplicateRoot(newRoot);

        bytes32 previousRoot = latestRoot;
        rootVersion += 1;
        rootHistory[rootVersion] = newRoot;
        latestRoot = newRoot;
        lastUpdatedAt = block.timestamp;

        emit RootPublished(newRoot, previousRoot, rootVersion, msg.sender, block.timestamp);
    }

    /**
     * @notice Grant STATE_AUTHORITY_ROLE to an account and anchor its
     *         institutional identity in the same transaction (D30).
     * @param account       The authority's Ethereum account.
     * @param instituteHash keccak256(bytes(organizationName)) where
     *                      organizationName is the X.509 Subject "O" field of
     *                      the authority's certificate.
     */
    function registerAuthority(
        address account,
        bytes32 instituteHash
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (instituteHash == bytes32(0)) revert ZeroInstituteHash();

        _grantRole(STATE_AUTHORITY_ROLE, account);
        authorityInstitute[account] = instituteHash;

        emit AuthorityRegistered(account, instituteHash);
    }
}
