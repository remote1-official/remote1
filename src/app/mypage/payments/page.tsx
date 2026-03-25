'use client'
import { useState, useEffect } from 'react'
import { apiFetch } from '@/lib/apiClient'

type PaymentRow = {
  id: string
  orderId: string
  amount: number
  creditsAdded: number
  status: 'PENDING' | 'DONE' | 'FAILED' | 'CANCELED'
  method: string | null
  createdAt: string
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  PENDING:  { label: '대기',   color: 'text-yellow-400' },
  DONE:     { label: '완료',   color: 'text-emerald-400' },
  FAILED:   { label: '실패',   color: 'text-red-400'    },
  CANCELED: { label: '취소',   color: 'text-gray-500'   },
}

function fmt(dt: string) {
  return new Date(dt).toLocaleString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function priceStr(n: number) {
  return n.toLocaleString('ko-KR') + '원'
}

export default function PaymentsPage() {
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [total, setTotal]       = useState(0)
  const [page, setPage]         = useState(1)
  const [loading, setLoading]   = useState(true)

  const LIMIT = 10
  const totalPages = Math.max(1, Math.ceil(total / LIMIT))

  useEffect(() => {
    setLoading(true)
    apiFetch(`/api/mypage/payments?page=${page}&limit=${LIMIT}`)
      .then(r => r.json())
      .then(d => { setPayments(d.payments ?? []); setTotal(d.total ?? 0) })
      .finally(() => setLoading(false))
  }, [page])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">결제 및 충전 목록</h1>

      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-gray-500 text-sm">불러오는 중...</div>
        ) : payments.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-gray-500 text-sm">결제 내역이 없습니다</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400">
                  <th className="text-left px-5 py-3 font-medium">날짜</th>
                  <th className="text-left px-5 py-3 font-medium">금액</th>
                  <th className="text-left px-5 py-3 font-medium">충전 시간</th>
                  <th className="text-left px-5 py-3 font-medium hidden md:table-cell">결제 수단</th>
                  <th className="text-left px-5 py-3 font-medium">상태</th>
                </tr>
              </thead>
              <tbody>
                {payments.map(p => {
                  const st = STATUS_MAP[p.status]
                  const hours   = Math.floor(p.creditsAdded / 60)
                  const minutes = p.creditsAdded % 60
                  return (
                    <tr key={p.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                      <td className="px-5 py-3 text-gray-300">{fmt(p.createdAt)}</td>
                      <td className="px-5 py-3 text-gray-200 font-medium">{priceStr(p.amount)}</td>
                      <td className="px-5 py-3 text-sky-400 font-medium">
                        {hours > 0 && `${hours}시간 `}{minutes > 0 && `${minutes}분`}
                      </td>
                      <td className="px-5 py-3 text-gray-400 hidden md:table-cell">{p.method ?? '-'}</td>
                      <td className={`px-5 py-3 font-medium ${st.color}`}>{st.label}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

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
