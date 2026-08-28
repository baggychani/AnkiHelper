import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from './api'


afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('API client', () => {
  it('uses the local backend and parses successful JSON responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(null),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(api.status()).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8765/api/workspace',
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' } }),
    )
  })

  it('serializes package-open requests without losing Windows paths', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ source: 'C:\\Decks\\Turkish.apkg' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await api.open('C:\\Decks\\Turkish.apkg')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8765/api/packages/open',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ path: 'C:\\Decks\\Turkish.apkg' }),
      }),
    )
  })

  it('surfaces backend error details to the UI', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({ detail: 'APKG를 읽지 못했습니다.' }),
    }))

    await expect(api.open('broken.apkg')).rejects.toThrow('APKG를 읽지 못했습니다.')
  })

  it('uses a stable fallback when an error response is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: vi.fn().mockRejectedValue(new SyntaxError('not json')),
    }))

    await expect(api.status()).rejects.toThrow('요청을 처리하지 못했습니다.')
  })

  it('appends a media type query when exporting a filtered media zip', () => {
    expect(api.exportUrl('media', 'nt-1', 'audio')).toBe(
      'http://127.0.0.1:8765/api/note-types/nt-1/export/media?media_type=audio',
    )
    expect(api.exportUrl('media', 'nt-1')).toBe(
      'http://127.0.0.1:8765/api/note-types/nt-1/export/media',
    )
  })
})
