# ADR 0001 — Keep the per-block temp `Vec` in `decompress_all`

Status: Accepted (rejected the optimization)

## Context

`crate/src/lib.rs` `decompress_all` decompresses each BGZF block into a
freshly-allocated `Vec` via the shared helper `decompress_block_into`, then
copies it into the output with `output.extend_from_slice(&data)`. The same
helper is reused by `decompress_chunk_slice`, which only appends a *slice* of
each block (it trims the first/last block to the requested virtual offsets).

The obvious optimization: in `decompress_all`, `resize` the output buffer and
`deflate_decompress` straight into `&mut output[start..]`, removing the
per-block allocation and the extra copy.

## Decision

Do **not** apply it. Keep the single shared `decompress_block_into` helper.

## Consequences / rationale

- **No meaningful speedup.** Controlled A/B (each bundle in its own process,
  warmed, best-of-5): ~3-4% on a 5.2 MB file, ~2-3% on 518 KB — at the noise
  floor. Decompression cost is dominated by libdeflate's decode plus the single
  wasm→JS boundary copy of the result `Vec<u8>`; neither is touched by removing
  an in-wasm copy.
- **Not cleaner.** `decompress_chunk_slice` still needs a per-block `Vec` (it
  appends only a slice), so the optimization can't replace the shared helper —
  it splits it into `parse_block` + `decompress_block_into` + an inlined
  `deflate_decompress` in `decompress_all`. The header-relative slice and decode
  call then live in two places. The single-helper original reads better.
- **Churns the tracked wasm bundle** (`src/wasm/bgzf-wasm-inlined.js`) for no
  real gain.

## Benchmarking lesson

The first measurement showed "26% faster" — a pure artifact. The bundle that
ran first hit a cold CPU (frequency scaling not ramped) and clocked ~100 ms vs
~74 ms warm. **Always alternate run order** when comparing bundles; a sequential
cold→warm A/B measures warmup, not the code.
