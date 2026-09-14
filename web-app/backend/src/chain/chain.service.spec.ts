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
