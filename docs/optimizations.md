# Optimizations

Inflating BGZF blocks is 70-90% of the wall clock of an uncached `@gmod/bam`
query
([bam-js ADR 0003](https://github.com/GMOD/bam-js/blob/main/agent-docs/architecture-decision-records/0003-where-bam-query-time-goes.md)),
so this package's decompression is where most of a reader's time goes.

The codec already runs close to native speed, so the optimizations below change
the structure around it rather than the decoding. They address three questions:

- How many times does a byte get copied?
- How often does a call cross the wasm boundary?
- How much of the file must a reader fetch to read one range of it?

## Terms

- **BGZF block**: one gzip member of a bgzip file, at most 64KB compressed. A
  decoder can inflate it without the others. A bare "block" always means this,
  never a deflate block
- **Virtual offset**: `{blockPosition, dataPosition}`, a BGZF block's file
  offset plus a position in its decompressed bytes
- **Chunk**: `{minv, maxv}`, a range between two virtual offsets, as a BAM or
  tabix index returns them. A chunk spans consecutive BGZF blocks and usually
  starts and ends partway through the first and last

## The codec

[libdeflate](https://github.com/ebiggers/libdeflate) gives up streaming for
speed, so it needs the whole input up front and the output size in advance. BGZF
meets both requirements, because every block is an independent gzip member whose
trailer records its uncompressed length, and htslib builds against libdeflate
for the same reason.

The crate around libdeflate is thin ([`crate/src/lib.rs`](../crate/src/lib.rs)).
It contains [libdeflater](https://github.com/adamkewley/libdeflater)'s bindings,
one reused decompressor, and two exports: `decompress_all` for a buffer of
blocks, and `decompress_chunk_slice` for the same buffer trimmed to a
virtual-offset range and annotated with each block's compressed and decompressed
position. `@gmod/bbi` compiles the same C library through the same bindings for
a different file format;
[bbi-js's wasm doc](https://github.com/GMOD/bbi-js/blob/main/docs/wasm.md)
covers that side.

Mean ms per file, lower is better, after asserting all four arms byte-identical
(`pnpm benchonly inflate`):

| fixture                            | wasm libdeflate | pako | node zlib |
| ---------------------------------- | --------------- | ---- | --------- |
| paired.bam (84KB)                  | 0.92            | 2.8  | 1.2       |
| T_ko.2bit.gz (518KB)               | 3.9             | 8.5  | 2.5       |
| shortreads_300x.bam (5.1MB)        | 63              | 220  | 82        |
| chr22_nanopore_subset.bam (14.1MB) | 141             | 374  | 133       |

_Measured 2026-08-15 on an Intel i9-9880H under Node 24.13.0. Absolute times
depend on the machine and the Node version (node zlib's especially, which
changes between Node majors), so rerun the benchmark rather than trust these._

Wasm libdeflate is two to three and a half times faster than pako and in the
same range as the platform's zlib, and it runs where zlib is not available at
all.

pako stays a dependency for **plain** gzip, which has no BGZF framing to split
the input on and no uncompressed size to preallocate from, so it meets neither
of libdeflate's requirements. `unzip` decodes plain gzip with
`DecompressionStream` where the host has one, and with pako where it does not.

## Why not `DecompressionStream` for everything?

We use `DecompressionStream` on the plain gzip path only. On BGZF it runs at
about half the speed of wasm, although BGZF is its best case. A fixed per-call
overhead dominates its cost, and a BGZF file is concatenated gzip members, so a
whole buffer decodes in **one** call rather than one per block.
`DecompressionStream` pays the overhead once and still loses to wasm.

Best of three runs, mean ms per file, again after asserting all arms
byte-identical (`pnpm benchonly inflate`):

| fixture                            | wasm libdeflate | `DecompressionStream` | pako | node zlib |
| ---------------------------------- | --------------- | --------------------- | ---- | --------- |
| paired.bam (84KB)                  | 1.3             | 3.8                   | 3.7  | 1.4       |
| T_ko.2bit.gz (518KB)               | 3.6             | 9.8                   | 9.5  | 2.4       |
| shortreads_300x.bam (5.1MB)        | 77              | 143                   | 207  | 73        |
| chr22_nanopore_subset.bam (14.1MB) | 127             | 237                   | 394  | 127       |

`DecompressionStream` is 1.9-2.9x slower than the wasm build that ships. Treat
these numbers as a sketch, because they come from a separate, noisier run than
the table above (±8-19% relative margin of error on the `DecompressionStream`
arm against ±4-7% for the others). Compare along a row rather than between
tables. These are also Node numbers, where the API is zlib with little code
around it; a browser adds the `Blob` → stream → `Response` path, so the
`DecompressionStream` column shows its best case.

We keep `DecompressionStream` off the BGZF path for two more reasons:

- **It has been baseline only since May 2023** (Safari 16.4, Firefox 113). A
  library has to keep a fallback, so pako ships either way, and the bundle
  saving, which is the main argument for switching, never happens.
- **It cannot replace `unzipChunkSlice`.** Slicing a virtual offset range needs
  each member's boundaries, and a single stream call returns one flat buffer
  with no record of where the members met.

In `@gmod/bbi` and `@gmod/hic`, `DecompressionStream` falls further behind,
because each of their blocks is a separate zlib stream, so a wide query calls
the API hundreds of times. Each call costs
[220-410 µs of overhead in bbi](https://github.com/GMOD/bbi-js/blob/main/docs/wasm.md#why-not-the-platforms-decompressionstream)
and
[300-720 µs in hic](https://github.com/GMOD/hic/blob/main/docs/optimizations.md#not-decompressionstream-either),
against roughly 20 µs for a wasm call. `DecompressionStream` therefore comes out
4-11x slower than wasm in bbi and 5-6x in hic, and, unlike here, slower than
pako too.

## Crossing into wasm

Calling into wasm copies the whole input into the wasm heap, and that heap only
ever grows. Three rules in the API follow from that:

- **Non-BGZF input never reaches wasm.** `unzip` sniffs the gzip magic, the
  deflate method, the FEXTRA flag and the `BC` subfield id in JS first. If
  `unzip` sent a plain gzip file through wasm only for wasm to reject it, the
  heap would grow by the file's full size and stay that size.
- **A chunk within the 8 MiB cap below crosses the boundary once, not once per
  block.** A chunk spanning 300 blocks makes a single call. One call per block
  would multiply the copies across the boundary by the block count for no gain,
  since libdeflate already decodes those blocks back to back inside the one
  call.
- **No call holds more than 8 MiB.** `MAX_INFLATE_BYTES` caps a call's
  compressed plus inflated bytes. A larger chunk, whole file or worker range
  goes through as runs of consecutive blocks under the cap, so the heap stays at
  9-15 MiB. Without the cap, one window of 1000x long reads reserved 262 MiB for
  the life of the process, and `unzip` of a 606 MiB tabix index reserved 611
  MiB.
  - `unzipChunkSegments` returns one segment per run, with no extra copy.
  - `unzip` fills a preallocated output run by run, which costs one extra copy
    past the cap.

Everything wasm returns to JS has to own its bytes. wasm-bindgen's `Vec<u8>`
path already `.slice()`s out of the heap, but its string path decodes a view
over the heap directly. A `WebAssembly.Memory` buffer is resizable, and
browsers' `TextDecoder` refuses views over resizable buffers, so unpatched,
every error message the module produced failed to decode in a browser.
`crate/build-wasm.sh` patches the string path after `wasm-bindgen` runs
([ADR 0002](../agent-docs/architecture-decision-records/0002-copy-out-of-wasm-memory-before-decoding-strings.md)).
Learn the symptom, because it points away from the cause. It is a `TypeError`
naming a buffer type, with no bgzf frame in the stack, that appears and
disappears with the input file rather than the code, so you end up bisecting the
data instead of the decoder.

**Rejected: inflating straight into the output buffer.** Without the per-block
temporary `Vec` in `decompress_all`, a 5.2MB file decoded 3-4% faster, which is
the noise floor. libdeflate's decode and the one boundary copy make up the cost,
and the change touches neither. The change also splits a helper that
`decompress_chunk_slice` needs, and churns the tracked wasm bundle
([ADR 0001](../agent-docs/architecture-decision-records/0001-decompress-into-output-buffer.md)).
The ADR also explains a spurious "26% faster" result and the lesson from it:
**alternate the run order**, or the benchmark measures CPU frequency scaling
rather than code.

## Reading through a `.gzi`

`BgzfFilehandle` answers a read in uncompressed coordinates. BGZF blocks sit
adjacent on disk, so every block a read touches falls in one contiguous byte
range, and a read spanning 300 blocks is a single request and a single inflate.
The rest of the read path works as follows:

- **Reads batch at 32MB of uncompressed output**, one request per batch, so an
  enormous read streams through in pieces. `unzip` keeps the wasm heap itself
  under `MAX_INFLATE_BYTES` per call.
- **`blockConcurrency` (default 10) caps how many batch requests are in
  flight**; it limits requests, not threads. Neither it nor the 32MB batch size
  rests on a benchmark, so treat them as defaults to tune from rather than an
  optimum.
- **The last batch over-reads by one maximum-size block.** A `.gzi` records
  where each block starts, not how long it is, so a reader can bound the end of
  the final block but never know it. Reading `MAX_BGZF_BLOCK_SIZE` bytes past
  the final block's start always covers that block, at a cost of at most 64KB,
  which is cheaper than a `stat()` round trip. Consumers doing their own chunk
  reads need the same over-read, so the package exports the constant.
- **The index is two parallel `Float64Array`s** rather than an array of
  `[compressed, uncompressed]` pairs. A gzi for a large file runs to hundreds of
  thousands of entries, and one JS array object per entry costs roughly an order
  of magnitude more memory plus the GC pressure.
- **`BgzfFilehandle` locates a read by binary search** over the uncompressed
  column, and returns the block range as `subarray` views, with no copy and no
  per-read allocation.

## The worker pool

The worker pool spreads a chunk's blocks across Web Workers, and is the only
optimization here that reduces the inflate cost itself. At its default four
workers, a BAM chunk past a couple of MB uncompressed inflates 1.8-2.1x faster,
which takes 0.9s off a 1.8s inflate at 373MB. The tables and their caveats are
in [worker-pool.md](worker-pool.md#what-it-is-worth).

Threading usually loses most of a gain like that to overhead. The pool limits
its overhead with two design choices:

- **One range per worker, not one block.** `scanBgzfBlocks` reads each block's
  `BSIZE` and `ISIZE` out of its header and trailer in JS, so it finds every
  boundary without decompressing. The pool deals blocks out in contiguous runs,
  one input slice and one wasm call per worker, so per-call overhead scales with
  worker count rather than block count — 300 blocks across 4 workers costs 4
  crossings, not 300.
- **Bytes move by transfer, not by copy**, in both directions, so the handoff
  costs the same whatever the range's size. The one copy that happens is a pass
  over the **compressed** bytes, the smaller side.

A chunk under `POOL_MIN_DECOMPRESSED_BYTES` (0.4MB inflated) skips the pool
entirely.

## `@gmod/bam` and `@gmod/tabix` cache what this package returns

Only a reader knows which bytes it has already asked for, so caching lives
there. `@gmod/bam` caches each chunk's parsed records and `@gmod/tabix` each
decompressed chunk. Both share reads still in flight and take a `SharedBudget`,
so several open files share one limit on what they cache.
[bam-js's optimizations doc](https://github.com/GMOD/bam-js/blob/main/docs/optimizations.md)
and
[tabix-js's](https://github.com/GMOD/tabix-js/blob/main/docs/optimizations.md)
walk through those query paths.
