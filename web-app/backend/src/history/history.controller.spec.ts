import { NotFoundException } from '@nestjs/common';

import { HistoryController } from './history.controller';
import { LineageService } from '../lineage/lineage.service';
import { PropertyEventService } from './property-event.service';

describe('HistoryController', () => {
  it('adds the direct lineage neighbours to the history', async () => {
    const events = {
      listFor: jest.fn().mockResolvedValue([
        {
          id: 1,
          propertyId: '10',
          kind: 'ISSUED',
          rootVersion: 1,
          txHash: null,
          previousOwnerCommitment: null,
          newOwnerCommitment: 'c',
          previousLeaf: null,
          newLeaf: 'l',
          detail: null,
          occurredAt: new Date(0),
        },
      ]),
    } as unknown as PropertyEventService;
    const lineage = {
      predecessorsOf: jest.fn().mockResolvedValue(new Map([['10', ['1', '2']]])),
      successorsOf: jest.fn().mockResolvedValue(new Map()),
    } as unknown as LineageService;

    const result = await new HistoryController(events, lineage).history('10');

    expect(result.lineage).toEqual({ predecessors: ['1', '2'], successors: [] });
    expect(result.events).toHaveLength(1);
    expect(Object.keys(result.events[0]).sort()).not.toContain('id');
  });

  it('404s the lineage route for an unknown property', async () => {
    const lineage = { lineageOf: jest.fn().mockResolvedValue(null) } as unknown as LineageService;
    const controller = new HistoryController({} as PropertyEventService, lineage);

    await expect(controller.lineageOf('404')).rejects.toBeInstanceOf(NotFoundException);
  });
});
