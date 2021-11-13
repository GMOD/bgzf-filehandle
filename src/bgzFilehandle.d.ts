/// <reference types="node" />
import GziIndex from './gziIndex';
import { GenericFilehandle } from 'generic-filehandle';
export default class BgzFilehandle {
    filehandle: GenericFilehandle;
    gzi: GziIndex;
    constructor({ filehandle, path, gziFilehandle, gziPath, }: {
        filehandle?: GenericFilehandle;
        path?: string;
        gziFilehandle?: GenericFilehandle;
        gziPath?: string;
    });
    stat(): Promise<import("generic-filehandle").Stats & {
        size: any;
        blocks: undefined;
        blksize: undefined;
    }>;
    getUncompressedFileSize(): Promise<any>;
    _readAndUncompressBlock(blockBuffer: Buffer, [compressedPosition]: [number], [nextCompressedPosition]: [number]): Promise<Buffer>;
    read(buf: Buffer, offset: number, length: number, position: number): Promise<{
        bytesRead: number;
        buffer: Buffer;
    }>;
}
