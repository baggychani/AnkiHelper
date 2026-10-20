// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { api, type MediaItem } from '../api'
import { MediaInsertDialog } from './MediaInsertDialog'

vi.mock('../api', () => ({ api: { media: vi.fn() } }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('prevents insertion while loading, reports a failure, and retries with a fresh list', async () => {
  let reject!: (reason: Error) => void
  vi.mocked(api.media).mockReturnValueOnce(new Promise<MediaItem[]>((_resolve, fail) => { reject = fail }))
    .mockResolvedValueOnce([{ name: 'new.png', stored_name: '3', type: 'image', size: 1 }])
  const onInsert = vi.fn()
  const user = userEvent.setup()
  render(<MediaInsertDialog mode="front" onInsert={onInsert} onClose={() => {}} />)
  expect((screen.getByRole('button', { name: '삽입' }) as HTMLButtonElement).disabled).toBe(true)
  reject(new Error('offline'))
  await screen.findByRole('alert')
  expect(onInsert).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '다시 시도' }))
  await user.click(await screen.findByRole('button', { name: '이미지 new.png' }))
  await user.click(screen.getByRole('button', { name: '삽입' }))
  expect(onInsert).toHaveBeenCalledWith('<img src="new.png" alt="">')
})
