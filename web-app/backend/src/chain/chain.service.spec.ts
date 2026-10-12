import { ethers } from 'ethers';

import { ChainService } from './chain.service';

/**
 * Only the synchronous deployment-identity getters are covered here. Everything
 * that talks to a node is exercised by the Phase 5/6 runbooks against a live
 * chain, like the rest of this service.
 */
describe('ChainService — deployment identity (D54)', () => {
  const originalNetwork = process.env.CHAIN_NETWORK;

  afterEach(() => {
    if (originalNetwork === undefined) delete process.env.CHAIN_NETWORK;
    else process.env.CHAIN_NETWORK = originalNetwork;
  });

  /** onModuleInit() needs an RPC endpoint; the getters only need the loaded record. */
  function withDeployment(chainId: number): ChainService {
    const service = new ChainService();
    Object.assign(service, { deployment: { chainId } });
    return service;
  }

  it('exposes the chainId recorded by the deploy script', () => {
    expect(withDeployment(31337).chainId).toBe(31337);
  });

  it('links transactions to Etherscan on Sepolia', () => {
    process.env.CHAIN_NETWORK = 'sepolia';
    expect(withDeployment(11155111).explorerTxUrlPrefix).toBe('https://sepolia.etherscan.io/tx/');
  });

  it('has no explorer on a local node', () => {
    process.env.CHAIN_NETWORK = 'localhost';
    expect(withDeployment(31337).explorerTxUrlPrefix).toBeUndefined();
  });
});

describe('ChainService — status attestation (D82)', () => {
  const proof = {
    pi_a: ['1', '2', '1'],
    pi_b: [
      ['1', '2'],
      ['3', '4'],
      ['1', '0'],
    ],
    pi_c: ['5', '6', '1'],
  };

  it('refuses an ownership proof with no attestation before asking the contract', async () => {
    const verifyOwnership = { staticCall: jest.fn() };
    const service = new ChainService();
    Object.assign(service, { verifier: { verifyOwnership } });

    await expect(
      service.verifyOnChain('ownership', proof as never, ['1', '2', '3', '4']),
    ).rejects.toMatchObject({ reason: 'InvalidAttestation' });
    expect(verifyOwnership.staticCall).not.toHaveBeenCalled();
  });

  it('staples expiresAt and the signature after the public signals', async () => {
    const verifyMortgage = { staticCall: jest.fn().mockResolvedValue(true) };
    const service = new ChainService();
    Object.assign(service, { verifier: { verifyMortgage } });

    await service.verifyOnChain('mortgage', proof as never, ['1', '2', '3', '4', '5'], {
      expiresAt: '1790000000',
      signature: '0xabc',
    });
    const args = verifyMortgage.staticCall.mock.calls[0];
    expect(args.slice(4)).toEqual([1790000000n, '0xabc']);
  });

  it('asks the registry for keccak256("ATTESTER_ROLE")', async () => {
    const hasRole = jest.fn().mockResolvedValue(true);
    const service = new ChainService();
    Object.assign(service, { registry: { hasRole } });

    await expect(
      service.hasAttesterRole('0x70997970C51812dc3A010C7d01b50e0d17dc79C8'),
    ).resolves.toBe(true);
    expect(hasRole).toHaveBeenCalledWith(
      ethers.id('ATTESTER_ROLE'),
      '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    );
  });
});
