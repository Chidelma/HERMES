import { build } from 'esbuild'

const lambdas = ['inbound', 'events', 'send', 'api', 'auth']

await Promise.all(
  lambdas.map(name =>
    build({
      entryPoints: [`src/${name}/index.ts`],
      bundle: true,
      platform: 'node',
      target: 'node20',
      outfile: `bin/${name}/index.js`,
      sourcemap: true,
      external: [],
    })
  )
)

console.log('Lambda build complete')
