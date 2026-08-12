import { describe, expect, it } from 'vitest'

import { buildPreviewAudioScript, buildPreviewDocument } from './previewAudio'

describe('preview audio script', () => {
  it('buffers media through fetch and autoplays sounds like Anki', () => {
    const script = buildPreviewAudioScript()

    expect(script).toContain('fetch(url,{cache:"no-store"})')
    expect(script).toContain('URL.createObjectURL')
    expect(script).toContain('void startAutoplay()')
    expect(script).not.toContain('new Audio(button.dataset.audio)')
  })

  it('wraps preview markup in a card document with the audio script', () => {
    const doc = buildPreviewDocument('<button class="anki-audio" data-audio="http://127.0.0.1:8765/api/media/0"></button>')

    expect(doc).toContain('id="anki-card"')
    expect(doc).toContain('data-audio="http://127.0.0.1:8765/api/media/0"')
    expect(doc).toContain('void startAutoplay()')
  })
})
