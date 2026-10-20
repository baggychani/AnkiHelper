import { act, screen } from '@testing-library/react'
import { EditorView } from '@codemirror/view'

export function editorView() {
  const dom = screen.getByLabelText('카드 템플릿 코드').closest('.cm-editor')!
  const view = EditorView.findFromDOM(dom as HTMLElement)
  if (!view) throw new Error('Code editor is not mounted')
  return view
}

export function codeValue() { return editorView().state.doc.toString() }

export function setCode(value: string) {
  const view = editorView()
  act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } }))
}
