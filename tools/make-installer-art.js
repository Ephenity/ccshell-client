const { app, BrowserWindow } = require('electron')
const { readFileSync, rmSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

const root = join(__dirname, '..')
const markSrc = readFileSync(join(root, 'src', 'renderer', 'src', 'components', 'LogoMark.tsx'), 'utf8')
const paths = [...markSrc.matchAll(/<path d="([^"]+)" fill="([^"]+)"/g)].map((m) => `<path d="${m[1]}" fill="${m[2]}"/>`).join('')
if (!paths) throw new Error('LogoMark.tsx 里没有找到路径')
const serifCss = pathToFileURL(join(root, 'node_modules', '@fontsource', 'noto-serif-sc', '600.css')).href

const PAGE_BG = '#f7f5ef'

const mark = (size, shadow) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="58 58 396 396">
${shadow ? `<defs><filter id="s" x="-40%" y="-40%" width="180%" height="190%" color-interpolation-filters="sRGB">
<feGaussianBlur in="SourceAlpha" stdDeviation="9"/><feOffset dy="6" result="b"/>
<feFlood flood-color="#b8572f" flood-opacity="0.5"/><feComposite in2="b" operator="in"/>
<feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><g filter="url(#s)">${paths}</g>` : paths}</svg>`

const sidebar = (w, h) => `<!doctype html><html><head><link rel="stylesheet" href="${serifCss}"></head>
<body style="margin:0;width:${w}px;height:${h}px;overflow:hidden;background:#1a1917">
<div style="position:absolute;inset:0;background:radial-gradient(circle at 50% 36%, rgba(217,119,87,0.22), rgba(217,119,87,0) 58%)"></div>
<div style="position:absolute;left:0;right:0;top:${Math.round(h * 0.22)}px;display:flex;flex-direction:column;align-items:center;gap:${Math.round(w * 0.1)}px">
  ${mark(Math.round(w * 0.52), false)}
  <div style="font-family:'Noto Serif SC',serif;font-weight:600;font-size:${Math.round(w * 0.135)}px;letter-spacing:0.04em;color:#f0eee6">CC Shell</div>
</div>
<div style="position:absolute;left:${Math.round(w * 0.12)}px;right:${Math.round(w * 0.12)}px;bottom:${Math.round(h * 0.07)}px;height:2px;background:linear-gradient(90deg, rgba(217,119,87,0), rgba(217,119,87,0.7), rgba(217,119,87,0))"></div>
</body></html>`

const header = (w, h) => `<!doctype html><html><body style="margin:0;width:${w}px;height:${h}px;overflow:hidden;background:${PAGE_BG}">
<div style="position:absolute;right:${Math.round(h * 0.18)}px;top:0;bottom:0;display:flex;align-items:center">${mark(Math.round(h * 0.78), true)}</div>
</body></html>`

function toBmp(img) {
  const { width: w, height: h } = img.getSize()
  const bgra = img.toBitmap()
  const row = Math.ceil((w * 3) / 4) * 4
  const data = Buffer.alloc(row * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4
      const d = (h - 1 - y) * row + x * 3
      data[d] = bgra[s]
      data[d + 1] = bgra[s + 1]
      data[d + 2] = bgra[s + 2]
    }
  const head = Buffer.alloc(54)
  head.write('BM', 0)
  head.writeUInt32LE(54 + data.length, 2)
  head.writeUInt32LE(54, 10)
  head.writeUInt32LE(40, 14)
  head.writeInt32LE(w, 18)
  head.writeInt32LE(h, 22)
  head.writeUInt16LE(1, 26)
  head.writeUInt16LE(24, 28)
  head.writeUInt32LE(data.length, 34)
  head.writeInt32LE(3780, 38)
  head.writeInt32LE(3780, 42)
  return Buffer.concat([head, data])
}

async function render(html, w, h, files) {
  const win = new BrowserWindow({ width: w, height: h, show: false, frame: false, useContentSize: true, webPreferences: { offscreen: true } })
  const page = join(process.env.TEMP || root, `make-art-${w}x${h}.html`)
  writeFileSync(page, html)
  await win.loadFile(page)
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
  await new Promise((r) => setTimeout(r, 400))
  rmSync(page, { force: true })
  let img = await win.webContents.capturePage()
  if (img.getSize().width !== w || img.getSize().height !== h) img = img.resize({ width: w, height: h, quality: 'best' })
  for (const f of files) {
    writeFileSync(join(root, 'build', f), toBmp(img))
    console.log('build\\' + f, img.getSize())
  }
  writeFileSync(join(process.env.TEMP || root, files[0].replace('.bmp', '.png')), img.toPNG())
  win.destroy()
}

app.disableHardwareAcceleration()
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  await render(sidebar(328, 628), 328, 628, ['installerSidebar.bmp', 'uninstallerSidebar.bmp'])
  await render(header(300, 114), 300, 114, ['installerHeader.bmp'])
  app.exit(0)
})
