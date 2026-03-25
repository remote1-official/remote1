// src/app/api/admin/charge/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
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

    return NextResponse.json({ ok: true, user })
  } catch (error) {
    return NextResponse.json({ error: '사용자를 찾을 수 없습니다' }, { status: 404 })
  }
}
