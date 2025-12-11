// Import the WASM binary as base64 data URL
import wasmData from '../../src/wasm/bgzf_wasm_bg.wasm';
import * as bg from '../../src/wasm/bgzf_wasm_bg.js';

let wasm = null;
let initPromise = null;

async function init() {
    if (wasm) return wasm;

    if (!initPromise) {
        initPromise = (async () => {
            // wasmData is a data URL from asset/inline
            const response = await fetch(wasmData);
            const bytes = await response.arrayBuffer();
            const { instance } = await WebAssembly.instantiate(bytes, {
                './bgzf_wasm_bg.js': bg
            });
            wasm = instance.exports;
            bg.__wbg_set_wasm(wasm);
            bg.__wbindgen_init_externref_table();
            return wasm;
        })();
    }

    return initPromise;
}

export async function decompressBlock(input, offset = 0) {
    await init();
    const subarray = offset > 0 ? input.subarray(offset) : input;
    const result = bg.decompress_block(subarray);
    const data = result.data;
    const bytesRead = result.bytes_read;
    result.free();
    return { data, bytesRead };
}

export async function decompressAll(input) {
    await init();
    return bg.decompress_all(input);
}

export async function decompressChunkSlice(
    input,
    minBlockPosition,
    minDataPosition,
    maxBlockPosition,
    maxDataPosition
) {
    await init();
    const result = bg.decompress_chunk_slice(
        input,
        minBlockPosition,
        minDataPosition,
        maxBlockPosition,
        maxDataPosition
    );
    const buffer = result.buffer;
    const cpositions = [...result.cpositions];
    const dpositions = [...result.dpositions];
    result.free();
    return { buffer, cpositions, dpositions };
}
