// src/app/api/mypage/sessions/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const authUser = getAuthUser(req)
  if (!authUser) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const page  = Math.max(1, Number(searchParams.get('page')  ?? 1))
  const limit = Math.min(20, Math.max(1, Number(searchParams.get('limit') ?? 10)))
  const skip  = (page - 1) * limit

  const [sessions, total] = await Promise.all([
    prisma.session.findMany({
      where:   { userId: authUser.userId },
      orderBy: { startedAt: 'desc' },
      skip,
      take: limit,
      include: { machine: { select: { name: true, spec: true } } },
    }),
    prisma.session.count({ where: { userId: authUser.userId } }),
  ])

  return NextResponse.json({ sessions, total, page, limit })
}
