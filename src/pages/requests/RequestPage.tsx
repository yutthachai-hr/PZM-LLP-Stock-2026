import { useCallback, useEffect, useRef, useState } from 'react'
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
  const shown = useRef<string | null>(null)
  // What the editor is keyed on. Stays 'new' after the lazy create so the editor does not
  // remount (and lose the cursor) when the URL moves from /new to the document.
  const editorKey = useRef('new')

  const load = useCallback(async () => {
    if (!id || id === 'new') {
      editorKey.current = 'new'
      setPr(null)
      return
    }
    // The editor creates the document lazily and moves the URL to it; the copy it handed
    // over is current, so do not refetch (that would remount the editor mid-typing).
    if (shown.current === id) return
    editorKey.current = id
    setPr(await getRequest(id))
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  if (pr === undefined) return <Spinner label={t('กำลังโหลด...')} />
  if (id && id !== 'new' && !pr) return <EmptyState icon="note" title={t('ไม่พบรายการขอสั่งซื้อ')} />

  const editable =
    !pr || (user && isRequesterEditable(pr.status) && canEditItems(pr, { id: user.id, role: user.role as Role }))
  const onChange = (next: PurchaseRequest) => {
    shown.current = next.id
    setPr(next)
  }
  if (editable) return <RequestEditor key={editorKey.current} initial={pr} onChange={onChange} />
  return <RequestReview key={pr!.id} initial={pr!} onChange={onChange} />
}
