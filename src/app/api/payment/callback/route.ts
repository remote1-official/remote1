// src/app/api/payment/callback/route.ts
// 토스에서 리다이렉트되는 성공/실패 콜백을 처리합니다.
// 실제 승인은 /api/payment/confirm 에서 처리합니다.

import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const paymentKey = searchParams.get('paymentKey')
  const orderId = searchParams.get('orderId')
  const amount = searchParams.get('amount')
  const code = searchParams.get('code') // 실패 시 에러 코드

  if (code) {
    // 결제 실패 - 실패 페이지로 리다이렉트
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/payment/fail?code=${code}&orderId=${orderId}`
    )
  }

  // 결제 성공 - 성공 페이지로 리다이렉트 (성공 페이지에서 /confirm API 호출)
  return NextResponse.redirect(
    `${process.env.NEXT_PUBLIC_APP_URL}/payment/success?paymentKey=${paymentKey}&orderId=${orderId}&amount=${amount}`
  )
}
