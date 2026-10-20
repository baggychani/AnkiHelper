import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { api, type NoteType } from '../src/api'
import { DesignPage } from '../src/pages/DesignPage'
import '../src/styles.css'

api.media = async () => [
  { name: 'photo.png', stored_name: '0', size: 123, type: 'image' },
  { name: 'voice.mp3', stored_name: '1', size: 123, type: 'audio' },
  { name: 'clip.mp4', stored_name: '2', size: 123, type: 'video' },
  { name: '_한글 폰트.woff2', stored_name: '3', size: 123, type: 'font' },
]
const initial: NoteType = {
  id: 'basic', name: 'Basic', fields: [{ name: 'Front', order: 0 }, { name: 'Back', order: 1 }, { name: '발음', order: 2 }], notes: [],
  templates: [{ name: '기본 카드', front: '<div class="card">\n  {{Front}}\n  <img src="photo.png">\n</div>', back: '{{FrontSide}}\n<hr>\n{{Back}}' }],
  css: '.card {\n  color: white;\n  background: #172239;\n}',
}

export function EditorHarness() {
  const [noteType, setNoteType] = useState(initial)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [index, setIndex] = useState(0)
  return <main className="h-screen bg-slate-100 p-6">
    <DesignPage noteType={noteType} index={index} setIndex={setIndex} drafts={drafts} setDrafts={setDrafts} notify={() => {}}
      onSave={async (mode, value) => {
        setNoteType((current) => mode === 'css' ? { ...current, css: value } : {
          ...current, templates: current.templates.map((template, i) => i === index ? { ...template, [mode]: value } : template),
        })
        return true
      }} />
    <output hidden data-testid="saved-front">{noteType.templates[0].front}</output>
    <output hidden data-testid="saved-css">{noteType.css}</output>
  </main>
}

createRoot(document.getElementById('root')!).render(<StrictMode><EditorHarness /></StrictMode>)
