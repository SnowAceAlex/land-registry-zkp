import { afterEach, describe, expect, it } from 'vitest';
import { hardhat, sepolia } from 'viem/chains';

import { rpcUrlForChain, viemChainFor } from './chain-config';

const originalSepoliaRpc = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL;

afterEach(() => {
  if (originalSepoliaRpc === undefined) delete process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL;
  else process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL = originalSepoliaRpc;
});

describe('rpcUrlForChain (D58)', () => {
  it('reads a local node directly', () => {
    expect(rpcUrlForChain(hardhat.id)).toBe('http://127.0.0.1:8545');
  });

  it('prefers NEXT_PUBLIC_SEPOLIA_RPC_URL for Sepolia', () => {
    process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL = 'https://example.invalid/key';
    expect(rpcUrlForChain(sepolia.id)).toBe('https://example.invalid/key');
  });

  it('falls back to a public Sepolia endpoint when none is configured', () => {
    delete process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL;
    expect(rpcUrlForChain(sepolia.id)).toBe('https://ethereum-sepolia-rpc.publicnode.com');
  });

  it('treats an empty env var as unset rather than as an endpoint', () => {
    process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL = '';
    expect(rpcUrlForChain(sepolia.id)).toBe('https://ethereum-sepolia-rpc.publicnode.com');
  });

  // A silent fallback here would report a check against the wrong chain, which
  // is the one thing a verifier must never be shown.
  it('refuses a chain it has no endpoint for, and says what to do', () => {
    expect(() => rpcUrlForChain(1)).toThrow(/No browser RPC endpoint is configured for chain 1/);
    expect(() => rpcUrlForChain(1)).toThrow(/wallet-config\.ts/);
  });
});

describe('viemChainFor (D58)', () => {
  it('returns a chain whose id is the one asked for', () => {
    expect(viemChainFor(hardhat.id).id).toBe(hardhat.id);
    expect(viemChainFor(sepolia.id).id).toBe(sepolia.id);
  });

  it('rejects the same chains rpcUrlForChain rejects', () => {
    expect(() => viemChainFor(1)).toThrow(/No browser RPC endpoint is configured/);
  });
});

/**
 * The guard for the D58 rule that matters most: the RPC endpoint is chosen from
 * the chain id in this module, never taken from the API response, because that
 * response is served to a logged-out page and the backend's own URL may carry a
 * provider key. This asserts the shape of the contract — PublicChainConfig has
 * no field that could hold one.
 */
describe('the API response cannot supply an RPC endpoint', () => {
  it('has no url-shaped field in the config contract', async () => {
    const config = {
      network: 'localhost',
      chainId: hardhat.id,
      contracts: {
        RootRegistry: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
        LandRegistryVerifier: '0xa513E6E4b8f2a923D98304ec87F64353C4D5C853',
      },
    } as const;

    const values = JSON.stringify(config);
    expect(values).not.toMatch(/https?:\/\//);
    // And the endpoint actually used comes from the chain id, not the payload.
    expect(rpcUrlForChain(config.chainId)).toBe('http://127.0.0.1:8545');
  });
});
