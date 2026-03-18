# MyApp — Next.js + Tailwind + PostgreSQL + JWT + 토스 결제

## 📁 프로젝트 구조

```
src/
├── app/
│   ├── api/
│   │   ├── auth/
│   │   │   ├── signup/route.ts      # 회원가입 (bcrypt)
│   │   │   ├── login/route.ts       # 로그인 (JWT 발급)
│   │   │   ├── refresh/route.ts     # accessToken 갱신
│   │   │   └── logout/route.ts      # 로그아웃
│   │   └── payment/
│   │       ├── create-order/route.ts  # 주문 생성
│   │       ├── confirm/route.ts       # 토스 결제 승인 + 크레딧 충전
│   │       └── callback/route.ts      # 토스 리다이렉트 처리
│   ├── login/page.tsx
│   ├── signup/page.tsx
│   ├── dashboard/page.tsx           # 크레딧 현황 + 결제
│   └── payment/
│       ├── success/page.tsx
│       └── fail/page.tsx
├── lib/
│   ├── prisma.ts     # Prisma 싱글톤
│   ├── jwt.ts        # 토큰 서명/검증
│   ├── auth.ts       # 요청에서 유저 추출
│   └── apiClient.ts  # fetch 래퍼 (자동 토큰 갱신)
└── middleware.ts      # API 라우트 보호
prisma/
└── schema.prisma      # User, Payment 모델
```

---

## 🚀 시작하기

### 1. 패키지 설치
```bash
npm install
# 토스 SDK 추가
npm install @tosspayments/payment-sdk
# nanoid (주문 ID 생성)
npm install nanoid
```

### 2. 환경변수 설정
```bash
cp .env.example .env.local
# .env.local 파일을 열어 실제 값으로 수정
```

| 변수 | 설명 |
|------|------|
| `DATABASE_URL` | PostgreSQL 연결 문자열 |
| `JWT_ACCESS_SECRET` | accessToken 서명 키 (32자+) |
| `JWT_REFRESH_SECRET` | refreshToken 서명 키 (32자+) |
| `TOSS_SECRET_KEY` | 토스 시크릿 키 (서버 전용) |
| `NEXT_PUBLIC_TOSS_CLIENT_KEY` | 토스 클라이언트 키 |
| `NEXT_PUBLIC_APP_URL` | 앱 URL (콜백 리다이렉트용) |

### 3. DB 마이그레이션
```bash
npm run db:generate   # Prisma 클라이언트 생성
npm run db:push       # DB에 스키마 반영 (개발용)
# 또는
npm run db:migrate    # 마이그레이션 파일 생성 (운영 권장)
```

### 4. 개발 서버 실행
```bash
npm run dev
# http://localhost:3000
```

---

## 🔐 인증 플로우

```
[회원가입] POST /api/auth/signup
  → bcrypt(password, 12) 해싱 후 DB 저장

[로그인] POST /api/auth/login
  → accessToken (15분) + refreshToken (7일) 발급
  → refreshToken: HttpOnly 쿠키
  → accessToken: 클라이언트 sessionStorage

[API 요청] Authorization: Bearer <accessToken>

[토큰 갱신] POST /api/auth/refresh
  → 쿠키의 refreshToken 검증
  → Refresh Token Rotation: 새 쌍 발급 + DB 업데이트

[로그아웃] POST /api/auth/logout
  → DB refreshToken 삭제 + 쿠키 삭제
```

---

## 💳 토스 결제 플로우

```
1. POST /api/payment/create-order   → orderId, amount 발급 + DB PENDING 저장
2. 프론트: tossPayments.requestPayment() 결제창 호출
3. 토스 → GET /api/payment/callback (리다이렉트)
4. POST /api/payment/confirm        → 토스 서버 승인 요청
5. 승인 성공 → DB 트랜잭션:
   - Payment.status = DONE
   - User.credits += creditsAdded
```

---

## 🗄️ DB 스키마

### User
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | String (cuid) | PK |
| email | String (unique) | 이메일 |
| password | String | bcrypt 해시 |
| name | String | 이름 |
| credits | Int | 보유 크레딧(분) |
| refreshToken | String? | 현재 유효한 refreshToken |

### Payment
| 컬럼 | 타입 | 설명 |
|------|------|------|
| orderId | String (unique) | 토스 주문 ID |
| paymentKey | String? | 토스 결제 키 |
| amount | Int | 결제 금액 (원) |
| creditsAdded | Int | 충전 크레딧 |
| status | Enum | PENDING/DONE/FAILED/CANCELED |

---

## 🔒 보안 포인트

- **비밀번호**: bcrypt saltRounds 12
- **refreshToken**: HttpOnly 쿠키 (XSS 방지)
- **Refresh Token Rotation**: 재사용 감지
- **결제 위변조 방지**: 서버에서 amount 재검증 후 토스 승인
- **DB 트랜잭션**: 결제 승인 + 크레딧 충전 원자적 처리
- **Zod 입력 검증**: 모든 API 엔드포인트

---

## 📦 크레딧 패키지

| 패키지 | 크레딧 | 금액 |
|--------|--------|------|
| 기본 | 60분 (1시간) | 9,900원 |
| 스탠다드 | 180분 (3시간) | 29,900원 |
| 프리미엄 | 600분 (10시간) | 59,900원 |
