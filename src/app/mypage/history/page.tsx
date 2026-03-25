'use client'
import { useState, useEffect } from 'react'
import { apiFetch } from '@/lib/apiClient'

type SessionRow = {
  id: string
  startedAt: string
  endedAt: string | null
  creditsUsed: number | null
  status: 'ACTIVE' | 'ENDED' | 'INTERRUPTED'
  machine: { name: string; spec: string | null }
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  ACTIVE:      { label: '이용 중',  color: 'text-emerald-400' },
  ENDED:       { label: '종료',     color: 'text-gray-400'    },
  INTERRUPTED: { label: '비정상 종료', color: 'text-red-400'  },
}

function duration(start: string, end: string | null): string {
  if (!end) return '진행 중'
  const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
  return `${Math.floor(mins / 60)}시간 ${mins % 60}분`
}

function fmt(dt: string) {
  return new Date(dt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function HistoryPage() {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [total, setTotal]       = useState(0)
  const [page, setPage]         = useState(1)
  const [loading, setLoading]   = useState(true)

  const LIMIT = 10
  const totalPages = Math.max(1, Math.ceil(total / LIMIT))

  useEffect(() => {
    setLoading(true)
    apiFetch(`/api/mypage/sessions?page=${page}&limit=${LIMIT}`)
      .then(r => r.json())
      .then(d => { setSessions(d.sessions ?? []); setTotal(d.total ?? 0) })
      .finally(() => setLoading(false))
  }, [page])

  async function handleDisconnect(sessionId: string) {
    if (!confirm('세션을 종료하시겠습니까?')) return
    await apiFetch('/api/session/disconnect', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    })
    // Refresh
    setPage(p => p)
    setLoading(true)
    apiFetch(`/api/mypage/sessions?page=${page}&limit=${LIMIT}`)
      .then(r => r.json())
      .then(d => { setSessions(d.sessions ?? []); setTotal(d.total ?? 0) })
      .finally(() => setLoading(false))
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">사용 기록</h1>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-gray-500 text-sm">불러오는 중...</div>
        ) : sessions.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-gray-500 text-sm">사용 기록이 없습니다</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400">
                  <th className="text-left px-5 py-3 font-medium">시작 시간</th>
                  <th className="text-left px-5 py-3 font-medium">종료 시간</th>
                  <th className="text-left px-5 py-3 font-medium">이용 시간</th>
                  <th className="text-left px-5 py-3 font-medium hidden md:table-cell">PC</th>
                  <th className="text-left px-5 py-3 font-medium">소모 크레딧</th>
                  <th className="text-left px-5 py-3 font-medium">상태</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {sessions.map(s => {
                  const st = STATUS_LABEL[s.status]
                  return (
                    <tr key={s.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                      <td className="px-5 py-3 text-gray-300">{fmt(s.startedAt)}</td>
                      <td className="px-5 py-3 text-gray-300">{s.endedAt ? fmt(s.endedAt) : '-'}</td>
                      <td className="px-5 py-3 text-gray-300">{duration(s.startedAt, s.endedAt)}</td>
                      <td className="px-5 py-3 text-gray-400 hidden md:table-cell">{s.machine.name}</td>
                      <td className="px-5 py-3 text-gray-300">{s.creditsUsed != null ? `${s.creditsUsed}분` : '-'}</td>
                      <td className={`px-5 py-3 font-medium ${st.color}`}>{st.label}</td>
                      <td className="px-5 py-3">
                        {s.status === 'ACTIVE' && (
                          <button
                            onClick={() => handleDisconnect(s.id)}
                            className="text-xs text-red-400 hover:text-red-300 border border-red-800 hover:border-red-600 px-3 py-1 rounded-lg transition-colors"
                          >
                            종료
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-800">
            <span className="text-xs text-gray-500">총 {total}건</span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
                className="px-3 py-1 text-xs rounded-lg bg-gray-800 text-gray-400 disabled:opacity-40 hover:bg-gray-700 transition-colors"
              >
                이전
              </button>
              <span className="text-xs text-gray-400">{page} / {totalPages}</span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
                className="px-3 py-1 text-xs rounded-lg bg-gray-800 text-gray-400 disabled:opacity-40 hover:bg-gray-700 transition-colors"
              >
                다음
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
