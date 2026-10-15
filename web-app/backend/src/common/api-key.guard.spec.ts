import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeyGuard } from './api-key.guard';

const HQ = { id: 1, code: 'HQ', name: 'Head office', kind: 'HEAD_OFFICE' };

function run(header: string | undefined, prisma: Partial<Record<string, unknown>>) {
  const request: Record<string, unknown> = { header: () => header };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const guard = new ApiKeyGuard(prisma as unknown as PrismaService);
  return { request, result: guard.canActivate(ctx) };
}

describe('ApiKeyGuard', () => {
  const saved = process.env.GOV_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.GOV_API_KEY;
    else process.env.GOV_API_KEY = saved;
  });

  it('attaches the HQ actor for the env key', async () => {
    process.env.GOV_API_KEY = 'env-key';
    const { request, result } = run('env-key', {
      landOffice: { findUnique: jest.fn().mockResolvedValue(HQ) },
    });
    await expect(result).resolves.toBe(true);
    expect(request.actor).toMatchObject({ officeCode: 'HQ', scope: 'CENTRAL' });
  });

  it('rejects a missing header with 401', async () => {
    process.env.GOV_API_KEY = 'env-key';
    await expect(run(undefined, {}).result).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an unknown key with 401, also when GOV_API_KEY is unset', async () => {
    delete process.env.GOV_API_KEY;
    const prisma = { officeCredential: { findFirst: jest.fn().mockResolvedValue(null) } };
    await expect(run('whatever', prisma).result).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
