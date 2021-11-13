"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
exports.__esModule = true;
exports.unzipChunkSlice = exports.unzipChunk = exports.unzip = exports.BgzfFilehandle = void 0;
var bgzFilehandle_1 = __importDefault(require("./bgzFilehandle"));
exports.BgzfFilehandle = bgzFilehandle_1["default"];
var unzip_1 = require("./unzip");
exports.unzip = unzip_1.unzip;
exports.unzipChunk = unzip_1.unzipChunk;
exports.unzipChunkSlice = unzip_1.unzipChunkSlice;
//# sourceMappingURL=index.js.map