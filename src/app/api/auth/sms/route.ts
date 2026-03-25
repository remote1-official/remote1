// src/app/api/auth/sms/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import jwt from 'jsonwebtoken'

const phoneSchema = z.string().regex(/^01[0-9]{8,9}$/, '올바른 휴대폰 번호를 입력해주세요')

const SMS_SECRET = process.env.JWT_ACCESS_SECRET!
const TEST_CODE = '123456'

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

async function sendAligoSms(receiver: string, code: string): Promise<void> {
  const params = new URLSearchParams({
    key:      process.env.ALIGO_API_KEY!,
    user_id:  process.env.ALIGO_USER_ID!,
    sender:   process.env.ALIGO_SENDER!,
    receiver,
    msg:      `[REMOTE1] 인증번호: ${code} (3분 내 입력)`,
  })

  const res = await fetch('https://apis.aligo.in/send/', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    params.toString(),
  })

  const data = await res.json()

  if (String(data.result_code) !== '1') {
    throw new Error(data.message || 'SMS 발송에 실패했습니다')
  }
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')

  if (action === 'send')   return handleSend(req)
  if (action === 'verify') return handleVerify(req)

  return NextResponse.json({ error: '올바른 action을 지정해주세요 (send | verify)' }, { status: 400 })
}

async function handleSend(req: NextRequest) {
  try {
    const body        = await req.json()
    const phoneParsed = phoneSchema.safeParse(body.phone)

    if (!phoneParsed.success) {
      return NextResponse.json({ error: phoneParsed.error.errors[0].message }, { status: 400 })
    }

    const phone = phoneParsed.data
    let code: string
    let testMode = false

    // 알리고 SMS 발송 시도, 실패 시 테스트 모드로 폴백
    try {
      code = generateCode()
      await sendAligoSms(phone, code)
    } catch (smsError) {
      console.warn('[SMS FALLBACK] 알리고 발송 실패, 테스트 모드 전환:', smsError)
      code = TEST_CODE
      testMode = true
    }

    const token = jwt.sign(
      { phone, code, type: 'sms' },
      SMS_SECRET,
      { expiresIn: '3m' }
    )

    return NextResponse.json({ ok: true, token, testMode })
  } catch (error) {
    console.error('[SMS SEND ERROR]', error)
    return NextResponse.json({ error: '서버 오류가 발생했습니다' }, { status: 500 })
  }
}

async function handleVerify(req: NextRequest) {
  try {
    const body          = await req.json()
    const { token, code } = body

    if (!token || !code) {
      return NextResponse.json({ error: '토큰과 인증번호를 입력해주세요' }, { status: 400 })
    }

    let payload: { phone: string; code: string; type: string }

    try {
      payload = jwt.verify(token, SMS_SECRET) as { phone: string; code: string; type: string }
    } catch {
      return NextResponse.json({ error: '인증 시간이 만료되었습니다. 다시 시도해주세요' }, { status: 400 })
    }

    if (payload.type !== 'sms') {
      return NextResponse.json({ error: '올바르지 않은 토큰입니다' }, { status: 400 })
    }

    if (String(payload.code) !== String(code)) {
      return NextResponse.json({ error: '인증번호가 올바르지 않습니다' }, { status: 400 })
    }

    return NextResponse.json({ ok: true, phone: payload.phone })
  } catch (error) {
    console.error('[SMS VERIFY ERROR]', error)
    return NextResponse.json({ error: '서버 오류가 발생했습니다' }, { status: 500 })
  }
}
