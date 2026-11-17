export type ThemeName = 'dark' | 'light'

export const titleBarColors: Record<ThemeName, { color: string; symbolColor: string }> = {
  dark: { color: '#1a1917', symbolColor: '#b8b2a8' },
  light: { color: '#f7f5ef', symbolColor: '#5a554e' }
}

export const TITLE_BAR_HEIGHT = 40

export function dimColor(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  const ch = (v: number) => Math.round(v * (1 - alpha)).toString(16).padStart(2, '0')
  return '#' + ch((n >> 16) & 255) + ch((n >> 8) & 255) + ch(n & 255)
}

export const overlayColors: Record<ThemeName, { color: string; symbolColor: string }> = {
  dark: { color: '#201e1b', symbolColor: '#b8b2a8' },
  light: { color: '#f0eee6', symbolColor: '#5a554e' }
}
