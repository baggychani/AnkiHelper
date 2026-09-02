// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type MediaItem } from '../api'
import { MediaPage } from './MediaPage'

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn() }))
vi.mock('../api', () => ({
  api: {
    media: vi.fn(),
    mediaUrl: vi.fn(),
  },
}))

const items: MediaItem[] = [
  { name: 'answer.mp3', stored_name: '0', size: 12, type: 'audio' },
  { name: 'notes.pdf', stored_name: '1', size: 24, type: 'other' },
]

beforeEach(() => {
  vi.mocked(api.media).mockResolvedValue(items)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('MediaPage filtered exports', () => {
  it('labels a type-filtered export accurately and forwards the media type', async () => {
    const user = userEvent.setup()
    const onExport = vi.fn()
    render(<MediaPage onExport={onExport} onExportSelected={vi.fn()} notify={vi.fn()} />)

    await screen.findByText('answer.mp3')
    expect(screen.getByRole('button', { name: '전체 추출' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '음성 1' }))
    await user.click(screen.getByRole('button', { name: '음성 추출' }))

    expect(onExport).toHaveBeenCalledWith('audio')
  })

  it('exposes the other-media filter and exports that category', async () => {
    const user = userEvent.setup()
    const onExport = vi.fn()
    render(<MediaPage onExport={onExport} onExportSelected={vi.fn()} notify={vi.fn()} />)

    await screen.findByText('notes.pdf')
    await user.click(screen.getByRole('button', { name: '기타 1' }))
    await user.click(screen.getByRole('button', { name: '기타 추출' }))

    expect(screen.getByText('notes.pdf')).toBeTruthy()
    expect(screen.queryByText('answer.mp3')).toBeNull()
    expect(onExport).toHaveBeenCalledWith('other')
  })
})
