// src/app/api/admin/machines/[id]/route.ts
// PATCH: PC 상태 변경, 정보 수정 / DELETE: PC 삭제
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const body = await req.json()

    const updateData: Record<string, unknown> = {}

    if (body.name !== undefined)          updateData.name = body.name
    if (body.sunshineHost !== undefined)   updateData.sunshineHost = body.sunshineHost
    if (body.localIp !== undefined)        updateData.localIp = body.localIp
    if (body.macAddress !== undefined)     updateData.macAddress = body.macAddress
    if (body.spec !== undefined)           updateData.spec = body.spec
    if (body.status !== undefined)         updateData.status = body.status
    if (body.isAvailable !== undefined)    updateData.isAvailable = body.isAvailable
    if (body.lastPing !== undefined)       updateData.lastPing = new Date(body.lastPing)
    if (body.currentApp !== undefined)     updateData.currentApp = body.currentApp
    if (body.currentAppIcon !== undefined) updateData.currentAppIcon = body.currentAppIcon

    const machine = await prisma.machine.update({
      where: { id },
      data: updateData,
    })

    return NextResponse.json({ ok: true, machine })
  } catch (error) {
    console.error('[ADMIN MACHINE PATCH]', error)
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    await prisma.machine.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[ADMIN MACHINE DELETE]', error)
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}
