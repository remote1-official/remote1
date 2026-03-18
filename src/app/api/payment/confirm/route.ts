// src/app/api/payment/confirm/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

const confirmSchema = z.object({
  paymentKey: z.string(),
  orderId: z.string(),
  amount: z.number(),
})

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })
  }

  const body = await req.json()
  const parsed = confirmSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: '잘못된 요청입니다' }, { status: 400 })
  }

  const { paymentKey, orderId, amount } = parsed.data

  // DB에서 주문 조회 및 금액 검증 (결제 위변조 방지)
  const payment = await prisma.payment.findUnique({ where: { orderId } })
  if (!payment) {
    return NextResponse.json({ error: '주문을 찾을 수 없습니다' }, { status: 404 })
  }
  if (payment.userId !== user.userId) {
    return NextResponse.json({ error: '권한이 없습니다' }, { status: 403 })
  }
  if (payment.amount !== amount) {
    return NextResponse.json({ error: '결제 금액이 일치하지 않습니다' }, { status: 400 })
  }
  if (payment.status !== 'PENDING') {
    return NextResponse.json({ error: '이미 처리된 결제입니다' }, { status: 400 })
  }

  // 토스 페이먼츠 결제 승인 요청
  const tossSecretKey = process.env.TOSS_SECRET_KEY!
  const encoded = Buffer.from(`${tossSecretKey}:`).toString('base64')

  const tossResponse = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${encoded}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ paymentKey, orderId, amount }),
  })

  const tossData = await tossResponse.json()

  if (!tossResponse.ok) {
    // 결제 실패 처리
    await prisma.payment.update({
      where: { orderId },
      data: { status: 'FAILED' },
    })
    return NextResponse.json(
      { error: tossData.message ?? '결제 승인 실패' },
      { status: 400 }
    )
  }

  // 결제 성공 - 트랜잭션으로 크레딧 충전
  const [updatedPayment, updatedUser] = await prisma.$transaction([
    prisma.payment.update({
      where: { orderId },
      data: {
        paymentKey,
        status: 'DONE',
        method: tossData.method,
      },
    }),
    prisma.user.update({
      where: { id: user.userId },
      data: { credits: { increment: payment.creditsAdded } },
    }),
  ])

  return NextResponse.json({
    message: '결제가 완료되었습니다',
    creditsAdded: payment.creditsAdded,
    totalCredits: updatedUser.credits,
    payment: {
      orderId: updatedPayment.orderId,
      amount: updatedPayment.amount,
      method: updatedPayment.method,
    },
  })
}
