// src/app/api/mypage/info/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const authUser = getAuthUser(req)
  if (!authUser) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })

  const user = await prisma.user.findUnique({
    where: { id: authUser.userId },
    select: { id: true, username: true, email: true, phone: true, mainGame: true, credits: true, createdAt: true },
  })
  if (!user) return NextResponse.json({ error: '사용자를 찾을 수 없습니다' }, { status: 404 })

  return NextResponse.json({ user })
}

const updateSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().regex(/^01[0-9]{8,9}$/).optional(),
}).refine(data => Object.keys(data).length > 0, { message: '변경할 내용이 없습니다' })

export async function PUT(req: NextRequest) {
  const authUser = getAuthUser(req)
  if (!authUser) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })

  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 })

  const updated = await prisma.user.update({
    where: { id: authUser.userId },
    data: parsed.data,
    select: { id: true, username: true, email: true, phone: true, credits: true },
  })

  return NextResponse.json({ user: updated })
}
