import type { Session } from 'electron'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 0,
    readonly code = ''
  ) {
    super(message)
  }
}

const MESSAGES: Record<string, string> = {
  Unauthorized: '登录已失效，请重新登录',
  Forbidden: '当前账号无操作权限',
  'Username or password is incorrect, or user has been banned': '账号或密码错误，或账号已被停用',
  'Verification failed.': '验证失败，请检查后重试',
  'Verification flow expired': '验证已过期，请重新开始'
}

function toMessage(raw: unknown, status: number): string {
  const text = typeof raw === 'string' ? raw : ''
  return MESSAGES[text] || text || (status === 429 ? '操作过于频繁，请稍后重试' : `请求失败（HTTP ${status}）`)
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  headers?: Record<string, string>
  accessToken?: string
  raw?: boolean
}

export async function apiRequest<T>(ses: Session, baseUrl: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const started = Date.now()
  const trace = (status: number | string) =>
    console.log(`[ccshell] ${opts.method ?? 'GET'} ${path.split('?')[0]} → ${status} (${Date.now() - started}ms)`)
  let response: Response
  try {
    response = await ses.fetch(baseUrl + path, {
      method: opts.method ?? 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'zh-CN',
        Origin: new URL(baseUrl).origin,
        ...(opts.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(opts.accessToken ? { Authorization: `Bearer ${opts.accessToken}` } : {}),
        ...opts.headers
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
    })
  } catch {
    trace('network error')
    throw new ApiError('网络连接失败，请检查网络或服务器地址', 0, 'network')
  }
  trace(response.status)

  let payload: { success?: boolean; data?: unknown; message?: unknown; code?: unknown }
  try {
    payload = (await response.json()) ?? {}
  } catch {
    throw new ApiError(toMessage('', response.status), response.status)
  }
  if (!response.ok || payload.success === false) {
    throw new ApiError(
      toMessage(payload.message, response.status),
      response.status,
      typeof payload.code === 'string' ? payload.code : ''
    )
  }
  return (opts.raw ? payload : payload.data) as T
}
