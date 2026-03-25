// src/app/api/payment/create-order/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { nanoid } from 'nanoid' // 또는 crypto.randomUUID()

// 크레딧 패키지 정의
const CREDIT_PACKAGES: Record<string, { amount: number; credits: number; label: string }> = {
  hour10:  { amount: 11000, credits: 600,  label: '10시간 이용권' },
  hour30:  { amount: 30000, credits: 1800, label: '30시간 이용권' },
  hour50:  { amount: 48000, credits: 3000, label: '50시간 이용권' },
  hour100: { amount: 95000, credits: 6000, label: '100시간 이용권' },
}

const orderSchema = z.object({
  packageId: z.enum(['hour10', 'hour30', 'hour50', 'hour100']),
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
