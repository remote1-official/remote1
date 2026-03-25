// src/app/api/notices/route.ts
import { NextResponse } from 'next/server'

const NOTICES = [
  {
    id:    1,
    title: '서비스 점검 안내',
    body:  '3월 28일(금) 새벽 2시~4시 서버 점검이 예정되어 있습니다. 해당 시간에는 서비스 이용이 제한됩니다.',
    date:  '2026-03-23',
  },
  {
    id:    2,
    title: 'REMOTE1 정식 출시 안내',
    body:  'REMOTE1 서비스가 정식 출시되었습니다. Sunshine/Moonlight 프로토콜로 초저지연 원격 PC 서비스를 경험해보세요.',
    date:  '2026-03-20',
  },
  {
    id:    3,
    title: '크레딧 충전 이벤트',
    body:  '출시 기념으로 첫 충전 시 50% 보너스 크레딧을 드립니다. 이벤트 기간: 3월 20일 ~ 4월 20일',
    date:  '2026-03-20',
  },
]

export async function GET() {
  return NextResponse.json({ notices: NOTICES })
}
