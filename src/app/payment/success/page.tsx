'use client'
import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'

function SuccessContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [result, setResult] = useState<{ creditsAdded: number; totalCredits: number } | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    const paymentKey = searchParams.get('paymentKey')
    const orderId = searchParams.get('orderId')
    const amount = Number(searchParams.get('amount'))
    if (!paymentKey || !orderId || !amount) { router.push('/dashboard'); return }
    async function confirmPayment() {
      try {
        const token = sessionStorage.getItem('accessToken')
        const res = await fetch('/api/payment/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ paymentKey, orderId, amount }),
        })
        const data = await res.json()
        if (!res.ok) { setErrorMsg(data.error); setStatus('error'); return }
        const storedUser = sessionStorage.getItem('user')
        if (storedUser) {
          const user = JSON.parse(storedUser)
          user.credits = data.totalCredits
          sessionStorage.setItem('user', JSON.stringify(user))
        }
        setResult({ creditsAdded: data.creditsAdded, totalCredits: data.totalCredits })
        setStatus('success')
      } catch { setErrorMsg('결제 확인 중 오류가 발생했습니다'); setStatus('error') }
    }
    confirmPayment()
  }, [searchParams, router])

  if (status === 'loading') return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-500">결제를 확인하고 있습니다...</p>
      </div>
    </div>
  )

  if (status === 'error') return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="form-card max-w-md w-full text-center">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">결제 실패</h2>
        <p className="text-gray-500 mb-6">{errorMsg}</p>
        <Link href="/dashboard" className="btn-primary inline-block">대시보드로 돌아가기</Link>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="form-card max-w-md w-full text-center">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">결제 완료!</h2>
        <p className="text-gray-500 mb-6">
          <span className="font-semibold text-indigo-600">{result?.creditsAdded}분</span>이 충전되었습니다
        </p>
        <Link href="/dashboard" className="btn-primary inline-block">대시보드로 이동</Link>
      </div>
    </div>
  )
}

export default function PaymentSuccessPage() {
  return <Suspense fallback={<div>로딩중...</div>}><SuccessContent /></Suspense>
}