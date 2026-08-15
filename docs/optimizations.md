# Optimizations

This package turns compressed bytes into decompressed bytes, and for the readers
built on it that is where most of a query's time goes. Inflating the BGZF blocks
accounts for 70-90% of the wall clock of a `@gmod/bam` query that finds nothing
in its cache, against a fraction of a millisecond for turning the result into
records
([bam-js ADR 0003](https://github.com/GMOD/bam-js/blob/main/agent-docs/adr/0003-where-bam-query-time-goes.md)).

The codec itself is already close to native, so nothing below is an attempt to
be cleverer than libdeflate. What is left to win is structural, and it comes
down to three questions:

- How many times does a byte get copied?
- How often is the wasm boundary crossed?
- How much of the file has to be read to answer for a range of it?

## The codec

[libdeflate](https://github.com/ebiggers/libdeflate) gives up streaming in
exchange for speed: it wants the whole input up front, and it wants to be told
the output size. That happens to be exactly the shape of BGZF, where every block
is an independent gzip member that records its own uncompressed length in its
trailer — which is also why htslib can be built against the same library.

The crate around it is thin ([`crate/src/lib.rs`](../crate/src/lib.rs)):
[libdeflater](https://github.com/adamkewley/libdeflater)'s Rust bindings, one
reused decompressor, and two exports — `decompress_all` for a buffer of blocks,
and `decompress_chunk_slice` for the same buffer trimmed to a virtual-offset
range and annotated with where each block landed. `@gmod/bbi` compiles the same
C library through the same bindings and shapes its crate for a different file
format, batching hundreds of separately-compressed blocks into one call and
fusing BigWig record parsing into it; that side is written up in
[bbi-js's wasm doc](https://github.com/GMOD/bbi-js/blob/main/docs/wasm.md).

Mean ms per file, lower is better, with all four arms asserted byte-identical
first (`pnpm benchonly inflate`):

| fixture                            | wasm libdeflate | pako | node zlib |
| ---------------------------------- | --------------- | ---- | --------- |
| paired.bam (84KB)                  | 0.92            | 2.8  | 1.2       |
| T_ko.2bit.gz (518KB)               | 3.9             | 8.5  | 2.5       |
| shortreads_300x.bam (5.1MB)        | 63              | 220  | 82        |
| chr22_nanopore_subset.bam (14.1MB) | 141             | 374  | 133       |

_Measured 2026-08-15 on an Intel i9-9880H under Node 24.13.0. Absolute times
track the machine and the Node version — node zlib in particular moves between
Node majors — so rerun rather than trust these if the ratios matter to a
decision._

That is two to three and a half times pako, and in the same range as the
platform's own zlib — sometimes ahead of it, sometimes behind — while running in
places where zlib is not available at all. There is no faster codec to reach
for, which is why the remaining levers are all structural ones.

pako stays a dependency for **plain** gzip only. A plain gzip stream has no
block structure to split and no uncompressed size to preallocate from, so
neither of libdeflate's requirements is met. `DecompressionStream` handles that
case where the host has one, and pako is the fallback where it does not.

## Why not `DecompressionStream` for everything?

Reasonable question, given the browser has had a built-in inflate since 2023 and
this package ships 65 KB of wasm to do the same job. We do use it — for the
plain gzip path just above. For BGZF it measures about half the speed.

It gets its best case here, too. BGZF is concatenated gzip members and a gzip
decoder decodes all of them, so a whole buffer goes through **one** call rather
than one per block. That matters a great deal: the API's cost is dominated by
per-call overhead, and this shape pays it once.

Best of three runs, mean ms per file, lower is better, all arms asserted
byte-identical first (`pnpm benchonly inflate`):

| fixture                            | wasm libdeflate | `DecompressionStream` | pako | node zlib |
| ---------------------------------- | --------------- | --------------------- | ---- | --------- |
| paired.bam (84KB)                  | 1.3             | 3.8                   | 3.7  | 1.4       |
| T_ko.2bit.gz (518KB)               | 3.6             | 9.8                   | 9.5  | 2.4       |
| shortreads_300x.bam (5.1MB)        | 77              | 143                   | 207  | 73        |
| chr22_nanopore_subset.bam (14.1MB) | 127             | 237                   | 394  | 127       |

So it is 1.9-2.9x slower than what ships, roughly level with pako on the small
fixtures and ahead of it on the large ones. This is a separate run from the
table above, and a noisier one: the `DecompressionStream` arm came in at ±8-19%
relative margin of error against ±4-7% for the others, and one run produced a
wasm number on the 5.1MB fixture more than twice the other two. Compare along a
row rather than between the two tables, and rerun before leaning on any single
figure.

Two things beyond the throughput:

- **It has only been baseline since May 2023** (Safari 16.4, Firefox 113). A
  library cannot drop the fallback, so pako ships either way and the bundle
  saving — the main argument for switching — does not arrive.
- **It cannot do `unzipChunkSlice`'s job.** Slicing a virtual offset range needs
  each member's boundaries in the output, and a single stream call returns one
  flat buffer with no record of where the members met.

A caveat worth stating plainly: these are Node numbers, where
`DecompressionStream` is zlib with little plumbing around it. A browser adds the
`Blob` → stream → `Response` path on top, so treat the column as the API's best
case rather than its typical one.

Sibling libraries land further from it than this one does, and the reason is
container shape rather than codec quality. `@gmod/bbi` and `@gmod/hic` store
each block as its own zlib stream, so the API can only be called once per block,
hundreds of times in a wide query. Dividing the timings through gives
[220-410 µs of overhead per call in bbi](https://github.com/GMOD/bbi-js/blob/main/docs/wasm.md#why-not-the-platforms-decompressionstream)
and
[300-720 µs in hic](https://github.com/GMOD/hic/blob/main/docs/optimizations.md#not-decompressionstream-either),
against roughly 20 µs for a wasm call. That leaves it 4-11x slower than wasm in
bbi and 5-6x in hic — and, unlike here, slower than pako as well.

## Crossing into wasm

Calling into wasm copies the whole input into the wasm heap, and that heap only
ever grows — it is never returned to the host for the life of the module. Two
consequences shape the API:

- **Non-BGZF input never reaches wasm.** `unzip` sniffs the gzip magic, the
  deflate method, the FEXTRA flag and the `BC` subfield id in JS first. Routing
  a plain gzip file through wasm just to have it rejected would permanently
  reserve that file's full size in a heap nothing can shrink.
- **The boundary is crossed once per chunk, not once per block.** A chunk
  spanning 300 blocks is a single call. Going finer would multiply the copy in
  and the copy out by the block count for no gain, since libdeflate is already
  decoding those blocks back to back inside the one call.

What comes back owns its bytes. wasm-bindgen's `Vec<u8>` path already
`.slice()`s out of the heap, but the string path did not, so in a browser every
error message the module produced failed to decode — a `WebAssembly.Memory`
buffer is resizable, and `TextDecoder` refuses views over those. It is patched
in `crate/build-wasm.sh` after `wasm-bindgen` runs
([ADR 0002](../agent-docs/adr/0002-copy-out-of-wasm-memory-before-decoding-strings.md)).
Worth knowing by its symptom: a `TypeError` naming a buffer type, with no bgzf
frame anywhere in it. That sorts by input file, so it invites bisecting the data
rather than the stack.

**Rejected: inflating straight into the output buffer.** Dropping the per-block
temporary `Vec` in `decompress_all` measures 3-4% on a 5.2MB file, which is the
noise floor — the cost is libdeflate's decode plus the one boundary copy, and
neither is touched. It also splits a helper that `decompress_chunk_slice` still
needs, and churns the tracked wasm bundle
([ADR 0001](../agent-docs/adr/0001-decompress-into-output-buffer.md)). That ADR
also carries the benchmarking lesson behind a spurious "26% faster" result:
**alternate the run order**, or a cold CPU ends up measuring frequency scaling
rather than code.

## Reading through a `.gzi`

`BgzfFilehandle` answers a read in uncompressed coordinates. Blocks sit adjacent
on disk, so every block a read touches falls in one contiguous byte range: a
read spanning 300 blocks is a single request and a single inflate, not 300 of
either. Around that:

- **Reads batch at 32MB of uncompressed output**, one request per batch. The cap
  is there for the wasm heap rather than for the network — without it, one
  enormous read materializes in that heap in full and leaves it that size.
- **`blockConcurrency` (default 10) caps how many batch requests are in
  flight.** Requests, not threads. Both this and the 32MB figure are reasoned
  rather than measured: no benchmark here compares them against other values, so
  treat them as sane defaults to tune from, not as an optimum anyone found.
- **The last batch over-reads by one maximum-size block.** A `.gzi` records
  where each block starts and not how long it is, so the end of the final block
  in a read can only be bounded, not known. `MAX_BGZF_BLOCK_SIZE` past the last
  block's offset is guaranteed to cover it, and costs at most 64KB on the one
  request — cheaper than a `stat()` round trip to find the real file length.
  Consumers doing their own chunk reads need the same trick, so the constant is
  exported.
- **The index is two parallel `Float64Array`s** of block offsets rather than an
  array of `[compressed, uncompressed]` pairs. A gzi for a large file runs to
  hundreds of thousands of entries, and one JS array object per entry costs
  roughly an order of magnitude more memory, plus the GC pressure that comes
  with it.
- **Locating a read is a binary search** over the uncompressed column, and the
  block range it resolves to is handed back as `subarray` views — no copy, and
  no per-read allocation of the entry list.

## The worker pool

BGZF blocks inflate independently, so a chunk's blocks can spread across Web
Workers. This is the only lever that attacks the 70-90% itself rather than the
remainder, and it scales close to linearly out to about four workers: 2.7-4.1x
on this package's fixtures, and 1.95x end to end in a browser over 1000x
long-read data.

Splitting work across threads usually gives most of that back in overhead. Two
choices are why this one does not:

- **One range per worker, not one block.** `scanBgzfBlocks` reads each block's
  `BSIZE` and `ISIZE` out of its header and trailer in JS, so boundaries are
  known without decompressing anything. Blocks are then dealt out in contiguous
  runs, one input slice and one wasm call per worker, so per-call overhead
  scales with worker count rather than block count — a chunk of 300 blocks
  across 4 workers costs 4 crossings, not 300.
- **Bytes move by transfer, not by copy**, in both directions. The handoff
  therefore costs the same whatever the range's size, which is what keeps a
  bigger chunk from paying more to be split. The one copy that does happen is a
  pass over the **compressed** bytes, the smaller side.

The mechanism behind that second one, the measurement that ruled out
`SharedArrayBuffer`, and how idle workers are reaped without the pool's holder
noticing, are all in [worker-pool.md](worker-pool.md) — along with pool
lifecycle, sizing, and sharing one pool across threads. Two things worth knowing
here: a single-block chunk skips the pool entirely, and nothing ever creates a
pool implicitly, because workers are a thread budget the application owns.

## What the consumers add

The readers cache what comes out of here, and that is the optimization neither
side can do alone: not inflating twice is the win, but only the reader knows
which bytes it has already asked for. `@gmod/bam` and `@gmod/tabix` both key
parsed chunks by virtual-offset span, share reads that are still in flight, and
take a `SharedBudget` so that several open files bound their retention together.
Their query paths, and where this package sits in them, are written up in
[bam-js's optimizations doc](https://github.com/GMOD/bam-js/blob/main/docs/optimizations.md)
and
[tabix-js's](https://github.com/GMOD/tabix-js/blob/main/docs/optimizations.md).
