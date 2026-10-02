/**
 * The morning digest shared into a LINE group (Automation Plan Phase 5 — owner, 25 Sep
 * 2026): LINE Personal through LIFF's share target picker only, no Official Account. Each
 * row carries a link that opens the page where the job is done.
 *
 * Pure: the numbers come from what the dashboard already holds. Two renderings of the same
 * digest — a Flex card for the LINE picker, plain text (links on their own lines) for a
 * phone's share sheet or the clipboard.
 */

export interface DigestRow {
  key: string
  label: string
  value: number
  /** Where tapping it goes, a path on this site. */
  path: string
  /** Worth colouring: something is waiting on someone. */
  alert?: boolean
}

export interface Digest {
  title: string
  subtitle: string
  rows: DigestRow[]
  /** The products closest to running out, by name — at most five. */
  low: string[]
  footer: string
}

type T = (s: string, v?: Record<string, string | number>) => string

export interface DigestInput {
  brandName: string
  dateText: string
  arrivingToday: number
  lateOrders: number
  pendingRequests: number
  pendingTransfers: number
  transfersOnTheWay: number
  lowStock: number
  lowNames: readonly string[]
  suggestedLines: number
}

export function buildDigest(input: DigestInput, t: T): Digest {
  const rows: DigestRow[] = [
    { key: 'arriving', label: t('ของจากผู้ขายถึงวันนี้'), value: input.arrivingToday, path: '/receive' },
    { key: 'late', label: t('ใบสั่งซื้อเลยกำหนดส่ง'), value: input.lateOrders, path: '/orders', alert: input.lateOrders > 0 },
    { key: 'pr', label: t('ใบขอสั่งซื้อรออนุมัติ'), value: input.pendingRequests, path: '/requests?filter=pendingApproval', alert: input.pendingRequests > 0 },
    { key: 'trPending', label: t('ใบโอนรออนุมัติ'), value: input.pendingTransfers, path: '/transfers?status=pendingApproval', alert: input.pendingTransfers > 0 },
    { key: 'trWay', label: t('ของกำลังส่งไปสาขา'), value: input.transfersOnTheWay, path: '/transfers/today' },
    { key: 'low', label: t('สินค้าใกล้หมด'), value: input.lowStock, path: '/products', alert: input.lowStock > 0 },
    { key: 'suggest', label: t('ข้อเสนอแนะให้สั่ง/โอน'), value: input.suggestedLines, path: '/' },
  ]
  return {
    title: t('สรุปประจำวัน — {brand}', { brand: input.brandName }),
    subtitle: input.dateText,
    rows,
    low: input.lowNames.slice(0, 5),
    footer: t('กดแต่ละหัวข้อเพื่อเปิดหน้าที่ต้องทำ'),
  }
}

function url(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, '')}${path}`
}

/** For the share sheet / clipboard: one line per row, the link under it. */
export function digestText(d: Digest, origin: string, t: T): string {
  const lines = [d.title, d.subtitle, '']
  for (const r of d.rows) {
    lines.push(`${r.alert ? '• ' : '  '}${r.label}: ${r.value}`)
    lines.push(`  ${url(origin, r.path)}`)
  }
  if (d.low.length) {
    lines.push('', t('ใกล้หมด: {names}', { names: d.low.join(', ') }))
  }
  return lines.join('\n')
}

/**
 * The Flex bubble: header, one tappable row per figure, the low-stock names. LINE only
 * opens https links from a card, so a local http address (a developer's machine) is not
 * made a button.
 */
export function digestFlex(d: Digest, origin: string): { altText: string; contents: Record<string, unknown> } {
  const linkable = /^https:\/\//.test(origin)
  const row = (r: DigestRow) => ({
    type: 'box',
    layout: 'horizontal',
    paddingAll: '8px',
    // A box's action needs no label (a button's would be cut at 20 characters).
    ...(linkable ? { action: { type: 'uri', uri: url(origin, r.path) } } : {}),
    contents: [
      { type: 'text', text: r.label, size: 'sm', color: '#555555', flex: 5, wrap: true },
      { type: 'text', text: String(r.value), size: 'md', weight: 'bold', align: 'end', flex: 1, color: r.alert ? '#C0392B' : '#111111' },
      ...(linkable ? [{ type: 'text', text: '›', size: 'md', align: 'end', flex: 0, color: '#999999' }] : []),
    ],
  })
  const body: Record<string, unknown>[] = d.rows.map(row)
  if (d.low.length) {
    body.push({ type: 'separator', margin: 'md' })
    body.push({ type: 'text', text: d.low.join(' · '), size: 'xs', color: '#888888', wrap: true, margin: 'md' })
  }
  return {
    altText: `${d.title} ${d.subtitle}`.slice(0, 400),
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#B91C1C',
        paddingAll: '14px',
        contents: [
          { type: 'text', text: d.title, weight: 'bold', size: 'md', color: '#FFFFFF', wrap: true },
          { type: 'text', text: d.subtitle, size: 'xs', color: '#FDE2E2' },
        ],
      },
      body: { type: 'box', layout: 'vertical', spacing: 'none', paddingAll: '8px', contents: body },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '10px',
        contents: [{ type: 'text', text: d.footer, size: 'xxs', color: '#999999', align: 'center', wrap: true }],
      },
    },
  }
}
