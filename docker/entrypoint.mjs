const command = process.argv[2] ?? 'serve'
const args = process.argv.slice(3)

const commands = new Map([
  ['serve', ['node_modules/.bin/tach.serve']],
  ['admin:create', ['scripts/create-admin.mjs']],
])

if (command === 'help' || command === '--help' || command === '-h') {
  console.log([
    'Hermes container commands:',
    '  serve         Start the Hermes API and frontend server',
    '  admin:create  Create the first admin for a domain',
    '',
    'Examples:',
    '  docker run chidelma/hermes:latest',
    '  docker run -v hermes-data:/data chidelma/hermes:latest admin:create --email=admin@example.com --phone=+14165550100 --domain=example.com',
  ].join('\n'))
  process.exit(0)
}

const target = commands.get(command)

if (!target) {
  console.error(`Unsupported Hermes container command: ${command}`)
  console.error('Allowed commands: serve, admin:create')
  process.exit(64)
}

const child = Bun.spawn(
  ['/usr/local/bin/bun', ...target, ...args],
  {
    cwd: '/app',
    env: process.env,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }
)

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}

process.exit(await child.exited)
