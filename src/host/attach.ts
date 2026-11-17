import { testEnv } from '../main/testhooks'
import { openSync } from 'node:fs'
import { connect } from 'node:net'
import { ReadStream } from 'node:tty'
import type { Readable } from 'node:stream'
import { frame, lineReader, type AttachMsg, type ToAttachMsg } from '../main/terminal/hostProtocol'

const [pipe, id, ticket] = process.argv.slice(2)
const pipeIo = testEnv('CCSHELL_ATTACH_PIPEIO') === '1'
const out = process.stdout

let input: Readable = process.stdin
let raw: ReadStream | null = null
if (!pipeIo) {
  try {
    raw = new ReadStream(openSync('\\\\.\\CONIN$', 'r+'))
    raw.setRawMode(true)
    input = raw
  } catch {
  }
}

const size = (): [number, number] => {
  const m = /^(\d+)x(\d+)$/.exec(testEnv('CCSHELL_ATTACH_SIZE') ?? '')
  if (m) return [Number(m[1]), Number(m[2])]
  return [out.columns || 120, out.rows || 30]
}

let title = 'Claude Code'
const setTitle = () => out.write(`\x1b]0;${title}（已从 CC Shell 分离 · 关掉窗口会结束会话）\x07`)
const dropTitle = (s: string) => s.replace(/\x1b\][012];[^\x07\x1b]*(\x07|\x1b\\)/g, '')

let finished = false
function finish(text: string, waitKey = true): void {
  if (finished) return
  finished = true
  out.write(`\r\n\x1b[0m\x1b[2m${text}\x1b[0m\r\n`)
  if (!waitKey || pipeIo) return void setTimeout(() => process.exit(0), 50)
  out.write('\x1b[2m按任意键关闭窗口…\x1b[0m')
  input.removeAllListeners('data')
  input.once('data', () => process.exit(0))
  input.resume()
}

const sock = connect(pipe)
const send = (msg: AttachMsg) => !sock.destroyed && sock.write(frame(msg))

sock.on('connect', () => {
  const [cols, rows] = size()
  send({ t: 'hello', role: 'attach', id, ticket: ticket ?? '', cols, rows })
})
sock.on(
  'data',
  lineReader((m) => {
    const msg = m as ToAttachMsg
    switch (msg.t) {
      case 'ok':
        title = msg.title
        out.write('\x1b[2J\x1b[3J\x1b[H')
        setTitle()
        input.on('data', (d: Buffer | string) => !finished && send({ t: 'input', data: d.toString() }))
        input.resume()
        return
      case 'error':
        return finish(msg.error)
      case 'data':
        out.write(dropTitle(msg.data))
        return
      case 'exit':
        return finish(`—— 会话已结束（代码 ${msg.code}）——`)
      case 'close':
        finished = true
        out.write('\r\n\x1b[2m—— 已收回到 CC Shell ——\x1b[0m\r\n')
        setTimeout(() => process.exit(0), 100)
        return
    }
  })
)
sock.on('error', (e) => finish(`连不上 CC Shell 的会话后台：${e.message}`))
sock.on('close', () => finish('—— 和 CC Shell 的会话后台断开了 ——'))

let last = size().join('x')
const onResize = () => {
  const [cols, rows] = size()
  if (`${cols}x${rows}` === last) return
  last = `${cols}x${rows}`
  send({ t: 'resize', cols, rows })
}
out.on('resize', onResize)
setInterval(onResize, 500).unref()
