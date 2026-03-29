'use client'
import { useState, useEffect } from 'react'

interface UserPayment {
  id: string; amount: number; creditsAdded: number; status: string | null
  method: string | null; createdAt: string | null; planName: string
}
interface UserSession {
  id: string; startedAt: string; endedAt: string | null
  creditsUsed: number | null; status: string; machineName: string
}
interface UserRow {
  id: string; username: string | null; email: string; phone: string | null
  mainGame: string | null; credits: number; isSuspended: boolean; createdAt: string | null
  totalPaid: number; totalCharged: number; totalUsed: number
  lastPlan: string | null; refundAmount: number
  paymentCount: number; sessionCount: number
  payments: UserPayment[]; sessions: UserSession[]
}

function fmtDate(dt: string | null) {
  if (!dt) return '-'
  return new Date(dt).toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' })
}
function fmtDateTime(dt: string | null) {
  if (!dt) return '-'
  return new Date(dt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function fmtPrice(n: number) { return n.toLocaleString('ko-KR') + '원' }
function fmtCredits(c: number) {
  const h = Math.floor(c / 60), m = c % 60
  return h > 0 ? `${h}시간${m > 0 ? ` ${m}분` : ''}` : `${m}분`
}

const PLAN_OPTIONS = [
  { amount: 11000,  name: '스타터 (10h)', credits: 600 },
  { amount: 33000,  name: '스탠다드 (33h)', credits: 1980 },
  { amount: 66000,  name: '프리미엄 (66h)', credits: 3960 },
  { amount: 110000, name: '프로 (111h)', credits: 6660 },
  { amount: 330000, name: '프로MAX (333h)', credits: 19980 },
]

const SERVICE_OPTIONS = [
  { mins: 60,   label: '1시간' },
  { mins: 180,  label: '3시간' },
  { mins: 600,  label: '10시간' },
  { mins: 1800, label: '30시간' },
]

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedUser, setExpandedUser] = useState<string | null>(null)
  const [chargeLoading, setChargeLoading] = useState('')
  const [actionLoading, setActionLoading] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => { loadUsers() }, [])

  async function loadUsers() {
    setLoading(true)
    const res = await fetch('/api/admin/users')
    const data = await res.json()
    setUsers(data.users ?? [])
    setLoading(false)
  }

  async function chargeUser(userId: string, type: 'plan' | 'service', packageAmount: number) {
    const label = type === 'plan'
      ? PLAN_OPTIONS.find(p => p.amount === packageAmount)?.name
      : `서비스 ${Math.floor(packageAmount / 60)}시간`
    if (!confirm(`${label}을(를) 충전하시겠습니까?`)) return
    setChargeLoading(userId)
    await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, type, packageAmount }),
    })
    await loadUsers()
    setChargeLoading('')
  }

  async function toggleSuspend(userId: string, isSuspended: boolean) {
    const action = isSuspended ? 'unsuspend' : 'suspend'
    const msg = isSuspended ? '이용정지를 해제하시겠습니까?' : '이용정지 처리하시겠습니까?'
    if (!confirm(msg)) return
    setActionLoading(userId)
    await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, action }),
    })
    await loadUsers()
    setActionLoading('')
  }

  async function deleteUser(userId: string, username: string) {
    if (!confirm(`[${username}] 회원을 탈퇴 처리하시겠습니까?\n\n⚠️ 이 작업은 되돌릴 수 없습니다.`)) return
    if (!confirm('정말로 삭제하시겠습니까? 모든 결제/세션 기록이 삭제됩니다.')) return
    setActionLoading(userId)
    await fetch('/api/admin/users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    await loadUsers()
    setActionLoading('')
  }

  const filtered = users.filter(u => {
    if (!search) return true
    const s = search.toLowerCase()
    return (u.username?.toLowerCase().includes(s)) ||
           u.email.toLowerCase().includes(s) ||
           (u.phone?.includes(s)) ||
           (u.mainGame?.toLowerCase().includes(s))
  })

  if (loading) return <div style={S.loading}>불러오는 중...</div>

  return (
    <div style={S.page}>
      <header style={S.header}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <a href="/admin" style={{ fontSize: 18, fontWeight: 800, color: '#1e40af', textDecoration: 'none' }}>REMOTE1</a>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8' }}>회원 관리</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>총 {users.length}명</span>
          <a href="/admin" style={{ fontSize: 12, color: '#1e40af', textDecoration: 'none' }}>← PC 관리</a>
          <a href="/admin/logs" style={{fontSize:12,fontWeight:700,color:'#059669',textDecoration:'none',padding:'6px 14px',borderRadius:6,border:'1px solid #059669',background:'#ecfdf5'}}>기록 관리</a>
          <button onClick={async () => { await fetch('/api/admin/auth', { method: 'DELETE' }); window.location.href = '/admin' }} style={{fontSize:11,fontWeight:600,color:'#dc2626',padding:'5px 10px',borderRadius:6,border:'1px solid #fca5a5',background:'#fef2f2',cursor:'pointer'}}>로그아웃</button>
        </div>
      </header>

      {/* 검색 */}
      <div style={{ padding: '12px 20px', background: '#fff', borderBottom: '1px solid #e5e7eb' }}>
        <input
          style={S.searchInput}
          placeholder="아이디, 이메일, 휴대폰, 게임으로 검색..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* 회원 목록 테이블 */}
      <div style={{ padding: '12px 20px' }}>
        <table style={S.table}>
          <thead>
            <tr style={{ background: '#f5f5f5' }}>
              <th style={S.th}>아이디</th>
              <th style={S.th}>이메일</th>
              <th style={S.th}>휴대폰</th>
              <th style={S.th}>주 이용게임</th>
              <th style={S.th}>잔여시간</th>
              <th style={S.th}>총 결제</th>
              <th style={S.th}>환불 가능</th>
              <th style={S.th}>최근 요금제</th>
              <th style={S.th}>상태</th>
              <th style={S.th}>가입일</th>
              <th style={S.th}>충전</th>
              <th style={S.th}>관리</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(u => (
              <>
                <tr key={u.id} style={{ borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}
                    onClick={() => setExpandedUser(expandedUser === u.id ? null : u.id)}>
                  <td style={S.td}><b>{u.username || '-'}</b></td>
                  <td style={S.td}>{u.email}</td>
                  <td style={S.td}>{u.phone || '-'}</td>
                  <td style={{ ...S.td, color: '#0ea5e9', fontWeight: 600 }}>{u.mainGame || '-'}</td>
                  <td style={{ ...S.td, fontWeight: 700 }}>{fmtCredits(u.credits)}</td>
                  <td style={{ ...S.td, fontWeight: 600 }}>{u.totalPaid > 0 ? fmtPrice(u.totalPaid) : '-'}</td>
                  <td style={{ ...S.td, color: u.refundAmount > 0 ? '#16a34a' : '#999' }}>
                    {u.refundAmount > 0 ? fmtPrice(u.refundAmount) : '없음'}
                  </td>
                  <td style={{ ...S.td, color: '#6366f1', fontWeight: 600 }}>{u.lastPlan || '서비스'}</td>
                  <td style={S.td}>
                    {u.isSuspended
                      ? <span style={{ color: '#dc2626', fontWeight: 700 }}>정지</span>
                      : <span style={{ color: '#22c55e', fontWeight: 600 }}>정상</span>}
                  </td>
                  <td style={S.td}>{fmtDate(u.createdAt)}</td>
                  <td style={S.td} onClick={e => e.stopPropagation()}>
                    <select
                      style={S.selectBtn}
                      disabled={chargeLoading === u.id}
                      value=""
                      onChange={e => {
                        const v = e.target.value
                        if (v.startsWith('plan:')) chargeUser(u.id, 'plan', parseInt(v.split(':')[1]))
                        else if (v.startsWith('svc:')) chargeUser(u.id, 'service', parseInt(v.split(':')[1]))
                        e.target.value = ''
                      }}
                    >
                      <option value="">{chargeLoading === u.id ? '처리중...' : '충전 ▾'}</option>
                      <optgroup label="요금제">
                        {PLAN_OPTIONS.map(p => <option key={p.amount} value={`plan:${p.amount}`}>{p.name}</option>)}
                      </optgroup>
                      <optgroup label="서비스 (무료)">
                        {SERVICE_OPTIONS.map(s => <option key={s.mins} value={`svc:${s.mins}`}>{s.label}</option>)}
                      </optgroup>
                    </select>
                  </td>
                  <td style={S.td} onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        disabled={actionLoading === u.id}
                        onClick={() => toggleSuspend(u.id, u.isSuspended)}
                        style={{
                          padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                          cursor: 'pointer', border: '1px solid',
                          ...(u.isSuspended
                            ? { color: '#22c55e', borderColor: '#86efac', background: '#f0fdf4' }
                            : { color: '#f59e0b', borderColor: '#fcd34d', background: '#fffbeb' }),
                        }}
                      >
                        {u.isSuspended ? '해제' : '정지'}
                      </button>
                      <button
                        disabled={actionLoading === u.id}
                        onClick={() => deleteUser(u.id, u.username || u.email)}
                        style={{
                          padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                          cursor: 'pointer', color: '#dc2626', border: '1px solid #fca5a5', background: '#fef2f2',
                        }}
                      >
                        탈퇴
                      </button>
                    </div>
                  </td>
                </tr>
                {/* 상세 펼치기 */}
                {expandedUser === u.id && (
                  <tr key={u.id + '-detail'}>
                    <td colSpan={12} style={{ padding: '12px 16px', background: '#fafafa', borderBottom: '2px solid #e5e7eb' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                        {/* 결제 내역 */}
                        <div>
                          <h4 style={{ fontSize: 12, fontWeight: 700, color: '#666', marginBottom: 8 }}>결제 내역 ({u.paymentCount}건)</h4>
                          {u.payments.length === 0 ? <p style={{ fontSize: 12, color: '#999' }}>없음</p> : (
                            <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                              <thead><tr style={{ background: '#f0f0f0' }}>
                                <th style={S.thSm}>날짜</th><th style={S.thSm}>요금제</th><th style={S.thSm}>금액</th><th style={S.thSm}>시간</th><th style={S.thSm}>상태</th>
                              </tr></thead>
                              <tbody>{u.payments.map(p => (
                                <tr key={p.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                                  <td style={S.tdSm}>{fmtDateTime(p.createdAt)}</td>
                                  <td style={{ ...S.tdSm, color: p.planName === '서비스' ? '#8b5cf6' : '#333', fontWeight: 600 }}>{p.planName}</td>
                                  <td style={S.tdSm}>{p.amount > 0 ? fmtPrice(p.amount) : '-'}</td>
                                  <td style={{ ...S.tdSm, color: '#0ea5e9' }}>{fmtCredits(p.creditsAdded)}</td>
                                  <td style={S.tdSm}>{p.status === 'DONE' ? '✅' : p.status}</td>
                                </tr>
                              ))}</tbody>
                            </table>
                          )}
                        </div>
                        {/* 사용 기록 */}
                        <div>
                          <h4 style={{ fontSize: 12, fontWeight: 700, color: '#666', marginBottom: 8 }}>사용 기록 ({u.sessionCount}건)</h4>
                          {u.sessions.length === 0 ? <p style={{ fontSize: 12, color: '#999' }}>없음</p> : (
                            <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                              <thead><tr style={{ background: '#f0f0f0' }}>
                                <th style={S.thSm}>시작</th><th style={S.thSm}>종료</th><th style={S.thSm}>사용시간</th><th style={S.thSm}>PC</th>
                              </tr></thead>
                              <tbody>{u.sessions.map(s => (
                                <tr key={s.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                                  <td style={S.tdSm}>{fmtDateTime(s.startedAt)}</td>
                                  <td style={S.tdSm}>{s.endedAt ? fmtDateTime(s.endedAt) : '-'}</td>
                                  <td style={{ ...S.tdSm, color: '#0ea5e9' }}>{s.creditsUsed != null ? fmtCredits(s.creditsUsed) : '-'}</td>
                                  <td style={S.tdSm}>{s.machineName}</td>
                                </tr>
                              ))}</tbody>
                            </table>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f8f9fa', fontFamily: '"Pretendard", -apple-system, sans-serif', fontSize: 13 },
  loading: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#aaa' },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 20px', background: '#fff', borderBottom: '1px solid #e5e7eb',
    position: 'sticky', top: 0, zIndex: 10,
  },
  searchInput: {
    width: '100%', maxWidth: 400, padding: '8px 14px', borderRadius: 8,
    border: '1px solid #d1d5db', fontSize: 13, outline: 'none',
  },
  table: {
    width: '100%', borderCollapse: 'collapse', background: '#fff',
    borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  },
  th: {
    padding: '10px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700,
    color: '#888', borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap',
  },
  td: { padding: '10px 10px', fontSize: 12, color: '#333', whiteSpace: 'nowrap' },
  thSm: { padding: '6px 6px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#888' },
  tdSm: { padding: '5px 6px', fontSize: 11, color: '#555' },
  selectBtn: {
    padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db',
    fontSize: 11, fontWeight: 600, cursor: 'pointer', background: '#fff',
  },
}
