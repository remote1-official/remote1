'use client'
import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [form, setForm] = useState({ username: '', password: '' })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (searchParams.get('signup') === 'success') {
      setSuccess('회원가입이 완료되었습니다. 로그인해주세요.')
    }
  }, [searchParams])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }
      sessionStorage.setItem('accessToken', data.accessToken)
      sessionStorage.setItem('user', JSON.stringify(data.user))
      router.push('/mypage')
    } catch {
      setError('네트워크 오류가 발생했습니다')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-950">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1
            className="text-3xl font-black tracking-tight"
            style={{ background: 'linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
          >
            REMOTE1
          </h1>
          <p className="mt-2 text-gray-500 text-sm">서비스에 오신 것을 환영합니다</p>
        </div>

        <div className="form-card">
          <h2 className="text-xl font-semibold mb-6 text-gray-100">로그인</h2>

          {success && (
            <div className="bg-emerald-950 border border-emerald-700 text-emerald-400 text-sm px-4 py-3 rounded-lg mb-4">
              {success}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">아이디</label>
              <input
                className="input-field"
                type="text"
                placeholder="아이디 입력"
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">비밀번호</label>
              <input
                className="input-field"
                type="password"
                placeholder="비밀번호 입력"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                required
              />
            </div>

            {error && (
              <div className="bg-red-950 border border-red-800 text-red-400 text-sm px-4 py-3 rounded-lg">
                {error}
              </div>
            )}

            <button type="submit" className="btn-primary mt-2" disabled={loading}
              style={!loading ? { background: 'linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)', color: '#fff' } : {}}
            >
              {loading ? '로그인 중...' : '로그인'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-500">
            계정이 없으신가요?{' '}
            <Link href="/signup" className="text-indigo-400 font-medium hover:text-indigo-300 hover:underline">
              회원가입
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div>로딩중...</div>}>
      <LoginForm />
    </Suspense>
  )
}
