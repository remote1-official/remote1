// src/app/api/session/queue-status/route.ts
// GET: 내 대기열 상태 확인 (폴링용)
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try {
    const authUser = getAuthUser(req)
    if (!authUser) {
      return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })
    }

    // 대기열에서 내 항목 찾기
    const myQueue = await prisma.queue.findFirst({
      where: { userId: authUser.userId, status: 'WAITING' },
    })

    if (!myQueue) {
      return NextResponse.json({ queued: false })
    }

    // 내 앞에 몇 명?
    const ahead = await prisma.queue.count({
      where: { status: 'WAITING', position: { lt: myQueue.position } },
    })

    return NextResponse.json({
      queued: true,
      position: ahead + 1,
      queueId: myQueue.id,
    })
  } catch (error) {
    console.error('[QUEUE STATUS]', error)
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}

// DELETE: 대기열에서 나가기
export async function DELETE(req: NextRequest) {
  try {
    const authUser = getAuthUser(req)
    if (!authUser) {
      return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })
    }

    await prisma.queue.updateMany({
      where: { userId: authUser.userId, status: 'WAITING' },
      data: { status: 'CANCELLED' },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[QUEUE CANCEL]', error)
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}
