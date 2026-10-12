import { BadRequestException, GoneException, NotFoundException } from '@nestjs/common';
import { Property } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/** The plot behind a proof route: 404 unknown, 410 revoked, 400 not yet issued. */
export async function requireIssuedProperty(
  prisma: PrismaService,
  propertyId: string,
): Promise<Property> {
  const property = await prisma.property.findUnique({ where: { propertyId } });
  if (!property) {
    throw new NotFoundException(`Unknown propertyId ${propertyId}`);
  }
  if (property.status === 'REVOKED') {
    throw new GoneException(
      `The certificate for property ${propertyId} has been revoked. Its leaf is no longer in ` +
        `the tree, so no Merkle proof exists — see the on-chain revocations mapping for the reason.`,
    );
  }
  if (property.ownerCommitment === null) {
    throw new BadRequestException(
      `Property ${propertyId} has been imported but not issued yet, so it has no leaf and ` +
        `is not in the Merkle tree (the owner commitment is created at issue time — D14)`,
    );
  }
  return property;
}
