# The worker pool

BGZF blocks are independently inflatable, so a chunk's blocks can be spread
across Web Workers. This scales close to linearly up to about four workers, and
decompression is the dominant cost of an indexed read — 70-90% of a cold BAM
query — so it is the largest single lever available to a consumer.

Nothing creates a pool implicitly. Workers are a thread budget the application
owns, and a library that quietly started four of them per file would be a bad
guest.

## Getting a pool

```typescript
import { getSharedWorkerPool } from '@gmod/bgzf-filehandle'

const pool = await getSharedWorkerPool() // undefined if workers are unavailable
```

One process-wide pool, created on first call and reused afterwards. It resolves
to `undefined` only where Workers cannot be launched at all — node, or any host
without `Worker` plus `Blob` URLs — so the same call site works everywhere and
callers can pass the result straight through to a sequential fallback. A browser
that is _not_ cross-origin isolated is not such a host; see below.

- `getSharedWorkerPool(numWorkers?)` — the shared pool. `numWorkers` defaults to
  `Math.min(navigator.hardwareConcurrency, 4)`, and only applies to the call
  that actually creates it.
- `createBgzfWorkerPool(numWorkers?, workerUrl?)` — an unshared pool you own,
  for picking the worker count per pool or controlling the lifecycle yourself.
  It **throws** where `getSharedWorkerPool` returns `undefined`.
- `destroySharedWorkerPool()` — terminate the shared pool's workers. A later
  `getSharedWorkerPool()` builds a fresh one.

## Using it

Pass it to `unzipChunkSlice`:

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

## Sharing one pool across threads

When the consumer itself runs in a worker — as JBrowse's data workers do — each
one calling `getSharedWorkerPool()` gets its own set of pool workers, which
multiplies the thread count by the number of consumers. `BgzfWorkerPoolHost` and
`BgzfWorkerPoolClient` let several threads drive a single pool over a
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

The client copies the compressed input once so the transfer detaches a buffer it
owns rather than the caller's — a second pass over the compressed bytes that the
direct pool doesn't pay. That's the price of the hop, and it is small against
the inflate.

## No cross-origin isolation required

Each worker's range is **transferred** to it as an `ArrayBuffer` — a zero-copy
move every browser allows on any page — so the pool works on an ordinary
non-isolated origin.

`SharedArrayBuffer` is deliberately not used. It was the original design and was
measured out. It needs COOP/COEP, which most JBrowse installs cannot set, and it
buys nothing when they can: `decompressAll` copies its input into the wasm heap
either way, so shared memory removes the host-side slice rather than the
boundary copy. Head to head in Chrome at 4 workers, a pooled SAB was at parity
with transferring and a freshly allocated one was slower.

That change is also what made the feature generally available — availability
used to be gated on `SharedArrayBuffer` existing, i.e. on cross-origin
isolation. The real requirement is only a Worker and a Blob URL to launch it
from.
