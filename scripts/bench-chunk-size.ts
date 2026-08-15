/**
 * Where the worker pool starts paying, as a function of chunk size.
 *
 * `scripts/bench-worker-pool.ts` sweeps worker count over a whole-file chunk.
 * This one holds the worker count at the default 4 and sweeps the chunk instead,
 * which is the axis a consumer actually moves: an indexed query resolves to a
 * run of blocks, and how long that run is depends on the region and the depth.
 *
 *   pnpm build:esm && pnpm bench:chunksize
 */
import path from 'node:path'

import { launch } from 'puppeteer'

import { startServer } from '../test/browser/serve.ts'

const WORKERS = 4
const ROUNDS = 15
// 1 is a control: unzipChunkSlice declines the pool for a single-block chunk,
// so that row must come out at 1.00x whatever else is going on.
const BLOCK_COUNTS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024]

const FILES = [
  { name: 'paired.bam', path: '/test/data/paired.bam' },
  { name: 'T_ko.2bit.gz', path: '/test/data/T_ko.2bit.gz' },
  { name: 'shortreads_300x.bam', path: '/test/data/shortreads_300x.bam' },
  { name: 'out.sorted.gff.gz', path: '/test/data/out.sorted.gff.gz' },
  { name: 'ultra-long-ont.bam', path: '/test/data/ultra-long-ont.bam' },
  {
    name: 'chr22_nanopore_subset.bam',
    path: '/test/data/chr22_nanopore_subset.bam',
  },
]

interface Row {
  blocks: number
  compressed: number
  uncompressed: number
  reps: number
  identical: boolean
  samples: Record<string, number[]>
}

const kb = (n: number) => `${(n / 1024).toFixed(0)}KB`
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`
const fmt = (n: number) => (n < 10 ? n.toFixed(2) : n.toFixed(0))
const min = (xs: number[]) => Math.min(...xs)

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
      globalThis.runChunkSizes(config),
    {
      workers: WORKERS,
      rounds: ROUNDS,
      blockCounts: BLOCK_COUNTS,
      files: FILES,
    },
  )) as {
    workers: number
    hardwareConcurrency: number
    results: { name: string; rows: Row[] }[]
  }

  const bad = out.results.flatMap(r =>
    r.rows.filter(row => !row.identical).map(row => `${r.name} @${row.blocks}`),
  )
  if (bad.length) {
    throw new Error(`output differs from sequential: ${bad.join(', ')}`)
  }

  console.log(
    `workers=${out.workers} hardwareConcurrency=${out.hardwareConcurrency} rounds=${ROUNDS}\n`,
  )

  for (const r of out.results) {
    console.log(`### ${r.name}\n`)
    console.log(
      '| blocks | compressed | uncompressed | seq ms | 4w ms | speedup |',
    )
    console.log('| --- | --- | --- | --- | --- | --- |')
    for (const row of r.rows) {
      const seq = min(row.samples.seq!)
      const pooled = min(row.samples.pool!)
      console.log(
        `| ${row.blocks} | ${kb(row.compressed)} | ${mb(row.uncompressed)} | ${fmt(seq)} | ${fmt(pooled)} | ${(seq / pooled).toFixed(2)}x |`,
      )
    }
    console.log()
  }
} finally {
  await browser.close()
  server.close()
}
