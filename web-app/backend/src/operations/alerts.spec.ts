import { BRANCH_ACTOR, CENTRAL_ACTOR } from '../../test/factories';
import { Alert, OperationsSnapshot, alertsForActor, deriveAlerts } from './alerts';

const quiet: OperationsSnapshot = {
  chainRoot: '77',
  dbLatestRoot: '77',
  openDraftRoot: null,
  pendingTransfers: [],
  revocationsWaiting: 0,
  revocationCap: 150,
  staleItems: [],
  archivesNearExpiry: [],
  archivesExpiredUndownloaded: [],
  unassignedProperties: 0,
  heldItems: 0,
  authorityHasRole: true,
  attesterHasRole: true,
};

const codes = (s: Partial<OperationsSnapshot>) =>
  deriveAlerts({ ...quiet, ...s }).map((a) => a.code);

describe('deriveAlerts (D89)', () => {
  it('is empty for a quiet registry', () => {
    expect(deriveAlerts(quiet)).toEqual([]);
  });

  describe('ChainAheadOfDatabase', () => {
    it('fires when the chain root is neither the DB root nor the open draft root', () => {
      expect(deriveAlerts({ ...quiet, chainRoot: '99' })).toEqual([
        { code: 'ChainAheadOfDatabase', severity: 'error' },
      ]);
    });

    it('stays quiet while the open draft root is already on chain', () => {
      expect(codes({ chainRoot: '99', openDraftRoot: '99' })).toEqual([]);
    });

    it('treats an empty DB with the zero root as in sync', () => {
      expect(codes({ chainRoot: '0', dbLatestRoot: null })).toEqual([]);
    });

    it('fires for an empty DB when the chain already has a root', () => {
      expect(codes({ chainRoot: '5', dbLatestRoot: null })).toEqual(['ChainAheadOfDatabase']);
    });
  });

  it('PendingTransfersWouldBreak: one warning per office with a count', () => {
    const alerts = deriveAlerts({
      ...quiet,
      pendingTransfers: [
        { officeCode: 'CN01', count: 3 },
        { officeCode: null, count: 1 },
        { officeCode: 'CN02', count: 0 },
      ],
    });
    expect(alerts).toEqual([
      { code: 'PendingTransfersWouldBreak', severity: 'warning', count: 3, officeCode: 'CN01' },
      { code: 'PendingTransfersWouldBreak', severity: 'warning', count: 1 },
    ]);
  });

  describe('RevocationBacklog', () => {
    it('carries the waiting count and the rounds needed', () => {
      expect(deriveAlerts({ ...quiet, revocationsWaiting: 2140 })).toEqual([
        { code: 'RevocationBacklog', severity: 'warning', count: 2140, ref: 15 },
      ]);
    });

    it('is quiet at exactly the cap', () => {
      expect(codes({ revocationsWaiting: 150 })).toEqual([]);
    });

    it('needs two rounds one over the cap', () => {
      expect(deriveAlerts({ ...quiet, revocationsWaiting: 151 })[0].ref).toBe(2);
    });
  });

  it('StaleQueueItem: one warning per office', () => {
    expect(
      deriveAlerts({
        ...quiet,
        staleItems: [
          { officeCode: 'CN07', count: 2 },
          { officeCode: null, count: 4 },
        ],
      }),
    ).toEqual([
      { code: 'StaleQueueItem', severity: 'warning', count: 2, officeCode: 'CN07' },
      { code: 'StaleQueueItem', severity: 'warning', count: 4 },
    ]);
  });

  it('ArchiveNotDownloaded: a warning per office and round', () => {
    expect(
      deriveAlerts({ ...quiet, archivesNearExpiry: [{ officeCode: 'CN07', changeSetId: 398 }] }),
    ).toEqual([
      { code: 'ArchiveNotDownloaded', severity: 'warning', officeCode: 'CN07', ref: 398 },
    ]);
  });

  it('ArchiveExpiredUndownloaded: an error per office and round', () => {
    expect(
      deriveAlerts({
        ...quiet,
        archivesExpiredUndownloaded: [{ officeCode: 'CN03', changeSetId: 12 }],
      }),
    ).toEqual([
      { code: 'ArchiveExpiredUndownloaded', severity: 'error', officeCode: 'CN03', ref: 12 },
    ]);
  });

  it('UnassignedProperties and HeldItems are info with a count', () => {
    expect(deriveAlerts({ ...quiet, unassignedProperties: 6, heldItems: 2 })).toEqual([
      { code: 'UnassignedProperties', severity: 'info', count: 6 },
      { code: 'HeldItems', severity: 'info', count: 2 },
    ]);
  });

  it('flags a missing authority or attester role as an error', () => {
    expect(deriveAlerts({ ...quiet, authorityHasRole: false })).toEqual([
      { code: 'AuthorityRoleMissing', severity: 'error' },
    ]);
    expect(deriveAlerts({ ...quiet, attesterHasRole: false })).toEqual([
      { code: 'AttesterRoleMissing', severity: 'error' },
    ]);
  });

  it('lists errors first, then warnings, then info', () => {
    const severities = deriveAlerts({
      ...quiet,
      chainRoot: '1',
      heldItems: 1,
      revocationsWaiting: 999,
      attesterHasRole: false,
    }).map((a) => a.severity);
    expect(severities).toEqual(['error', 'error', 'warning', 'info']);
  });
});

describe('alertsForActor (D86)', () => {
  const alerts: Alert[] = [
    { code: 'ChainAheadOfDatabase', severity: 'error' },
    { code: 'StaleQueueItem', severity: 'warning', count: 2, officeCode: 'CN01' },
    { code: 'StaleQueueItem', severity: 'warning', count: 5, officeCode: 'CN02' },
    { code: 'RevocationBacklog', severity: 'warning', count: 400, ref: 3 },
    { code: 'HeldItems', severity: 'info', count: 1 },
  ];

  it('gives a central office everything', () => {
    expect(alertsForActor(alerts, CENTRAL_ACTOR)).toEqual(alerts);
  });

  it('gives a branch its own office plus the chain-ahead error', () => {
    expect(alertsForActor(alerts, BRANCH_ACTOR)).toEqual([alerts[0], alerts[1]]);
  });
});
