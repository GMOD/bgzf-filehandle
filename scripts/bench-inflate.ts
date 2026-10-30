/**
 * The shipped wasm inflate against the three alternatives it could have been,
 * over the real blocks of the test fixtures:
 *
 * - `unzip`, the shipped path: the whole BGZF buffer to wasm `decompressAll`.
 * - pako per block: a pure-JS BGZF reader, and what this package shipped
 *   through v6.0.0.
 * - node zlib per block: the native floor. It does not exist in a browser.
 * - `DecompressionStream` per block. Node 24.22 rejects a multi-member gzip
 *   stream with ERR_TRAILING_JUNK_AFTER_STREAM_END, as browsers do, so the
 *   whole buffer cannot go through one call.
 *
 * The parent asserts all four byte-identical, then runs each arm in its own
 * process so one arm's JIT and GC state cannot leak into the next.
 *
 *   pnpm bench:inflate          # every arm
 *   pnpm bench:inflate pako     # one arm
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'

import { inflateRaw } from 'pako-esm2'

import { unzip } from '../src/unzip.ts'

const BGZF_HEADER_SIZE = 18
const BGZF_TRAILER_SIZE = 8
const WARMUP = 5

interface Fixture {
  label: string
  data: Uint8Array
  /** [payloadStart, payloadEnd) of each block's raw deflate bytes */
  blocks: [number, number][]
  iterations: number
}

/** BSIZE-1 sits in the BC extra subfield at offset 16 of each block header. */
function blockPayloads(data: Uint8Array) {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const blocks: [number, number][] = []
  let p = 0
  while (p + BGZF_HEADER_SIZE + BGZF_TRAILER_SIZE <= data.length) {
    const size = dv.getUint16(p + 16, true) + 1
    blocks.push([p + BGZF_HEADER_SIZE, p + size - BGZF_TRAILER_SIZE])
    p += size
  }
  return blocks
}

function join(parts: Uint8Array[]) {
  const total = parts.reduce((a, b) => a + b.length, 0)
  const joined = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    joined.set(part, offset)
    offset += part.length
  }
  return joined
}

function perBlock(
  inflate: (b: Uint8Array) => Uint8Array,
  { data, blocks }: Fixture,
) {
  return join(blocks.map(([start, end]) => inflate(data.subarray(start, end))))
}

async function decompressionStream({ data, blocks }: Fixture) {
  const parts: Uint8Array[] = []
  for (const [start, end] of blocks) {
    const stream = new Blob([
      data.subarray(start, end) as Uint8Array<ArrayBuffer>,
    ])
      .stream()
      .pipeThrough(new DecompressionStream('deflate-raw'))
    parts.push(new Uint8Array(await new Response(stream).arrayBuffer()))
  }
  return join(parts)
}

const arms: Record<string, (f: Fixture) => Promise<Uint8Array>> = {
  'wasm libdeflate (unzip)': f => unzip(f.data),
  'pako per block': f =>
    Promise.resolve(perBlock(b => inflateRaw(b, undefined), f)),
  'node zlib per block': f =>
    Promise.resolve(perBlock(b => inflateRawSync(b), f)),
  'DecompressionStream per block': decompressionStream,
}

const fixtures: Fixture[] = [
  { path: 'test/data/paired.bam', label: 'paired.bam (84KB)', iterations: 500 },
  {
    path: 'test/data/T_ko.2bit.gz',
    label: 'T_ko.2bit.gz (518KB)',
    iterations: 200,
  },
  {
    path: 'test/data/shortreads_300x.bam',
    label: 'shortreads_300x.bam (5.1MB)',
    iterations: 20,
  },
  {
    path: 'test/data/chr22_nanopore_subset.bam',
    label: 'chr22_nanopore_subset.bam (14.1MB)',
    iterations: 10,
  },
].map(({ path, label, iterations }) => {
  const data = new Uint8Array(readFileSync(path))
  return { label, data, blocks: blockPayloads(data), iterations }
})

function assertSame(a: Uint8Array, b: Uint8Array, what: string) {
  if (a.length !== b.length) {
    throw new Error(`${what}: length ${b.length} != wasm's ${a.length}`)
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      throw new Error(`${what}: byte ${i} differs`)
    }
  }
}

interface Timing {
  mean: number
  min: number
}

async function time(run: (f: Fixture) => Promise<Uint8Array>) {
  const result: Record<string, Timing> = {}
  for (const fixture of fixtures) {
    for (let i = 0; i < WARMUP; i++) {
      await run(fixture)
    }
    const samples: number[] = []
    for (let i = 0; i < fixture.iterations; i++) {
      const start = performance.now()
      await run(fixture)
      samples.push(performance.now() - start)
    }
    result[fixture.label] = {
      mean: samples.reduce((a, b) => a + b, 0) / samples.length,
      min: Math.min(...samples),
    }
  }
  return result
}

const fmt = (n: number) => (n < 10 ? n.toFixed(2) : n.toFixed(0))
const armName = process.argv[2]

if (armName) {
  const run = arms[armName]
  if (!run) {
    throw new Error(
      `unknown arm "${armName}"; pick one of: ${Object.keys(arms).join(', ')}`,
    )
  }
  console.log(JSON.stringify(await time(run)))
} else {
  for (const fixture of fixtures) {
    const [, wasm] = Object.entries(arms)[0]!
    const expected = await wasm(fixture)
    for (const [name, run] of Object.entries(arms).slice(1)) {
      assertSame(expected, await run(fixture), `${fixture.label}: ${name}`)
    }
  }

  const results: Record<string, Record<string, Timing>> = {}
  for (const name of Object.keys(arms)) {
    const out = execFileSync(
      process.execPath,
      ['--experimental-strip-types', import.meta.filename, name],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
    )
    results[name] = JSON.parse(out.trim().split('\n').at(-1)!) as Record<
      string,
      Timing
    >
  }

  for (const fixture of fixtures) {
    console.log(`\n${fixture.label}, ${fixture.iterations} iterations`)
    for (const [name, byFixture] of Object.entries(results)) {
      const t = byFixture[fixture.label]!
      console.log(
        `  ${name.padEnd(36)} mean ${fmt(t.mean).padStart(6)} ms   min ${fmt(t.min).padStart(6)} ms`,
      )
    }
  }
}
