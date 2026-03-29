// src/app/api/admin/stores/[id]/route.ts
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
    if (body.name !== undefined)     updateData.name = body.name
    if (body.ipRanges !== undefined)  updateData.ipRanges = body.ipRanges
    if (body.gateway1 !== undefined)  updateData.gateway1 = body.gateway1
    if (body.gateway2 !== undefined)  updateData.gateway2 = body.gateway2
    if (body.address !== undefined)   updateData.address = body.address

    const store = await prisma.store.update({ where: { id }, data: updateData })
    await logAdmin(admin.adminId, 'STORE_EDIT', store.name, `매장 수정: ${store.name}`)
    return NextResponse.json({ ok: true, store })
  } catch (error) {
    console.error('[ADMIN STORE PATCH]', error)
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const admin = requireAdmin(req); if (isAdminError(admin)) return admin
  try {
    const { id } = await context.params
    const store = await prisma.store.findUnique({ where: { id }, select: { name: true } })
    await prisma.store.delete({ where: { id } })
    await logAdmin(admin.adminId, 'STORE_DELETE', store?.name || id, `매장 삭제: ${store?.name || id}`)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[ADMIN STORE DELETE]', error)
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}
