// src/app/api/payment/create-order/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { nanoid } from 'nanoid' // 또는 crypto.randomUUID()

// 크레딧 패키지 정의
const CREDIT_PACKAGES: Record<string, { amount: number; credits: number; label: string }> = {
  starter:  { amount: 11000,  credits: 600,   label: '스타터 10시간 이용권' },
  standard: { amount: 33000,  credits: 1980,  label: '스탠다드 30+3시간 이용권' },
  premium:  { amount: 66000,  credits: 3960,  label: '프리미엄 60+6시간 이용권' },
  pro:      { amount: 110000, credits: 6660,  label: '프로 100+11시간 이용권' },
  promax:   { amount: 330000, credits: 19980, label: '프로MAX 300+33시간 이용권' },
}

const orderSchema = z.object({
  packageId: z.enum(['starter', 'standard', 'premium', 'pro', 'promax']),
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
