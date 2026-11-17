import '@fontsource/noto-serif-sc/600.css'
import '@fontsource/noto-sans-sc/400.css'
import '@fontsource/noto-sans-sc/500.css'
import '@fontsource/noto-sans-sc/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'
import './styles/app.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AccountProvider } from './account'
import { App } from './App'
import { FloatApp } from './desktop/FloatApp'
import { ToastApp } from './desktop/ToastApp'
import { TrayMenu } from './desktop/TrayMenu'
import { PopoutApp } from './terminal/PopoutApp'
import { TooltipLayer } from './components/TooltipLayer'
import { DataDirProblem } from './components/DataDirProblem'
import { ThemeProvider } from './theme'

const route = location.hash.replace('#', '')

if (route.startsWith('datadir=')) {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ThemeProvider>
        <DataDirProblem dir={decodeURIComponent(route.slice('datadir='.length))} />
      </ThemeProvider>
    </StrictMode>
  )
} else if (route === 'toast' || route === 'float' || route === 'tray') {
  document.documentElement.classList.add('overlay-window')
  window.addEventListener('storage', (e) => {
    if (e.key !== 'ccshell-theme') return
    if (e.newValue === 'light') document.documentElement.dataset.theme = 'light'
    else delete document.documentElement.dataset.theme
  })
  createRoot(document.getElementById('root')!).render(<StrictMode>{route === 'toast' ? <ToastApp /> : route === 'tray' ? <TrayMenu /> : <FloatApp />}</StrictMode>)
} else if (route.startsWith('popout=')) {
  document.getElementById('root')!.classList.add('anim-window')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ThemeProvider>
        <PopoutApp id={decodeURIComponent(route.slice('popout='.length))} />
        <TooltipLayer />
      </ThemeProvider>
    </StrictMode>
  )
} else {
  document.getElementById('root')!.classList.add('anim-window')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ThemeProvider>
        <AccountProvider>
          <App />
        </AccountProvider>
      </ThemeProvider>
    </StrictMode>
  )
}
