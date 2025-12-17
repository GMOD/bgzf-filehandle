import QuickLRU from 'quick-lru'

export interface ByteCacheConfig {
  maxSize: number
}

const DEFAULT_MAX_SIZE = 1000 // Default max number of blocks to cache

export default class ByteCache {
  private cache: QuickLRU<number, Uint8Array>

  constructor(config?: Partial<ByteCacheConfig>) {
    this.cache = new QuickLRU<number, Uint8Array>({
      maxSize: config?.maxSize ?? DEFAULT_MAX_SIZE,
    })
  }

  get(blockPosition: number): Uint8Array | undefined {
    return this.cache.get(blockPosition)
  }

  set(blockPosition: number, data: Uint8Array) {
    this.cache.set(blockPosition, data)
  }

  has(blockPosition: number): boolean {
    return this.cache.has(blockPosition)
  }

  clear() {
    this.cache.clear()
  }

  get size() {
    return this.cache.size
  }
}
