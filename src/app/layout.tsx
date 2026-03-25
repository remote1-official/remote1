import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'REMOTE1 — 고성능 원격 PC 서비스',
  description: '언제 어디서나 고성능 PC를 원격으로 이용하세요',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body style={{margin:0, padding:0, background:'#030712', minHeight:'100vh'}}>
        {children}
      </body>
    </html>
  )
}