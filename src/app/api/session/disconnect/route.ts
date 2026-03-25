// src/app/api/session/disconnect/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const authUser = getAuthUser(req)
    if (!authUser) {
      return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })
    }

    // 활성 세션 조회
    const session = await prisma.session.findFirst({
      where: { userId: authUser.userId, status: 'ACTIVE' },
      include: { machine: true },
    })

    if (!session) {
      return NextResponse.json({ error: '활성 세션이 없습니다' }, { status: 404 })
    }

    const now        = new Date()
    const elapsedMs  = now.getTime() - session.startedAt.getTime()
    // 1분 단위 올림: 30초 사용 → 1분, 61초 사용 → 2분
    const creditsToDeduct = Math.ceil(elapsedMs / 60_000)

    // 세션 종료 + 크레딧 차감 + PC 복구 (트랜잭션)
    const [updatedUser] = await prisma.$transaction(async (tx) => {
      // 실제 보유 크레딧을 확인해 음수 방지
      const user = await tx.user.findUnique({ where: { id: authUser.userId } })
      const actualDeduction = Math.min(creditsToDeduct, Math.max(0, user?.credits ?? 0))

      const updated = await tx.user.update({
        where: { id: authUser.userId },
        data:  { credits: { decrement: actualDeduction } },
      })

      await tx.session.update({
        where: { id: session.id },
        data: {
          status:     'ENDED',
          endedAt:    now,
          creditsUsed: actualDeduction,
        },
      })

      await tx.machine.update({
        where: { id: session.machineId },
        data:  { isAvailable: true },
      })

      return [updated, actualDeduction]
    })

    return NextResponse.json({
      message:          '세션이 종료되었습니다',
      creditsUsed:      creditsToDeduct,
      creditsRemaining: Math.max(0, updatedUser.credits),
    })
  } catch (error) {
    console.error('[SESSION DISCONNECT ERROR]', error)
    return NextResponse.json({ error: '서버 오류가 발생했습니다' }, { status: 500 })
  }
}
