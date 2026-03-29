// src/app/api/admin/stores/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin, isAdminError } from '@/lib/adminAuth'
import { logAdmin } from '@/lib/adminLog'

export async function GET(req: NextRequest) {
  const admin = requireAdmin(req); if (isAdminError(admin)) return admin
  try {
    const stores = await prisma.store.findMany({
      orderBy: { name: 'asc' },
      include: { machines: { select: { id: true, status: true } } },
    })

    const result = stores.map((s) => ({
      id:        s.id,
      name:      s.name,
      ipRanges:  s.ipRanges,
      gateway1:  s.gateway1,
      gateway2:  s.gateway2,
      address:   s.address,
      pcCount:   s.machines.length,
      readyCount: s.machines.filter((m) => m.status === 'READY').length,
      inUseCount: s.machines.filter((m) => m.status === 'IN_USE').length,
    }))

    return NextResponse.json({ stores: result })
  } catch (error) {
    console.error('[ADMIN STORES GET]', error)
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const admin = requireAdmin(req); if (isAdminError(admin)) return admin
  try {
    const body = await req.json()
    const { name, ipRanges, gateway1, gateway2, address } = body

    if (!name) {
      return NextResponse.json({ error: 'name 필수' }, { status: 400 })
    }

    const store = await prisma.store.create({
      data: { name, ipRanges, gateway1, gateway2, address },
    })

    await logAdmin(admin.adminId, 'STORE_ADD', name, `매장 추가: ${name}`)
    return NextResponse.json({ ok: true, store })
  } catch (error) {
    console.error('[ADMIN STORES POST]', error)
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}
