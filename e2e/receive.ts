import { expect, type Page } from '@playwright/test'

/** Fill a full receipt of the open order on the receive screen, up to the confirm button. */
export async function prepareFullReceipt(page: Page, invoiceNo: string): Promise<void> {
  await page.getByRole('button', { name: 'รับครบตาม PO ทั้งหมด' }).click()
  await page.getByLabel(/เลขที่เอกสาร \/ ใบกำกับ/).fill(invoiceNo)
  await page.getByRole('button', { name: 'ตรวจสอบและรับสินค้า' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
}

export function confirmButton(page: Page) {
  return page.getByRole('dialog').getByRole('button', { name: 'ยืนยันรับเข้าคลัง' })
}
