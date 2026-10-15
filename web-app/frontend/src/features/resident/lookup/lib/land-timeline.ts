/**
 * features/resident/lookup/lib/land-timeline.ts - lay the certificates of one
 * plot out as sections (D90).
 *
 * Pure. A re-issued certificate gets a new propertyId, so one piece of land's
 * history is spread over several certificates; this puts them back in order.
 */

import type { Lineage, PropertyEvent, PropertyStatus } from '../api';

export interface LandTimelineSection {
  propertyId: string;
  status: PropertyStatus;
  generation: number;
  isQueried: boolean;
  /** Certificates this one supersedes — may name ids that are not sections (a split sibling). */
  replaces: string[];
  replacedBy: string[];
  /** Oldest first. */
  events: PropertyEvent[];
}

function byTime(a: PropertyEvent, b: PropertyEvent): number {
  return Date.parse(a.occurredAt) - Date.parse(b.occurredAt);
}

function compareIds(a: string, b: string): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

function firstEventTime(section: LandTimelineSection): number {
  const time = section.events.length > 0 ? Date.parse(section.events[0].occurredAt) : NaN;
  // No (or unreadable) event time sorts after those that have one.
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

export function buildLandTimeline(lineage: Lineage): {
  sections: LandTimelineSection[];
  truncated: boolean;
} {
  const sections = lineage.nodes.map<LandTimelineSection>((node) => ({
    propertyId: node.propertyId,
    status: node.status,
    generation: node.generation,
    isQueried: node.propertyId === lineage.propertyId,
    replaces: [...node.predecessors],
    replacedBy: [...node.successors],
    events: [...node.events].sort(byTime),
  }));

  sections.sort((a, b) => {
    if (a.generation !== b.generation) return a.generation - b.generation;
    const ta = firstEventTime(a);
    const tb = firstEventTime(b);
    if (ta !== tb) return ta < tb ? -1 : 1;
    return compareIds(a.propertyId, b.propertyId);
  });

  return { sections, truncated: lineage.truncated };
}
