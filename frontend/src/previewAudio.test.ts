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

  it('uses Anki card and desktop platform classes without an extra card wrapper', () => {
    const doc = buildPreviewDocument('<div class="content">front</div>', { templateIndex: 1 })

    expect(doc).toContain('<html class="win">')
    expect(doc).toContain('<body class="card card2 win"><div class="content">front</div>')
    expect(doc).not.toContain('id="anki-card"')
    expect(doc).toContain('void startAutoplay()')
    expect(doc).toContain("default-src 'none'")
    expect(doc).toContain("form-action 'none'")
    expect(doc).toContain("navigate-to 'none'")
    expect(doc).toContain('connect-src http://127.0.0.1:8765')
    expect(doc).toContain('width=1280,initial-scale=1')
    expect(doc).not.toContain('width=device-width')
    expect(doc).not.toContain('img{max-width:100%;max-height:100%}')
    expect(doc).not.toContain('transform:none!important')
  })

  it('exposes AnkiDroid and night-mode CSS classes', () => {
    const doc = buildPreviewDocument('back', { platform: 'ankidroid', nightMode: true })

    expect(doc).toContain('mobile android linux chrome nightMode night_mode ankidroid_dark_mode')
    expect(doc).toContain('<meta name="viewport" content="width=360,initial-scale=1">')
    expect(doc).toContain('<body class="card card1 mobile android linux chrome nightMode night_mode ankidroid_dark_mode">')
  })
})
