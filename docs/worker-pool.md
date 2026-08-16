# The worker pool

A **BGZF block** is one gzip member of the file — at most 64KB compressed, with
its own uncompressed length in its trailer — and a **chunk** is the
virtual-offset range a BAM or tabix index resolves a query to, covering a run of
consecutive blocks and usually starting and ending partway through the outer
two. Every count and every table below is in those terms; the
[README](../README.md#terms) states them at length.

BGZF blocks inflate independently, so the blocks in one chunk can be spread
across Web Workers. Inflating is where an indexed read spends its time — 70-90%
of the wall clock of a `@gmod/bam` query that finds nothing in its cache — which
makes this the largest speedup available to a consumer. What it actually
measures is [below](#what-it-is-worth): at the default four workers a BAM chunk
goes about 1.8-2.1x once it is past a couple of MB, which on a deep long-read
view is
[most of a second off a 1.8s inflate](#at-the-size-where-it-saves-seconds).

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
  efficiency, and four to eight buys another 1.2-1.4x for twice the threads. The
  default stops at four to bound what a consumer with many pools spends, not
  because the curve has flattened — it has not, even at 140MB
  ([four workers is not the ceiling](#four-workers-is-not-the-ceiling)).

- **One worker is a loss** — 0.73-0.97x. That is the cost of the round trip and
  the input copy with nothing to overlap it, and it is the floor a fixture
  climbs off only when it has enough blocks to divide.

- **A whole small file never climbs off it.** paired.bam is 7 blocks and 0.3MB
  out, and loses at every worker count. That is about the total work, not the
  block count — see
  [how big a chunk has to be](#how-big-does-the-chunk-have-to-be), where eight
  blocks out of a deep BAM is already a win.

- **The end-to-end column is the smaller one, and the gap is serial.** A pooled
  call gets one `Uint8Array` per block back and concatenates them on the
  caller's thread in `assembleChunkSliceResult`, work the sequential path does
  inside wasm as part of the same call. That is a memcpy of the whole
  **decompressed** output — it measured 0.7-1.2 GB/s here — and no worker count
  touches it. It grows with the uncompressed size rather than the file's, so it
  is worst where compression is best: out.sorted.gff.gz is 5.0MB in and 92.8MB
  out, reassembly is 58% of its four-worker call, and end to end it never
  reaches 1.3x however many workers you add. The same term is 23-36% of the
  other three.

### How big does the chunk have to be?

The tables above use a whole-file chunk, which is not the shape a reader asks
for — an indexed query resolves to a run of blocks. Holding the pool at its
default four workers and sweeping the chunk instead (`pnpm bench:chunksize`, min
of 15 rounds, input sliced to the chunk the way `@gmod/bam` passes it):

| blocks | compressed | uncompressed | shortreads_300x | ultra-long-ont | chr22_nanopore | out.sorted.gff |
| ------ | ---------- | ------------ | --------------- | -------------- | -------------- | -------------- |
| 1      | 5-63KB     | 0.1MB        | 0.82x           | 0.98x          | 1.11x          | 0.94x          |
| 2      | 8-127KB    | 0.1MB        | 0.80x           | 1.12x          | 0.84x          | 0.43x          |
| 4      | 16-253KB   | 0.2MB        | 0.90x           | 1.32x          | 1.44x          | 0.83x          |
| 8      | 28-507KB   | 0.4-0.5MB    | 1.36x           | 1.68x          | 1.60x          | 1.03x          |
| 16     | 57-527KB   | 0.8-1.0MB    | 1.40x           | 1.82x          | 1.79x          | 0.98x          |
| 32     | 112KB-1MB  | 1.6-2.0MB    | 1.62x           | 2.12x          | 1.77x          | 1.01x          |
| 64     | 231KB-2MB  | 3.3-4.0MB    | 1.53x           | 2.04x          | 1.87x          | 0.71x          |
| 128    | 441KB-4MB  | 6.6-8.0MB    | 1.83x           | 2.05x          | 2.16x          | 0.83x          |
| 256    | 911KB-8MB  | 13-16MB      | 1.58x           | —              | 1.68x          | 1.18x          |

The single-block row is a control: `unzipChunkSlice` declines the pool outright
there, so both arms run the same code and the spread off 1.00x is the noise
floor — call it ±0.15x, and read no row as finer than that.

- **It turns positive at four to eight blocks** — roughly 150-500KB compressed,
  0.2-0.5MB uncompressed. Below that the round trip and the input copy cost more
  than the parallelism returns.
- **It has most of its value by sixteen to thirty-two blocks**, around 1-2MB of
  uncompressed chunk, and the ratio is flat after that. So a query does not have
  to be large to collect this — but past a couple of MB, growing the region buys
  absolute time rather than a better multiple.
- **out.sorted.gff.gz is flat at ~1.0x throughout**, for the reassembly reason
  above. It is the fixture whose chunks decompress ~18x, so the serial concat
  tracks the inflate no matter how the chunk is sized.

### At the size where it saves seconds

The fixtures top out at a 60ms query, so the rows above cannot show what this is
worth on a deep long-read view. Repeating a fixture's block range builds a chunk
that can — a repeat is valid BGZF, since the format is concatenated gzip members
— and holds the block-size distribution fixed (`pnpm bench:largechunk`, four
workers, min of 7):

| fixture                   | blocks | compressed | uncompressed | seq   | 4w    | speedup | saved |
| ------------------------- | ------ | ---------- | ------------ | ----- | ----- | ------- | ----- |
| chr22_nanopore_subset.bam | 894    | 27MB       | 47MB         | 0.20s | 0.12s | 1.59x   | 0.07s |
| chr22_nanopore_subset.bam | 2682   | 81MB       | 140MB        | 0.63s | 0.31s | 1.99x   | 0.31s |
| chr22_nanopore_subset.bam | 7152   | 216MB      | 373MB        | 1.77s | 0.91s | 1.95x   | 0.86s |
| ultra-long-ont.bam        | 772    | 26MB       | 43MB         | 0.21s | 0.11s | 1.85x   | 0.09s |
| ultra-long-ont.bam        | 2509   | 84MB       | 139MB        | 0.66s | 0.32s | 2.09x   | 0.35s |
| ultra-long-ont.bam        | 6948   | 231MB      | 384MB        | 1.62s | 0.85s | 1.90x   | 0.77s |
| shortreads_300x.bam       | 861    | 15MB       | 53MB         | 0.13s | 0.09s | 1.44x   | 0.04s |
| shortreads_300x.bam       | 2296   | 39MB       | 141MB        | 0.40s | 0.24s | 1.63x   | 0.16s |
| shortreads_300x.bam       | 6314   | 107MB      | 389MB        | 0.97s | 0.55s | 1.77x   | 0.42s |

The multiple holds — 1.8-2.1x on long-read BAM across two orders of magnitude of
chunk — so the saving scales with the query: **roughly 0.9s off a 1.8s inflate
at 373MB uncompressed**, or 1.1-2.3ms per MB of output. That is the regime the
jbrowse figure below comes from, and it is why the pool is worth its threads on
deep data even though it is a rounding error on a 0.3MB fixture.

### Four workers is not the ceiling

The obvious guess about a 373MB inflate is that it goes memory-bandwidth bound
and the fourth worker is already doing nothing. It is not so, at least on
sixteen threads. All three pools alive at once and interleaved against one
sequential baseline, min of 7:

| fixture                   | blocks | uncompressed | seq   | 2w            | 4w            | 8w            |
| ------------------------- | ------ | ------------ | ----- | ------------- | ------------- | ------------- |
| chr22_nanopore_subset.bam | 894    | 47MB         | 0.17s | 0.12s (1.41x) | 0.08s (2.22x) | 0.06s (2.66x) |
| chr22_nanopore_subset.bam | 2682   | 140MB        | 0.50s | 0.37s (1.35x) | 0.24s (2.07x) | 0.19s (2.60x) |
| ultra-long-ont.bam        | 772    | 43MB         | 0.15s | 0.11s (1.35x) | 0.07s (2.19x) | 0.05s (2.82x) |
| ultra-long-ont.bam        | 2509   | 139MB        | 0.49s | 0.38s (1.30x) | 0.23s (2.16x) | 0.17s (2.82x) |
| shortreads_300x.bam       | 861    | 53MB         | 0.11s | 0.08s (1.37x) | 0.06s (2.00x) | 0.05s (2.29x) |
| shortreads_300x.bam       | 2296   | 141MB        | 0.30s | 0.23s (1.31x) | 0.16s (1.83x) | 0.13s (2.36x) |

Every row is monotone and a repeat run agreed to ±0.15x. **Two workers get about
two thirds of what four get** (1.3-1.4x against 1.8-2.2x), and **eight still add
a quarter on top of four** (2.3-2.8x). Efficiency falls the whole way — 0.67,
0.51, 0.32 of linear — but nothing has flattened by eight.

So the default `min(hardwareConcurrency, 4)` is not the point where the curve
stops paying. It is a budget decision, and the budget is set by the consumer
rather than by this table: `getSharedWorkerPool()` memoizes per JS context, so
an application that runs adapters in several RPC workers gets four pool workers
_each_ — five tracks is twenty workers, each with its own grow-only wasm heap.
Raise `numWorkers` when you know your process holds one pool; leave it alone
when you do not.

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

jbrowse-components'
[BGZF_WORKER_POOL.md](https://github.com/GMOD/jbrowse-components/blob/main/agent-docs/reference/BGZF_WORKER_POOL.md)
covers both, plus how to confirm the pool is really running in production rather
than quietly falling back.

### Measuring it again

`pnpm bench:pool` runs `scripts/bench-worker-pool.ts`, which serves the repo
over HTTP with no COOP/COEP and drives `test/browser/scaling.html` under
puppeteer, alongside `bench:chunksize` and `bench:largechunk` on the same page.
Six ways to get a fake number out of this, five of them found the hard way:

- **Node cannot measure the pool at all.** `workersAvailable()` wants a global
  `Worker` plus Blob URLs, and `worker_threads` is a different API — so the pool
  resolves to `undefined` and the in-process path runs. Every vitest bench in
  `benchmarks/` is blind to it and will report parity forever.
- **Don't time `decompressBlocks` against `unzipChunkSlice`.** See above.
- **Slice the input to the chunk.** `scanBgzfBlocks` treats the buffer as
  _starting_ at `minv.blockPosition`, and the sequential path hands the whole
  buffer to wasm, which copies all of it into its heap and preallocates
  `total_uncompressed_size(input)`. Benchmark a small chunk against a whole-file
  buffer and the sequential arm inflates the file while the pooled arm inflates
  the chunk: it reads as a clean 2.2-3.1x on **two** blocks, rising as the chunk
  shrinks, which is the tell. `@gmod/bam` passes the read that covers the chunk,
  so a benchmark should too.
- **Interleave the arms.** Run all of one and then all of the other and any
  machine drift lands entirely on the second; interleaved, throttling hits both
  alike and the ratio survives even where the milliseconds do not.
- **Min over enough rounds**, because a single sample is mostly GC.
- **Pass `idleTimeoutMs: 0` to the pools under test**, or a reap between arms
  puts a worker respawn and a wasm instantiate inside a timed region.
- **Watch the tab's memory once the chunks get large.** A worker's wasm heap
  only ever grows, so a sweep holding several pools alive across a 400MB chunk
  runs the renderer out of memory and puppeteer reports it as a detached frame
  or a dropped websocket rather than as anything about memory. One worker is the
  worst case, not the cheapest, since the whole range lands in a single heap.
  Either keep the chunk in the low hundreds of MB or measure one worker count
  per page load — but if you split the passes, note that each gets its own
  sequential baseline, and drift between them produced an 8w column whose raw
  times were _slower_ than 4w while its ratio came out higher.

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

`getSharedWorkerPool` resolves to `undefined` only where nothing can launch a
Worker at all — Node, or any host lacking `Worker` plus Blob URLs. So the same
call site works everywhere, and you can hand the result straight to a sequential
fallback. `createBgzfWorkerPool` throws in those same cases.

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

Or drive it yourself. A pool inflates whole BGZF blocks, so it takes the block
list `scanBgzfBlocks` finds — the same call `unzipChunkSlice` makes internally,
split out for readers that want the blocks rather than a chunk slice:

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

## The pool reaps idle workers

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
`postMessage`'s transfer list, so ownership moves rather than the bytes
structured-cloning. Transfers need no isolation, so the pool works on an
ordinary non-isolated origin, and results come back the same way. Each range
copies out of the input first, because transferring detaches the buffer it came
from and that buffer belongs to the caller (bam-js hands over the filehandle
read it is still holding). Across all the workers that is one pass over the
compressed bytes, the smaller side of the operation.

The pool deliberately avoids `SharedArrayBuffer`. It was the original design,
and measurement ruled it out. It needs COOP/COEP, which most JBrowse installs
cannot set, and it buys nothing where they can: `decompressAll` copies its input
into the wasm heap either way, so shared memory removes the host-side slice
rather than the boundary copy. Head to head in Chrome at 4 workers, a pooled
`SAB` was at parity with transferring, and a freshly allocated one was slower.

Dropping it is also what made the feature generally available. Availability used
to hang on `SharedArrayBuffer` existing — that is, on cross-origin isolation —
when the real requirement is only a Worker and a Blob URL to launch it from.
