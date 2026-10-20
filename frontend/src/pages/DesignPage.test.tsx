// @vitest-environment jsdom

import { useState } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type NoteType } from '../api'
import { DesignPage } from './DesignPage'
import { codeValue, setCode } from '../../test-utils/editor'

vi.mock('../api', () => ({
  api: {
    media: vi.fn(),
  },
}))

const noteType: NoteType = {
  id: 'nt-1',
  name: 'Basic',
  fields: [{ name: 'Front', order: 0 }, { name: 'Back', order: 1 }],
  templates: [{ name: 'Card 1', front: '<img src="old.png">', back: '{{Back}}' }],
  css: '.card { background: url(old.png); }',
  notes: [],
}

// DesignPage is a controlled component: its `drafts` state is owned by the
// parent (App.tsx in production). This harness stands in for that parent so
// edits actually round-trip through state the way they do for real.
function Harness({ onSave = vi.fn(async () => true) }: { onSave?: (mode: string, value: string) => Promise<boolean> }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [index, setIndex] = useState(0)
  return <DesignPage noteType={noteType} index={index} setIndex={setIndex} drafts={drafts} setDrafts={setDrafts} onSave={onSave} notify={vi.fn()} />
}

beforeEach(() => {
  vi.mocked(api.media).mockResolvedValue([])
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DesignPage draft editing', () => {
  it('marks the draft dirty on edit and saves it through onSave', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(true)
    render(<Harness onSave={onSave} />)

    await screen.findByLabelText('카드 템플릿 코드')
    expect(screen.getByText('작업본에 저장됨')).toBeTruthy()

    setCode(codeValue() + '!')
    expect(screen.getByText('작업본에 저장')).toBeTruthy()

    await user.click(screen.getByText('작업본에 저장'))
    expect(onSave).toHaveBeenCalledWith('front', '<img src="old.png">!')
    await waitFor(() => expect(screen.getByText('작업본에 저장됨')).toBeTruthy())
  })

  it('discards an unsaved draft back to the last saved value', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await screen.findByLabelText('카드 템플릿 코드')
    setCode(codeValue() + '!')
    expect(screen.getByText('작업본에 저장')).toBeTruthy()

    await user.click(screen.getByText('되돌리기'))
    expect(screen.getByText('작업본에 저장됨')).toBeTruthy()
    expect(codeValue()).toBe('<img src="old.png">')
  })
})
