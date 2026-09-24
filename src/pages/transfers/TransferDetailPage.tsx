import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { EmptyState, Spinner } from '../../components/ui'
import { useT } from '../../i18n/I18nContext'
import { canEditItems } from '../../lib/transferStatus'
import { transferCache } from '../../data/transferCache'
import { getTransfer } from '../../services/transfers'
import type { Transfer, Role } from '../../types'
import { TransferEditor } from './TransferEditor'
import { TransferDetailView } from './TransferDetailView'

export function TransferDetailPage() {
  const t = useT()
  const { id } = useParams()
  const { user } = useAuth()
  const [transfer, setTransfer] = useState<Transfer | null | undefined>(undefined)
  const shown = useRef<string | null>(null)
  const editorKey = useRef('new')

  const load = useCallback(async () => {
    if (!id || id === 'new') {
      editorKey.current = 'new'
      setTransfer(null)
      return
    }
    if (shown.current === id) return
    editorKey.current = id
    const res = await getTransfer(id)
    setTransfer(res)
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  if (transfer === undefined) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner label={t('กำลังโหลด...')} />
      </div>
    )
  }

  if (id && id !== 'new' && !transfer) {
    return (
      <div className="p-8">
        <EmptyState icon="swap" title={t('ไม่พบเอกสารโอนสินค้า')} />
      </div>
    )
  }

  const editable =
    !transfer ||
    (user &&
      (transfer.status === 'draft' || transfer.status === 'returned') &&
      canEditItems(transfer, { id: user.id, role: user.role as Role }))

  const onChange = (next: Transfer) => {
    shown.current = next.id
    setTransfer(next)
    transferCache.patch(next)
  }

  if (editable) {
    return <TransferEditor key={editorKey.current} initial={transfer} onChange={onChange} />
  }

  return <TransferDetailView key={transfer!.id} initial={transfer!} onChange={onChange} />
}
