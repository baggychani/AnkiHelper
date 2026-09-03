import { describe, expect, it } from 'vitest'

import { initialPreviewState, previewReducer, previewRequestKey, type PreviewState } from './previewLifecycle'

const state = (overrides: Partial<PreviewState> = {}): PreviewState => ({ ...initialPreviewState, ...overrides })

describe('preview lifecycle', () => {
  it('follows the Anki front → back → next front → back flow', () => {
    const firstBack = previewReducer(initialPreviewState, { type: 'select-side', side: 'back' })
    expect(firstBack).toEqual(state({ side: 'back' }))

    const secondFront = previewReducer(firstBack, { type: 'navigate', delta: 1, total: 94 })
    expect(secondFront).toEqual(state({ noteIndex: 1, visit: 1 }))

    const secondBack = previewReducer(secondFront, { type: 'select-side', side: 'back' })
    expect(secondBack).toEqual(state({ noteIndex: 1, side: 'back', visit: 1 }))
  })

  it('returns to the front on previous and wraps in both directions', () => {
    const fromFirstBack = state({ side: 'back', visit: 7 })
    expect(previewReducer(fromFirstBack, { type: 'navigate', delta: -1, total: 94 }))
      .toEqual(state({ noteIndex: 93, visit: 8 }))

    const fromLastBack = state({ noteIndex: 93, side: 'back', visit: 8 })
    expect(previewReducer(fromLastBack, { type: 'navigate', delta: 1, total: 94 }))
      .toEqual(state({ visit: 9 }))
  })

  it('creates a fresh document visit even when a deck has one card', () => {
    const next = previewReducer(state({ side: 'back', visit: 2 }), { type: 'navigate', delta: 1, total: 1 })
    expect(next).toEqual(state({ visit: 3 }))
    expect(previewRequestKey('basic', 0, next)).not.toBe(
      previewRequestKey('basic', 0, state({ visit: 2 })),
    )
  })

  it('resets note, side, and document visit for another note type or template', () => {
    expect(previewReducer(state({ noteIndex: 32, side: 'back', visit: 4 }), { type: 'reset' }))
      .toEqual(state({ visit: 5 }))
  })

  it('keeps a chosen cloze card until the previewed note changes', () => {
    const third = previewReducer(state({ noteIndex: 2 }), { type: 'select-cloze', ordinal: 3 })
    expect(third.clozeOrdinal).toBe(3)
    expect(previewReducer(third, { type: 'select-side', side: 'back' }).clozeOrdinal).toBe(3)
    expect(previewReducer(third, { type: 'navigate', delta: 1, total: 94 }).clozeOrdinal).toBe(0)
    expect(previewReducer(third, { type: 'reset' }).clozeOrdinal).toBe(0)
  })

  it('keys every relevant preview document coordinate', () => {
    const current = state({ noteIndex: 3 })
    const key = previewRequestKey('turkish', 0, current)
    expect(key).not.toBe(previewRequestKey('other', 0, current))
    expect(key).not.toBe(previewRequestKey('turkish', 1, current))
    expect(key).not.toBe(previewRequestKey('turkish', 0, { ...current, side: 'back' }))
    expect(key).not.toBe(previewRequestKey('turkish', 0, { ...current, noteIndex: 4 }))
    expect(key).not.toBe(previewRequestKey('turkish', 0, { ...current, clozeOrdinal: 2 }))
  })
})
