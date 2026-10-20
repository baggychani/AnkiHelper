import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import { buildPreviewDocument } from '../src/previewAudio'

const root = resolve(import.meta.dirname, '../..')
const venv = resolve(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python')
const python = process.env.ANKI_HELPER_PYTHON || (existsSync(venv) ? venv : 'python')
const fixture: { front: string; back: string; assetUrl: string; svg: string } = JSON.parse(execFileSync(
  python, [resolve(root, 'tests/preview_browser_fixture.py')],
  { encoding: 'utf8', env: { ...process.env, PYTHONPATH: resolve(root, 'src') } },
))

let server: Server
let pageErrors: string[]
test.beforeAll(async () => {
  // Real loopback responses also exercise fetch/CORS from the opaque iframe.
  server = createServer((request, response) => {
    if (request.url === '/test-host') {
      response.setHeader('Content-Type', 'text/html')
      response.end('<iframe title="preview" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>')
    } else if (request.url === new URL(fixture.assetUrl).pathname) {
      response.setHeader('Content-Type', 'image/svg+xml')
      response.setHeader('Access-Control-Allow-Origin', '*')
      response.end(fixture.svg)
    } else {
      response.writeHead(404).end()
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(8765, '127.0.0.1', resolve)
  })
})
test.afterAll(async () => {
  if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
})
test.beforeEach(async ({ page }) => {
  pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto('http://127.0.0.1:8765/test-host')
  await page.locator('iframe').evaluate((iframe: HTMLIFrameElement, html) => { iframe.srcdoc = html }, buildPreviewDocument(fixture.front))
  await expect(page.frameLocator('iframe').locator('#side')).toHaveAttribute('data-fetched', 'true')
})
test.afterEach(() => expect(pageErrors).toEqual([]))

test('executes generated scripts before the card and resolves actual image/fetch requests in an opaque iframe', async ({ page }) => {
  const image = page.frameLocator('iframe').locator('#dynamic')
  await expect(image).toHaveAttribute('src', fixture.assetUrl)
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(8)
  const state = await image.evaluate(() => {
    let parentBlocked = false
    try { void window.parent.document.body } catch { parentBlocked = true }
    return { base: document.baseURI, parentBlocked, storage: sessionStorage.getItem('front') }
  })
  expect(state).toEqual({ base: 'https://preview.invalid/', parentBlocked: true, storage: 'remembered' })
})

test('rewrites DOM properties, setAttribute, CSS and linked stylesheet URLs', async ({ page }) => {
  const image = page.frameLocator('iframe').locator('#dynamic')
  const result = await image.evaluate((img: HTMLImageElement) => {
    img.srcset = 'badge.svg 1x, badge.svg 2x'
    img.setAttribute('src', 'badge.svg')
    img.style.setProperty('background-image', 'url(badge.svg)')
    const link = document.createElement('link')
    link.rel = 'stylesheet'; link.href = 'theme.css'; document.head.appendChild(link)
    return { src: img.src, srcset: img.srcset, css: img.style.backgroundImage, stylesheet: link.href }
  })
  expect(result.src).toBe(fixture.assetUrl)
  expect(result.srcset).toBe(`${fixture.assetUrl} 1x, ${fixture.assetUrl} 2x`)
  expect(result.css).toContain(fixture.assetUrl)
  expect(result.stylesheet).toMatch(/^data:text\/css;base64,/)
  expect(Buffer.from(result.stylesheet.split(',')[1], 'base64').toString()).toContain(fixture.assetUrl)
})

test('MutationObserver resolves media and styles inserted with innerHTML', async ({ page }) => {
  const frame = page.frameLocator('iframe')
  await frame.locator('#side').evaluate((element) => {
    element.innerHTML = '<img id="inserted" src="badge.svg" srcset="badge.svg 1x, badge.svg 2x"><style id="inserted-style">.inserted { background: url(badge.svg) }</style>'
  })
  await expect(frame.locator('#inserted')).toHaveAttribute('src', fixture.assetUrl)
  await expect(frame.locator('#inserted')).toHaveAttribute('srcset', `${fixture.assetUrl} 1x, ${fixture.assetUrl} 2x`)
  await expect.poll(() => frame.locator('#inserted-style').textContent()).toContain(fixture.assetUrl)
})

test('real front/back messages preserve storage and keep dynamic media working across repeated flips', async ({ page }) => {
  for (let index = 0; index < 6; index++) {
    const back = index % 2 === 0
    await page.locator('iframe').evaluate((iframe: HTMLIFrameElement, html) => {
      iframe.contentWindow!.postMessage({ type: 'ankihelper:content', html, templateIndex: 0 }, '*')
    }, back ? fixture.back : fixture.front)
    const side = page.frameLocator('iframe').locator('#side')
    await expect(side).toHaveText(back ? 'back' : 'front')
    if (back) {
      await expect(side).toHaveAttribute('data-session', 'remembered')
      await expect(side).toHaveAttribute('data-local', 'retained')
    }
    await expect(page.frameLocator('iframe').locator('#dynamic')).toHaveAttribute('src', fixture.assetUrl)
  }
})
