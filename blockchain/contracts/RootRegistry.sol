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
 *  - STATE_AUTHORITY_ROLE: can call publishRoot*()
 *  - ATTESTER_ROLE: signs status attestations off-chain (D82); writes nothing here
 */
contract RootRegistry is AccessControl {
    // -------------------------------------------------------------------------
    // Roles
    // -------------------------------------------------------------------------

    /// @notice Role granted to state authority accounts that can publish new Merkle roots.
    bytes32 public constant STATE_AUTHORITY_ROLE = keccak256("STATE_AUTHORITY_ROLE");

    /// @notice D82: the backend key whose EIP-712 status attestations LandRegistryVerifier
    ///         accepts. Granted by the admin via grantRole; it cannot publish roots.
    bytes32 public constant ATTESTER_ROLE = keccak256("ATTESTER_ROLE");

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

    /// @notice Reason codes for a revocation (D45). 0 is reserved as "unset".
    /// 1 = state reclamation decision, 2 = issued in error, 3 = dispute / court
    /// order, 4 = expired without renewal, 5 = other.
    uint8 public constant MIN_REASON_CODE = 1;
    uint8 public constant MAX_REASON_CODE = 5;

    struct Revocation {
        uint8 reasonCode;
        bytes32 detailHash;
        uint256 rootVersion;
        uint64 revokedAt;
    }

    /// @notice propertyId => revocation entry. A zero reasonCode means "not revoked".
    mapping(uint256 => Revocation) public revocations;

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

    event PropertyRevoked(
        uint256 indexed propertyId,
        uint8 reasonCode,
        bytes32 detailHash,
        uint256 rootVersion
    );

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    /// @notice publishRoot(0x0) — the zero root is the "nothing published" sentinel.
    error ZeroRoot();
    /// @notice publishRoot() with the root that is already latest — no-op guard.
    error DuplicateRoot(bytes32 root);
    /// @notice registerAuthority() with an empty institute hash.
    error ZeroInstituteHash();
    /// @notice registerAuthority() for the zero address — nobody can ever sign as it.
    error ZeroAuthorityAccount();
    /// @notice publishRootWithRevocations() with propertyIds/reasonCodes/detailHashes
    ///         not all the same length.
    error RevocationArrayLengthMismatch();
    /// @notice publishRootWithRevocations() with a reasonCode outside
    ///         MIN_REASON_CODE..MAX_REASON_CODE.
    error InvalidReasonCode(uint8 reasonCode);
    /// @notice publishRootWithRevocations() for a propertyId already revoked —
    ///         also catches a duplicate propertyId within the same call.
    error AlreadyRevoked(uint256 propertyId);

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
        _publishRoot(newRoot);
    }

    /**
     * @notice Publish a new root and record revocations in the same transaction (D45).
     * @dev The revocation list is for public auditability. Enforcement is already
     *      absolute without it: a revoked property's leaf is absent from `newRoot`,
     *      so no Merkle path to it exists and the circuits cannot produce a proof.
     * @param propertyIds   Properties revoked by this publish. May be empty.
     * @param reasonCodes   One code per property, in MIN_REASON_CODE..MAX_REASON_CODE.
     * @param detailHashes  keccak256 of the free-text reason, stored off-chain.
     */
    function publishRootWithRevocations(
        bytes32 newRoot,
        uint256[] calldata propertyIds,
        uint8[] calldata reasonCodes,
        bytes32[] calldata detailHashes
    ) external onlyRole(STATE_AUTHORITY_ROLE) {
        if (propertyIds.length != reasonCodes.length || propertyIds.length != detailHashes.length) {
            revert RevocationArrayLengthMismatch();
        }

        _publishRoot(newRoot);

        for (uint256 i = 0; i < propertyIds.length; i++) {
            uint8 code = reasonCodes[i];
            if (code < MIN_REASON_CODE || code > MAX_REASON_CODE) revert InvalidReasonCode(code);
            // Also catches a duplicate propertyId within this same call, since
            // the first iteration has already written the entry.
            if (revocations[propertyIds[i]].reasonCode != 0) revert AlreadyRevoked(propertyIds[i]);

            revocations[propertyIds[i]] = Revocation({
                reasonCode: code,
                detailHash: detailHashes[i],
                rootVersion: rootVersion,
                revokedAt: uint64(block.timestamp)
            });

            emit PropertyRevoked(propertyIds[i], code, detailHashes[i], rootVersion);
        }
    }

    function _publishRoot(bytes32 newRoot) private {
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
        // Recoverable (the admin can simply call again with the right account),
        // but a role granted to address(0) is inert and silently leaves the
        // registry with nobody able to publish — fail loudly instead.
        if (account == address(0)) revert ZeroAuthorityAccount();
        if (instituteHash == bytes32(0)) revert ZeroInstituteHash();

        _grantRole(STATE_AUTHORITY_ROLE, account);
        authorityInstitute[account] = instituteHash;

        emit AuthorityRegistered(account, instituteHash);
    }
}
