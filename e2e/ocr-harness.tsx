import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { readDocumentFile } from '../src/services/billOcr'

export function OcrHarness() {
  const [status, setStatus] = useState<'idle' | 'reading' | 'success' | 'error'>('idle')
  const [result, setResult] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setStatus('reading')
    setError(null)
    setResult(null)
    try {
      const bill = await readDocumentFile(file)
      setResult(bill)
      setStatus('success')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>OCR Fallback QA Harness</h1>
      <input type="file" data-testid="ocr-input" onChange={handleFile} />
      <div data-testid="ocr-status">{status}</div>
      {error && <div data-testid="ocr-error">{error}</div>}
      {result && <pre data-testid="ocr-result">{JSON.stringify(result, null, 2)}</pre>}
    </div>
  )
}

const root = createRoot(document.getElementById('root')!)
root.render(<OcrHarness />)
