import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { useData } from '../../data/DataContext'
import { useToast } from '../../components/Toast'
import { useT } from '../../i18n/I18nContext'
import { errText } from '../../i18n/AppError'
import { defaultBlock, parseOrderWorkbook, type ColumnMapping, type OrderBlock } from '../../lib/orderSheet'
import { buildMatchIndex, matchProduct } from '../../lib/productMatch'
import { assessRows, buildBatchRows, hashFile, rowState } from '../../services/purchaseBatch'
import { saveAlias } from '../../services/productAliases'
import { updateProduct } from '../../services/products'
import type { BatchRow, Product } from '../../types'
import type { ResolveResult } from './ResolveRowModal'
import { useAssessContext } from './useAssessContext'

const LS_MAPPING = 'pmstock:purchase:mapping'

export function remembered<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function remember(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // A device that refuses storage just asks again next time.
  }
}

function forget(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* nothing kept */
  }
}

/**
 * The order workbook read and every row judged, for a screen that turns it into something:
 * a batch of orders (PurchaseImport) or the lines of a purchase request (RequestExcelImport,
 * owner, 2 Oct 2026). Both read the file, pick the order round, and let a person settle each
 * row in place with the resolve dialog; what they do with the rows after that is theirs.
 *
 * Answers given on a row are kept on the device under `editsPrefix` + the file's hash + the
 * round, so closing the screen loses nothing; `clearEdits` drops them once they are used.
 */
export function useWorkbookRows(editsPrefix: string) {
  const t = useT()
  const toast = useToast()
  const { user } = useAuth()
  const { products } = useData()
  const assess = useAssessContext()
  const { ctx, aliases, reload: reloadCtx } = assess

  const [fileName, setFileName] = useState('')
  const [fileBytes, setFileBytes] = useState<ArrayBuffer | null>(null)
  const [fileHash, setFileHash] = useState('')
  const [blocks, setBlocks] = useState<OrderBlock[]>([])
  const [blockIdx, setBlockIdx] = useState(0)
  const [mapping, setMapping] = useState<ColumnMapping | null>(null)
  const [mappingForm, setMappingForm] = useState<ColumnMapping>(
    () => remembered<ColumnMapping>(LS_MAPPING) ?? { name: 'A', qty: 'C', unit: 'B', note: '' },
  )
  const [needsMapping, setNeedsMapping] = useState(false)
  const [reading, setReading] = useState(false)

  const [edits, setEdits] = useState<Record<number, BatchRow>>({})
  const [resolving, setResolving] = useState<BatchRow | null>(null)
  const editsKey = fileHash ? `${editsPrefix}${fileHash}:${blockIdx}` : ''
  useEffect(() => {
    setEdits((editsKey && remembered<Record<number, BatchRow>>(editsKey)) || {})
  }, [editsKey])
  function keepEdits(next: Record<number, BatchRow>) {
    setEdits(next)
    if (editsKey) remember(editsKey, next)
  }

  const block = blocks[blockIdx] ?? null

  /** The rows as a batch would hold them — built and judged the same way the batch does. */
  const rows = useMemo<BatchRow[] | null>(() => {
    if (!block || !ctx) return null
    return assessRows(
      buildBatchRows(block, products, aliases).map((r) => edits[r.idx] ?? r),
      ctx,
    )
  }, [block, ctx, products, aliases, edits])

  const counts = useMemo(() => {
    const c = { ready: 0, review: 0, blocked: 0, skipped: 0 }
    for (const r of rows ?? []) c[rowState(r)]++
    return c
  }, [rows])

  /** The closest product for a row nothing was matched to — shown, never taken. */
  const index = useMemo(() => buildMatchIndex(products, aliases), [products, aliases])
  const nearest = (r: BatchRow): Product | undefined =>
    r.productId ? undefined : matchProduct(r.rawName, index).candidates[0]?.product

  async function resolved(r: ResolveResult) {
    if (!user) return
    const actor = { id: user.id, name: user.name }
    try {
      if (r.saveAlias && r.row.productId) await saveAlias({ sourceName: r.row.rawName, productId: r.row.productId, actor })
      if (r.setPrimary && r.row.productId && r.row.supplierId) await updateProduct(r.row.productId, { supplierId: r.row.supplierId })
      keepEdits({ ...edits, [r.row.idx]: r.row })
      setResolving(null)
      if (r.saveAlias) await reloadCtx()
    } catch (e) {
      toast.error(errText(e, t))
    }
  }

  function parse(bytes: ArrayBuffer, map: ColumnMapping | null) {
    const parsed = parseOrderWorkbook(bytes, map ?? undefined)
    setBlocks(parsed.blocks)
    const def = defaultBlock(parsed.blocks)
    setBlockIdx(def ? parsed.blocks.indexOf(def) : 0)
    setNeedsMapping(parsed.blocks.length === 0)
  }

  /** Read a picked file. Returns its hash, or null when it could not be read. */
  async function pickFile(file: File): Promise<string | null> {
    if (!/\.xlsx?$/i.test(file.name)) {
      toast.error(t('อ่านไฟล์ไม่ได้ — ต้องเป็นไฟล์ Excel (.xlsx หรือ .xls)'))
      return null
    }
    setReading(true)
    try {
      const bytes = await file.arrayBuffer()
      setFileName(file.name)
      setFileBytes(bytes)
      setMapping(null)
      parse(bytes, null)
      const hash = await hashFile(bytes)
      setFileHash(hash)
      return hash
    } catch (err) {
      toast.error(errText(err, t))
      return null
    } finally {
      setReading(false)
    }
  }

  function applyMapping() {
    if (!fileBytes) return
    const map: ColumnMapping = {
      name: mappingForm.name.trim(),
      qty: mappingForm.qty.trim(),
      ...(mappingForm.unit?.trim() ? { unit: mappingForm.unit.trim() } : {}),
      ...(mappingForm.note?.trim() ? { note: mappingForm.note.trim() } : {}),
    }
    setMapping(map)
    remember(LS_MAPPING, map)
    parse(fileBytes, map)
  }

  function clearEdits() {
    if (editsKey) forget(editsKey)
    setEdits({})
  }

  return {
    ...assess,
    fileName,
    fileHash,
    fileLoaded: !!fileBytes,
    reading,
    blocks,
    block,
    blockIdx,
    setBlockIdx,
    mapping,
    mappingForm,
    setMappingForm,
    needsMapping,
    applyMapping,
    pickFile,
    rows,
    counts,
    nearest,
    resolving,
    setResolving,
    resolved,
    clearEdits,
  }
}
