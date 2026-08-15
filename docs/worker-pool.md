# The worker pool

BGZF blocks inflate independently, so the blocks in one chunk can be spread
across Web Workers. Inflating is where an indexed read spends its time — 70-90%
of the wall clock of a `@gmod/bam` query that finds nothing in its cache — which
makes this the largest speedup available to a consumer. What it actually
measures is [below](#what-it-is-worth): the inflate moves about 2.5x at four
workers, and a caller of `unzipChunkSlice` sees 1.1-2.0x of that.

Nothing creates a pool implicitly. Workers are a thread budget the application
owns, and a library that quietly started four of them per file would be a bad
guest.

## What it is worth

Whole-file chunk through `unzipChunkSlice`, headless Chrome on an Intel i9-9880H
(8 cores / 16 threads), arms interleaved, min of 9 rounds, every arm asserted
byte-identical to the sequential path first. Speedup against the same call with
no pool.

| fixture                            | blocks | sequential | 1w           | 2w           | 4w           | 8w           |
| ---------------------------------- | ------ | ---------- | ------------ | ------------ | ------------ | ------------ |
| paired.bam (0.1MB)                 | 7      | 1.01       | 1.38 (0.73x) | 1.47 (0.69x) | 1.52 (0.67x) | 1.80 (0.56x) |
| T_ko.2bit.gz (0.5MB)               | 9      | 2.95       | 3.80 (0.78x) | 3.21 (0.92x) | 2.47 (1.19x) | 2.66 (1.11x) |
| shortreads_300x.bam (4.9MB)        | 287    | 68         | 86 (0.79x)   | 52 (1.30x)   | 38 (1.79x)   | 31 (2.19x)   |
| out.sorted.gff.gz (5.0MB)          | 1493   | 134        | 206 (0.65x)  | 146 (0.92x)  | 116 (1.15x)  | 105 (1.27x)  |
| ultra-long-ont.bam (6.4MB)         | 193    | 74         | 90 (0.82x)   | 57 (1.29x)   | 39 (1.90x)   | 32 (2.30x)   |
| chr22_nanopore_subset.bam (13.5MB) | 447    | 150        | 163 (0.92x)  | 108 (1.39x)  | 75 (2.00x)   | 55 (2.75x)   |

The same run with the reassembly that follows the inflate left out — the part
the pool can actually reach:

| fixture                            | blocks | sequential | 1w           | 2w           | 4w           | 8w           |
| ---------------------------------- | ------ | ---------- | ------------ | ------------ | ------------ | ------------ |
| paired.bam (0.1MB)                 | 7      | 1.01       | 1.38 (0.73x) | 1.20 (0.84x) | 1.53 (0.66x) | 1.57 (0.64x) |
| T_ko.2bit.gz (0.5MB)               | 9      | 2.95       | 4.05 (0.73x) | 2.98 (0.99x) | 2.28 (1.29x) | 2.26 (1.31x) |
| shortreads_300x.bam (4.9MB)        | 287    | 68         | 72 (0.95x)   | 40 (1.69x)   | 28 (2.47x)   | 21 (3.28x)   |
| out.sorted.gff.gz (5.0MB)          | 1493   | 134        | 138 (0.97x)  | 80 (1.67x)   | 54 (2.49x)   | 43 (3.13x)   |
| ultra-long-ont.bam (6.4MB)         | 193    | 74         | 82 (0.91x)   | 48 (1.56x)   | 32 (2.32x)   | 26 (2.80x)   |
| chr22_nanopore_subset.bam (13.5MB) | 447    | 150        | 161 (0.93x)  | 91 (1.66x)   | 56 (2.67x)   | 40 (3.78x)   |

_Measured 2026-08-15, `pnpm bench:pool`. Ratios are what to read: absolute
milliseconds drifted about 30% upward over twenty minutes of continuous
benchmarking, and individual arms spread 20-140% between rounds because every
iteration allocates the whole decompressed output and garbage collection lands
where it lands. Repeat runs held the four large fixtures' 4w figures to ±0.2x._

Four things the tables say:

- **Scaling is sublinear from the start, not near-linear to four.** At four
  workers the inflate is 2.3-2.7x on the multi-megabyte fixtures, so about 60%
  efficiency, and four to eight buys another 1.2-1.4x for twice the threads.
  Four is a reasonable default because the return past it is small and the cost
  is a whole extra wasm heap each, not because eight would not help at all.

- **One worker is a loss** — 0.73-0.97x. That is the cost of the round trip and
  the input copy with nothing to overlap it, and it is the floor a fixture
  climbs off only when it has enough blocks to divide.

- **A small chunk never climbs off it.** paired.bam is 7 blocks and 0.3MB out,
  and loses at every worker count. `unzipChunkSlice` already declines the pool
  for a single-block chunk; between two blocks and roughly ten there is nothing
  to win either, so a consumer whose chunks are that small should not expect
  this to show up.

- **The end-to-end column is the smaller one, and the gap is serial.** A pooled
  call gets one `Uint8Array` per block back and concatenates them on the
  caller's thread in `assembleChunkSliceResult`, work the sequential path does
  inside wasm as part of the same call. That is a memcpy of the whole
  **decompressed** output — it measured 0.7-1.2 GB/s here — and no worker count
  touches it. It grows with the uncompressed size rather than the file's, so it
  is worst where compression is best: out.sorted.gff.gz is 5.0MB in and 92.8MB
  out, reassembly is 58% of its four-worker call, and end to end it never
  reaches 1.3x however many workers are added. The same term is 23-36% of the
  other three.

### The number this doc used to quote

"2.7-4.1x, close to linear out to four workers." That is the **inflate-only**
column at **eight** workers, and it came from a harness that timed
`pool.decompressBlocks` against a sequential `unzipChunkSlice` — the pooled arm
skipping the reassembly the real call still has to do. Compare like with like
and four workers is 1.1-2.0x end to end. Keep both columns when quoting: the
inflate-only one is the right number for "is the parallelism working", and the
end-to-end one is the only one a caller experiences.

### End to end in a consumer

Further out, a consumer's own serial work dilutes it again, and by how much
depends on the format rather than on this library. jbrowse-components measured,
in headless Chrome over real HTTP with four workers:

- **1.95x** on a 22-view pan/zoom over 1000x long-read BAM, 38,246 records
  either way.
- **1.35-1.45x** on a 213MB multi-sample VCF through `@gmod/tabix`. Splitting
  that one against a warm-cache run isolates the decompression at **1.83x**,
  with a 28% floor of per-line byte scanning the pool cannot reach — the lines
  are enormous because every 1000-Genomes record carries a genotype field per
  sample.

Both, plus how to verify the pool is engaged in production rather than silently
falling back, are in jbrowse-components'
[BGZF_WORKER_POOL.md](https://github.com/GMOD/jbrowse-components/blob/main/agent-docs/reference/BGZF_WORKER_POOL.md).

### Measuring it again

`pnpm bench:pool` runs `scripts/bench-worker-pool.ts`, which serves the repo
over HTTP with no COOP/COEP and drives `test/browser/scaling.html` under
puppeteer. Five ways to get a fake number out of this, four of them found the
hard way:

- **Node cannot measure the pool at all.** `workersAvailable()` wants a global
  `Worker` plus Blob URLs, and `worker_threads` is a different API — so the pool
  resolves to `undefined` and the in-process path runs. Every vitest bench in
  `benchmarks/` is blind to it and will report parity forever.
- **Don't time `decompressBlocks` against `unzipChunkSlice`.** See above.
- **Interleave the arms.** Run all of one and then all of the other and any
  machine drift lands entirely on the second; interleaved, throttling hits both
  alike and the ratio survives even where the milliseconds do not.
- **Min over enough rounds**, because a single sample is mostly GC.
- **Pass `idleTimeoutMs: 0` to the pools under test**, or a reap between arms
  puts a worker respawn and a wasm instantiate inside a timed region.

## Getting a pool

```typescript
import { getSharedWorkerPool } from '@gmod/bgzf-filehandle'

const pool = await getSharedWorkerPool() // undefined if workers are unavailable
```

There are three entry points:

- **`getSharedWorkerPool(numWorkers?, idleTimeoutMs?)`** — one process-wide
  pool, created on the first call and reused after that. `numWorkers` defaults
  to `Math.min(navigator.hardwareConcurrency, 4)`, and both arguments apply only
  to the call that actually creates the pool.
- **`createBgzfWorkerPool(numWorkers?, workerUrl?, idleTimeoutMs?)`** — an
  unshared pool you own, for setting the worker count per pool or managing the
  lifecycle yourself.
- **`destroySharedWorkerPool()`** — terminates the shared pool's workers. The
  next `getSharedWorkerPool()` builds a fresh one.

`getSharedWorkerPool` resolves to `undefined` only where Workers cannot be
launched at all — Node, or any host lacking `Worker` plus Blob URLs. So the same
call site works everywhere, and the result can be passed straight through to a
sequential fallback. `createBgzfWorkerPool` throws in those same cases.

A browser that is _not_ cross-origin isolated is a perfectly good host; see
[No cross-origin isolation required](#no-cross-origin-isolation-required).

## Using it

Pass the pool to `unzipChunkSlice`:

```typescript
import { getSharedWorkerPool, unzipChunkSlice } from '@gmod/bgzf-filehandle'

const pool = await getSharedWorkerPool()
const result = await unzipChunkSlice(compressedData, chunk, pool)
```

Or hand it to a reader that takes one.
[`@gmod/bam`](https://github.com/GMOD/bam-js) accepts the pending promise
directly, so a synchronous constructor doesn't have to await first:

```typescript
const bam = new BamFile({ bamUrl, bgzfWorkerPool: getSharedWorkerPool() })
```

Or drive it yourself. A pool inflates whole blocks, so it takes the block list
`scanBgzfBlocks` finds — the same call `unzipChunkSlice` makes internally, split
out for readers that want the blocks rather than a chunk slice:

```typescript
import { scanBgzfBlocks } from '@gmod/bgzf-filehandle'

// input starts at file offset `minv.blockPosition`; scanning stops after the
// block at `maxv.blockPosition`, or at the first byte that isn't a valid block
const blocks = scanBgzfBlocks(input, minv.blockPosition, maxv.blockPosition)
const { blocks: decompressed } = await pool.decompressBlocks(input, blocks)
```

`decompressed` holds one `Uint8Array` per entry of `blocks`, in order. Each
`BgzfBlockInfo` carries `filePosition` (the compressed offset in the file),
`inputOffset` (its offset within `input`), `compressedSize` and
`decompressedSize`.

`decompressBlocks` and `destroy` are the whole of the `BgzfWorkerPool`
interface, so they are all an alternative implementation has to provide.

## Idle workers are reaped

After `idleTimeoutMs` (default 3 minutes) with nothing to inflate, a pool
terminates its workers, and spawns a fresh set on the next call. Pass `0` to
keep them up for the pool's lifetime, which is what every version before 6.5
did.

**The reap is invisible to whoever holds the pool, and that is a requirement
rather than a nicety.** Consumers keep a pool around — `@gmod/bam` stores the
promise on the `BamFile` and awaits it once per chunk read, for the life of the
file — so reclaiming by calling `destroy()` on their behalf is not an option. A
destroyed pool throws out of `decompressBlocks`, which would turn every open
reader's next read into an error instead of degrading it to inflating in
process. Only the workers come and go; the object stays usable.

**What this reclaims is mostly memory, not threads.** Each worker holds its own
copy of the inlined wasm bundle, and that `WebAssembly.Memory` only ever grows.
So a pool that had inflated one deep long-read chunk held onto that heap until
the page went away — times however many pools the consumer had, which for a
consumer creating one pool per data worker (below) is several. That heap was the
largest thing an idle pool was keeping.

**An in-flight request is never reaped out from under itself.**
`decompressBlocks` clears the timer on entry, so a lone request has no armed
timer to go wrong. The case that needs care is two overlapping requests: when
the first settles, it would rearm the timer and terminate the second request's
workers mid-flight — and since `terminate()` rejects a worker's pending
callbacks, that would fail the live query rather than merely slow it down.

## Sharing one pool across threads

When the consumer itself runs in a worker — as JBrowse's data workers do — every
one of them calling `getSharedWorkerPool()` gets its own set of pool workers,
multiplying the thread count by the number of consumers. `BgzfWorkerPoolHost`
and `BgzfWorkerPoolClient` let several threads drive a single pool over a
`MessagePort` instead:

```typescript
// on the thread that owns the pool
import {
  BgzfWorkerPoolHost,
  createPoolPort,
  createBgzfWorkerPool,
} from '@gmod/bgzf-filehandle'

const host = new BgzfWorkerPoolHost(await createBgzfWorkerPool())
const port = createPoolPort(host) // postMessage this to a consumer thread,
// listing it in the transfer array. One host serves any number of ports.

// on the consumer thread
import { BgzfWorkerPoolClient } from '@gmod/bgzf-filehandle'

const pool = new BgzfWorkerPoolClient(port) // implements BgzfWorkerPool
```

The client copies the compressed input once, so that the transfer detaches a
buffer it owns rather than the caller's. That extra pass over the compressed
bytes is the price of the hop, and it is small against the inflate.

## No cross-origin isolation required

Each worker's range crosses as a **transferable**: the `ArrayBuffer` rides in
`postMessage`'s transfer list, so ownership moves rather than the bytes being
structured-cloned. Transfers need no isolation, so the pool works on an ordinary
non-isolated origin, and results come back the same way. The range is copied out
of the input first, because transferring detaches the buffer it came from and
that buffer belongs to the caller (bam-js hands over the filehandle read it is
still holding). Across all the workers that is one pass over the compressed
bytes, the smaller side of the operation.

`SharedArrayBuffer` is deliberately not used. It was the original design, and it
was measured out. It needs COOP/COEP, which most JBrowse installs cannot set,
and it buys nothing where they can: `decompressAll` copies its input into the
wasm heap either way, so shared memory removes the host-side slice rather than
the boundary copy. Head to head in Chrome at 4 workers, a pooled `SAB` was at
parity with transferring, and a freshly allocated one was slower.

Dropping it is also what made the feature generally available. Availability used
to be gated on `SharedArrayBuffer` existing — that is, on cross-origin isolation
— when the real requirement is only a Worker and a Blob URL to launch it from.
