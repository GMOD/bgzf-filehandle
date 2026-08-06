import { expect, test } from 'vitest'

import { unzip } from '../src/unzip.ts'

// Browsers back WebAssembly.Memory with a RESIZABLE ArrayBuffer, and
// TextDecoder.decode rejects a view over one:
//
//   TypeError: Failed to execute 'decode' on 'TextDecoder':
//   The provided ArrayBuffer value must not be resizable
//
// Node's TextDecoder accepts it, so nothing in this suite would notice on its
// own — the tests would pass while every browser consumer broke. These two make
// the rule explicit instead.

test('node TextDecoder is lenient, which is why the checks below are needed', () => {
  const resizable = new ArrayBuffer(8, { maxByteLength: 64 })
  expect(resizable.resizable).toBe(true)
  const view = new Uint8Array(resizable)
  view.set([104, 101, 108, 108, 111])
  // Passes here, throws in a browser. That asymmetry is the whole hazard.
  expect(new TextDecoder().decode(view.subarray(0, 5))).toBe('hello')
  // ...and a copy is accepted by both.
  expect(view.subarray(0, 5).slice().buffer.resizable).toBeFalsy()
})

// Every string this crate returns to JS is an error message, routed through
// wasm-bindgen's getStringFromWasm0. If that decodes a wasm-memory view rather
// than a copy, the module cannot report its own errors in a browser: the real
// message is replaced by the TypeError above. crate/build-wasm.sh patches the
// generated glue to copy; this asserts the error text survives the trip.
test('an error from wasm arrives as its own message, not a decoder failure', async () => {
  const notBgzf = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
  await expect(unzip(notBgzf)).rejects.toThrow(/bgzf|gzip/i)
  await expect(unzip(notBgzf)).rejects.not.toThrow(/resizable/i)
})
