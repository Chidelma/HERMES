import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { signJwt } from '../../src/shared/auth.ts'

const HERMES_ROOT = join(import.meta.dir, '..', '..')
const TACH_SERVE  = join(HERMES_ROOT, 'node_modules', '.bin', 'tach.serve')
const JWT_SECRET  = 'test-secret'
const PORT_BASE   = 19000

let portCounter = 0

export interface TestServer {
  url: string
  testRoot: string
  stop: () => void
  get:    (path: string, opts?: { token?: string }) => Promise<Response>
  post:   (path: string, body: unknown, opts?: { token?: string; secret?: string }) => Promise<Response>
  put:    (path: string, body: unknown, opts?: { token?: string }) => Promise<Response>
  delete: (path: string, opts?: { token?: string; body?: unknown }) => Promise<Response>
  token:  (claims: { email: string; domains: string[]; role: 'admin' | 'viewer' }) => string
}

/**
 * Starts a Tachyon server for API integration tests.
 * Returns helpers and a stop() function to call in afterEach/afterAll.
 */
export async function startTestServer(): Promise<TestServer> {
  const port = PORT_BASE + (portCounter++ % 100)
  const testRoot = mkdtempSync(join(tmpdir(), 'hermes-api-test-'))

  const proc = Bun.spawn(
    ['bun', TACH_SERVE],
    {
      cwd: HERMES_ROOT,
      env: {
        ...process.env,
        PORT:      String(port),
        HOST:      '127.0.0.1',
        FYLO_ROOT: testRoot,
        JWT_SECRET,
        NODE_ENV:  'test',
        SMS_ADAPTER:  'console',
        SMTP_ADAPTER: 'console',
      },
      stdout: 'ignore',
      stderr: 'ignore',
    }
  )

  const url = `http://127.0.0.1:${port}`

  // Wait for server to become ready (max 10s)
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${url}/auth/mfa/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(500),
      })
      if (r.status !== 0) break  // any HTTP response means server is up
    } catch {
      await Bun.sleep(100)
    }
  }

  const stop = () => {
    proc.kill()
    rmSync(testRoot, { recursive: true, force: true })
  }

  const makeHeaders = (opts?: { token?: string; secret?: string }) => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (opts?.token) h['Authorization'] = `Bearer ${opts.token}`
    if (opts?.secret) h['X-Webhook-Secret'] = opts.secret
    return h
  }

  return {
    url,
    testRoot,
    stop,
    token: (claims) => signJwt(claims, JWT_SECRET),
    get:    (path, opts) => fetch(`${url}${path}`, { headers: makeHeaders(opts) }),
    post:   (path, body, opts) => fetch(`${url}${path}`, { method: 'POST', headers: makeHeaders(opts), body: JSON.stringify(body) }),
    put:    (path, body, opts) => fetch(`${url}${path}`, { method: 'PUT',  headers: makeHeaders(opts), body: JSON.stringify(body) }),
    delete: (path, opts) => fetch(`${url}${path}`, {
      method: 'DELETE',
      headers: makeHeaders(opts),
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
    }),
  }
}
