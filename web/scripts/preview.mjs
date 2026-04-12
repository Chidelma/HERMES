import { spawn } from 'node:child_process'

const procs = []

function start(cmd, args) {
  const child = spawn(cmd, args, { stdio: 'inherit', env: process.env })
  procs.push(child)
  child.on('exit', code => { if (code && code !== 0) { shutdown(); process.exit(code) } })
  return child
}

function shutdown(sig = 'SIGTERM') {
  for (const p of procs) if (!p.killed) p.kill(sig)
}

process.on('SIGINT', () => { shutdown('SIGINT'); process.exit(0) })
process.on('SIGTERM', () => { shutdown('SIGTERM'); process.exit(0) })

start('bun', ['./scripts/bundle.mjs', '--watch'])
start('bunx', ['tach.preview'])
