/* @ts-self-types="./bgzf_wasm.d.ts" */

import * as wasm from "./bgzf_wasm_bg.wasm";
import { __wbg_set_wasm } from "./bgzf_wasm_bg.js";
__wbg_set_wasm(wasm);

export {
    ChunkSliceResult, DecompressResult, decompress_all, decompress_block, decompress_chunk_slice
} from "./bgzf_wasm_bg.js";
