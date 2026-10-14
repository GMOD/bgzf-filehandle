# The worker pool

A **BGZF block** is one gzip member of the file — at most 64KB compressed, with
its own uncompressed length in its trailer — and a **chunk** is the
virtual-offset range a BAM or tabix index resolves a query to, covering a run of
consecutive blocks and usually starting and ending partway through the outer
two. Every count and every table below is in those terms; the
[README](../README.md#terms) states them at length.

BGZF blocks inflate independently, so the pool can spread the blocks in one
chunk across Web Workers. An indexed read spends most of its time inflating,
70-90% of the wall clock of a `@gmod/bam` query that misses its cache, so the
pool is the largest speedup available to a consumer. At the default four
workers, a BAM chunk past a couple of MB inflates about 1.8-2.1x faster
([measurements below](#what-it-is-worth)), which on a deep long-read view is
[most of a second off a 1.8s inflate](#at-the-size-where-it-saves-seconds).

Only an explicit call creates a pool, because workers are a thread budget the
application owns, and a library that started four of them per file unasked would
spend the application's threads for it.

## What it is worth

The benchmark passes a whole-file chunk through `unzipChunkSlice` in headless
Chrome on an Intel i9-9880H (8 cores / 16 threads), with arms interleaved, min
of 9 rounds, and every arm asserted byte-identical to the sequential path first.
Each speedup is against the same call with no pool.

| fixture                            | blocks | sequential | 1w           | 2w           | 4w           | 8w           |
| ---------------------------------- | ------ | ---------- | ------------ | ------------ | ------------ | ------------ |
| paired.bam (0.1MB)                 | 7      | 1.01       | 1.38 (0.73x) | 1.47 (0.69x) | 1.52 (0.67x) | 1.80 (0.56x) |
| T_ko.2bit.gz (0.5MB)               | 9      | 2.95       | 3.80 (0.78x) | 3.21 (0.92x) | 2.47 (1.19x) | 2.66 (1.11x) |
| shortreads_300x.bam (4.9MB)        | 287    | 68         | 86 (0.79x)   | 52 (1.30x)   | 38 (1.79x)   | 31 (2.19x)   |
| out.sorted.gff.gz (5.0MB)          | 1493   | 134        | 206 (0.65x)  | 146 (0.92x)  | 116 (1.15x)  | 105 (1.27x)  |
| ultra-long-ont.bam (6.4MB)         | 193    | 74         | 90 (0.82x)   | 57 (1.29x)   | 39 (1.90x)   | 32 (2.30x)   |
| chr22_nanopore_subset.bam (13.5MB) | 447    | 150        | 163 (0.92x)  | 108 (1.39x)  | 75 (2.00x)   | 55 (2.75x)   |

The second table comes from the same run but leaves out the reassembly that
follows the inflate, so it times only the work the pool can speed up:

| fixture                            | blocks | sequential | 1w           | 2w           | 4w           | 8w           |
| ---------------------------------- | ------ | ---------- | ------------ | ------------ | ------------ | ------------ |
| paired.bam (0.1MB)                 | 7      | 1.01       | 1.38 (0.73x) | 1.20 (0.84x) | 1.53 (0.66x) | 1.57 (0.64x) |
| T_ko.2bit.gz (0.5MB)               | 9      | 2.95       | 4.05 (0.73x) | 2.98 (0.99x) | 2.28 (1.29x) | 2.26 (1.31x) |
| shortreads_300x.bam (4.9MB)        | 287    | 68         | 72 (0.95x)   | 40 (1.69x)   | 28 (2.47x)   | 21 (3.28x)   |
| out.sorted.gff.gz (5.0MB)          | 1493   | 134        | 138 (0.97x)  | 80 (1.67x)   | 54 (2.49x)   | 43 (3.13x)   |
| ultra-long-ont.bam (6.4MB)         | 193    | 74         | 82 (0.91x)   | 48 (1.56x)   | 32 (2.32x)   | 26 (2.80x)   |
| chr22_nanopore_subset.bam (13.5MB) | 447    | 150        | 161 (0.93x)  | 91 (1.66x)   | 56 (2.67x)   | 40 (3.78x)   |

_Measured 2026-08-15, `pnpm bench:pool`. Read the ratios rather than the
absolute milliseconds, which drifted about 30% upward over twenty minutes of
continuous benchmarking. Individual arms spread 20-140% between rounds, because
every iteration allocates the whole decompressed output and garbage collection
runs at unpredictable points. Repeat runs held the four large fixtures' 4w
figures to ±0.2x._

The tables show four things:

- **Scaling is sublinear from the start, not near-linear to four.** At four
  workers the inflate is 2.3-2.7x on the multi-megabyte fixtures, so about 60%
  efficiency, and four to eight adds another 1.2-1.4x for twice the threads. The
  default stops at four to limit the threads a consumer with many pools spends;
  the curve has not flattened, even at 140MB
  ([four workers is not the ceiling](#four-workers-is-not-the-ceiling)).

- **One worker is a loss**, at 0.73-0.97x. The slowdown is the cost of the round
  trip and the input copy with no parallel work to offset them, and a fixture
  rises above it only when it has enough blocks to divide.

- **A whole small file stays below 1.0x.** paired.bam is 7 blocks and 0.3MB out,
  and loses at every worker count. The loss comes from the small total work, not
  the block count; in
  [how big a chunk has to be](#how-big-does-the-chunk-have-to-be), eight blocks
  out of a deep BAM already win.

- **The end-to-end figures are the smaller ones, and the gap is serial work.** A
  pooled call gets one `Uint8Array` per block back and concatenates them on the
  caller's thread in `assembleChunkSliceResult`, work the sequential path does
  inside wasm as part of the same call. That concatenation is a memcpy of the
  whole **decompressed** output, which measured 0.7-1.2 GB/s here, and adding
  workers does not shorten it. The memcpy grows with the uncompressed size
  rather than the compressed size, so it is largest where compression is best.
  out.sorted.gff.gz is 5.0MB in and 92.8MB out, reassembly is 58% of its
  four-worker call, and end to end it never reaches 1.3x however many workers
  you add. Reassembly is 23-36% of the four-worker call for the other three
  large fixtures.

### How big does the chunk have to be?

The tables above use a whole-file chunk, but an indexed query resolves to a run
of blocks. The sweep below holds the pool at its default four workers and varies
the chunk instead (`pnpm bench:chunksize`, min of 15 rounds, input sliced to the
chunk the way `@gmod/bam` passes it):

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

At the time of the measurement, `unzipChunkSlice` declined the pool only for a
single block, so both arms of the single-block row ran the same code, which
makes that row a control whose spread off 1.00x is the noise floor, about
±0.15x. Read no row as finer than that. These rows set the threshold described
below, and `unzipChunkSlice` now declines the pool for every row under it, so a
re-run shows those rows at 1.00x.

- **The speedup turns positive at four to eight blocks**, roughly 150-500KB
  compressed and 0.2-0.5MB uncompressed. Below that the round trip and the input
  copy cost more than the parallelism saves. `unzipChunkSlice` therefore hands a
  chunk to the pool only from `POOL_MIN_DECOMPRESSED_BYTES`, 400,000 bytes
  inflated, which is the eight-block row, where every BAM fixture had turned
  positive. A shared pool that never sees a chunk that large never starts its
  workers.
- **The speedup reaches most of its value by sixteen to thirty-two blocks**,
  around 1-2MB of uncompressed chunk, and the ratio is flat after that. A query
  therefore does not have to be large to benefit. Past a couple of MB, a larger
  region saves more absolute time but does not improve the multiple.
- **out.sorted.gff.gz is flat at ~1.0x throughout**, for the reassembly reason
  above. Its chunks decompress ~18x, so the serial concatenation grows in step
  with the inflate however the chunk is sized.

### At the size where it saves seconds

The fixtures top out at a 60ms query, so the rows above cannot show the saving
on a deep long-read view. `pnpm bench:largechunk` builds larger chunks by
repeating a fixture's block range, which keeps the block-size distribution
fixed. A repeat is valid BGZF, since the format is concatenated gzip members.
The table uses four workers, min of 7:

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

The multiple stays at 1.8-2.1x on long-read BAM across two orders of magnitude
of chunk size, so the saving grows with the query, to **roughly 0.9s off a 1.8s
inflate at 373MB uncompressed**, or 1.1-2.3ms per MB of output. The jbrowse
figure below comes from chunks of this size. On deep data like this the pool
saves enough to justify its threads, even though its effect on a 0.3MB fixture
is negligible.

### Four workers is not the ceiling

The obvious guess is that a 373MB inflate becomes memory-bandwidth bound,
leaving the fourth worker with nothing to do, but on sixteen threads, at least,
it does not. The table below keeps all three pools alive at once and interleaves
them against one sequential baseline, min of 7:

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
a quarter on top of four** (2.3-2.8x). Efficiency falls the whole way (0.67,
0.51, 0.32 of linear), but the curve has not flattened by eight.

The default `min(hardwareConcurrency, 4)` is a budget decision rather than the
point where the curve stops improving, and the consumer's setup determines the
budget, not this table. `getSharedWorkerPool()` memoizes per JS context, so an
application that runs adapters in several RPC workers gets four pool workers
_each_; five tracks is twenty workers, each with its own grow-only wasm heap.
Raise `numWorkers` when you know your process holds one pool; leave it alone
when you do not.

### Inflate-only and end-to-end speedups

The inflate-only column at eight workers shows 2.7-4.1x. This page once quoted
that column as "close to linear out to four workers", but the column came from a
harness that timed `pool.decompressBlocks` against a sequential
`unzipChunkSlice`, so its pooled arm skipped the reassembly that the real call
still does. Compared like with like, four workers give 1.1-2.0x end to end. Keep
both columns when quoting: the inflate-only one is the right number for "is the
parallelism working", and the end-to-end one is the only one a caller
experiences.

### End to end in a consumer

In a consumer, the consumer's serial work reduces the speedup further, by an
amount that depends on the format rather than on this library.
jbrowse-components measured the following in headless Chrome over real HTTP with
four workers:

- **1.95x** on a 22-view pan/zoom over 1000x long-read BAM, 38,246 records
  either way.
- **1.35-1.45x** on a 213MB multi-sample VCF through `@gmod/tabix`. A comparison
  with a warm-cache run puts the decompression alone at **1.83x**, with a 28%
  floor of per-line byte scanning that the pool does not speed up. The lines are
  enormous because every 1000-Genomes record has a genotype field per sample.

jbrowse-components'
[BGZF_WORKER_POOL.md](https://github.com/GMOD/jbrowse-components/blob/main/agent-docs/reference/BGZF_WORKER_POOL.md)
covers both measurements, and how to confirm the pool is running in production
rather than falling back to inflating on the calling thread.

### Measuring it again

`pnpm bench:pool` runs `scripts/bench-worker-pool.ts`, which serves the repo
over HTTP with no COOP/COEP and drives `test/browser/scaling.html` under
puppeteer, alongside `bench:chunksize` and `bench:largechunk` on the same page.
The benchmark can produce a misleading number in six ways, and we hit five of
them:

- **Node cannot measure the pool at all.** `workersAvailable()` requires a
  global `Worker` plus Blob URLs, and `worker_threads` is a different API, so
  the pool resolves to `undefined` and the in-process path runs. Every vitest
  bench in `benchmarks/` therefore runs without the pool and reports parity.
- **Don't time `decompressBlocks` against `unzipChunkSlice`.** See above.
- **Slice the input to the chunk.** `scanBgzfBlocks` treats the buffer as
  _starting_ at `minv.blockPosition`, and the sequential path hands the whole
  buffer to wasm, which copies all of it into its heap and preallocates
  `total_uncompressed_size(input)`. If you benchmark a small chunk against a
  whole-file buffer, the sequential arm inflates the file while the pooled arm
  inflates the chunk. The result looks like a clean 2.2-3.1x on **two** blocks,
  and a speedup that rises as the chunk shrinks gives the error away.
  `@gmod/bam` passes the read that covers the chunk, so a benchmark should too.
- **Interleave the arms.** If you run all of one arm and then all of the other,
  any machine drift falls entirely on the second. Interleaved arms see the same
  throttling, so the ratio stays valid even where the milliseconds do not.
- **Take the min over enough rounds**, because garbage collection dominates a
  single sample.
- **Pass `idleTimeoutMs: 0` to the pools under test**, or a reap between arms
  puts a worker respawn and a wasm instantiate inside a timed region.
- **Watch the tab's memory once the chunks get large.** A worker's wasm heap
  only ever grows, so a sweep holding several pools alive across a 400MB chunk
  runs the renderer out of memory, and puppeteer reports it as a detached frame
  or a dropped websocket rather than as anything about memory. One worker is the
  worst case, not the cheapest, since the whole range goes into a single heap.
  Either keep the chunk in the low hundreds of MB or measure one worker count
  per page load. If you split the passes, each gets a separate sequential
  baseline, and drift between baselines once produced an 8w column whose raw
  times were _slower_ than 4w while its ratio came out higher.

## Getting a pool

```typescript
import { getSharedWorkerPool } from '@gmod/bgzf-filehandle'

const pool = await getSharedWorkerPool() // undefined if workers are unavailable
```

There are three entry points:

- **`getSharedWorkerPool(numWorkers?, idleTimeoutMs?)`** — one process-wide
  pool, created on the first call and reused after that. It starts no workers
  until a call reaches it, so holding one uses no threads. `numWorkers` defaults
  to `Math.min(navigator.hardwareConcurrency, 4)`, and both arguments apply only
  to the call that creates the pool.
- **`createBgzfWorkerPool(numWorkers?, workerUrl?, idleTimeoutMs?)`** — an
  unshared pool you own, for setting the worker count per pool or managing the
  lifecycle yourself. It resolves once its workers are up, and rejects if one
  fails to start. If the browser never starts a worker, the promise stays
  pending; `getSharedWorkerPool` never leaves a caller pending.
- **`destroySharedWorkerPool()`** — terminates the shared pool's workers, and
  the next `getSharedWorkerPool()` builds a fresh one.

`getSharedWorkerPool` resolves to `undefined` only on a host that cannot launch
a Worker at all: Node, or any host lacking `Worker` plus Blob URLs. The same
call site therefore works everywhere, and you can pass the result straight to
code that falls back to sequential inflating. `createBgzfWorkerPool` throws in
those same cases.

The pool runs in a browser that is _not_ cross-origin isolated; see
[No cross-origin isolation required](#no-cross-origin-isolation-required).

## Using it

Pass the pool to `unzipChunkSlice`:

```typescript
import { getSharedWorkerPool, unzipChunkSlice } from '@gmod/bgzf-filehandle'

const pool = await getSharedWorkerPool()
const result = await unzipChunkSlice(compressedData, chunk, pool)
```

A reader can take the pool instead:
[`@gmod/bam`](https://github.com/GMOD/bam-js) takes it as a constructor option
and accepts the pending promise directly, so a synchronous constructor doesn't
have to await first:

```typescript
const bam = new BamFile({ bamUrl, bgzfWorkerPool: getSharedWorkerPool() })
```

To drive the pool yourself, give it the block list from `scanBgzfBlocks`, since
a pool inflates whole BGZF blocks. `unzipChunkSlice` makes the same call
internally, and the package exports it for readers that want the blocks rather
than a chunk slice:

```typescript
import { scanBgzfBlocks } from '@gmod/bgzf-filehandle'

// input starts at file offset `minv.blockPosition`; scanning stops after the
// block at `maxv.blockPosition`, or at the first byte that isn't a valid block
const blocks = scanBgzfBlocks(input, minv.blockPosition, maxv.blockPosition)
const { blocks: decompressed } = await pool.decompressBlocks(input, blocks)
```

`decompressed` holds one `Uint8Array` per entry of `blocks`, in order. Each
`BgzfBlockInfo` has `filePosition` (the compressed offset in the file),
`inputOffset` (its offset within `input`), `compressedSize` and
`decompressedSize`.

`decompressBlocks` and `destroy` are the whole of the `BgzfWorkerPool`
interface, so they are all an alternative implementation has to provide.

## The pool reaps idle workers

After `idleTimeoutMs` (default 3 minutes) with nothing to inflate, a pool
terminates its workers, and starts a fresh set on the next call, which inflates
on the calling thread while they boot. Pass `0` to keep them up for the pool's
lifetime instead.

**A reap has to be invisible to whoever holds the pool.** Consumers keep a pool
around; `@gmod/bam` stores the promise on the `BamFile` and awaits it once per
chunk read, for the life of the file. The reap therefore cannot call `destroy()`
on their behalf. A destroyed pool throws out of `decompressBlocks`, which would
turn every open reader's next read into an error instead of degrading it to
inflating in process. The reap terminates only the workers, and the pool object
stays usable.

**Reaping reclaims mostly memory, not threads.** Each worker holds its own copy
of the inlined wasm bundle, whose `WebAssembly.Memory` only ever grows. Without
reaping, every pool that had inflated one deep long-read chunk held onto that
heap until the page went away, and a consumer that creates one pool per data
worker (below) has several pools. That heap was the largest thing an idle pool
kept.

**The pool never reaps a worker out from under an in-flight request.**
`decompressBlocks` clears the timer on entry, so no timer runs during a lone
request. Two overlapping requests need care: if the first rearmed the timer when
it settled, the timer would terminate the second request's workers mid-flight,
throwing away the second request's work and inflating it again on the calling
thread.

## A worker that fails never hangs a read

While a pool's workers are starting, on the first call to reach a shared pool or
the first after an idle reap, `decompressBlocks` inflates on the calling thread
and returns the same blocks, so no call waits for a worker to boot.

A worker that raises an `error` event or sends a reply this thread cannot
deserialize turns the pool off for good, and a request it had in flight goes
back to the calling thread. Every later call inflates there as well, which is
the path every consumer already runs without a pool. A decompression error that
a worker reports against its batch points to bad data rather than a broken
worker, so the call still rejects.

Before the fallback existed, the pool awaited every worker's `ready` and had no
listener for a worker's `error`, so one worker that never started left every
reader awaiting the pool pending for the life of the page. Firefox queues a
worker past `dom.workers.maxPerDomain` and raises nothing, and a machine short
of memory can fail to start the thread and raise only `error`. In JBrowse,
either case showed as a track stuck at "Downloading features 0%".

**The pool leaves a worker that never starts alone rather than timing it out.**
Firefox freezes the page when terminating a running worker lets it start one it
had queued past `dom.workers.maxPerDomain` (reproduced in Firefox Nightly build
20260414 with plain workers and no pool code). A queued worker is the usual
reason one never comes up, so terminating workers at a deadline would turn a
slow track into a frozen tab. If a queued worker starts later, the pool adopts
it then; until it does, calls inflate on the calling thread.

The pool calls `preventDefault()` on the `error` it handles. Left to propagate,
a pool worker's error reaches the scope that created it, and inside a data
worker that is the worker's global `onerror` — which a host reads as the data
worker dying, failing every call it has in flight.

## Sharing one pool across threads

When the consumer itself runs in a worker, as JBrowse's data workers do, each
one that calls `getSharedWorkerPool()` gets a separate set of pool workers,
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
bytes is the cost of the extra hop between threads, and it is small next to the
inflate.

## No cross-origin isolation required

The pool sends each worker's range as a **transferable**, putting the
`ArrayBuffer` in `postMessage`'s transfer list so that ownership moves and the
bytes are not structured-cloned. Transfers need no isolation, so the pool works
on an ordinary non-isolated origin, and results come back the same way. The pool
copies each range out of the input first, because transferring detaches the
buffer it came from and that buffer belongs to the caller (bam-js hands over the
filehandle read it is still holding). Across all the workers that is one pass
over the compressed bytes, the smaller side of the operation.

`SharedArrayBuffer` was the pool's original design, and we dropped it after
measuring it. It needs COOP/COEP, which most JBrowse installs cannot set, and
where they can, it gains nothing. `decompressAll` copies its input into the wasm
heap either way, so shared memory removes the host-side slice rather than the
boundary copy. Head to head in Chrome at 4 workers, a pooled `SAB` was at parity
with transferring, and a freshly allocated one was slower.

Without `SharedArrayBuffer`, the pool needs only a Worker and a Blob URL to
launch it from, so it works whether or not the page is cross-origin isolated.
