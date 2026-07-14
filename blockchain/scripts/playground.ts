import { generateMockRecords } from "./generateMockData";
import { buildTree, generateMerkleProof, getMerkleRoot, verifyMerkleProof } from "../shared";

async function main() {
    const { records } = await generateMockRecords(8);
    const tree = await buildTree(records);
    const root = await getMerkleRoot(tree);

    // console.log(tree)
    console.log('root: ', root.toString());

    const proof = await generateMerkleProof(tree, records[3]);
    console.log('verify (true):', await verifyMerkleProof(proof, root));

    const tampered = { ...proof, leaf: proof.leaf + 1n };
    console.log('verify tampered (false):', await verifyMerkleProof(tampered, root));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
})