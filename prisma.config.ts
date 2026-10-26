import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnvConfig } from '@next/env';
import { defineConfig } from 'prisma/config';
loadEnvConfig(process.cwd());
// Zero-config default; keep in sync with src/lib/db.ts.
if (!process.env.DATABASE_URL) {
  mkdirSync(join(process.cwd(), 'data'), { recursive: true });
  process.env.DATABASE_URL = `file:${join(process.cwd(), 'data', 'evailbox.db')}`;
}
export default defineConfig({ schema: 'prisma/schema.prisma' });
