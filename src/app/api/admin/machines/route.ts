// src/app/api/admin/machines/route.ts
// GET: 전체 PC 목록 조회 / POST: PC 등록
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const machines = await prisma.machine.findMany({
      orderBy: { name: 'asc' },
      include: {
        store: { select: { id: true, name: true } },
        sessions: {
          where: { status: 'ACTIVE' },
          include: { user: { select: { id: true, username: true, email: true } } },
          take: 1,
        },
      },
    })

    const result = machines.map((m) => ({
      id:             m.id,
      storeId:        m.storeId,
      storeName:      m.store?.name ?? null,
      name:           m.name,
      sunshineHost:   m.sunshineHost,
      localIp:        m.localIp,
      macAddress:     m.macAddress,
      spec:           m.spec,
      status:         m.status,
      isAvailable:    m.isAvailable,
      lastPing:       m.lastPing,
      currentApp:     m.currentApp,
      currentAppIcon: m.currentAppIcon,
      currentUser:    m.sessions[0]?.user ?? null,
      sessionId:      m.sessions[0]?.id ?? null,
    }))

    return NextResponse.json({ machines: result })
  } catch (error) {
    console.error('[ADMIN MACHINES GET]', error)
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name, sunshineHost, localIp, macAddress, spec, storeId } = body

    if (!name || !sunshineHost) {
      return NextResponse.json({ error: 'name, sunshineHost 필수' }, { status: 400 })
    }

    const machine = await prisma.machine.create({
      data: {
        name,
        sunshineHost,
        localIp:     localIp || null,
        macAddress:  macAddress || null,
        spec:        spec || null,
        storeId:     storeId || null,
        status:      'OFF',
        isAvailable: true,
      },
    })

    return NextResponse.json({ ok: true, machine })
  } catch (error) {
    console.error('[ADMIN MACHINES POST]', error)
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}
