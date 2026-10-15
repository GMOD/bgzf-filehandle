# ADR 0001 — Keep the per-block temp `Vec` in `decompress_all`

Status: Superseded by `5b4ab22` (2026-07-25)

`decompress_all` now inflates each block straight into a preallocated output,
the change this ADR rejected.

- This ADR measured that change alone at 3-4% and called it noise.
- `5b4ab22` made it together with reusing one libdeflate `Decompressor` and one
  scratch buffer, measured the pair at about 2-4%, and kept it.
- `decompress_chunk_slice` inflates into that scratch buffer and copies out the
  trimmed slice, so the shared helper below no longer exists.

The benchmarking lesson at the end still holds.

## Context

`crate/src/lib.rs` `decompress_all` decompresses each BGZF block into a
freshly-allocated `Vec` via the shared helper `decompress_block_into`, then
copies it into the output with `output.extend_from_slice(&data)`.
`decompress_chunk_slice` uses the same helper, and appends only a _slice_ of
each block (it trims the first/last block to the requested virtual offsets).

The obvious optimization is to `resize` the output buffer in `decompress_all`
and `deflate_decompress` straight into `&mut output[start..]`, which removes the
per-block allocation and the extra copy.

## Decision

Do **not** apply it. Keep the single shared `decompress_block_into` helper.

## Consequences / rationale

- **No meaningful speedup.** Controlled A/B (each bundle in its own process,
  warmed, best-of-5): ~3-4% on a 5.2 MB file, ~2-3% on 518 KB, which is the
  noise floor. libdeflate's decode and the single wasm→JS boundary copy of the
  result `Vec<u8>` dominate the decompression cost, and removing an in-wasm copy
  changes neither.
- **Not cleaner.** `decompress_chunk_slice` still needs a per-block `Vec` (it
  appends only a slice), so the optimization can't replace the shared helper. It
  splits the helper into `parse_block` + `decompress_block_into` + an inlined
  `deflate_decompress` in `decompress_all`, so the header-relative slice and the
  decode call would appear in two places.
- **Churns the tracked wasm bundle** (`src/wasm/bgzf-wasm-inlined.js`) for no
  real gain.

## Benchmarking lesson

The first measurement showed "26% faster", an artifact of run order. The bundle
that ran first hit a cold CPU, before frequency scaling had ramped up, and
clocked ~100 ms against ~74 ms warm. **Always alternate run order** when
comparing bundles; a sequential cold→warm A/B measures warmup, not the code.
