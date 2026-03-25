// src/middleware.ts
// NOTE: Next.js 미들웨어는 Edge Runtime에서 실행되므로
// jsonwebtoken(Node.js crypto 의존)을 사용할 수 없습니다.
// JWT 검증은 각 라우트 핸들러의 getAuthUser()에서 수행합니다.
import { NextRequest, NextResponse } from 'next/server'

const PUBLIC_PATHS = ['/login', '/signup', '/api/auth/login', '/api/auth/signup', '/api/auth/refresh', '/api/auth/sms', '/api/auth/logout', '/api/notices', '/api/admin/']

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // 공개 경로는 통과
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // API 경로 보호 (Authorization 헤더 존재 여부만 확인)
  // 실제 토큰 검증은 각 라우트 핸들러에서 getAuthUser()로 수행
  if (pathname.startsWith('/api/')) {
    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })
    }
  }

  // 페이지 보호는 클라이언트에서 sessionStorage 체크로 처리
  return NextResponse.next()
}

export const config = {
  matcher: ['/api/:path*', '/dashboard/:path*'],
}
