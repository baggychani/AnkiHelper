// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { FieldLinkDialog } from './FieldLinkDialog'

afterEach(cleanup)

it('connects a design field to a current field and leaves the others unchanged', async () => {
  const user = userEvent.setup()
  const onApply = vi.fn()
  render(<FieldLinkDialog sources={['Word', 'Meaning']} destinations={['단어', '뜻']} onCancel={vi.fn()} onApply={onApply} />)

  await user.click(screen.getByRole('button', { name: 'Word' }))
  await user.click(screen.getByRole('button', { name: '단어' }))
  await user.click(screen.getByRole('button', { name: '이 연결로 가져오기' }))

  expect(onApply).toHaveBeenCalledWith({ Word: '단어' })
})
