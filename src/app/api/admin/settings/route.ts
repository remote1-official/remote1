// src/app/api/admin/settings/route.ts
// 관리자 설정 (자동관리 ON/OFF, 최소 대기 PC 수 등)
// DB 테이블 대신 간단히 JSON 파일 또는 KV로 저장
// Vercel 서버리스 환경이므로 DB에 저장
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin, isAdminError } from '@/lib/adminAuth'
import { logAdmin } from '@/lib/adminLog'

// AdminSetting을 별도 테이블 없이 Store 모델의 필드를 활용하거나,
// 간단히 전역 설정을 위한 키-값 방식으로 machines 테이블 활용
// → 가장 심플하게: /tmp 파일 대신 응답으로 관리

// 전역 설정을 DB의 별도 레코드로 저장 (machines 테이블의 특수 레코드)
const SETTINGS_KEY = '__ADMIN_SETTINGS__'

interface AdminSettings {
  autoManage: boolean
  minReadyPCs: number
}

const DEFAULT_SETTINGS: AdminSettings = {
  autoManage: false,
  minReadyPCs: 4,
}

async function getSettings(): Promise<AdminSettings> {
  try {
    // Store 테이블에 설정용 특수 레코드 사용
    const store = await prisma.store.findFirst({ where: { name: SETTINGS_KEY } })
    if (store && store.address) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(store.address) }
    }
  } catch (_) {}
  return DEFAULT_SETTINGS
}

async function saveSettings(settings: AdminSettings) {
  const existing = await prisma.store.findFirst({ where: { name: SETTINGS_KEY } })
  const data = { name: SETTINGS_KEY, address: JSON.stringify(settings) }
  if (existing) {
    await prisma.store.update({ where: { id: existing.id }, data })
  } else {
    await prisma.store.create({ data })
  }
}

export async function GET(req: NextRequest) {
  const admin = requireAdmin(req); if (isAdminError(admin)) return admin
  try {
    const settings = await getSettings()
    return NextResponse.json(settings)
  } catch (error) {
    console.error('[ADMIN SETTINGS GET]', error)
    return NextResponse.json(DEFAULT_SETTINGS)
  }
}

export async function POST(req: NextRequest) {
  const admin = requireAdmin(req); if (isAdminError(admin)) return admin
  try {
    const body = await req.json()
    const current = await getSettings()

    if (body.autoManage !== undefined) current.autoManage = !!body.autoManage
    if (body.minReadyPCs !== undefined) current.minReadyPCs = Math.max(1, Math.min(20, body.minReadyPCs))

    await saveSettings(current)

    const changes: string[] = []
    if (body.autoManage !== undefined) changes.push(`자동관리: ${current.autoManage ? 'ON' : 'OFF'}`)
    if (body.minReadyPCs !== undefined) changes.push(`최소 대기 PC: ${current.minReadyPCs}대`)
    await logAdmin(admin.adminId, 'SETTINGS_CHANGE', '시스템 설정', changes.join(', '))

    return NextResponse.json({ ok: true, ...current })
  } catch (error) {
    console.error('[ADMIN SETTINGS POST]', error)
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}
