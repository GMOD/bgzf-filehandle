const fs = require('fs-extra')

// LocalFile is pretty much just an implementation of the node 10+ fs.promises filehandle,
// we can switch to that when the API is stable
class LocalFile {
  constructor(path) {
    this.fdPromise = fs.open(path, 'r')
    this.path = path
  }

  async read(buf, offset, length, position) {
    const fd = await this.fdPromise
    const ret = await fs.read(fd, buf, offset, length, position)
    return ret
  }

  async stat() {
    const fd = await this.fdPromise
    return fs.fstat(fd)
  }
}

module.exports = LocalFile
