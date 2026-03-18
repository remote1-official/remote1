// src/app/api/payment/create-order/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { nanoid } from 'nanoid' // 또는 crypto.randomUUID()

// 크레딧 패키지 정의
const CREDIT_PACKAGES: Record<string, { amount: number; credits: number; label: string }> = {
  basic:    { amount: 9900,  credits: 60,   label: '기본 1시간' },
  standard: { amount: 29900, credits: 180,  label: '스탠다드 3시간' },
  premium:  { amount: 59900, credits: 600,  label: '프리미엄 10시간' },
}

const orderSchema = z.object({
  packageId: z.enum(['basic', 'standard', 'premium']),
})

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })
  }

  const body = await req.json()
  const parsed = orderSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: '잘못된 패키지입니다' }, { status: 400 })
  }

  const pkg = CREDIT_PACKAGES[parsed.data.packageId]
  const orderId = `ORDER-${nanoid(16)}`

  // 결제 대기 레코드 생성
  await prisma.payment.create({
    data: {
      userId: user.userId,
      orderId,
      amount: pkg.amount,
      creditsAdded: pkg.credits,
      status: 'PENDING',
    },
  })

  return NextResponse.json({
    orderId,
    amount: pkg.amount,
    orderName: pkg.label,
    clientKey: process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY,
  })
}
