import { build } from 'esbuild'

const lambdas = ['inbound', 'events', 'send', 'api', 'auth']

// Polyfills for APIs used by @delma/fylo that are Bun-specific or browser-specific
const navigatorPolyfill = [
  // navigator.hardwareConcurrency (browser API, not in Node 20)
  'if(typeof navigator==="undefined"){global.navigator={hardwareConcurrency:require("os").cpus().length};}',
  // Bun global shim: only the APIs fylo actually calls
  'if(typeof Bun==="undefined"){',
  '  const{randomUUID}=require("crypto");',
  '  global.Bun={',
  '    randomUUIDv7:()=>randomUUID(),',
  '    sleep:(ms)=>new Promise(r=>setTimeout(r,ms)),',
  '    JSONL:{',
  '      parseChunk(buf){',
  '        const text=typeof buf==="string"?buf:Buffer.from(buf).toString("utf-8");',
  '        const values=text.split("\\n").filter(l=>l.trim()).map(l=>{try{return JSON.parse(l);}catch{return undefined;}}).filter(v=>v!==undefined);',
  '        return{values,read:buf.length};',
  '      }',
  '    }',
  '  };',
  '}',
].join('')

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
      banner: { js: navigatorPolyfill },
    })
  )
)

console.log('Lambda build complete')
