import * as wasm from "./bgzf_wasm_bg.wasm";
export * from "./bgzf_wasm_bg.js";
import { __wbg_set_wasm } from "./bgzf_wasm_bg.js";
__wbg_set_wasm(wasm);