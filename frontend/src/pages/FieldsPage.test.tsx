// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api, type NoteType } from '../api'
import { FieldsPage } from './FieldsPage'

vi.mock('../api', () => ({
  api: {
    fieldContentSummary: vi.fn(),
  },
}))

const noteType: NoteType = {
  id: 'nt-1',
  name: 'Basic',
  fields: [{ name: 'Front', order: 0 }, { name: 'Back', order: 1 }],
  templates: [{ name: 'Card 1', front: '{{Front}}', back: '{{Back}}' }],
  css: '',
  notes: [['q1', 'a1'], ['q2', 'a2']],
}

const noop = {
  onRename: vi.fn(async () => undefined),
  onAdd: vi.fn(async () => undefined),
  onDelete: vi.fn(async () => undefined),
  onReorder: vi.fn(async () => undefined),
  onMove: vi.fn(async () => 0),
  onClone: vi.fn(async () => undefined),
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('FieldsPage field editing', () => {
  it('renames a field on blur', async () => {
    const user = userEvent.setup()
    const onRename = vi.fn().mockResolvedValue(undefined)
    render(<FieldsPage noteType={noteType} {...noop} onRename={onRename} />)

    const input = screen.getByDisplayValue('Front')
    await user.clear(input)
    await user.type(input, 'Question')
    await user.tab()

    expect(onRename).toHaveBeenCalledWith(0, 'Question')
  })

  it('adds a new field from the form', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn().mockResolvedValue(undefined)
    render(<FieldsPage noteType={noteType} {...noop} onAdd={onAdd} />)

    await user.type(screen.getByPlaceholderText('새 필드 이름'), 'Extra')
    await user.click(screen.getByRole('button', { name: '필드 추가' }))

    expect(onAdd).toHaveBeenCalledWith('Extra')
  })

  it('reorders fields and disables the boundary buttons', async () => {
    const user = userEvent.setup()
    const onReorder = vi.fn().mockResolvedValue(undefined)
    render(<FieldsPage noteType={noteType} {...noop} onReorder={onReorder} />)

    const upButtons = screen.getAllByTitle('위로') as HTMLButtonElement[]
    const downButtons = screen.getAllByTitle('아래로') as HTMLButtonElement[]
    expect(upButtons[0].disabled).toBe(true) // first field can't move up
    expect(downButtons[1].disabled).toBe(true) // last field can't move down

    await user.click(downButtons[0])
    expect(onReorder).toHaveBeenCalledWith(0, 1)
  })

  it('warns how many notes are affected before deleting a field with content', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn().mockResolvedValue(undefined)
    render(<FieldsPage noteType={noteType} {...noop} onDelete={onDelete} />)

    await user.click(screen.getAllByTitle('필드 삭제')[0])
    const modalCard = (await screen.findByText('‘Front’ 필드를 삭제할까요?')).closest('div')
    expect(modalCard).toBeTruthy()
    expect(within(modalCard!).getByText(/2개 노트에 내용이 있습니다/)).toBeTruthy()

    await user.click(within(modalCard!).getByRole('button', { name: '필드 삭제' }))
    expect(onDelete).toHaveBeenCalledWith(0)
  })

  it('clones the note type under the entered name', async () => {
    const user = userEvent.setup()
    const onClone = vi.fn().mockResolvedValue(undefined)
    render(<FieldsPage noteType={noteType} {...noop} onClone={onClone} />)

    await user.type(screen.getByPlaceholderText('새 노트 유형 이름'), 'Reversed')
    await user.click(screen.getByRole('button', { name: '저장' }))

    expect(onClone).toHaveBeenCalledWith('Reversed')
  })

  it('moves an empty destination\'s content immediately without an extra confirmation step', async () => {
    const user = userEvent.setup()
    vi.mocked(api.fieldContentSummary).mockResolvedValue({
      field_order: 0, filled: 2, text_only: 2, media_only: 0, mixed: 0, has_mixed: false,
      destination_filled: { '1': 0 }, sample_text: '', sample_media: '',
    })
    const onMove = vi.fn().mockResolvedValue(2)
    render(<FieldsPage noteType={noteType} {...noop} onMove={onMove} />)

    await user.click(screen.getAllByTitle('내용 이동')[0])
    await screen.findByText('‘Front’ 내용을 어디로 옮길까요?')
    await user.click(screen.getByRole('button', { name: /Back/ }))

    await waitFor(() => expect(onMove).toHaveBeenCalledWith(0, 1, 'all'))
  })
})
