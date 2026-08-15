# The worker pool

BGZF blocks inflate independently, so the blocks in one chunk can be spread
across Web Workers. Scaling is close to linear up to about four workers, and
inflating is where an indexed read spends its time — 70-90% of the wall clock of
a `@gmod/bam` query that finds nothing in its cache — which makes this the
single biggest speedup available to a consumer.

Nothing creates a pool implicitly. Workers are a thread budget the application
owns, and a library that quietly started four of them per file would be a bad
guest.

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
