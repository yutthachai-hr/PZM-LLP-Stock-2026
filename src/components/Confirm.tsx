import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { Button, Modal } from './ui'

interface ConfirmOptions {
  title?: string
  message: string
  confirmText?: string
  danger?: boolean
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>

const Ctx = createContext<ConfirmFn | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<(v: boolean) => void>(() => {})

  const confirm = useCallback<ConfirmFn>((options) => {
    setOpts(options)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const close = (result: boolean) => {
    resolver.current(result)
    setOpts(null)
  }

  return (
    <Ctx.Provider value={confirm}>
      {children}
      <Modal open={!!opts} onClose={() => close(false)} title={opts?.title ?? 'ยืนยัน'}>
        <p className="whitespace-pre-line text-sm text-slate-600">{opts?.message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => close(false)}>
            ยกเลิก
          </Button>
          <Button variant={opts?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
            {opts?.confirmText ?? 'ยืนยัน'}
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
