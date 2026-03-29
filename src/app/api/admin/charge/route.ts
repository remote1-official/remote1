// src/app/api/admin/charge/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin, isAdminError } from '@/lib/adminAuth'
import { logAdmin } from '@/lib/adminLog'

export async function POST(req: NextRequest) {
  const admin = requireAdmin(req); if (isAdminError(admin)) return admin
  try {
    const { username, amount } = await req.json()

    if (!username || !amount || amount < 1) {
      return NextResponse.json({ error: '유효하지 않은 요청' }, { status: 400 })
    }

    const user = await prisma.user.update({
      where: { username },
      data: { credits: { increment: amount } },
      select: { id: true, username: true, credits: true },
    })

    // 관리자 충전 기록 남기기 (method: 'ADMIN' 으로 구분)
    await prisma.payment.create({
      data: {
        userId: user.id,
        orderId: `ADMIN-${Date.now()}`,
        amount: 0,
        creditsAdded: amount,
        status: 'DONE',
        method: 'ADMIN',
      },
    })

    await logAdmin(admin.adminId, 'CHARGE_SERVICE', username, `${username}에게 ${amount}분 서비스 충전`)

    return NextResponse.json({ ok: true, user })
  } catch (error) {
    return NextResponse.json({ error: '사용자를 찾을 수 없습니다' }, { status: 404 })
  }
}
