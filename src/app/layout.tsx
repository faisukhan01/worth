import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { Toaster } from '@/components/ui/sonner'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Lodestar — Observability & AIOps Platform',
  description:
    'Unified telemetry, intelligent alerting and on-call workflows. See everything. Fix what matters.',
  keywords: ['observability', 'aiops', 'monitoring', 'telemetry', 'incident management'],
  authors: [{ name: 'Lodestar Engineering' }],
  openGraph: {
    title: 'Lodestar — Observability & AIOps Platform',
    description: 'See everything. Fix what matters.',
    siteName: 'Lodestar',
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        {children}
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  )
}
