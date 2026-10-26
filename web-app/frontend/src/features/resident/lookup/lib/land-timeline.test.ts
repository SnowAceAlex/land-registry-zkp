import { describe, expect, it } from 'vitest';

import type { Lineage, LineageNode, PropertyEvent, PropertyEventKind } from '../api';
import { buildLandTimeline } from './land-timeline';

function event(kind: PropertyEventKind, occurredAt: string): PropertyEvent {
  return {
    kind,
    rootVersion: 1,
    txHash: null,
    previousOwnerCommitment: null,
    newOwnerCommitment: null,
    previousLeaf: null,
    newLeaf: null,
    detail: null,
    occurredAt,
  };
}

function node(propertyId: string, generation: number, overrides: Partial<LineageNode> = {}): LineageNode {
  return {
    propertyId,
    status: 'ISSUED',
    generation,
    predecessors: [],
    successors: [],
    events: [],
    ...overrides,
  };
}

const lineage = (propertyId: string, nodes: LineageNode[], truncated = false): Lineage => ({
  propertyId,
  nodes,
  truncated,
});

describe('buildLandTimeline (D90)', () => {
  it('is one section for a certificate that was never re-issued', () => {
    const { sections, truncated } = buildLandTimeline(
      lineage('7', [node('7', 0, { events: [event('ISSUED', '2026-01-01T00:00:00Z')] })]),
    );
    expect(truncated).toBe(false);
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({
      propertyId: '7',
      status: 'ISSUED',
      generation: 0,
      isQueried: true,
      replaces: [],
      replacedBy: [],
    });
  });

  it('orders a 1 -> 1 -> 1 chain by generation and marks only the queried one', () => {
    const { sections } = buildLandTimeline(
      lineage('2', [
        node('3', 1, { predecessors: ['2'] }),
        node('1', -1, { status: 'REVOKED', successors: ['2'] }),
        node('2', 0, { predecessors: ['1'], successors: ['3'] }),
      ]),
    );
    expect(sections.map((s) => s.propertyId)).toEqual(['1', '2', '3']);
    expect(sections.map((s) => s.isQueried)).toEqual([false, true, false]);
    expect(sections[1]).toMatchObject({ replaces: ['1'], replacedBy: ['3'] });
    expect(sections[0].status).toBe('REVOKED');
  });

  it('keeps a split sibling that is not a node in the parent replacedBy', () => {
    const { sections } = buildLandTimeline(
      lineage('20', [
        node('10', -1, { status: 'REVOKED', successors: ['20', '21'] }),
        node('20', 0, { predecessors: ['10'] }),
      ]),
    );
    expect(sections).toHaveLength(2);
    expect(sections[0].replacedBy).toEqual(['20', '21']);
    expect(sections[1].replaces).toEqual(['10']);
  });

  it('puts both parents of a merge at the same generation', () => {
    const { sections } = buildLandTimeline(
      lineage('30', [
        node('11', -1, { status: 'REVOKED', successors: ['30'] }),
        node('12', -1, { status: 'REVOKED', successors: ['30'] }),
        node('30', 0, { predecessors: ['11', '12'] }),
      ]),
    );
    expect(sections.map((s) => s.propertyId)).toEqual(['11', '12', '30']);
    expect(sections[2].replaces).toEqual(['11', '12']);
  });

  it('passes truncated through', () => {
    expect(buildLandTimeline(lineage('1', [node('1', 0)], true)).truncated).toBe(true);
  });

  it('orders a generation by first event, then by numeric id', () => {
    const { sections } = buildLandTimeline(
      lineage('5', [
        node('100', -1, { events: [event('ISSUED', '2026-03-01T00:00:00Z')] }),
        node('9', -1, { events: [event('ISSUED', '2026-03-01T00:00:00Z')] }),
        node('50', -1, { events: [event('ISSUED', '2026-02-01T00:00:00Z')] }),
        node('5', 0),
      ]),
    );
    // 50 is earliest; the 03-01 tie goes to 9 before 100 (BigInt, not text order).
    expect(sections.map((s) => s.propertyId)).toEqual(['50', '9', '100', '5']);
  });

  it('sorts a section without events after those with events, then by id', () => {
    const { sections } = buildLandTimeline(
      lineage('5', [
        node('2', -1),
        node('10', -1, { events: [event('ISSUED', '2026-03-01T00:00:00Z')] }),
        node('5', 0),
      ]),
    );
    expect(sections.map((s) => s.propertyId)).toEqual(['10', '2', '5']);
  });

  it('lists a section\'s events oldest first without touching the input', () => {
    const events = [event('REVOKED', '2026-05-01T00:00:00Z'), event('ISSUED', '2026-01-01T00:00:00Z')];
    const { sections } = buildLandTimeline(lineage('1', [node('1', 0, { events })]));
    expect(sections[0].events.map((e) => e.kind)).toEqual(['ISSUED', 'REVOKED']);
    expect(events[0].kind).toBe('REVOKED');
  });
});
