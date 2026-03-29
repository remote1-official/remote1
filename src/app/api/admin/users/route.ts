import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin, isAdminError } from '@/lib/adminAuth'
import { logAdmin } from '@/lib/adminLog'

const PLAN_INFO: Record<number, { name: string; totalHours: number; hourlyRate: number }> = {
  11000:  { name: '스타터',    totalHours: 10,  hourlyRate: 1100 },
  33000:  { name: '스탠다드',  totalHours: 33,  hourlyRate: 1000 },
  66000:  { name: '프리미엄',  totalHours: 66,  hourlyRate: 1000 },
  110000: { name: '프로',      totalHours: 111, hourlyRate: 991  },
  330000: { name: '프로 MAX',  totalHours: 333, hourlyRate: 991  },
}
const REFUND_FEE = 1000
const REFUND_DAYS = 7

export async function GET(req: NextRequest) {
  const admin = requireAdmin(req); if (isAdminError(admin)) return admin
  const users = await prisma.user.findMany({
    select: {
      id: true, username: true, email: true, phone: true,
      mainGame: true, credits: true, createdAt: true, isSuspended: true,
      payments: { orderBy: { createdAt: 'desc' }, take: 50 },
      sessions: { orderBy: { startedAt: 'desc' }, take: 20, include: { machine: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const result = users.map(u => {
    const donePayments = u.payments.filter(p => p.status === 'DONE')
    const paidPayments = donePayments.filter(p => p.method !== 'ADMIN' && p.amount > 0)
    const totalPaid = paidPayments.reduce((s, p) => s + p.amount, 0)
    const totalCharged = donePayments.reduce((s, p) => s + p.creditsAdded, 0)
    const totalUsed = u.sessions.reduce((s, ses) => s + (ses.creditsUsed ?? 0), 0)

    // 최근 요금제
    const lastPaidPayment = paidPayments[0]
    const lastPlan = lastPaidPayment ? (PLAN_INFO[lastPaidPayment.amount]?.name || '이용권') : null

    // 환불 가능 금액 계산
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - REFUND_DAYS)
    const refundablePayments = paidPayments.filter(p => p.createdAt && new Date(p.createdAt) >= sevenDaysAgo)

    let refundAmount = 0
    if (refundablePayments.length > 0) {
      // FIFO
      const sortedPays = [...refundablePayments].sort((a, b) => new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime())
      const totalPurchased = sortedPays.reduce((s, p) => s + p.creditsAdded, 0)
      const usedFromRecent = Math.max(0, totalPurchased - (u.credits ?? 0))
      let remaining = usedFromRecent
      let subtotal = 0
      for (const p of sortedPays) {
        const used = Math.min(remaining, p.creditsAdded)
        remaining -= used
        const remainMin = p.creditsAdded - used
        const remainH = Math.floor(remainMin / 60)
        const plan = PLAN_INFO[p.amount]
        if (remainMin > 0 && plan) {
          subtotal += used > 0 ? remainH * plan.hourlyRate : p.amount
        } else if (remainMin > 0) {
          subtotal += p.amount
        }
      }
      refundAmount = subtotal > 0 ? Math.max(0, subtotal - REFUND_FEE) : 0
    }

    return {
      id: u.id,
      username: u.username,
      email: u.email,
      phone: u.phone,
      mainGame: u.mainGame,
      credits: u.credits ?? 0,
      isSuspended: u.isSuspended,
      createdAt: u.createdAt,
      totalPaid,
      totalCharged,
      totalUsed,
      lastPlan,
      refundAmount,
      paymentCount: paidPayments.length,
      sessionCount: u.sessions.length,
      payments: u.payments.map(p => ({
        id: p.id, amount: p.amount, creditsAdded: p.creditsAdded,
        status: p.status, method: p.method, createdAt: p.createdAt,
        planName: p.method === 'ADMIN' || p.amount === 0 ? '서비스' : (PLAN_INFO[p.amount]?.name || '이용권'),
      })),
      sessions: u.sessions.map(s => ({
        id: s.id, startedAt: s.startedAt, endedAt: s.endedAt,
        creditsUsed: s.creditsUsed, status: s.status, machineName: s.machine.name,
      })),
    }
  })

  return NextResponse.json({ users: result })
}

// POST: 관리자가 회원에게 요금제/서비스 충전
export async function POST(req: NextRequest) {
  const admin = requireAdmin(req); if (isAdminError(admin)) return admin
  const { userId, type, packageAmount } = await req.json()
  if (!userId) return NextResponse.json({ error: '사용자 ID 필요' }, { status: 400 })

  let credits = 0
  let amount = 0
  let method = 'ADMIN'
  let label = '서비스'

  if (type === 'plan' && packageAmount) {
    const plan = PLAN_INFO[packageAmount]
    if (!plan) return NextResponse.json({ error: '유효하지 않은 요금제' }, { status: 400 })
    credits = plan.totalHours * 60
    amount = packageAmount
    method = '관리자'
    label = plan.name + ' 이용권'
  } else if (type === 'service') {
    const mins = parseInt(packageAmount) || 60
    credits = mins
    method = 'ADMIN'
    label = '서비스 ' + Math.floor(mins / 60) + '시간'
  } else {
    return NextResponse.json({ error: '유효하지 않은 타입' }, { status: 400 })
  }

  await prisma.user.update({ where: { id: userId }, data: { credits: { increment: credits } } })
  await prisma.payment.create({
    data: {
      userId,
      orderId: `ADMIN-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      amount,
      creditsAdded: credits,
      status: 'DONE',
      method,
    },
  })

  // Get user info for log target
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true, email: true } })
  const targetName = user?.username || user?.email || userId
  const action = type === 'plan' ? 'CHARGE_PACKAGE' : 'CHARGE_SERVICE'
  await logAdmin(admin.adminId, action, targetName, `${targetName}에게 ${label} 충전 (${credits}분)`)

  return NextResponse.json({ ok: true, credits, label })
}

// PATCH: 회원 이용정지/해제
export async function PATCH(req: NextRequest) {
  const admin = requireAdmin(req); if (isAdminError(admin)) return admin
  const { userId, action } = await req.json()
  if (!userId || !['suspend', 'unsuspend'].includes(action)) {
    return NextResponse.json({ error: '잘못된 요청' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true, email: true } })
  if (!user) return NextResponse.json({ error: '사용자 없음' }, { status: 404 })

  const isSuspended = action === 'suspend'
  await prisma.user.update({ where: { id: userId }, data: { isSuspended } })

  const targetName = user.username || user.email
  const logAction = isSuspended ? 'USER_SUSPEND' : 'USER_UNSUSPEND'
  const detail = isSuspended ? `${targetName} 이용정지 처리` : `${targetName} 이용정지 해제`
  await logAdmin(admin.adminId, logAction, targetName, detail)

  return NextResponse.json({ ok: true })
}

// DELETE: 회원 탈퇴 처리
export async function DELETE(req: NextRequest) {
  const admin = requireAdmin(req); if (isAdminError(admin)) return admin
  const { userId } = await req.json()
  if (!userId) return NextResponse.json({ error: '사용자 ID 필요' }, { status: 400 })

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true, email: true } })
  if (!user) return NextResponse.json({ error: '사용자 없음' }, { status: 404 })

  const targetName = user.username || user.email

  // 관련 데이터 정리 (세션, 대기열, 결제기록 유지하되 사용자 삭제)
  await prisma.queue.deleteMany({ where: { userId } })
  await prisma.session.deleteMany({ where: { userId } })
  await prisma.payment.deleteMany({ where: { userId } })
  await prisma.user.delete({ where: { id: userId } })

  await logAdmin(admin.adminId, 'USER_DELETE', targetName, `${targetName} 회원 탈퇴 처리`)

  return NextResponse.json({ ok: true })
}
