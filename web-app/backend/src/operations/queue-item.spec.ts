import { toQueueItem } from './queue-item';

const offices = new Map([
  [1, 'HQ'],
  [9, 'CN01'],
  [10, 'CN02'],
]);
const now = new Date('2026-10-15T12:00:00Z');
const row = {
  id: 7,
  propertyId: '1001',
  status: 'READY',
  officeId: 1,
  landOfficeId: 9,
  heldAt: null,
  heldReason: null,
  createdAt: new Date('2026-10-14T08:30:00Z'),
};

describe('toQueueItem (D87)', () => {
  it('exposes exactly the enumerated keys, even when the row carries secrets', () => {
    const item = toQueueItem(
      'issuance',
      { ...row, ownerSecret: '999', newOwnerSecret: '888', proof: {} } as never,
      offices,
      now,
    );
    expect(Object.keys(item).sort()).toEqual(
      [
        'ageHours',
        'byFallback',
        'held',
        'heldReason',
        'id',
        'kind',
        'landOfficeCode',
        'officeCode',
        'propertyId',
        'status',
      ].sort(),
    );
  });

  it('names the offices and floors the age to whole hours', () => {
    const item = toQueueItem('transfer', row, offices, now);
    expect(item).toMatchObject({ officeCode: 'HQ', landOfficeCode: 'CN01', ageHours: 27 });
  });

  it('flags a central office acting on another office plot, not its own or an unassigned one', () => {
    expect(toQueueItem('revocation', row, offices, now).byFallback).toBe(true);
    expect(toQueueItem('revocation', { ...row, officeId: 9 }, offices, now).byFallback).toBe(false);
    const unassigned = toQueueItem('revocation', { ...row, landOfficeId: null }, offices, now);
    expect(unassigned).toMatchObject({ byFallback: false, landOfficeCode: null });
  });

  it('reports hold state', () => {
    const held = toQueueItem(
      'issuance',
      { ...row, heldAt: new Date(), heldReason: 'wait' },
      offices,
      now,
    );
    expect(held).toMatchObject({ held: true, heldReason: 'wait' });
    expect(toQueueItem('issuance', row, offices, now).held).toBe(false);
  });
});
