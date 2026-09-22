import type { IconName } from '../components/Icon'
import type { Tone } from '../components/frame/tones'

/**
 * The picture a product gets when it has no photo — which is most of them: Firebase's
 * free tier has no Storage, so only the handful someone uploaded have one (spec §2.2).
 *
 * Categories are the company's own English names from the item-code workbooks ("Cheese &
 * Dairy", "PM Sauce Pack", …), matched by keyword so a new category that says "sauce"
 * still gets the sauce icon. Order matters: "PM Sauce Pack" is a sauce before it is a pack.
 */
const RULES: { test: RegExp; icon: IconName; tone: Tone }[] = [
  { test: /ice ?cream/, icon: 'snowflake', tone: 'blue' },
  { test: /vegetable|veg\b|fruit/, icon: 'leaf', tone: 'green' },
  { test: /meat|seafood|fish|pork|chicken|beef/, icon: 'fish', tone: 'red' },
  { test: /cheese|dairy|milk|butter|cream/, icon: 'milk', tone: 'amber' },
  { test: /sauce/, icon: 'droplet', tone: 'red' },
  { test: /oil/, icon: 'droplet', tone: 'amber' },
  { test: /season|spice|herb/, icon: 'sparkles', tone: 'purple' },
  { test: /flour|pasta|bread|powder|dough/, icon: 'wheat', tone: 'amber' },
  { test: /bever|drink|juice|soda|water/, icon: 'cupSoda', tone: 'blue' },
  { test: /gas|wood|fuel|charcoal/, icon: 'flame', tone: 'red' },
  { test: /canned|can\b/, icon: 'package', tone: 'blue' },
  { test: /office|stationer/, icon: 'note', tone: 'slate' },
  { test: /box|pack|packing|packaging/, icon: 'box', tone: 'slate' },
]

export function categoryIcon(category: string | undefined): { icon: IconName; tone: Tone } {
  const c = (category ?? '').toLowerCase()
  for (const r of RULES) if (r.test.test(c)) return { icon: r.icon, tone: r.tone }
  return { icon: 'box', tone: 'slate' }
}
