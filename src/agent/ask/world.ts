/**
 * Ask PZM — a synthetic read-only world for tests and the benchmark. Names follow PZM's real
 * branches and catalogue vocabulary; every number is made up. No production data.
 */
import type { AskSnapshot } from './answer'

const DAY = 86_400_000
const T = Date.UTC(2026, 9, 9, 3)

export const WORLD: AskSnapshot = {
  asOf: T,
  sites: [
    { id: 'onnut', name: 'อ่อนนุช', aliases: ['On Nut', 'onnut', 'อ่อนนุท'] },
    { id: 'sukhumvit', name: 'สุขุมวิท', aliases: ['Sukhumvit', 'สุขุมวิท 24'] },
    { id: 'silom', name: 'สีลม', aliases: ['Silom'] },
    { id: 'ari', name: 'อารีย์', aliases: ['Ari'] },
    { id: 'ck', name: 'ครัวกลาง', aliases: ['central kitchen', 'CK', 'commissary'] },
  ],
  products: [
    { id: 'p-feta', sku: 'CH-007', name: 'Feta', aliases: ['เฟต้า', 'feta cheese', 'ชีสเฟต้า'], unit: 'kg' },
    { id: 'p-mozz', sku: 'CH-001', name: 'Mozzarella', aliases: ['มอสซาเรลล่า', 'มอส', 'mozz'], unit: 'kg' },
    { id: 'p-flour', sku: 'DR-001', name: 'แป้งพิซซ่า', aliases: ['pizza flour', 'flour', 'แป้ง'], unit: 'ถุง' },
    { id: 'p-box', sku: 'PK-001', name: 'กล่องพิซซ่า L', aliases: ['large pizza box', 'pizza box', 'กล่อง L'], unit: 'ใบ' },
    { id: 'p-sauce', sku: 'SC-010', name: 'ซอสมะเขือเทศ', aliases: ['tomato sauce', 'ซอส'], unit: 'ลิตร' },
    { id: 'p-pep', sku: 'MT-004', name: 'Pepperoni', aliases: ['เปปเปอโรนี', 'pepperoni'], unit: 'kg' },
  ],
  balances: [
    { productId: 'p-feta', siteId: 'onnut', qty: 3.5 },
    { productId: 'p-feta', siteId: 'silom', qty: 1.2 },
    { productId: 'p-mozz', siteId: 'onnut', qty: 12 },
    { productId: 'p-mozz', siteId: 'sukhumvit', qty: 4 },
    { productId: 'p-flour', siteId: 'onnut', qty: 9 },
    { productId: 'p-flour', siteId: 'ck', qty: 40 },
    { productId: 'p-box', siteId: 'ari', qty: 120 },
    { productId: 'p-sauce', siteId: 'silom', qty: 6 },
    { productId: 'p-pep', siteId: 'sukhumvit', qty: 2 },
  ],
  usage: [
    { productId: 'p-feta', siteId: 'onnut', perDay: 0.4 },
    { productId: 'p-feta', siteId: 'silom', perDay: 0.5 },
    { productId: 'p-mozz', siteId: 'onnut', perDay: 1.5 },
    { productId: 'p-mozz', siteId: 'sukhumvit', perDay: 1.2 },
    { productId: 'p-flour', siteId: 'onnut', perDay: 1 },
    { productId: 'p-box', siteId: 'ari', perDay: 10 },
    { productId: 'p-sauce', siteId: 'silom', perDay: 0.5 },
    { productId: 'p-pep', siteId: 'sukhumvit', perDay: 0.8 },
  ],
  orders: [
    { docNo: 'PO-00412', supplierName: 'Siam Dairy', status: 'ordered', locationId: 'onnut', orderedAt: T - 2 * DAY },
    { docNo: 'PO-00415', supplierName: 'BKK Flour Mill', status: 'ordered', locationId: 'ck', orderedAt: T - DAY, supplierConfirmedAt: T - DAY / 2 },
    { docNo: 'PO-00418', supplierName: 'Pack&Go', status: 'ordered', locationId: 'ari', orderedAt: T - 3 * DAY },
    { docNo: 'PO-00401', supplierName: 'Siam Dairy', status: 'received', locationId: 'silom', orderedAt: T - 9 * DAY },
  ],
  transfers: [
    { docNo: 'TR-00088', fromId: 'ck', toId: 'onnut', status: 'inTransit' },
    { docNo: 'TR-00089', fromId: 'ck', toId: 'silom', status: 'pendingApproval' },
    { docNo: 'TR-00080', fromId: 'ck', toId: 'ari', status: 'completed' },
  ],
}
