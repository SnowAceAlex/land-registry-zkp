import { ChainService } from '../chain/chain.service';
import { PublicConfigService } from './public-config.service';

/**
 * public-config.service.spec.ts — D58.
 *
 * Pure logic, no DB and no chain: ChainService is stubbed down to the four
 * getters this service reads. What these tests are really guarding is the
 * SHAPE, not the values — see the second test.
 */

function serviceWith(overrides: Partial<Record<string, unknown>> = {}): PublicConfigService {
  const chain = {
    network: 'localhost',
    chainId: 31337,
    rootRegistryAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    landRegistryVerifierAddress: '0xa513E6E4b8f2a923D98304ec87F64353C4D5C853',
    ...overrides,
  } as unknown as ChainService;
  return new PublicConfigService(chain);
}

/** Every leaf value in the response, flattened, for the "no secrets" sweeps. */
function leafValues(value: unknown): unknown[] {
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap(leafValues);
  }
  return [value];
}

describe('PublicConfigService (D58)', () => {
  it('serves the network, chain id and the two contract addresses', () => {
    expect(serviceWith().chainConfig()).toEqual({
      network: 'localhost',
      chainId: 31337,
      contracts: {
        RootRegistry: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
        LandRegistryVerifier: '0xa513E6E4b8f2a923D98304ec87F64353C4D5C853',
      },
    });
  });

  // The D50 lesson: the field list is not what leaked, the shape was. A spread
  // over DeploymentRecord would publish `deployer` and the `authority` block on
  // an unguarded route the day someone adds a field. Assert the key sets, so
  // widening the response has to be a decision.
  it('serves exactly these keys and no others', () => {
    const config = serviceWith().chainConfig();

    expect(Object.keys(config).sort()).toEqual(['chainId', 'contracts', 'network']);
    expect(Object.keys(config.contracts).sort()).toEqual(['LandRegistryVerifier', 'RootRegistry']);
  });

  // The RPC URL may carry a provider key (resolveRpcUrl → SEPOLIA_RPC_URL).
  // Nothing in this response may ever look like one, on any network.
  it('never serves anything URL-shaped, so an RPC endpoint cannot slip in', () => {
    const config = serviceWith({
      network: 'sepolia',
      chainId: 11155111,
      rootRegistryAddress: '0x1111111111111111111111111111111111111111',
      landRegistryVerifierAddress: '0x2222222222222222222222222222222222222222',
    }).chainConfig();

    for (const value of leafValues(config)) {
      expect(typeof value === 'string' ? value : '').not.toMatch(/^(https?|wss?):/i);
    }
  });

  it('passes the address overrides through, so browser and backend agree', () => {
    // ChainService resolves ROOT_REGISTRY_ADDRESS / LAND_REGISTRY_VERIFIER_ADDRESS
    // inside its own getters; this service must not second-guess them.
    const config = serviceWith({
      rootRegistryAddress: '0x0000000000000000000000000000000000000dEaD',
      landRegistryVerifierAddress: '0x0000000000000000000000000000000000000BEEF',
    }).chainConfig();

    expect(config.contracts.RootRegistry).toBe('0x0000000000000000000000000000000000000dEaD');
    expect(config.contracts.LandRegistryVerifier).toBe('0x0000000000000000000000000000000000000BEEF');
  });
});
