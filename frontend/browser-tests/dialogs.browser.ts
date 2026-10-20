import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('http://127.0.0.1:1420/browser-tests/dialog-harness.html')
})

test('a confirmation moves focus inside, contains Tab navigation, blocks background focus and restores its opener', async ({ page }) => {
  const opener = page.getByRole('button', { name: '삭제 열기' })
  await opener.click()
  const dialog = page.getByRole('dialog', { name: '삭제 확인' })
  await expect(dialog).toHaveAttribute('aria-describedby', /.+/)
  await expect(dialog.getByRole('button', { name: '취소' })).toBeFocused()
  for (let index = 0; index < 5; index++) {
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  }
  await page.keyboard.press('Shift+Tab')
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  await page.locator('input').evaluate((input: HTMLInputElement) => input.focus())
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()
})

test('an error opens above a pending-work dialog and closing it restores the underlying action', async ({ page }, testInfo) => {
  const opener = page.getByRole('button', { name: '새 작업 열기' })
  await opener.click()
  const pending = page.getByRole('dialog', { name: '새 작업 시작' })
  await pending.getByRole('button', { name: '저장 후 계속' }).click()
  const error = page.getByRole('dialog', { name: '저장 실패' })
  await expect(error.getByRole('button', { name: '확인' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(error).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('stacked-dialogs.png') })
  await error.getByRole('button', { name: '확인' }).click()
  await expect(pending).toBeVisible()
  await expect(pending.getByRole('button', { name: '저장 후 계속' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(opener).toBeFocused()
})

test('exit and update dialogs close with Escape and return keyboard focus', async ({ page }) => {
  for (const label of ['종료 열기', '업데이트 열기']) {
    const opener = page.getByRole('button', { name: label })
    await opener.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(opener).toBeFocused()
  }
})
