'use client'
export default function HomePage() {
  return (
    <iframe
      src="/remote1.html"
      style={{
        width: '100vw',
        height: '100vh',
        border: 'none',
        display: 'block',
      }}
    />
  )
}