// src/middleware.ts
import { NextRequest, NextResponse } from 'next/server'
import { verifyAccessToken } from './lib/jwt'

const PUBLIC_PATHS = ['/login', '/signup', '/api/auth/login', '/api/auth/signup', '/api/auth/refresh']

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // 공개 경로는 통과
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // API 경로 보호 (Authorization 헤더 검사)
  if (pathname.startsWith('/api/')) {
    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })
    }
    try {
      verifyAccessToken(authHeader.slice(7))
    } catch {
      return NextResponse.json({ error: '토큰이 만료되었습니다' }, { status: 401 })
    }
  }

  // 페이지 보호는 클라이언트에서 sessionStorage 체크로 처리
  return NextResponse.next()
}

export const config = {
  matcher: ['/api/:path*', '/dashboard/:path*'],
}
