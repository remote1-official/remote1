// src/lib/adminAuth.ts
// Admin-only authentication (separate from user auth)
import jwt from 'jsonwebtoken'
import { NextRequest, NextResponse } from 'next/server'

const ADMIN_SECRET = process.env.JWT_ACCESS_SECRET! + '_admin'
const COOKIE_NAME = 'admin_token'

export interface AdminPayload {
  role: 'admin'
  adminId: string
}

/** Sign a 24-hour admin JWT */
export function signAdminToken(adminId: string): string {
  return jwt.sign({ role: 'admin', adminId } as AdminPayload, ADMIN_SECRET, { expiresIn: '24h' })
}

/** Verify admin JWT, returns payload or null */
export function verifyAdminToken(token: string): AdminPayload | null {
  try {
    const payload = jwt.verify(token, ADMIN_SECRET) as AdminPayload
    if (payload.role !== 'admin') return null
    return payload
  } catch {
    return null
  }
}

const MONITOR_KEY = process.env.MONITOR_API_KEY

/** Extract and verify admin token from request cookies or monitor key */
export function getAdminUser(req: NextRequest): AdminPayload | null {
  // 모니터 에이전트 API 키 인증
  const monitorKey = req.headers.get('x-monitor-key')
  if (monitorKey && monitorKey === MONITOR_KEY) {
    return { role: 'admin', adminId: 'monitor-agent' }
  }

  const token = req.cookies.get(COOKIE_NAME)?.value
  if (!token) return null
  return verifyAdminToken(token)
}

/** Helper: returns 401 response if admin is not authenticated */
export function requireAdmin(req: NextRequest): AdminPayload | NextResponse {
  const admin = getAdminUser(req)
  if (!admin) {
    return NextResponse.json({ error: '관리자 인증이 필요합니다' }, { status: 401 })
  }
  return admin
}

/** Check if the result is an error response (NextResponse) */
export function isAdminError(result: AdminPayload | NextResponse): result is NextResponse {
  return result instanceof NextResponse
}
