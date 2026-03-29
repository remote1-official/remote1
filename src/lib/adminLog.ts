import { prisma } from '@/lib/prisma'

export async function logAdmin(adminId: string, action: string, target: string, detail: string) {
  try {
    await prisma.adminLog.create({
      data: { adminId, action, target, detail },
    })
  } catch (e) {
    console.error('[AdminLog] Failed to write log:', e)
  }
}
