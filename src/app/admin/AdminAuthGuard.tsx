'use client'

import { useState, useEffect, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

export default function AdminAuthGuard({ children }: Props) {
  const [authenticated, setAuthenticated] = useState(false)
  const [checking, setChecking] = useState(true)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [saveId, setSaveId] = useState(false)
  const [error, setError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)

  useEffect(() => {
    const savedId = localStorage.getItem('admin_saved_id')
    if (savedId) { setUsername(savedId); setSaveId(true) }
    checkAuth()
  }, [])

  async function checkAuth() {
    try {
      const res = await fetch('/api/admin/auth')
      if (res.ok) {
        setAuthenticated(true)
      }
    } catch {}
    setChecking(false)
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoginLoading(true)
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const data = await res.json()
      if (res.ok) {
        if (saveId) localStorage.setItem('admin_saved_id', username)
        else localStorage.removeItem('admin_saved_id')
        setAuthenticated(true)
      } else {
        setError(data.error || '로그인 실패')
      }
    } catch {
      setError('서버 오류')
    }
    setLoginLoading(false)
  }

  if (checking) {
    return (
      <div style={S.loadingPage}>
        <div style={S.loadingText}>인증 확인 중...</div>
      </div>
    )
  }

  if (!authenticated) {
    return (
      <div style={S.loginPage}>
        <form onSubmit={handleLogin} style={S.loginBox}>
          <div style={S.loginLogo}>
            <span style={{ fontSize: 24, fontWeight: 800, color: '#1e40af' }}>REMOTE1</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#94a3b8', marginLeft: 6 }}>Admin</span>
          </div>
          <div style={S.loginTitle}>관리자 로그인</div>

          {error && <div style={S.errorMsg}>{error}</div>}

          <div style={S.fieldGroup}>
            <label style={S.label}>아이디</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              style={S.input}
              placeholder="관리자 아이디"
              autoFocus
              autoComplete="username"
            />
          </div>

          <div style={S.fieldGroup}>
            <label style={S.label}>비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={S.input}
              placeholder="비밀번호"
              autoComplete="current-password"
            />
          </div>

          <label style={S.saveIdLabel}>
            <input type="checkbox" checked={saveId} onChange={e => setSaveId(e.target.checked)} />
            <span>아이디 저장</span>
          </label>

          <button
            type="submit"
            disabled={loginLoading || !username || !password}
            style={{
              ...S.loginBtn,
              opacity: (loginLoading || !username || !password) ? 0.6 : 1,
            }}
          >
            {loginLoading ? '로그인 중...' : '로그인'}
          </button>
        </form>
      </div>
    )
  }

  return <>{children}</>
}

const S: Record<string, React.CSSProperties> = {
  loadingPage: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: '100vh', background: '#f8f9fa',
  },
  loadingText: { fontSize: 16, color: '#aaa' },

  loginPage: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    minHeight: '100vh', background: '#f0f2f5',
    fontFamily: '"Pretendard", -apple-system, "Segoe UI", "Malgun Gothic", sans-serif',
  },
  loginBox: {
    width: 360, padding: '40px 32px', background: '#fff',
    borderRadius: 12, boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
    border: '1px solid #e5e7eb',
  },
  loginLogo: {
    textAlign: 'center' as const, marginBottom: 8,
  },
  loginTitle: {
    textAlign: 'center' as const, fontSize: 14, color: '#666',
    marginBottom: 28,
  },
  errorMsg: {
    padding: '10px 14px', borderRadius: 8,
    background: '#fef2f2', color: '#dc2626',
    fontSize: 13, fontWeight: 600, marginBottom: 16,
    border: '1px solid #fecaca', textAlign: 'center' as const,
  },
  fieldGroup: {
    marginBottom: 16,
  },
  label: {
    display: 'block', fontSize: 12, fontWeight: 600, color: '#555',
    marginBottom: 6,
  },
  input: {
    width: '100%', padding: '10px 14px', borderRadius: 8,
    border: '1px solid #d1d5db', fontSize: 14, outline: 'none',
    boxSizing: 'border-box' as const, transition: 'border-color 0.15s',
  },
  saveIdLabel: {
    display: 'flex', alignItems: 'center', gap: 6,
    fontSize: 13, color: '#666', cursor: 'pointer', marginTop: 4,
  },
  loginBtn: {
    width: '100%', padding: '12px 0', borderRadius: 8,
    border: 'none', background: '#1e40af', color: '#fff',
    fontSize: 15, fontWeight: 700, cursor: 'pointer',
    marginTop: 12, transition: 'opacity 0.15s',
  },
}
