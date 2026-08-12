// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { api, type Workspace } from './api'


vi.mock('./api', () => ({
  api: {
    status: vi.fn(),
    preview: vi.fn(),
  },
}))

const workspace: Workspace = {
  source: 'C:\\Decks\\Turkish.apkg',
  source_name: 'Turkish.apkg',
  media_count: 110,
  selected_note_type_id: 'turkish',
  requires_save_as: false,
  note_types: [{
    id: 'turkish',
    name: 'Turkish',
    fields: [{ name: 'Front', order: 0 }, { name: 'Back', order: 1 }],
    templates: [{ name: 'Card 1', front: '{{Front}}', back: '{{Back}}' }],
    css: '',
    notes: Array.from({ length: 94 }, (_, index) => [`front-${index}`, `back-${index}`]),
  }],
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  })
  vi.mocked(api.status).mockResolvedValue(workspace)
  vi.mocked(api.preview).mockImplementation(async (_noteTypeId, _templateIndex, side, noteIndex) => ({
    html: `<div data-preview="${side}-${noteIndex}">${side}-${noteIndex}</div>`,
  }))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('App preview navigation', () => {
  it('moves back → next to the next card front, then keeps that card on its back', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '실시간 미리보기' }))
    await waitFor(() => expect(screen.getByTitle('카드 미리보기').getAttribute('srcdoc')).toContain('front-0'))

    await user.click(screen.getByRole('button', { name: '뒷면' }))
    await waitFor(() => expect(screen.getByTitle('카드 미리보기').getAttribute('srcdoc')).toContain('back-0'))

    await user.click(screen.getByRole('button', { name: '다음' }))
    await waitFor(() => expect(screen.getByTitle('카드 미리보기').getAttribute('srcdoc')).toContain('front-1'))
    expect(screen.getByRole('button', { name: '앞면' }).className).toContain('bg-white')

    await user.click(screen.getByRole('button', { name: '뒷면' }))
    await waitFor(() => expect(screen.getByTitle('카드 미리보기').getAttribute('srcdoc')).toContain('back-1'))

    const calls = vi.mocked(api.preview).mock.calls.map(([, , side, noteIndex]) => `${side}-${noteIndex}`)
    expect(calls.slice(-3)).toEqual(['back-0', 'front-1', 'back-1'])
  })

  it('removes the stale iframe until the requested next-card document arrives', async () => {
    let resolveNext: ((value: { html: string }) => void) | undefined
    vi.mocked(api.preview).mockImplementation(async (_noteTypeId, _templateIndex, side, noteIndex) => {
      if (side === 'front' && noteIndex === 1) {
        return new Promise((resolve) => { resolveNext = resolve })
      }
      return { html: `<div data-preview="${side}-${noteIndex}">${side}-${noteIndex}</div>` }
    })

    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: '실시간 미리보기' }))
    await waitFor(() => expect(screen.getByTitle('카드 미리보기').getAttribute('srcdoc')).toContain('front-0'))
    await user.click(screen.getByRole('button', { name: '뒷면' }))
    await waitFor(() => expect(screen.getByTitle('카드 미리보기').getAttribute('srcdoc')).toContain('back-0'))

    await user.click(screen.getByRole('button', { name: '다음' }))
    expect(screen.queryByTitle('카드 미리보기')).toBeNull()
    expect(screen.getByRole('status', { name: '' }).textContent).toContain('카드를 불러오는 중')
    expect(screen.getByRole('button', { name: '뒷면' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: '다음' }).hasAttribute('disabled')).toBe(true)

    await waitFor(() => expect(resolveNext).toBeTypeOf('function'))
    resolveNext?.({ html: '<div data-preview="front-1">front-1</div>' })
    await waitFor(() => expect(screen.getByTitle('카드 미리보기').getAttribute('srcdoc')).toContain('front-1'))
  })

  it('shows preview request failures instead of silently leaving stale content', async () => {
    vi.mocked(api.preview).mockRejectedValue(new Error('미리보기 렌더링 실패'))
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '실시간 미리보기' }))
    await waitFor(() => expect(screen.getByText('미리보기 렌더링 실패')).toBeTruthy())
    expect(screen.queryByTitle('카드 미리보기')).toBeNull()
  })

  it('switches the preview document between PC, AnkiDroid, and night CSS contexts', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '실시간 미리보기' }))
    const iframe = await screen.findByTitle('카드 미리보기')
    await waitFor(() => expect(iframe.getAttribute('srcdoc')).toContain('<body class="card card1 win">'))

    await user.click(screen.getByRole('button', { name: 'AnkiDroid' }))
    await waitFor(() => expect(screen.getByTitle('카드 미리보기').getAttribute('srcdoc')).toContain('card card1 mobile android linux chrome'))
    expect(screen.getByText('ANKIDROID 미리보기')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '야간 모드' }))
    await waitFor(() => expect(screen.getByTitle('카드 미리보기').getAttribute('srcdoc')).toContain('nightMode night_mode ankidroid_dark_mode'))
  })
})
