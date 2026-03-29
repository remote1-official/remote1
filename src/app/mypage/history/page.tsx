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

type PaymentRow = {
  id: string
  orderId: string
  amount: number
  creditsAdded: number
  status: 'PENDING' | 'DONE' | 'FAILED' | 'CANCELED'
  method: string | null
  createdAt: string
}

const PLAN_NAMES: Record<number, string> = {
  11000:  '스타터',
  33000:  '스탠다드',
  66000:  '프리미엄',
  110000: '프로',
  330000: '프로 MAX',
}

function getPlanName(p: PaymentRow): string {
  if (p.method === 'ADMIN' || p.amount === 0) return '서비스'
  return PLAN_NAMES[p.amount] || '이용권'
}

type HistoryItem = {
  type: 'charge' | 'usage'
  date: string
  data: PaymentRow | SessionRow
}

const USAGE_STATUS: Record<string, { label: string; color: string }> = {
  ACTIVE:      { label: '이용 중',     color: 'text-emerald-400' },
  ENDED:       { label: '종료',        color: 'text-gray-400'    },
  INTERRUPTED: { label: '비정상 종료', color: 'text-red-400'     },
}

const PAY_STATUS: Record<string, { label: string; color: string }> = {
  PENDING:  { label: '대기', color: 'text-yellow-400' },
  DONE:     { label: '완료', color: 'text-emerald-400' },
  FAILED:   { label: '실패', color: 'text-red-400'    },
  CANCELED: { label: '취소', color: 'text-gray-500'   },
}

function fmt(dt: string) {
  return new Date(dt).toLocaleString('ko-KR', {
    year: '2-digit', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function duration(start: string, end: string | null): string {
  if (!end) return '진행 중'
  const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
  return `${Math.floor(mins / 60)}시간 ${mins % 60}분`
}

function creditsToTime(credits: number): string {
  const h = Math.floor(credits / 60)
  const m = credits % 60
  if (h > 0 && m > 0) return `${h}시간 ${m}분`
  if (h > 0) return `${h}시간`
  return `${m}분`
}

function priceStr(n: number) {
  return n.toLocaleString('ko-KR') + '원'
}

export default function HistoryPage() {
  const [sessions, setSessions]   = useState<SessionRow[]>([])
  const [payments, setPayments]   = useState<PaymentRow[]>([])
  const [loading, setLoading]     = useState(true)
  const [totalPaid, setTotalPaid] = useState(0)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      apiFetch('/api/mypage/sessions?page=1&limit=100').then(r => r.json()),
      apiFetch('/api/mypage/payments?page=1&limit=100').then(r => r.json()),
    ]).then(([sData, pData]) => {
      setSessions(sData.sessions ?? [])
      setPayments(pData.payments ?? [])
      const paid = (pData.payments ?? [])
        .filter((p: PaymentRow) => p.status === 'DONE' && p.method !== 'ADMIN' && p.amount > 0)
        .reduce((sum: number, p: PaymentRow) => sum + p.amount, 0)
      setTotalPaid(paid)
    }).finally(() => setLoading(false))
  }, [])

  // 충전+사용 기록 합치고 날짜순 정렬
  const history: HistoryItem[] = [
    ...payments.map(p => ({ type: 'charge' as const, date: p.createdAt, data: p })),
    ...sessions.map(s => ({ type: 'usage' as const, date: s.startedAt, data: s })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">사용 기록</h1>

      {/* 총 결제금액 */}
      {!loading && (
        <div className="rounded-2xl p-5 flex items-center justify-between" style={{ background: 'linear-gradient(135deg,#0ea5e9 0%,#6366f1 100%)' }}>
          <div>
            <p className="text-sky-100 text-xs font-medium">총 결제 금액</p>
            <p className="text-2xl font-black text-white mt-0.5">{priceStr(totalPaid)}</p>
          </div>
          <div className="text-right">
            <p className="text-sky-100 text-xs font-medium">총 충전 횟수</p>
            <p className="text-lg font-bold text-white mt-0.5">{payments.filter(p => p.status === 'DONE').length}회</p>
          </div>
        </div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-gray-500 text-sm">불러오는 중...</div>
        ) : history.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-gray-500 text-sm">기록이 없습니다</div>
        ) : (
          <div className="divide-y divide-gray-800/50">
            {history.map((item, i) => {
              if (item.type === 'charge') {
                const p = item.data as PaymentRow
                const st = PAY_STATUS[p.status]
                return (
                  <div key={`pay-${p.id}`} className="px-5 py-4 flex items-center gap-4 hover:bg-gray-800/30 transition-colors">
                    <div className="w-8 h-8 rounded-full bg-emerald-900/50 flex items-center justify-center text-emerald-400 text-sm font-bold shrink-0">+</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-emerald-400">충전</span>
                        <span className="text-xs text-gray-300 bg-gray-800 px-2 py-0.5 rounded">{getPlanName(p)}</span>
                        <span className={`text-xs ${st.color}`}>{st.label}</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">{fmt(p.createdAt)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-emerald-400">+{creditsToTime(p.creditsAdded)}</p>
                      <p className="text-xs text-gray-500">{priceStr(p.amount)}</p>
                    </div>
                  </div>
                )
              } else {
                const s = item.data as SessionRow
                const st = USAGE_STATUS[s.status]
                return (
                  <div key={`ses-${s.id}`} className="px-5 py-4 flex items-center gap-4 hover:bg-gray-800/30 transition-colors">
                    <div className="w-8 h-8 rounded-full bg-sky-900/50 flex items-center justify-center text-sky-400 text-sm shrink-0">&#9654;</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-sky-400">이용</span>
                        <span className={`text-xs ${st.color}`}>{st.label}</span>
                        <span className="text-xs text-gray-600">{s.machine.name}</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">{fmt(s.startedAt)}{s.endedAt ? ` ~ ${fmt(s.endedAt)}` : ''}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-sky-400">{duration(s.startedAt, s.endedAt)}</p>
                      {s.creditsUsed != null && <p className="text-xs text-gray-500">-{s.creditsUsed}분</p>}
                    </div>
                  </div>
                )
              }
            })}
          </div>
        )}
      </div>
    </div>
  )
}
