import { defineConfig, env } from 'prisma/config';

/**
 * Prisma 7 configuration file.
 *
 * The database connection URL is now managed here instead of in schema.prisma.
 * This replaces the `url = env("DATABASE_URL")` line that was removed from
 * the datasource block in schema.prisma.
 *
 * See: https://pris.ly/d/config-datasource
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
});
