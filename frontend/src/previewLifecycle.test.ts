import { describe, expect, it } from 'vitest'

import { initialPreviewState, previewReducer, previewRequestKey } from './previewLifecycle'


describe('preview lifecycle', () => {
  it('follows the Anki front → back → next front → back flow', () => {
    const firstBack = previewReducer(initialPreviewState, { type: 'select-side', side: 'back' })
    expect(firstBack).toEqual({ noteIndex: 0, side: 'back', visit: 0 })

    const secondFront = previewReducer(firstBack, { type: 'navigate', delta: 1, total: 94 })
    expect(secondFront).toEqual({ noteIndex: 1, side: 'front', visit: 1 })

    const secondBack = previewReducer(secondFront, { type: 'select-side', side: 'back' })
    expect(secondBack).toEqual({ noteIndex: 1, side: 'back', visit: 1 })
  })

  it('returns to the front on previous and wraps in both directions', () => {
    const fromFirstBack = { noteIndex: 0, side: 'back' as const, visit: 7 }
    expect(previewReducer(fromFirstBack, { type: 'navigate', delta: -1, total: 94 }))
      .toEqual({ noteIndex: 93, side: 'front', visit: 8 })

    const fromLastBack = { noteIndex: 93, side: 'back' as const, visit: 8 }
    expect(previewReducer(fromLastBack, { type: 'navigate', delta: 1, total: 94 }))
      .toEqual({ noteIndex: 0, side: 'front', visit: 9 })
  })

  it('creates a fresh document visit even when a deck has one card', () => {
    const next = previewReducer({ noteIndex: 0, side: 'back', visit: 2 }, { type: 'navigate', delta: 1, total: 1 })
    expect(next).toEqual({ noteIndex: 0, side: 'front', visit: 3 })
    expect(previewRequestKey('basic', 0, next)).not.toBe(
      previewRequestKey('basic', 0, { noteIndex: 0, side: 'front', visit: 2 }),
    )
  })

  it('resets note, side, and document visit for another note type or template', () => {
    expect(previewReducer({ noteIndex: 32, side: 'back', visit: 4 }, { type: 'reset' }))
      .toEqual({ noteIndex: 0, side: 'front', visit: 5 })
  })

  it('keys every relevant preview document coordinate', () => {
    const state = { noteIndex: 3, side: 'front' as const, visit: 2 }
    const key = previewRequestKey('turkish', 0, state)
    expect(key).not.toBe(previewRequestKey('other', 0, state))
    expect(key).not.toBe(previewRequestKey('turkish', 1, state))
    expect(key).not.toBe(previewRequestKey('turkish', 0, { ...state, side: 'back' }))
    expect(key).not.toBe(previewRequestKey('turkish', 0, { ...state, noteIndex: 4 }))
  })
})
