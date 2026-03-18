// src/lib/apiClient.ts
/**
 * axios 대신 fetch 기반의 간단한 API 클라이언트
 * - accessToken 자동 첨부
 * - 401 시 refreshToken으로 자동 갱신 후 재시도
 */

let isRefreshing = false
let refreshQueue: Array<(token: string) => void> = []

async function refreshAccessToken(): Promise<string> {
  const res = await fetch('/api/auth/refresh', { method: 'POST' })
  if (!res.ok) throw new Error('refresh failed')
  const data = await res.json()
  return data.accessToken
}

export async function apiFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = sessionStorage.getItem('accessToken')

  const headers = new Headers(options.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  headers.set('Content-Type', 'application/json')

  let response = await fetch(url, { ...options, headers })

  // 401이면 토큰 갱신 시도
  if (response.status === 401) {
    if (!isRefreshing) {
      isRefreshing = true
      try {
        const newToken = await refreshAccessToken()
        sessionStorage.setItem('accessToken', newToken)
        refreshQueue.forEach(cb => cb(newToken))
        refreshQueue = []

        // 원래 요청 재시도
        headers.set('Authorization', `Bearer ${newToken}`)
        response = await fetch(url, { ...options, headers })
      } catch {
        // refresh 실패 → 로그아웃
        sessionStorage.clear()
        window.location.href = '/login'
      } finally {
        isRefreshing = false
      }
    } else {
      // 이미 갱신 중이면 큐에 대기
      const newToken = await new Promise<string>(resolve => {
        refreshQueue.push(resolve)
      })
      headers.set('Authorization', `Bearer ${newToken}`)
      response = await fetch(url, { ...options, headers })
    }
  }

  return response
}
