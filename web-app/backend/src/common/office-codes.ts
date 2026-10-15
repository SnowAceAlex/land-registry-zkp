import { PrismaService } from '../prisma/prisma.service';

/** office id → code, loaded once per call so DTOs can name offices without N+1 reads. */
export async function officeCodes(prisma: PrismaService): Promise<Map<number, string>> {
  const offices = await prisma.landOffice.findMany({ select: { id: true, code: true } });
  return new Map(offices.map((o) => [o.id, o.code]));
}
