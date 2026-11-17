-- D92: the central office acknowledges an expired, never-downloaded archive; its alert stops.
ALTER TABLE "change_set_archives" ADD COLUMN "expiryAcknowledgedAt" TIMESTAMP(3),
ADD COLUMN "expiryAcknowledgedByOfficeId" INTEGER;
