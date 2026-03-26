// src/app/api/admin/agent/route.ts
// 카운터 에이전트가 폴링하는 명령 큐
// GET: 대기 중인 명령 가져오기 (가져가면 삭제)
// POST: 새 명령 추가 (관리자 페이지 or 자동관리에서 호출)
import { NextRequest, NextResponse } from 'next/server'

// 메모리 기반 명령 큐 (Vercel 서버리스에서는 인스턴스 간 공유 안 됨)
// → DB 기반으로 변경 필요하지만, 우선 간단하게 전역 변수 사용
// 실제로는 Queue 테이블이나 별도 command 테이블 사용 권장

// 임시: 파일 기반 대신 DB의 machines 테이블 status 변경을 명령으로 활용
// 에이전트는 machines 상태를 폴링하여:
// - BOOTING 상태 PC → WOL 전송
// - OFF로 변경된 PC (이전에 READY였던) → 셧다운 전송

// 이 API는 에이전트의 heartbeat + 명령 확인용
export async function GET() {
  return NextResponse.json({
    ok: true,
    message: 'Agent endpoint active',
    timestamp: new Date().toISOString(),
  })
}

// 관리자가 수동으로 WOL/셧다운 명령을 내릴 때
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, machineId, macAddress, localIp } = body

    // 이 명령은 에이전트가 직접 처리하지 않고,
    // machines 테이블의 status 변경으로 에이전트에 전달됨
    // 여기서는 로그만 남기고 OK 반환
    console.log(`[Agent CMD] ${action} for ${machineId} (MAC: ${macAddress}, IP: ${localIp})`)

    return NextResponse.json({ ok: true, action })
  } catch (error) {
    console.error('[AGENT POST]', error)
    return NextResponse.json({ error: '서버 오류' }, { status: 500 })
  }
}
