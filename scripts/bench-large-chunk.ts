/**
 * What the pool saves in absolute time on a chunk big enough to notice.
 *
 * The speedup ratio plateaus by a couple of MB of chunk (see
 * `scripts/bench-chunk-size.ts`), so past that the question is not "how many x"
 * but "how many seconds". The fixtures top out at 23MB uncompressed, which is a
 * ~60ms query; these chunks are built by repeating a fixture's block range,
 * which is valid BGZF because the format is concatenated gzip members.
 *
 *   pnpm build:esm && pnpm bench:largechunk
 */
import path from 'node:path'

import { launch } from 'puppeteer'

import { startServer } from '../test/browser/serve.ts'

const WORKERS = 4
const ROUNDS = 7
const TARGETS = [50e6, 150e6, 400e6]

const FILES = [
  {
    name: 'chr22_nanopore_subset.bam',
    path: '/test/data/chr22_nanopore_subset.bam',
  },
  { name: 'ultra-long-ont.bam', path: '/test/data/ultra-long-ont.bam' },
  { name: 'shortreads_300x.bam', path: '/test/data/shortreads_300x.bam' },
]

interface Row {
  name: string
  copies: number
  blocks: number
  compressed: number
  uncompressed: number
  identical: boolean
  samples: Record<string, number[]>
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(0)}MB`
const secs = (ms: number) => `${(ms / 1000).toFixed(2)}s`
const min = (xs: number[]) => Math.min(...xs)

const rootDir = path.resolve(import.meta.dirname, '..')
const { server, port } = await startServer(rootDir)
const browser = await launch({
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--js-flags=--max-old-space-size=8192',
  ],
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
      globalThis.runLargeChunks(config),
    { workers: WORKERS, rounds: ROUNDS, targets: TARGETS, files: FILES },
  )) as { workers: number; results: Row[] }

  const bad = out.results.filter(r => !r.identical)
  if (bad.length) {
    throw new Error(
      `output differs from sequential: ${bad.map(r => `${r.name}/${mb(r.uncompressed)}`).join(', ')}`,
    )
  }

  console.log(`workers=${out.workers} rounds=${ROUNDS}\n`)
  console.log(
    '| fixture | copies | blocks | compressed | uncompressed | seq | 4w | speedup | saved |',
  )
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const r of out.results) {
    const seq = min(r.samples.seq!)
    const pooled = min(r.samples.pool!)
    console.log(
      `| ${r.name} | ${r.copies} | ${r.blocks} | ${mb(r.compressed)} | ${mb(r.uncompressed)} | ${secs(seq)} | ${secs(pooled)} | ${(seq / pooled).toFixed(2)}x | ${secs(seq - pooled)} |`,
    )
  }
} finally {
  await browser.close()
  server.close()
}
