/**
 * Starts the Tachyon API server for Playwright E2E tests.
 * Creates an isolated temp FYLO_ROOT.
 *
 * Architecture:
 *   - Tachyon binds to port 9877 (internal, no CORS needed)
 *   - Bun CORS proxy listens on port 9876 (what tests/browser hit)
 *     → handles OPTIONS preflights with 204 + CORS headers
 *     → proxies all other requests to 9877, adding CORS headers to responses
 *
 * Run via: bun scripts/e2e-api.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = resolve(__dirname, '..')
const fyloRoot = mkdtempSync(join(tmpdir(), 'hermes-e2e-'))
const tachUrl = 'http://127.0.0.1:9877'
const proxyUrl = 'http://127.0.0.1:9876'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
}

const tach = spawn(join(projectRoot, 'node_modules', '.bin', 'tach.serve'), [], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    FYLO_ROOT:    fyloRoot,
    JWT_SECRET:   'hermes-e2e-test-secret',
    NODE_ENV:     'test',
    SMS_ADAPTER:  'console',
    SMTP_ADAPTER: 'console',
    PORT:         '9877',
    HOST:         '127.0.0.1',
  },
})

let shuttingDown = false

function cleanup(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  tach.kill('SIGTERM')
  rmSync(fyloRoot, { recursive: true, force: true })
  process.exit(code)
}

tach.on('exit', code => cleanup(code ?? 0))

async function waitForTachyon() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${tachUrl}/auth/mfa/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(500),
      })
      if (response.status > 0) return
    } catch {
      await Bun.sleep(100)
    }
  }

  throw new Error(`Tachyon did not become ready at ${tachUrl}`)
}

await waitForTachyon()

const proxy = Bun.serve({
  port: 9876,
  hostname: '127.0.0.1',
  async fetch(req) {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    const url = new URL(req.url)
    const upstream = `http://127.0.0.1:9877${url.pathname}${url.search}`

    const proxyReq = new Request(upstream, {
      method: req.method,
      headers: req.headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
    })

    const res = await fetch(proxyReq)

    const resHeaders = new Headers(res.headers)
    for (const [k, v] of Object.entries(CORS_HEADERS)) {
      resHeaders.set(k, v)
    }

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: resHeaders,
    })
  },
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    proxy.stop()
    cleanup(0)
  })
}

console.log(`[e2e-api] CORS proxy listening on ${proxyUrl} -> Tachyon on :9877`)
