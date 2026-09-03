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

  it('keeps the current card visible until the next document arrives', async () => {
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
    expect(screen.getByTitle('카드 미리보기').getAttribute('srcdoc')).toContain('back-0')
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('button', { name: '뒷면' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: '다음' }).hasAttribute('disabled')).toBe(false)

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

  it('switches PC/AnkiDroid and night mode by messaging the live iframe instead of reloading it', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '실시간 미리보기' }))
    const iframe = await screen.findByTitle('카드 미리보기') as HTMLIFrameElement
    await waitFor(() => expect(screen.getByTitle('카드 미리보기').getAttribute('srcdoc')).toContain('<body class="card card1 isWin">'))
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts')
    expect(iframe.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(iframe.style.width).toBe('1280px')
    expect(iframe.style.height).toBe('720px')
    const originalSrcDoc = iframe.getAttribute('srcdoc')

    const postMessageSpy = vi.spyOn(iframe.contentWindow as Window, 'postMessage')

    await user.click(screen.getByRole('button', { name: 'AnkiDroid' }))
    await waitFor(() => expect(postMessageSpy).toHaveBeenCalledWith({ type: 'ankihelper:appearance', platform: 'ankidroid', nightMode: false }, '*'))
    expect(screen.getByText('ANKIDROID 미리보기')).toBeTruthy()
    expect(iframe.style.width).toBe('360px')
    expect(iframe.style.height).toBe('800px')
    const shell = screen.getByTestId('preview-device-shell')
    expect(shell.className).toContain('min-w-0')
    expect(shell.style.transition).toContain('width')
    const scaled = shell.firstElementChild as HTMLElement
    expect(scaled.className).toContain('absolute')
    expect(scaled.style.transition).toContain('transform')

    await user.click(screen.getByRole('button', { name: '야간 모드' }))
    await waitFor(() => expect(postMessageSpy).toHaveBeenCalledWith({ type: 'ankihelper:appearance', platform: 'ankidroid', nightMode: true }, '*'))

    // Toggling platform/night mode must never reload the iframe document -
    // a fresh srcdoc load is what caused the old refresh-style flicker.
    expect(screen.getByTitle('카드 미리보기').getAttribute('srcdoc')).toBe(originalSrcDoc)
  })
})
