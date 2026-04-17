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
 * Patches dist/index.html to load /assets/config.js in the outer <head>.
 * Tachyon injects the layout HTML (which contains the <script> tag) via
 * innerHTML at runtime, but browsers don't execute scripts set via innerHTML.
 * Adding it to the static outer head ensures window.HERMES_CONFIG is set
 * before any deferred scripts (main.js, spa-renderer.js) run.
 */
async function patchIndexHtml() {
  const indexPath = new URL('../dist/index.html', import.meta.url).pathname
  let html = await readFile(indexPath, 'utf8')
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

  await writeFile(indexPath, html)
}

/**
 * Appends a global window.__ty_rerender() helper to dist/spa-renderer.js.
 * Tachyon's ty_invokeEvent fires async handlers without awaiting, so async
 * state changes never trigger a re-render on their own. Components call
 * window.__ty_rerender?.() at the end of each async handler to patch the DOM.
 */
async function patchSpaRenderer() {
  const rendererPath = new URL('../dist/spa-renderer.js', import.meta.url).pathname
  const code = await readFile(rendererPath, 'utf8')
  // Only patch once — idempotent check
  if (code.includes('__ty_rerender')) return
  // S = patchSlot, U = patchBody, A = layoutRender, C = pageRender (minified names)
  const patch = '\nwindow.__ty_rerender=async()=>{try{if(typeof C==="function")typeof A==="function"&&A?S(await C()):U(await C())}catch(_e){}};'
  await writeFile(rendererPath, code + patch)
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
  await patchIndexHtml()
  await patchSpaRenderer()
  await copyServiceWorker()
}
