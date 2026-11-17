import { ChevronDown, Globe, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type InputHTMLAttributes } from 'react'
import { useAccount } from '../../account'
import { LogoLoader } from '../../components/LogoLoader'

const MIN_BUSY_MS = 700
const atLeast = async <T,>(p: Promise<T>): Promise<T> => {
  const [r] = await Promise.all([p, new Promise((ok) => setTimeout(ok, MIN_BUSY_MS))])
  return r
}

type Step = { kind: 'password' } | { kind: 'two-factor' } | { kind: 'web-login' }
type Mode = 'password' | 'web'

const modeCache = new Map<string, Mode>()
const modeLoading = new Map<string, Promise<Mode>>()

export function preloadLoginMode(baseUrl: string): Promise<Mode> {
  const hit = modeCache.get(baseUrl)
  if (hit) return Promise.resolve(hit)
  let p = modeLoading.get(baseUrl)
  if (!p) {
    p = window.ccshell.account.loginMode().then((r) => {
      const m: Mode = r.ok ? r.data : 'password'
      if (r.ok) modeCache.set(baseUrl, m)
      modeLoading.delete(baseUrl)
      return m
    })
    modeLoading.set(baseUrl, p)
  }
  return p
}

export function LoginView() {
  const account = useAccount()
  const [mode, setMode] = useState<Mode | null>(() => modeCache.get(account.baseUrl) ?? null)
  const [step, setStep] = useState<Step>(() => ({ kind: modeCache.get(account.baseUrl) === 'web' ? 'web-login' : 'password' }))
  const [form, setForm] = useState({ account: '', password: '' })
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const codeRef = useRef<HTMLInputElement>(null)

  const webOnly = mode === 'web'

  useEffect(() => {
    if (step.kind === 'two-factor') codeRef.current?.focus()
  }, [step.kind])

  useEffect(() => {
    let alive = true
    const cached = modeCache.get(account.baseUrl)
    if (!cached) setMode(null)
    void preloadLoginMode(account.baseUrl).then((m) => {
      if (!alive) return
      setMode(m)
      setStep((s) => (m === 'web' ? { kind: 'web-login' } : s.kind === 'web-login' ? { kind: 'password' } : s))
    })
    return () => {
      alive = false
    }
  }, [account.baseUrl])

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const r = await atLeast(window.ccshell.account.login(form.account, form.password))
    setBusy(false)
    if (!r.ok) return setError(r.error)
    if (r.data.kind === 'two-factor') setStep({ kind: 'two-factor' })
    if (r.data.kind === 'web-login') setStep({ kind: 'web-login' })
  }

  const submitCode = async (value: string) => {
    if (busy || value.length < 6) return
    setBusy(true)
    setError(null)
    const r = await atLeast(window.ccshell.account.verify(value))
    setBusy(false)
    if (r.ok) return
    if (r.code === 'expired') {
      setStep({ kind: 'password' })
      setForm((f) => ({ ...f, password: '' }))
    }
    setError(r.error)
    setCode('')
    codeRef.current?.focus()
  }

  const webLogin = async () => {
    setBusy(true)
    setError(null)
    const r = await window.ccshell.account.webLogin()
    setBusy(false)
    if (!r.ok) setError(r.error)
    else if (!r.data) setError('网页登录窗口已关闭，登录未完成')
  }

  return (
    <div className="flex h-full items-center justify-center overflow-auto p-8" style={{ background: 'var(--hero-glow)' }}>
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-border bg-surface p-8 shadow-[var(--shadow-card)]">
        <div className="flex flex-col items-center gap-2 pb-2 text-center">
          <LogoLoader size={56} state={busy || !mode ? 'loading' : error ? 'error' : 'idle'} />
          <h1 className="font-serif text-[22px] font-semibold">
            {step.kind === 'two-factor' ? '安全验证' : '登录 CC Shell'}
          </h1>
          <p className="text-[13px] text-text-3">
            {step.kind === 'two-factor'
              ? '请输入验证器应用中 CC Shell 的 6 位验证码'
              : mode && step.kind === 'web-login'
                ? '请在弹出的登录页完成人机验证与登录，完成后窗口将自动关闭'
                : '登录后将自动配置密钥，并显示余额与用量'}
          </p>
        </div>

        {error && (
          <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger">
            {error}
          </div>
        )}

        {!mode && <div aria-hidden className="h-[196px]" />}

        {mode && step.kind === 'password' && (
          <form className="anim-fade flex flex-col gap-4" onSubmit={submitPassword} noValidate>
            <Field
              label="账号"
              placeholder="用户名或邮箱"
              autoComplete="username"
              autoFocus
              spellCheck={false}
              maxLength={100}
              disabled={busy}
              value={form.account}
              onChange={(e) => setForm({ ...form, account: e.target.value })}
            />
            <Field
              label="密码"
              type="password"
              placeholder="密码"
              autoComplete="current-password"
              maxLength={128}
              disabled={busy}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <button type="submit" className="btn btn-primary mt-1 h-10" disabled={busy}>
              {busy ? '正在登录…' : '登录'}
            </button>
          </form>
        )}

        {step.kind === 'two-factor' && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              void submitCode(code)
            }}
          >
            <label className="flex flex-col gap-1.5 text-[13px] text-text-2">
              <span className="flex items-center gap-1.5">
                <ShieldCheck size={14} /> 验证码
              </span>
              <input
                ref={codeRef}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                disabled={busy}
                value={code}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, '').slice(0, 6)
                  setCode(v)
                  if (v.length === 6) void submitCode(v)
                }}
                className="h-12 rounded-md border border-border-strong bg-bg-raised text-center font-mono text-[22px] tracking-[0.5em] text-text outline-none focus:border-brand"
              />
            </label>
            <button type="submit" className="btn btn-primary h-10" disabled={busy || code.length < 6}>
              {busy ? '正在验证…' : '验证'}
            </button>
            <button type="button" className="btn btn-ghost h-9" disabled={busy} onClick={() => setStep({ kind: 'password' })}>
              返回
            </button>
          </form>
        )}

        {mode && step.kind === 'web-login' && (
          <div className="anim-fade flex flex-col gap-3">
            <button className="btn btn-primary h-10" disabled={busy} onClick={() => void webLogin()}>
              <Globe size={16} />
              {busy ? '等待网页登录完成…' : '打开网页登录'}
            </button>
            {!webOnly && (
              <button className="btn btn-ghost h-9" disabled={busy} onClick={() => setStep({ kind: 'password' })}>
                返回
              </button>
            )}
          </div>
        )}

        {mode && step.kind === 'password' && (
          <div className="anim-fade flex items-center justify-between text-xs text-text-3">
            <button className="hover:text-text" onClick={() => void webLogin()} disabled={busy}>
              网页登录
            </button>
            <button className="hover:text-text" onClick={() => void window.ccshell.account.openSite('/sign-up')}>
              注册账号
            </button>
          </div>
        )}

        <ServerSetting baseUrl={account.baseUrl} disabled={busy} />
      </div>
    </div>
  )
}

function ServerSetting({ baseUrl, disabled }: { baseUrl: string; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(baseUrl)
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => setValue(baseUrl), [baseUrl])

  const save = async () => {
    const r = await window.ccshell.account.setBaseUrl(value)
    setMsg(r.ok ? '已保存' : r.error)
  }

  return (
    <div className="border-t border-border pt-3 text-xs text-text-3">
      <button className="flex items-center gap-1 hover:text-text" onClick={() => setOpen(!open)}>
        服务器：<span className="font-mono">{baseUrl}</span>
        <ChevronDown size={12} className={open ? 'rotate-180' : ''} />
      </button>
      {open && (
        <div className="mt-2 flex gap-2">
          <input
            value={value}
            disabled={disabled}
            spellCheck={false}
            onChange={(e) => {
              setValue(e.target.value)
              setMsg(null)
            }}
            className="h-8 min-w-0 flex-1 rounded-sm border border-border-strong bg-bg-raised px-2 font-mono text-text outline-none focus:border-brand"
          />
          <button className="btn btn-secondary h-8 px-3 text-xs" disabled={disabled} onClick={() => void save()}>
            保存
          </button>
        </div>
      )}
      {open && msg && <p className="mt-1">{msg}</p>}
    </div>
  )
}

function Field({ label, ...input }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1.5 text-[13px] text-text-2">
      {label}
      <input
        {...input}
        className="h-10 rounded-md border border-border-strong bg-bg-raised px-3 text-[14px] text-text outline-none placeholder:text-text-3 focus:border-brand disabled:opacity-60"
      />
    </label>
  )
}
