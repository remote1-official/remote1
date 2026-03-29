import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

const REFUND_FEE  = 1000  // 기본 수수료 (사용중인 요금제에만 적용)
const REFUND_DAYS = 7     // 환불 가능 기간 (일)

// 요금제별 정보 (결제금액 기준)
const PLAN_INFO: Record<number, { name: string; totalHours: number; hourlyRate: number }> = {
  11000:  { name: '스타터',    totalHours: 10,  hourlyRate: 1100 },
  33000:  { name: '스탠다드',  totalHours: 33,  hourlyRate: 1000 },
  66000:  { name: '프리미엄',  totalHours: 66,  hourlyRate: 1000 },
  110000: { name: '프로',      totalHours: 111, hourlyRate: 991  },
  330000: { name: '프로 MAX',  totalHours: 333, hourlyRate: 991  },
}

export async function GET(req: NextRequest) {
  const authUser = getAuthUser(req)
  if (!authUser) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })

  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - REFUND_DAYS)

  // 7일 이내 유료 결제 (ADMIN 제외), 날짜순 (오래된 것부터 = FIFO)
  const payments = await prisma.payment.findMany({
    where: {
      userId: authUser.userId,
      status: 'DONE',
      method: { not: 'ADMIN' },
      amount: { gt: 0 },
      createdAt: { gte: sevenDaysAgo },
    },
    orderBy: { createdAt: 'asc' },
  })

  // 사용자의 현재 총 잔여 크레딧
  const user = await prisma.user.findUnique({ where: { id: authUser.userId }, select: { credits: true } })
  const currentCredits = user?.credits ?? 0

  // 전체 구매 크레딧 (7일 이내)
  const totalPurchased = payments.reduce((sum, p) => sum + p.creditsAdded, 0)

  // 7일 이내 구매분에서 사용된 크레딧 = 구매 - 잔여 (음수 방지)
  // 단, 7일 이전 구매분도 있을 수 있으므로, 현재 잔여가 최근 구매보다 많을 수 있음
  const usedFromRecent = Math.max(0, totalPurchased - currentCredits)

  // FIFO로 각 요금제의 잔여 시간 계산
  let remainingUsed = usedFromRecent // 아직 차감해야 할 사용량 (분)

  const refundable = payments.map(p => {
    const plan = PLAN_INFO[p.amount]
    const planName = plan?.name || '이용권'
    const hourlyRate = plan?.hourlyRate || 1100
    const totalMinutes = p.creditsAdded

    // FIFO: 이 요금제에서 차감할 사용량
    const usedFromThis = Math.min(remainingUsed, totalMinutes)
    remainingUsed -= usedFromThis

    const remainingMinutes = totalMinutes - usedFromThis
    const remainingHours = Math.floor(remainingMinutes / 60)
    const usedHours = Math.ceil(usedFromThis / 60)

    const daysSince = Math.floor((Date.now() - new Date(p.createdAt!).getTime()) / 86400000)
    const daysLeft = Math.max(0, REFUND_DAYS - daysSince)

    let status: '사용중' | '사용대기' | '소진'
    let refundAmount: number

    if (usedFromThis >= totalMinutes) {
      status = '소진'
      refundAmount = 0
    } else if (usedFromThis > 0) {
      status = '사용중'
      refundAmount = remainingHours * hourlyRate
    } else {
      status = '사용대기'
      refundAmount = p.amount
    }

    return {
      paymentId: p.id,
      planName,
      amount: p.amount,
      totalHours: Math.floor(totalMinutes / 60),
      usedHours,
      remainingHours,
      hourlyRate,
      refundAmount,
      status,
      purchasedAt: p.createdAt,
      daysLeft,
      canRefund: refundAmount > 0 && daysLeft > 0,
    }
  })

  // 수수료는 총 합계에서 1회만 차감
  const subtotal = refundable
    .filter(r => r.canRefund)
    .reduce((sum, r) => sum + r.refundAmount, 0)
  const totalRefundable = subtotal > 0 ? Math.max(0, subtotal - REFUND_FEE) : 0

  return NextResponse.json({ refundable, totalRefundable, refundFee: REFUND_FEE, refundDays: REFUND_DAYS })
}
