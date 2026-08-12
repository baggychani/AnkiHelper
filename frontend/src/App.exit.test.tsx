// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ExitConfirmModal } from './App'

afterEach(cleanup)

describe('ExitConfirmModal', () => {
  it('makes unsaved data loss explicit before exit', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const onConfirm = vi.fn()

    render(<ExitConfirmModal dirty onCancel={onCancel} onConfirm={onConfirm} />)

    const warning = screen.getByRole('alert')
    expect(warning.textContent).toContain('변경 내용이 저장되지 않았습니다')
    expect(warning.textContent).toContain('복구할 수 없습니다')

    await user.click(screen.getByRole('button', { name: '저장하지 않고 종료' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('keeps the clean-exit dialog concise', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()

    render(<ExitConfirmModal dirty={false} onCancel={onCancel} onConfirm={vi.fn()} />)

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('창을 닫으면 프로그램이 종료됩니다.')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '취소' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
