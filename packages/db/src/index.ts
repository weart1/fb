import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

const globalForPrisma = globalThis as unknown as { __weartPrisma?: PrismaClient };

/** Singleton Prisma client (survives Next.js dev hot reloads). */
export const prisma: PrismaClient = globalForPrisma.__weartPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.__weartPrisma = prisma;
export { decryptJson, encryptJson } from './secrets';
export { hashPassword, verifyPassword } from './password';
