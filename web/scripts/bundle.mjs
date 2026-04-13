import { mkdir, writeFile, access } from 'node:fs/promises'
import { spawn } from 'node:child_process'

const assetsRoot = new URL('../assets/', import.meta.url).pathname
const args = process.argv.slice(2)
const isWatch = args.includes('--watch')

function run(cmd, cmdArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, { stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)))
  })
}

function start(cmd, cmdArgs) {
  return spawn(cmd, cmdArgs, { stdio: 'inherit' })
}

async function buildTailwind() {
  await mkdir(assetsRoot, { recursive: true })
  await run('bunx', ['@tailwindcss/cli', '-i', './src/styles.css', '-o', './assets/styles.css', '--minify'])
}

async function ensureConfigJs() {
  const configPath = new URL('../assets/config.js', import.meta.url).pathname
  try { await access(configPath) } catch {
    const apiUrl = process.env.HERMES_API_URL || ''
    await writeFile(configPath, `window.HERMES_CONFIG={apiUrl:"${apiUrl}"};\n`)
  }
}

function startTailwindWatch() {
  return start('bunx', ['@tailwindcss/cli', '-i', './src/styles.css', '-o', './assets/styles.css', '--watch'])
}

if (isWatch) {
  await ensureConfigJs()
  await buildTailwind()
  const tach = start('bunx', ['tach.bundle', '--watch'])
  const tw = startTailwindWatch()

  const shutdown = sig => { tach.kill(sig); tw.kill(sig) }
  process.on('SIGINT', () => { shutdown('SIGINT'); process.exit(0) })
  process.on('SIGTERM', () => { shutdown('SIGTERM'); process.exit(0) })

  tach.on('exit', code => { tw.kill('SIGTERM'); process.exit(code ?? 0) })
} else {
  await ensureConfigJs()
  await buildTailwind()
  await run('bunx', ['tach.bundle'])
}
