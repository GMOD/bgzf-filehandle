# Optimizations

This package turns compressed bytes into decompressed bytes, and for the readers
built on it that is where most of a query's time goes — inflating the BGZF
blocks is 70-90% of the wall clock of a `@gmod/bam` query that finds nothing in
its cache, against a fraction of a millisecond for turning the result into
records
([bam-js ADR 0003](https://github.com/GMOD/bam-js/blob/main/agent-docs/adr/0003-where-bam-query-time-goes.md)).

The codec itself is already close to native, so nothing below is about being
cleverer than libdeflate. It is about how many times a byte is copied, how often
the wasm boundary is crossed, and how much of the file has to be read to answer
for a range of it.

## The codec

libdeflate gives up streaming for speed: it wants the whole input and the output
size in advance. That is exactly the shape of BGZF, where every block is an
independent gzip member that records its own uncompressed length in its trailer,
which is why htslib can be built against the same library. Mean ms per file,
lower better, all three arms asserted byte-identical first
(`pnpm benchonly inflate`):

| fixture                          | wasm libdeflate | pako | node zlib |
| -------------------------------- | --------------- | ---- | --------- |
| paired.bam (84KB)                | 1.3             | 3.8  | 1.7       |
| T_ko.2bit.gz (518KB)             | 4.8             | 9.4  | 2.6       |
| shortreads_300x.bam (5.1MB)      | 69              | 176  | 88        |
| chr22_nanopore_subset.bam (14MB) | 123             | 345  | 139       |

Two to three times pako, and in the same range as the platform's own zlib while
running somewhere zlib is not available at all. There is no faster codec to
reach for, which is why the remaining levers are all structural.

pako stays a dependency for **plain** gzip only. A plain gzip stream has no
block structure to split and no uncompressed size to preallocate from, so
neither of libdeflate's requirements is met; `DecompressionStream` handles it
where the host has one, and pako is the fallback.

## Crossing into wasm

Calling into wasm copies the whole input into the wasm heap, and that heap only
ever grows — it is never returned to the host for the life of the module. Two
consequences shape the API.

**Non-BGZF input never reaches wasm.** `unzip` sniffs the gzip magic, the
deflate method, the FEXTRA flag and the `BC` subfield id in JS first. Routing a
plain gzip file through wasm just to have it rejected would permanently reserve
that file's full size in a heap nothing can shrink.

**The boundary is crossed once per chunk, not once per block.** A chunk spanning
300 blocks is one call. Going finer would multiply the copy in and the copy out
by the block count for no gain, since libdeflate is already decoding the blocks
back to back inside that one call.

What comes back owns its bytes. wasm-bindgen's `Vec<u8>` path already
`.slice()`s out of the heap; the string path did not, so in a browser every
error message the module produced failed to decode — a `WebAssembly.Memory`
buffer is resizable and `TextDecoder` refuses views over those. Patched in
`crate/build-wasm.sh` after `wasm-bindgen` runs
([ADR 0002](../agent-docs/adr/0002-copy-out-of-wasm-memory-before-decoding-strings.md)).
Worth knowing by its symptom: a `TypeError` naming a buffer type and no bgzf
frame, which sorts by input file and invites bisecting the data rather than the
stack.

**Rejected: inflating straight into the output buffer.** Dropping the per-block
temporary `Vec` in `decompress_all` measures 3-4% on a 5.2MB file — the noise
floor, since the cost is libdeflate's decode plus the one boundary copy and
neither is touched. It also splits a helper `decompress_chunk_slice` still
needs, and churns the tracked wasm bundle
([ADR 0001](../agent-docs/adr/0001-decompress-into-output-buffer.md)). That ADR
carries the benchmarking lesson behind a spurious "26% faster": **alternate run
order**, or a cold CPU measures frequency scaling rather than code.

## Reading through a `.gzi`

`BgzfFilehandle` answers a read in uncompressed coordinates, and blocks sit
adjacent on disk, so every block a read touches is one contiguous byte range — a
read spanning 300 blocks is a single request and a single inflate, not 300 of
either.

Past 32MB of uncompressed output the read splits into batches of that size, one
request each. The cap is there for the heap above rather than for the network:
without it, one enormous read materializes in the wasm heap in full and leaves
it that size. `blockConcurrency` (default 10) caps how many of those batch
requests are in flight — requests, not threads.

The index behind that is held as two parallel `Float64Array`s of block offsets
rather than an array of `[compressed, uncompressed]` pairs. A gzi for a large
file runs to hundreds of thousands of entries, and one JS array object per entry
costs roughly an order of magnitude more memory, plus the GC pressure. Locating
a read is a binary search over the uncompressed column, and the block range it
resolves to is handed back as `subarray` views — no copy, and no per-read
allocation of the entry list.

## The worker pool

BGZF blocks inflate independently, so a chunk's blocks spread across Web
Workers. It is the only lever that attacks the 70-90% rather than the remainder:
close to linear to about four workers, 2.7-4.1x on this package's fixtures,
1.95x end to end in a browser over 1000x long-read data.

What keeps that from being eaten by overhead:

- **One range per worker, not one block.** `scanBgzfBlocks` reads each block's
  `BSIZE` and `ISIZE` out of its header and trailer in JS, so boundaries are
  known without decompressing. Blocks are dealt out in contiguous runs, one
  input slice and one wasm call per worker — overheads scale with worker count,
  not block count.
- **Ranges go over as transferables.** Each worker's slice is an `ArrayBuffer`
  in the `postMessage` transfer list, so ownership moves instead of the bytes
  being structured-cloned — and a transfer needs no cross-origin isolation, so
  this works on an ordinary page. Transferring detaches the source buffer, which
  belongs to the caller, so the slice is copied out first: one pass over the
  **compressed** bytes, the smaller side.
- **Results come back as transferables too**, one buffer per worker holding its
  whole range decompressed. Per-block results are `subarray` views into it,
  sized from the `ISIZE`s already scanned — no second copy.
- **`SharedArrayBuffer` is deliberately not used.** It was the original design
  and was measured out: it needs COOP/COEP, which most JBrowse installs cannot
  set, and buys nothing where they can, since the wasm call copies its input
  into the wasm heap either way. In Chrome at 4 workers a pooled SAB was at
  parity with transferring; a fresh one was slower.
- **A single-block chunk skips the pool** — nothing to split, and not worth the
  round trip.
- **Idle workers are reaped after three minutes**, which reclaims memory more
  than threads: each worker holds its own inlined wasm bundle in a heap that
  only grows. The reap is invisible to the pool's holder, since consumers keep a
  pool for the life of a file and a `destroy()` on their behalf would fail their
  next read rather than degrade it.

Nothing creates a pool implicitly: workers are a thread budget the application
owns. Lifecycle, sharing one pool across threads and driving it directly:
[worker-pool.md](worker-pool.md).

## What the consumers add

The readers cache what comes out of here, which is the optimization neither side
can do alone: not inflating twice is the win, and only the reader knows which
bytes it has already asked for. `@gmod/bam` and `@gmod/tabix` both key parsed
chunks by virtual-offset span, share reads still in flight, and take a
`SharedBudget` so several open files bound their retention together. Their query
paths, and where this package sits in them:
[bam-js's optimizations doc](https://github.com/GMOD/bam-js/blob/main/docs/optimizations.md)
and
[tabix-js's](https://github.com/GMOD/tabix-js/blob/main/docs/optimizations.md).
