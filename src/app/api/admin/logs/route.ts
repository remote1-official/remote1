import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin, isAdminError } from '@/lib/adminAuth'

export async function GET(req: NextRequest) {
  const admin = requireAdmin(req); if (isAdminError(admin)) return admin
  try {
    const url = new URL(req.url)
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'))
    const limit = 50
    const action = url.searchParams.get('action') || ''
    const target = url.searchParams.get('target') || ''
    const from = url.searchParams.get('from') || ''
    const to = url.searchParams.get('to') || ''

    const where: Record<string, unknown> = {}
    if (action) where.action = action
    if (target) where.target = { contains: target, mode: 'insensitive' }

    if (from || to) {
      const createdAt: Record<string, Date> = {}
      if (from) createdAt.gte = new Date(from + 'T00:00:00')
      if (to) createdAt.lte = new Date(to + 'T23:59:59')
      where.createdAt = createdAt
    }

    const [logs, total] = await Promise.all([
      prisma.adminLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.adminLog.count({ where }),
    ])

    return NextResponse.json({
      logs,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    })
  } catch (error) {
    console.error('[ADMIN LOGS GET]', error)
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}
