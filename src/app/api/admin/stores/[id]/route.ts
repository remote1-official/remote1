// src/app/api/admin/stores/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
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
    return NextResponse.json({ ok: true, store })
  } catch (error) {
    console.error('[ADMIN STORE PATCH]', error)
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    await prisma.store.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[ADMIN STORE DELETE]', error)
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}
