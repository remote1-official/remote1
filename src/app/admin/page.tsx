'use client'

import { useState, useEffect, useCallback } from 'react'

// ─── Types ───────────────────────────────────────────────────────────────────
interface MachineUser { id: string; username: string | null; email: string }
interface StoreInfo { id: string; name: string; pcCount: number; readyCount: number; inUseCount: number }
interface Machine {
  id: string; storeId: string | null; storeName: string | null; name: string
  sunshineHost: string; localIp: string | null; macAddress: string | null; spec: string | null
  status: 'OFF' | 'BOOTING' | 'READY' | 'IN_USE' | 'MAINTENANCE'
  isAvailable: boolean; lastPing: string | null; currentApp: string | null
  currentAppIcon: string | null; currentUser: MachineUser | null; sessionId: string | null
}
interface QueueEntry { id: string; position: number; user: MachineUser; createdAt: string }
interface Stats {
  machines: { total: number; off: number; booting: number; ready: number; inUse: number; maintenance: number }
  activeSessions: number; queueCount: number
  apps: Record<string, { count: number; icon: string | null }>
}

// ─── Constants ───────────────────────────────────────────────────────────────
const STATUS_LABEL: Record<string, string> = { OFF: '꺼짐', BOOTING: '부팅중', READY: '대기', IN_USE: '사용중', MAINTENANCE: '점검' }
const STATUS_DOT: Record<string, string> = { OFF: '#aaa', BOOTING: '#3b82f6', READY: '#22c55e', IN_USE: '#ef4444', MAINTENANCE: '#f59e0b' }
const ROW_BG: Record<string, string> = { OFF: '#fff', BOOTING: '#eff6ff', READY: '#fff', IN_USE: '#fef2f2', MAINTENANCE: '#fefce8' }

type StatusFilter = 'all' | 'IN_USE' | 'READY' | 'MAINTENANCE' | 'BOOTING' | 'OFF'

// ─── Component ───────────────────────────────────────────────────────────────
export default function AdminPage() {
  const [machines, setMachines] = useState<Machine[]>([])
  const [stores, setStores] = useState<StoreInfo[]>([])
  const [selectedStore, setSelectedStore] = useState('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [queue, setQueue] = useState<QueueEntry[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(new Date())
  const [autoManage, setAutoManage] = useState(false)
  const [minReadyPCs, setMinReadyPCs] = useState(4)

  const fetchAll = useCallback(async () => {
    try {
      const [mRes, qRes, sRes, stRes, setRes] = await Promise.all([
        fetch('/api/admin/machines'), fetch('/api/admin/queue'),
        fetch('/api/admin/stats'), fetch('/api/admin/stores'),
        fetch('/api/admin/settings'),
      ])
      const [mData, qData, sData, stData, setData] = await Promise.all([mRes.json(), qRes.json(), sRes.json(), stRes.json(), setRes.json()])
      setMachines(mData.machines || [])
      setQueue(qData.queue || [])
      setStats(sData)
      setStores(stData.stores || [])
      setAutoManage(!!setData.autoManage)
      setMinReadyPCs(setData.minReadyPCs ?? 4)
    } catch (e) { console.error('Fetch error', e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    fetchAll()
    const i1 = setInterval(fetchAll, 5000)
    const i2 = setInterval(() => setNow(new Date()), 1000)
    return () => { clearInterval(i1); clearInterval(i2) }
  }, [fetchAll])

  const filtered = machines
    .filter(m => selectedStore === 'all' ? true : selectedStore === 'none' ? !m.storeId : m.storeId === selectedStore)
    .filter(m => statusFilter === 'all' ? true : m.status === statusFilter)

  const toggleAutoManage = async () => {
    const next = !autoManage
    setAutoManage(next)
    await fetch('/api/admin/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoManage: next }) })
  }

  const changeMinReady = async (val: number) => {
    const v = Math.max(1, Math.min(20, val))
    setMinReadyPCs(v)
    await fetch('/api/admin/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ minReadyPCs: v }) })
  }

  const updateMachine = async (id: string, data: Record<string, unknown>) => {
    await fetch(`/api/admin/machines/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    fetchAll()
  }

  if (loading) return <div style={S.loadingPage}><div style={S.loadingText}>로딩 중...</div></div>

  return (
    <div style={S.page}>
      {/* Header */}
      <header style={S.header}>
        <div style={S.logoWrap}>
          <span style={S.logo}>REMOTE1</span>
          <span style={S.logoAdmin}>Admin</span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          {/* 자동관리 토글 */}
          <div style={S.autoBox}>
            <span style={{fontSize:12,color:'#666',fontWeight:600}}>자동관리</span>
            <button onClick={toggleAutoManage} style={{
              ...S.toggleBtn,
              background: autoManage ? '#22c55e' : '#d1d5db',
            }}>
              <span style={{
                ...S.toggleKnob,
                transform: autoManage ? 'translateX(18px)' : 'translateX(2px)',
              }} />
            </button>
            {autoManage && (
              <div style={{display:'flex',alignItems:'center',gap:4}}>
                <button style={S.minBtn} onClick={() => changeMinReady(minReadyPCs - 1)}>-</button>
                <span style={{fontSize:13,fontWeight:700,minWidth:20,textAlign:'center' as const}}>{minReadyPCs}</span>
                <button style={S.minBtn} onClick={() => changeMinReady(minReadyPCs + 1)}>+</button>
                <span style={{fontSize:11,color:'#888'}}>대</span>
              </div>
            )}
          </div>
          <span style={S.clock}>{now.toLocaleString('ko-KR')}</span>
        </div>
      </header>

      {/* Stats Bar */}
      {stats && (
        <div style={S.statsBar}>
          <StatBtn label="총 PC" value={stats.machines.total} color="#475569" active={statusFilter==='all'} onClick={() => setStatusFilter('all')} />
          <StatBtn label="사용중" value={stats.machines.inUse} color="#ef4444" active={statusFilter==='IN_USE'} onClick={() => setStatusFilter('IN_USE')} />
          <StatBtn label="대기" value={stats.machines.ready} color="#22c55e" active={statusFilter==='READY'} onClick={() => setStatusFilter('READY')} />
          <StatBtn label="점검" value={stats.machines.maintenance} color="#f59e0b" active={statusFilter==='MAINTENANCE'} onClick={() => setStatusFilter('MAINTENANCE')} />
          <StatBtn label="부팅중" value={stats.machines.booting} color="#3b82f6" active={statusFilter==='BOOTING'} onClick={() => setStatusFilter('BOOTING')} />
          <StatBtn label="꺼짐" value={stats.machines.off} color="#aaa" active={statusFilter==='OFF'} onClick={() => setStatusFilter('OFF')} />
          <div style={S.statDivider} />
          <StatBtn label="접속자" value={stats.activeSessions} color="#8b5cf6" active={false} onClick={() => {}} />
          <StatBtn label="대기열" value={stats.queueCount} color="#e11d48" active={false} onClick={() => {}} />
        </div>
      )}

      {/* App Stats */}
      {stats && Object.keys(stats.apps).length > 0 && (
        <div style={S.appBar}>
          {Object.entries(stats.apps).map(([app, info]) => (
            <span key={app} style={S.appChip}>
              {info.icon && <img src={info.icon} alt="" style={{width:14,height:14,borderRadius:2}} />}
              {app} <b>{info.count}</b>
            </span>
          ))}
        </div>
      )}

      {/* Store Tabs */}
      <div style={S.filterBar}>
        <button style={{...S.tab, ...(selectedStore==='all'?S.tabActive:{})}} onClick={() => setSelectedStore('all')}>전체 ({machines.length})</button>
        {stores.map(s => (
          <button key={s.id} style={{...S.tab, ...(selectedStore===s.id?S.tabActive:{})}} onClick={() => setSelectedStore(s.id)}>{s.name} ({s.pcCount})</button>
        ))}
        <button style={{...S.tab, ...(selectedStore==='none'?S.tabActive:{})}} onClick={() => setSelectedStore('none')}>미배정</button>
      </div>

      {/* Table */}
      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr style={S.thead}>
              <th style={{...S.th, width:50}}>No</th>
              <th style={{...S.th, width:70}}>상태</th>
              <th style={S.th}>PC</th>
              <th style={S.th}>IP</th>
              <th style={S.th}>매장</th>
              <th style={S.th}>이용자</th>
              <th style={S.th}>실행중</th>
              <th style={{...S.th, width:100}}>액션</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m, i) => (
              <tr key={m.id} style={{...S.tr, background: ROW_BG[m.status] || '#fff'}}
                onMouseEnter={e => (e.currentTarget.style.background = '#f0f7ff')}
                onMouseLeave={e => (e.currentTarget.style.background = ROW_BG[m.status] || '#fff')}>
                <td style={S.td}>{i + 1}</td>
                <td style={S.td}>
                  <span style={{...S.dot, background: STATUS_DOT[m.status]}} />
                  <span style={{fontSize:12, color:'#666'}}>{STATUS_LABEL[m.status]}</span>
                </td>
                <td style={{...S.td, fontWeight:600}}>{m.name}</td>
                <td style={{...S.td, fontFamily:'monospace', fontSize:12, color:'#666'}}>{m.sunshineHost}</td>
                <td style={{...S.td, color:'#7c3aed', fontSize:12}}>{m.storeName || '-'}</td>
                <td style={{...S.td, fontSize:12}}>{m.currentUser ? (m.currentUser.username || m.currentUser.email) : '-'}</td>
                <td style={{...S.td, fontSize:12}}>
                  {m.currentApp ? (
                    <span style={{display:'flex',alignItems:'center',gap:4}}>
                      {m.currentAppIcon && <img src={m.currentAppIcon} alt="" style={{width:14,height:14,borderRadius:2}} />}
                      {m.currentApp}
                    </span>
                  ) : '-'}
                </td>
                <td style={S.td}>
                  {m.status === 'OFF' && <button style={{...S.actionBtn,...S.actionGreen}} onClick={() => updateMachine(m.id, {status:'BOOTING'})}>켜기</button>}
                  {m.status === 'READY' && <><button style={{...S.actionBtn,...S.actionAmber}} onClick={() => updateMachine(m.id, {status:'MAINTENANCE',isAvailable:false})}>점검</button><button style={{...S.actionBtn,...S.actionRed}} onClick={() => updateMachine(m.id, {status:'OFF',isAvailable:true,currentApp:null,currentAppIcon:null})}>끄기</button></>}
                  {m.status === 'IN_USE' && <button style={{...S.actionBtn,...S.actionAmber}} onClick={() => updateMachine(m.id, {status:'MAINTENANCE',isAvailable:false})}>점검</button>}
                  {m.status === 'MAINTENANCE' && <button style={{...S.actionBtn,...S.actionBlue}} onClick={() => updateMachine(m.id, {status:'READY',isAvailable:true})}>복구</button>}
                  {m.status === 'BOOTING' && <span style={{fontSize:11,color:'#3b82f6'}}>부팅중...</span>}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={8} style={{...S.td, textAlign:'center' as const, color:'#aaa', padding:30}}>등록된 PC가 없습니다</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Queue */}
      {queue.length > 0 && (
        <div style={S.queueSection}>
          <h3 style={S.queueTitle}>대기열 ({queue.length}명)</h3>
          <table style={S.table}>
            <thead>
              <tr style={S.thead}>
                <th style={{...S.th, width:60}}>순번</th>
                <th style={S.th}>사용자</th>
                <th style={{...S.th, width:120}}>대기시간</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((q, i) => (
                <tr key={q.id} style={S.tr}>
                  <td style={{...S.td, fontWeight:700, color:'#e11d48'}}>{i+1}번</td>
                  <td style={S.td}>{q.user.username || q.user.email}</td>
                  <td style={{...S.td, color:'#888', fontSize:12}}>{new Date(q.createdAt).toLocaleTimeString('ko-KR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── StatBtn ─────────────────────────────────────────────────────────────────
function StatBtn({ label, value, color, active, onClick }: { label: string; value: number; color: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      ...S.statBtn,
      borderColor: active ? color : '#e5e7eb',
      background: active ? `${color}11` : '#fff',
    }}>
      <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{label}</div>
    </button>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const S: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh', background: '#f8f9fa', color: '#333',
    fontFamily: '"Pretendard", -apple-system, "Segoe UI", "Malgun Gothic", sans-serif',
    fontSize: 13,
  },
  loadingPage: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#f8f9fa' },
  loadingText: { fontSize: 16, color: '#aaa' },

  // Header
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 20px', background: '#fff', borderBottom: '1px solid #e5e7eb',
    position: 'sticky' as const, top: 0, zIndex: 10,
  },
  logoWrap: { display: 'flex', alignItems: 'baseline', gap: 6 },
  logo: { fontSize: 18, fontWeight: 800, color: '#1e40af' },
  logoAdmin: { fontSize: 13, fontWeight: 600, color: '#94a3b8' },
  clock: { fontSize: 12, color: '#94a3b8' },

  // Stats
  statsBar: {
    display: 'flex', gap: 6, padding: '12px 20px', flexWrap: 'wrap' as const,
    alignItems: 'center', background: '#fff', borderBottom: '1px solid #e5e7eb',
  },
  statBtn: {
    padding: '8px 14px', borderRadius: 8, border: '2px solid #e5e7eb',
    background: '#fff', cursor: 'pointer', textAlign: 'center' as const,
    minWidth: 70, transition: 'all 0.15s',
  },
  statDivider: { width: 1, height: 36, background: '#e5e7eb', margin: '0 4px' },

  // App bar
  appBar: {
    display: 'flex', gap: 6, padding: '8px 20px', flexWrap: 'wrap' as const,
    background: '#fff', borderBottom: '1px solid #e5e7eb',
  },
  appChip: {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '3px 10px', borderRadius: 20, background: '#f1f5f9',
    fontSize: 12, color: '#475569',
  },

  // Filter tabs
  filterBar: {
    display: 'flex', gap: 4, padding: '10px 20px',
    background: '#fff', borderBottom: '1px solid #e5e7eb',
  },
  tab: {
    padding: '6px 14px', borderRadius: 6, border: '1px solid #d1d5db',
    background: '#fff', color: '#666', fontSize: 12, fontWeight: 600,
    cursor: 'pointer', transition: 'all 0.12s',
  },
  tabActive: {
    background: '#1e40af', color: '#fff', borderColor: '#1e40af',
  },

  // Table
  tableWrap: { padding: '0 20px', marginTop: 12 },
  table: {
    width: '100%', borderCollapse: 'collapse' as const,
    background: '#fff', borderRadius: 8, overflow: 'hidden',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  },
  thead: { background: '#f5f5f5' },
  th: {
    padding: '10px 12px', textAlign: 'left' as const,
    fontSize: 11, fontWeight: 700, color: '#888',
    textTransform: 'uppercase' as const, letterSpacing: 0.5,
    borderBottom: '2px solid #e5e7eb',
  },
  tr: {
    borderBottom: '1px solid #f0f0f0', transition: 'background 0.1s',
    height: 40,
  },
  td: {
    padding: '6px 12px', fontSize: 13, verticalAlign: 'middle' as const,
  },
  dot: {
    display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
    marginRight: 6, verticalAlign: 'middle',
  },

  // Action buttons
  actionBtn: {
    padding: '3px 10px', borderRadius: 4, border: 'none',
    fontSize: 11, fontWeight: 600, cursor: 'pointer',
  },
  actionGreen: { background: '#dcfce7', color: '#16a34a' },
  actionRed: { background: '#fee2e2', color: '#dc2626' },
  actionAmber: { background: '#fef3c7', color: '#d97706' },
  actionBlue: { background: '#dbeafe', color: '#2563eb' },

  // Auto manage
  autoBox: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '4px 12px', borderRadius: 8, background: '#f8f9fa', border: '1px solid #e5e7eb',
  },
  toggleBtn: {
    width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
    position: 'relative' as const, transition: 'background 0.2s', padding: 0,
  },
  toggleKnob: {
    width: 18, height: 18, borderRadius: '50%', background: '#fff',
    position: 'absolute' as const, top: 2, transition: 'transform 0.2s',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
  },
  minBtn: {
    width: 22, height: 22, borderRadius: 4, border: '1px solid #d1d5db',
    background: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 700,
    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333',
  },

  // Queue
  queueSection: { padding: '16px 20px' },
  queueTitle: { fontSize: 14, fontWeight: 700, color: '#333', marginBottom: 8 },
}
