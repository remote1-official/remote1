// src/app/api/admin/login/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { signAdminToken } from '@/lib/adminAuth'
import { logAdmin } from '@/lib/adminLog'

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json()

    const ADMIN_ID = process.env.ADMIN_ID
    const ADMIN_PW = process.env.ADMIN_PW

    if (!ADMIN_ID || !ADMIN_PW) {
      console.error('[ADMIN LOGIN] ADMIN_ID or ADMIN_PW not set in env')
      return NextResponse.json({ error: '서버 설정 오류' }, { status: 500 })
    }

    if (username !== ADMIN_ID || password !== ADMIN_PW) {
      return NextResponse.json({ error: '아이디 또는 비밀번호가 올바르지 않습니다' }, { status: 401 })
    }

    const token = signAdminToken(username)

    await logAdmin(username, 'LOGIN', username, `관리자 로그인`)

    const response = NextResponse.json({ ok: true })
    response.cookies.set('admin_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24, // 24 hours
    })

    return response
  } catch (error) {
    console.error('[ADMIN LOGIN]', error)
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}
