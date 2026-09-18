import { describe, expect, it } from 'vitest';

import type { PropertyEvent, PropertyEventKind, PropertyHistory } from '../api';
import { isRevoked, summariseEvent } from './event-summary';

function event(kind: PropertyEventKind, overrides: Partial<PropertyEvent> = {}): PropertyEvent {
  return {
    kind,
    rootVersion: 3,
    txHash: '0xabc',
    previousOwnerCommitment: null,
    newOwnerCommitment: null,
    previousLeaf: null,
    newLeaf: null,
    detail: null,
    occurredAt: '2026-09-18T00:00:00.000Z',
    ...overrides,
  };
}

const history = (kinds: PropertyEventKind[]): PropertyHistory => ({
  propertyId: '1001',
  events: kinds.map((kind) => event(kind)),
});

describe('summariseEvent (D48)', () => {
  it('sees an owner change on a transfer', () => {
    const summary = summariseEvent(
      event('TRANSFERRED', {
        previousOwnerCommitment: '111',
        newOwnerCommitment: '222',
        previousLeaf: '10',
        newLeaf: '20',
      }),
    );

    expect(summary.ownerChanged).toBe(true);
    expect(summary.leafChanged).toBe(true);
  });

  it('sees no owner change when only the leaf moved', () => {
    const summary = summariseEvent(
      event('ENCUMBRANCE_CHANGED', {
        previousOwnerCommitment: '111',
        newOwnerCommitment: '111',
        previousLeaf: '10',
        newLeaf: '20',
      }),
    );

    expect(summary.ownerChanged).toBe(false);
    expect(summary.leafChanged).toBe(true);
  });

  // rootVersion === null means the event is recorded but its root was never
  // published — a signed-but-unconfirmed draft, or a crash between the two.
  it('reports an unpublished event as unpublished', () => {
    expect(summariseEvent(event('ISSUED', { rootVersion: null })).published).toBe(false);
    expect(summariseEvent(event('ISSUED', { rootVersion: 0 })).published).toBe(true);
    expect(summariseEvent(event('ISSUED', { rootVersion: 4 })).published).toBe(true);
  });

  it('narrows a REVOKED detail to the reason code and the hash', () => {
    const summary = summariseEvent(
      event('REVOKED', { detail: { reasonCode: 3, detailHash: '0xdead' } }),
    );

    expect(summary.reasonCode).toBe(3);
    expect(summary.detailHash).toBe('0xdead');
  });

  // D48's hard rule, as a test: the free-text reason stays off this route
  // (D45). If a server bug ever sent it, this page must not pick it up.
  it('never carries detailText, even when the server sends it', () => {
    const summary = summariseEvent(
      event('REVOKED', {
        detail: { reasonCode: 2, detailHash: '0xbeef', detailText: 'forged documents' },
      }),
    );

    expect(Object.keys(summary)).not.toContain('detailText');
    expect(JSON.stringify(summary)).not.toContain('forged');
  });

  it('ignores a reason code the contract would not have accepted', () => {
    // 0 is what an absent value reads back as; 6 is past MAX_REASON_CODE.
    expect(summariseEvent(event('REVOKED', { detail: { reasonCode: 0 } })).reasonCode).toBeUndefined();
    expect(summariseEvent(event('REVOKED', { detail: { reasonCode: 6 } })).reasonCode).toBeUndefined();
    expect(
      summariseEvent(event('REVOKED', { detail: { reasonCode: '3' } })).reasonCode,
    ).toBeUndefined();
  });

  it('survives a detail blob of any other shape', () => {
    for (const detail of [null, undefined, 'text', 42, []]) {
      expect(() => summariseEvent(event('REVOKED', { detail }))).not.toThrow();
      expect(summariseEvent(event('REVOKED', { detail })).reasonCode).toBeUndefined();
    }
  });

  it('reads a reason code only from a REVOKED event', () => {
    const summary = summariseEvent(
      event('TRANSFERRED', { detail: { reasonCode: 3, detailHash: '0xdead' } }),
    );

    expect(summary.reasonCode).toBeUndefined();
    expect(summary.detailHash).toBeUndefined();
  });
});

describe('isRevoked (D48)', () => {
  it('is true when the last decisive event is a revocation', () => {
    expect(isRevoked(history(['ISSUED', 'TRANSFERRED', 'REVOKED']))).toBe(true);
  });

  // A plot can be revoked and issued again, so "contains a REVOKED event" is
  // the wrong question — the current status is what a verifier acts on.
  it('is false when the plot was issued again afterwards', () => {
    expect(isRevoked(history(['ISSUED', 'REVOKED', 'ISSUED']))).toBe(false);
  });

  it('ignores events that do not change membership', () => {
    expect(isRevoked(history(['ISSUED', 'REVOKED', 'ENCUMBRANCE_CHANGED']))).toBe(true);
    expect(isRevoked(history(['ISSUED', 'VALIDITY_CHANGED']))).toBe(false);
  });

  it('is false for a plot with no events at all', () => {
    expect(isRevoked(history([]))).toBe(false);
  });
});
