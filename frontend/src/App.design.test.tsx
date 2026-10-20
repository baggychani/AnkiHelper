// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { codeValue, setCode } from '../test-utils/editor'
import { api, type Workspace } from './api'

vi.mock('./api', () => ({ api: {
  ready: vi.fn().mockResolvedValue(undefined), status: vi.fn(),
  media: vi.fn().mockResolvedValue([]), preview: vi.fn(), updateTemplate: vi.fn(), savePackage: vi.fn(),
} }))

const initial: Workspace = {
  source: 'audit.apkg', source_name: 'audit.apkg', media_count: 1,
  selected_note_type_id: 'basic', requires_save_as: false,
  note_types: [{ id: 'basic', name: 'Basic', fields: [{ name: 'Front', order: 0 }],
    templates: [{ name: 'Card', front: '<img src="old.png">', back: 'answer' }],
    css: '', notes: [['question']],
  }],
}
const draft = '<img src="old.png"><p>UNSAVED WORK</p>'

beforeEach(() => {
  window.localStorage.clear()
  vi.mocked(api.status).mockResolvedValue(structuredClone(initial))
  vi.mocked(api.preview).mockResolvedValue({ html: 'preview', cloze_ordinals: [], cloze_ordinal: 0 })
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

function navigate(page: string) {
  act(() => window.dispatchEvent(new CustomEvent('ankihelper:navigate', { detail: page })))
}

async function edit() {
  render(<App />)
  await screen.findByRole('button', { name: '실시간 미리보기' })
  navigate('design')
  await screen.findByLabelText('카드 템플릿 코드')
  setCode(draft)
}

it('retains the draft when applying it fails, then supports retry', async () => {
  vi.mocked(api.updateTemplate).mockRejectedValueOnce(new Error('SAVE FAILURE'))
  await edit()
  fireEvent.click(screen.getByText('작업본에 저장'))
  await screen.findByText('SAVE FAILURE')
  expect(codeValue()).toBe(draft)
  fireEvent.click(screen.getByRole('button', { name: '확인' }))
  const saved = structuredClone(initial)
  saved.note_types[0].templates[0].front = draft
  vi.mocked(api.updateTemplate).mockResolvedValueOnce(saved)
  fireEvent.click(screen.getByText('작업본에 저장'))
  await screen.findByText('작업본에 저장됨')
  expect(codeValue()).toBe(draft)
})

it('keeps edits typed while an earlier draft is being applied', async () => {
  let finish!: (workspace: Workspace) => void
  vi.mocked(api.updateTemplate).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  await edit()
  fireEvent.click(screen.getByText('작업본에 저장'))
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  const latest = `${draft}<p>MORE WORK</p>`
  setCode(latest)
  const saved = structuredClone(initial)
  saved.note_types[0].templates[0].front = draft
  await act(async () => finish(saved))
  expect(codeValue()).toBe(latest)
  expect(screen.getByText('작업본에 저장')).toBeTruthy()
})

it.each(['front', 'css'])('full save preserves a newer %s draft while applying its snapshot', async (mode) => {
  let finish!: (workspace: Workspace) => void
  vi.mocked(api.updateTemplate).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const saved = structuredClone(initial)
  saved.note_types[0].templates[0].front = draft
  vi.mocked(api.savePackage).mockResolvedValueOnce({ workspace: saved, saved_to: 'audit.apkg', backup: null })
  await edit()
  act(() => window.dispatchEvent(new Event('ankihelper:request-save')))
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  if (mode === 'css') fireEvent.click(screen.getByRole('button', { name: '공통 CSS' }))
  const latest = mode === 'css' ? '.card { color: red }' : `${draft}<p>LATE EDIT</p>`
  setCode(latest)
  await act(async () => finish(saved))
  await waitFor(() => expect(api.savePackage).toHaveBeenCalled())
  expect(codeValue()).toBe(latest)
  expect(screen.getByText('작업본에 저장')).toBeTruthy()
})

it('full save keeps its drafts and does not write the file if applying a draft fails', async () => {
  vi.mocked(api.updateTemplate).mockRejectedValueOnce(new Error('FULL SAVE FAILURE'))
  await edit()
  act(() => window.dispatchEvent(new Event('ankihelper:request-save')))
  await screen.findByRole('dialog', { name: '작업을 완료하지 못했습니다' })
  expect(codeValue()).toBe(draft)
  expect(api.savePackage).not.toHaveBeenCalled()
})

it('renames a pending draft after leaving the design page, and saves the updated reference', async () => {
  await edit()
  // MediaPage is the only rename UI and replaces DesignPage in the router.
  navigate('media')
  await waitFor(() => expect(screen.queryByLabelText('카드 템플릿 코드')).toBeNull())
  const renamed = structuredClone(initial)
  renamed.note_types[0].templates[0].front = '<img src="new.png">'
  act(() => window.dispatchEvent(new CustomEvent('ankihelper:media-changed', {
    detail: { workspace: renamed, rename: { old: 'old.png', new: 'new.png' } },
  })))
  navigate('design')
  const expected = draft.replace('old.png', 'new.png')
  await screen.findByLabelText('카드 템플릿 코드')
  expect(codeValue()).toBe(expected)
  renamed.note_types[0].templates[0].front = expected
  vi.mocked(api.updateTemplate).mockResolvedValueOnce(renamed)
  fireEvent.click(screen.getByText('작업본에 저장'))
  await waitFor(() => expect(api.updateTemplate).toHaveBeenCalledWith('basic', 0, { front: expected }))
})
