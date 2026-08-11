import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.wasm': 'application/wasm',
  '.bam': 'application/octet-stream',
  '.gz': 'application/octet-stream',
  '.json': 'application/json',
}

/**
 * @param crossOriginIsolated send COOP/COEP, which is what makes
 * `SharedArrayBuffer` exist in the page. Pass `false` to serve a page like the
 * majority of JBrowse installs — no isolation, no SAB — which is the condition
 * the transferable path has to work under.
 */
export function createServer(rootDir: string, crossOriginIsolated = true) {
  const server = http.createServer((req, res) => {
    if (crossOriginIsolated) {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
    }

    const urlPath = decodeURIComponent(req.url ?? '/')
    const filePath = path.join(rootDir, urlPath)

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404)
      res.end(`Not found: ${urlPath}`)
      return
    }

    const ext = path.extname(filePath)
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream'

    res.writeHead(200, { 'Content-Type': contentType })
    fs.createReadStream(filePath).pipe(res)
  })

  return server
}

export function startServer(
  rootDir: string,
  crossOriginIsolated = true,
): Promise<{ server: http.Server; port: number }> {
  return new Promise(resolve => {
    const server = createServer(rootDir, crossOriginIsolated)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({ server, port })
    })
  })
}
