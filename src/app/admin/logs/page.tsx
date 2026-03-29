'use client'
import { useState, useEffect } from 'react'

interface LogEntry {
  id: string
  adminId: string
  action: string
  target: string
  detail: string
  createdAt: string
}

const ACTION_LABELS: Record<string, string> = {
  CHARGE_SERVICE: '서비스 충전',
  CHARGE_PACKAGE: '요금제 충전',
  REFUND: '환불',
  PC_ON: 'PC 켜기',
  PC_OFF: 'PC 끄기',
  PC_MAINTENANCE: 'PC 점검',
  PC_RECOVER: 'PC 복구',
  PC_DELETE: 'PC 삭제',
  PC_ADD: 'PC 추가',
  USER_SUSPEND: '회원 정지',
  USER_UNSUSPEND: '정지 해제',
  USER_DELETE: '회원 삭제',
  SETTINGS_CHANGE: '설정 변경',
  LOGIN: '로그인',
  STORE_ADD: '매장 추가',
  STORE_EDIT: '매장 수정',
  STORE_DELETE: '매장 삭제',
}

const ACTION_COLORS: Record<string, string> = {
  CHARGE_SERVICE: '#8b5cf6',
  CHARGE_PACKAGE: '#6366f1',
  REFUND: '#dc2626',
  PC_ON: '#22c55e',
  PC_OFF: '#aaa',
  PC_MAINTENANCE: '#f59e0b',
  PC_RECOVER: '#3b82f6',
  PC_DELETE: '#dc2626',
  PC_ADD: '#16a34a',
  USER_SUSPEND: '#f59e0b',
  USER_UNSUSPEND: '#22c55e',
  USER_DELETE: '#dc2626',
  SETTINGS_CHANGE: '#0ea5e9',
  LOGIN: '#94a3b8',
  STORE_ADD: '#16a34a',
  STORE_EDIT: '#0ea5e9',
  STORE_DELETE: '#dc2626',
}

function fmtDateTime(dt: string) {
  return new Date(dt).toLocaleString('ko-KR', {
    year: '2-digit', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

export default function AdminLogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [actionFilter, setActionFilter] = useState('')
  const [targetSearch, setTargetSearch] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  async function loadLogs(p = page) {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(p))
    if (actionFilter) params.set('action', actionFilter)
    if (targetSearch) params.set('target', targetSearch)
    if (fromDate) params.set('from', fromDate)
    if (toDate) params.set('to', toDate)

    try {
      const res = await fetch('/api/admin/logs?' + params.toString())
      const data = await res.json()
      setLogs(data.logs ?? [])
      setTotal(data.total ?? 0)
      setTotalPages(data.totalPages ?? 1)
      setPage(data.page ?? 1)
    } catch (e) {
      console.error('Failed to load logs', e)
    }
    setLoading(false)
  }

  useEffect(() => { loadLogs(1) }, [actionFilter, fromDate, toDate])

  function handleSearch() {
    loadLogs(1)
  }

  return (
    <div style={S.page}>
      <header style={S.header}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <a href="/admin" style={{ fontSize: 18, fontWeight: 800, color: '#1e40af', textDecoration: 'none' }}>REMOTE1</a>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8' }}>기록 관리</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>총 {total}건</span>
          <a href="/admin" style={{ fontSize: 12, fontWeight: 700, color: '#1e40af', textDecoration: 'none', padding: '6px 14px', borderRadius: 6, border: '1px solid #1e40af', background: '#eff6ff' }}>PC 관리</a>
          <a href="/admin/users" style={{ fontSize: 12, fontWeight: 700, color: '#1e40af', textDecoration: 'none', padding: '6px 14px', borderRadius: 6, border: '1px solid #1e40af', background: '#eff6ff' }}>회원 관리</a>
          <button onClick={async () => { await fetch('/api/admin/auth', { method: 'DELETE' }); window.location.href = '/admin' }} style={{ fontSize: 11, fontWeight: 600, color: '#dc2626', padding: '5px 10px', borderRadius: 6, border: '1px solid #fca5a5', background: '#fef2f2', cursor: 'pointer' }}>로그아웃</button>
        </div>
      </header>

      {/* Filters */}
      <div style={{ padding: '12px 20px', background: '#fff', borderBottom: '1px solid #e5e7eb', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' as const }}>
        <select
          style={S.filterSelect}
          value={actionFilter}
          onChange={e => setActionFilter(e.target.value)}
        >
          <option value="">전체 작업</option>
          {Object.entries(ACTION_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <input
          style={S.filterInput}
          placeholder="대상 검색 (이메일, PC명...)"
          value={targetSearch}
          onChange={e => setTargetSearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
        />
        <button onClick={handleSearch} style={S.searchBtn}>검색</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="date" style={S.dateInput} value={fromDate} onChange={e => setFromDate(e.target.value)} />
          <span style={{ fontSize: 12, color: '#999' }}>~</span>
          <input type="date" style={S.dateInput} value={toDate} onChange={e => setToDate(e.target.value)} />
        </div>
      </div>

      {/* Table */}
      <div style={{ padding: '12px 20px' }}>
        {loading ? (
          <div style={{ textAlign: 'center' as const, padding: 40, color: '#aaa' }}>불러오는 중...</div>
        ) : (
          <table style={S.table}>
            <thead>
              <tr style={{ background: '#f5f5f5' }}>
                <th style={{ ...S.th, width: 160 }}>시간</th>
                <th style={{ ...S.th, width: 80 }}>관리자</th>
                <th style={{ ...S.th, width: 110 }}>작업</th>
                <th style={{ ...S.th, width: 180 }}>대상</th>
                <th style={S.th}>상세내용</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id} style={S.tr}>
                  <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11, color: '#666' }}>
                    {fmtDateTime(log.createdAt)}
                  </td>
                  <td style={{ ...S.td, fontWeight: 600, fontSize: 12 }}>{log.adminId}</td>
                  <td style={S.td}>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 700,
                      color: ACTION_COLORS[log.action] || '#666',
                      background: (ACTION_COLORS[log.action] || '#666') + '18',
                    }}>
                      {ACTION_LABELS[log.action] || log.action}
                    </span>
                  </td>
                  <td style={{ ...S.td, fontWeight: 600, fontSize: 12, color: '#1e40af' }}>{log.target}</td>
                  <td style={{ ...S.td, fontSize: 12, color: '#555' }}>{log.detail}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ ...S.td, textAlign: 'center' as const, color: '#aaa', padding: 40 }}>
                    기록이 없습니다
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 4, marginTop: 16 }}>
            <button
              disabled={page <= 1}
              onClick={() => loadLogs(page - 1)}
              style={{ ...S.pageBtn, opacity: page <= 1 ? 0.4 : 1 }}
            >
              이전
            </button>
            {Array.from({ length: Math.min(10, totalPages) }, (_, i) => {
              const start = Math.max(1, Math.min(page - 5, totalPages - 9))
              const p = start + i
              if (p > totalPages) return null
              return (
                <button
                  key={p}
                  onClick={() => loadLogs(p)}
                  style={{
                    ...S.pageBtn,
                    background: p === page ? '#1e40af' : '#fff',
                    color: p === page ? '#fff' : '#333',
                    borderColor: p === page ? '#1e40af' : '#d1d5db',
                  }}
                >
                  {p}
                </button>
              )
            })}
            <button
              disabled={page >= totalPages}
              onClick={() => loadLogs(page + 1)}
              style={{ ...S.pageBtn, opacity: page >= totalPages ? 0.4 : 1 }}
            >
              다음
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh', background: '#f8f9fa', color: '#333',
    fontFamily: '"Pretendard", -apple-system, "Segoe UI", "Malgun Gothic", sans-serif',
    fontSize: 13,
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 20px', background: '#fff', borderBottom: '1px solid #e5e7eb',
    position: 'sticky', top: 0, zIndex: 10,
  },
  table: {
    width: '100%', borderCollapse: 'collapse', background: '#fff',
    borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  },
  th: {
    padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700,
    color: '#888', borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap',
  },
  tr: {
    borderBottom: '1px solid #f0f0f0', transition: 'background 0.1s',
  },
  td: {
    padding: '8px 12px', fontSize: 13, verticalAlign: 'middle',
  },
  filterSelect: {
    padding: '7px 10px', borderRadius: 6, border: '1px solid #d1d5db',
    fontSize: 12, outline: 'none', cursor: 'pointer', background: '#fff',
  },
  filterInput: {
    padding: '7px 12px', borderRadius: 6, border: '1px solid #d1d5db',
    fontSize: 12, outline: 'none', width: 220,
  },
  searchBtn: {
    padding: '7px 16px', borderRadius: 6, border: '1px solid #1e40af',
    background: '#1e40af', color: '#fff', fontSize: 12, fontWeight: 700,
    cursor: 'pointer',
  },
  dateInput: {
    padding: '6px 8px', borderRadius: 6, border: '1px solid #d1d5db',
    fontSize: 12, outline: 'none',
  },
  pageBtn: {
    padding: '6px 12px', borderRadius: 6, border: '1px solid #d1d5db',
    background: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
}
