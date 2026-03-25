// src/app/api/auth/signup/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'

const signupSchema = z.object({
  username: z
    .string()
    .min(4, '아이디는 최소 4자 이상이어야 합니다')
    .regex(/^[a-zA-Z0-9_]+$/, '아이디는 영문, 숫자, _만 사용 가능합니다'),
  email: z.string().email('올바른 이메일을 입력해주세요'),
  phone: z
    .string()
    .regex(/^01[0-9]{8,9}$/, '올바른 휴대폰 번호를 입력해주세요'),
  password: z
    .string()
    .min(8, '비밀번호는 최소 8자 이상이어야 합니다')
    .regex(/[A-Za-z]/, '영문자를 포함해야 합니다')
    .regex(/[0-9]/, '숫자를 포함해야 합니다'),
  phoneVerified: z.boolean().optional(),
  agreeTerms: z.boolean().optional(),
  agreePrivacy: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // 입력값 검증
    const parsed = signupSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0].message },
        { status: 400 }
      )
    }

    const { username, email, phone, password } = parsed.data

    // 아이디 중복 확인
    const existingUsername = await prisma.user.findUnique({ where: { username } })
    if (existingUsername) {
      return NextResponse.json(
        { error: '이미 사용 중인 아이디입니다' },
        { status: 409 }
      )
    }

    // 이메일 중복 확인
    const existingEmail = await prisma.user.findUnique({ where: { email } })
    if (existingEmail) {
      return NextResponse.json(
        { error: '이미 사용 중인 이메일입니다' },
        { status: 409 }
      )
    }

    // bcrypt 해싱 (saltRounds: 12)
    const hashedPassword = await bcrypt.hash(password, 12)

    // 유저 생성
    const user = await prisma.user.create({
      data: {
        username,
        email,
        phone,
        password: hashedPassword,
      },
      select: {
        id:        true,
        email:     true,
        username:  true,
        createdAt: true,
      },
    })

    return NextResponse.json(
      { message: '회원가입이 완료되었습니다', user },
      { status: 201 }
    )
  } catch (error) {
    console.error('[SIGNUP ERROR]', error)
    return NextResponse.json(
      { error: '서버 오류가 발생했습니다' },
      { status: 500 }
    )
  }
}
