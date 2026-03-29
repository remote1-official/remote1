// src/app/api/admin/auth/route.ts
// GET: check if admin is authenticated
// DELETE: logout (clear cookie)
import { NextRequest, NextResponse } from 'next/server'
import { getAdminUser } from '@/lib/adminAuth'

export async function GET(req: NextRequest) {
  const admin = getAdminUser(req)
  if (!admin) {
    return NextResponse.json({ authenticated: false }, { status: 401 })
  }
  return NextResponse.json({ authenticated: true, adminId: admin.adminId })
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true })
  response.cookies.set('admin_token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return response
}
