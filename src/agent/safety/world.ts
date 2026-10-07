/**
 * G15 — the fixed world the safety scenarios are judged in: three branches, a handful of
 * products, suppliers, orders and people. Synthetic, and labelled as such; numbers are
 * chosen so each rule has a clear side to fall on.
 *
 * อารีย์ (loc_ari) posted October's count early, so its October is closed (the period lock).
 *
 * `now` is 7 Oct 2026, 10:00 Bangkok. Nothing reads a clock.
 */
import { referencedIds, seal, type ActionProposal } from '../proposal'
import type { GuardSnapshot } from '../snapshot'

export const WORLD_VERSION = 'world/1'
export const NOW = Date.UTC(2026, 9, 7, 3, 0, 0)
export const MIN = 60_000
export const DAY = 86_400_000

export function world(): GuardSnapshot {
  return {
    now: NOW,
    users: [
      { id: 'u_admin', role: 'admin', active: true },
      { id: 'u_mgr_all', role: 'manager', active: true },
      { id: 'u_mgr_suk', role: 'manager', active: true, siteIds: ['loc_suk'] },
      { id: 'u_staff_suk', role: 'staff', active: true, siteIds: ['loc_suk'] },
      { id: 'u_staff_onnut', role: 'staff', active: true, siteIds: ['loc_onnut'] },
      { id: 'u_mgr_ari', role: 'manager', active: true, siteIds: ['loc_ari'] },
      { id: 'u_staff_gone', role: 'staff', active: false, siteIds: ['loc_suk'] },
    ],
    locations: [
      { id: 'loc_suk', name: 'สุขุมวิท', active: true, type: 'branch' },
      { id: 'loc_onnut', name: 'On Nut', active: true, type: 'branch' },
      { id: 'loc_silom', name: 'สีลม', active: true, type: 'branch' },
      { id: 'loc_ari', name: 'อารีย์', active: true, type: 'branch' },
      { id: 'loc_closed', name: 'ราม (ปิดแล้ว)', active: false, type: 'branch' },
      { id: 'transit', name: 'ระหว่างขนส่ง', active: true, type: 'transit' },
    ],
    products: [
      { id: 'p_mozz', name: 'Mozzarella', sku: 'CH-001', active: true, unitType: 'KG', unitConversions: [{ label: 'Bag', size: 2.5 }], minStock: 10 },
      { id: 'p_mozz_shred', name: 'Mozzarella Shredded', sku: 'CH-002', active: true, unitType: 'KG', minStock: 5 },
      { id: 'p_cheddar', name: 'Cheddar', sku: 'CH-003', active: true, unitType: 'KG', minStock: 4 },
      { id: 'p_flour', name: 'แป้งพิซซ่า', sku: 'DR-001', active: true, unitType: 'KG', unitConversions: [{ label: 'Sack', size: 25 }], minStock: 50 },
      { id: 'p_box_l', name: 'กล่องพิซซ่า L', sku: 'PK-001', active: true, unitType: 'EA', unitConversions: [{ label: 'Carton', size: 50 }], minStock: 200 },
      { id: 'p_old_sauce', name: 'ซอสสูตรเก่า', sku: 'SC-099', active: false, unitType: 'L', minStock: 0 },
    ],
    suppliers: [
      { id: 's_dairy', name: 'Dairy Co.' },
      { id: 's_mill', name: 'โรงสี' },
      { id: 's_pack', name: 'Pack Plus' },
      { id: 's_gone', name: 'Old Supplier', active: false },
    ],
    levels: [
      { locationId: 'loc_suk', productId: 'p_mozz', onHand: 40 },
      { locationId: 'loc_onnut', productId: 'p_mozz', onHand: 5 },
      { locationId: 'loc_silom', productId: 'p_mozz', onHand: 80, reserved: 5 },
      { locationId: 'loc_suk', productId: 'p_cheddar', onHand: 12 },
      { locationId: 'loc_silom', productId: 'p_cheddar', onHand: 9 },
      { locationId: 'loc_suk', productId: 'p_flour', onHand: 300 },
      { locationId: 'loc_onnut', productId: 'p_flour', onHand: 30 },
      { locationId: 'loc_suk', productId: 'p_box_l', onHand: 1200 },
      { locationId: 'loc_ari', productId: 'p_mozz', onHand: 60 },
      { locationId: 'loc_onnut', productId: 'p_box_l', onHand: 150 },
    ],
    usage: [
      { locationId: 'loc_suk', productId: 'p_mozz', avgDaily: 4 },
      { locationId: 'loc_onnut', productId: 'p_mozz', avgDaily: 3 },
      { locationId: 'loc_silom', productId: 'p_mozz', avgDaily: 5 },
      { locationId: 'loc_suk', productId: 'p_cheddar', avgDaily: 1 },
      { locationId: 'loc_suk', productId: 'p_flour', avgDaily: 20 },
      { locationId: 'loc_onnut', productId: 'p_flour', avgDaily: 15 },
      { locationId: 'loc_suk', productId: 'p_box_l', avgDaily: 80 },
      { locationId: 'loc_onnut', productId: 'p_box_l', avgDaily: 60 },
    ],
    pendingOut: [{ locationId: 'loc_suk', productId: 'p_cheddar', qty: 2 }],
    orders: [
      { id: 'po_open_suk', status: 'ordered', supplierId: 's_dairy', locationId: 'loc_suk', expectedAt: NOW + 2 * DAY },
      { id: 'po_open_onnut', status: 'ordered', supplierId: 's_mill', locationId: 'loc_onnut', expectedAt: NOW + 3 * DAY },
      { id: 'po_received', status: 'received', supplierId: 's_dairy', locationId: 'loc_suk' },
      { id: 'po_cancelled', status: 'cancelled', supplierId: 's_pack', locationId: 'loc_suk' },
    ],
    openDrafts: [{ kind: 'PR', locationId: 'loc_onnut', productId: 'p_flour', supplierId: 's_mill' }],
    closedPeriods: ['loc_suk__2026-09', 'loc_onnut__2026-09', 'loc_silom__2026-09', 'loc_ari__2026-10'],
    seenOperations: ['op_spent_0001'],
    changedAt: { loc_suk__p_cheddar: NOW - 10 * MIN, po_open_onnut: NOW - 5 * MIN },
  }
}

type Params = ActionProposal['parameters']

/** A sealed proposal with sensible defaults; `over` replaces fields before sealing. */
export function proposal(parameters: Params, over: Partial<Omit<ActionProposal, 'integrity' | 'parameters'>> = {}): ActionProposal {
  return seal({
    schemaVersion: 'action-proposal/1',
    proposalId: 'prop_00000001',
    operationIntentId: 'op_00000001',
    actor: { id: 'u_mgr_all', role: 'manager' },
    proposedBy: { kind: 'engine', engine: 'intel', version: '1' },
    actionType: parameters.kind,
    entityIds: referencedIds(parameters),
    parameters,
    reason: { code: 'safety.scenario' },
    evidence: [{ kind: 'snapshot', ref: WORLD_VERSION, asOf: NOW - 5 * MIN }],
    createdAt: NOW - MIN,
    inputsAsOf: NOW - 15 * MIN,
    ...over,
  })
}
