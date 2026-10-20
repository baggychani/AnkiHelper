import { expect, it } from 'vitest'
import { renameDesignDraftMedia } from './designDrafts'

it('rewrites every draft without altering similar filenames or replacement metacharacters', () => {
  const drafts = {
    'one:0:front': '<img src="old.png"><img src="prefix-old.png"><img src="old.png.bak">',
    'one:0:css': '.card { background: url(old.png) }',
    'two:0:back': '<img src="old.png">',
  }
  expect(renameDesignDraftMedia(drafts, 'old.png', '$&new.png')).toEqual({
    'one:0:front': '<img src="$&new.png"><img src="prefix-old.png"><img src="old.png.bak">',
    'one:0:css': '.card { background: url($&new.png) }',
    'two:0:back': '<img src="$&new.png">',
  })
  expect(renameDesignDraftMedia(drafts, 'absent.png', 'new.png')).toBe(drafts)
})

it('matches literal punctuation in a filename', () => {
  expect(renameDesignDraftMedia({ a: 'url(a[1].png)' }, 'a[1].png', 'b.png')).toEqual({ a: 'url(b.png)' })
})
