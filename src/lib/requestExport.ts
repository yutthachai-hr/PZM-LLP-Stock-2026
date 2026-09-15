import { exportExcel, exportReportPdf } from './export'
import { fmtQty, formatThaiDate } from './format'
import { liveItems } from './purchaseRequestStatus'
import type { PurchaseRequest, PurchaseRequestItem } from '../types'

/**
 * A purchase request as a file — the whole request, grouped by supplier, with the
 * approved quantity as the number that matters and the requested one beside it. This is
 * the manager's record of what was decided; it is not the sheet a supplier receives
 * (that is the order, made from it).
 */

type T = (key: string, vars?: Record<string, string | number>) => string

export function groupedBySupplier(pr: PurchaseRequest): { supplierName: string; items: PurchaseRequestItem[] }[] {
  const by = new Map<string, { supplierName: string; items: PurchaseRequestItem[] }>()
  for (const i of liveItems(pr.items)) {
    const g = by.get(i.supplierId) ?? { supplierName: i.supplierName, items: [] }
    g.items.push(i)
    by.set(i.supplierId, g)
  }
  return [...by.values()].sort((a, b) => a.supplierName.localeCompare(b.supplierName))
}

/** One row per line, for a spreadsheet that can be filtered and pivoted. */
export function requestRows(pr: PurchaseRequest, locationName: string, t: T): Record<string, string | number>[] {
  const rows: Record<string, string | number>[] = []
  for (const g of groupedBySupplier(pr)) {
    for (const i of g.items) {
      rows.push({
        [t('เลขที่ PR')]: pr.docNo,
        [t('วันที่ขอ')]: formatThaiDate(pr.createdAt),
        [t('คลัง')]: locationName,
        [t('ผู้ขาย')]: g.supplierName,
        [t('รหัสสินค้า')]: i.sku,
        [t('สินค้า')]: i.productName,
        [t('จำนวนที่ขอ')]: i.requestedQty ?? '',
        [t('จำนวนที่อนุมัติ')]: i.approvedQty ?? '',
        [t('หน่วย')]: i.entryUnit ?? i.unit,
        [t('ผู้ขอ')]: pr.requestedByName,
        [t('ผู้อนุมัติ')]: pr.approvedByName ?? '',
        [t('วันที่อนุมัติ')]: pr.approvedAt ? formatThaiDate(pr.approvedAt) : '',
        [t('หมายเหตุรายการ')]: [i.note, i.managerAdded ? t('หัวหน้าเพิ่ม') : '', i.supplierChoice === 'custom' ? t('เลือกผู้ขายเอง') : '']
          .filter(Boolean)
          .join(' · '),
      })
    }
  }
  return rows
}

export function exportRequestExcel(pr: PurchaseRequest, locationName: string, t: T): void {
  exportExcel(`${pr.docNo}.xlsx`, pr.docNo, requestRows(pr, locationName, t))
}

export function exportRequestPdf(pr: PurchaseRequest, company: string, locationName: string, t: T): void {
  const body: (string | number)[][] = []
  for (const g of groupedBySupplier(pr)) {
    for (const i of g.items) {
      body.push([
        g.supplierName,
        i.productName,
        i.sku,
        i.requestedQty === null ? '-' : fmtQty(i.requestedQty),
        i.approvedQty === undefined ? '-' : fmtQty(i.approvedQty),
        i.entryUnit ?? i.unit,
        [i.note, i.managerAdded ? t('หัวหน้าเพิ่ม') : ''].filter(Boolean).join(' · '),
      ])
    }
  }
  exportReportPdf({
    filename: `${pr.docNo}.pdf`,
    title: `${company} — ${t('รายการขอสั่งซื้อ')} ${pr.docNo}`,
    subtitle: `${t('วันที่ขอ')} ${formatThaiDate(pr.createdAt)} · ${t('คลัง')} ${locationName}`,
    meta: [
      `${t('ผู้ขอ')}: ${pr.requestedByName}`,
      pr.approvedByName
        ? `${t('ผู้อนุมัติ')}: ${pr.approvedByName} · ${t('วันที่อนุมัติ')} ${pr.approvedAt ? formatThaiDate(pr.approvedAt) : ''}`
        : `${t('สถานะ')}: ${pr.status}`,
      ...(pr.approvalNote ? [`${t('หมายเหตุการอนุมัติ')}: ${pr.approvalNote}`] : []),
    ],
    head: [t('ผู้ขาย'), t('สินค้า'), t('รหัสสินค้า'), t('จำนวนที่ขอ'), t('จำนวนที่อนุมัติ'), t('หน่วย'), t('หมายเหตุ')],
    body,
  })
}
