import { LandOfficeKind } from '@prisma/client';
import { Request } from 'express';

export type ActorScope = 'CENTRAL' | 'BRANCH';

export interface Actor {
  officeId: number;
  officeCode: string;
  officeName: string;
  officeKind: LandOfficeKind;
  scope: ActorScope;
  /** null when the caller used the env GOV_API_KEY. */
  credentialId: number | null;
}

export const HEAD_OFFICE_CODE = 'HQ';

// D86: only a district branch is area-limited; HQ and the two sites act everywhere.
export function scopeOf(kind: LandOfficeKind): ActorScope {
  return kind === 'BRANCH' ? 'BRANCH' : 'CENTRAL';
}

export interface ActorRequest extends Request {
  actor?: Actor;
}
