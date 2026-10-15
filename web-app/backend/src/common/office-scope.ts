import { ForbiddenException } from '@nestjs/common';
import { Actor } from './actor';

export interface ScopedPlot {
  propertyId: string;
  landOfficeId: number | null;
}

// D86: a branch may act only on plots assigned to its own office.
export function assertCanActOn(actor: Actor, plot: ScopedPlot): void {
  if (actor.scope === 'CENTRAL') return;
  if (plot.landOfficeId === actor.officeId) return;
  throw new ForbiddenException({
    reason: 'OutsideOfficeArea',
    message: `Property ${plot.propertyId} is outside the area of office ${actor.officeCode}`,
    details: { propertyId: plot.propertyId },
  });
}

/** True when a central office acts on a plot that belongs to another office. */
export function isFallback(actorOfficeId: number, landOfficeId: number | null): boolean {
  return landOfficeId !== null && actorOfficeId !== landOfficeId;
}
