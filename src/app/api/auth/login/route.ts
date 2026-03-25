// src/app/api/auth/login/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { signAccessToken, signRefreshToken } from '@/lib/jwt'

const loginSchema = z.object({
  email:    z.string().email().optional(),
  username: z.string().min(1).optional(),
  password: z.string().min(1),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const parsed = loginSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: '입력값이 올바르지 않습니다' }, { status: 400 })
    }

    const { email, username, password } = parsed.data

    // 유저 조회 — username 우선, 없으면 email
    let user = null

    if (username) {
      user = await prisma.user.findUnique({ where: { username } })
    } else if (email) {
      user = await prisma.user.findUnique({ where: { email } })
    } else {
      return NextResponse.json(
        { error: '아이디 또는 이메일을 입력해주세요' },
        { status: 400 }
      )
    }

    if (!user) {
      return NextResponse.json(
        { error: '아이디 또는 비밀번호가 올바르지 않습니다' },
        { status: 401 }
      )
    }

    // 비밀번호 검증
    const isValid = await bcrypt.compare(password, user.password)
    if (!isValid) {
      return NextResponse.json(
        { error: '아이디 또는 비밀번호가 올바르지 않습니다' },
        { status: 401 }
      )
    }

    const payload = { userId: user.id, email: user.email }

    // 토큰 발급
    const accessToken  = signAccessToken(payload)
    const refreshToken = signRefreshToken(payload)

    // refreshToken DB 저장
    await prisma.user.update({
      where: { id: user.id },
      data:  { refreshToken },
    })

    const response = NextResponse.json({
      message: '로그인 성공',
      accessToken,
      user: {
        id:       user.id,
        email:    user.email,
        credits:  user.credits,
        username: user.username,
      },
    })

    // refreshToken을 HttpOnly 쿠키로 설정 (7일)
    response.cookies.set('refreshToken', refreshToken, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge:   60 * 60 * 24 * 7,
      path:     '/',
    })

    return response
  } catch (error) {
    console.error('[LOGIN ERROR]', error)
    return NextResponse.json({ error: '서버 오류가 발생했습니다' }, { status: 500 })
  }
}
