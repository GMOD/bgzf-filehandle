# ADR 0002 — Copy out of wasm memory before decoding strings

Status: Accepted

## Context

wasm-bindgen generates `getStringFromWasm0` for every string crossing from Rust
to JS:

```js
function getStringFromWasm0(ptr, len) {
  return cachedTextDecoder.decode(
    getUint8ArrayMemory0().subarray(ptr, ptr + len),
  )
}
```

`getUint8ArrayMemory0()` is a view over `wasm.memory.buffer`, and
[`WebAssembly.Memory`'s buffer is a **resizable** `ArrayBuffer`](https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Memory/Memory).
Browsers reject a view over one:

```
TypeError: Failed to execute 'decode' on 'TextDecoder':
The provided ArrayBuffer value must not be resizable
```

The only strings this crate returns to JS are **error messages**, built with
`Error(...)` at the two `getStringFromWasm0` call sites, so in a browser the
module could not report any of its errors. "invalid bgzf header" reached the
caller as the TypeError above.

Two properties of the failure made it slow to diagnose.

- **The error names a type, not a place.** A consumer sees a decoder complaint
  with no bgzf or tabix frame in it, so the natural read is "something upstream
  handed us a bad buffer", and the search starts nowhere near the real fault.
- **The failure looks data-dependent.** A file that never trips a wasm error
  path decodes fine, so the failure appears with some inputs and not others,
  which invites file-level bisection. One downstream investigation eliminated
  eight hypotheses that way (file size, window size, compressor, index flavour,
  CDN vs local server, bundler version) before anyone found the masking.

wasm-bindgen already emits `getArrayU8FromWasm0(r0, r1).slice()` on the
`Vec<u8>` return path, so decompressed data always owned its bytes and never hit
this error. The fix applies the same copy to strings.

## Decision

Copy before decoding, with `.subarray(ptr, ptr + len).slice()`.

Apply the copy in `crate/build-wasm.sh`, immediately after the `wasm-bindgen`
invocation, **not** by editing its output in `crate/pkg/` directly. The same
script regenerates that directory, so the next build overwrites a hand-edit
without warning. The patch is idempotent, and exits non-zero if it matches
neither the unpatched nor the already-patched code, so a wasm-bindgen upgrade
that changes the emitted code fails the build rather than shipping without the
fix.

## Consequences

- Each string costs one extra copy. The strings are error messages, on error
  paths only, so the cost is not measurable and no data path pays it.
- `test/resizable-buffer.test.ts` asserts two things: that `unzip()` on non-BGZF
  input rejects with its own message rather than with `/resizable/`, and,
  separately, that **node's `TextDecoder` accepts a view over a resizable buffer
  while browsers do not**.
- Keep the second assertion, because node's behavior is why no existing test
  caught the bug, or could have. vitest, jest and jsdom all use node's decoder,
  so a suite that exercises every decompress path still passes while every
  browser consumer breaks. A green suite here says nothing about
  resizable-buffer handling, so reproduce that class of bug in a real browser.

## Scope beyond this repo

`getStringFromWasm0` is wasm-bindgen's own emitted code, unmodified, so any
package shipping a wasm-bindgen module has the same hazard, including the
sibling inlined-wasm bundles described in `../../../CLAUDE.md` (`bbi-js`,
`cram-js`). Downstream, `@gmod/tabix`, `@gmod/bam` and JBrowse inherit it
through this package, so before this fix none of them could report a wasm error
in a browser.

Safari's 2 GB `TextDecoder` limit produces `RangeError: Bad value` at the same
call site
([wasm-bindgen#4185](https://github.com/rustwasm/wasm-bindgen/discussions/4185)).
Every string from Rust to JS passes through `getStringFromWasm0`, and in both
bugs its failure looked like a fault in another layer. Patch it here rather than
wait for wasm-bindgen to change.
