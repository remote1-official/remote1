// src/app/api/session/connect/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const authUser = getAuthUser(req)
    if (!authUser) {
      return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })
    }

    // 유저 조회 (크레딧 확인)
    const user = await prisma.user.findUnique({ where: { id: authUser.userId } })
    if (!user) {
      return NextResponse.json({ error: '사용자를 찾을 수 없습니다' }, { status: 404 })
    }

    if (user.credits <= 0) {
      return NextResponse.json(
        { error: '크레딧이 부족합니다. 웹사이트에서 크레딧을 충전해주세요.' },
        { status: 400 }
      )
    }

    // 이미 활성 세션이 있는지 확인
    const existing = await prisma.session.findFirst({
      where: { userId: authUser.userId, status: 'ACTIVE' },
      include: { machine: true },
    })

    if (existing) {
      // 기존 세션 정보를 그대로 반환 (재연결 허용)
      return NextResponse.json({
        sessionId:   existing.id,
        host:        existing.machine.sunshineHost,
        machineName: existing.machine.name,
        machineSpec: existing.machine.spec ?? '',
      })
    }

    // 빈 PC 배정 (트랜잭션으로 race condition 방지)
    const result = await prisma.$transaction(async (tx) => {
      const machine = await tx.machine.findFirst({
        where: { isAvailable: true },
        orderBy: { updatedAt: 'asc' }, // 가장 오래 쉰 PC 우선
      })

      if (!machine) {
        throw new Error('현재 이용 가능한 PC가 없습니다. 잠시 후 다시 시도해주세요.')
      }

      // PC를 사용 불가 상태로 변경
      await tx.machine.update({
        where: { id: machine.id },
        data: { isAvailable: false },
      })

      // 세션 생성
      const session = await tx.session.create({
        data: {
          userId:    authUser.userId,
          machineId: machine.id,
          status:    'ACTIVE',
        },
      })

      return { machine, session }
    })

    return NextResponse.json({
      sessionId:   result.session.id,
      host:        result.machine.sunshineHost,
      machineName: result.machine.name,
      machineSpec: result.machine.spec ?? '',
    })
  } catch (error: unknown) {
    console.error('[SESSION CONNECT ERROR]', error)
    const message = error instanceof Error ? error.message : '서버 오류가 발생했습니다'
    const status  = message.includes('이용 가능한 PC가 없습니다') ? 503 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
