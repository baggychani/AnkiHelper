import { describe, expect, it } from 'vitest'

import { isNewerVersion } from './version'

describe('isNewerVersion', () => {
  it('detects a newer major, minor, or patch version', () => {
    expect(isNewerVersion('4.0.0', '3.0.0')).toBe(true)
    expect(isNewerVersion('3.1.0', '3.0.9')).toBe(true)
    expect(isNewerVersion('3.0.1', '3.0.0')).toBe(true)
  })

  it('detects an older or equal version as not newer', () => {
    expect(isNewerVersion('3.0.0', '3.0.0')).toBe(false)
    expect(isNewerVersion('2.9.9', '3.0.0')).toBe(false)
    expect(isNewerVersion('3.0.0', '3.0.1')).toBe(false)
  })

  it('ignores a leading "v" on either side', () => {
    expect(isNewerVersion('v3.1.0', '3.0.0')).toBe(true)
    expect(isNewerVersion('3.1.0', 'v3.0.0')).toBe(true)
    expect(isNewerVersion('V3.0.0', '3.0.0')).toBe(false)
  })

  it('strips build metadata and prerelease suffixes before comparing', () => {
    expect(isNewerVersion('3.1.0+build.5', '3.0.0')).toBe(true)
    expect(isNewerVersion('3.0.0-rc.1', '3.0.0')).toBe(false)
    expect(isNewerVersion('3.0.0', '3.0.0-rc.1')).toBe(false)
  })

  it('treats a missing trailing segment as zero', () => {
    expect(isNewerVersion('3.1', '3.0.9')).toBe(true)
    expect(isNewerVersion('3.0', '3.0.0')).toBe(false)
    expect(isNewerVersion('3.0.0', '3.0')).toBe(false)
  })

  it('falls back to zero for a non-numeric segment instead of throwing', () => {
    expect(isNewerVersion('3.x.0', '3.0.0')).toBe(false)
    expect(() => isNewerVersion('not-a-version', '3.0.0')).not.toThrow()
  })
})
