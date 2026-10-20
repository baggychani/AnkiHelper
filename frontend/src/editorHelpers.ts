import { autocompletion, completeFromList, pickedCompletion, type Completion, type CompletionSource } from '@codemirror/autocomplete'
import { Transaction } from '@codemirror/state'
import type { MediaItem } from './api'
import type { EditorMode } from './designDrafts'

export function ankiFieldCompletion(fields: string[], mode: EditorMode): CompletionSource {
  return (context) => {
    if (mode === 'css') return null
    const match = context.matchBefore(/\{\{[#^/]?[^{}\n]*$/)
    if (!match) return null
    const prefix = match.text.match(/^\{\{([#^/]?)/)![1]
    const names = [...new Set([...fields, ...(mode === 'back' && !prefix ? ['FrontSide'] : [])])]
    return {
      from: match.from + 2 + prefix.length,
      options: names.map((name) => ({
        label: name, type: 'variable', detail: name === 'FrontSide' && !fields.includes(name) ? '앞면 전체' : 'Anki 필드',
        apply(view, completion, from, to) {
          // Complete inside an existing tag without leaving its suffix or }} behind.
          const tail = view.state.sliceDoc(to, view.state.doc.lineAt(to).to)
          const suffix = tail.match(/^[^{}\n]*\}\}/)?.[0] ?? tail.match(/^\}{1,2}/)?.[0] ?? ''
          const insert = `${name}}}`
          view.dispatch({ changes: { from, to: to + suffix.length, insert }, selection: { anchor: from + insert.length },
            annotations: [Transaction.userEvent.of('input.complete'), pickedCompletion.of(completion)] })
        },
      })),
      validFor: /^[^{}#^/\n]*$/,
    }
  }
}

export function ankiFieldExtension(fields: string[], mode: EditorMode) {
  const fieldsSource = ankiFieldCompletion(fields, mode)
  return autocompletion({ override: [async (context) => {
    const fieldResult = fieldsSource(context)
    if (fieldResult) return fieldResult
    // Inside {{...}}, HTML's explicit Ctrl+Space suggestions would crowd out
    // the fields. Elsewhere retain the active HTML/CSS/embedded JS language source.
    const sources = context.state.languageDataAt<CompletionSource | readonly Completion[]>('autocomplete', context.pos)
    for (const source of sources) {
      const result = await (typeof source === 'function' ? source : completeFromList(source))(context)
      if (result) return result
    }
    return null
  }] })
}

const htmlAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const cssString = (value: string) => value.replace(/[\\"\n\r\f<>]/g, (char) => `\\${char.charCodeAt(0).toString(16)} `)

export function mediaSnippet(item: MediaItem, mode: EditorMode): string {
  if (item.type === 'font') {
    const family = cssString(item.name.replace(/\.[^.]+$/, ''))
    const rule = `@font-face {\n  font-family: "${family}";\n  src: url("${cssString(item.name)}");\n}`
    return mode === 'css' ? rule : `<style>\n${rule}\n</style>`
  }
  if (mode === 'css') return `background-image: url("${cssString(item.name)}");`
  if (item.type === 'image') return `<img src="${htmlAttribute(item.name)}" alt="">`
  // Use Anki's playback syntax, with an HTML fallback for a literal closing bracket.
  if (!item.name.includes(']')) return `[sound:${item.name}]`
  return `<${item.type} controls src="${htmlAttribute(item.name)}"></${item.type}>`
}
