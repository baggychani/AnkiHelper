import { useLayoutEffect, useRef, useState } from 'react'
import { ImagePlus, Redo2, Search, Undo2, WrapText } from 'lucide-react'
import { basicSetup } from 'codemirror'
import { Compartment, EditorState, Transaction } from '@codemirror/state'
import { Decoration, EditorView, MatchDecorator, ViewPlugin, keymap, type ViewUpdate } from '@codemirror/view'
import { indentWithTab, isolateHistory, redo, redoDepth, temporarilySetTabFocusMode, undo, undoDepth } from '@codemirror/commands'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { openSearchPanel, search } from '@codemirror/search'
import { tags } from '@lezer/highlight'
import type { EditorMode } from '../designDrafts'
import { ankiFieldExtension } from '../editorHelpers'
import { MediaInsertDialog } from './MediaInsertDialog'

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: '#0d1425', color: '#d6e1f3', fontSize: '13px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, Consolas, monospace', lineHeight: '1.85' },
  '.cm-content': { padding: '16px 0 48px', caretColor: '#fff' },
  '.cm-line': { padding: '0 16px 0 10px' },
  '.cm-gutters': { backgroundColor: '#0d1425', color: '#64748b', borderRight: '1px solid #1e293b' },
  '.cm-activeLineGutter, .cm-activeLine': { backgroundColor: '#172239' },
  '.cm-cursor': { borderLeftColor: '#fff' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: '#334877 !important' },
  '.cm-matchingBracket': { backgroundColor: '#344466', color: '#fff' },
  '.cm-anki-field': { color: '#fbbf24' },
  '.cm-anki-media': { color: '#f5d0fe', backgroundColor: '#70368b40', borderBottom: '1px solid #c084fc', borderRadius: '3px' },
  '.cm-searchMatch': { backgroundColor: '#fbbf2440', outline: '1px solid #fbbf24' },
  '.cm-searchMatch-selected': { backgroundColor: '#c084fc60' },
  '.cm-panels': { backgroundColor: '#172239', color: '#e2e8f0' },
  '.cm-panel.cm-search': { padding: '10px 32px 10px 12px', lineHeight: '2.4' },
  '.cm-textfield': { backgroundColor: '#0d1425', color: '#fff', border: '1px solid #475569', borderRadius: '5px', padding: '3px 6px' },
  '.cm-button': { backgroundImage: 'none', backgroundColor: '#273653', color: '#e2e8f0', border: '1px solid #475569', borderRadius: '5px' },
  '.cm-tooltip': { backgroundColor: '#172239', color: '#e2e8f0', border: '1px solid #475569' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: '#4338ca', color: '#fff' },
}, { dark: true })

const syntax = syntaxHighlighting(HighlightStyle.define([
  { tag: [tags.tagName, tags.typeName], color: '#67e8f9' },
  { tag: [tags.attributeName, tags.propertyName], color: '#c4b5fd' },
  { tag: [tags.string, tags.attributeValue], color: '#a5d6a7' },
  { tag: [tags.keyword, tags.operator], color: '#f9a8d4' },
  { tag: [tags.number, tags.bool, tags.color], color: '#fcd34d' },
  { tag: tags.comment, color: '#94a3b8', fontStyle: 'italic' },
]))

function marks(regexp: RegExp, className: string) {
  const matcher = new MatchDecorator({ regexp, decoration: Decoration.mark({ class: className }) })
  return ViewPlugin.fromClass(class {
    decorations
    constructor(view: EditorView) { this.decorations = matcher.createDeco(view) }
    update(update: ViewUpdate) { this.decorations = matcher.updateDeco(update, this.decorations) }
  }, { decorations: (plugin) => plugin.decorations })
}

function mediaMarks(names: string[]) {
  if (!names.length) return []
  const escaped = [...new Set(names)].sort((a, b) => b.length - a.length).map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return marks(new RegExp(`(?<![\\w.-])(?:${escaped.join('|')})(?![\\w.-])`, 'g'), 'cm-anki-media')
}

const phrases = EditorState.phrases.of({
  'Find': '찾을 내용', 'Replace': '바꿀 내용', 'next': '다음', 'previous': '이전', 'all': '모두 선택',
  'match case': '대소문자 구분', 'regexp': '정규식', 'by word': '단어 단위',
  'replace': '바꾸기', 'replace all': '모두 바꾸기', 'close': '찾기 닫기',
  'Go to line': '줄로 이동', 'go': '이동', 'Fold line': '줄 접기', 'Unfold line': '줄 펼치기',
})

export function CodeEditor({ value, mode, mediaNames, fieldNames, onChange }: {
  value: string
  mode: EditorMode
  mediaNames: string[]
  fieldNames: string[]
  onChange: (value: string) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const compartments = useRef({ media: new Compartment(), wrapping: new Compartment(), fields: new Compartment() })
  const [wrapping, setWrapping] = useState(true)
  const [mediaOpen, setMediaOpen] = useState(false)
  const focusAfterInsert = useRef(false)
  const settings = useRef({ value, mode, mediaNames, fieldNames, onChange, wrapping })
  const createState = useRef<((value: string, selection?: number) => EditorState) | null>(null)
  const [status, setStatus] = useState({ line: 1, column: 1, undo: false, redo: false })

  useLayoutEffect(() => { settings.current = { value, mode, mediaNames, fieldNames, onChange, wrapping } }, [value, mode, mediaNames, fieldNames, onChange, wrapping])
  useLayoutEffect(() => {
    createState.current = (document, selection = 0) => EditorState.create({
      doc: document,
      selection: { anchor: selection },
      extensions: [
        basicSetup, settings.current.mode === 'css' ? css() : html(), theme, syntax, phrases,
        indentUnit.of('  '), EditorState.tabSize.of(2), search({ top: true }),
        keymap.of([indentWithTab, { key: 'Escape', run: temporarilySetTabFocusMode }]),
        EditorView.contentAttributes.of({ 'aria-label': '카드 템플릿 코드', spellcheck: 'false' }),
        marks(/\{\{[^}]+\}\}/g, 'cm-anki-field'),
        compartments.current.media.of(mediaMarks(settings.current.mediaNames)),
        compartments.current.fields.of(ankiFieldExtension(settings.current.fieldNames, settings.current.mode)),
        compartments.current.wrapping.of(settings.current.wrapping ? EditorView.lineWrapping : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) settings.current.onChange(update.state.doc.toString())
          if (update.docChanged || update.selectionSet) {
            const cursor = update.state.selection.main.head
            const line = update.state.doc.lineAt(cursor)
            setStatus({ line: line.number, column: cursor - line.from + 1, undo: undoDepth(update.state) > 0, redo: redoDepth(update.state) > 0 })
          }
        }),
      ],
    })
    const editor = new EditorView({ parent: host.current!, state: createState.current(settings.current.value) })
    view.current = editor
    return () => { editor.destroy(); view.current = null }
  }, [])

  useLayoutEffect(() => {
    const editor = view.current
    if (!editor || editor.state.doc.toString() === value) return
    // External rename/discard updates must not resurrect obsolete references
    // through undo. Preserve the configured extensions, but reset the history.
    const selection = Math.min(editor.state.selection.main.head, value.length)
    editor.setState(createState.current!(value, selection))
    const line = editor.state.doc.lineAt(selection)
    setStatus({ line: line.number, column: selection - line.from + 1, undo: false, redo: false })
  }, [value])

  useLayoutEffect(() => {
    view.current?.dispatch({ effects: compartments.current.media.reconfigure(mediaMarks(mediaNames)) })
  }, [mediaNames])
  useLayoutEffect(() => {
    view.current?.dispatch({ effects: compartments.current.wrapping.reconfigure(wrapping ? EditorView.lineWrapping : []) })
  }, [wrapping])
  useLayoutEffect(() => {
    view.current?.dispatch({ effects: compartments.current.fields.reconfigure(ankiFieldExtension(fieldNames, mode)) })
  }, [fieldNames, mode])
  useLayoutEffect(() => {
    if (!mediaOpen && focusAfterInsert.current) {
      focusAfterInsert.current = false
      view.current?.focus()
    }
  }, [mediaOpen])

  const insertMedia = (snippet: string) => {
    const editor = view.current
    if (!editor) return
    editor.dispatch({ ...editor.state.replaceSelection(snippet), scrollIntoView: true,
      annotations: [Transaction.userEvent.of('input'), isolateHistory.of('full')] })
    focusAfterInsert.current = true
    setMediaOpen(false)
  }

  const command = (run: (view: EditorView) => boolean) => {
    if (!view.current) return
    run(view.current)
    view.current.focus()
  }
  return <div className="flex min-h-0 flex-1 flex-col bg-[#0d1425]">
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-slate-700/50 px-3 py-2 text-xs text-slate-300">
      <button type="button" title="입력 실행 취소 (Ctrl+Z)" aria-label="입력 실행 취소" disabled={!status.undo} onClick={() => command(undo)} className="rounded p-1.5 hover:bg-white/10 disabled:opacity-30"><Undo2 size={15} /></button>
      <button type="button" title="다시 실행 (Ctrl+Shift+Z)" aria-label="다시 실행" disabled={!status.redo} onClick={() => command(redo)} className="rounded p-1.5 hover:bg-white/10 disabled:opacity-30"><Redo2 size={15} /></button>
      <button type="button" onClick={() => { if (view.current) openSearchPanel(view.current) }} className="ml-2 inline-flex items-center gap-2 rounded px-2 py-1.5 hover:bg-white/10"><Search size={14} />찾기·바꾸기 <span className="text-slate-500">Ctrl+F</span></button>
      <button type="button" onClick={() => setMediaOpen(true)} className="inline-flex items-center gap-2 rounded px-2 py-1.5 hover:bg-white/10"><ImagePlus size={14} />미디어 삽입</button>
      <button type="button" aria-pressed={wrapping} onClick={() => setWrapping((current) => !current)} className={`ml-auto inline-flex items-center gap-1.5 rounded px-2 py-1.5 ${wrapping ? 'bg-indigo-400/15 text-indigo-200' : 'text-slate-400 hover:bg-white/10'}`}><WrapText size={14} />자동 줄바꿈</button>
    </div>
    <div ref={host} className="min-h-0 flex-1 overflow-hidden" />
    <div className="flex shrink-0 flex-wrap justify-between gap-2 border-t border-slate-700/50 px-4 py-2 text-[11px] text-slate-400">
      <span>{mode === 'css' ? 'CSS' : 'HTML'} · {status.line}행 {status.column}열</span>
      <span>Tab / Shift+Tab 들여쓰기 · Esc 후 Tab으로 편집기 나가기</span>
    </div>
    {mediaOpen && <MediaInsertDialog mode={mode} onInsert={insertMedia} onClose={() => setMediaOpen(false)} />}
  </div>
}
