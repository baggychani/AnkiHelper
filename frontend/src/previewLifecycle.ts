export type PreviewSide = 'front' | 'back'

export type PreviewState = {
  noteIndex: number
  side: PreviewSide
  visit: number
}

export type PreviewAction =
  | { type: 'select-side'; side: PreviewSide }
  | { type: 'navigate'; delta: -1 | 1; total: number }
  | { type: 'reset' }

export const initialPreviewState: PreviewState = { noteIndex: 0, side: 'front', visit: 0 }

export function previewReducer(state: PreviewState, action: PreviewAction): PreviewState {
  if (action.type === 'select-side') {
    return action.side === state.side ? state : { ...state, side: action.side }
  }
  if (action.type === 'reset') {
    return { noteIndex: 0, side: 'front', visit: state.visit + 1 }
  }
  const total = Math.max(1, action.total)
  return {
    noteIndex: (state.noteIndex + action.delta + total) % total,
    // Anki always presents the question side when moving to another card.
    side: 'front',
    // A visit distinguishes a genuine next/previous action even for a one-card deck.
    visit: state.visit + 1,
  }
}

export function previewRequestKey(
  noteTypeId: string,
  templateIndex: number,
  state: PreviewState,
): string {
  return [noteTypeId, templateIndex, state.noteIndex, state.side, state.visit].join(':')
}
