export interface HandlerPayload {
  headers?: Record<string, string>
  paths?: Record<string, string>
  body?: unknown
  query?: Record<string, unknown>
  context: {
    requestId: string
    ipAddress: string
    bearer?: { token: string; verified: false }
  }
}

/**
 * Wraps the stdin→stdout Tachyon handler protocol.
 * Reads the JSON payload from stdin, calls `fn`, writes the result to stdout.
 * Unhandled errors are written to stderr (→ 500).
 */
export function handle(fn: (p: HandlerPayload) => Promise<unknown>): void {
  const chunks: Uint8Array[] = []
  process.stdin.on('data', (c: Uint8Array) => chunks.push(c))
  process.stdin.on('end', async () => {
    try {
      const payload: HandlerPayload = JSON.parse(Buffer.concat(chunks).toString())
      const result = await fn(payload)
      process.stdout.write(JSON.stringify(result))
    } catch (err) {
      process.stderr.write(JSON.stringify({ error: String(err) }))
    }
  })
}
