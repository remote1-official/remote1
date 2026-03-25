// src/app/api/mypage/payments/route.ts
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

  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where:   { userId: authUser.userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.payment.count({ where: { userId: authUser.userId } }),
  ])

  return NextResponse.json({ payments, total, page, limit })
}
