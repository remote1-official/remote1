// src/app/api/admin/machines/[id]/route.ts
// PATCH: PC 상태 변경, 정보 수정 / DELETE: PC 삭제
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin, isAdminError } from '@/lib/adminAuth'
import { logAdmin } from '@/lib/adminLog'

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const admin = requireAdmin(req); if (isAdminError(admin)) return admin
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
    if (body.storeId !== undefined)       updateData.storeId = body.storeId || null

    // Determine log action based on status change
    const machine = await prisma.machine.update({
      where: { id },
      data: updateData,
    })

    if (body.status) {
      const actionMap: Record<string, string> = {
        BOOTING: 'PC_ON', OFF: 'PC_OFF', MAINTENANCE: 'PC_MAINTENANCE', READY: 'PC_RECOVER',
      }
      const action = actionMap[body.status]
      if (action) {
        const statusLabel: Record<string, string> = {
          BOOTING: '켜기', OFF: '끄기', MAINTENANCE: '점검', READY: '복구',
        }
        await logAdmin(admin.adminId, action, machine.name, `${machine.name} 상태 변경: ${statusLabel[body.status]}`)
      }
    }

    return NextResponse.json({ ok: true, machine })
  } catch (error) {
    console.error('[ADMIN MACHINE PATCH]', error)
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const admin = requireAdmin(req); if (isAdminError(admin)) return admin
  try {
    const { id } = await context.params
    const machine = await prisma.machine.findUnique({ where: { id } })
    await prisma.machine.delete({ where: { id } })
    await logAdmin(admin.adminId, 'PC_DELETE', machine?.name || id, `PC 삭제: ${machine?.name || id}`)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[ADMIN MACHINE DELETE]', error)
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}
