// src/lib/auth.ts
import { NextRequest } from 'next/server'
import { verifyAccessToken, JwtPayload } from './jwt'

/**
 * Request에서 Bearer 토큰을 추출해 검증합니다.
 * 실패 시 null 반환
 */
export function getAuthUser(req: NextRequest): JwtPayload | null {
  try {
    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) return null

    const token = authHeader.slice(7)
    return verifyAccessToken(token)
  } catch {
    return null
  }
}
