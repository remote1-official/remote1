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

    if (user.isSuspended) {
      return NextResponse.json(
        { error: '이용이 정지된 계정입니다. 고객센터에 문의해주세요.' },
        { status: 403 }
      )
    }

    if ((user.credits ?? 0) <= 0) {
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
      return NextResponse.json({
        sessionId:   existing.id,
        machineId:   existing.machine.id,
        host:        existing.machine.sunshineHost,
        machineName: existing.machine.name,
        machineSpec: existing.machine.spec ?? '',
      })
    }

    // 빈 PC 배정 (READY 상태이고 사용 가능한 PC)
    const result = await prisma.$transaction(async (tx) => {
      const machine = await tx.machine.findFirst({
        where: {
          isAvailable: true,
          status: 'READY',
        },
        orderBy: { updatedAt: 'asc' },
      })

      if (!machine) {
        return null // 빈 PC 없음 → 대기열로
      }

      // PC를 IN_USE 상태로 변경
      await tx.machine.update({
        where: { id: machine.id },
        data: { status: 'IN_USE', isAvailable: false, lastUserId: authUser.userId },
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

    if (result) {
      // PC 배정 성공
      return NextResponse.json({
        sessionId:   result.session.id,
        machineId:   result.machine.id,
        host:        result.machine.sunshineHost,
        machineName: result.machine.name,
        machineSpec: result.machine.spec ?? '',
      })
    }

    // ─── 빈 PC 없음 → 대기열에 추가 ──────────────────────────────────────
    // 이미 대기 중인지 확인
    const existingQueue = await prisma.queue.findFirst({
      where: { userId: authUser.userId, status: 'WAITING' },
    })

    if (existingQueue) {
      // 이미 대기 중 → 현재 위치 반환
      const ahead = await prisma.queue.count({
        where: { status: 'WAITING', position: { lt: existingQueue.position } },
      })
      return NextResponse.json({
        queued: true,
        position: ahead + 1,
        queueId: existingQueue.id,
      }, { status: 202 })
    }

    // 새 대기 등록
    const lastInQueue = await prisma.queue.findFirst({
      where: { status: 'WAITING' },
      orderBy: { position: 'desc' },
    })
    const newPosition = (lastInQueue?.position ?? 0) + 1

    const queueEntry = await prisma.queue.create({
      data: {
        userId: authUser.userId,
        position: newPosition,
        status: 'WAITING',
      },
    })

    const ahead = await prisma.queue.count({
      where: { status: 'WAITING', position: { lt: newPosition } },
    })

    return NextResponse.json({
      queued: true,
      position: ahead + 1,
      queueId: queueEntry.id,
    }, { status: 202 })

  } catch (error: unknown) {
    console.error('[SESSION CONNECT ERROR]', error)
    const message = error instanceof Error ? error.message : '서버 오류가 발생했습니다'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
