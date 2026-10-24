import { readFileSync } from 'node:fs'
import { describe, expect, test, vi } from 'vitest'
import { matchPath } from 'react-router-dom'
import { APP_DECLARED_ROUTES } from './r72-navigation-contract.test'

describe('R72 Navigation Fixes: RED reproduction & regression verification', () => {
  describe('1. NotificationBell settings link', () => {
    test('footer link must route to /settings/notifications (matching App route /settings/:section)', () => {
      const bellSource = readFileSync(new URL('../src/components/notifications/NotificationBell.tsx', import.meta.url), 'utf8')
      
      // Must not use hash fragment #notifications which fails :section route param resolution
      expect(bellSource).not.toContain("navigate('/settings#notifications')")
      expect(bellSource).toContain("navigate('/settings/notifications')")
    })

    test('route matching contract: /settings/notifications binds section param whereas /settings#notifications does not', () => {
      const validUrl = new URL('/settings/notifications', 'http://localhost')
      const hashUrl = new URL('/settings#notifications', 'http://localhost')

      const matchValid = matchPath({ path: '/settings/:section', end: true }, validUrl.pathname)
      expect(matchValid).not.toBeNull()
      expect(matchValid?.params.section).toBe('notifications')

      const matchHash = matchPath({ path: '/settings/:section', end: true }, hashUrl.pathname)
      // Hash is not in pathname, so it fails to match /settings/:section
      expect(matchHash).toBeNull()

      const matchPlain = matchPath({ path: '/settings', end: true }, hashUrl.pathname)
      expect(matchPlain).not.toBeNull()
    })
  })

  describe('2. Suppliers same-page reactive query state (?id=A -> ?id=B)', () => {
    test('Suppliers.tsx must use reactive useSearchParams, not static location.search on mount', () => {
      const suppliersSource = readFileSync(new URL('../src/pages/Suppliers.tsx', import.meta.url), 'utf8')

      // Must import and use useSearchParams from react-router-dom
      expect(suppliersSource).toMatch(/import\s*\{[^}]*useSearchParams[^}]*\}\s*from\s*['"]react-router-dom['"]/)
      expect(suppliersSource).not.toContain("useState<string | null>(() => new URLSearchParams(location.search).get('id'))")
      expect(suppliersSource).not.toContain("useState(() => !!new URLSearchParams(location.search).get('id'))")
    })

    test('reactive query effect updates selectedId and sheetOpen on same-page query param change', () => {
      // Simulate Suppliers query state logic
      let searchParams = new URLSearchParams('id=sup-panfood')
      let selectedId: string | null = searchParams.get('id')
      let sheetOpen = !!searchParams.get('id')

      const reactiveEffect = (queryId: string | null) => {
        if (queryId) {
          selectedId = queryId
          sheetOpen = true
        }
      }

      // Initial mount
      expect(selectedId).toBe('sup-panfood')
      expect(sheetOpen).toBe(true)

      // User manually closes sheet
      sheetOpen = false
      expect(sheetOpen).toBe(false)
      expect(selectedId).toBe('sup-panfood')

      // Same-page navigation to ?id=sup-beverage
      searchParams = new URLSearchParams('id=sup-beverage')
      reactiveEffect(searchParams.get('id'))

      // Must reactively select new supplier and re-open sheet
      expect(selectedId).toBe('sup-beverage')
      expect(sheetOpen).toBe(true)

      // Manual selection in table (select supplier C)
      const select = (id: string) => {
        selectedId = id
        sheetOpen = true
      }
      select('sup-dairy')
      expect(selectedId).toBe('sup-dairy')
      expect(sheetOpen).toBe(true)
    })
  })

  describe('3. LineBuilder same-page reopen ?import=1', () => {
    test('LineBuilder.tsx effect must react to params and call setImporting(true) inside effect', () => {
      const lineBuilderSource = readFileSync(new URL('../src/components/LineBuilder.tsx', import.meta.url), 'utf8')

      // Extract the import effect block
      const effectMatch = lineBuilderSource.match(/useEffect\(\(\)\s*=>\s*\{([\s\S]*?delete\('import'[\s\S]*?)\}\s*,\s*(\[[^\]]*\])\)/)
      expect(effectMatch).not.toBeNull()
      const effectBody = effectMatch![1]
      const effectDeps = effectMatch![2]

      // Inside the effect body, it MUST call setImporting(true) to reopen the modal on same-page trigger
      expect(effectBody).toContain('setImporting(true)')
      // Dependency array must NOT be empty []
      expect(effectDeps).not.toBe('[]')
    })

    test('reproduction: same-page transition to ?import=1 re-opens modal and clears URL flag once', () => {
      let params = new URLSearchParams('')
      let importing = false
      const importable = true
      const setParams = vi.fn((next: URLSearchParams) => {
        params = next
      })

      // Minimal simulated effect from LineBuilder
      const runEffect = () => {
        if (importable && params.get('import') === '1') {
          importing = true
          const next = new URLSearchParams(params)
          next.delete('import')
          setParams(next, { replace: true })
        }
      }

      // Step 1: User is on /issue with importing closed
      expect(importing).toBe(false)
      runEffect()
      expect(importing).toBe(false)
      expect(setParams).not.toHaveBeenCalled()

      // Step 2: User clicks quicklink ?import=1 on same page
      params = new URLSearchParams('import=1')
      runEffect()

      // Must re-open modal
      expect(importing).toBe(true)
      // Must clean up URL flag
      expect(setParams).toHaveBeenCalledTimes(1)
      expect(params.get('import')).toBeNull()

      // Step 3: Next render with cleared params must not re-trigger
      setParams.mockClear()
      runEffect()
      expect(setParams).not.toHaveBeenCalled()
      expect(importing).toBe(true) // stays open for user
    })

    test('importable=false does not open import modal even if ?import=1', () => {
      let params = new URLSearchParams('import=1')
      let importing = false
      const importable = false
      const setParams = vi.fn()

      const runEffect = () => {
        if (importable && params.get('import') === '1') {
          importing = true
          const next = new URLSearchParams(params)
          next.delete('import')
          setParams(next, { replace: true })
        }
      }

      runEffect()
      expect(importing).toBe(false)
      expect(setParams).not.toHaveBeenCalled()
    })
  })
})
