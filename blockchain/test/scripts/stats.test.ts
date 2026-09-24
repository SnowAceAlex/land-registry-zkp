import { expect } from 'chai';

import { percentiles } from '../../scripts/bench/lib/stats';

describe('percentiles (bench harness)', () => {
  it('reads the nearest-rank value, not an interpolation', () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100

    const result = percentiles(samples);

    expect(result.p50).to.equal(50);
    expect(result.p95).to.equal(95);
    expect(result.p99).to.equal(99);
    expect(result.max).to.equal(100);
    expect(result.mean).to.equal(50.5);
  });

  it('does not mutate the caller array — the caller still needs its order', () => {
    const samples = [3, 1, 2];

    percentiles(samples);

    expect(samples).to.deep.equal([3, 1, 2]);
  });

  it('handles a single sample', () => {
    expect(percentiles([7])).to.deep.equal({ p50: 7, p95: 7, p99: 7, mean: 7, max: 7 });
  });

  it('throws on an empty set rather than reporting zeros', () => {
    // A table printing "p95: 0" because nothing was sampled is the worst way to
    // lose an argument in a viva.
    expect(() => percentiles([])).to.throw('percentiles: no samples');
  });
});
