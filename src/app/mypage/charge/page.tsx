'use client'
import { useState, useEffect } from 'react'
import { apiFetch } from '@/lib/apiClient'

const PACKAGES = [
  {
    id:      'hour10',
    hours:   10,
    price:   11000,
    label:   '10시간',
    badge:   null,
    popular: false,
  },
  {
    id:      'hour30',
    hours:   30,
    price:   30000,
    label:   '30시간',
    badge:   '🔥 핫딜! BEST 추천',
    popular: true,
  },
  {
    id:      'hour50',
    hours:   50,
    price:   48000,
    label:   '50시간',
    badge:   null,
    popular: false,
  },
  {
    id:      'hour100',
    hours:   100,
    price:   95000,
    label:   '100시간',
    badge:   null,
    popular: false,
  },
]

function priceStr(n: number) {
  return n.toLocaleString('ko-KR') + '원'
}

function perHour(price: number, hours: number) {
  return Math.round(price / hours).toLocaleString('ko-KR') + '원/시간'
}

export default function ChargePage() {
  const [loading, setLoading] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [credits, setCredits] = useState<number | null>(null)

  useEffect(() => {
    const stored = sessionStorage.getItem('user')
    if (stored) {
      const u = JSON.parse(stored)
      setUserEmail(u.email || '')
      setCredits(u.credits ?? null)
    }
  }, [])

  async function handlePayment(packageId: string) {
    setLoading(packageId)
    try {
      const res   = await apiFetch('/api/payment/create-order', { method: 'POST', body: JSON.stringify({ packageId }) })
      const order = await res.json()
      if (!res.ok) { alert(order.error); return }

      const { loadTossPayments } = await import('@tosspayments/payment-sdk')
      const tossPayments = await loadTossPayments(order.clientKey)

      await tossPayments.requestPayment('카드', {
        amount:        order.amount,
        orderId:       order.orderId,
        orderName:     order.orderName,
        customerEmail: userEmail,
        successUrl:    `${window.location.origin}/api/payment/callback`,
        failUrl:       `${window.location.origin}/payment/fail`,
      })
    } catch (err) {
      console.error(err)
    } finally {
      setLoading('')
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">시간 충전</h1>

      {credits !== null && (
        <div className="rounded-2xl p-5 flex items-center justify-between" style={{ background: 'linear-gradient(135deg,#0ea5e9 0%,#6366f1 100%)' }}>
          <div>
            <p className="text-sky-100 text-xs font-medium">현재 잔여 시간</p>
            <p className="text-2xl font-black text-white mt-0.5">
              {Math.floor(credits / 60)}<span className="text-base font-normal text-sky-200 ml-1">시간</span>
              {' '}{credits % 60}<span className="text-base font-normal text-sky-200 ml-1">분</span>
            </p>
          </div>
          <div className="text-sky-200 text-xs">총 {credits}분</div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {PACKAGES.map(pkg => (
          <div
            key={pkg.id}
            className={`relative rounded-2xl p-6 flex flex-col gap-3 transition-all ${
              pkg.popular
                ? 'bg-gray-900 border-2 border-transparent shadow-lg shadow-sky-900/20'
                : 'bg-gray-900 border border-gray-800 hover:border-gray-700'
            }`}
            style={pkg.popular ? { backgroundImage: 'linear-gradient(#111827,#111827), linear-gradient(135deg,#0ea5e9,#6366f1)', backgroundOrigin: 'border-box', backgroundClip: 'padding-box,border-box' } : {}}
          >
            {pkg.badge && (
              <span
                className="absolute -top-3 left-5 text-xs font-bold px-3 py-1 rounded-full text-white"
                style={{ background: 'linear-gradient(135deg,#0ea5e9 0%,#6366f1 100%)' }}
              >
                {pkg.badge}
              </span>
            )}

            <div>
              <p className="text-3xl font-black text-white">{pkg.label}</p>
              <p className="text-sm text-gray-400 mt-0.5">{perHour(pkg.price, pkg.hours)}</p>
            </div>

            <p
              className="text-2xl font-bold"
              style={pkg.popular ? { background: 'linear-gradient(135deg,#0ea5e9 0%,#6366f1 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' } : { color: '#e2e8f0' }}
            >
              {priceStr(pkg.price)}
            </p>

            <button
              onClick={() => handlePayment(pkg.id)}
              disabled={!!loading}
              className={`mt-auto w-full py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                pkg.popular
                  ? 'text-white'
                  : 'bg-gray-800 text-gray-200 hover:bg-gray-700'
              }`}
              style={pkg.popular ? { background: 'linear-gradient(135deg,#0ea5e9 0%,#6366f1 100%)' } : {}}
            >
              {loading === pkg.id ? '처리 중...' : '결제하기'}
            </button>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-500 text-center">
        결제는 토스페이먼츠를 통해 안전하게 처리됩니다. 충전된 시간은 취소·환불이 제한될 수 있습니다.
      </p>
    </div>
  )
}
