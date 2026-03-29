'use client'
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'

const NAV = [
  { href: '/mypage/info',     label: '내 정보',         icon: '👤' },
  { href: '/mypage/history',  label: '사용 기록',       icon: '📋' },
  { href: '/mypage/schedule', label: '예약 종료',       icon: '⏰' },
  { href: '/mypage/charge',   label: '시간 충전',       icon: '⚡' },
  { href: '/mypage/payments', label: '결제 및 충전 목록', icon: '💳' },
  { href: '/mypage/refund',   label: '환불',             icon: '↩️' },
]

export default function MypageLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter()
  const pathname = usePathname()
  const [userName, setUserName] = useState('')
  const [credits, setCredits]   = useState<number | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const stored = sessionStorage.getItem('user')
    if (!stored) { router.push('/login'); return }
    const u = JSON.parse(stored)
    setUserName(u.username || '')
    setCredits(u.credits ?? null)
  }, [router])

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    sessionStorage.clear()
    router.push('/login')
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Top bar */}
      <header className="border-b border-gray-800 bg-gray-950/90 backdrop-blur sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              className="md:hidden text-gray-400 hover:text-white p-1"
              onClick={() => setMobileOpen(v => !v)}
            >
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <Link href="/mypage/info" className="text-xl font-black tracking-tight" style={{ background: 'linear-gradient(135deg,#0ea5e9 0%,#6366f1 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              REMOTE1
            </Link>
          </div>
          <div className="flex items-center gap-4">
            {credits !== null && (
              <span className="hidden sm:flex items-center gap-1.5 text-sm">
                <span className="text-gray-400">잔여</span>
                <span className="font-bold text-sky-400">{Math.floor(credits / 60)}시간 {credits % 60}분</span>
              </span>
            )}
            <span className="text-sm text-gray-400 hidden sm:block">{userName}님</span>
            <button onClick={handleLogout} className="text-sm text-gray-500 hover:text-gray-300 transition-colors">
              로그아웃
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 flex gap-6">
        {/* Sidebar */}
        <aside className={`
          fixed inset-y-0 left-0 z-40 w-56 bg-gray-900 border-r border-gray-800 pt-14 transform transition-transform duration-200
          md:static md:transform-none md:w-52 md:shrink-0 md:bg-transparent md:border-0 md:pt-0
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}>
          {/* Mobile overlay */}
          {mobileOpen && (
            <div
              className="fixed inset-0 bg-black/60 z-[-1] md:hidden"
              onClick={() => setMobileOpen(false)}
            />
          )}

          <nav className="p-4 md:p-0 space-y-1">
            {NAV.map(item => {
              const active = pathname === item.href || pathname.startsWith(item.href + '/')
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`
                    flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all
                    ${active
                      ? 'bg-gradient-to-r from-sky-600/20 to-indigo-600/20 text-sky-300 border border-sky-500/30'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/60'
                    }
                  `}
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              )
            })}
          </nav>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0">
          {children}
        </main>
      </div>
    </div>
  )
}
