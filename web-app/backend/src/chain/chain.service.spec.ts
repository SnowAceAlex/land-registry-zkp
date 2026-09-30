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

describe('ChainService.getFrozenOwners (D80)', () => {
  function withRegistry(frozenOwnersOf: jest.Mock): ChainService {
    const service = new ChainService();
    Object.assign(service, { registry: { frozenOwnersOf } });
    return service;
  }

  it('reads in chunks of 1000 and maps every id to its frozen commitment', async () => {
    const frozenOwnersOf = jest.fn(async (ids: bigint[]) =>
      ids.map((id) => (id % 2n === 0n ? id * 10n : 0n)),
    );
    const ids = Array.from({ length: 2500 }, (_, i) => String(i + 1));

    const frozen = await withRegistry(frozenOwnersOf).getFrozenOwners(ids);

    expect(frozenOwnersOf).toHaveBeenCalledTimes(3);
    expect(frozenOwnersOf.mock.calls[0][0]).toHaveLength(1000);
    expect(frozenOwnersOf.mock.calls[2][0]).toHaveLength(500);
    expect(frozen.size).toBe(2500);
    expect(frozen.get('2')).toBe(20n);
    expect(frozen.get('3')).toBe(0n);
  });

  it('makes no call for an empty list', async () => {
    const frozenOwnersOf = jest.fn();

    await expect(withRegistry(frozenOwnersOf).getFrozenOwners([])).resolves.toEqual(new Map());
    expect(frozenOwnersOf).not.toHaveBeenCalled();
  });
});
