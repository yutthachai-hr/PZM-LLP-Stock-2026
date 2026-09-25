import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { useBrand } from '../../brand/BrandContext'
import { useData } from '../../data/DataContext'
import { DataTable, type Column } from '../../components/DataTable'
import { FramePage, PageHero, StatusChip } from '../../components/frame'
import { Icon } from '../../components/Icon'
import { useToast } from '../../components/Toast'
import { Button, Card, EmptyState, Field, Input, Modal, SearchInput } from '../../components/ui'
import { useT } from '../../i18n/I18nContext'
import { errText } from '../../i18n/AppError'
import { fmtQty } from '../../lib/format'
import { PIZZA_MANIA_MENU } from '../../lib/menuCodes'
import { saleKey } from '../../lib/posImport'
import { isManager } from '../../lib/purchaseRequestStatus'
import { looseMatch } from '../../lib/search'
import { addMissingMenu, saveRecipe, setRecipeActive, useRecipes } from '../../services/recipes'
import type { Product, Recipe, Role } from '../../types'

/**
 * สูตรอาหาร (Automation Plan Phase 3 — owner, 25 Sep 2026): each POS menu item and what one
 * sale of it takes from stock. The day's sales imported on the Issue screen are turned into
 * stock used from these. Everyone may read them; a หัวหน้า or admin writes them.
 */
export function RecipesPage() {
  const t = useT()
  const toast = useToast()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { brand } = useBrand()
  const { products } = useData()
  const recipes = useRecipes()
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Recipe | 'new' | null>(null)
  const [busy, setBusy] = useState(false)
  const manager = isManager(user?.role)
  const actor = user ? { id: user.id, name: user.name, role: user.role as Role } : null

  const shown = useMemo(
    () => recipes.filter((r) => !q.trim() || looseMatch([r.code, r.name, ...(r.aliases ?? []), ...r.lines.map((l) => l.productName)], q)),
    [recipes, q],
  )
  const missingMenu = brand === 'pizza' ? PIZZA_MANIA_MENU.filter(([code]) => !recipes.some((r) => keyOf(r.code) === keyOf(code))).length : 0
  const noIngredients = recipes.filter((r) => r.active && r.lines.length === 0).length

  async function prefill() {
    if (!actor) return
    setBusy(true)
    try {
      const n = await addMissingMenu(PIZZA_MANIA_MENU, { products, existing: recipes }, actor)
      toast.success(t('เพิ่มเมนู {n} รายการแล้ว — ใส่ส่วนผสมทีละเมนู', { n }))
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  const columns: Column<Recipe>[] = [
    { key: 'code', header: t('รหัสเมนู'), className: 'num w-24 font-semibold', cell: (r) => r.code },
    {
      key: 'name',
      header: t('เมนู'),
      primary: true,
      cell: (r) => (
        <div className="min-w-0">
          <div className="font-semibold text-ink">{r.name}</div>
          {r.aliases?.length ? <div className="truncate text-xs text-ink-faint">{r.aliases.join(', ')}</div> : null}
        </div>
      ),
    },
    {
      key: 'lines',
      header: t('ส่วนผสมต่อ 1 ที่'),
      cell: (r) =>
        r.lines.length === 0 ? (
          <span className="text-sm text-warn">{t('ยังไม่มีส่วนผสม')}</span>
        ) : (
          <span className="text-sm text-ink-soft">{r.lines.map((l) => `${l.productName} ${fmtQty(l.qty)} ${l.unit}`).join(' · ')}</span>
        ),
    },
    {
      key: 'state',
      header: t('สถานะ'),
      card: 'value',
      cell: (r) => (r.active ? <StatusChip tone="green" size="sm">{t('ใช้อยู่')}</StatusChip> : <StatusChip tone="slate" size="sm" icon={null}>{t('ปิดแล้ว')}</StatusChip>),
    },
  ]

  return (
    <FramePage>
      <PageHero
        icon="note"
        title={t('สูตรอาหาร')}
        subtitle={t('เมนูแต่ละรายการใช้วัตถุดิบเท่าไร — ใช้ตัดสต๊อกตามยอดขาย POS ที่หน้าเบิก/โอนสาขา')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate('/issue?mode=pos')}>
              <Icon name="upload" size={16} />
              {t('นำเข้ายอดขาย POS')}
            </Button>
            {manager && (
              <Button onClick={() => setEditing('new')}>
                <Icon name="plus" size={16} />
                {t('เพิ่มสูตร')}
              </Button>
            )}
          </div>
        }
      />

      {manager && missingMenu > 0 && (
        <Card className="flex flex-wrap items-center gap-3 border-brand/30 bg-brand-soft p-3 text-sm text-ink">
          <Icon name="lightbulb" size={18} className="text-brand" />
          <span className="min-w-0 flex-1">{t('มีรหัสเมนู Pizza Mania อีก {n} รายการที่ยังไม่อยู่ในรายการ — เพิ่มชื่อและรหัสให้ก่อน แล้วค่อยใส่ส่วนผสม', { n: missingMenu })}</span>
          <Button onClick={() => void prefill()} disabled={busy}>
            {busy ? t('กำลังเพิ่ม...') : t('เพิ่มรายการเมนู ({n})', { n: missingMenu })}
          </Button>
        </Card>
      )}
      {noIngredients > 0 && (
        <p className="text-sm text-warn">{t('{n} เมนูยังไม่มีส่วนผสม — ยอดขายของเมนูเหล่านี้จะยังไม่ถูกตัดสต๊อก', { n: noIngredients })}</p>
      )}

      <Card className="p-3">
        <SearchInput value={q} onChange={setQ} placeholder={t('ค้นหารหัส ชื่อเมนู หรือวัตถุดิบ')} />
      </Card>

      <Card className="overflow-hidden">
        <DataTable
          rows={shown}
          columns={columns}
          rowKey={(r) => r.id}
          onRowClick={manager ? (r) => setEditing(r) : undefined}
          empty={<EmptyState icon="note" title={t('ยังไม่มีสูตร')} hint={manager ? t('กด "เพิ่มสูตร" หรือเพิ่มรายการเมนูจากรหัส POS') : undefined} />}
        />
      </Card>

      {editing && actor && (
        <RecipeEditor
          recipe={editing === 'new' ? null : editing}
          products={products}
          existing={recipes}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            await saveRecipe(input, { products, existing: recipes }, actor)
            toast.success(t('บันทึกสูตรแล้ว'))
            setEditing(null)
          }}
          onToggle={async (r) => {
            await setRecipeActive(r, !r.active, actor)
            toast.success(r.active ? t('ปิดสูตรแล้ว') : t('เปิดใช้สูตรแล้ว'))
            setEditing(null)
          }}
        />
      )}
    </FramePage>
  )
}

function keyOf(code: string): string {
  const k = saleKey(code)
  return /^\d+$/.test(k) ? String(Number(k)) : k
}

function RecipeEditor({
  recipe,
  products,
  existing,
  onClose,
  onSave,
  onToggle,
}: {
  recipe: Recipe | null
  products: readonly Product[]
  existing: readonly Recipe[]
  onClose: () => void
  onSave: (input: { id?: string; code: string; name: string; aliases: string[]; lines: { productId: string; qty: number }[] }) => Promise<void>
  onToggle: (r: Recipe) => Promise<void>
}) {
  const t = useT()
  const toast = useToast()
  const [code, setCode] = useState(recipe?.code ?? '')
  const [name, setName] = useState(recipe?.name ?? '')
  const [aliases, setAliases] = useState((recipe?.aliases ?? []).join(', '))
  const [lines, setLines] = useState<{ productId: string; qty: string }[]>(() => (recipe?.lines ?? []).map((l) => ({ productId: l.productId, qty: String(l.qty) })))
  const [find, setFind] = useState('')
  const [busy, setBusy] = useState(false)
  const productById = (id: string) => products.find((p) => p.id === id)
  const hits = find.trim()
    ? products.filter((p) => p.active !== false && !lines.some((l) => l.productId === p.id) && looseMatch([p.name, p.sku], find)).slice(0, 8)
    : []
  const clash = existing.find((r) => r.id !== recipe?.id && code.trim() && keyOf(r.code) === keyOf(code))

  async function save() {
    setBusy(true)
    try {
      await onSave({
        ...(recipe ? { id: recipe.id } : {}),
        code,
        name,
        aliases: aliases.split(',').map((a) => a.trim()).filter(Boolean),
        lines: lines.map((l) => ({ productId: l.productId, qty: Number(l.qty) })),
      })
    } catch (e) {
      toast.error(errText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={recipe ? t('แก้ไขสูตร {name}', { name: recipe.name }) : t('เพิ่มสูตร')}
      wide
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          {recipe ? (
            <Button variant="ghost" onClick={() => void onToggle(recipe).catch((e) => toast.error(errText(e, t)))} disabled={busy}>
              {recipe.active ? t('ปิดสูตรนี้ (เลิกขาย)') : t('เปิดใช้สูตรนี้')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              {t('ยกเลิก')}
            </Button>
            <Button onClick={() => void save()} disabled={busy || !!clash}>
              <Icon name="check" size={16} />
              {busy ? t('กำลังบันทึก...') : t('บันทึกสูตร')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <Field label={t('รหัสเมนู (POS)')} required>
            <Input value={code} onChange={(e) => setCode(e.target.value)} className={clash ? 'border-danger' : ''} />
          </Field>
          <Field label={t('ชื่อเมนู')} required>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        {clash && <p className="text-sm text-danger">{t('รหัสเมนู {code} ใช้กับ "{name}" อยู่แล้ว', { code: code.trim(), name: clash.name })}</p>}
        <Field label={t('ชื่ออื่นที่ POS อาจใช้ (คั่นด้วย ,)')} hint={t('เช่น ชื่อย่อในไฟล์ยอดขาย — ใช้จับคู่เมื่อไฟล์ไม่มีรหัส')}>
          <Input value={aliases} onChange={(e) => setAliases(e.target.value)} />
        </Field>

        <div>
          <div className="mb-2 text-sm font-semibold text-ink">{t('ส่วนผสมต่อ 1 ที่ (หน่วยหลักของสินค้า)')}</div>
          <div className="relative">
            <SearchInput value={find} onChange={setFind} placeholder={t('ค้นหาวัตถุดิบเพื่อเพิ่ม')} />
            {hits.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-line bg-surface shadow-lg">
                {hits.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-sunken"
                      onClick={() => {
                        setLines((cur) => [...cur, { productId: p.id, qty: '' }])
                        setFind('')
                      }}
                    >
                      <span className="truncate">{p.name}</span>
                      <span className="shrink-0 text-xs text-ink-faint">{p.unitType}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {lines.length === 0 ? (
            <p className="py-4 text-center text-sm text-ink-faint">{t('ยังไม่มีส่วนผสม')}</p>
          ) : (
            <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
              {lines.map((l, i) => {
                const p = productById(l.productId)
                return (
                  <li key={l.productId} className="flex items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{p?.name ?? l.productId}</span>
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min={0}
                      value={l.qty}
                      onChange={(e) => setLines((cur) => cur.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
                      aria-label={t('ปริมาณ: {name}', { name: p?.name ?? '' })}
                      className="num min-h-10 !w-24 text-right"
                    />
                    <span className="w-10 text-xs text-ink-soft">{p?.unitType}</span>
                    <button
                      type="button"
                      onClick={() => setLines((cur) => cur.filter((_, j) => j !== i))}
                      aria-label={t('เอาออก')}
                      className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-ink-faint hover:bg-danger-soft hover:text-danger"
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  )
}
