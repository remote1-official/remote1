'use client'
// src/app/dashboard/page.tsx
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

const PACKAGES = [
  { id: 'basic',    label: '기본',     time: '1시간',  credits: 60,  price: '9,900원',  popular: false },
  { id: 'standard', label: '스탠다드', time: '3시간',  credits: 180, price: '29,900원', popular: true  },
  { id: 'premium',  label: '프리미엄', time: '10시간', credits: 600, price: '59,900원', popular: false },
]

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<{ name: string; email: string; credits: number } | null>(null)
  const [loading, setLoading] = useState('')

  useEffect(() => {
    const stored = sessionStorage.getItem('user')
    if (!stored) { router.push('/login'); return }
    setUser(JSON.parse(stored))
  }, [router])

  async function handlePayment(packageId: string) {
    setLoading(packageId)
    try {
      const token = sessionStorage.getItem('accessToken')

      // 1. 주문 생성
      const orderRes = await fetch('/api/payment/create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ packageId }),
      })
      const order = await orderRes.json()
      if (!orderRes.ok) { alert(order.error); return }

      // 2. 토스 결제창 열기
      const { loadTossPayments } = await import('@tosspayments/payment-sdk')
      const tossPayments = await loadTossPayments(order.clientKey)

      await tossPayments.requestPayment('카드', {
        amount: order.amount,
        orderId: order.orderId,
        orderName: order.orderName,
        customerName: user?.name,
        customerEmail: user?.email,
        successUrl: `${window.location.origin}/api/payment/callback`,
        failUrl: `${window.location.origin}/payment/fail`,
      })
    } catch (err) {
      console.error(err)
    } finally {
      setLoading('')
    }
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    sessionStorage.clear()
    router.push('/login')
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <span className="text-xl font-bold text-indigo-600">MyApp</span>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">{user.name}님</span>
            <button onClick={handleLogout} className="text-sm text-gray-400 hover:text-gray-700 transition-colors">
              로그아웃
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10">
        {/* 크레딧 현황 */}
        <div className="bg-indigo-600 rounded-2xl p-8 text-white mb-10">
          <p className="text-indigo-200 text-sm font-medium">보유 크레딧</p>
          <p className="text-5xl font-bold mt-1">{user.credits}<span className="text-2xl ml-2 font-normal text-indigo-200">분</span></p>
          <p className="text-indigo-200 text-sm mt-3">≈ {Math.floor(user.credits / 60)}시간 {user.credits % 60}분 이용 가능</p>
        </div>

        {/* 결제 패키지 */}
        <h2 className="text-xl font-semibold mb-4">크레딧 충전</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PACKAGES.map(pkg => (
            <div
              key={pkg.id}
              className={`relative bg-white rounded-2xl border-2 p-6 transition-shadow hover:shadow-md
                ${pkg.popular ? 'border-indigo-500' : 'border-gray-100'}`}
            >
              {pkg.popular && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-500 text-white text-xs font-semibold px-3 py-1 rounded-full">
                  인기
                </span>
              )}
              <p className="font-semibold text-gray-900">{pkg.label}</p>
              <p className="text-3xl font-bold mt-2">{pkg.time}</p>
              <p className="text-gray-400 text-sm mt-1">{pkg.credits}크레딧</p>
              <p className="text-xl font-semibold text-indigo-600 mt-4">{pkg.price}</p>
              <button
                onClick={() => handlePayment(pkg.id)}
                disabled={!!loading}
                className={`mt-4 w-full py-2.5 rounded-xl font-semibold text-sm transition-all
                  ${pkg.popular
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                    : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {loading === pkg.id ? '처리 중...' : '결제하기'}
              </button>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
