// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { NoteType, Workspace } from '../api'
import { OverviewPage } from './OverviewPage'

afterEach(() => {
  cleanup()
})

const basicType: NoteType = {
  id: 'nt-basic',
  name: 'Basic',
  fields: [{ name: 'Front', order: 0 }, { name: 'Back', order: 1 }],
  templates: [{ name: 'Card 1', front: '{{Front}}', back: '{{Back}}' }],
  css: '',
  notes: [['q1', 'a1'], ['q2', 'a2']],
}

const emptyType: NoteType = {
  id: 'nt-empty',
  name: 'Empty',
  fields: [{ name: 'Front', order: 0 }, { name: 'Back', order: 1 }],
  templates: [{ name: 'Card 1', front: '{{Front}}', back: '{{Back}}' }],
  css: '',
  notes: [],
}

const workspace: Workspace = {
  source: '/tmp/deck.apkg',
  source_name: 'deck.apkg',
  media_count: 3,
  note_types: [basicType, emptyType],
  selected_note_type_id: basicType.id,
  requires_save_as: false,
}

describe('OverviewPage note type deletion', () => {
  it('only allows removing a note type with zero cards, and confirms through the app modal', async () => {
    const user = userEvent.setup()
    const onDeleteNoteType = vi.fn().mockResolvedValue(true)
    render(<OverviewPage workspace={workspace} selected={basicType} onPage={vi.fn()} onSelect={vi.fn()} onDeleteNoteType={onDeleteNoteType} onMoveNotes={vi.fn()} />)

    const deleteButtons = screen.getAllByTitle('노트 유형 제거') as HTMLButtonElement[]
    expect(deleteButtons[0].disabled).toBe(true) // Basic still has cards
    expect(deleteButtons[1].disabled).toBe(false) // Empty has none

    await user.click(deleteButtons[1])
    await screen.findByText('‘Empty’ 노트 유형을 제거할까요?')
    await user.click(screen.getByRole('button', { name: '제거' }))

    expect(onDeleteNoteType).toHaveBeenCalledWith('nt-empty')
  })
})

describe('OverviewPage move-cards flow', () => {
  it('auto-maps same-named fields and moves cards to the chosen destination', async () => {
    const user = userEvent.setup()
    const onMoveNotes = vi.fn().mockResolvedValue(undefined)
    const onSelect = vi.fn()
    render(<OverviewPage workspace={workspace} selected={basicType} onPage={vi.fn()} onSelect={onSelect} onDeleteNoteType={vi.fn()} onMoveNotes={onMoveNotes} />)

    // Basic is the first row and has cards, so its move button is the enabled one.
    await user.click(screen.getAllByTitle('카드 이동')[0])
    const destinationModal = (await screen.findByText('‘Basic’ 카드를 어디로 옮길까요?')).closest('div')
    expect(destinationModal).toBeTruthy()

    // Scoped to the destination picker: the underlying note type list behind
    // it also has an "Empty" button (to select it), which would otherwise
    // make this query ambiguous.
    await user.click(within(destinationModal!).getByRole('button', { name: /Empty/ }))
    await screen.findByText('필드를 선으로 이으세요')

    // Front/Back exist on both sides with matching names, so the mapping is
    // pre-filled and the move button is enabled without drawing any lines.
    const moveButton = screen.getByRole('button', { name: '2개 카드 이동' }) as HTMLButtonElement
    expect(moveButton.disabled).toBe(false)
    await user.click(moveButton)

    expect(onMoveNotes).toHaveBeenCalledWith('nt-basic', 'nt-empty', { 0: 0, 1: 1 })
    expect(onSelect).toHaveBeenCalledWith('nt-empty')
  })
})
