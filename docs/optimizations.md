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
`.slice()`s out of the heap; the string path did not, which made every error
message the module produced fail to decode in a browser — a `WebAssembly.Memory`
buffer is resizable and `TextDecoder` refuses views over those. The fix is
applied in `crate/build-wasm.sh` after `wasm-bindgen` runs
([ADR 0002](../agent-docs/adr/0002-copy-out-of-wasm-memory-before-decoding-strings.md)),
and the failure is worth knowing because of how it presents: a `TypeError` about
a buffer type, naming no bgzf frame, that sorts by input file and invites
bisecting the data rather than the stack.

**Rejected: inflating straight into the output buffer.** Removing the per-block
temporary `Vec` in `decompress_all` looks free and measures at 3-4% on a 5.2MB
file, which is the noise floor — the cost is libdeflate's decode plus the single
boundary copy, and neither is touched. It also splits a helper
`decompress_chunk_slice` still needs, and churns the tracked wasm bundle
([ADR 0001](../agent-docs/adr/0001-decompress-into-output-buffer.md)). That ADR
also carries the benchmarking lesson that produced a spurious "26% faster":
**always alternate run order**, or a cold CPU measures frequency scaling rather
than code.

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

BGZF blocks inflate independently, so a chunk's blocks can be spread across Web
Workers. This is the largest lever left in the read path, since it is the only
one that attacks the 70-90% rather than the remainder: close to linear to about
four workers, 2.7-4.1x on this package's fixtures, and 1.95x end to end in a
real browser on a 22-view pan and zoom over 1000x long-read data.

The shape of the split is what keeps that from being eaten by overhead:

- **One range per worker, not one block per worker.** `scanBgzfBlocks` reads
  each block's `BSIZE` and `ISIZE` straight out of its header and trailer in JS,
  so the boundaries are known without decompressing anything. The blocks are
  then dealt out in contiguous runs, and each worker gets a single slice of the
  input and makes a single wasm call over it — the per-call overheads stay
  proportional to the worker count rather than to the block count.
- **Transferred, not copied.** Each worker's range is moved to it as an
  `ArrayBuffer`, which every browser allows on any page — hence no cross-origin
  isolation requirement. The range is copied out of the caller's buffer first,
  because transferring detaches the buffer it came from and that buffer belongs
  to the caller; across all workers that is one pass over the **compressed**
  bytes, the smaller side of the operation.
- **`SharedArrayBuffer` is deliberately not used.** It was the original design
  and it was measured out: it needs COOP/COEP, which most JBrowse installs
  cannot set, and it buys nothing where they can, because the wasm call copies
  its input into the wasm heap either way. Head to head in Chrome at 4 workers a
  pooled SAB was at parity with transferring, and a fresh one was slower.
- **Reassembly is views, not copies.** Each worker returns one buffer holding
  its whole range decompressed; the per-block results are `subarray` views into
  it, sized from the `ISIZE` values already scanned.
- **A single-block chunk skips the pool**, since it cannot be split and is not
  worth a round trip to a worker.
- **Idle workers are reaped after three minutes**, which reclaims mostly memory
  rather than threads: each worker holds its own copy of the inlined wasm bundle
  in a heap that only grows, so a pool that once inflated a deep long-read chunk
  keeps that heap until the page goes away. The reap is invisible to whoever
  holds the pool — consumers keep one for the life of a file, and a `destroy()`
  on their behalf would fail their next read instead of degrading it.

Nothing creates a pool implicitly: workers are a thread budget the application
owns. Lifecycle, sharing one pool across threads and driving it directly are in
[worker-pool.md](worker-pool.md).

## What the consumers add

The readers on top of this package cache what comes out of it, and that is the
optimization neither side can do alone — inflating twice is the thing worth
avoiding, and only the reader knows which bytes it has already asked for.
`@gmod/bam` and `@gmod/tabix` both keep parsed chunks keyed by virtual-offset
span, share reads that are still in flight, and take a `SharedBudget` so several
open files bound their retention together. Their query paths, and where this
package sits in them, are in
[bam-js's optimizations doc](https://github.com/GMOD/bam-js/blob/main/docs/optimizations.md)
and
[tabix-js's](https://github.com/GMOD/tabix-js/blob/main/docs/optimizations.md).
