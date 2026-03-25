// src/app/api/mypage/schedule/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const authUser = getAuthUser(req)
  if (!authUser) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })

  // Active session + its schedule
  const session = await prisma.session.findFirst({
    where:   { userId: authUser.userId, status: 'ACTIVE' },
    include: { machine: { select: { name: true } } },
    orderBy: { startedAt: 'desc' },
  })

  // Recent ended sessions with scheduledEndAt (history)
  const history = await prisma.session.findMany({
    where:   { userId: authUser.userId, scheduledEndAt: { not: null } },
    orderBy: { startedAt: 'desc' },
    take: 5,
    select: { id: true, startedAt: true, scheduledEndAt: true, endedAt: true, status: true },
  })

  return NextResponse.json({ session, history })
}

const scheduleSchema = z.object({
  sessionId:     z.string(),
  scheduledEndAt: z.string().datetime(),
})

export async function POST(req: NextRequest) {
  const authUser = getAuthUser(req)
  if (!authUser) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })

  const body   = await req.json()
  const parsed = scheduleSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 })

  // Verify ownership
  const session = await prisma.session.findFirst({
    where: { id: parsed.data.sessionId, userId: authUser.userId, status: 'ACTIVE' },
  })
  if (!session) return NextResponse.json({ error: '활성 세션을 찾을 수 없습니다' }, { status: 404 })

  const endAt = new Date(parsed.data.scheduledEndAt)
  if (endAt <= new Date()) {
    return NextResponse.json({ error: '예약 시간은 현재 시간 이후여야 합니다' }, { status: 400 })
  }

  const updated = await prisma.session.update({
    where: { id: session.id },
    data:  { scheduledEndAt: endAt },
  })

  return NextResponse.json({ session: updated })
}

export async function DELETE(req: NextRequest) {
  const authUser = getAuthUser(req)
  if (!authUser) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get('sessionId')
  if (!sessionId) return NextResponse.json({ error: 'sessionId가 필요합니다' }, { status: 400 })

  const session = await prisma.session.findFirst({
    where: { id: sessionId, userId: authUser.userId, status: 'ACTIVE' },
  })
  if (!session) return NextResponse.json({ error: '활성 세션을 찾을 수 없습니다' }, { status: 404 })

  const updated = await prisma.session.update({
    where: { id: session.id },
    data:  { scheduledEndAt: null },
  })

  return NextResponse.json({ session: updated })
}
