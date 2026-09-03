import { describe, expect, it } from 'vitest'

import { buildPreviewAudioScript, buildPreviewDocument } from './previewAudio'

describe('preview audio script', () => {
  it('buffers media through fetch and autoplays sounds like Anki', () => {
    const script = buildPreviewAudioScript()

    expect(script).toContain('fetch(url,{cache:"no-store"})')
    expect(script).toContain('URL.createObjectURL')
    expect(script).toContain('void startAutoplay()')
    expect(script).toContain('button.dataset.autoplay!=="false"')
    expect(script).toContain('finishCurrent')
    expect(script).toContain('window.addEventListener("pagehide"')
    expect(script).not.toContain('new Audio(button.dataset.audio)')
  })

  it('mirrors the Anki desktop reviewer document', () => {
    const doc = buildPreviewDocument('<div class="content">front</div>', { templateIndex: 1 })

    // css_browser_selector writes platform classes on <html>; body gets isWin.
    expect(doc).toContain('<html class="js webkit chrome win">')
    expect(doc).toContain('<body class="card card2 isWin"><div id="qa"><div class="content">front</div></div>')
    expect(doc).toContain('globalThis.ankiPlatform="desktop"')
    expect(doc).not.toContain('id="anki-card"')
    expect(doc).toContain('void startAutoplay()')
    expect(doc).toContain("default-src 'none'")
    expect(doc).toContain("form-action 'none'")
    expect(doc).toContain("navigate-to 'none'")
    expect(doc).toContain('connect-src http://127.0.0.1:8765')
    expect(doc).toContain('width=1280,initial-scale=1')
    expect(doc).not.toContain('width=device-width')
    expect(doc).not.toContain('transform:none!important')
  })

  it('ships the Anki reviewer stylesheet defaults', () => {
    const doc = buildPreviewDocument('front')

    expect(doc).toContain('img{max-width:100%;max-height:95vh}')
    expect(doc).toContain('body{margin:20px;')
    expect(doc).toContain('hr{background-color:#a0a0a0;margin:1em 0;border:none;height:1px}')
    expect(doc).toContain('#typeans{width:100%;box-sizing:border-box;line-height:1.75}')
    expect(doc).toContain('.typeGood{background:#afa;color:black}')
    expect(doc).toContain('li{text-align:start}')
  })

  it('exposes AnkiDroid and night-mode CSS classes', () => {
    const doc = buildPreviewDocument('back', { platform: 'ankidroid', nightMode: true })

    expect(doc).toContain('<html class="js webkit chrome mobile android linux night_mode nightMode ankidroid_dark_mode">')
    expect(doc).toContain('<meta name="viewport" content="width=360,initial-scale=1">')
    expect(doc).toContain('<body class="card card1 night_mode nightMode ankidroid_dark_mode">')
    // AnkiDroid does not define ankiPlatform; templates feature-detect AnkiDroidJS.
    expect(doc).not.toContain('globalThis.ankiPlatform="')
  })
})
