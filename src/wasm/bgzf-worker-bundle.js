"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/wasm/bgzf_wasm_bg.js
  var bgzf_wasm_bg_exports = {};
  __export(bgzf_wasm_bg_exports, {
    ChunkSliceResult: () => ChunkSliceResult,
    DecompressResult: () => DecompressResult,
    __wbg_Error_8c4e43fe74559d73: () => __wbg_Error_8c4e43fe74559d73,
    __wbg___wbindgen_throw_be289d5034ed271b: () => __wbg___wbindgen_throw_be289d5034ed271b,
    __wbg_set_wasm: () => __wbg_set_wasm,
    decompress_all: () => decompress_all,
    decompress_block: () => decompress_block,
    decompress_chunk_slice: () => decompress_chunk_slice
  });
  var ChunkSliceResult = class _ChunkSliceResult {
    static __wrap(ptr) {
      ptr = ptr >>> 0;
      const obj = Object.create(_ChunkSliceResult.prototype);
      obj.__wbg_ptr = ptr;
      ChunkSliceResultFinalization.register(obj, obj.__wbg_ptr, obj);
      return obj;
    }
    __destroy_into_raw() {
      const ptr = this.__wbg_ptr;
      this.__wbg_ptr = 0;
      ChunkSliceResultFinalization.unregister(this);
      return ptr;
    }
    free() {
      const ptr = this.__destroy_into_raw();
      wasm.__wbg_chunksliceresult_free(ptr, 0);
    }
    /**
     * @returns {Uint8Array}
     */
    get buffer() {
      try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.chunksliceresult_buffer(retptr, this.__wbg_ptr);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v1 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export(r0, r1 * 1, 1);
        return v1;
      } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
      }
    }
    /**
     * @returns {Float64Array}
     */
    get cpositions() {
      try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.chunksliceresult_cpositions(retptr, this.__wbg_ptr);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v1 = getArrayF64FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export(r0, r1 * 8, 8);
        return v1;
      } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
      }
    }
    /**
     * @returns {Float64Array}
     */
    get dpositions() {
      try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.chunksliceresult_dpositions(retptr, this.__wbg_ptr);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v1 = getArrayF64FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export(r0, r1 * 8, 8);
        return v1;
      } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
      }
    }
  };
  if (Symbol.dispose) ChunkSliceResult.prototype[Symbol.dispose] = ChunkSliceResult.prototype.free;
  var DecompressResult = class _DecompressResult {
    static __wrap(ptr) {
      ptr = ptr >>> 0;
      const obj = Object.create(_DecompressResult.prototype);
      obj.__wbg_ptr = ptr;
      DecompressResultFinalization.register(obj, obj.__wbg_ptr, obj);
      return obj;
    }
    __destroy_into_raw() {
      const ptr = this.__wbg_ptr;
      this.__wbg_ptr = 0;
      DecompressResultFinalization.unregister(this);
      return ptr;
    }
    free() {
      const ptr = this.__destroy_into_raw();
      wasm.__wbg_decompressresult_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get bytes_read() {
      const ret = wasm.decompressresult_bytes_read(this.__wbg_ptr);
      return ret >>> 0;
    }
    /**
     * @returns {Uint8Array}
     */
    get data() {
      try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.decompressresult_data(retptr, this.__wbg_ptr);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v1 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export(r0, r1 * 1, 1);
        return v1;
      } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
      }
    }
  };
  if (Symbol.dispose) DecompressResult.prototype[Symbol.dispose] = DecompressResult.prototype.free;
  function decompress_all(input) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      const ptr0 = passArray8ToWasm0(input, wasm.__wbindgen_export2);
      const len0 = WASM_VECTOR_LEN;
      wasm.decompress_all(retptr, ptr0, len0);
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
      var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
      if (r3) {
        throw takeObject(r2);
      }
      var v2 = getArrayU8FromWasm0(r0, r1).slice();
      wasm.__wbindgen_export(r0, r1 * 1, 1);
      return v2;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  function decompress_block(input) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      const ptr0 = passArray8ToWasm0(input, wasm.__wbindgen_export2);
      const len0 = WASM_VECTOR_LEN;
      wasm.decompress_block(retptr, ptr0, len0);
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
      if (r2) {
        throw takeObject(r1);
      }
      return DecompressResult.__wrap(r0);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  function decompress_chunk_slice(input, min_block_position, min_data_position, max_block_position, max_data_position) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      const ptr0 = passArray8ToWasm0(input, wasm.__wbindgen_export2);
      const len0 = WASM_VECTOR_LEN;
      wasm.decompress_chunk_slice(retptr, ptr0, len0, min_block_position, min_data_position, max_block_position, max_data_position);
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
      if (r2) {
        throw takeObject(r1);
      }
      return ChunkSliceResult.__wrap(r0);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  function __wbg_Error_8c4e43fe74559d73(arg0, arg1) {
    const ret = Error(getStringFromWasm0(arg0, arg1));
    return addHeapObject(ret);
  }
  function __wbg___wbindgen_throw_be289d5034ed271b(arg0, arg1) {
    throw new Error(getStringFromWasm0(arg0, arg1));
  }
  var ChunkSliceResultFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
  }, unregister: () => {
  } } : new FinalizationRegistry((ptr) => wasm.__wbg_chunksliceresult_free(ptr >>> 0, 1));
  var DecompressResultFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
  }, unregister: () => {
  } } : new FinalizationRegistry((ptr) => wasm.__wbg_decompressresult_free(ptr >>> 0, 1));
  function addHeapObject(obj) {
    if (heap_next === heap.length) heap.push(heap.length + 1);
    const idx = heap_next;
    heap_next = heap[idx];
    heap[idx] = obj;
    return idx;
  }
  function dropObject(idx) {
    if (idx < 132) return;
    heap[idx] = heap_next;
    heap_next = idx;
  }
  function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
  }
  function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
  }
  var cachedDataViewMemory0 = null;
  function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || cachedDataViewMemory0.buffer.detached === void 0 && cachedDataViewMemory0.buffer !== wasm.memory.buffer) {
      cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
  }
  var cachedFloat64ArrayMemory0 = null;
  function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
      cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
  }
  function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
  }
  var cachedUint8ArrayMemory0 = null;
  function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
      cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
  }
  function getObject(idx) {
    return heap[idx];
  }
  var heap = new Array(128).fill(void 0);
  heap.push(void 0, null, true, false);
  var heap_next = heap.length;
  function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
  }
  function takeObject(idx) {
    const ret = getObject(idx);
    dropObject(idx);
    return ret;
  }
  var cachedTextDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
  cachedTextDecoder.decode();
  var MAX_SAFARI_DECODE_BYTES = 2146435072;
  var numBytesDecoded = 0;
  function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
      cachedTextDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
      cachedTextDecoder.decode();
      numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
  }
  var WASM_VECTOR_LEN = 0;
  var wasm;
  function __wbg_set_wasm(val) {
    wasm = val;
  }

  // crate/src/worker-entry.js
  async function handleMessage(data) {
    if (data.type === "init") {
      const instance = await WebAssembly.instantiate(data.wasmModule, {
        "./bgzf_wasm_bg.js": bgzf_wasm_bg_exports
      });
      __wbg_set_wasm(instance.exports);
      return { type: "ready" };
    }
    if (data.type === "decompressRange") {
      const { batchId, sharedInput, inputOffset, inputLength } = data;
      const t0 = performance.now();
      const input = new Uint8Array(sharedInput, inputOffset, inputLength);
      const t1 = performance.now();
      const decompressed = decompress_all(input);
      const t2 = performance.now();
      return {
        type: "rangeResult",
        batchId,
        data: decompressed,
        viewMs: t1 - t0,
        wasmMs: t2 - t1,
        transfer: [decompressed.buffer]
      };
    }
    return { type: "error", message: "unknown message type" };
  }
  globalThis.onmessage = async (e) => {
    const result = await handleMessage(e.data);
    const transfer = result.transfer;
    delete result.transfer;
    if (transfer) {
      globalThis.postMessage(result, transfer);
    } else {
      globalThis.postMessage(result);
    }
  };
})();
