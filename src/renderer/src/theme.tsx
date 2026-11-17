import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { ThemeName } from '../../shared/theme'

const STORAGE_KEY = 'ccshell-theme'

function initialTheme(): ThemeName {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

const ThemeContext = createContext<{ theme: ThemeName; toggle: () => void; set: (t: ThemeName) => void }>({ theme: 'light', toggle: () => {}, set: () => {} })

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeName>(initialTheme)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'light') root.dataset.theme = 'light'
    else delete root.dataset.theme
    window.ccshell.setTheme(theme)
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {}
  }, [theme])

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) setTheme(e.newValue === 'light' ? 'light' : 'dark')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const toggle = useCallback(() => setTheme((t) => (t === 'light' ? 'dark' : 'light')), [])
  return <ThemeContext.Provider value={{ theme, toggle, set: setTheme }}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
