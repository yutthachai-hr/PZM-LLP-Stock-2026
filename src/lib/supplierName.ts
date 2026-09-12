// Reading the supplier out of a product name, and writing a new one back in.
//
// The catalogue names its supplier in brackets — "BAKING SODA (MARKO)". That was a habit,
// not a field, so this is archaeology rather than parsing, and every rule below comes from
// looking at all 454 names rather than from what the convention ought to be:
//
//   - Four names carry two brackets, and in all four the supplier is the LAST one:
//     "PRAMA HAM 18 MONTH(8KG/PC) (PREMIUM FOOD)". So the search runs from the right.
//   - Some brackets are pack sizes, not suppliers: (25*12), (0.5KG), (8KG/PC), (1*100).
//   - Some are neither: (BRANCH 3) is a location.
//   - Real suppliers are often two letters — KT, VL, MK, FL — so shortness proves nothing.
//   - The same supplier is spelled several ways: MARKO and MAKRO; SIMUNMMANG, SIMUMMUANG
//     and SIMUMUANG; SINO FACIFIC, SINO PACIFIC and SINO BACIFIC.
//
// Nothing here decides anything on its own. It proposes, and a person accepts — including
// looking at what was rejected, because a rule that throws away (7/11) is wrong about a real
// shop and only the owner can say so.

/**
 * Brackets the size rules would throw out, but that the owner says are real shops.
 *
 * "(7/11)" reads as a measurement to any rule that looks at digits and slashes, and no rule
 * is ever going to know better. This is why the proposal shows what it rejected as well as
 * what it kept: the owner rescued this one by hand.
 */
const KEPT_DESPITE_LOOKING_LIKE_A_SIZE: Record<string, string> = {
  '7/11': '7/11 SEVEN ELEVEN',
}

/**
 * Brackets that name something other than a supplier, and who the supplier actually is.
 *
 * "GAS 48 KG (BRANCH 3)" names a branch, because that gas is delivered straight to the Onnut
 * shop rather than to the warehouse. The owner named the company: PAP GAS.
 */
const NOT_THE_SUPPLIER: Record<string, string> = {
  'BRANCH 3': 'PAP GAS',
}

/** Extra detail the owner gave about a supplier while settling its name. */
export const SUPPLIER_NOTES: Record<string, string> = {
  'PAP GAS': 'ส่งตรงที่หน้าร้านสาขาอ่อนนุช (สาขา 3) ไม่ผ่านคลังหลัก', // i18n-key
}

/**
 * Spellings the owner settled, and the spelling they chose.
 *
 * สีมุมเมือง appears three ways across 42 products. The rules proposed two of them as one
 * group and left the third out; the owner merged all three and picked the spelling below.
 */
const CANONICAL: Record<string, string> = {
  SIMUNMMANG: 'SIMMUMMUANG',
  SIMUMMUANG: 'SIMMUMMUANG',
  SIMUMUANG: 'SIMMUMMUANG',
}

/** A bracket that is a measurement rather than a name: "25*12", "1*100", "4.5". */
const ONLY_NUMBERS_AND_SYMBOLS = /^[\d\s.*/xX+\-]+$/

/** A bracket that opens with a quantity and a unit: "0.5KG", "8KG/PC", "720 G". */
const OPENS_WITH_A_SIZE = /^[\d.]+\s*(KG|G|ML|L|OZ|PC|PCS)\b/i

/**
 * The supplier a product name claims, or null when it names none.
 *
 * Searched from the right because a name with two brackets puts the pack size first.
 */
export function supplierFromName(name: string): string | null {
  const brackets = name.match(/\(([^()]*)\)/g) ?? []
  for (let i = brackets.length - 1; i >= 0; i--) {
    const inner = brackets[i].slice(1, -1).trim()
    if (!inner) continue
    if (inner in KEPT_DESPITE_LOOKING_LIKE_A_SIZE) return inner
    if (ONLY_NUMBERS_AND_SYMBOLS.test(inner)) continue
    if (OPENS_WITH_A_SIZE.test(inner)) continue
    return inner
  }
  return null
}

/**
 * What two spellings have to share to be worth proposing as one supplier.
 *
 * Case, spaces and punctuation are noise: "FOOD GALLERY", "FOODGALLERY" and "FOOD GALLER"
 * are one company typed three ways.
 */
export function mergeKey(supplier: string): string {
  return supplier.toUpperCase().replace(/[^A-Z0-9฀-๿]/g, '') // i18n-key
}

/**
 * How alike two keys are, 0 to 1, by longest common subsequence.
 *
 * The first attempt walked one string taking the next matching character it could find,
 * which is greedy and asymmetric: SINOFACIFIC against SINOPACIFIC jumped to the F near the
 * end and scored 0.55, while SINOPACIFIC against SINOBACIFIC scored 0.91 — the same kind of
 * difference, one letter, judged completely differently. These names are a couple of dozen
 * characters, so the honest quadratic answer is both cheap and right.
 */
function similarity(a: string, b: string): number {
  if (a === b) return 1
  if (!a.length || !b.length) return 0
  const rows: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      rows[i][j] =
        a[i - 1] === b[j - 1] ? rows[i - 1][j - 1] + 1 : Math.max(rows[i - 1][j], rows[i][j - 1])
    }
  }
  return rows[a.length][b.length] / Math.max(a.length, b.length)
}

/**
 * Spellings that probably name the same supplier.
 *
 * Only a proposal. Two of these groups in the real catalogue are a single transposed letter
 * apart and two are a missing space, which no amount of cleverness distinguishes from two
 * genuinely different companies — so the answer is shown to someone who knows.
 */
export function proposeMerges(suppliers: readonly string[]): string[][] {
  const byKey = new Map<string, string>()
  for (const s of suppliers) byKey.set(s, mergeKey(s))
  const taken = new Set<string>()
  const groups: string[][] = []

  for (const a of suppliers) {
    if (taken.has(a)) continue
    const group = [a]
    taken.add(a)
    for (const b of suppliers) {
      if (taken.has(b)) continue
      const ka = byKey.get(a)!
      const kb = byKey.get(b)!
      const sameLetters =
        ka.length > 3 && [...ka].sort().join('') === [...kb].sort().join('')
      const nearlySpelled = ka.length > 5 && similarity(ka, kb) >= 0.87
      if (ka === kb || sameLetters || nearlySpelled) {
        group.push(b)
        taken.add(b)
      }
    }
    if (group.length > 1) groups.push(group)
  }
  return groups
}

/**
 * Rewrite the supplier inside a product name.
 *
 * The owner asked for the name itself to change when a supplier is renamed, so "(KT)"
 * becomes "(Klongtoei)" on all twenty-eight of its products rather than only in a field
 * nobody reads. Only the bracket this supplier occupies is touched — a pack size in the
 * same name is left exactly as it is, and a name that does not carry this supplier comes
 * back unchanged rather than being guessed at.
 *
 * `spellings` is every way this supplier appears in the catalogue, because merging MAKRO
 * into MARKO leaves products under both and a rename has to reach all of them. They are
 * passed in rather than guessed: matching loosely here would rewrite a name that happens to
 * look similar, and there is no undo for that.
 */
export function renameInProductName(
  name: string,
  spellings: readonly string[],
  to: string,
): string {
  const current = supplierFromName(name)
  if (current === null) return name
  const wanted = new Set(spellings.map(mergeKey))
  if (!wanted.has(mergeKey(current))) return name
  // Replace the last bracket holding exactly this text, leaving any earlier one alone.
  const target = `(${current})`
  const at = name.lastIndexOf(target)
  if (at === -1) return name
  return name.slice(0, at) + `(${to})` + name.slice(at + target.length)
}

/**
 * The name a bracket finally counts as, after the owner's rulings.
 *
 * Kept apart from reading the bracket so the two stay honest about what they are: one is a
 * rule about how the catalogue is written, the other is a person's decision about their own
 * suppliers. Adding a decision here should never quietly change how a name is parsed.
 */
export function settleSupplier(raw: string): string {
  const trimmed = raw.trim()
  const rescued = KEPT_DESPITE_LOOKING_LIKE_A_SIZE[trimmed]
  if (rescued) return rescued
  const corrected = NOT_THE_SUPPLIER[trimmed.toUpperCase()]
  if (corrected) return corrected
  return CANONICAL[mergeKey(trimmed)] ?? trimmed
}
