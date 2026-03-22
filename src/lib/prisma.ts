// src/lib/prisma.ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function buildDatabaseUrl() {
  const url = process.env.DATABASE_URL ?? ''
  // pgbouncer=true disables prepared statements — required for PgBouncer session/transaction mode
  if (url.includes('pgbouncer')) return url
  return url + (url.includes('?') ? '&' : '?') + 'pgbouncer=true'
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: buildDatabaseUrl() } },
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
