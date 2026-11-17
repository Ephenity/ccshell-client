export const UPDATE_REPO = { owner: 'Ephenity', repo: 'ccshell-client' }

export type UpdateStatus =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'none'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error'

export interface UpdateState {
  status: UpdateStatus
  current: string
  latest?: string
  notes?: string
  releaseDate?: string
  percent?: number
  size?: number
  error?: string
  checkedAt?: number
  remind: boolean
  releaseUrl?: string
  reason?: string
  busy?: UpdateBusy
}

export interface UpdateBusy {
  sessions: number
  chats: number
}
