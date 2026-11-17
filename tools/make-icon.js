const { app, BrowserWindow } = require('electron')
const { readFileSync, rmSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const appIcon = readFileSync(join(root, 'src', 'renderer', 'src', 'assets', 'ccshell.svg'), 'utf8')
const markSrc = readFileSync(join(root, 'src', 'renderer', 'src', 'components', 'LogoMark.tsx'), 'utf8')
const paths = [...markSrc.matchAll(/<path d="([^"]+)" fill="([^"]+)"/g)].map((m) => `<path d="${m[1]}" fill="${m[2]}"/>`).join('')
if (!paths) throw new Error('LogoMark.tsx 里没有找到路径')

function traySvg(size) {
  const u = 372 / size
  const blur = Math.max(4, 0.8 * u)
  const dy = Math.max(2.5, 0.6 * u)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="58 58 396 396">
<defs><filter id="s" x="-40%" y="-40%" width="180%" height="190%" color-interpolation-filters="sRGB">
<feGaussianBlur in="SourceAlpha" stdDeviation="${blur}"/><feOffset dy="${dy}" result="b"/>
<feFlood flood-color="#b8572f" flood-opacity="0.5"/><feComposite in2="b" operator="in"/>
<feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
<g filter="url(#s)">${paths}</g></svg>`
}

const CANVAS = 256

async function render(svg, size, file) {
  const c = Math.max(size, CANVAS)
  const win = new BrowserWindow({ width: c, height: c, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } })
  const html = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">
<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${c}" height="${c}" style="display:block"></body></html>`
  const page = join(process.env.TEMP || root, `make-icon-${size}.html`)
  writeFileSync(page, html)
  await win.loadFile(page)
  rmSync(page, { force: true })
  await new Promise((r) => setTimeout(r, 300))
  const img = (await win.webContents.capturePage()).resize({ width: size, height: size, quality: 'best' })
  writeFileSync(join(root, 'build', file), img.toPNG())
  console.log('build\\' + file, img.getSize())
  win.destroy()
}

app.disableHardwareAcceleration()
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  await render(appIcon, 512, 'icon.png')
  for (const size of [16, 24, 32]) await render(traySvg(size), size, `tray-${size}.png`)
  app.exit(0)
})
