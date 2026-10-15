import { timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { hashOfficeKey } from '../offices/office-key';
import { Actor, HEAD_OFFICE_CODE, scopeOf } from './actor';

// D86: the env GOV_API_KEY is the head office; any other key is looked up by its hash.
export async function resolveActor(
  prisma: PrismaService,
  key: string,
  envKey: string | undefined,
): Promise<Actor | null> {
  if (!key) return null;

  if (envKey && safeEqual(key, envKey)) {
    const hq = await prisma.landOffice.findUnique({ where: { code: HEAD_OFFICE_CODE } });
    if (!hq) throw new Error('HQ office missing — run migrations');
    return {
      officeId: hq.id,
      officeCode: hq.code,
      officeName: hq.name,
      officeKind: hq.kind,
      scope: scopeOf(hq.kind),
      credentialId: null,
    };
  }

  const credential = await prisma.officeCredential.findFirst({
    where: { keyHash: hashOfficeKey(key), revokedAt: null },
    include: { office: true },
  });
  if (!credential) return null;
  const { office } = credential;
  return {
    officeId: office.id,
    officeCode: office.code,
    officeName: office.name,
    officeKind: office.kind,
    scope: scopeOf(office.kind),
    credentialId: credential.id,
  };
}

/** Constant-time compare so a wrong key cannot be discovered byte by byte. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
