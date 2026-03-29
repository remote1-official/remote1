'use client'
import { useState, useEffect } from 'react'
import { apiFetch } from '@/lib/apiClient'

type RefundItem = {
  paymentId: string
  orderId: string
  planName: string
  amount: number
  creditsAdded: number
  usedHours: number
  usedAmount: number
  refundFee: number
  refundAmount: number
  purchasedAt: string
  daysLeft: number
  canRefund: boolean
}

function priceStr(n: number) {
  return n.toLocaleString('ko-KR') + '원'
}

function fmt(dt: string) {
  return new Date(dt).toLocaleString('ko-KR', {
    year: '2-digit', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function RefundPage() {
  const [items, setItems]     = useState<RefundItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    apiFetch('/api/mypage/refund')
      .then(r => r.json())
      .then(d => setItems(d.refundable ?? []))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">환불</h1>

      {/* 안내사항 */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-200">환불 안내</h2>
        <ul className="text-sm text-gray-400 space-y-1.5 list-disc list-inside">
          <li>결제일로부터 <span className="text-sky-400 font-semibold">7일 이내</span>에만 환불이 가능합니다.</li>
          <li>환불 시 기본 수수료 <span className="text-yellow-400 font-semibold">1,000원</span>이 차감됩니다.</li>
          <li>사용한 시간은 시간당 <span className="text-gray-200 font-semibold">1,100원</span>으로 차감됩니다.</li>
          <li>환불 금액 = 결제금액 - 사용시간 차감 - 기본 수수료(1,000원)</li>
        </ul>
      </div>

      {/* 환불 가능 목록 */}
      {loading ? (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl flex items-center justify-center h-32 text-gray-500 text-sm">
          불러오는 중...
        </div>
      ) : items.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl flex items-center justify-center h-32 text-gray-500 text-sm">
          환불 가능한 결제 내역이 없습니다 (7일 이내 결제만 환불 가능)
        </div>
      ) : (
        <div className="space-y-4">
          {items.map(item => (
            <div key={item.paymentId} className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-4">
              {/* 요금제 헤더 */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-bold text-white">{item.planName} 이용권</p>
                  <p className="text-xs text-gray-500 mt-0.5">결제일: {fmt(item.purchasedAt)} (잔여 {item.daysLeft}일)</p>
                </div>
                {item.canRefund ? (
                  <span className="text-xs font-semibold text-emerald-400 bg-emerald-900/30 px-3 py-1 rounded-full">환불 가능</span>
                ) : (
                  <span className="text-xs font-semibold text-red-400 bg-red-900/30 px-3 py-1 rounded-full">환불 불가</span>
                )}
              </div>

              {/* 계산 상세 */}
              <div className="bg-gray-800/50 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">결제 금액</span>
                  <span className="text-gray-200 font-medium">{priceStr(item.amount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">사용 시간 차감 ({item.usedHours}시간 x 1,100원)</span>
                  <span className="text-red-400 font-medium">-{priceStr(item.usedAmount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">기본 수수료</span>
                  <span className="text-red-400 font-medium">-{priceStr(item.refundFee)}</span>
                </div>
                <div className="border-t border-gray-700 pt-2 flex justify-between">
                  <span className="text-gray-200 font-semibold">환불 가능 금액</span>
                  <span className="text-xl font-bold" style={{ background: 'linear-gradient(135deg,#0ea5e9 0%,#6366f1 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                    {priceStr(item.refundAmount)}
                  </span>
                </div>
              </div>

              {/* 환불 버튼 */}
              <button
                disabled={!item.canRefund}
                className="w-full py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed text-white"
                style={item.canRefund ? { background: 'linear-gradient(135deg,#0ea5e9 0%,#6366f1 100%)' } : { background: '#374151' }}
                onClick={() => alert('환불 기능은 관리자에게 문의해주세요.\n고객센터: 카카오톡 @remote1')}
              >
                {item.canRefund ? '환불 신청' : '환불 불가'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
