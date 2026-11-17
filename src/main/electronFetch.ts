import { net } from 'electron'

export const electronFetch = ((input: string | URL | Request, init?: RequestInit) =>
  input instanceof Request ? net.fetch(input, init) : net.fetch(input.toString(), init)) as typeof fetch
