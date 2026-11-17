import { ArrowLeft, ArrowRight, KeyRound, MessagesSquare, SquareTerminal, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useAccount } from '../account'
import { useTheme } from '../theme'
import { LogoLoader } from './LogoLoader'
import { Segmented } from './Segmented'

interface Page {
  icon?: LucideIcon
  title: string
  text: string
  tags?: string[]
}

const PAGES: Page[] = [
  { title: '欢迎使用 CC Shell', text: '对话、Claude Code 与账户，集中在一个窗口里。' },
  { icon: MessagesSquare, title: '对话', text: '多个模型随时切换。常用的设定、提示词和资料可以保存下来，反复使用。', tags: ['多模型', '助手', '提示词', '知识库'] },
  { icon: SquareTerminal, title: 'Claude Code', text: '在客户端里直接运行 Claude Code。消息可以排队发送，会话可以弹出到独立窗口，也能在后台继续。', tags: ['排队发送', '独立窗口', '历史会话'] },
  { icon: KeyRound, title: '账户', text: '登录 CC Shell 后自动配置密钥，余额与用量随时可查。Claude Code 也可以改用 Anthropic 账户。', tags: ['自动配置密钥', '余额与用量', 'Anthropic 账户'] },
  { title: '准备好了', text: '选择一个主题。之后可以在 设置 › 外观与启动 中更改。' }
]

export function Onboarding({ onFinish, onLogin }: { onFinish: () => void; onLogin: () => void }) {
  const [i, setI] = useState(0)
  const [dir, setDir] = useState<1 | -1>(1)
  const last = i === PAGES.length - 1
  const go = (n: number) => {
    if (n < 0 || n >= PAGES.length) return
    setDir(n > i ? 1 : -1)
    setI(n)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') last ? e.key === 'Enter' && onFinish() : go(i + 1)
      else if (e.key === 'ArrowLeft') go(i - 1)
      else if (e.key === 'Escape') onFinish()
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [i, last])

  const p = PAGES[i]
  return (
    <div data-onboarding className="dialog-backdrop fixed inset-0 z-[870] flex items-center justify-center bg-bg/70 p-6 backdrop-blur-md">
      <div role="dialog" aria-label="欢迎使用 CC Shell" className="dialog-card flex h-[440px] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_24px_70px_#00000033]">
        <div key={i} className={'flex min-h-0 flex-1 flex-col items-center justify-center px-12 text-center ' + (dir > 0 ? 'ob-next' : 'ob-prev')}>
          <Art page={i} icon={p.icon} />
          <h2 className="mt-6 font-serif text-[22px] font-semibold text-text">{p.title}</h2>
          <p className="mt-3 max-w-[380px] text-[13.5px] leading-relaxed text-text-2">{p.text}</p>
          {p.tags && (
            <div className="anim-stagger mt-5 flex flex-wrap justify-center gap-2">
              {p.tags.map((t, n) => (
                <span key={t} style={{ ['--i' as string]: n }} className="rounded-full border border-border bg-surface-2/60 px-2.5 py-1 text-[12px] text-text-2">
                  {t}
                </span>
              ))}
            </div>
          )}
          {last && <Finish onFinish={onFinish} onLogin={onLogin} />}
        </div>
        <footer className="flex h-16 shrink-0 items-center gap-3 border-t border-border px-6">
          <div className="flex flex-1 items-center gap-1.5" aria-label={`第 ${i + 1} 页，共 ${PAGES.length} 页`}>
            {PAGES.map((_, n) => (
              <button
                key={n}
                aria-label={`第 ${n + 1} 页`}
                onClick={() => go(n)}
                className={'h-1.5 rounded-full transition-[width,background-color] duration-[180ms] ease-[cubic-bezier(0.2,0.9,0.1,1)] ' + (n === i ? 'w-5 bg-brand' : 'w-1.5 bg-border-strong hover:bg-text-3')}
              />
            ))}
          </div>
          {!last && (
            <button className="btn btn-ghost h-9 px-3 text-[13px] text-text-3" onClick={onFinish}>
              跳过
            </button>
          )}
          {i > 0 && (
            <button className="btn btn-secondary h-9 w-9 p-0" aria-label="上一页" onClick={() => go(i - 1)}>
              <ArrowLeft size={15} />
            </button>
          )}
          {!last && (
            <button autoFocus className="btn btn-primary h-9 gap-1.5 px-4 text-[13px]" onClick={() => go(i + 1)}>
              {i === 0 ? '开始了解' : '下一步'}
              <ArrowRight size={15} />
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}

function Art({ page, icon: Icon }: { page: number; icon?: LucideIcon }) {
  if (!Icon) return <LogoLoader key={page} size={page === 0 ? 76 : 60} state="done" />
  return (
    <span className="ob-art flex size-16 items-center justify-center rounded-2xl border border-brand/15 bg-brand-soft text-brand-text">
      <Icon size={28} strokeWidth={1.6} />
    </span>
  )
}

function Finish({ onFinish, onLogin }: { onFinish: () => void; onLogin: () => void }) {
  const { theme, set } = useTheme()
  const account = useAccount()
  return (
    <div className="mt-6 flex flex-col items-center gap-5">
      <Segmented
        value={theme}
        options={[
          { value: 'light', label: '浅色' },
          { value: 'dark', label: '深色' }
        ]}
        onChange={set}
      />
      <Actions>
        {!account.user && (
          <button
            className="btn btn-secondary h-9 px-4 text-[13px]"
            onClick={() => {
              onFinish()
              onLogin()
            }}
          >
            登录 CC Shell
          </button>
        )}
        <button autoFocus className="btn btn-primary h-9 px-5 text-[13px]" onClick={onFinish}>
          开始使用
        </button>
      </Actions>
    </div>
  )
}

const Actions = ({ children }: { children: ReactNode }) => <div className="flex items-center gap-2">{children}</div>
