import { app, session, shell } from 'electron'

export function devRendererUrl(): string | undefined {
  return app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL || undefined
}

export function guardWindows(): void {
  app.on('web-contents-created', (_e, wc) => {
    wc.on('will-attach-webview', (event) => event.preventDefault())
    if (wc.session !== session.defaultSession) return
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    wc.on('will-navigate', (event, url) => {
      if (url !== wc.getURL()) event.preventDefault()
    })
  })
}
