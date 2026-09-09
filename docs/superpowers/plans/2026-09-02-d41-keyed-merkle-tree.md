# D41 — Keyed Merkle Tree (leaf position bound to `propertyId`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it cryptographically impossible for a superseded leaf (a previous owner's record) to have a valid Merkle path to `latestRoot`, by binding a leaf's position in the tree to its `propertyId` and forcing every circuit to prove that binding.

**Architecture:** Today the tree assigns leaf indices by array position (D24), and `MerkleProof(20)` accepts any `pathIndices` the prover supplies. Nothing links a leaf to a position, so a tree containing _two_ leaves for one `propertyId` (old owner + new owner) verifies both. D41 makes the index a deterministic function of the record: `index === propertyId`. `common/merkleProof.circom` gains a required `expectedIndex` input and constrains `Σ pathIndices[i]·2^i === expectedIndex`; all three circuits pass `propertyId`. `shared/merkleTree.ts` becomes a genuine sparse-by-key tree (a `Map<index, hash>` per level) instead of a dense-prefix array. One slot holds one value, so after a transfer the old owner has no reachable path — not "hard", but unsatisfiable.

**Tech Stack:** Circom 2.2.3 (native Windows binary, `cargo install circom`), circomlib, snarkjs (Groth16), TypeScript, Hardhat + Mocha/Chai (blockchain), NestJS + Jest (backend), Prisma/Postgres.

## Global Constraints

- **Tree depth stays 20.** Do not change `TREE_DEPTH` in this plan. Raising it to 26 (~67M plots, national scale) is a follow-up decided _after_ Task 5 reports the new constraint counts.
- **`propertyId` must satisfy `0 ≤ propertyId ≤ 2^20 − 1` (1 048 575).** This is forced, not chosen: if the authority could assign positions freely it could assign two positions to one property, which is exactly the hole being closed. Depth 20 already capped the registry at ~1.05M leaves (D20), so capacity is unchanged.
- **`PUBLIC_SIGNAL_ORDER` must not change.** `expectedIndex` is wired _inside_ each circuit from the already-public `propertyId` signal. Consequence: `LandRegistryVerifier.sol` and `RootRegistry.sol` are **not modified by this plan**, and `shared/circuitInputs.ts` keeps its current function signatures.
- **The leaf field order (D4) must not change.** `hashRecord()` and `LeafHasher()` stay byte-for-byte semantically identical.
- **`shared/merkleTree.ts` remains the only place Merkle/Poseidon logic lives.** Do not add tree logic to backend or frontend.
- **`shared/index.ts` barrel must stay browser-safe** — no top-level `fs`/`node:*` imports introduced.
- Package manager is **pnpm**; run commands from the repo root unless a step says otherwise.
- Every circom invocation runs with cwd `blockchain/` and `-l node_modules` (pnpm does not hoist circomlib). The existing scripts already do this.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

---

## Background: the exact defect being fixed

`transfer.circom` proves two independent statements:

```
oldLeaf ─(oldSiblings, oldPathIndices)→ oldMerkleRoot   "old leaf was in the old tree"
newLeaf ─(newSiblings, newPathIndices)→ newMerkleRoot   "new leaf is in the new tree"
```

It does **not** prove the old leaf was removed from the new tree, and nothing constrains `newPathIndices` to equal `oldPathIndices`. A tree published with both `leaf(123, A)` at index 5 and `leaf(123, B)` at index 900 satisfies every constraint. Both A and B can then produce valid `ownership` proofs against `latestRoot`; A can sell the plot again.

Today this is prevented only at the application layer — `Property.propertyId @unique` in Prisma and the `duplicate propertyId` guard in `buildTree()` — i.e. by trusting the authority to run this software. That is precisely the trust the thesis claims to remove.

After D41 the property `index === propertyId` is enforced _inside the proof_: a leaf for property 123 can only be proven at slot 123, one slot holds one value, so at most one owner is provable at any published root.

**Not fixed by this plan** (stays a documented limitation): the transfer proof still requires both parties' secrets in a single witness (single-session assumption).

---

## File Structure

| File                                                                        | Responsibility after this change                                                                                                                                                                                          |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blockchain/shared/merkleTree.ts`                                           | **Modified.** Sparse-by-key tree: `levels[h]: Map<number, bigint>` of occupied nodes only; leaf index = `Number(propertyId)`; exports `MAX_PROPERTY_ID`. Drops the `leaves`/`layers` array fields (no external consumer). |
| `blockchain/circuits/common/merkleProof.circom`                             | **Modified.** New required `expectedIndex` input; constrains the path bits to encode it. Placing the constraint here (not in each circuit) makes it impossible for a circuit to forget it.                                |
| `blockchain/circuits/ownership.circom`                                      | **Modified.** One line: `merkle.expectedIndex <== propertyId;`                                                                                                                                                            |
| `blockchain/circuits/mortgage.circom`                                       | **Modified.** One line: `merkle.expectedIndex <== propertyId;`                                                                                                                                                            |
| `blockchain/circuits/transfer.circom`                                       | **Modified.** Two lines: both `oldMerkle` and `newMerkle` get `expectedIndex <== propertyId`, which makes `oldPathIndices === newPathIndices` an automatic consequence.                                                   |
| `blockchain/test/shared/merkleTree.test.ts`                                 | **Modified.** Adds placement, order-independence and range tests.                                                                                                                                                         |
| `blockchain/test/circuits/merkleProof.test.ts`                              | **Modified.** `toCircuitInput` takes `expectedIndex`; adds the wrong-index rejection test.                                                                                                                                |
| `blockchain/test/circuits/ownership.test.ts`                                | **Modified.** Adds the headline regression test: a leaf with a self-consistent path at a slot other than its `propertyId` cannot be proven.                                                                               |
| `blockchain/test/circuits/transfer.test.ts`                                 | **Modified.** Adds: a transfer whose new path targets a different slot is rejected.                                                                                                                                       |
| `web-app/backend/src/tree/tree.service.ts`                                  | **Modified.** Doc comment only: D24 superseded by D41; `sortByPropertyId` is retained for deterministic _list_ output, no longer load-bearing for the tree.                                                               |
| `web-app/backend/src/tree/tree.service.spec.ts`                             | **Modified.** The "different order ⇒ different root" test is inverted into "any order ⇒ same root (D41)".                                                                                                                 |
| `web-app/backend/src/import/import.service.ts`                              | **Modified.** Rejects `propertyId > MAX_PROPERTY_ID` at import with an explicit message.                                                                                                                                  |
| `web-app/backend/src/import/import.service.spec.ts`                         | **Modified.** Adds the out-of-range rejection case.                                                                                                                                                                       |
| `CODING_ROADMAP.md`                                                         | **Modified.** Adds D41 to §0; marks D24 superseded; updates §2.1.                                                                                                                                                         |
| `CLAUDE.md`                                                                 | **Modified.** Updates the `merkleTree.ts`, `circuits/`, and `tree/` descriptions.                                                                                                                                         |
| `Mẫu đăng ký đề tài LVTN - BuiCongVinh ITCSIU22165.docx` (in `~/Downloads`) | **Modified in Task 7.** Requirement 14 wording: the stale-leaf limitation is closed; only the single-session assumption remains.                                                                                          |

**Not touched:** `blockchain/contracts/**` (public signal layout unchanged), `shared/circuitInputs.ts`, `shared/types.ts`, `shared/receipt.ts`, backend `proof/`, `issuance/`, `transfers/`, `chain/`, `government/`.

---

### Task 1: Sparse-by-key tree in `shared/merkleTree.ts`

**Files:**

- Modify: `blockchain/shared/merkleTree.ts`
- Test: `blockchain/test/shared/merkleTree.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces:
  - `export const MAX_PROPERTY_ID: bigint` — `(1n << 20n) - 1n`.
  - `LURMerkleTree` becomes `{ depth: number; levels: Map<number, bigint>[]; zeroHashes: bigint[]; root: bigint; indexByPropertyId: Map<string, number> }`. The `leaves: bigint[]` and `layers: bigint[][]` fields are **removed** — verified as having no consumer outside this file.
  - `buildTree(records: LURRecord[]): Promise<LURMerkleTree>` — signature unchanged.
  - `generateMerkleProof(tree, record): Promise<MerkleProofData>` — signature unchanged; `pathIndices` now always encode `propertyId` LSB-first.
  - `verifyMerkleProof`, `getMerkleRoot`, `poseidonHash`, `hashRecord`, `TREE_DEPTH` — unchanged.

- [ ] **Step 1: Write the failing tests**

Add to the top of `blockchain/test/shared/merkleTree.test.ts` — extend the existing import from `../../shared/merkleTree` with `MAX_PROPERTY_ID`, then add this helper above the `describe` block:

```ts
/** Read pathIndices (LSB-first, as the circuit does) back into a leaf index. */
function indexFromPathIndices(pathIndices: number[]): bigint {
  let acc = 0n;
  for (let i = pathIndices.length - 1; i >= 0; i--) {
    acc = acc * 2n + BigInt(pathIndices[i]);
  }
  return acc;
}
```

Add these three tests inside the existing `describe('merkleTree (Phase 1)', ...)` block:

```ts
it('places each leaf at index = propertyId (D41)', async () => {
  const { records } = await generateMockRecords(12);
  const tree = await buildTree(records);

  for (const record of records) {
    const proof = await generateMerkleProof(tree, record);
    expect(indexFromPathIndices(proof.pathIndices)).to.equal(record.propertyId);
  }
});

it('produces the same root regardless of input order (D41 supersedes D24)', async () => {
  const { records } = await generateMockRecords(10);
  const reversed = [...records].reverse();

  const inOrder = await buildTree(records);
  const shuffled = await buildTree(reversed);

  expect(shuffled.root).to.equal(inOrder.root);
});

it('rejects a propertyId outside the addressable range (D41)', async () => {
  const { records } = await generateMockRecords(2);
  records[1] = { ...records[1], propertyId: MAX_PROPERTY_ID + 1n };

  let threw = false;
  try {
    await buildTree(records);
  } catch (e) {
    threw = true;
    expect((e as Error).message).to.match(/outside the addressable range/);
  }
  expect(threw).to.equal(true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter blockchain hardhat test test/shared/merkleTree.test.ts
```

Expected: FAIL. `MAX_PROPERTY_ID` is not exported (TypeScript compile error), and once that is added the placement/order tests fail because indices still follow array position.

- [ ] **Step 3: Rewrite the tree construction**

In `blockchain/shared/merkleTree.ts`, replace the `TREE_DEPTH` export block, the `LURMerkleTree` interface, `buildTree()` and `generateMerkleProof()` with the following. Leave `poseidonHash`, `hashRecord`, `getZeroHashes`, `getMerkleRoot` and `verifyMerkleProof` untouched.

```ts
export const TREE_DEPTH = 20;

/**
 * Largest addressable propertyId (D41). A leaf's position IS its propertyId, so
 * the tree can hold ids 0..2^TREE_DEPTH-1. Depth 20 already capped the registry
 * at ~1.05M leaves (D20), so this adds no capacity limit that did not exist.
 */
export const MAX_PROPERTY_ID = (1n << BigInt(TREE_DEPTH)) - 1n;
```

```ts
/**
 * A fixed-depth-20 sparse Merkle tree, keyed by propertyId (D41).
 *
 * Only occupied nodes are stored. `levels[h]` maps a node index at height h to
 * its hash; a missing entry means "empty subtree", answered by zeroHashes[h].
 * levels[0] holds the leaves, levels[TREE_DEPTH] holds at most the root.
 */
export interface LURMerkleTree {
  readonly depth: number;
  /** levels[h]: node index at height h -> hash. Occupied nodes only. */
  readonly levels: Map<number, bigint>[];
  readonly zeroHashes: bigint[];
  readonly root: bigint;
  /** propertyId (stringified) -> leaf index. Always Number(propertyId) (D41). */
  readonly indexByPropertyId: Map<string, number>;
}

/**
 * Build the registry tree. A record's leaf goes at index = its propertyId, so
 * the input order does not affect the result (this is what supersedes D24).
 *
 * ⚠️ D41 — why the position is a function of the record and not of the caller:
 * if the builder could choose positions, it could place two leaves for the same
 * propertyId (an old owner and a new one) in one tree, and both would produce
 * valid ownership proofs against the published root. Binding the position to
 * propertyId, and forcing the circuit to prove that binding, makes a stale leaf
 * unreachable: one slot holds one value.
 */
export async function buildTree(records: LURRecord[]): Promise<LURMerkleTree> {
  const zeroHashes = await getZeroHashes();

  const levels: Map<number, bigint>[] = [new Map<number, bigint>()];
  const indexByPropertyId = new Map<string, number>();

  for (const record of records) {
    if (record.propertyId < 0n || record.propertyId > MAX_PROPERTY_ID) {
      throw new Error(
        `buildTree: propertyId ${record.propertyId} is outside the addressable range ` +
          `0..${MAX_PROPERTY_ID} of a depth-${TREE_DEPTH} tree (D41)`,
      );
    }

    const key = record.propertyId.toString();
    // propertyId is documented as unique — fail fast instead of silently
    // overwriting the slot (which would drop one owner's leaf without a trace).
    if (indexByPropertyId.has(key)) {
      throw new Error(`buildTree: duplicate propertyId ${record.propertyId}`);
    }

    const index = Number(record.propertyId);
    indexByPropertyId.set(key, index);
    levels[0].set(index, await hashRecord(record));
  }

  for (let height = 0; height < TREE_DEPTH; height++) {
    const current = levels[height];
    const parents = new Map<number, bigint>();

    // Two siblings share one parent, so collect parent indices first rather
    // than hashing the same parent twice.
    const parentIndices = new Set<number>();
    for (const index of current.keys()) {
      parentIndices.add(index >> 1);
    }

    for (const parentIndex of parentIndices) {
      const left = current.get(parentIndex * 2) ?? zeroHashes[height];
      const right = current.get(parentIndex * 2 + 1) ?? zeroHashes[height];
      parents.set(parentIndex, await poseidonHash([left, right]));
    }

    levels.push(parents);
  }

  const root = levels[TREE_DEPTH].get(0) ?? zeroHashes[TREE_DEPTH];

  return { depth: TREE_DEPTH, levels, zeroHashes, root, indexByPropertyId };
}
```

```ts
/**
 * Generate a Merkle inclusion proof for a specific record.
 *
 * `pathIndices` is the binary expansion of the leaf index, LSB first — and by
 * D41 the leaf index is the propertyId, so the circuit can (and does) check
 * that these bits reconstruct the public propertyId signal.
 */
export async function generateMerkleProof(
  tree: LURMerkleTree,
  record: LURRecord,
): Promise<MerkleProofData> {
  const index = tree.indexByPropertyId.get(record.propertyId.toString());
  if (index === undefined) {
    throw new Error(`generateMerkleProof: propertyId ${record.propertyId} not found in tree`);
  }

  // Recompute the leaf and ensure it matches the tree. Guards against a caller
  // passing a record whose fields drifted from what the tree was built with —
  // otherwise they'd get a proof for a stale leaf that silently fails to match
  // the circuit-computed leaf downstream.
  const leaf = await hashRecord(record);
  if (leaf !== tree.levels[0].get(index)) {
    throw new Error(
      `generateMerkleProof: record hash does not match tree leaf for propertyId ${record.propertyId}`,
    );
  }

  const siblings: bigint[] = [];
  const pathIndices: number[] = [];

  let currentIndex = index;
  for (let height = 0; height < TREE_DEPTH; height++) {
    const isRightChild = (currentIndex & 1) === 1;
    pathIndices.push(isRightChild ? 1 : 0);

    const siblingIndex = currentIndex ^ 1;
    siblings.push(tree.levels[height].get(siblingIndex) ?? tree.zeroHashes[height]);

    currentIndex >>= 1;
  }

  return { leaf, siblings, pathIndices, root: tree.root };
}
```

Also update the file-header comment block: replace the "Fixed-depth-20 sparse tree (D20)" paragraph's closing sentence with a note that leaf position is keyed by `propertyId` per D41.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter blockchain hardhat test test/shared/merkleTree.test.ts
```

Expected: PASS, 11 passing (8 pre-existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add blockchain/shared/merkleTree.ts blockchain/test/shared/merkleTree.test.ts
git commit -m "feat(merkle): key leaf position to propertyId (D41)

Leaf index is now Number(propertyId) and the tree is stored sparsely as a
Map per level. Input order no longer affects the root, which supersedes the
D24 ordering rule.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Bind path indices to `expectedIndex` in `MerkleProof`

**Files:**

- Modify: `blockchain/circuits/common/merkleProof.circom`
- Test: `blockchain/test/circuits/merkleProof.test.ts`

**Interfaces:**

- Consumes: `buildTree` / `generateMerkleProof` from Task 1.
- Produces: `MerkleProof(levels)` gains a required input `expectedIndex`. Every instantiation must now wire it — Task 3 does that for the three top-level circuits.

- [ ] **Step 1: Update the test helper and write the failing test**

In `blockchain/test/circuits/merkleProof.test.ts`, change `toCircuitInput` to take the expected index:

```ts
/** MerkleProofData -> circom input object (circom wants decimal strings). */
function toCircuitInput(proof: MerkleProofData, expectedIndex: bigint) {
  return {
    leaf: proof.leaf.toString(),
    pathIndices: proof.pathIndices.map((i) => i.toString()),
    siblings: proof.siblings.map((s) => s.toString()),
    expectedIndex: expectedIndex.toString(),
  };
}
```

Update every existing call site in that file to pass the record's `propertyId`:

- `toCircuitInput(proof)` → `toCircuitInput(proof, records[3].propertyId)` (test: "recomputes the same root...")
- inside the per-leaf loop → `toCircuitInput(proof, record.propertyId)`
- single-record tree → `toCircuitInput(proof, records[0].propertyId)`
- tampered-sibling test → `toCircuitInput(proof, records[2].propertyId)`
- non-binary pathIndex test → `toCircuitInput(proof, records[0].propertyId)`

Then add this new test at the end of the `describe` block:

```ts
it('rejects a path whose indices do not encode expectedIndex (D41)', async () => {
  const { records } = await generateMockRecords(8);
  const tree = await buildTree(records);
  const proof = await generateMerkleProof(tree, records[3]);

  // A genuine path for this record, presented as if it belonged to the
  // neighbouring propertyId. This is the shape of the stale-leaf attack:
  // a real leaf sitting at a slot that is not its own.
  const mislabelled = toCircuitInput(proof, records[3].propertyId + 1n);

  let threw = false;
  try {
    await circuit.calculateWitness(mislabelled);
  } catch {
    threw = true;
  }
  expect(threw, 'pathIndices must be constrained to encode expectedIndex').to.equal(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter blockchain hardhat test test/circuits/merkleProof.test.ts
```

Expected: FAIL — circom errors that `expectedIndex` is not a signal of the template (the extra input is rejected), and the new test does not throw for the right reason.

- [ ] **Step 3: Add the constraint to the template**

In `blockchain/circuits/common/merkleProof.circom`, add the input declaration and the accumulator. The full template body becomes:

```circom
template MerkleProof(levels) {
    signal input leaf;
    signal input pathIndices[levels];
    signal input siblings[levels];
    // D41: the leaf index this path must correspond to. Callers pass the
    // record's propertyId, which pins one property to exactly one slot.
    signal input expectedIndex;
    signal output root;

    // levelHash[i] = the node on the path at height i; levelHash[0] is the leaf.
    signal levelHash[levels + 1];
    levelHash[0] <== leaf;

    component switchers[levels];
    component hashers[levels];

    // pathIndices read LSB-first is the binary expansion of the leaf index.
    var indexAcc = 0;
    var pow = 1;

    for (var i = 0; i < levels; i++) {
        // circomlib's Switcher is documented "assume sel is binary" — it does
        // NOT constrain sel itself. Without this, a prover could pass
        // pathIndices[i] = 5 and steer (outL, outR) to an arbitrary linear
        // combination, forging a path to any root. Force it to a bit.
        pathIndices[i] * (pathIndices[i] - 1) === 0;

        indexAcc += pathIndices[i] * pow;
        pow = pow * 2;

        // sel = 0 -> (outL, outR) = (L, R) = (current, sibling)   [current is left]
        // sel = 1 -> (outL, outR) = (R, L) = (sibling, current)   [current is right]
        switchers[i] = Switcher();
        switchers[i].sel <== pathIndices[i];
        switchers[i].L <== levelHash[i];
        switchers[i].R <== siblings[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== switchers[i].outL;
        hashers[i].inputs[1] <== switchers[i].outR;

        levelHash[i + 1] <== hashers[i].out;
    }

    // D41 — the load-bearing line. Without it a leaf can be proven at ANY slot,
    // so a tree carrying both a transferred-away leaf and its replacement lets
    // the previous owner keep proving ownership. With it, a property occupies
    // exactly one slot and at most one owner is provable per published root.
    // The bits are already constrained above, so this is one linear constraint.
    indexAcc === expectedIndex;

    root <== levelHash[levels];
}
```

Also extend the template's header comment: add `expectedIndex` to the Inputs list, and state that the caller must pass `propertyId` (D41).

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter blockchain hardhat test test/circuits/merkleProof.test.ts
```

Expected: PASS, 6 passing (5 pre-existing + 1 new).

- [ ] **Step 5: Commit**

```bash
git add blockchain/circuits/common/merkleProof.circom blockchain/test/circuits/merkleProof.test.ts
git commit -m "feat(circuits): constrain Merkle path indices to expectedIndex (D41)

MerkleProof now requires an expectedIndex input and proves that the path
bits encode it, so a leaf cannot be proven at a slot other than its own.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Wire `propertyId` into the three circuits

**Files:**

- Modify: `blockchain/circuits/ownership.circom`
- Modify: `blockchain/circuits/mortgage.circom`
- Modify: `blockchain/circuits/transfer.circom`
- Test: `blockchain/test/circuits/ownership.test.ts`
- Test: `blockchain/test/circuits/transfer.test.ts`

**Interfaces:**

- Consumes: `MerkleProof(levels)` with the `expectedIndex` input from Task 2.
- Produces: nothing new in TypeScript. `PUBLIC_SIGNAL_ORDER` is unchanged, so `shared/circuitInputs.ts`, the contracts and the backend are untouched.

- [ ] **Step 1: Write the failing regression tests**

First add this shared helper to `blockchain/test/helpers/records.ts` (both the ownership and the transfer test need it, so it does not belong in either file). Add `TREE_DEPTH` to the existing import from `../../shared/merkleTree`; `poseidonHash` is already imported there.

```ts
/**
 * Build a self-consistent Merkle path placing `leaf` at `index`, and return the
 * root that path implies. The siblings are arbitrary constants — the path is
 * valid *internally*, which is exactly the freedom D41 removes. This models a
 * tree a malicious authority could publish, not one buildTree() would produce,
 * so a test using it must fail for the D41 reason and not because the root
 * mismatched.
 */
export async function pathAt(
  leaf: bigint,
  index: number,
): Promise<{ siblings: bigint[]; pathIndices: number[]; root: bigint }> {
  const siblings: bigint[] = [];
  const pathIndices: number[] = [];
  let node = leaf;
  let cursor = index;

  for (let height = 0; height < TREE_DEPTH; height++) {
    const sibling = BigInt(height + 1);
    const isRightChild = (cursor & 1) === 1;
    pathIndices.push(isRightChild ? 1 : 0);
    siblings.push(sibling);
    node = await poseidonHash(isRightChild ? [sibling, node] : [node, sibling]);
    cursor >>= 1;
  }

  return { siblings, pathIndices, root: node };
}
```

Add these two tests to the `describe('circuits/ownership.circom ...')` block in `blockchain/test/circuits/ownership.test.ts`, importing `pathAt` and `makeRecord` from `../helpers/records` and `hashRecord` from `../../shared/merkleTree`:

```ts
it('accepts a leaf sitting at its own propertyId slot (D41 control)', async () => {
  const { record, secret } = await makeRecord(now);
  const leaf = await hashRecord(record);
  const placed = await pathAt(leaf, Number(record.propertyId));

  const input = buildOwnershipInput({
    record,
    ownerSecret: secret,
    proof: { leaf, siblings: placed.siblings, pathIndices: placed.pathIndices, root: placed.root },
    currentTimestamp: now,
  });

  const witness = await circuit.calculateWitness(input);
  await circuit.checkConstraints(witness);
});

it('rejects a leaf sitting at any other slot — this is the stale-leaf guard (D41)', async () => {
  const { record, secret } = await makeRecord(now);
  const leaf = await hashRecord(record);
  // Same record, same valid path arithmetic, one slot over. Before D41 this
  // verified, which is what let a transferred-away leaf stay provable.
  const misplaced = await pathAt(leaf, Number(record.propertyId) + 1);

  const input = buildOwnershipInput({
    record,
    ownerSecret: secret,
    proof: {
      leaf,
      siblings: misplaced.siblings,
      pathIndices: misplaced.pathIndices,
      root: misplaced.root,
    },
    currentTimestamp: now,
  });

  let threw = false;
  try {
    await circuit.calculateWitness(input);
  } catch {
    threw = true;
  }
  expect(threw, 'a leaf must only be provable at index === propertyId').to.equal(true);
});
```

> `buildOwnershipInput` takes `merkleRoot` from `proof.root` (verified in `shared/circuitInputs.ts:190`), which is why passing the `pathAt` root inside the proof object is enough — no separate root argument exists.

Add this test to the `describe('circuits/transfer.circom ...')` block in `blockchain/test/circuits/transfer.test.ts`, importing `pathAt` from `../helpers/records` and `hashRecord` from `../../shared/merkleTree`:

```ts
it('rejects a transfer whose new leaf sits at a different slot (D41)', async () => {
  const fixture = await makeTransferFixture(now);
  const newLeaf = await hashRecord(fixture.newRecord);

  // A self-consistent path placing the new leaf one slot over, together with
  // the root that path implies — so newMerkle.root === newMerkleRoot still
  // holds and the ONLY unsatisfied constraint is the D41 index binding.
  // Shifting pathIndices alone would break the root check too, and the test
  // would then pass for the wrong reason.
  const misplaced = await pathAt(newLeaf, Number(fixture.newRecord.propertyId) + 1);

  const input = buildTransferInput({
    oldRecord: fixture.oldRecord,
    newRecord: fixture.newRecord,
    oldOwnerSecret: fixture.oldSecret,
    newOwnerSecret: fixture.newSecret,
    oldProof: fixture.oldProof,
    newProof: {
      leaf: newLeaf,
      siblings: misplaced.siblings,
      pathIndices: misplaced.pathIndices,
      root: misplaced.root,
    },
    currentTimestamp: now,
    minRequiredRemainingTerm: 0n,
  });

  let threw = false;
  try {
    await circuit.calculateWitness(input);
  } catch {
    threw = true;
  }
  expect(threw, 'both transfer paths must sit at index === propertyId').to.equal(true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter blockchain hardhat test test/circuits/ownership.test.ts test/circuits/transfer.test.ts
```

Expected: FAIL — circom reports that `expectedIndex` of the `MerkleProof` component is never assigned, so the circuits do not compile.

- [ ] **Step 3: Wire the signal in all three circuits**

`blockchain/circuits/ownership.circom` — in the "3. That leaf must sit in the tree..." block, after the `for` loop that assigns siblings/pathIndices and **before** `merkle.root === merkleRoot;`:

```circom
    // D41: the leaf may only be proven at the slot that IS its propertyId, so a
    // record that has been transferred away has no reachable path any more.
    merkle.expectedIndex <== propertyId;
```

`blockchain/circuits/mortgage.circom` — same insertion, in the "3. Merkle inclusion against the published root." block:

```circom
    // D41: the leaf may only be proven at the slot that IS its propertyId.
    merkle.expectedIndex <== propertyId;
```

`blockchain/circuits/transfer.circom` — two insertions. After the `oldMerkle` loop, before `oldMerkle.root === oldMerkleRoot;`:

```circom
    // D41: both leaves are pinned to the same slot — the propertyId's. That
    // makes oldPathIndices === newPathIndices a consequence rather than an
    // extra constraint, and it means the new tree's slot for this property
    // holds the NEW leaf, so the old one is unreachable.
    oldMerkle.expectedIndex <== propertyId;
```

After the `newMerkle` loop, before `newMerkle.root === newMerkleRoot;`:

```circom
    newMerkle.expectedIndex <== propertyId;
```

Update the header comment of `transfer.circom`: in the "Scope limitations" block, delete limitation `(b)` (the independent-paths caveat) and replace it with a note that D41 pins both paths to `propertyId`. Leave limitation `(a)` (both secrets in one witness) exactly as it is — this plan does not address it.

Finally, fix three comments that D41 makes untrue. They are only comments, but a wrong comment about leaf ordering is exactly the kind of thing a later phase trusts:

- `blockchain/test/helpers/records.ts`, in `placeInTree`: _"The subject sits in the middle so its Merkle path exercises both left- and right-child steps"_ → the subject's position is now `SUBJECT_PROPERTY_ID` (9001) regardless of array position; its binary expansion `0b10001100101001` already mixes left and right steps. Say that instead.
- `blockchain/scripts/circuits/sampleWitness.ts`, the `placeInTree` doc line _"Place `record` in the middle of `fillerCount` random filler records"_ → position follows `propertyId`; the fillers only make the path non-degenerate.
- `blockchain/scripts/circuits/sampleWitness.ts`, the transfer branch comment _"rebuild the tree preserving order"_ → _"rebuild the tree with the one record's owner swapped — order is irrelevant under D41"_.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter blockchain hardhat test test/circuits/
```

Expected: PASS — all circuit suites green, including the two new ownership tests and the new transfer test.

- [ ] **Step 5: Commit**

```bash
git add blockchain/circuits/ blockchain/test/circuits/
git commit -m "feat(circuits): pin every Merkle path to the record's propertyId (D41)

ownership, mortgage and transfer now pass propertyId as expectedIndex. In
transfer both paths are pinned, so a transferred-away leaf can no longer be
proven at another slot. Adds the stale-leaf regression tests.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Backend — range validation, D24 retirement, spec inversion

**Files:**

- Modify: `web-app/backend/src/import/import.service.ts`
- Modify: `web-app/backend/src/import/import.service.spec.ts`
- Modify: `web-app/backend/src/tree/tree.service.ts`
- Modify: `web-app/backend/src/tree/tree.service.spec.ts`

**Interfaces:**

- Consumes: `MAX_PROPERTY_ID` from Task 1, re-exported through `@land-registry/blockchain/shared`.
- Produces: no new exports. `sortByPropertyId` keeps its current signature and behaviour.

> Verify `MAX_PROPERTY_ID` is reachable as `import { MAX_PROPERTY_ID } from '@land-registry/blockchain/shared'`. `shared/index.ts` re-exports `./merkleTree` wholesale, so no barrel edit should be needed — confirm before writing the import.

- [ ] **Step 1: Write the failing tests**

Add to `web-app/backend/src/import/import.service.spec.ts`, next to the existing `'catches a propertyId repeated inside the same file'` test (same `makeService()` / `row()` / `importCsv` helpers already defined at the top of that file):

```ts
it('rejects a propertyId beyond the addressable range of the tree (D41)', async () => {
  const { service } = makeService();

  const result = await service.importCsv(
    [HEADER, row({ propertyId: '1' }), row({ propertyId: '1048576' })].join('\n'), // 2^20
  );

  expect(result.imported).toBe(1);
  expect(result.errors[0].message).toMatch(/exceeds the addressable range/);
});
```

Replace the last test in `web-app/backend/src/tree/tree.service.spec.ts` — delete the `'produces a DIFFERENT root when the order changes — this is why the order is pinned'` test entirely and put this in its place:

```ts
it('produces the SAME root whatever the input order (D41 — position follows propertyId)', async () => {
  const rows = [
    makeProperty({ propertyId: '1' }),
    makeProperty({ propertyId: '2' }),
    makeProperty({ propertyId: '10' }),
  ];

  const numericOrder = await buildTree(sortByPropertyId(rows).map(toLURRecord));
  // What a Postgres `ORDER BY "propertyId"` on a String column would give.
  // Under D24 this produced a different tree; under D41 it cannot.
  const lexicographicOrder = await buildTree(
    [...rows].sort((a, b) => a.propertyId.localeCompare(b.propertyId)).map(toLURRecord),
  );

  expect(lexicographicOrder.root).toBe(numericOrder.root);
});
```

Also change that file's `describe` title and header comment from `leaf ordering (D24)` to:

```ts
/**
 * `sortByPropertyId` no longer decides the tree (D41 keys leaf position to
 * propertyId), but it still decides the order of every property list the API
 * returns, so its numeric-vs-lexicographic behaviour is still worth pinning.
 * The final test is the regression guard for D41 itself.
 */
describe('leaf ordering (D41 supersedes D24)', () => {
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter backend run test -- tree.service.spec import.service.spec
```

Expected: FAIL — the tree spec fails on `expect(lexicographicOrder.root).toBe(numericOrder.root)` if Task 1 is not yet built into `dist`, and the import spec fails because no range check exists.

- [ ] **Step 3: Add the range check and update the TreeService docs**

In `web-app/backend/src/import/import.service.ts`, add `MAX_PROPERTY_ID` to the existing import from `@land-registry/blockchain/shared`, then extend the propertyId validation:

```ts
const propertyId = requireField(row, 'propertyId');
if (!/^\d+$/.test(propertyId)) {
  throw new Error(`propertyId must be a decimal integer string, got '${propertyId}'`);
}
// D41: a leaf's position in the Merkle tree IS its propertyId, so an id
// beyond the tree's address space cannot be committed at all. Reject at
// import rather than at publish time, where it would fail a whole batch.
if (BigInt(propertyId) > MAX_PROPERTY_ID) {
  throw new Error(
    `propertyId ${propertyId} exceeds the addressable range of the registry tree ` +
      `(max ${MAX_PROPERTY_ID}) — D41`,
  );
}
```

In `web-app/backend/src/tree/tree.service.ts`, replace the two ⚠️ paragraphs of the class doc comment with:

```ts
/**
 * TreeService
 * ─────────────────────────────────────────────────────────────────────────────
 * Loads issued properties from Postgres and hands them to the shared Merkle
 * layer.
 *
 * ⚠️ D41 supersedes D24. A leaf's index is now its `propertyId`, so the order
 * this service produces no longer decides the tree — `buildTree()` returns the
 * same root for any permutation. `sortByPropertyId` is kept because it still
 * decides the order of the property lists this service hands back to callers,
 * and because a stable order keeps API responses and logs reproducible.
 *
 * ⚠️ It must still be sorted here, in JS, as BigInt — NOT with Postgres
 * `ORDER BY`. `propertyId` is a String column, so Postgres sorts it
 * lexicographically ("10" < "2"), which would produce a confusing list order.
 *
 * No hashing lives here. buildTree/generateMerkleProof come from
 * @land-registry/blockchain/shared — the repo-wide rule is that Merkle and
 * Poseidon logic exists in exactly one place.
 */
```

Also update the `loadIssuedProperties` doc line from `canonical leaf order (D24)` to `canonical list order (D41: no longer the leaf order)`, and the comment inside `buildProjectedTree` that cites `D24/§2.4` to cite `D41/§2.4`.

- [ ] **Step 4: Run the full backend suite to verify it passes**

```bash
pnpm run compile && pnpm --filter backend run test
```

Expected: PASS, 105 tests (104 pre-existing, one replaced, one added).

- [ ] **Step 5: Commit**

```bash
git add web-app/backend/src/import web-app/backend/src/tree
git commit -m "feat(backend): validate propertyId range, retire D24 ordering rule

Import rejects ids beyond the tree address space. TreeService keeps
sortByPropertyId for list ordering only; the tree is now order-independent,
and its spec asserts that instead of the old D24 invariant.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Trusted setup, redeploy, and measurement

**Files:**

- Regenerated (gitignored): `blockchain/circuits/build/**`, `blockchain/contracts/verifiers/*.sol`
- Modify: `blockchain/circuits/build/setup-metrics.json`, `gas-metrics.json` (outputs, gitignored — record their values in the commit message of Task 6)

**Interfaces:**

- Consumes: the circuits from Task 3.
- Produces: new `.zkey` / `verification_key.json` / `Groth16Verifier*.sol`, new constraint and timing numbers for Chapter 5.

> The circuits changed, so every existing `.zkey` and every deployed verifier is stale. Proofs generated before this task will not verify after it, and vice versa. This is expected and dev-local only.

- [ ] **Step 1: Recompile and read the new constraint counts**

```bash
pnpm --filter blockchain run circuits:compile
```

Expected: all three circuits compile clean; the printed constraint table shows roughly +20 constraints per Merkle path versus the previous run (ownership ~12 205, mortgage ~12 205, transfer ~24 141). Record the actual numbers.

If ownership or mortgage exceeds **16 384** or transfer exceeds **32 768**, stop and report — the `.ptau` power would have to increase, which is a separate decision.

- [ ] **Step 2: Re-run the trusted setup**

```bash
pnpm --filter blockchain run circuits:setup
```

Expected: three circuits set up, verifiers auto-synced into `blockchain/contracts/verifiers/`, and `circuits/build/setup-metrics.json` rewritten with new `constraints` / `proveMs` / `proofBytes`.

- [ ] **Step 3: Run both test suites in full**

```bash
pnpm run test:blockchain
```

Expected: PASS. Previously 111 passing; now ~115 with the new tests. The proof-dependent integration tests must run (not self-skip) since artifacts now exist.

```bash
pnpm --filter backend run test
```

Expected: PASS, 105 tests.

- [ ] **Step 4: Redeploy locally and re-verify end to end**

In one terminal:

```bash
pnpm --filter blockchain run node
```

In another:

```bash
pnpm --filter blockchain run deploy:localhost
```

Then start the backend, import and issue a batch, and run the two smoke scripts per `PHASE_5_MANUAL_TEST.md` and `PHASE_6_MANUAL_TEST.md`:

```bash
pnpm --filter blockchain run owner:smoke <bundle-dir>
```

Expected: refresh → prove ownership + mortgage → verify off-chain → verify on-chain, all green. If on-chain verification fails with `StaleTimestamp`, mine a block (`evm_mine`) — an idle `hardhat node` does not advance `block.timestamp`.

```bash
GOV_API_KEY=... pnpm --filter blockchain run transfer:smoke <bundle-dir>
```

Expected: the full four-step D28 flow completes and the new root publishes.

- [ ] **Step 5: Measure the rebuild cost regression**

The sparse-by-key build performs up to `n × 20` Poseidon hashes where the old dense build did roughly `2n`. With scattered propertyIds this is the realistic cost. Time a rebuild at a representative size:

```bash
pnpm --filter blockchain run mock:generate 1000
```

Then in a Node REPL or a scratch script, time `buildTree(records)` for 1 000 records and record the result. Note it in the Task 6 doc update. If it exceeds ~5 s, raise it — the D40 proof cache means most requests avoid a rebuild, but `POST /publish-root` does one every time.

- [ ] **Step 6: Commit**

Nothing under `circuits/build/` or `contracts/verifiers/` is committed (both gitignored). If `deployments/localhost.json` changed, commit it:

```bash
git add blockchain/deployments/
git commit -m "chore: redeploy local contracts after D41 trusted setup

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

If nothing changed, skip this commit.

---

### Task 6: Documentation — D41 in the decision log

**Files:**

- Modify: `CODING_ROADMAP.md`
- Modify: `CLAUDE.md`

**Interfaces:**

- Consumes: the measured numbers from Task 5.
- Produces: the binding record of this decision, which later phases read instead of re-deriving.

- [ ] **Step 1: Add D41 to the Design Decisions Log**

Append to `CODING_ROADMAP.md` §0, in the same format as the neighbouring entries:

```markdown
- **D41 — Vị trí lá trong cây = `propertyId` (supersedes D24).** `buildTree()` đặt lá tại `index = Number(propertyId)` thay vì theo thứ tự mảng, và `MerkleProof(levels)` nhận thêm input `expectedIndex`, ràng buộc `Σ pathIndices[i]·2^i === expectedIndex`; cả 3 circuit truyền `propertyId` vào đó (transfer truyền cho **cả hai** đường đi).

  **Vì sao:** trước D41 không có gì nối một lá với một vị trí. Một cây chứa đồng thời `leaf(123, A)` (chủ cũ) và `leaf(123, B)` (chủ mới) thoả mãn mọi ràng buộc, nên **chủ cũ vẫn tạo được ownership proof hợp lệ sau khi đã chuyển nhượng** và có thể bán lại thửa đất. Việc này trước đây chỉ bị chặn ở tầng ứng dụng (`propertyId @unique` trong Prisma + guard `duplicate propertyId` trong `buildTree`) — tức là bằng cách **tin cơ quan chạy đúng phần mềm này**, đúng thứ mà đề tài tuyên bố loại bỏ.

  **Hệ quả:** một thửa chiếm đúng một ô, một ô giữ đúng một giá trị → sau chuyển nhượng lá cũ **không còn đường đi nào** tới `latestRoot`. Trong `transfer.circom`, `oldPathIndices === newPathIndices` trở thành hệ quả tự động, không cần ràng buộc riêng.

  **Ràng buộc kèm theo:** `0 ≤ propertyId ≤ 2^20 − 1` (1.048.575), kiểm ở `buildTree()` và ở `ImportService`. Không phải giới hạn mới: D20 vốn đã chốt depth 20 ≈ 1,05 triệu lá. Muốn phủ ~50 triệu thửa toàn quốc thì nâng depth (26 tầng ≈ 67 triệu) — đo lại constraint trước, vì `.ptau` power có ngưỡng.

  **Không đổi:** `PUBLIC_SIGNAL_ORDER` (D21), nên `LandRegistryVerifier.sol`, `RootRegistry.sol` và `shared/circuitInputs.ts` không phải sửa. Thứ tự 6+1 field của lá (D4) không đổi.

  **Không giải quyết:** `transfer.circom` vẫn cần cả hai secret trong một witness (giả định "một phiên"). Xem Limitations.
```

Then edit the **D24** entry in place: prefix it with `~~(SUPERSEDED bởi D41)~~` and add one line — _"Thứ tự không còn quyết định cây; `sortByPropertyId` giờ chỉ quyết định thứ tự danh sách trả về từ API."_

- [ ] **Step 2: Update §2.1 of the roadmap**

In `CODING_ROADMAP.md` §2.1 (`common/merkleProof.circom`), add `expectedIndex` to the documented signal list and note the D41 constraint. Update the measured constraint counts in §2.5 with the numbers from Task 5 Step 1.

- [ ] **Step 3: Update `CLAUDE.md`**

Three edits:

1. In the `shared/merkleTree.ts` bullet, replace the description of the tree with: fixed-depth-20 **sparse, keyed by `propertyId`** (D41) — a leaf's index is its `propertyId`, so the build is order-independent and a property occupies exactly one slot. Mention `MAX_PROPERTY_ID`.
2. In the `circuits/` bullet, note that `common/merkleProof.circom` takes `expectedIndex` and that all three circuits pass `propertyId` (D41).
3. In the `web-app/backend/` `tree/` bullet, replace the D24 paragraph: the numeric-vs-lexicographic sort still matters for list output but no longer determines the tree; `tree.service.spec.ts` now guards order-independence.

Also update the test counts in the same file to whatever Task 5 reported.

- [ ] **Step 4: Verify the docs match reality**

```bash
grep -n "D41" CODING_ROADMAP.md CLAUDE.md
grep -n "D24" CODING_ROADMAP.md CLAUDE.md web-app/backend/src/tree/tree.service.ts
```

Expected: D41 appears in both docs; every surviving D24 mention is explicitly marked superseded.

- [ ] **Step 5: Commit**

```bash
git add CODING_ROADMAP.md CLAUDE.md
git commit -m "docs: record D41 (leaf position keyed to propertyId), supersede D24

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Thesis-side wording

**Files:**

- Modify: `C:\Users\Snow_Ace\Downloads\Mẫu đăng ký đề tài LVTN - BuiCongVinh ITCSIU22165.docx` (Requirement 14)

**Interfaces:**

- Consumes: the completed implementation from Tasks 1–6.
- Produces: registration-form wording that matches what the code actually guarantees.

> Only do this task once Tasks 1–5 are green. Until then the form's current wording (which claims neither guarantee) is the accurate one.

- [ ] **Step 1: Rewrite Requirement 14's trailing sentence**

Requirement 14 currently ends at "...performance evaluation at national scale." Append one sentence covering the limitation that **remains**:

> Within the transfer use case, both parties are additionally assumed to generate the proof in a single mediated session, since one witness must contain both owners' secrets; splitting that into independently generated proofs is left as future work.

Do **not** mention the stale-leaf/leaf-removal limitation — D41 closes it, and listing a limitation the system does not have invites a question with no good answer.

- [ ] **Step 2: Consider promoting D41 into the Objectives**

Optional, discuss with the supervisor first. Objective 1 currently reads "...enabling integrity verification". If the supervisor wants the contribution visible on the form, it can become:

> 1. Design a Merkle tree commitment structure for LUR records, keyed so that each property occupies exactly one committed position, that lets any third party verify record integrity against the on-chain root without trusting the issuing authority.

- [ ] **Step 3: Verify the rendered document**

Open the `.docx` in Word and check that Requirement 14 still sits on one paragraph and the numbering 1–14 is intact.

---

## Verification checklist (run before calling this done)

- [ ] `pnpm run test:blockchain` — all green, proof-dependent integration tests **ran** rather than self-skipped
- [ ] `pnpm --filter backend run test` — all green
- [ ] `pnpm run lint` — clean
- [ ] **Mutation check — ownership:** delete `merkle.expectedIndex <== propertyId;` from `ownership.circom`, re-run `test/circuits/ownership.test.ts`, confirm the "rejects a leaf sitting at any other slot" test **fails**, then restore the line. (Circom will not compile with the signal unassigned, so temporarily wire it to `merkle.expectedIndex <== 0;` and pass `pathAt(leaf, 0)` — the point is to prove the assertion is load-bearing, not merely present.)
- [ ] **Mutation check — transfer:** same procedure for each of the two `expectedIndex` lines in `transfer.circom`; the new transfer test must fail when the `newMerkle` one is neutralised
- [ ] `blockchain/test/shared/merkleTree.test.ts` order-independence test **fails** if `buildTree` is reverted to array-position indexing
- [ ] The `pathAt` helper is used by both circuit tests and is exported from `test/helpers/records.ts` (not duplicated in each file)
- [ ] `owner:smoke` green against a freshly deployed local chain
- [ ] `transfer:smoke` green, and a pre-transfer proof replayed afterwards is rejected with `RootMismatch`
- [ ] New constraint counts recorded in `CODING_ROADMAP.md` §2.5
- [ ] D41 present in `CODING_ROADMAP.md` §0; every D24 reference marked superseded

## Open items deliberately left out of this plan

1. **Depth 26 for national scale.** Decide after Task 5 reports constraint counts. It is a one-constant change (`TREE_DEPTH`, `MerkleProof(20)` → `MerkleProof(26)`) plus another trusted setup, but it enlarges the `.zkey` the browser must download in Phase 8 — measure that before committing.
2. **The single-session assumption in `transfer.circom`.** The clean fix is to split the "buyer knows the preimage of `newOwnerCommitment`" constraint into its own tiny circuit that the buyer runs alone, linked to the transfer proof by the shared public `newOwnerCommitment` signal. That removes the need for anyone — including the authority — to hold both secrets. Separate plan; costs one more circuit and trusted setup.
3. **Sparse rebuild performance at scale.** If Task 5 Step 5 shows a rebuild that is too slow, the fix is incremental updates (recompute only the changed path) rather than a full rebuild, which the keyed layout makes straightforward for the first time.
