// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type MediaHealth, type MediaItem, type Workspace } from '../api'
import { MediaPage } from './MediaPage'

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn() }))
vi.mock('../api', () => ({
  api: {
    media: vi.fn(),
    mediaUrl: vi.fn(),
    mediaHealth: vi.fn(),
    deleteMedia: vi.fn(),
    deleteMediaFiles: vi.fn(),
  },
}))

const items: MediaItem[] = [
  { name: 'answer.mp3', stored_name: '0', size: 12, type: 'audio' },
  { name: 'notes.pdf', stored_name: '1', size: 24, type: 'other' },
]

const emptyHealth: MediaHealth = {
  missing: [], references: {}, unused: [], static_unreferenced: [], mapped_missing: [], case_collisions: [], unindexed_entries: [],
}

const fakeWorkspace: Workspace = {
  source: '', source_name: '', media_count: 0, note_types: [], selected_note_type_id: null, requires_save_as: false,
}

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

describe('MediaPage delete confirmation', () => {
  it('confirms deletion through the app modal instead of a native window.confirm', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm')
    vi.mocked(api.mediaHealth).mockResolvedValue(emptyHealth)
    vi.mocked(api.deleteMedia).mockResolvedValue({ workspace: fakeWorkspace })

    render(<MediaPage onExport={vi.fn()} onExportSelected={vi.fn()} notify={vi.fn()} />)
    await screen.findByText('answer.mp3')

    await user.click(screen.getAllByRole('button', { name: '삭제' })[0])

    const modalCard = (await screen.findByText("'answer.mp3'을(를) 제거할까요?")).closest('div')
    expect(modalCard).toBeTruthy()
    expect(confirmSpy).not.toHaveBeenCalled()

    await user.click(within(modalCard!).getByRole('button', { name: '삭제' }))

    expect(api.deleteMedia).toHaveBeenCalledWith('0', false)
    expect(confirmSpy).not.toHaveBeenCalled()
    await screen.findByText('notes.pdf')
    expect(screen.queryByText('answer.mp3')).toBeNull()
  })

  it('warns before a forced delete when the file is still referenced', async () => {
    const user = userEvent.setup()
    vi.mocked(api.mediaHealth).mockResolvedValue({
      ...emptyHealth,
      references: { 'answer.mp3': [{ filename: 'answer.mp3', location: '카드 1 앞면', source: 'field', card: '카드 1', side: 'front' }] },
    })
    vi.mocked(api.deleteMedia).mockResolvedValue({ workspace: fakeWorkspace })

    render(<MediaPage onExport={vi.fn()} onExportSelected={vi.fn()} notify={vi.fn()} />)
    await screen.findByText('answer.mp3')

    await user.click(screen.getAllByRole('button', { name: '삭제' })[0])
    await screen.findByText(/카드 1 앞면/)

    const modalCard = (await screen.findByText("'answer.mp3'을(를) 제거할까요?")).closest('div')
    await user.click(within(modalCard!).getByRole('button', { name: '삭제' }))

    expect(api.deleteMedia).toHaveBeenCalledWith('0', true)
  })
})
