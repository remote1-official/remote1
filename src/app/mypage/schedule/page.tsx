'use client'
import { useState, useEffect } from 'react'
import { apiFetch } from '@/lib/apiClient'

type ActiveSession = {
  id: string
  startedAt: string
  scheduledEndAt: string | null
  machine: { name: string }
}

type HistoryRow = {
  id: string
  startedAt: string
  scheduledEndAt: string | null
  endedAt: string | null
  status: string
}

const QUICK_MINS = [60, 120, 180, 240, 300]

function addMinutes(mins: number): string {
  const d = new Date(Date.now() + mins * 60000)
  // Format to datetime-local input value (YYYY-MM-DDTHH:mm)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fmtDt(dt: string) {
  return new Date(dt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function SchedulePage() {
  const [session, setSession]   = useState<ActiveSession | null>(null)
  const [history, setHistory]   = useState<HistoryRow[]>([])
  const [loading, setLoading]   = useState(true)
  const [endAt, setEndAt]       = useState('')
  const [customMin, setCustomMin] = useState('')
  const [saving, setSaving]     = useState(false)
  const [message, setMessage]   = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    apiFetch('/api/mypage/schedule')
      .then(r => r.json())
      .then(d => {
        setSession(d.session ?? null)
        setHistory(d.history ?? [])
        if (d.session?.scheduledEndAt) {
          const dt = new Date(d.session.scheduledEndAt)
          const pad = (n: number) => String(n).padStart(2, '0')
          setEndAt(`${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    if (!session || !endAt) return
    setSaving(true)
    setMessage(null)
    try {
      const res  = await apiFetch('/api/mypage/schedule', {
        method: 'POST',
        body: JSON.stringify({ sessionId: session.id, scheduledEndAt: new Date(endAt).toISOString() }),
      })
      const data = await res.json()
      if (!res.ok) { setMessage({ type: 'err', text: data.error }); return }
      setSession(s => s ? { ...s, scheduledEndAt: data.session.scheduledEndAt } : null)
      setMessage({ type: 'ok', text: '예약 종료가 설정되었습니다.' })
    } finally {
      setSaving(false)
    }
  }

  async function handleCancel() {
    if (!session) return
    setSaving(true)
    setMessage(null)
    try {
      const res  = await apiFetch(`/api/mypage/schedule?sessionId=${session.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) { setMessage({ type: 'err', text: data.error }); return }
      setSession(s => s ? { ...s, scheduledEndAt: null } : null)
      setEndAt('')
      setMessage({ type: 'ok', text: '예약이 취소되었습니다.' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-48 text-gray-500 text-sm">불러오는 중...</div>
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">예약 종료</h1>

      {!session ? (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center text-gray-500 text-sm">
          현재 활성 세션이 없습니다.
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-5">
          {/* Current session info */}
          <div className="flex flex-wrap gap-4 text-sm">
            <div>
              <span className="text-gray-400">PC</span>
              <span className="ml-2 text-gray-200 font-medium">{session.machine.name}</span>
            </div>
            <div>
              <span className="text-gray-400">시작</span>
              <span className="ml-2 text-gray-200 font-medium">{fmtDt(session.startedAt)}</span>
            </div>
            {session.scheduledEndAt && (
              <div>
                <span className="text-gray-400">예약 종료</span>
                <span className="ml-2 text-sky-400 font-medium">{fmtDt(session.scheduledEndAt)}</span>
              </div>
            )}
          </div>

          {message && (
            <div className={`text-sm px-4 py-3 rounded-lg border ${
              message.type === 'ok'
                ? 'bg-emerald-950 border-emerald-700 text-emerald-400'
                : 'bg-red-950 border-red-800 text-red-400'
            }`}>{message.text}</div>
          )}

          {/* Quick buttons */}
          <div>
            <p className="text-xs text-gray-400 mb-2">빠른 선택</p>
            <div className="flex flex-wrap gap-2">
              {QUICK_MINS.map(m => (
                <button
                  key={m}
                  onClick={() => { setEndAt(addMinutes(m)); setCustomMin(String(m)) }}
                  className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors border border-gray-700"
                >
                  {m >= 60 ? `${m/60}시간` : `${m}분`} 후
                </button>
              ))}
            </div>
          </div>

          {/* Custom minutes input */}
          <div>
            <p className="text-xs text-gray-400 mb-2">직접 입력 (분)</p>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min="1"
                placeholder="분 단위 입력"
                value={customMin}
                onChange={e => {
                  setCustomMin(e.target.value)
                  const m = parseInt(e.target.value)
                  if (m > 0) setEndAt(addMinutes(m))
                }}
                className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-sky-500 w-32"
              />
              <span className="text-sm text-gray-500">분 후 종료</span>
            </div>
            {endAt && (
              <p className="mt-2 text-xs text-gray-500">
                예약 종료 시간: <span className="text-sky-400 font-medium">{fmtDt(new Date(endAt).toISOString())}</span>
              </p>
            )}
          </div>

          <div className="flex gap-3 pt-1">
            <button
              onClick={handleSave}
              disabled={saving || !endAt}
              className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg,#0ea5e9 0%,#6366f1 100%)' }}
            >
              {saving ? '저장 중...' : '예약 설정'}
            </button>
            {session.scheduledEndAt && (
              <button
                onClick={handleCancel}
                disabled={saving}
                className="px-5 py-2 rounded-xl text-sm font-medium text-red-400 bg-red-950 border border-red-800 hover:bg-red-900 transition-colors disabled:opacity-50"
              >
                예약 취소
              </button>
            )}
          </div>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800">
            <h2 className="font-semibold text-gray-200 text-sm">예약 기록</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400">
                <th className="text-left px-5 py-3 font-medium">세션 시작</th>
                <th className="text-left px-5 py-3 font-medium">예약 종료</th>
                <th className="text-left px-5 py-3 font-medium">실제 종료</th>
                <th className="text-left px-5 py-3 font-medium">상태</th>
              </tr>
            </thead>
            <tbody>
              {history.map(row => (
                <tr key={row.id} className="border-t border-gray-800/50 hover:bg-gray-800/20">
                  <td className="px-5 py-3 text-gray-300">{fmtDt(row.startedAt)}</td>
                  <td className="px-5 py-3 text-sky-400">{row.scheduledEndAt ? fmtDt(row.scheduledEndAt) : '-'}</td>
                  <td className="px-5 py-3 text-gray-300">{row.endedAt ? fmtDt(row.endedAt) : '-'}</td>
                  <td className="px-5 py-3 text-gray-400">{row.status === 'ACTIVE' ? '진행 중' : '종료'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
