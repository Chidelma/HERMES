import { mkdir, writeFile, readFile, access, copyFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'

const projectRoot = new URL('../', import.meta.url).pathname
const assetsRoot = new URL('../assets/', import.meta.url).pathname
const args = process.argv.slice(2)
const isWatch = args.includes('--watch')
const bin = name => new URL(`../node_modules/.bin/${name}`, import.meta.url).pathname

function run(cmd, cmdArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, { cwd: projectRoot, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)))
  })
}

function start(cmd, cmdArgs) {
  return spawn(cmd, cmdArgs, { cwd: projectRoot, stdio: 'inherit' })
}

async function buildTailwind() {
  await mkdir(assetsRoot, { recursive: true })
  await run(bin('tailwindcss'), ['-i', './src/styles.css', '-o', './assets/styles.css', '--minify'])
}

/**
 * Patches every prerendered HTML shell with app head metadata and config.
 * Tachyon emits one HTML file per page route, so CDN/static deployments need
 * the same PWA and config tags in each generated shell.
 */
async function patchHtmlShells() {
  const distRoot = new URL('../dist/', import.meta.url).pathname
  const htmlFiles = Array.from(new Bun.Glob('**/*.html').scanSync({ cwd: distRoot }))

  for (const file of htmlFiles) {
    const htmlPath = new URL(`../dist/${file}`, import.meta.url).pathname
    let html = await readFile(htmlPath, 'utf8')
    const headEnd = html.indexOf('</head>')
    const outerHead = headEnd >= 0 ? html.slice(0, headEnd) : html

    if (!outerHead.includes('/assets/manifest.webmanifest')) {
      const pwaHead = [
        '    <meta name="theme-color" content="#0d0d0d">',
        '    <meta name="color-scheme" content="dark">',
        '    <meta name="mobile-web-app-capable" content="yes">',
        '    <meta name="apple-mobile-web-app-capable" content="yes">',
        '    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
        '    <meta name="apple-mobile-web-app-title" content="HERMES">',
        '    <link rel="manifest" href="/assets/manifest.webmanifest">',
        '    <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">',
        '    <link rel="apple-touch-icon" href="/assets/icon-192.png">',
        '    <link rel="stylesheet" href="/assets/styles.css">',
      ].join('\n')
      html = html.replace('</head>', `${pwaHead}\n</head>`)
    }

    html = html.replace(
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">',
    )
    html = html.replace('<title>Tachyon</title>', '<title>HERMES</title>')

    if (!outerHead.includes('/assets/config.js')) {
      html = html.replace(
        '<script src="/main.js" defer></script>',
        '<script src="/assets/config.js"></script>\n    <script src="/main.js" defer></script>',
      )
    }

    await writeFile(htmlPath, html)
  }
}


async function copyServiceWorker() {
  const sourcePath = new URL('../assets/sw.js', import.meta.url).pathname
  const outputPath = new URL('../dist/sw.js', import.meta.url).pathname
  await copyFile(sourcePath, outputPath)
}

async function ensureConfigJs() {
  const configPath = new URL('../assets/config.js', import.meta.url).pathname
  try { await access(configPath) } catch {
    const apiUrl = process.env.HERMES_API_URL || ''
    await writeFile(configPath, `window.HERMES_CONFIG={apiUrl:"${apiUrl}"};\n`)
  }
}

function startTailwindWatch() {
  return start(bin('tailwindcss'), ['-i', './src/styles.css', '-o', './assets/styles.css', '--watch'])
}

if (isWatch) {
  await ensureConfigJs()
  await buildTailwind()
  const tach = start(bin('tach.bundle'), ['--watch'])
  const tw = startTailwindWatch()

  const shutdown = sig => { tach.kill(sig); tw.kill(sig) }
  process.on('SIGINT', () => { shutdown('SIGINT'); process.exit(0) })
  process.on('SIGTERM', () => { shutdown('SIGTERM'); process.exit(0) })

  tach.on('exit', code => { tw.kill('SIGTERM'); process.exit(code ?? 0) })
} else {
  await ensureConfigJs()
  await buildTailwind()
  await run(bin('tach.bundle'), [])
  await patchHtmlShells()
  await copyServiceWorker()
}
