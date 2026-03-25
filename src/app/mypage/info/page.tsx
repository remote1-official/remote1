'use client'
import { useState, useEffect } from 'react'
import { apiFetch } from '@/lib/apiClient'

type UserInfo = {
  id: string
  username: string | null
  email: string
  phone: string | null
  credits: number
  createdAt: string
}

export default function InfoPage() {
  const [user, setUser]       = useState<UserInfo | null>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm]       = useState({ email: '', phone: '' })
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    apiFetch('/api/mypage/info')
      .then(r => r.json())
      .then(d => {
        setUser(d.user)
        setForm({ email: d.user.email, phone: d.user.phone ?? '' })
      })
  }, [])

  async function handleSave() {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const res  = await apiFetch('/api/mypage/info', { method: 'PUT', body: JSON.stringify(form) })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }
      setUser(data.user)
      setEditing(false)
      setSuccess('정보가 수정되었습니다.')
      // Sync to sessionStorage
      const stored = sessionStorage.getItem('user')
      if (stored) {
        const u = JSON.parse(stored)
        sessionStorage.setItem('user', JSON.stringify({ ...u, email: data.user.email }))
      }
    } finally {
      setSaving(false)
    }
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-500 text-sm">불러오는 중...</div>
    )
  }

  const hours   = Math.floor(user.credits / 60)
  const minutes = user.credits % 60

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">내 정보</h1>

      {/* Credits card */}
      <div className="rounded-2xl p-6 text-white relative overflow-hidden" style={{ background: 'linear-gradient(135deg,#0ea5e9 0%,#6366f1 100%)' }}>
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 80% 50%, white 0%, transparent 60%)' }} />
        <p className="text-sky-100 text-sm font-medium">잔여 이용 시간</p>
        <p className="text-5xl font-black mt-1 tracking-tight">
          {hours}<span className="text-2xl font-normal text-sky-200 ml-1">시간</span>
          {' '}{minutes}<span className="text-2xl font-normal text-sky-200 ml-1">분</span>
        </p>
        <p className="text-sky-200 text-sm mt-2">총 {user.credits}분</p>
      </div>

      {/* Info card */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-200">계정 정보</h2>
          {!editing && (
            <button
              onClick={() => { setEditing(true); setSuccess('') }}
              className="text-sm text-sky-400 hover:text-sky-300 transition-colors"
            >
              수정
            </button>
          )}
        </div>

        {success && (
          <div className="bg-emerald-950 border border-emerald-700 text-emerald-400 text-sm px-4 py-3 rounded-lg">{success}</div>
        )}
        {error && (
          <div className="bg-red-950 border border-red-800 text-red-400 text-sm px-4 py-3 rounded-lg">{error}</div>
        )}

        <div className="grid gap-4">
          <InfoRow label="아이디" value={user.username ?? '-'} />

          <InfoField
            label="이메일"
            value={editing ? form.email : user.email}
            editing={editing}
            onChange={v => setForm(f => ({ ...f, email: v }))}
            type="email"
          />
          <InfoField
            label="휴대폰"
            value={editing ? form.phone : (user.phone ?? '-')}
            editing={editing}
            onChange={v => setForm(f => ({ ...f, phone: v }))}
            type="tel"
          />

          <InfoRow label="가입일" value={new Date(user.createdAt).toLocaleDateString('ko-KR')} />
        </div>

        {editing && (
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg,#0ea5e9 0%,#6366f1 100%)' }}
            >
              {saving ? '저장 중...' : '저장'}
            </button>
            <button
              onClick={() => { setEditing(false); setError('') }}
              className="px-5 py-2 rounded-xl text-sm font-medium text-gray-400 bg-gray-800 hover:bg-gray-700 transition-colors"
            >
              취소
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-800">
      <span className="text-sm text-gray-400">{label}</span>
      <span className="text-sm text-gray-200 font-medium">{value}</span>
    </div>
  )
}

function InfoField({ label, value, editing, onChange, type = 'text' }: {
  label: string
  value: string
  editing: boolean
  onChange: (v: string) => void
  type?: string
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-800 gap-4">
      <span className="text-sm text-gray-400 shrink-0">{label}</span>
      {editing ? (
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="text-sm text-right bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-gray-100 focus:outline-none focus:ring-2 focus:ring-sky-500 w-52"
        />
      ) : (
        <span className="text-sm text-gray-200 font-medium">{value}</span>
      )}
    </div>
  )
}
