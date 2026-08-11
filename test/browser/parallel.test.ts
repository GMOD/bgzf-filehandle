import path from 'node:path'

import { launch } from 'puppeteer'
import { afterAll, beforeAll, expect, test } from 'vitest'

import { startServer } from './serve.ts'

import type http from 'node:http'
import type { Browser } from 'puppeteer'

const rootDir = path.resolve(import.meta.dirname, '../..')

let server: http.Server
let port: number
// A second origin served WITHOUT COOP/COEP, so `SharedArrayBuffer` does not
// exist in pages loaded from it — the condition most JBrowse installs run
// under, and the one the transferable path has to work in.
let plainServer: http.Server
let plainPort: number
let browser: Browser

beforeAll(async () => {
  const result = await startServer(rootDir)
  server = result.server
  port = result.port

  const plain = await startServer(rootDir, false)
  plainServer = plain.server
  plainPort = plain.port

  browser = await launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
}, 30000)

afterAll(async () => {
  await browser.close()
  server.close()
  plainServer.close()
})

async function runBrowserTest(
  pagePath: string,
  testName: string,
  pagePort = port,
) {
  const page = await browser.newPage()

  page.on('console', msg => {
    console.log(`[browser ${msg.type()}]: ${msg.text()}`)
  })
  page.on('pageerror', err => {
    console.error(`[browser error]: ${err.message}`)
  })

  await page.goto(`http://127.0.0.1:${pagePort}${pagePath}`, {
    waitUntil: 'networkidle0',
  })

  const results = await page.evaluate(async () => {
    // @ts-expect-error - runTests is defined in the HTML page's global scope
    return globalThis.runTests()
  })

  console.log(`${testName}:`)
  for (const r of results as {
    name: string
    pass: boolean
    detail?: string
    error?: string
  }[]) {
    const detail = r.detail ? ` (${r.detail.replaceAll('\n', '\n    ')})` : ''
    console.log(
      `  ${r.pass ? 'PASS' : 'FAIL'}: ${r.name}${detail}${r.error ? ` - ${r.error}` : ''}`,
    )
  }

  for (const r of results as { name: string; pass: boolean }[]) {
    expect(r.pass, `Browser test "${r.name}" failed`).toBe(true)
  }

  await page.close()
}

test(
  'parallel decompression with SharedArrayBuffer in browser',
  () => runBrowserTest('/test/browser/index.html', 'Direct pool benchmarks'),
  120000,
)

test(
  'MessagePort shared pool across simulated RPC workers',
  () =>
    runBrowserTest('/test/browser/messageport-test.html', 'MessagePort pool'),
  120000,
)

test(
  'parallel decompression on a page with no cross-origin isolation',
  () =>
    runBrowserTest(
      '/test/browser/transferable-test.html',
      'Transferable path (no COOP/COEP)',
      plainPort,
    ),
  120000,
)
