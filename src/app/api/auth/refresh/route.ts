// src/app/api/auth/refresh/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyRefreshToken, signAccessToken, signRefreshToken } from '@/lib/jwt'

export async function POST(req: NextRequest) {
  try {
    const refreshToken = req.cookies.get('refreshToken')?.value
    if (!refreshToken) {
      return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })
    }

    // refreshToken 검증
    const payload = verifyRefreshToken(refreshToken)

    // DB에 저장된 refreshToken과 비교 (토큰 탈취 방지)
    const user = await prisma.user.findUnique({ where: { id: payload.userId } })
    if (!user || user.refreshToken !== refreshToken) {
      return NextResponse.json({ error: '유효하지 않은 토큰입니다' }, { status: 401 })
    }

    // 새 토큰 발급 (Refresh Token Rotation)
    const newPayload = { userId: user.id, email: user.email }
    const newAccessToken = signAccessToken(newPayload)
    const newRefreshToken = signRefreshToken(newPayload)

    // DB 업데이트
    await prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: newRefreshToken },
    })

    const response = NextResponse.json({ accessToken: newAccessToken })

    response.cookies.set('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    })

    return response
  } catch (error) {
    return NextResponse.json({ error: '토큰이 만료되었습니다' }, { status: 401 })
  }
}
