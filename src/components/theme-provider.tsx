'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'
import type { ComponentProps } from 'react'

/**
 * Console theme provider.
 *
 * - attribute="class" drives the `.dark` selector in globals.css
 * - defaultTheme="dark" keeps the signature deep-space look for first paint
 * - enableSystem honours OS preference for users without an explicit choice
 */
export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  )
}
