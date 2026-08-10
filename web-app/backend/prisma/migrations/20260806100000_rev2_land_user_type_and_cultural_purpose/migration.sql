-- Rev.2 audit fixes.
--
-- R2-05: mục B Phụ lục II TT 08/2024 uses TCN for "cơ quan nhà nước, cơ quan
-- Đảng, đơn vị vũ trang nhân dân". TCC is the group code for "tổ chức trong
-- nước" and was the wrong value to expose. Renamed in place so existing rows
-- keep their meaning instead of being dropped.
ALTER TYPE "LandUserType" RENAME VALUE 'TCC' TO 'TCN';

-- R2-03/R2-09: Điều 178 khoản 4 makes community land perpetual only when it is
-- used to preserve ethnic cultural identity. Community tenure alone is an
-- ordinary agricultural term, so the purpose has to be recorded explicitly.
ALTER TABLE "properties" ADD COLUMN "culturalPreservation" BOOLEAN NOT NULL DEFAULT false;
