const promisify = require('es6-promisify').promisify
const fs =
  // eslint-disable-next-line camelcase
  typeof __webpack_require__ !== 'function' ? require('fs') : undefined

const fsOpen = fs && fs.open && promisify(fs.open)
const fsRead = fs && fs.read && promisify(fs.read)
const fsFStat = fs && fs.fstat && promisify(fs.fstat)

// LocalFile is pretty much just an implementation of the node 10+ fs.promises filehandle,
// we can switch to that when the API is stable
class LocalFile {
  constructor(path) {
    this.fdPromise = fsOpen(path, 'r')
    this.path = path
  }

  async read(buf, offset, length, position) {
    const fd = await this.fdPromise
    const ret = await fsRead(fd, buf, offset, length, position)
    return {
      bytesRead: ret,
    }
  }

  async stat() {
    const fd = await this.fdPromise
    return fsFStat(fd)
  }
}

module.exports = LocalFile
