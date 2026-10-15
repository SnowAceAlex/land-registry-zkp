import { PrismaService } from '../prisma/prisma.service';
import { hashOfficeKey } from '../offices/office-key';
import { resolveActor } from './actor-resolver';

const HQ = { id: 1, code: 'HQ', name: 'Head office', kind: 'HEAD_OFFICE' };
const CN01 = { id: 9, code: 'CN01', name: 'Branch 01', kind: 'BRANCH' };

function prismaWith(opts: { hq?: unknown; credential?: unknown }) {
  const landOffice = { findUnique: jest.fn().mockResolvedValue(opts.hq ?? null) };
  const officeCredential = { findFirst: jest.fn().mockResolvedValue(opts.credential ?? null) };
  return { prisma: { landOffice, officeCredential } as unknown as PrismaService, landOffice, officeCredential };
}

describe('resolveActor', () => {
  it('maps the env key to the HQ office with central scope and no credential', async () => {
    const { prisma, officeCredential } = prismaWith({ hq: HQ });
    const actor = await resolveActor(prisma, 'env-secret', 'env-secret');
    expect(actor).toEqual({
      officeId: 1,
      officeCode: 'HQ',
      officeName: 'Head office',
      officeKind: 'HEAD_OFFICE',
      scope: 'CENTRAL',
      credentialId: null,
    });
    expect(officeCredential.findFirst).not.toHaveBeenCalled();
  });

  it('throws when the env key matches but the HQ row is missing', async () => {
    const { prisma } = prismaWith({});
    await expect(resolveActor(prisma, 'k', 'k')).rejects.toThrow('HQ office missing');
  });

  it('resolves a DB key by its sha256 to a branch actor', async () => {
    const { prisma, officeCredential } = prismaWith({
      credential: { id: 5, office: CN01 },
    });
    const actor = await resolveActor(prisma, 'branch-key', 'env-secret');
    expect(actor).toEqual({
      officeId: 9,
      officeCode: 'CN01',
      officeName: 'Branch 01',
      officeKind: 'BRANCH',
      scope: 'BRANCH',
      credentialId: 5,
    });
    expect(officeCredential.findFirst).toHaveBeenCalledWith({
      where: { keyHash: hashOfficeKey('branch-key'), revokedAt: null },
      include: { office: true },
    });
  });

  it('gives a DB key on a SITE office central scope', async () => {
    const { prisma } = prismaWith({
      credential: { id: 6, office: { id: 2, code: 'CS2', name: 'Site 2', kind: 'SITE' } },
    });
    expect((await resolveActor(prisma, 'x', undefined))?.scope).toBe('CENTRAL');
  });

  it('returns null for a revoked or unknown key', async () => {
    const { prisma } = prismaWith({});
    expect(await resolveActor(prisma, 'nope', 'env-secret')).toBeNull();
  });

  it('works without an env key: the env path is disabled, DB keys still resolve', async () => {
    const { prisma } = prismaWith({ credential: { id: 5, office: CN01 } });
    expect((await resolveActor(prisma, 'branch-key', undefined))?.officeCode).toBe('CN01');
  });

  it('never matches an empty key against an unset env key', async () => {
    const { prisma, landOffice } = prismaWith({ hq: HQ });
    expect(await resolveActor(prisma, '', undefined)).toBeNull();
    expect(landOffice.findUnique).not.toHaveBeenCalled();
  });
});
