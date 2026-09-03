// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SpreadsheetImportWizard } from './SpreadsheetImportWizard'
import type { TablePreview } from '../api'

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

const preview: TablePreview = {
  source_name: '新HSK_1급.xlsx',
  kind: 'xlsx',
  sheet_names: ['Sheet1'],
  selected_sheet: 'Sheet1',
  row_count: 301,
  column_count: 9,
  omitted_empty_columns: 0,
  sample_rows: [Array.from({ length: 9 }, (_, index) => `col-${index}`)],
}

afterEach(() => {
  cleanup()
})

describe('SpreadsheetImportWizard layout', () => {
  it('keeps the source table pane fixed while the field list can scroll', () => {
    render(
      <SpreadsheetImportWizard
        initial={preview}
        onCancel={() => undefined}
        onSheetChange={async () => preview}
        onCreate={async () => undefined}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: 'Excel에서 새 덱 만들기' })
    const source = screen.getByText('원본 데이터').closest('section')
    const config = screen.getByText('덱과 필드 확인').closest('section')
    expect(source?.parentElement?.className).toContain('overflow-hidden')
    expect(source?.parentElement?.className).not.toContain('overflow-y-auto')
    expect(source?.className).toContain('overflow-hidden')
    expect(config?.className).toContain('overflow-y-auto')
    expect(dialog.querySelector('.flex-1.overflow-y-auto')).toBeNull()
  })
})
