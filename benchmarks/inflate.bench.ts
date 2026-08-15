// Isolated decompression benchmark: the wasm/libdeflate path this library uses
// against the two alternatives it could have been, over the real blocks of the
// test fixtures.
//
// - `unzip` — the shipped path. BGZF input goes straight to the wasm
//   `decompressAll`.
// - pako per block — what a pure-JS BGZF reader does, and what this package
//   shipped through v6.0.0. Each block's raw deflate payload inflated
//   separately, because BGZF is a multi-member stream.
// - node zlib per block — the same loop on the platform's native zlib. Not a
//   candidate implementation (it does not exist in a browser); it is here as
//   the reference floor, so the wasm number can be read as "how close to native
//   are we" rather than only "how much better than JS".
//
// All three are asserted byte-identical before timing, so this measures inflate
// throughput and nothing else.
//
// Run with `pnpm benchonly inflate`. Unlike unzip.bench.ts this needs no
// build-both-branches.sh — it imports src directly.
import { readFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'

import { inflateRaw } from 'pako-esm2'
import { bench, describe } from 'vitest'

import { unzip } from '../src/unzip.ts'

const BGZF_HEADER_SIZE = 18
const BGZF_TRAILER_SIZE = 8

interface Fixture {
  label: string
  data: Uint8Array
  /** [payloadStart, payloadEnd) of each block's raw deflate bytes */
  blocks: [number, number][]
  iterations: number
}

/**
 * Every BGZF block's deflate payload. BSIZE-1 lives in the BC extra subfield at
 * offset 16 of the header, which is what makes the blocks independently
 * inflatable in the first place.
 */
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

function perBlock(
  inflate: (b: Uint8Array) => Uint8Array,
  { data, blocks }: Fixture,
) {
  const parts: Uint8Array[] = []
  let total = 0
  for (const [start, end] of blocks) {
    const out = inflate(data.subarray(start, end))
    parts.push(out)
    total += out.length
  }
  const joined = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    joined.set(part, offset)
    offset += part.length
  }
  return joined
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

// Timing arms that disagree is timing nothing. Checked once per fixture, before
// any of them are measured.
for (const fixture of fixtures) {
  const expected = await unzip(fixture.data)
  assertSame(
    expected,
    perBlock(b => inflateRaw(b), fixture),
    'pako',
  )
  assertSame(
    expected,
    perBlock(b => inflateRawSync(b), fixture),
    'node zlib',
  )
}

for (const fixture of fixtures) {
  const { label, data, iterations } = fixture

  describe(`inflate ${label}`, () => {
    bench(
      'wasm libdeflate (unzip)',
      async () => {
        await unzip(data)
      },
      { iterations, warmupIterations: 5 },
    )

    bench(
      'pako per block',
      () => {
        perBlock(b => inflateRaw(b), fixture)
      },
      { iterations, warmupIterations: 5 },
    )

    bench(
      'node zlib per block',
      () => {
        perBlock(b => inflateRawSync(b), fixture)
      },
      { iterations, warmupIterations: 5 },
    )
  })
}
