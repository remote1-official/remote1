// src/app/api/auth/logout/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyRefreshToken } from '@/lib/jwt'

export async function POST(req: NextRequest) {
  try {
    const refreshToken = req.cookies.get('refreshToken')?.value

    if (refreshToken) {
      try {
        const payload = verifyRefreshToken(refreshToken)
        // DB에서 refreshToken 삭제
        await prisma.user.update({
          where: { id: payload.userId },
          data: { refreshToken: null },
        })
      } catch {
        // 만료된 토큰이어도 쿠키는 삭제
      }
    }

    const response = NextResponse.json({ message: '로그아웃 되었습니다' })
    response.cookies.delete('refreshToken')
    return response
  } catch (error) {
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}
