"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
exports.__esModule = true;
var unzip_1 = require("./unzip");
var gziIndex_1 = __importDefault(require("./gziIndex"));
var generic_filehandle_1 = require("generic-filehandle");
var BgzFilehandle = /** @class */ (function () {
    function BgzFilehandle(_a) {
        var filehandle = _a.filehandle, path = _a.path, gziFilehandle = _a.gziFilehandle, gziPath = _a.gziPath;
        if (filehandle)
            this.filehandle = filehandle;
        else if (path)
            this.filehandle = new generic_filehandle_1.LocalFile(path);
        else
            throw new TypeError('either filehandle or path must be defined');
        if (!gziFilehandle && !gziPath && !path)
            throw new TypeError('either gziFilehandle or gziPath must be defined');
        this.gzi = new gziIndex_1["default"]({
            filehandle: gziFilehandle,
            path: !gziFilehandle && !gziPath && path ? gziPath : path + ".gzi"
        });
    }
    BgzFilehandle.prototype.stat = function () {
        return __awaiter(this, void 0, void 0, function () {
            var compressedStat, _a, _b, _c;
            var _d;
            return __generator(this, function (_e) {
                switch (_e.label) {
                    case 0: return [4 /*yield*/, this.filehandle.stat()];
                    case 1:
                        compressedStat = _e.sent();
                        _b = (_a = Object).assign;
                        _c = [compressedStat];
                        _d = {};
                        return [4 /*yield*/, this.getUncompressedFileSize()];
                    case 2: return [2 /*return*/, _b.apply(_a, _c.concat([(_d.size = _e.sent(),
                                _d.blocks = undefined,
                                _d.blksize = undefined,
                                _d)]))];
                }
            });
        });
    };
    BgzFilehandle.prototype.getUncompressedFileSize = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a, uncompressedPosition, size, buf, bytesRead, lastBlockUncompressedSize;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0: return [4 /*yield*/, this.gzi.getLastBlock()];
                    case 1:
                        _a = _b.sent(), uncompressedPosition = _a[1];
                        return [4 /*yield*/, this.filehandle.stat()];
                    case 2:
                        size = (_b.sent()).size;
                        buf = Buffer.allocUnsafe(4);
                        return [4 /*yield*/, this.filehandle.read(buf, 0, 4, size - 28 - 4)];
                    case 3:
                        bytesRead = (_b.sent()).bytesRead;
                        if (bytesRead !== 4)
                            throw new Error('read error');
                        lastBlockUncompressedSize = buf.readUInt32LE(0);
                        return [2 /*return*/, uncompressedPosition + lastBlockUncompressedSize];
                }
            });
        });
    };
    BgzFilehandle.prototype._readAndUncompressBlock = function (blockBuffer, _a, _b) {
        var compressedPosition = _a[0];
        var nextCompressedPosition = _b[0];
        return __awaiter(this, void 0, void 0, function () {
            var next, blockCompressedLength, unzippedBuffer;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        next = nextCompressedPosition;
                        if (!!next) return [3 /*break*/, 2];
                        return [4 /*yield*/, this.filehandle.stat()];
                    case 1:
                        next = (_c.sent()).size;
                        _c.label = 2;
                    case 2:
                        blockCompressedLength = next - compressedPosition;
                        return [4 /*yield*/, this.filehandle.read(blockBuffer, 0, blockCompressedLength, compressedPosition)
                            // uncompress it
                        ];
                    case 3:
                        _c.sent();
                        return [4 /*yield*/, (0, unzip_1.unzip)(blockBuffer.slice(0, blockCompressedLength))];
                    case 4:
                        unzippedBuffer = _c.sent();
                        return [2 /*return*/, unzippedBuffer];
                }
            });
        });
    };
    BgzFilehandle.prototype.read = function (buf, offset, length, position) {
        return __awaiter(this, void 0, void 0, function () {
            var blockPositions, blockBuffer, destinationOffset, bytesRead, blockNum, uncompressedBuffer, _a, uncompressedPosition, sourceOffset, sourceEnd;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0: return [4 /*yield*/, this.gzi.getRelevantBlocksForRead(length, position)];
                    case 1:
                        blockPositions = _b.sent();
                        blockBuffer = Buffer.allocUnsafe(32768 * 2);
                        destinationOffset = offset;
                        bytesRead = 0;
                        blockNum = 0;
                        _b.label = 2;
                    case 2:
                        if (!(blockNum < blockPositions.length - 1)) return [3 /*break*/, 5];
                        return [4 /*yield*/, this._readAndUncompressBlock(blockBuffer, blockPositions[blockNum], blockPositions[blockNum + 1])];
                    case 3:
                        uncompressedBuffer = _b.sent();
                        _a = blockPositions[blockNum], uncompressedPosition = _a[1];
                        sourceOffset = uncompressedPosition >= position ? 0 : position - uncompressedPosition;
                        sourceEnd = Math.min(position + length, uncompressedPosition + uncompressedBuffer.length) - uncompressedPosition;
                        if (sourceOffset >= 0 && sourceOffset < uncompressedBuffer.length) {
                            uncompressedBuffer.copy(buf, destinationOffset, sourceOffset, sourceEnd);
                            destinationOffset += sourceEnd - sourceOffset;
                            bytesRead += sourceEnd - sourceOffset;
                        }
                        _b.label = 4;
                    case 4:
                        blockNum += 1;
                        return [3 /*break*/, 2];
                    case 5: return [2 /*return*/, { bytesRead: bytesRead, buffer: buf }];
                }
            });
        });
    };
    return BgzFilehandle;
}());
exports["default"] = BgzFilehandle;
//# sourceMappingURL=bgzFilehandle.js.map