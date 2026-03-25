'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function SignupPage() {
  const router = useRouter()

  const [form, setForm] = useState({
    username:     '',
    email:        '',
    phone:        '',
    password:     '',
    agreeTerms:   false,
    agreePrivacy: false,
  })

  const [phoneVerified, setPhoneVerified]   = useState(false)
  const [smsToken, setSmsToken]             = useState('')
  const [smsCode, setSmsCode]               = useState('')
  const [smsSent, setSmsSent]               = useState(false)
  const [countdown, setCountdown]           = useState(0)
  const [errors, setErrors]                 = useState<Record<string, string>>({})
  const [loading, setLoading]               = useState(false)
  const [smsLoading, setSmsLoading]         = useState(false)
  const [smsTestMode, setSmsTestMode]       = useState(false)
  const [submitError, setSubmitError]       = useState('')

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Countdown timer
  useEffect(() => {
    if (countdown > 0) {
      countdownRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(countdownRef.current!)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    }
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [smsSent])

  function formatCountdown(secs: number): string {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  function setField(key: string, value: string | boolean) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setErrors((prev) => ({ ...prev, [key]: '' }))
  }

  // ── SMS send ────────────────────────────────────────────────────────────────
  async function handleSmsSend() {
    const phone = form.phone.replace(/[^0-9]/g, '')
    if (!phone || !/^01[0-9]{8,9}$/.test(phone)) {
      setErrors((e) => ({ ...e, phone: '올바른 휴대폰 번호를 입력해주세요' }))
      return
    }

    setSmsLoading(true)
    setErrors((e) => ({ ...e, phone: '' }))

    try {
      const res  = await fetch('/api/auth/sms?action=send', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ phone }),
      })
      const data = await res.json()

      if (!res.ok) {
        setErrors((e) => ({ ...e, phone: data.error || 'SMS 발송에 실패했습니다' }))
        return
      }

      setSmsToken(data.token)
      setSmsSent(true)
      setCountdown(180)
      setSmsCode('')
      setPhoneVerified(false)
      if (data.testMode) setSmsTestMode(true)
    } catch {
      setErrors((e) => ({ ...e, phone: '네트워크 오류가 발생했습니다' }))
    } finally {
      setSmsLoading(false)
    }
  }

  // ── SMS verify ──────────────────────────────────────────────────────────────
  async function handleSmsVerify() {
    if (!smsCode || smsCode.length !== 6) {
      setErrors((e) => ({ ...e, smsCode: '6자리 인증번호를 입력해주세요' }))
      return
    }

    setSmsLoading(true)
    setErrors((e) => ({ ...e, smsCode: '' }))

    try {
      const res  = await fetch('/api/auth/sms?action=verify', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token: smsToken, code: smsCode }),
      })
      const data = await res.json()

      if (!res.ok) {
        setErrors((e) => ({ ...e, smsCode: data.error || '인증에 실패했습니다' }))
        return
      }

      setPhoneVerified(true)
      if (countdownRef.current) clearInterval(countdownRef.current)
      setCountdown(0)
    } catch {
      setErrors((e) => ({ ...e, smsCode: '네트워크 오류가 발생했습니다' }))
    } finally {
      setSmsLoading(false)
    }
  }

  // ── Submit ──────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError('')

    // Client-side validation
    const newErrors: Record<string, string> = {}

    if (!form.username || form.username.length < 4) {
      newErrors.username = '아이디는 최소 4자 이상이어야 합니다'
    } else if (!/^[a-zA-Z0-9_]+$/.test(form.username)) {
      newErrors.username = '아이디는 영문, 숫자, _만 사용 가능합니다'
    }

    if (!form.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      newErrors.email = '올바른 이메일을 입력해주세요'
    }

    const phone = form.phone.replace(/[^0-9]/g, '')
    if (!phone || !/^01[0-9]{8,9}$/.test(phone)) {
      newErrors.phone = '올바른 휴대폰 번호를 입력해주세요'
    }

    if (!phoneVerified) {
      newErrors.phone = (newErrors.phone || '') + ' (SMS 인증이 필요합니다)'
    }

    if (!form.password || form.password.length < 8) {
      newErrors.password = '비밀번호는 최소 8자 이상이어야 합니다'
    } else if (!/[A-Za-z]/.test(form.password) || !/[0-9]/.test(form.password)) {
      newErrors.password = '영문과 숫자를 모두 포함해야 합니다'
    }

    if (!form.agreeTerms) {
      newErrors.agreeTerms = '이용약관에 동의해주세요'
    }
    if (!form.agreePrivacy) {
      newErrors.agreePrivacy = '개인정보 처리방침에 동의해주세요'
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    setLoading(true)

    try {
      const res  = await fetch('/api/auth/signup', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          username:      form.username,
          email:         form.email,
          phone:         form.phone.replace(/[^0-9]/g, ''),
          password:      form.password,
          phoneVerified: phoneVerified,
          agreeTerms:    form.agreeTerms,
          agreePrivacy:  form.agreePrivacy,
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        setSubmitError(data.error || '회원가입에 실패했습니다')
        return
      }

      router.push('/login?signup=success')
    } catch {
      setSubmitError('네트워크 오류가 발생했습니다')
    } finally {
      setLoading(false)
    }
  }

  const canSubmit = form.agreeTerms && form.agreePrivacy && phoneVerified && !loading

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-950">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="text-center mb-8">
          <h1
            className="text-3xl font-black tracking-tight"
            style={{ background: 'linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
          >
            REMOTE1
          </h1>
          <p className="mt-2 text-gray-500 text-sm">새 계정을 만들어보세요</p>
        </div>

        <div className="form-card">
          <h2 className="text-xl font-semibold mb-6 text-gray-100">회원가입</h2>

          <form onSubmit={handleSubmit} className="space-y-5">

            {/* 아이디 */}
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">
                아이디 <span className="text-red-400">*</span>
              </label>
              <input
                className="input-field"
                type="text"
                placeholder="영문+숫자+_ 4자 이상"
                value={form.username}
                onChange={(e) => setField('username', e.target.value)}
                required
              />
              {errors.username && (
                <p className="mt-1 text-xs text-red-400">{errors.username}</p>
              )}
            </div>

            {/* 이메일 */}
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">
                이메일 <span className="text-red-400">*</span>
              </label>
              <input
                className="input-field"
                type="email"
                placeholder="you@example.com"
                value={form.email}
                onChange={(e) => setField('email', e.target.value)}
                required
              />
              {errors.email && (
                <p className="mt-1 text-xs text-red-400">{errors.email}</p>
              )}
            </div>

            {/* 휴대폰 번호 + SMS 인증 */}
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">
                휴대폰 번호 <span className="text-red-400">*</span>
              </label>

              {/* Phone input row */}
              <div className="flex gap-2">
                <input
                  className="input-field flex-1"
                  type="tel"
                  placeholder="01012345678"
                  value={form.phone}
                  onChange={(e) => setField('phone', e.target.value)}
                  disabled={phoneVerified}
                  required
                />
                <button
                  type="button"
                  className="btn-primary px-4 py-2 text-sm font-semibold rounded-lg whitespace-nowrap"
                  style={{ background: 'linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)' }}
                  onClick={handleSmsSend}
                  disabled={smsLoading || phoneVerified}
                >
                  {smsLoading && !smsSent ? '발송 중...' : smsSent ? '재발송' : '인증번호 발송'}
                </button>
              </div>

              {errors.phone && (
                <p className="mt-1 text-xs text-red-400">{errors.phone}</p>
              )}

              {/* SMS code row */}
              {smsSent && !phoneVerified && (
                <div className="flex gap-2 mt-2">
                  <div className="relative flex-1">
                    <input
                      className="input-field w-full pr-16"
                      type="text"
                      placeholder="인증번호 6자리"
                      maxLength={6}
                      value={smsCode}
                      onChange={(e) => setSmsCode(e.target.value.replace(/[^0-9]/g, ''))}
                    />
                    {countdown > 0 && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-indigo-400 font-mono">
                        {formatCountdown(countdown)}
                      </span>
                    )}
                    {countdown === 0 && smsSent && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-red-400">
                        만료
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors whitespace-nowrap"
                    onClick={handleSmsVerify}
                    disabled={smsLoading}
                  >
                    {smsLoading ? '확인 중...' : '확인'}
                  </button>
                </div>
              )}

              {smsTestMode && (
                <p className="mt-1 text-xs text-yellow-400">테스트 모드: 인증번호 123456</p>
              )}
              {errors.smsCode && (
                <p className="mt-1 text-xs text-red-400">{errors.smsCode}</p>
              )}

              {/* Verified */}
              {phoneVerified && (
                <div className="mt-2 flex items-center gap-2 text-sm text-emerald-400">
                  <span>&#10003;</span>
                  <span>인증 완료</span>
                </div>
              )}
            </div>

            {/* 비밀번호 */}
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">
                비밀번호 <span className="text-red-400">*</span>
              </label>
              <input
                className="input-field"
                type="password"
                placeholder="영문+숫자 8자 이상"
                value={form.password}
                onChange={(e) => setField('password', e.target.value)}
                required
              />
              <p className="mt-1 text-xs text-gray-500">영문과 숫자를 포함해 8자 이상</p>
              {errors.password && (
                <p className="mt-1 text-xs text-red-400">{errors.password}</p>
              )}
            </div>

            {/* 약관 동의 */}
            <div className="space-y-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-indigo-500 cursor-pointer"
                  checked={form.agreeTerms}
                  onChange={(e) => setField('agreeTerms', e.target.checked)}
                />
                <span className="text-sm text-gray-400">
                  <span className="text-gray-200">이용약관</span>에 동의합니다 <span className="text-red-400">(필수)</span>
                </span>
              </label>
              {errors.agreeTerms && (
                <p className="text-xs text-red-400 ml-6">{errors.agreeTerms}</p>
              )}

              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-indigo-500 cursor-pointer"
                  checked={form.agreePrivacy}
                  onChange={(e) => setField('agreePrivacy', e.target.checked)}
                />
                <span className="text-sm text-gray-400">
                  <span className="text-gray-200">개인정보 처리방침</span>에 동의합니다 <span className="text-red-400">(필수)</span>
                </span>
              </label>
              {errors.agreePrivacy && (
                <p className="text-xs text-red-400 ml-6">{errors.agreePrivacy}</p>
              )}
            </div>

            {/* Submit error */}
            {submitError && (
              <div className="bg-red-950 border border-red-800 text-red-400 text-sm px-4 py-3 rounded-lg">
                {submitError}
              </div>
            )}

            {/* Submit button */}
            <button
              type="submit"
              className="btn-primary w-full mt-2 py-3 font-semibold text-base"
              disabled={!canSubmit}
              style={
                canSubmit
                  ? { background: 'linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)', color: '#fff' }
                  : {}
              }
            >
              {loading ? '처리 중...' : '회원가입'}
            </button>

          </form>

          {/* Login link */}
          <p className="mt-6 text-center text-sm text-gray-500">
            이미 계정이 있으신가요?{' '}
            <Link href="/login" className="text-indigo-400 font-medium hover:text-indigo-300 hover:underline">
              로그인
            </Link>
          </p>
        </div>

      </div>
    </div>
  )
}
