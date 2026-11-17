import type { PreloadApi } from './index'

declare global {
  interface Window {
    ccshell: PreloadApi
  }
}
