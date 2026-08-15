/**
 * What the worker pool is worth, swept over worker count.
 *
 * Needs a browser: `getSharedWorkerPool` wants a global `Worker` plus Blob
 * URLs, which node has not got, so every vitest bench in `benchmarks/` is blind
 * to the pool and reports parity forever.
 *
 *   pnpm build:esm && pnpm bench:pool
 *
 * Two arms per worker count. `Nw` is the whole of `unzipChunkSlice`, which is
 * what a caller sees. `Nwi` is the inflate alone, leaving out the serial
 * reassembly that follows it — measuring *that* against the sequential whole is
 * the apples-to-oranges comparison that this benchmark exists to keep honest.
 */
import path from 'node:path'

import { launch } from 'puppeteer'

import { startServer } from '../test/browser/serve.ts'

const WORKER_COUNTS = [1, 2, 4, 8]
const ROUNDS = 9

const FILES = [
  { name: 'paired.bam', path: '/test/data/paired.bam', reps: 20 },
  { name: 'T_ko.2bit.gz', path: '/test/data/T_ko.2bit.gz', reps: 10 },
  {
    name: 'shortreads_300x.bam',
    path: '/test/data/shortreads_300x.bam',
    reps: 3,
  },
  { name: 'out.sorted.gff.gz', path: '/test/data/out.sorted.gff.gz', reps: 3 },
  {
    name: 'ultra-long-ont.bam',
    path: '/test/data/ultra-long-ont.bam',
    reps: 3,
  },
  {
    name: 'chr22_nanopore_subset.bam',
    path: '/test/data/chr22_nanopore_subset.bam',
    reps: 2,
  },
]

interface FileResult {
  name: string
  bytes: number
  decompressedBytes: number
  blocks: number
  identical: Record<string, boolean>
  samples: Record<string, number[]>
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`
const fmt = (n: number) => (Math.abs(n) < 10 ? n.toFixed(2) : n.toFixed(0))
const min = (xs: number[]) => Math.min(...xs)
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

function table(header: string[], rows: string[][]) {
  console.log(`| ${header.join(' | ')} |`)
  console.log(`| ${header.map(() => '---').join(' | ')} |`)
  for (const row of rows) {
    console.log(`| ${row.join(' | ')} |`)
  }
}

const rootDir = path.resolve(import.meta.dirname, '..')
const { server, port } = await startServer(rootDir)
const browser = await launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})

try {
  const page = await browser.newPage()
  page.on('pageerror', err => {
    console.error(`[browser error]: ${String(err)}`)
  })
  await page.goto(`http://127.0.0.1:${port}/test/browser/scaling.html`, {
    waitUntil: 'networkidle0',
  })

  const out = (await page.evaluate(
    async config =>
      // @ts-expect-error defined in the page's global scope
      globalThis.runScaling(config),
    { workerCounts: WORKER_COUNTS, rounds: ROUNDS, files: FILES },
  )) as {
    crossOriginIsolated: boolean
    hardwareConcurrency: number
    results: FileResult[]
  }

  const mismatched = out.results.flatMap(r =>
    Object.entries(r.identical)
      .filter(([, ok]) => !ok)
      .map(([arm]) => `${r.name} arm ${arm}`),
  )
  if (mismatched.length) {
    throw new Error(`output differs from sequential: ${mismatched.join(', ')}`)
  }

  console.log(
    `hardwareConcurrency=${out.hardwareConcurrency} crossOriginIsolated=${out.crossOriginIsolated} rounds=${ROUNDS}\n`,
  )

  const head = [
    'fixture',
    'blocks',
    'sequential',
    ...WORKER_COUNTS.map(n => `${n}w`),
  ]
  const speedupRows = (suffix: string) =>
    out.results.map(r => {
      const seq = min(r.samples.seq!)
      return [
        `${r.name} (${mb(r.bytes)})`,
        String(r.blocks),
        fmt(seq),
        ...WORKER_COUNTS.map(n => {
          const t = min(r.samples[`${n}${suffix}`]!)
          return `${fmt(t)} (${(seq / t).toFixed(2)}x)`
        }),
      ]
    })

  console.log('unzipChunkSlice end to end, min ms per call\n')
  table(head, speedupRows(''))

  console.log('\ninflate alone, reassembly excluded — what the pool reaches\n')
  table(head, speedupRows('i'))

  // Means, not mins: subtracting one arm's min from another's biases the
  // difference low, which on the small fixtures came out negative.
  console.log('\nserial reassembly left on the caller thread, mean ms\n')
  table(
    ['fixture', 'uncompressed', ...WORKER_COUNTS.map(n => `${n}w`)],
    out.results.map(r => [
      r.name,
      mb(r.decompressedBytes),
      ...WORKER_COUNTS.map(n =>
        fmt(mean(r.samples[String(n)]!) - mean(r.samples[`${n}i`]!)),
      ),
    ]),
  )

  console.log('\nrelative spread of each arm, (max-min)/min\n')
  table(
    ['fixture', 'seq', ...WORKER_COUNTS.map(n => `${n}w`)],
    out.results.map(r => [
      r.name,
      ...['seq', ...WORKER_COUNTS.map(String)].map(k => {
        const s = r.samples[k]!
        return `${(((Math.max(...s) - min(s)) / min(s)) * 100).toFixed(0)}%`
      }),
    ]),
  )
} finally {
  await browser.close()
  server.close()
}
