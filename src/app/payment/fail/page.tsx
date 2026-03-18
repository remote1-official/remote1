'use client'
// src/app/payment/fail/page.tsx
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

export default function PaymentFailPage() {
  const searchParams = useSearchParams()
  const code = searchParams.get('code')
  const message = searchParams.get('message')

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="form-card max-w-md w-full text-center">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-3xl">❌</span>
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">결제 실패</h2>
        {message && <p className="text-gray-500 mb-2">{message}</p>}
        {code && <p className="text-xs text-gray-400 mb-6">오류 코드: {code}</p>}
        <Link href="/dashboard" className="btn-primary inline-block">
          다시 시도하기
        </Link>
      </div>
    </div>
  )
}
