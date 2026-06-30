import { Injectable, OnModuleInit } from '@nestjs/common';

/**
 * ChainService
 * ─────────────────────────────────────────────────────────────────────────────
 * Ethereum smart contract interaction layer.
 * Uses ethers.js v6 to communicate with the RootRegistry contract.
 *
 * TODO (implement in this order):
 *
 *  1. IMPORT shared logic from @land-registry/blockchain
 *     import { buildTree, getMerkleRoot, LURRecord } from '@land-registry/blockchain/shared';
 *     ⚠️  This is the key integration point — ALL Merkle tree logic comes from the shared package.
 *
 *  2. SETUP ethers.js provider and signer:
 *     import { ethers } from 'ethers';
 *     const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
 *     const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
 *
 *  3. CONNECT to RootRegistry contract:
 *     import { RootRegistry__factory } from '@land-registry/blockchain/typechain-types';
 *     const contract = RootRegistry__factory.connect(process.env.CONTRACT_ADDRESS, signer);
 *     Note: typechain-types are generated after `hardhat compile` in the blockchain package.
 *
 *  4. Implement publishRoot(records: LURRecord[]): Promise<string>
 *     a. Build Merkle tree from all records: const tree = await buildTree(records)
 *     b. Get root: const root = await getMerkleRoot(tree)
 *     c. Convert to bytes32: const rootBytes32 = ethers.zeroPadValue('0x' + root.toString(16), 32)
 *     d. Call contract: const tx = await contract.publishRoot(rootBytes32)
 *     e. Wait for confirmation: await tx.wait()
 *     f. Return tx.hash
 *
 *  5. Implement getLatestRoot(): Promise<string>
 *     return contract.latestRoot();
 *
 *  6. Implement getRootVersion(): Promise<number>
 *     return Number(await contract.rootVersion());
 *
 * IMPORTANT: Load contract address and RPC URL from environment variables.
 *            Never hardcode private keys or RPC URLs.
 */
@Injectable()
export class ChainService implements OnModuleInit {
  // TODO: private provider: ethers.JsonRpcProvider
  // TODO: private signer: ethers.Wallet
  // TODO: private contract: RootRegistry

  async onModuleInit() {
    // TODO: initialize provider, signer, contract connection here
    // This runs once when the NestJS module loads.
    console.log('ChainService initialized — TODO: connect to RootRegistry contract');
  }

  async publishRoot(_records: unknown[]): Promise<string> {
    // TODO: implement (see steps 4a-4f above)
    throw new Error('publishRoot not implemented yet');
  }

  async getLatestRoot(): Promise<string> {
    // TODO: return contract.latestRoot()
    throw new Error('getLatestRoot not implemented yet');
  }

  async getRootVersion(): Promise<number> {
    // TODO: return Number(await contract.rootVersion())
    throw new Error('getRootVersion not implemented yet');
  }
}
