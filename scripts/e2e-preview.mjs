/**
 * Starts the Tachyon preview server for Playwright E2E tests.
 * Explicitly sets CWD to the project root so tach.preview finds the
 * bundled dist/ directory created by scripts/bundle.mjs.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'

const projectRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const tachPreview = join(projectRoot, 'node_modules', '.bin', 'tach.preview')

const proc = spawn(tachPreview, [], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: { ...process.env },
})

proc.on('exit', code => process.exit(code ?? 0))
