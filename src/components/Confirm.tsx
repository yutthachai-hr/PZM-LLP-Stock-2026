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

  const close = (result: boolean) => {
    resolver.current(result)
    setOpts(null)
  }

  const phrase = opts?.typeToConfirm
  const unlocked = !phrase || typed.trim() === phrase

  return (
    <Ctx.Provider value={confirm}>
      {children}
      <Modal open={!!opts} onClose={() => close(false)} title={opts?.title ?? t('ยืนยัน')}>
        <p className="whitespace-pre-line text-sm text-ink-soft">{opts?.message}</p>

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
