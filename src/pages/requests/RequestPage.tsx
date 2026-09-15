import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { EmptyState, Spinner } from '../../components/ui'
import { useT } from '../../i18n/I18nContext'
import { canEditItems, isRequesterEditable } from '../../lib/purchaseRequestStatus'
import { getRequest } from '../../services/purchaseRequests'
import type { PurchaseRequest, Role } from '../../types'
import { RequestEditor } from './RequestEditor'
import { RequestReview } from './RequestReview'

/**
 * `/requests/new` and `/requests/:id`. A draft or a returned request that this person may
 * edit opens in the editor; everything else opens in the review — the manager's screen,
 * and the read-only one for everybody once it is decided.
 */
export function RequestPage() {
  const t = useT()
  const { id } = useParams()
  const { user } = useAuth()
  const [pr, setPr] = useState<PurchaseRequest | null | undefined>(undefined)

  const load = useCallback(async () => {
    if (!id || id === 'new') {
      setPr(null)
      return
    }
    setPr(await getRequest(id))
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  if (pr === undefined) return <Spinner label={t('กำลังโหลด...')} />
  if (id && id !== 'new' && !pr) return <EmptyState icon="note" title={t('ไม่พบรายการขอสั่งซื้อ')} />

  const editable =
    !pr || (user && isRequesterEditable(pr.status) && canEditItems(pr, { id: user.id, role: user.role as Role }))
  if (editable) return <RequestEditor key={pr?.id ?? 'new'} initial={pr} />
  return <RequestReview key={pr!.id} initial={pr!} onChange={setPr} />
}
