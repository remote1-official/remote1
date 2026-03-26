// src/app/api/session/pair/route.ts
// POST: 런처가 PIN을 서버에 전달 → 해당 PC의 pendingPin에 저장
// GET: 모니터가 자기 PC의 pendingPin을 확인
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  try {
    const { machineId, pin } = await req.json()
    if (!machineId || !pin) {
      return NextResponse.json({ error: 'machineId, pin 필수' }, { status: 400 })
    }

    await prisma.machine.update({
      where: { id: machineId },
      data: { pendingPin: pin },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[PAIR POST]', error)
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const machineId = url.searchParams.get('machineId')
    if (!machineId) {
      return NextResponse.json({ error: 'machineId 필수' }, { status: 400 })
    }

    const machine = await prisma.machine.findUnique({
      where: { id: machineId },
      select: { pendingPin: true },
    })

    if (machine?.pendingPin) {
      // PIN을 반환하고 바로 삭제 (1회성)
      await prisma.machine.update({
        where: { id: machineId },
        data: { pendingPin: null },
      })
      return NextResponse.json({ pin: machine.pendingPin })
    }

    return NextResponse.json({ pin: null })
  } catch (error) {
    console.error('[PAIR GET]', error)
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}
