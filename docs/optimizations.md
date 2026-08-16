# Optimizations

Inflating BGZF blocks is 70-90% of the wall clock of an uncached `@gmod/bam`
query
([bam-js ADR 0003](https://github.com/GMOD/bam-js/blob/main/agent-docs/adr/0003-where-bam-query-time-goes.md)),
so this package's decompression is where most of a reader's time goes.

The codec is already close to native, so nothing below tries to be cleverer than
libdeflate. What is left to win is structural:

- How many times does a byte get copied?
- How often does a call cross the wasm boundary?
- How much of the file must a reader fetch to answer for a range of it?

Two words below carry narrow meanings. A **BGZF block** is one gzip member of
the file — at most 64KB compressed, independently decodable, and the unit
everything here counts in; a bare "block" never means a deflate block. A
**chunk** is the virtual-offset range a BAM or tabix index resolves a query to,
covering a run of consecutive BGZF blocks and usually starting and ending
partway through the outer two. The [README](../README.md#terms) states both at
length.

## The codec

[libdeflate](https://github.com/ebiggers/libdeflate) gives up streaming for
speed: it wants the whole input up front and the output size told to it. That is
exactly the shape of BGZF, where every block is an independent gzip member
recording its own uncompressed length — which is also why htslib builds against
it.

The crate around it is thin ([`crate/src/lib.rs`](../crate/src/lib.rs)):
[libdeflater](https://github.com/adamkewley/libdeflater)'s bindings, one reused
decompressor, and two exports — `decompress_all` for a buffer of blocks, and
`decompress_chunk_slice` for the same buffer trimmed to a virtual-offset range
and annotated with where each block landed. `@gmod/bbi` compiles the same C
library through the same bindings for a different file format;
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
track the machine and Node version — node zlib in particular moves between Node
majors — so rerun rather than trust these._

Wasm libdeflate is two to three and a half times faster than pako and in the
same range as the platform's zlib, while running where zlib is not available at
all. With no faster codec to reach for, every remaining lever is structural.

pako stays a dependency for **plain** gzip, which meets neither of libdeflate's
requirements: no block structure to split, no uncompressed size to preallocate
from. That case goes to `DecompressionStream` where the host has one, and to
pako where it does not.

## Why not `DecompressionStream` for everything?

We do use it, but only on that plain gzip path; on BGZF it measures about half
the speed of wasm — even though BGZF is the friendliest container it could ask
for. A fixed per-call overhead dominates its cost, and a BGZF file is
concatenated gzip members, so an entire buffer goes through **one** call instead
of one per block. It pays its overhead once and still finishes second.

Best of three runs, mean ms per file, again after asserting all arms
byte-identical (`pnpm benchonly inflate`):

| fixture                            | wasm libdeflate | `DecompressionStream` | pako | node zlib |
| ---------------------------------- | --------------- | --------------------- | ---- | --------- |
| paired.bam (84KB)                  | 1.3             | 3.8                   | 3.7  | 1.4       |
| T_ko.2bit.gz (518KB)               | 3.6             | 9.8                   | 9.5  | 2.4       |
| shortreads_300x.bam (5.1MB)        | 77              | 143                   | 207  | 73        |
| chr22_nanopore_subset.bam (14.1MB) | 127             | 237                   | 394  | 127       |

That is 1.9-2.9x slower than what ships. Treat it as a sketch: this is a
separate, noisier run from the table above (±8-19% relative margin of error on
the `DecompressionStream` arm against ±4-7% for the others). Compare along a row
rather than between tables. These are also Node numbers, where the API is zlib
with little plumbing around it; a browser adds the `Blob` → stream → `Response`
path, so the column is its best case.

Throughput is not the only thing keeping it off the BGZF path:

- **Baseline only since May 2023** (Safari 16.4, Firefox 113). A library cannot
  drop the fallback, so pako ships either way and the bundle saving — the main
  argument for switching — never arrives.
- **It cannot do `unzipChunkSlice`'s job.** Slicing a virtual offset range needs
  each member's boundaries, and a single stream call returns one flat buffer
  with no record of where the members met.

Sibling libraries land further behind, and container shape explains it rather
than codec quality. `@gmod/bbi` and `@gmod/hic` store each block as its own zlib
stream, so a wide query reaches the API hundreds of times — working out to
[220-410 µs of overhead per call in bbi](https://github.com/GMOD/bbi-js/blob/main/docs/wasm.md#why-not-the-platforms-decompressionstream)
and
[300-720 µs in hic](https://github.com/GMOD/hic/blob/main/docs/optimizations.md#not-decompressionstream-either)
against roughly 20 µs for a wasm call. That leaves it 4-11x slower than wasm in
bbi and 5-6x in hic, and, unlike here, slower than pako too.

## Crossing into wasm

Calling into wasm copies the whole input into the wasm heap, and that heap only
ever grows. Two consequences shape the API:

- **Non-BGZF input never reaches wasm.** `unzip` sniffs the gzip magic, the
  deflate method, the FEXTRA flag and the `BC` subfield id in JS first. Routing
  a plain gzip file through wasm just to have it rejected would permanently
  reserve that file's full size.
- **Each chunk crosses the boundary once, not each block.** A chunk spanning 300
  blocks makes a single call; going finer would multiply both copies by the
  block count for no gain, since libdeflate already decodes those blocks back to
  back inside the one call.

Everything coming back out has to own its bytes. wasm-bindgen's `Vec<u8>` path
already `.slice()`s out of the heap, but its string path did not, so in a
browser every error message the module produced failed to decode: a
`WebAssembly.Memory` buffer is resizable, and `TextDecoder` refuses views over
those. `crate/build-wasm.sh` patches it after `wasm-bindgen` runs
([ADR 0002](../agent-docs/adr/0002-copy-out-of-wasm-memory-before-decoding-strings.md)).
The symptom misleads badly, so learn it: a `TypeError` naming a buffer type,
with no bgzf frame in the stack, appearing and disappearing with the input file
rather than the code — which sends you bisecting the data instead of the
decoder.

**Rejected: inflating straight into the output buffer.** Dropping the per-block
temporary `Vec` in `decompress_all` measures 3-4% on a 5.2MB file, the noise
floor — libdeflate's decode plus the one boundary copy make up the cost, and the
change touches neither. It also splits a helper `decompress_chunk_slice` needs
and churns the tracked wasm bundle
([ADR 0001](../agent-docs/adr/0001-decompress-into-output-buffer.md)). That ADR
carries the benchmarking lesson behind a spurious "26% faster" result:
**alternate the run order**, or a cold CPU measures frequency scaling rather
than code.

## Reading through a `.gzi`

`BgzfFilehandle` answers a read in uncompressed coordinates. BGZF blocks sit
adjacent on disk, so every block a read touches falls in one contiguous byte
range: a read spanning 300 blocks is a single request and a single inflate. The
rest builds on that:

- **Reads batch at 32MB of uncompressed output**, one request per batch. The cap
  serves the wasm heap rather than the network — without it, one enormous read
  materializes in that heap and leaves it that size.
- **`blockConcurrency` (default 10) caps how many batch requests are in
  flight.** Requests, not threads. Neither it nor the 32MB figure rests on a
  benchmark, so treat them as defaults to tune from rather than an optimum.
- **The last batch over-reads by one maximum-size block.** A `.gzi` records
  where each block starts, not how long it is, so a reader can bound the end of
  the final block but never know it. Reaching `MAX_BGZF_BLOCK_SIZE` past that
  offset always covers it and costs at most 64KB — cheaper than a `stat()` round
  trip. Consumers doing their own chunk reads need the same trick, so the
  package exports the constant.
- **The index is two parallel `Float64Array`s** rather than an array of
  `[compressed, uncompressed]` pairs. A gzi for a large file runs to hundreds of
  thousands of entries, and one JS array object per entry costs roughly an order
  of magnitude more memory plus the GC pressure.
- **Locating a read is a binary search** over the uncompressed column, handing
  back the block range as `subarray` views — no copy, no per-read allocation.

## The worker pool

BGZF blocks inflate independently, so a chunk can spread its blocks across Web
Workers — the only lever here aimed at the inflate cost itself rather than the
work around it. At its default four workers a BAM chunk runs 1.8-2.1x once past
a couple of MB uncompressed, which is 0.9s off a 1.8s inflate at 373MB, and
jbrowse-components measures 1.95x end to end in a browser over 1000x long-read
data. Scaling is sublinear from the first worker, a chunk has to reach four to
eight blocks before it pays at all, and a chunk that decompresses ~18x never
gets past ~1.0x. The tables, and the serial reassembly that eats the difference,
are in [worker-pool.md](worker-pool.md#what-it-is-worth).

Threading usually hands most of a gain like that back in overhead. Two choices
keep this pool from doing so:

- **One range per worker, not one block.** `scanBgzfBlocks` reads each block's
  `BSIZE` and `ISIZE` out of its header and trailer in JS, learning every
  boundary without decompressing. The pool deals blocks out in contiguous runs,
  one input slice and one wasm call per worker, so per-call overhead scales with
  worker count rather than block count — 300 blocks across 4 workers costs 4
  crossings, not 300.
- **Bytes move by transfer, not by copy**, in both directions, so the handoff
  costs the same whatever the range's size. The one copy that happens is a pass
  over the **compressed** bytes, the smaller side.

[worker-pool.md](worker-pool.md) explains how that transfer works, gives the
measurement that ruled out `SharedArrayBuffer`, and covers pool lifecycle,
sizing, sharing across threads, and reaping idle workers. Two things to carry
in: a single-block chunk skips the pool entirely, and nothing creates a pool
implicitly, since workers are a thread budget the application owns.

## What the consumers add

The readers cache what comes out of here — the optimization neither side can do
alone, since only the reader knows which bytes it has already asked for.
`@gmod/bam` and `@gmod/tabix` both key parsed chunks by virtual-offset span,
share reads still in flight, and take a `SharedBudget` so several open files
bound their retention together.
[bam-js's optimizations doc](https://github.com/GMOD/bam-js/blob/main/docs/optimizations.md)
and
[tabix-js's](https://github.com/GMOD/tabix-js/blob/main/docs/optimizations.md)
walk through those query paths.
