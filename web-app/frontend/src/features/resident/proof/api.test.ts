import { afterEach, describe, expect, it, vi } from 'vitest';

import { refreshMerkleProof } from './api';

describe('refreshMerkleProof (D74)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * 'no-cache' is the only mode that is both cheap and correct here. 'no-store'
   * never sends If-None-Match, so the portal got none of the 304 path; 'default'
   * honours the route's max-age=60 without asking, and after a publish the page
   * would compare a superseded root with the chain's.
   */
  it('always revalidates the cached proof instead of skipping or trusting the cache', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await refreshMerkleProof('42');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/proof/42'),
      expect.objectContaining({ cache: 'no-cache' }),
    );
  });
});
