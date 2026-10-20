import { describe, expect, it } from 'vitest'
import { CompletionContext } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { ankiFieldCompletion, mediaSnippet } from './editorHelpers'

describe('Anki field suggestions', () => {
  it('uses the current fields, supports conditional markers and excludes fields in CSS', async () => {
    const state = EditorState.create({ doc: '{{^발' })
    const context = new CompletionContext(state, state.doc.length, false)
    const result = await ankiFieldCompletion(['발음', '뜻'], 'front')(context)
    expect(result?.from).toBe(3)
    expect(result?.options.map((item) => item.label)).toEqual(['발음', '뜻'])
    expect(ankiFieldCompletion(['발음'], 'css')(context)).toBeNull()
    expect(ankiFieldCompletion(['바뀐 필드'], 'front')(context)).toMatchObject({ options: [{ label: '바뀐 필드' }] })
  })
})

describe('media insertion escaping', () => {
  it('keeps ampersands and quotes inside image attributes', () => {
    expect(mediaSnippet({ name: 'a&b".png', type: 'image', size: 1, stored_name: '0' }, 'front'))
      .toBe('<img src="a&amp;b&quot;.png" alt="">')
  })
  it('keeps font names inside CSS strings and cannot terminate the surrounding style tag', () => {
    const snippet = mediaSnippet({ name: '_한글</style>".woff2', type: 'font', size: 1, stored_name: '0' }, 'front')
    expect(snippet.match(/<\/style>/g)).toHaveLength(1)
    expect(snippet).toContain('\\3c /style\\3e \\22 ')
    expect(snippet).toContain('font-family: "_한글')
  })
  it('uses an HTML player if the filename would terminate Anki sound syntax', () => {
    expect(mediaSnippet({ name: 'voice].mp3', type: 'audio', size: 1, stored_name: '0' }, 'front'))
      .toBe('<audio controls src="voice].mp3"></audio>')
  })
})
