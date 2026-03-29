// src/app/api/admin/stats/route.ts
// GET: 전체 통계 (총 접속자, PC 상태별 수, 게임별 이용자 등)
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin, isAdminError } from '@/lib/adminAuth'

export async function GET(req: NextRequest) {
  const admin = requireAdmin(req); if (isAdminError(admin)) return admin
  try {
    // 전체 PC 상태별 수
    const machines = await prisma.machine.findMany()
    const statusCount = {
      total:       machines.length,
      off:         machines.filter((m) => m.status === 'OFF').length,
      booting:     machines.filter((m) => m.status === 'BOOTING').length,
      ready:       machines.filter((m) => m.status === 'READY').length,
      inUse:       machines.filter((m) => m.status === 'IN_USE').length,
      maintenance: machines.filter((m) => m.status === 'MAINTENANCE').length,
    }

    // 현재 활성 세션 수 (총 접속자)
    const activeSessions = await prisma.session.count({
      where: { status: 'ACTIVE' },
    })

    // 게임별 이용자 수 (currentApp 기준)
    const inUseMachines = machines.filter((m) => m.status === 'IN_USE' && m.currentApp)
    const appStats: Record<string, { count: number; icon: string | null }> = {}
    for (const m of inUseMachines) {
      const app = m.currentApp!
      if (!appStats[app]) {
        appStats[app] = { count: 0, icon: m.currentAppIcon }
      }
      appStats[app].count++
    }

    // 대기열 수
    const queueCount = await prisma.queue.count({
      where: { status: 'WAITING' },
    })

    return NextResponse.json({
      machines: statusCount,
      activeSessions,
      queueCount,
      apps: appStats,
    })
  } catch (error) {
    console.error('[ADMIN STATS]', error)
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}
