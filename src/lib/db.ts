import 'server-only';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
// Zero-config default; keep in sync with prisma.config.ts (which also creates ./data).
const datasourceUrl =
  process.env.DATABASE_URL || `file:${join(process.cwd(), 'data', 'evailbox.db')}`;
const globalDb = globalThis as unknown as { prisma?: PrismaClient };
export const db = globalDb.prisma ?? new PrismaClient({ datasourceUrl, log: ['error'] });
if (process.env.NODE_ENV !== 'production') globalDb.prisma = db;
