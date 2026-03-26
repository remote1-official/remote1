'use client'

import { useState, useEffect, useCallback } from 'react'

// ─── Types ───────────────────────────────────────────────────────────────────
interface MachineUser {
  id: string
  username: string | null
  email: string
}

interface StoreInfo {
  id: string
  name: string
  pcCount: number
  readyCount: number
  inUseCount: number
}

interface Machine {
  id: string
  storeId: string | null
  storeName: string | null
  name: string
  sunshineHost: string
  localIp: string | null
  macAddress: string | null
  spec: string | null
  status: 'OFF' | 'BOOTING' | 'READY' | 'IN_USE' | 'MAINTENANCE'
  isAvailable: boolean
  lastPing: string | null
  currentApp: string | null
  currentAppIcon: string | null
  currentUser: MachineUser | null
  sessionId: string | null
}

interface QueueEntry {
  id: string
  position: number
  user: MachineUser
  createdAt: string
}

interface Stats {
  machines: { total: number; off: number; booting: number; ready: number; inUse: number; maintenance: number }
  activeSessions: number
  queueCount: number
  apps: Record<string, { count: number; icon: string | null }>
}

// ─── Status helpers ──────────────────────────────────────────────────────────
const STATUS_LABEL: Record<string, string> = {
  OFF: '꺼짐', BOOTING: '부팅중', READY: '대기', IN_USE: '사용중', MAINTENANCE: '점검',
}
const STATUS_COLOR: Record<string, string> = {
  OFF: '#64748b', BOOTING: '#f59e0b', READY: '#10b981', IN_USE: '#0ea5e9', MAINTENANCE: '#ef4444',
}

const BASE = ''  // same origin

// ─── Component ───────────────────────────────────────────────────────────────
export default function AdminPage() {
  const [machines, setMachines] = useState<Machine[]>([])
  const [stores, setStores] = useState<StoreInfo[]>([])
  const [selectedStore, setSelectedStore] = useState<string>('all')
  const [queue, setQueue] = useState<QueueEntry[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchAll = useCallback(async () => {
    try {
      const [mRes, qRes, sRes, stRes] = await Promise.all([
        fetch(`${BASE}/api/admin/machines`),
        fetch(`${BASE}/api/admin/queue`),
        fetch(`${BASE}/api/admin/stats`),
        fetch(`${BASE}/api/admin/stores`),
      ])
      const mData = await mRes.json()
      const qData = await qRes.json()
      const sData = await sRes.json()
      const stData = await stRes.json()
      setMachines(mData.machines || [])
      setQueue(qData.queue || [])
      setStats(sData)
      setStores(stData.stores || [])
    } catch (e) {
      console.error('Fetch error', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAll()
    const interval = setInterval(fetchAll, 5000) // 5초마다 폴링
    return () => clearInterval(interval)
  }, [fetchAll])

  const filteredMachines = selectedStore === 'all'
    ? machines
    : selectedStore === 'none'
      ? machines.filter((m) => !m.storeId)
      : machines.filter((m) => m.storeId === selectedStore)

  const updateMachine = async (id: string, data: Record<string, unknown>) => {
    await fetch(`${BASE}/api/admin/machines/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    fetchAll()
  }

  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.loading}>로딩 중...</div>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <h1 style={styles.logo}>REMOTE1 <span style={styles.logoSub}>Admin</span></h1>
        </div>
        <div style={styles.headerRight}>
          <span style={styles.headerTime}>{new Date().toLocaleString('ko-KR')}</span>
        </div>
      </header>

      {/* Stats Bar */}
      {stats && (
        <div style={styles.statsBar}>
          <StatCard label="총 PC" value={stats.machines.total} color="#94a3b8" />
          <StatCard label="사용중" value={stats.machines.inUse} color="#0ea5e9" />
          <StatCard label="대기" value={stats.machines.ready} color="#10b981" />
          <StatCard label="꺼짐" value={stats.machines.off} color="#64748b" />
          <StatCard label="부팅중" value={stats.machines.booting} color="#f59e0b" />
          <StatCard label="접속자" value={stats.activeSessions} color="#8b5cf6" />
          <StatCard label="대기열" value={stats.queueCount} color="#ef4444" />
        </div>
      )}

      {/* App Stats */}
      {stats && Object.keys(stats.apps).length > 0 && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>실행 중인 프로그램</h2>
          <div style={styles.appGrid}>
            {Object.entries(stats.apps).map(([app, info]) => (
              <div key={app} style={styles.appCard}>
                {info.icon && <img src={info.icon} alt="" style={styles.appIcon} />}
                <span style={styles.appName}>{app}</span>
                <span style={styles.appCount}>{info.count}명</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Store Tabs */}
      {stores.length > 0 && (
        <div style={styles.section}>
          <div style={styles.storeTabs}>
            <button
              style={{ ...styles.storeTab, ...(selectedStore === 'all' ? styles.storeTabActive : {}) }}
              onClick={() => setSelectedStore('all')}
            >
              전체 ({machines.length})
            </button>
            {stores.map((s) => (
              <button
                key={s.id}
                style={{ ...styles.storeTab, ...(selectedStore === s.id ? styles.storeTabActive : {}) }}
                onClick={() => setSelectedStore(s.id)}
              >
                {s.name} ({s.pcCount})
              </button>
            ))}
            <button
              style={{ ...styles.storeTab, ...(selectedStore === 'none' ? styles.storeTabActive : {}) }}
              onClick={() => setSelectedStore('none')}
            >
              미배정
            </button>
          </div>
        </div>
      )}

      {/* PC Grid */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>PC 현황 ({filteredMachines.length}대)</h2>
        <div style={styles.pcGrid}>
          {filteredMachines.map((m) => (
            <div key={m.id} style={{ ...styles.pcCard, borderColor: STATUS_COLOR[m.status] || '#334155' }}>
              <div style={styles.pcHeader}>
                <span style={{ ...styles.pcStatus, background: STATUS_COLOR[m.status] }}></span>
                <span style={styles.pcName}>{m.name}</span>
                <span style={styles.pcStatusLabel}>{STATUS_LABEL[m.status]}</span>
              </div>

              <div style={styles.pcInfo}>
                <div style={styles.pcRow}><span style={styles.pcLabel}>IP</span><span>{m.sunshineHost}</span></div>
                {m.storeName && <div style={styles.pcRow}><span style={styles.pcLabel}>매장</span><span style={{color:'#8b5cf6'}}>{m.storeName}</span></div>}
                {m.currentUser && (
                  <div style={styles.pcRow}><span style={styles.pcLabel}>이용자</span><span>{m.currentUser.username || m.currentUser.email}</span></div>
                )}
                {m.currentApp && (
                  <div style={styles.pcRow}>
                    <span style={styles.pcLabel}>실행</span>
                    <span style={styles.pcApp}>
                      {m.currentAppIcon && <img src={m.currentAppIcon} alt="" style={{ width: 16, height: 16, borderRadius: 2 }} />}
                      {m.currentApp}
                    </span>
                  </div>
                )}
                {m.lastPing && (
                  <div style={styles.pcRow}><span style={styles.pcLabel}>핑</span><span style={styles.pcPing}>{new Date(m.lastPing).toLocaleTimeString('ko-KR')}</span></div>
                )}
              </div>

              <div style={styles.pcActions}>
                {m.status === 'OFF' && (
                  <button style={{ ...styles.btn, ...styles.btnGreen }} onClick={() => updateMachine(m.id, { status: 'BOOTING' })}>
                    켜기
                  </button>
                )}
                {(m.status === 'READY' || m.status === 'IN_USE') && (
                  <button style={{ ...styles.btn, ...styles.btnRed }} onClick={() => updateMachine(m.id, { status: 'OFF', isAvailable: true, currentApp: null, currentAppIcon: null })}>
                    끄기
                  </button>
                )}
                {m.status === 'MAINTENANCE' && (
                  <button style={{ ...styles.btn, ...styles.btnBlue }} onClick={() => updateMachine(m.id, { status: 'READY', isAvailable: true })}>
                    복구
                  </button>
                )}
                {m.status !== 'MAINTENANCE' && m.status !== 'OFF' && (
                  <button style={{ ...styles.btn, ...styles.btnAmber }} onClick={() => updateMachine(m.id, { status: 'MAINTENANCE', isAvailable: false })}>
                    점검
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Queue */}
      {queue.length > 0 && (
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>대기열 ({queue.length}명)</h2>
          <div style={styles.queueList}>
            {queue.map((q, i) => (
              <div key={q.id} style={styles.queueItem}>
                <span style={styles.queuePos}>{i + 1}번</span>
                <span style={styles.queueUser}>{q.user.username || q.user.email}</span>
                <span style={styles.queueTime}>{new Date(q.createdAt).toLocaleTimeString('ko-KR')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Stat Card ───────────────────────────────────────────────────────────────
function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={styles.statCard}>
      <div style={{ ...styles.statValue, color }}>{value}</div>
      <div style={styles.statLabel}>{label}</div>
    </div>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh', background: '#0f172a', color: '#f1f5f9',
    fontFamily: '-apple-system, "Segoe UI", system-ui, sans-serif',
    padding: '0 0 40px 0',
  },
  loading: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: '100vh', fontSize: 18, color: '#94a3b8',
  },

  // Header
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '16px 20px', borderBottom: '1px solid #1e293b',
    position: 'sticky' as const, top: 0, background: '#0f172a', zIndex: 10,
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 12 },
  headerRight: { display: 'flex', alignItems: 'center', gap: 12 },
  logo: {
    fontSize: 20, fontWeight: 800, margin: 0,
    background: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
  },
  logoSub: { fontSize: 14, fontWeight: 600, opacity: 0.7 },
  headerTime: { fontSize: 13, color: '#64748b' },

  // Stats Bar
  statsBar: {
    display: 'flex', gap: 8, padding: '16px 20px', overflowX: 'auto' as const,
    flexWrap: 'wrap' as const,
  },
  statCard: {
    background: '#1e293b', borderRadius: 10, padding: '12px 16px',
    minWidth: 80, textAlign: 'center' as const, flex: '1 1 80px',
  },
  statValue: { fontSize: 24, fontWeight: 800 },
  statLabel: { fontSize: 11, color: '#94a3b8', marginTop: 2, fontWeight: 600 },

  // Section
  section: { padding: '0 20px', marginTop: 20 },
  sectionTitle: { fontSize: 16, fontWeight: 700, marginBottom: 12, color: '#e2e8f0' },

  // App Stats
  appGrid: { display: 'flex', gap: 8, flexWrap: 'wrap' as const },
  appCard: {
    display: 'flex', alignItems: 'center', gap: 8,
    background: '#1e293b', borderRadius: 8, padding: '8px 14px',
  },
  appIcon: { width: 20, height: 20, borderRadius: 4 },
  appName: { fontSize: 13, fontWeight: 600 },
  appCount: { fontSize: 13, color: '#0ea5e9', fontWeight: 700 },

  // PC Grid
  pcGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
    gap: 12,
  },
  pcCard: {
    background: '#1e293b', borderRadius: 12, padding: 14,
    border: '2px solid #334155', transition: 'border-color 0.2s',
  },
  pcHeader: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 },
  pcStatus: { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },
  pcName: { fontSize: 15, fontWeight: 700, flex: 1 },
  pcStatusLabel: { fontSize: 11, color: '#94a3b8', fontWeight: 600 },

  pcInfo: { display: 'flex', flexDirection: 'column' as const, gap: 4, marginBottom: 10 },
  pcRow: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 },
  pcLabel: { color: '#64748b', minWidth: 36, fontWeight: 600 },
  pcApp: { display: 'flex', alignItems: 'center', gap: 4 },
  pcPing: { color: '#94a3b8' },

  pcActions: { display: 'flex', gap: 6, flexWrap: 'wrap' as const },
  btn: {
    padding: '5px 12px', borderRadius: 6, border: 'none',
    fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'opacity 0.15s',
  },
  btnGreen: { background: 'rgba(16,185,129,0.15)', color: '#10b981' },
  btnRed: { background: 'rgba(239,68,68,0.15)', color: '#ef4444' },
  btnBlue: { background: 'rgba(14,165,233,0.15)', color: '#0ea5e9' },
  btnAmber: { background: 'rgba(245,158,11,0.15)', color: '#f59e0b' },

  // Store Tabs
  storeTabs: {
    display: 'flex', gap: 6, flexWrap: 'wrap' as const,
  },
  storeTab: {
    padding: '8px 16px', borderRadius: 8, border: '1px solid #334155',
    background: '#1e293b', color: '#94a3b8', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', transition: 'all 0.15s',
  },
  storeTabActive: {
    background: 'rgba(14,165,233,0.15)', color: '#0ea5e9', borderColor: 'rgba(14,165,233,0.4)',
  },

  // Queue
  queueList: { display: 'flex', flexDirection: 'column' as const, gap: 6 },
  queueItem: {
    display: 'flex', alignItems: 'center', gap: 12,
    background: '#1e293b', borderRadius: 8, padding: '10px 14px',
  },
  queuePos: { fontSize: 14, fontWeight: 800, color: '#f59e0b', minWidth: 40 },
  queueUser: { fontSize: 13, fontWeight: 600, flex: 1 },
  queueTime: { fontSize: 12, color: '#64748b' },
}
