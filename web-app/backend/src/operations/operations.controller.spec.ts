import { GUARDS_METADATA } from '@nestjs/common/constants';

import { CentralOnlyGuard } from '../common/central-only.guard';
import { ApiKeyGuard } from '../common/api-key.guard';
import { OperationsController } from './operations.controller';

const guardsOf = (method: keyof OperationsController): unknown[] =>
  Reflect.getMetadata(GUARDS_METADATA, OperationsController.prototype[method]) ?? [];

describe('OperationsController guards (D86/D87)', () => {
  it('puts the API key guard on the whole class', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, OperationsController)).toContain(ApiKeyGuard);
  });

  it.each(['hold', 'release'] as const)('%s is central only', (method) => {
    expect(guardsOf(method)).toContain(CentralOnlyGuard);
  });

  it('withdraw checks scope per kind in the service, so no route-level central guard', () => {
    expect(guardsOf('withdraw')).not.toContain(CentralOnlyGuard);
    expect(guardsOf('list')).not.toContain(CentralOnlyGuard);
  });

  it('opens the overview to both scopes and the office table to central only', () => {
    expect(guardsOf('overview')).not.toContain(CentralOnlyGuard);
    expect(guardsOf('offices')).toContain(CentralOnlyGuard);
  });
});
