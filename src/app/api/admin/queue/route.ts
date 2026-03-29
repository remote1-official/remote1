// src/app/api/admin/queue/route.ts
// GET: 대기열 조회 / DELETE: 대기열 전체 초기화
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin, isAdminError } from '@/lib/adminAuth'

export async function GET(req: NextRequest) {
  const admin = requireAdmin(req); if (isAdminError(admin)) return admin
  try {
    const queue = await prisma.queue.findMany({
      where: { status: 'WAITING' },
      orderBy: { position: 'asc' },
      include: {
        user: { select: { id: true, username: true, email: true } },
      },
    })

    return NextResponse.json({ queue, total: queue.length })
  } catch (error) {
    console.error('[ADMIN QUEUE GET]', error)
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const admin = requireAdmin(req); if (isAdminError(admin)) return admin
  try {
    await prisma.queue.updateMany({
      where: { status: 'WAITING' },
      data: { status: 'CANCELLED' },
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[ADMIN QUEUE DELETE]', error)
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}
