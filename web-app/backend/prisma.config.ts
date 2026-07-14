import { defineConfig } from 'prisma/config';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from monorepo root (two levels up from backend directory process.cwd())
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

/**
 * Prisma 7 configuration file.
 *
 * This file must reside in the root of the backend package (next to package.json).
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
