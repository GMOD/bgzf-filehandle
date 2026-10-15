/**
 * Whether a consumer that walks chunk segments beats one that walks the joined
 * buffer, measured as the consumer's whole call: inflate, then the bam-js record
 * walk or the tabix line scan.
 *
 *   pnpm bench:segments
 */
import path from 'node:path'

import { launch } from 'puppeteer'

import { startServer } from '../test/browser/serve.ts'

const WORKERS = 4
const ROUNDS = Number(process.env.ROUNDS ?? 15)
const BLOCK_COUNTS = [8, 16, 32, 64, 128, 256, 512]

const FILES = [
  {
    name: 'shortreads_300x.bam',
    path: '/test/data/shortreads_300x.bam',
    kind: 'bam',
  },
  {
    name: 'ultra-long-ont.bam',
    path: '/test/data/ultra-long-ont.bam',
    kind: 'bam',
  },
  {
    name: 'chr22_nanopore_subset.bam',
    path: '/test/data/chr22_nanopore_subset.bam',
    kind: 'bam',
  },
  {
    name: 'out.sorted.gff.gz',
    path: '/test/data/out.sorted.gff.gz',
    kind: 'lines',
  },
]

interface Row {
  blocks: number
  uncompressed: number
  segments: number
  identical: boolean
  expected: string
  samples: Record<'seq' | 'joined' | 'segments', number[]>
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`
const fmt = (n: number) => (n < 10 ? n.toFixed(2) : n.toFixed(1))
const min = (xs: number[]) => Math.min(...xs)
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!

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
  await page.goto(`http://127.0.0.1:${port}/test/browser/segments.html`, {
    waitUntil: 'networkidle0',
  })
  const out = (await page.evaluate(
    async config =>
      // @ts-expect-error defined in the page's global scope
      globalThis.runSegments(config),
    {
      workers: WORKERS,
      rounds: ROUNDS,
      blockCounts: BLOCK_COUNTS,
      files: FILES,
    },
  )) as {
    workers: number
    hardwareConcurrency: number
    results: { name: string; kind: string; rows: Row[] }[]
  }

  const bad = out.results.flatMap(r =>
    r.rows.filter(row => !row.identical).map(row => `${r.name} @${row.blocks}`),
  )
  if (bad.length) {
    throw new Error(`segments disagree with the joined walk: ${bad.join(', ')}`)
  }

  console.log(
    `workers=${out.workers} hardwareConcurrency=${out.hardwareConcurrency} rounds=${ROUNDS}, min (median) ms\n`,
  )
  for (const r of out.results) {
    console.log(
      `### ${r.name} (${r.kind === 'bam' ? 'record walk' : 'line scan'})\n`,
    )
    console.log(
      '| blocks | uncompressed | segs | seq | 4w joined | 4w segments | joined vs seq | segments vs seq | segments vs joined |',
    )
    console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
    for (const row of r.rows) {
      const [s, j, g] = (['seq', 'joined', 'segments'] as const).map(k =>
        min(row.samples[k]),
      ) as [number, number, number]
      const [sm, jm, gm] = (['seq', 'joined', 'segments'] as const).map(k =>
        median(row.samples[k]),
      ) as [number, number, number]
      console.log(
        `| ${row.blocks} | ${mb(row.uncompressed)} | ${row.segments} | ${fmt(s)} (${fmt(sm)}) | ${fmt(j)} (${fmt(jm)}) | ${fmt(g)} (${fmt(gm)}) | ${(s / j).toFixed(2)}x | ${(s / g).toFixed(2)}x | ${(j / g).toFixed(2)}x (${(jm / gm).toFixed(2)}x) |`,
      )
    }
    console.log()
  }
} finally {
  await browser.close()
  server.close()
}
