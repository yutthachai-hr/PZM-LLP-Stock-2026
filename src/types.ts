// ---------- Core domain types for Pizza Mania Stock ----------

/**
 * `manager` (หัวหน้า) reviews and approves purchase requests and does everything staff do;
 * the catalogue, suppliers and the roster stay with `admin`. Added 15 Sep 2026.
 */
export type Role = 'admin' | 'manager' | 'staff'

export interface AppUser {
  id: string // uid
  name: string
  email: string
  role: Role
  active: boolean
  // Only used by the local (offline) backend for demo login. Never used with Firebase Auth.
  localPassword?: string
  /** When this person last opened the message board — the unread badge counts from here. */
  messagesReadAt?: number
  /** Assigned locations/sites. Empty or undefined = can access all branches/sites. */
  siteIds?: string[]
  createdAt: number
}

/**
 * One stated price of a product, as the person keyed it and as the books use it.
 *
 * `price` in `unit` (a carton, a piece, a kilo — any unit the product has a rate for) is
 * what was on the invoice; `cost` is that brought to one of the product's own unit at
 * `factor`, which is what a valuation multiplies. `effectiveAt` is the day the price
 * applies from (suppliers change prices by the month); `at`/`by` say who wrote it when.
 */
export interface CostEntry {
  price: number
  unit: string
  factor: number
  cost: number
  effectiveAt: number
  at: number
  by: string
  byName: string
  note?: string
}

export const MAX_COST_HISTORY = 100

export interface Product {
  id: string
  sku: string
  /**
   * The number printed on the box, when someone has scanned it in (owner, 22 Sep 2026).
   *
   * Optional, and never a key: the SKU from the company's own workbooks stays the identity
   * of a product. A barcode is a second way to find one, unique within the brand so a scan
   * can only ever mean one thing.
   */
  barcode?: string
  name: string
  category: string
  unit: string // display unit, e.g. "Kilogram", "Bottle"
  unitType: string // short code, e.g. "KG", "EA"
  minStock: number // global minimum (reorder point)
  /**
   * Who we buy this from.
   *
   * Held here rather than in supplierItems because that is one document per product, and
   * "what does this supplier sell?" is asked every time an order is started — 454 reads for
   * a question the catalogue, already in memory, can answer for nothing. supplierItems stays
   * for the price we pay, which is not needed to place an order.
   *
   * Absent on a product whose name never said: the owner fills those in by hand.
   */
  supplierId?: string
  /**
   * Other suppliers this can be bought from, for the day the usual one is out.
   *
   * The automatic order never picks one of these on its own: an order goes to `supplierId`
   * or to a person to decide. Listed here so that person sees the choice instead of having
   * to remember it.
   */
  alternateSupplierIds?: string[]
  /**
   * Cost per one of the product's own unit (EA, KG…), for the stock valuation. Always the
   * latest entry of `costHistory` once one exists; the two are written together by
   * services/productCost.ts. Nothing else writes it — the price of a carton keyed here by
   * mistake once valued 11,536 sachets of ketchup at 3.4 million baht (22 Sep 2026).
   */
  cost?: number
  /** Every price ever stated, newest last (kept to the last MAX_COST_HISTORY). */
  costHistory?: CostEntry[]
  /**
   * The rates this product is keyed at — "1 ลัง = 288 EA": one `label` is `size` of the
   * product's own unit.
   *
   * Authoritative since 20 Sep 2026 (before that, a hint only): a quantity keyed in one of
   * these units is converted into the product's own unit at filing, and the movement keeps
   * both numbers. Read each row as "`per` label = `size` of `of`" (`per` 1 and `of` the
   * product's own unit when absent), so the five units chain the way the company uses
   * them: {Carton, 12, of: 'Pack'} + {Pack, 25} makes a Carton 300 EA; {KG, 1, per: 2.72}
   * on an EA product says one piece weighs 2.72 KG; {EA, 1, per: 10} on a KG product says
   * ten pieces to the kilo. Changing a rate changes future filings only — every row already filed
   * carries the rate it was converted at (see `entryQty` on StockMovement). A unit with no
   * rate here (or in the standard table, g/ml) cannot be filed until one is stated; the
   * entry screens ask for it once, and anyone may state it (see lib/uom.ts).
   */
  unitConversions?: { label: string; size: number; per?: number; of?: string }[]
  hasImage: boolean
  active: boolean
  createdAt: number
  updatedAt: number
}

export interface ProductImage {
  id: string // == product id
  dataUrl: string // compressed base64 JPEG
}

export type LocationType = 'warehouse' | 'branch' | 'transit'

export const TRANSIT_LOCATION_ID = 'transit'

export interface StockLocation {
  id: string
  name: string
  /**
   * The name in English, shown when the interface is in English. The Thai name is the
   * record; this is a label for foreign staff and suppliers. Absent = the Thai name shows.
   */
  nameEn?: string
  type: LocationType
  active: boolean
  createdAt: number
}

// Current balance of a product at a location (cached projection of the ledger)
export interface StockLevel {
  /**
   * `${locationId}__${productId}` for the product's own unit, and that plus `#${unit}` for
   * anything else someone keyed.
   *
   * The unsuffixed form is what every balance written before units were selectable uses, so
   * it is left exactly as it was rather than migrated.
   */
  id: string
  productId: string
  locationId: string
  /**
   * The unit this balance is counted in, when it is not the product's own.
   *
   * Legacy (rule of 13 Sep 2026): rows keyed in another unit used to be filed on their own
   * balance rather than converted. Since 20 Sep every filing converts into the product's
   * own unit, so no new `#Unit` balance is written; the ones that exist are folded into
   * the base balance by the migration tool (Settings → ดูแลข้อมูล) once the owner states
   * each rate, and are zeroed then.
   */
  unit?: string
  qty: number
  updatedAt: number
}

export type MovementType = 'receive' | 'issue' | 'adjust' | 'consume'

// The immutable ledger. Every stock change is one of these.
export interface StockMovement {
  id: string
  docNo: string
  type: MovementType
  productId: string
  productName: string // denormalised for easy reporting
  /** The product's own unit, as it was when this was filed. */
  unit: string
  /**
   * The unit the person actually picked, present only when it is not the product's own.
   *
   * Since 20 Sep 2026 the row is converted: `qty` is in the product's own unit and
   * `entryQty` is what was keyed, so "2 Carton" is filed as qty 1000, entryQty 2,
   * entryUnit Carton — the rate it was converted at is qty/entryQty, kept forever on the
   * row. A row with `entryUnit` and no `entryQty` was filed under the earlier rule, on its
   * own `#Unit` balance; it stays there until the migration tool converts it.
   */
  entryUnit?: string
  /** As keyed, when keyed in another unit. Absent = keyed in the product's own unit, or legacy. */
  entryQty?: number
  /** In the product's own unit (for converted rows); always positive; direction implied by type + from/to. */
  qty: number
  fromLocationId?: string // issue/adjust-out
  toLocationId?: string // receive/issue-in/adjust-in
  note?: string
  reason?: string // for adjust: lost | broken | expired | damage | found | count
  hasPhoto?: boolean // for consume: a proof photo is attached (stored in movementImages/{docNo})
  date: number // business date (editable), ms epoch of the day
  byUserId: string
  byUserName: string
  createdAt: number
  /** Who touched it last. The full list is in `edits`. */
  updatedBy?: string
  updatedByName?: string
  updatedAt?: number
  /**
   * Every edit ever made to this row, oldest first, appended and never rewritten.
   *
   * `updatedBy` only ever names the most recent person, which is exactly the thing someone
   * covering their tracks would rely on: edit a colleague's row, then let the next editor
   * overwrite your name. The reports print this whole list.
   */
  edits?: MovementEdit[]
  voided?: boolean
  /** When this movement came from a branch transfer (transfers/{id}). */
  transferId?: string
}

/** One entry in a movement's edit history. */
export interface MovementEdit {
  by: string
  byName: string
  at: number
  /** Which fields this edit changed, for the report to name them. */
  changed: string[]
  /**
   * The old and new value of each, as text, so the activity log can say what the row used
   * to say. Absent on edits made before 20 Sep 2026, which named the field only.
   */
  changes?: { field: MovementEditField; from: string; to: string }[]
}

export type MovementEditField = 'qty' | 'entryQty' | 'date' | 'note' | 'unit' | 'from' | 'to'

export interface Note {
  id: string
  title: string
  body: string
  byUserName: string
  pinned: boolean
  createdAt: number
  updatedAt: number
}

// Per-location minimum override (optional). Falls back to product.minStock.
export interface MinOverride {
  id: string // `${locationId}__${productId}`
  productId: string
  locationId: string
  minStock: number
}

// Collection name constants — single source of truth
/** Whether a supplier takes goods back. Shown on the supplier list as a badge. */
export type SupplierType = 'takingReturn' | 'notTakingReturn'

/**
 * A company the warehouse buys from.
 *
 * What it supplies lives in SupplierItem, not here. The design this screen came from put
 * one product and one price on the supplier row — but the same supplier appeared several
 * times in it, which is the tell: those rows are supplier x product pairs. Folding the
 * product into the supplier would make "this supplier also sells us three other things"
 * unrepresentable.
 */
/** A document about a supplier, kept where the company already keeps it (Google Drive). */
export interface SupplierLink {
  label: string
  url: string
}

export interface Supplier {
  id: string
  name: string
  /**
   * V-00001, V-00002 … issued from a counter like a document number (owner, 22 Sep 2026).
   * Absent only until the admin presses "ออกรหัสให้ผู้ขายเดิม" once; new suppliers get one
   * as they are created.
   */
  code?: string
  contactNumber: string
  email: string
  type: SupplierType
  note?: string
  /** Who to ask for, and their second number — what a person needs to place an order. */
  contactName?: string
  phone2?: string
  address?: string
  taxId?: string
  /** As the company says it: "เครดิต 30 วัน", "เงินสด". Free text, never calculated with. */
  paymentTerms?: string
  /** The supplier's own grouping — vegetables, packaging. Free text, not the product category. */
  category?: string
  /** Links to papers kept elsewhere (Drive, Dropbox). Nothing is uploaded: Spark has no Storage. */
  links?: SupplierLink[]
  /** Where this supplier's deliveries usually land. The automatic order offers it first. */
  defaultLocationId?: string
  /** Days from order to delivery, as the owner knows it. Shown, never enforced. */
  leadTimeDays?: number
  /**
   * Weekdays an order may be placed with them, 0 = Sunday … 6 = Saturday, and the time of
   * day (HH:mm, Bangkok) it has to be in by. The calendar shows each as a cut-off; nothing
   * refuses an order placed after one — the owner's word is "แสดง" not "ห้าม".
   */
  orderDays?: number[]
  cutoffTime?: string
  active: boolean
  createdAt: number
  updatedAt: number
}

/** One product a supplier sells us, and what we pay for it. */
export interface SupplierItem {
  id: string
  supplierId: string
  productId: string
  /** Purchase price per unit of the product's own unitType. Optional: not always known. */
  buyingPrice?: number
  /** The least the supplier will sell at once. A warning on review, never a block. */
  minOrderQty?: number
  active: boolean
  createdAt: number
  updatedAt: number
}

/**
 * What a calendar entry is about. Deliberately short: a type nobody can create is a type
 * nobody can filter by, and the modules these would come from do not exist yet.
 */
export type StockEventType =
  | 'stockCount'
  | 'audit'
  | 'delivery'
  | 'transfer'
  | 'inventoryTask'
  | 'other'

/**
 * `waitingApproval`: done by the person assigned, awaiting the manager's sign-off — only on
 * tasks whose schedule asks for one.
 */
export type StockEventStatus = 'upcoming' | 'inProgress' | 'waitingApproval' | 'completed' | 'cancelled'

export type StockEventPriority = 'normal' | 'high' | 'critical'

/**
 * Where an order has got to.
 *
 * Deliberately three states and no more. "Ordered" is the moment somebody sent the list to
 * the supplier; "received" is the moment the goods were checked in and the stock actually
 * moved. A draft is a list still being built, and nothing outside this app knows about it.
 */
export type PurchaseOrderStatus = 'draft' | 'ordered' | 'received' | 'cancelled'

/** One product on an order, as ordered and as it actually turned up. */
export interface PurchaseOrderLine {
  productId: string
  /** Denormalised, like a movement: the order has to still read correctly years later. */
  productName: string
  /** The product's own unit when the order was placed. */
  unit: string
  /**
   * The unit the order was actually placed in, present only when it is not the product's
   * own — the same pair a movement carries, for the same reason. An order for 3 Pack is
   * received into the Pack balance, not counted as 3 of whatever the product is measured in.
   */
  entryUnit?: string
  orderedQty: number
  /**
   * `orderedQty` in the product's own unit, converted at the rate the product had when the
   * order was placed. The receipt converts what arrives at this same rate (baseQty /
   * orderedQty), so a rate changed later cannot skew a delivery already promised. Absent
   * on lines placed in the product's own unit and on orders from before 20 Sep 2026.
   */
  baseQty?: number
  /**
   * What actually arrived, filled in during the receiving check.
   *
   * Absent until somebody checks the delivery in. Equal to orderedQty on a line that was
   * simply ticked as correct.
   */
  receivedQty?: number
  /** Ticked to say the delivery matched the order, without retyping the number. */
  checked?: boolean
  /** Why it did not match. The screen insists on one whenever the quantity was changed. */
  note?: string
}

/** One thing that moved in a revision, kept as data so either language can say it. */
export type PoRevisionChange =
  | { kind: 'qty'; productName: string; unit: string; from: number; to: number }
  | { kind: 'add'; productName: string; unit: string; to: number }
  | { kind: 'remove'; productName: string; unit: string; from: number }
  | { kind: 'expectedAt'; from?: number; to?: number }
  | { kind: 'note'; from?: string; to?: string }

/**
 * A change to a placed order: the PO revision of every purchasing system. The supplier
 * already holds the number, so the number stays and the sheet goes out again marked
 * Rev.n; what changed and why is kept on the order for the audit.
 */
export interface PoRevisionEntry {
  rev: number
  at: number
  by: string
  byName: string
  reason: string
  changes: PoRevisionChange[]
}

/**
 * An order placed with one supplier.
 *
 * Its own collection rather than a field on the calendar entry: an order carries a list of
 * lines that grows, gets checked off on arrival, and is reported on by date and supplier
 * long after the calendar has moved past it.
 */
export interface PurchaseOrder {
  id: string
  /** PO-00001. The number people say out loud. */
  docNo: string
  supplierId: string
  /** Denormalised so an old order still names its supplier after a rename. */
  supplierName: string
  status: PurchaseOrderStatus
  /** Where the goods will land, and where the stock receipt will be filed. */
  locationId: string
  /** When it was sent to the supplier, ms epoch. */
  orderedAt: number
  /**
   * When the supplier is to deliver, ms epoch of the day. Set when the order is placed —
   * the date asked for, or the supplier's lead time counted from today — and changed when
   * the supplier says otherwise. The calendar's receiving entries and the "late" flag hang
   * off it; absent on orders placed before it existed, which fall back to the lead time.
   */
  expectedAt?: number
  lines: PurchaseOrderLine[]
  /**
   * The supplier's invoice number.
   *
   * Required before the goods can be taken into stock, exactly as it is when somebody keys a
   * receipt by hand — an order that reaches the books without one is a number nobody can
   * trace back to a piece of paper.
   */
  invoiceNo?: string
  receivedAt?: number
  receivedBy?: string
  receivedByName?: string
  /** The stock receipt this became, so the two can be read against each other. */
  movementDocNo?: string
  /**
   * Why it was called off, and by whom. A cancelled order keeps its number and stays in
   * the list — an order that vanished is exactly what an audit cannot follow.
   */
  cancelReason?: string
  cancelledBy?: string
  cancelledByName?: string
  cancelledAt?: number
  /**
   * How many times it was changed after being placed. The number the supplier holds
   * stays the same; the sheet says "Rev.2" and is sent again. Absent = never changed.
   */
  revision?: number
  /** Each change after placing, oldest first: who, why, and exactly what moved. */
  revisions?: PoRevisionEntry[]
  /** The calendar entry that opened it, when it came from a weekly order. */
  eventId?: string
  /** The imported order list it came from, when it did not come from the manual screen. */
  batchId?: string
  /** The approved purchase request it was made from. Set once; a request converts once. */
  requestId?: string
  /** Who turned the draft into an order, and when. Absent on an order placed by hand. */
  approvedBy?: string
  approvedByName?: string
  approvedAt?: number
  /**
   * Where the sheet has got to on its way to the supplier.
   *
   * `shareOpened` means the share screen was opened and nothing more is known — the person
   * may have closed it. `sent` is written only when LINE itself reports the message went
   * (shareTargetPicker resolving with status "success"); it says LINE accepted it, not that
   * the supplier has read it, and the screens are worded that way. Absent until the first
   * attempt.
   */
  shareStatus?: PurchaseShareStatus
  shareOpenedAt?: number
  sentAt?: number
  sentBy?: string
  sentByName?: string
  /** Which rendering of the sheet was sent, so a regenerated one can be told apart. */
  imageVersion?: number
  note?: string
  createdBy: string
  createdByName: string
  createdAt: number
  updatedAt: number
}

export type PurchaseShareStatus = 'shareOpened' | 'sent' | 'skipped' | 'failed'

/**
 * Something that has to happen, on a date, at a location.
 *
 * Written by hand this round — there is no scheduler and no rule that creates one. It is a
 * plan, not a derived condition: low stock is NOT an event, because it is already computed
 * for free from balances the app has in memory, and one document per low SKU per location
 * would be over a thousand documents nobody asked for.
 */
export interface StockEvent {
  id: string
  title: string
  type: StockEventType
  /** Which warehouse or branch. Empty for something that is not about one place. */
  locationId?: string
  /** When it starts, ms epoch. The only field the calendar queries on. */
  startAt: number
  /** When it should be done by, ms epoch. Optional — not everything has a deadline. */
  dueAt?: number
  status: StockEventStatus
  priority: StockEventPriority
  /**
   * Who it is for: a list of uids. Events written before this hold one uid as a plain
   * string; read through `assigneesOf()` rather than directly.
   */
  assignedTo?: string[] | string
  /** For everyone. A flag, not a list of every uid, so it stays true when someone joins. */
  assignedToAll?: boolean
  /**
   * The assignees' names, joined, stored rather than looked up.
   *
   * `users` is only subscribed for admins, so a staff member holding a uid cannot turn it
   * into a name without a read. Same denormalisation StockMovement already makes for
   * productName and byUserName, and for the same reason.
   */
  assignedToName?: string
  note?: string
  /**
   * What the task is about, when it is about one thing: the product a count or check
   * concerns, the supplier a delivery comes from. Optional; most tasks name neither.
   */
  productId?: string
  supplierId?: string
  /**
   * Where it came from. A task the schedule generated says so, names its schedule, and
   * carries `refKey` = `schedule__<scheduleId>__stockCount__<yyyymmdd>` — the same string
   * is its document id, which is what stops the same day being generated twice.
   */
  sourceType?: 'manual' | 'schedule'
  sourceId?: string
  scheduleId?: string
  refKey?: string
  /** Completing it hands it to a manager to sign off (status `waitingApproval`) first. */
  requiresApproval?: boolean
  /** Everything that happened to it, oldest first, in the actor's own name. */
  history?: EventHistoryEntry[]
  /** When it was originally set for, kept when it is moved. */
  rescheduledFrom?: number
  startedBy?: string
  startedByName?: string
  startedAt?: number
  completedBy?: string
  completedByName?: string
  completedAt?: number
  approvedBy?: string
  approvedByName?: string
  approvedAt?: number
  cancelReason?: string
  createdBy: string
  createdAt: number
  updatedAt: number
}

export type EventHistoryAction =
  | 'created'
  | 'generated'
  | 'assigned'
  | 'started'
  | 'completed'
  | 'approved'
  | 'rescheduled'
  | 'cancelled'
  | 'edited'
  | 'reopened'

export interface EventHistoryEntry {
  at: number
  by: string
  byName: string
  action: EventHistoryAction
  /** For a reschedule: the old and new start, as ms; for a cancel: the reason. */
  detail?: string
  oldValue?: string
  newValue?: string
}

// ---------------------------------------------------------------- inventory schedules ----

export type ScheduleFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'custom'

/**
 * A recurring stock count, as the admin set it up: where, how often, what time, who.
 * The tasks it produces are ordinary stockEvents of type `stockCount`, one per occurrence,
 * with a deterministic id — generating a day twice writes the same document twice.
 */
export interface InventorySchedule {
  id: string
  kind: 'stockCount'
  name: string
  locationId: string
  frequency: ScheduleFrequency
  /** weekly / biweekly: 0 = Sunday … 6 = Saturday. */
  daysOfWeek?: number[]
  /** monthly: 1..31 (a month without that day counts on its last day). */
  dayOfMonth?: number
  /** custom: every N days from `anchorDay`. biweekly also counts weeks from `anchorDay`. */
  intervalDays?: number
  /** A Bangkok day (start-of-day ms) the rhythm is counted from. */
  anchorDay?: number
  /** HH:mm the count starts. */
  startTime: string
  /** How long until it is due, in minutes; absent = end of the day. */
  durationMin?: number
  assignedTo?: string[]
  assignedToAll?: boolean
  assignedToName?: string
  requiresApproval?: boolean
  priority: StockEventPriority
  enabled: boolean
  note?: string
  createdBy: string
  createdAt: number
  updatedAt: number
}

/** The thresholds and timings the calendar and the notifications work to. One per brand. */
export interface InventorySettings {
  id: 'settings'
  kind: 'settings'
  /** An adjustment worth at least this many baht is significant. */
  adjustValueBaht: number
  /** …or at least this percent of what was on hand. */
  adjustPct: number
  /** Waste/loss worth at least this many baht is told to the manager. */
  wasteValueBaht: number
  /** Days of cover a reorder recommendation aims for beyond the lead time. */
  coverDays: number
  /** Minutes before a task starts that its reminder goes out. */
  reminderBeforeMin: number
  /** Hours past due before an overdue task is escalated to the manager. */
  escalateAfterHours: number
  /** Days of movement history the usage rate is averaged over. */
  usageWindowDays: number
  updatedBy?: string
  updatedAt: number
}

export const DEFAULT_INVENTORY_SETTINGS: Omit<InventorySettings, 'updatedAt' | 'updatedBy'> = {
  id: 'settings',
  kind: 'settings',
  adjustValueBaht: 1000,
  adjustPct: 20,
  wasteValueBaht: 500,
  coverDays: 7,
  reminderBeforeMin: 60,
  escalateAfterHours: 4,
  usageWindowDays: 30,
}

// ---------------------------------------------------------------- notifications ----

export type NotificationCategory = 'task' | 'inventory' | 'purchasing' | 'supplier' | 'system'
export type NotificationPriority = 'critical' | 'high' | 'medium' | 'info'

export type NotificationKind =
  | 'taskSoon' // a task starts soon (or has started) and is not done
  | 'taskOverdue' // past its deadline
  | 'taskEscalated' // past its deadline long enough to tell the managers
  | 'taskApproval' // handed in, waiting for a manager's sign-off
  | 'prSubmitted' // a purchase request waiting for approval
  | 'poArriving' // goods due today
  | 'poDelayed' // goods late
  | 'cutoffToday' // a supplier's order cut-off is today
  | 'transferSubmitted' // a branch transfer waiting for approval
  | 'transferArriving' // stock in transit arriving today
  | 'transferIssue' // transfer discrepancy or misroute reported
  | 'lowStock'
  | 'outOfStock'
  | 'stockoutSoon' // at the current rate of use, gone before the next delivery could land
  | 'reorder' // worth ordering now
  | 'adjustment' // a significant stock adjustment
  | 'waste' // significant waste or loss
  | 'dailyBrief'
  | 'weeklySummary'

/** Who a notification is for: everyone, some roles, some people — any that match. */
export interface NotificationAudience {
  all?: boolean
  roles?: Role[]
  uids?: string[]
}

/**
 * One notification, one document. The id is the dedup key (`<kind>__<subject>[__<day>]`),
 * so the Worker and the app writing the same fact write the same document. A state — low
 * stock, a late order — stays `active` until it clears, and comes back only after that.
 */
export interface AppNotification {
  id: string
  kind: NotificationKind
  category: NotificationCategory
  priority: NotificationPriority
  to: NotificationAudience
  /** Fills the {slots} of the Thai title and body for this kind (lib/inventoryRules/copy.ts). */
  params: Record<string, string | number>
  /** Where tapping it goes: an in-app path. */
  link: string
  locationId?: string
  productId?: string
  supplierId?: string
  active: boolean
  resolvedAt?: number
  /** uid → when that person read it. One key per reader, written by that reader only. */
  readBy: Record<string, number>
  source: 'worker' | 'client'
  createdBy: string
  createdAt: number
  updatedAt: number
  /** After this it is purged. */
  expiresAt: number
}

/** What a person has turned off, per category: the priorities they do not want to see. */
export interface NotificationPrefs {
  id: string // prefs__<uid>
  kind: 'prefs'
  userId: string
  mute: Partial<Record<NotificationCategory, NotificationPriority[]>>
  updatedAt: number
}

/** "Not now" on a reorder suggestion, until a day. */
export interface ReorderSnooze {
  id: string // snooze__reorder__<productId>__<locationId>
  kind: 'snooze'
  until: number
  by: string
  byName: string
  reason?: string
  createdAt: number
}

// ---------------------------------------------------------------- purchase batches ----

/**
 * What is wrong with, or worth a second look at, one row of an imported order list.
 *
 * `block` — cannot become an order as it stands (a hidden supplier, a hidden product).
 * `review` — a person has to choose something (which product, which supplier, a quantity).
 * `warn` — probably fine, but the person ticks it before it goes (an unusual quantity).
 */
export type BatchIssueSeverity = 'block' | 'review' | 'warn'

export type BatchIssueCode =
  | 'unknownProduct'
  | 'ambiguousProduct'
  | 'noSupplier'
  | 'supplierInactive'
  | 'productInactive'
  | 'qtyUnclear'
  | 'unitMismatch'
  | 'duplicateProduct'
  | 'belowMoq'
  | 'suspiciousQty'
  | 'possibleDuplicateOrder'

export interface BatchIssue {
  code: BatchIssueCode
  severity: BatchIssueSeverity
  /** A number or name the message can quote — the MOQ, the usual quantity, the PO number. */
  detail?: string
}

/** One line of the order workbook, as read and as a person has since settled it. */
export interface BatchRow {
  /** Position in the batch. Stable: groups point at rows by this. */
  idx: number
  excelRow: number
  rawName: string
  rawUnit: string
  rawQty: string
  note?: string
  /** How the product was found. `manual` when a person picked it on the review screen. */
  matchKind?: 'exact' | 'alias' | 'manual' | 'ambiguous' | 'none'
  productId?: string
  /** Denormalised, like an order line: the batch has to read correctly after a rename. */
  productName?: string
  /** The product's own unit when the row was settled. */
  unit?: string
  /** The unit the order is placed in, only when it is not the product's own. */
  entryUnit?: string
  supplierId?: string
  supplierName?: string
  qty?: number
  issues: BatchIssue[]
  /** The person said "not this one" — kept so the review shows what was left out and why. */
  skipped?: boolean
  /** Every `warn` on this row has been looked at and accepted. */
  confirmed?: boolean
}

/** One supplier's share of a batch, and the order it became. */
export interface BatchGroup {
  supplierId: string
  supplierName: string
  rowIdx: number[]
  poId?: string
  docNo?: string
}

export type PurchaseBatchStatus =
  | 'draft'
  | 'needsReview'
  | 'ready'
  | 'approved'
  | 'sending'
  | 'completed'
  | 'cancelled'

/** One thing that happened to a batch, appended and never rewritten. */
export interface BatchHistoryEntry {
  at: number
  by: string
  byName: string
  action: string
  detail?: string
}

/**
 * One import of the order workbook: the rows read, how each was settled, and the orders it
 * became.
 *
 * Rows and groups live inside the document rather than in their own collections for the
 * same reason an order's lines do: a batch of eighty rows is one read, and nothing needs a
 * row without its batch. `history` is the audit trail the owner asked for — who imported,
 * who mapped what, who approved, who sent — and is only ever appended to.
 */
export interface PurchaseBatch {
  id: string
  /** PB-20260914-001. Counted per day. */
  batchNo: string
  locationId: string
  sourceFileName: string
  /** SHA-256 of the file, so the same workbook imported twice is noticed. */
  fileHash: string
  sheetName: string
  /** The block heading as written, so the person can see which week this was. */
  blockLabel: string
  /** The date in that heading, when it had one. */
  blockDate?: number
  /** Column letters a person chose, when the headers could not be read. */
  mapping?: { name: string; qty: string; unit?: string; note?: string }
  status: PurchaseBatchStatus
  rows: BatchRow[]
  groups: BatchGroup[]
  history: BatchHistoryEntry[]
  createdBy: string
  createdByName: string
  createdAt: number
  updatedAt: number
}

// ---------------------------------------------------------------- purchase requests ----

/**
 * Where a request stands. The only place these words are compared is
 * `src/lib/purchaseRequestStatus.ts`.
 *
 *   draft → pendingApproval → approved → poCreated
 *                ↓ returned → (edited) → pendingApproval
 *                ↓ rejected
 *
 * "Ready for order" is `approved` with no `orders` yet; `poCreated` means the orders exist
 * and are placed — in this app an order made from an approved request is placed the moment
 * it is created, so there is no separate "ordered" state to wait for.
 */
export type PurchaseRequestStatus =
  | 'draft'
  | 'pendingApproval'
  | 'returned'
  | 'approved'
  | 'rejected'
  | 'poCreated'

/** How the supplier on a line was arrived at — the manager sees `custom` flagged. */
export type SupplierChoice = 'primary' | 'alternate' | 'custom'

export type RequestUrgency = 'normal' | 'urgent' | 'critical'

export const URGENCIES: { value: RequestUrgency; label: string }[] = [
  { value: 'normal', label: 'ปกติ' }, // i18n-key
  { value: 'urgent', label: 'เร่งด่วน' }, // i18n-key
  { value: 'critical', label: 'ด่วนมาก' }, // i18n-key
]

export interface PurchaseRequestItem {
  /** Position in the request. Stable: history entries point at lines by this. */
  idx: number
  productId: string
  /** Denormalised, like an order line: the request has to read correctly after a rename. */
  productName: string
  sku: string
  /** The product's own unit when the line was added. */
  unit: string
  /** The unit asked for, only when it is not the product's own (see PurchaseOrderLine). */
  entryUnit?: string
  supplierId: string
  supplierName: string
  supplierChoice: SupplierChoice
  /**
   * What the requester asked for. Never edited by a manager — the manager's number is
   * `approvedQty`, and both stay, so "asked 5, got 3" can be read back later. Null on a
   * line the manager added.
   */
  requestedQty: number | null
  /** What the manager approved. Set to requestedQty on submit; the manager may change it. */
  approvedQty?: number
  managerAdded?: boolean
  note?: string
  /**
   * How soon it is needed (owner, 22 Sep 2026): "normal" unless someone says otherwise —
   * the requester while drafting, the manager while reviewing. Absent reads as normal, so
   * every request filed before this existed is simply normal.
   */
  urgency?: RequestUrgency
  /**
   * The balance when the request was sent for review — at the request's warehouse and
   * across every location — so the manager weighs the ask against what was on the shelf
   * that day, not against a number that has moved since. Written once, at submit; the
   * owner's rule is that a review never borrows another month's figure.
   */
  stockAtSubmit?: number
  stockTotalAtSubmit?: number
  /** The same moment, per location id — so the manager sees where the stock actually is. */
  stockByLocationAtSubmit?: Record<string, number>
  /** Taken out by a manager — kept, not deleted, so the review still shows it. */
  removed?: { by: string; byName: string; at: number; reason: string }
}

/** One thing that happened to a request, appended and never rewritten. */
export interface PurchaseRequestHistoryEntry {
  at: number
  by: string
  byName: string
  action: string
  detail?: string
  itemIdx?: number
  oldValue?: string
  newValue?: string
}

/**
 * A request to buy: what someone on the floor asked for, what the หัวหน้า approved, and
 * the orders it became. Not an order — nothing reaches a supplier from here until it is
 * approved and converted, and the conversion goes through the same createPurchaseOrder
 * as the manual screen.
 */
export interface PurchaseRequest {
  id: string
  /** PR-00001. One sequence per brand. */
  docNo: string
  status: PurchaseRequestStatus
  /** Starts at 1; goes up each time a returned request is submitted again. */
  revision: number
  /** One destination per request. */
  locationId: string
  note?: string
  items: PurchaseRequestItem[]
  requestedBy: string
  requestedByName: string
  submittedAt?: number
  returnReason?: string
  rejectReason?: string
  approvalNote?: string
  approvedBy?: string
  approvedByName?: string
  approvedAt?: number
  rejectedBy?: string
  rejectedByName?: string
  rejectedAt?: number
  /** The orders it became, one per supplier. Written once; a request converts once. */
  orders?: { supplierId: string; supplierName: string; poId: string; docNo: string }[]
  history: PurchaseRequestHistoryEntry[]
  createdBy: string
  createdByName: string
  createdAt: number
  updatedAt: number
}

// ---------------------------------------------------------------- transfers ----

export type TransferStatus =
  | 'draft'
  | 'pendingApproval'
  | 'returned'
  | 'rejected'
  | 'inTransit'
  | 'receiving'
  | 'completed'
  | 'discrepancy'
  | 'pendingDiscrepancyApproval'
  | 'resolved'
  | 'cancelled'

export type TransferLegKind = 'forward' | 'return' | 'replacement'

export type DiscrepancyKind = 'short' | 'over'

export type DiscrepancyReason =
  | 'SHORT'
  | 'OVER'
  | 'WEIGHT_VARIANCE'
  | 'DAMAGED'
  | 'WRONG_ITEM'
  | 'WRONG_BRANCH'
  | 'COUNTING_ERROR'
  | 'OTHER'

export type DiscrepancyResolutionCode =
  | 'NOT_ACTUALLY_LOADED' // short: transit -> source
  | 'TRANSIT_LOSS'        // short: adjust out from transit (reason: lost)
  | 'DAMAGED'             // short: adjust out from transit (reason: damage)
  | 'WEIGHING_ERROR'      // short: correct received qty, transit -> dest for the rest
  | 'WRONG_BRANCH'        // short: handled via misroute flow
  | 'DISPATCH_WRONG'      // over: set correctedDispatchQty, source -> transit -> dest
  | 'COUNT_ERROR'         // over: no movement, correct received qty
  | 'APPROVED_ADJUSTMENT' // over: adjust in at dest (reason: found)
  | 'BELONGS_TO_OTHER_TRANSFER' // over: link to another transfer misroute

export interface TransferDiscrepancyResolution {
  code: DiscrepancyResolutionCode
  qty: number
  by: string
  byName: string
  at: number
  note?: string
  movementDocNo?: string
  childId?: string
}

export interface TransferDiscrepancy {
  kind: DiscrepancyKind
  qty: number
  reason: DiscrepancyReason
  note?: string
  photoId?: string
  reportedBy: string
  reportedByName: string
  reportedAt: number
  resolution?: TransferDiscrepancyResolution
}

export interface TransferMisroute {
  id: string
  actualCustodyLocationId: string
  originalDestinationId: string
  qty: number
  reportedBy: string
  reportedByName: string
  reportedAt: number
  note?: string
  resolution?: {
    action: 'redirect' | 'forward' | 'return'
    by: string
    byName: string
    at: number
    note?: string
    childTransferId?: string
  }
}

export interface TransferItem {
  idx: number
  productId: string
  productName: string
  sku: string
  unit: string
  requestedEntryUnit?: string
  requestedEntryQty?: number
  requestedQty: number | null
  dispatchEntryUnit?: string
  dispatchEntryQty?: number
  dispatchQty: number
  receivedEntryUnit?: string
  receivedEntryQty?: number
  receivedQty?: number
  correctedDispatchQty?: number
  stockAtSubmit?: number
  stockAtApprove?: number
  removed?: {
    by: string
    byName: string
    at: number
    reason: string
  }
  discrepancy?: TransferDiscrepancy
  misroutes?: TransferMisroute[]
}

export interface TransferHistoryEntry {
  at: number
  by: string
  byName: string
  action: string
  note?: string
  fromStatus?: TransferStatus
  toStatus?: TransferStatus
  oldQty?: number
  newQty?: number
  reason?: string
  diff?: Record<string, unknown>
}

export interface Transfer {
  id: string
  docNo: string
  status: TransferStatus
  revision: number
  fromLocationId: string
  toLocationId: string
  dispatchDate: number
  note?: string
  parentId?: string
  legKind?: TransferLegKind
  childIds?: string[]
  requestedBy: string
  requestedByName: string
  submittedAt?: number
  approvedBy?: string
  approvedByName?: string
  approvedAt?: number
  receivedBy?: string
  receivedByName?: string
  receivedAt?: number
  dispatchMovementDocNo?: string
  receiveMovementDocNo?: string
  items: TransferItem[]
  history: TransferHistoryEntry[]
  createdAt: number
  updatedAt: number
}

export const COL = {
  users: 'users',
  messages: 'messages',
  products: 'products',
  productImages: 'productImages',
  movementImages: 'movementImages',
  locations: 'locations',
  stockLevels: 'stockLevels',
  movements: 'stockMovements',
  notes: 'notes',
  counters: 'counters',
  minOverrides: 'productMinOverrides',
  suppliers: 'suppliers',
  supplierItems: 'supplierItems',
  events: 'stockEvents',
  inventorySchedules: 'inventorySchedules',
  notifications: 'notifications',
  purchaseOrders: 'purchaseOrders',
  purchaseBatches: 'purchaseBatches',
  purchaseRequests: 'purchaseRequests',
  transfers: 'transfers',
  productAliases: 'productAliases',
  announcements: 'announcements',
  companyProfile: 'companyProfile',
  meta: 'meta',
  revokedUsers: 'revokedUsers',
} as const

/**
 * A note to everyone in the brand (owner, 22 Sep 2026): "ของ FOODGALLERY มาบ่ายนี้".
 *
 * Not a chat — there is no listener, no read receipts and no replies. It is a board the
 * whole shift can see, kept for 90 days, and a message cannot be edited once sent: what
 * was said stands, and the person who said it (or an admin) can take it down.
 */
export interface AppMessage {
  id: string
  body: string
  byUserId: string
  byUserName: string
  createdAt: number
  /** Kept at the top of the list by a manager or an admin. */
  pinned?: boolean
}

/** The longest a message may be — a note, not a document. */
export const MESSAGE_MAX = 1000

/** How long messages are kept (owner, 22 Sep 2026). The cron Worker removes older ones. */
export const MESSAGE_DAYS = 90

// ---------- Company announcements (24 Sep 2026) ----------

/**
 * Which company a record belongs to — the same values as brand/brand.ts's BrandId. Spelled
 * out here rather than imported because this file is also compiled into the cron Worker,
 * which has no browser, and brand.ts reads localStorage.
 */
type BrandId = 'pizza' | 'lelapin'

/**
 * The company as its documents present it, one per brand (`companyProfile/main`).
 *
 * The die-cut logo lives here, not in the code: a template that reads it from data is a
 * template the owner can re-skin by uploading a file. `docPrefix` starts a document
 * number ("PZM-ANN-2569-0001") and defaults to the brand's workbook key.
 */
export interface CompanyProfile {
  id: string
  docPrefix: string
  announcementCode: string
  /** The name printed on documents; the brand's name when unset. */
  displayName?: string
  nameEn?: string
  /** PNG (transparency kept) or JPEG as a data URL, shrunk in the browser. */
  logoDataUrl?: string
  /** Bumped whenever the logo changes, so a published announcement records which one it used. */
  logoVersion?: number
  updatedBy?: string
  updatedAt?: number
}

export type AnnouncementStatus = 'draft' | 'ready' | 'published' | 'partiallySent' | 'sent' | 'cancelled'
export type AnnouncementFormat = 'text' | 'a5'
/**
 * How an announcement reaches LINE. `personal` is the person's own LINE through LIFF's
 * share picker — they choose the groups in LINE's own screen, so the app never learns
 * which. `auto` (a LINE Official Account pushing to registered groups) is designed in
 * docs/PLAN-announcements.md and not built: the owner has no OA yet (24 Sep 2026).
 */
export type AnnouncementSendMode = 'personal' | 'auto'
export type AnnouncementSendOutcome = 'sent' | 'shareOpened' | 'failed'

export interface AnnouncementTarget {
  mode: AnnouncementSendMode
  /** Whose suppliers this is meant for: one company's, or both. */
  companyScope: BrandId[]
}

/** What went out: frozen when the number is issued, never edited afterwards. */
export interface AnnouncementSnapshot {
  subject: string
  body: string
  text: string
  companyName: string
  logoVersion: number
  layoutVersion: number
}

export interface AnnouncementFiles {
  pdfUrl: string
  imageUrl: string
  previewUrl: string
  pdfBytes: number
  createdAt: number
}

export interface AnnouncementSend {
  at: number
  by: string
  byName: string
  mode: AnnouncementSendMode
  outcome: AnnouncementSendOutcome
  /**
   * Who says so: LINE itself (`liff` resolved success), or the person, after the phone's
   * share sheet — which reports only that it opened (`confirmed`).
   */
  via: 'liff' | 'shareSheet' | 'confirmed' | 'oa'
  /** Only an Official Account knows which group it sent to. */
  groupId?: string
  groupName?: string
  error?: string
}

export interface AnnouncementHistoryEntry {
  at: number
  by: string
  byName: string
  action: string
  detail?: string
}

export interface Announcement {
  id: string
  /** Issued when published, never for a draft. */
  docNo?: string
  status: AnnouncementStatus
  company: BrandId
  announcementDate: number
  subject: string
  body: string
  format: AnnouncementFormat
  target: AnnouncementTarget
  /** Whoever wrote it, from their profile — not typed. */
  publisherId: string
  publisherName: string
  publishedAt?: number
  publishedBy?: string
  snapshot?: AnnouncementSnapshot
  files?: AnnouncementFiles
  sends: AnnouncementSend[]
  cancelReason?: string
  cancelledBy?: string
  cancelledAt?: number
  history: AnnouncementHistoryEntry[]
  createdBy: string
  createdByName: string
  createdAt: number
  updatedAt: number
}

export const ANNOUNCEMENT_SUBJECT_MAX = 200
export const ANNOUNCEMENT_BODY_MAX = 3000

// Labels are translation keys — screens render them through t(). i18n-key
export const ADJUST_REASONS = [
  { value: 'lost', label: 'ของหาย' }, // i18n-key
  { value: 'broken', label: 'แตก/ชำรุด' }, // i18n-key
  { value: 'expired', label: 'หมดอายุ' }, // i18n-key
  { value: 'damage', label: 'เสียหาย' }, // i18n-key
  { value: 'found', label: 'พบเพิ่ม (นับได้เกิน)' }, // i18n-key
  { value: 'count', label: 'ปรับตามการนับ' }, // i18n-key
  { value: 'opening', label: 'ตั้งยอด/ยอดยกมา' }, // i18n-key
] as const
