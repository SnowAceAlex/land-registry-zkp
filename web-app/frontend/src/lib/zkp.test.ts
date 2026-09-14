import { describe, expect, it } from 'vitest';

import { circuitArtifactUrls } from './zkp';

describe('circuitArtifactUrls (D55)', () => {
  it('points at the copies circuits:sync-frontend places under public/circuits', () => {
    expect(circuitArtifactUrls('transfer', 'http://localhost:3000')).toEqual({
      wasmUrl: 'http://localhost:3000/circuits/transfer/transfer.wasm',
      zkeyUrl: 'http://localhost:3000/circuits/transfer/transfer.zkey',
      vkeyUrl: 'http://localhost:3000/circuits/transfer/verification_key.json',
    });
  });

  it('is absolute, so the worker fetches from the page origin and not its chunk path', () => {
    const { wasmUrl } = circuitArtifactUrls('ownership', 'https://registry.example');
    expect(new URL(wasmUrl).pathname).toBe('/circuits/ownership/ownership.wasm');
  });
});
