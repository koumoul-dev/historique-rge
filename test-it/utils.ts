import type { AxiosInstance } from 'axios'
import type { LogFunctions } from '@data-fair/lib-common-types/processings.js'

export type FakeRoute = (query: URLSearchParams, body?: unknown) => unknown

/**
 * Minimal axios stand-in: routes are keyed by "GET /path" and receive the merged query.
 * A route may throw { response: { status, data } } to simulate an HTTP error.
 */
export const fakeAxios = (routes: Record<string, FakeRoute>, calls: string[] = []): AxiosInstance => {
  const handle = async (method: string, url: string, config?: { params?: Record<string, unknown> }, body?: unknown) => {
    const u = new URL(url, 'http://df/')
    for (const [k, v] of Object.entries(config?.params ?? {})) u.searchParams.set(k, String(v))
    calls.push(`${method} ${u.pathname}?${u.searchParams.toString()}`)
    const route = routes[`${method} ${u.pathname}`]
    if (!route) throw Object.assign(new Error(`no fake route for ${method} ${u.pathname}`), { response: { status: 404, data: 'not found' } })
    return { data: await route(u.searchParams, body) }
  }
  return {
    get: (url: string, config?: { params?: Record<string, unknown> }) => handle('GET', url, config),
    post: (url: string, body?: unknown, config?: { params?: Record<string, unknown> }) => handle('POST', url, config, body)
  } as unknown as AxiosInstance
}

export const noopLog: LogFunctions = {
  step: async () => {},
  error: async () => {},
  warning: async () => {},
  info: async () => {},
  debug: async () => {},
  task: async () => {},
  progress: async () => {}
}

/** A log that records warnings and errors, for assertions. */
export const recordingLog = () => {
  const messages: { level: string, msg: string }[] = []
  const log: LogFunctions = {
    ...noopLog,
    warning: async (msg) => { messages.push({ level: 'warning', msg }) },
    error: async (msg) => { messages.push({ level: 'error', msg }) },
    info: async (msg) => { messages.push({ level: 'info', msg }) }
  }
  return { log, messages }
}
