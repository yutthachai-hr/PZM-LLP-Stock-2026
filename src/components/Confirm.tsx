import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Button, Input, Modal } from './ui'
import { useT } from '../i18n/I18nContext'

/** shortcut: a guessed window, not a measured scanner gap; calibrate on the shop's scanners (HUMAN_PENDING). */
const SCAN_BURST_MS = 400

/** Callers pass text that is already translated — they have t() in hand at the call site. */
interface ConfirmOptions {
  title?: string
  message: string
  confirmText?: string
  danger?: boolean
  /**
   * Require the exact phrase to be typed before the action unlocks.
   *
   * For operations that destroy data with no way back. A dialog you can dismiss with one
   * reflexive click is not a safeguard once real stock counts are in the database.
   */
  typeToConfirm?: string
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>

const Ctx = createContext<ConfirmFn | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const t = useT()
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const [typed, setTyped] = useState('')
  const resolver = useRef<(v: boolean) => void>(() => {})
  const body = useRef<HTMLParagraphElement>(null)

  const confirm = useCallback<ConfirmFn>((options) => {
    setOpts(options)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  // Never carry a previous answer into the next dialog.
  useEffect(() => {
    if (opts) setTyped('')
  }, [opts])

  // Land the caret on the message, not on the ✕. A wedge scanner firing a second code while
  // this question is open ends with Enter, and an Enter that lands on a focused button
  // answers the question it was never meant to answer — it cancelled the pending scan
  // silently (R19). Nothing here is focusable-with-activation, so a stray burst does nothing
  // and the question stays open until a person answers it. (The phrase box auto-focuses
  // itself; a dialog that asks for typing keeps that.)
  useEffect(() => {
    if (opts && !opts.typeToConfirm) body.current?.focus()
  }, [opts])

  // A wedge scanner ending its codes in Tab walks focus ✕ -> Cancel -> answer in two bursts, and
  // the next Enter presses the answer (R29). While a question is open, a Tab that follows typed
  // characters within a burst window is swallowed; a person's deliberate Tab, a click, and the
  // phrase box of a typed confirmation are untouched.
  useEffect(() => {
    if (!opts) return
    let typedAt = -Infinity
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) typedAt = e.timeStamp
      else if (e.key === 'Tab' && e.timeStamp - typedAt < SCAN_BURST_MS) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [opts])

  const close = (result: boolean) => {
    resolver.current(result)
    setOpts(null)
  }

  const phrase = opts?.typeToConfirm
  const unlocked = !phrase || typed.trim() === phrase

  return (
    <Ctx.Provider value={confirm}>
      {children}
      <Modal open={!!opts} onClose={() => close(false)} title={opts?.title ?? t('ยืนยัน')} compact>
        <p ref={body} tabIndex={-1} className="whitespace-pre-line text-sm text-ink-soft outline-none">
          {opts?.message}
        </p>

        {phrase && (
          <div className="mt-4">
            <label className="mb-1 block text-sm text-ink">
              {t('พิมพ์ “{phrase}” เพื่อยืนยัน', { phrase })}
            </label>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoFocus
              placeholder={phrase}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && unlocked) close(true)
              }}
            />
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => close(false)}>
            {t('ยกเลิก')}
          </Button>
          <Button
            variant={opts?.danger ? 'danger' : 'primary'}
            onClick={() => close(true)}
            disabled={!unlocked}
          >
            {opts?.confirmText ?? t('ยืนยัน')}
          </Button>
        </div>
      </Modal>
    </Ctx.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider')
  return ctx
}
