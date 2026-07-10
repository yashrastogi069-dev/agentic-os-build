import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono, Space_Grotesk } from 'next/font/google'
import { ThemeEngineProvider } from '@/components/theme-engine-provider'
import './globals.css'

// Body / UI text.
const geistSans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' })
// Data / mono readouts (status bar, HUD figures). Kept as-is on purpose.
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })
// Display: headings, brand wordmark, big numbers. Exposed as --font-display.
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
})

export const metadata: Metadata = {
  title: 'Agentic OS',
  description:
    'A local-first personal AI operating system: memory, Obsidian, GitHub, voice, and Claude Code via MCP.',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#101318',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`dark bg-background ${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable}`}
    >
      <body className="font-sans antialiased">
        <ThemeEngineProvider>{children}</ThemeEngineProvider>
      </body>
    </html>
  )
}
