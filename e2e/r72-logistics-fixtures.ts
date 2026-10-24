import type { Page } from '@playwright/test'

export const R72_TRANSFER_DOC_NO = 'TR-00001'
export const R72_TRANSFER_INTERNAL_ID = 'transfer-r72-internal-id-998877'
export const R72_ACTOR_ID = 'r72-logistics-user'
export const R72_LOCATION_FROM = 'wh'
export const R72_LOCATION_TO = 'br'
export const R72_DECIMAL_QTY = 1.063

export const PHONE_WIDTHS = [320, 360, 375, 390, 414, 430] as const

export interface R72ItemSpec {
  idx: number
  productId: string
  sku: string
  productName: string
  unit: string
  unitType: string
  qty: number
  cost: number | null
}

export const R72_ITEMS: R72ItemSpec[] = [
  {
    idx: 0,
    productId: 'pzm-item-01',
    sku: 'SKU-PZM-FLOUR-WHEAT-25KG-LOT20261025-001',
    productName: 'แป้งสาลีอเนกประสงค์พิเศษ ตรายานอวกาศ (Special All-Purpose Wheat Flour Spacecraft Brand 25kg)',
    unit: 'KG',
    unitType: 'KG',
    qty: R72_DECIMAL_QTY,
    cost: 37.25,
  },
  {
    idx: 1,
    productId: 'pzm-item-02',
    sku: 'SKU-PZM-CHEESE-MOZZ-10KG-LOT20261025-002',
    productName: 'มอสซาเรลล่าชีส (Mozzarella)',
    unit: 'KG',
    unitType: 'KG',
    qty: 5.5,
    cost: null, // explicit null to verify honest null vs 0
  },
  {
    idx: 2,
    productId: 'pzm-item-03',
    sku: 'SKU-PZM-SAUCE-TOMATO-5KG-LOT20261025-003',
    productName: 'ซอสมะเขือเทศเข้มข้นสูตรต้นตำรับพิซซ่า (Original Concentrated Pizza Tomato Sauce 5kg)',
    unit: 'KG',
    unitType: 'KG',
    qty: 12.0,
    cost: 45.0,
  },
  {
    idx: 3,
    productId: 'pzm-item-04',
    sku: 'SKU-PZM-MEAT-PEPPERONI-1KG-LOT20261025-004',
    productName: 'เปปเปอโรนี (Pepperoni)',
    unit: 'KG',
    unitType: 'KG',
    qty: 8.0,
    cost: 150.0,
  },
  {
    idx: 4,
    productId: 'pzm-item-05',
    sku: 'SKU-PZM-MEAT-SAUSAGE-2KG-LOT20261025-005',
    productName: 'ไส้กรอกอิตาเลียนรสเผ็ดสูตรพรีเมียม (Spicy Italian Sausage Crumbles Premium Recipe 2kg)',
    unit: 'KG',
    unitType: 'KG',
    qty: 6.0,
    cost: 95.0,
  },
  {
    idx: 5,
    productId: 'pzm-item-06',
    sku: 'SKU-PZM-VEG-PEPPERS-1KG-LOT20261025-006',
    productName: 'พริกหวานสามสี (Bell Peppers)',
    unit: 'KG',
    unitType: 'KG',
    qty: 4.0,
    cost: 60.0,
  },
  {
    idx: 6,
    productId: 'pzm-item-07',
    sku: 'SKU-PZM-VEG-ONION-5KG-LOT20261025-007',
    productName: 'หอมหัวใหญ่สไลซ์เส้นสดคัดพิเศษ (Special Selection Fresh Sliced Yellow Onion 5kg)',
    unit: 'KG',
    unitType: 'KG',
    qty: 10.0,
    cost: 25.0,
  },
  {
    idx: 7,
    productId: 'pzm-item-08',
    sku: 'SKU-PZM-VEG-MUSHROOM-3KG-LOT20261025-008',
    productName: 'เห็ดแชมปิญอง (Mushrooms)',
    unit: 'KG',
    unitType: 'KG',
    qty: 5.0,
    cost: 80.0,
  },
  {
    idx: 8,
    productId: 'pzm-item-09',
    sku: 'SKU-PZM-FRUIT-PINEAPPLE-3KG-LOT20261025-009',
    productName: 'สับปะรดชิ้นในน้ำเชื่อมสูตรหวานน้อย (Pineapple Tidbits in Light Syrup Less Sweet 3.05kg)',
    unit: 'KG',
    unitType: 'KG',
    qty: 7.0,
    cost: 40.0,
  },
  {
    idx: 9,
    productId: 'pzm-item-10',
    sku: 'SKU-PZM-MEAT-BACON-1KG-LOT20261025-010',
    productName: 'เบคอน (Bacon)',
    unit: 'KG',
    unitType: 'KG',
    qty: 6.0,
    cost: 130.0,
  },
  {
    idx: 10,
    productId: 'pzm-item-11',
    sku: 'SKU-PZM-MEAT-HAM-2KG-LOT20261025-011',
    productName: 'แฮมรมควันเกรดพรีเมียมสไลซ์เหลี่ยม (Premium Square Sliced Smoked Ham for Pizza 2kg)',
    unit: 'KG',
    unitType: 'KG',
    qty: 8.0,
    cost: 110.0,
  },
  {
    idx: 11,
    productId: 'pzm-item-12',
    sku: 'SKU-PZM-CHEESE-PARMESAN-1KG-LOT20261025-012',
    productName: 'พาร์มีซานชีส (Parmesan)',
    unit: 'KG',
    unitType: 'KG',
    qty: 3.0,
    cost: 210.0,
  },
  {
    idx: 12,
    productId: 'pzm-item-13',
    sku: 'SKU-PZM-CHEESE-CHEDDAR-2KG-LOT20261025-013',
    productName: 'เชดดาร์ชีสสีส้มขูดเส้นนำเข้า (Imported Shredded Orange Red Cheddar Cheese 2kg)',
    unit: 'KG',
    unitType: 'KG',
    qty: 4.0,
    cost: 140.0,
  },
  {
    idx: 13,
    productId: 'pzm-item-14',
    sku: 'SKU-PZM-SPICE-BASIL-500G-LOT20261025-014',
    productName: 'ใบโหระพา (Sweet Basil)',
    unit: 'KG',
    unitType: 'KG',
    qty: 2.0,
    cost: 180.0,
  },
  {
    idx: 14,
    productId: 'pzm-item-15',
    sku: 'SKU-PZM-SPICE-OREGANO-500G-LOT20261025-015',
    productName: 'ออริกาโนแห้งเกรดคัดพิเศษหอมนาน (Special Aromatic Dried Mediterranean Oregano 500g)',
    unit: 'KG',
    unitType: 'KG',
    qty: 2.5,
    cost: 190.0,
  },
  {
    idx: 15,
    productId: 'pzm-item-16',
    sku: 'O1',
    productName: 'OIL',
    unit: 'KG',
    unitType: 'KG',
    qty: 5.0,
    cost: 320.0,
  },
  {
    idx: 16,
    productId: 'pzm-item-17',
    sku: 'SKU-PZM-BAKE-YEAST-500G-LOT20261025-017',
    productName: 'ยีสต์แห้งสำเร็จรูปชนิดจืดพรีเมียม (Premium Instant Dry Yeast for Pizza Dough 500g)',
    unit: 'KG',
    unitType: 'KG',
    qty: 3.0,
    cost: 75.0,
  },
  {
    idx: 17,
    productId: 'pzm-item-18',
    sku: 'S1',
    productName: 'เกลือ',
    unit: 'KG',
    unitType: 'KG',
    qty: 15.0,
    cost: 15.0,
  },
  {
    idx: 18,
    productId: 'pzm-item-19',
    sku: 'S2',
    productName: 'SUGAR',
    unit: 'KG',
    unitType: 'KG',
    qty: 10.0,
    cost: 28.0,
  },
  {
    idx: 19,
    productId: 'pzm-item-20',
    sku: 'SKU-PZM-PKG-BOX-12IN-B50-LOT20261025-020',
    productName: 'กล่องพิซซ่า 12 นิ้ว (Pizza Box 12")',
    unit: 'KG',
    unitType: 'KG',
    qty: 20.0,
    cost: 250.0,
  },
  {
    idx: 20,
    productId: 'pzm-item-21',
    sku: 'SKU-PZM-PKG-BAG-ECO-XL-LOT20261025-021',
    productName: 'ถุงพลาสติกหูหิ้วชีวภาพย่อยสลายได้ (Biodegradable Eco Carrier Bag Extra Large 100pcs)',
    unit: 'KG',
    unitType: 'KG',
    qty: 25.0,
    cost: 90.0,
  },
]

export interface StageOptions {
  lang?: 'th' | 'en'
  status?: 'inTransit' | 'receiving'
  brand?: 'pizza' | 'lelapin'
  fixtureKey?: string
  notifCase?: 'canonical' | 'legacy-logistics' | 'legacy-docno' | 'invalid' | 'crossbrand' | 'all'
}

export async function stageLogisticsFixture(page: Page, options: StageOptions = {}) {
  const { lang = 'th', status = 'inTransit', brand = 'pizza', fixtureKey = 'r72-logistics-fixture', notifCase = 'all' } = options

  await page.addInitScript(
    ({
      fKey,
      l,
      curStatus,
      curBrand,
      docNo,
      internalId,
      actorId,
      fromLoc,
      toLoc,
      items,
      selectedNotifCase,
    }) => {
      // Force fresh staging on each stage call
      localStorage.setItem(fKey, '1')
      const now = Date.now()
      const prefix = curBrand === 'pizza' ? '' : `${curBrand}__`
      const store = (name: string, rows: Record<string, unknown>, shared = false) =>
        localStorage.setItem(`pmstock:v1:${shared ? '' : prefix}${name}`, JSON.stringify(rows))

      const user = {
        id: actorId,
        email: 'logistics-qa@inventory-pzm.local',
        name: 'สมชาย จัดการขนส่ง (Somchai Logistics QA)',
        role: 'admin',
        siteIds: [fromLoc, toLoc],
        active: true,
        createdAt: now,
      }

      store('users', { [actorId]: user }, true)
      localStorage.setItem('pmstock:v1:session', user.id)
      localStorage.setItem('pmstock:v1:lastBrand', curBrand)
      localStorage.setItem('pmstock:lang', l)
      localStorage.setItem('pzm:transfers:view', 'list')

      store('locations', {
        [fromLoc]: { id: fromLoc, name: 'คลังหลัก Main Warehouse (Bangkok)', active: true, type: 'warehouse', createdAt: now },
        [toLoc]: { id: toLoc, name: 'สาขาสยาม Siam Branch (Destination)', active: true, type: 'branch', createdAt: now + 1 },
        closed: { id: 'closed', name: 'สาขาปิด Closed Branch', active: false, type: 'branch', createdAt: now + 2 },
        transit: { id: 'transit', name: 'ระหว่างทาง In Transit', active: true, type: 'transit', createdAt: now + 3 },
      })

      const baseProd = { category: 'Ingredients', minStock: 0, hasImage: false, active: true, createdAt: now, updatedAt: now }
      const productsMap: Record<string, unknown> = {}
      const stockLevelsMap: Record<string, unknown> = {}

      for (const it of items) {
        productsMap[it.productId] = {
          ...baseProd,
          id: it.productId,
          sku: it.sku,
          name: it.productName,
          unit: it.unit,
          unitType: it.unitType,
          cost: it.cost,
        }
        stockLevelsMap[`${fromLoc}__${it.productId}`] = {
          id: `${fromLoc}__${it.productId}`,
          locationId: fromLoc,
          productId: it.productId,
          qty: it.qty * 10,
          updatedAt: now,
          updatedBy: actorId,
        }
        stockLevelsMap[`${toLoc}__${it.productId}`] = {
          id: `${toLoc}__${it.productId}`,
          locationId: toLoc,
          productId: it.productId,
          qty: 0,
          updatedAt: now,
          updatedBy: actorId,
        }
        stockLevelsMap[`transit__${it.productId}`] = {
          id: `transit__${it.productId}`,
          locationId: 'transit',
          productId: it.productId,
          qty: it.qty,
          updatedAt: now,
          updatedBy: actorId,
        }
      }

      store('products', productsMap)
      store('stockLevels', stockLevelsMap)

      const transferDoc = {
        id: internalId,
        docNo,
        status: curStatus,
        fromLocationId: fromLoc,
        toLocationId: toLoc,
        requestedBy: actorId,
        requestedByName: user.name,
        requestedAt: now - 3600000,
        approvedBy: actorId,
        approvedByName: user.name,
        approvedAt: now - 1800000,
        submittedAt: now - 3600000,
        dispatchedAt: now - 1800000,
        childIds: [],
        history: [
          { at: now - 3600000, by: actorId, byName: user.name, action: 'submitted' },
          { at: now - 1800000, by: actorId, byName: user.name, action: 'approved' },
          { at: now - 1800000, by: actorId, byName: user.name, action: 'dispatched' },
        ],
        items: items.map((it) => ({
          idx: it.idx,
          productId: it.productId,
          productName: it.productName,
          sku: it.sku,
          requestedQty: it.qty,
          dispatchQty: it.qty,
          unit: it.unit,
          unitType: it.unitType,
          inTransitQty: it.qty,
        })),
        createdAt: now - 3600000,
        updatedAt: now - 1800000,
      }

      store('transfers', { [internalId]: transferDoc })

      const allNotifs: Record<string, unknown> = {
        canonical: {
          id: 'notif-canonical',
          kind: 'transferArriving',
          priority: 'high',
          category: 'inventory',
          to: { all: true, roles: ['admin'], uids: [actorId] },
          link: `/transfers/${internalId}/receive`,
          params: { docNo, from: 'คลังหลัก Main Warehouse (Bangkok)', to: 'สาขาสยาม Siam Branch (Destination)', n: 21 },
          audienceKeys: ['all', 'role:admin', `uid:${actorId}`],
          readBy: {},
          active: true,
          createdAt: now - 1000,
          updatedAt: now - 1000,
        },
        'legacy-logistics': {
          id: 'notif-legacy-logistics',
          kind: 'transferArriving',
          priority: 'high',
          category: 'inventory',
          to: { all: true, roles: ['admin'], uids: [actorId] },
          link: `/logistics/${internalId}`,
          params: { docNo, from: 'คลังหลัก Main Warehouse (Bangkok)', to: 'สาขาสยาม Siam Branch (Destination)', n: 21 },
          audienceKeys: ['all', 'role:admin', `uid:${actorId}`],
          readBy: {},
          active: true,
          createdAt: now - 2000,
          updatedAt: now - 2000,
        },
        'legacy-docno': {
          id: 'notif-legacy-docno',
          kind: 'transferArriving',
          priority: 'high',
          category: 'inventory',
          to: { all: true, roles: ['admin'], uids: [actorId] },
          link: `/transfers/${docNo}`,
          params: { docNo, from: 'คลังหลัก Main Warehouse (Bangkok)', to: 'สาขาสยาม Siam Branch (Destination)', n: 21 },
          audienceKeys: ['all', 'role:admin', `uid:${actorId}`],
          readBy: {},
          active: true,
          createdAt: now - 3000,
          updatedAt: now - 3000,
        },
        invalid: {
          id: 'notif-invalid-denied',
          kind: 'transferArriving',
          priority: 'high',
          category: 'inventory',
          to: { all: true, roles: ['admin'], uids: [actorId] },
          link: '/unknown-forbidden-path/attack',
          params: { docNo, from: 'คลังหลัก Main Warehouse (Bangkok)', to: 'สาขาสยาม Siam Branch (Destination)', n: 21 },
          audienceKeys: ['all', 'role:admin', `uid:${actorId}`],
          readBy: {},
          active: true,
          createdAt: now - 4000,
          updatedAt: now - 4000,
        },
        crossbrand: {
          id: 'notif-crossbrand',
          kind: 'transferArriving',
          priority: 'high',
          category: 'inventory',
          to: { all: true, roles: ['admin'], uids: [actorId] },
          link: `/transfers/${internalId}?brand=lelapin`,
          params: { docNo, from: 'คลังหลัก Main Warehouse (Bangkok)', to: 'สาขาสยาม Siam Branch (Destination)', n: 21 },
          audienceKeys: ['all', 'role:admin', `uid:${actorId}`],
          readBy: {},
          active: true,
          createdAt: now - 5000,
          updatedAt: now - 5000,
        },
      }

      const notifsToStore: Record<string, unknown> = {}
      if (selectedNotifCase === 'all') {
        for (const [_, val] of Object.entries(allNotifs)) {
          notifsToStore[(val as { id: string }).id] = val
        }
      } else {
        const selected = allNotifs[selectedNotifCase]
        if (selected) {
          notifsToStore[(selected as { id: string }).id] = selected
        }
      }

      store('notifications', notifsToStore)
    },
    {
      fKey: fixtureKey,
      l: lang,
      curStatus: status,
      curBrand: brand,
      docNo: R72_TRANSFER_DOC_NO,
      internalId: R72_TRANSFER_INTERNAL_ID,
      actorId: R72_ACTOR_ID,
      fromLoc: R72_LOCATION_FROM,
      toLoc: R72_LOCATION_TO,
      items: R72_ITEMS,
      selectedNotifCase: notifCase,
    },
  )
}
