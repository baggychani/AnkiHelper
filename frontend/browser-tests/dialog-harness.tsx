import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ExitConfirmModal, Modal, UnsavedWorkModal, UpdateAvailableModal } from '../src/components/Modal'
import '../src/styles.css'

export function Harness() {
  const [kind, setKind] = useState('')
  const [error, setError] = useState(false)
  return <>
    <button onClick={() => setKind('confirm')}>삭제 열기</button>
    <button onClick={() => setKind('unsaved')}>새 작업 열기</button>
    <button onClick={() => setKind('exit')}>종료 열기</button>
    <button onClick={() => setKind('update')}>업데이트 열기</button>
    <input aria-label="배경 입력" />
    {kind === 'confirm' && <Modal title="삭제 확인" description="선택한 항목을 삭제합니다." tone="danger" confirmLabel="삭제" onCancel={() => setKind('')} onConfirm={() => setKind('')} />}
    {kind === 'unsaved' && <UnsavedWorkModal onCancel={() => setKind('')} onDiscard={() => setKind('')} onSave={() => setError(true)} />}
    {kind === 'exit' && <ExitConfirmModal dirty onCancel={() => setKind('')} onConfirm={() => setKind('')} />}
    {kind === 'update' && <UpdateAvailableModal update={{ version: '4.0.0', url: 'https://example.invalid/' }} onDismiss={() => setKind('')} onOpen={() => setKind('')} />}
    {error && <Modal title="저장 실패" description="다시 시도해 주세요." tone="danger" confirmLabel="확인" onConfirm={() => setError(false)} />}
  </>
}

createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>)
