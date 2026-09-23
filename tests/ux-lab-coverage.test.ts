import { describe, expect, it } from 'vitest'
import { missingRoutes } from '../scripts/ux-lab/coverage'

describe('missingRoutes', () => {
  it('is empty when every route is reached by some scenario', () => {
    expect(missingRoutes(['/', '/products'], [['/'], ['/products']])).toEqual([])
  })

  it('names the routes nobody visits', () => {
    expect(missingRoutes(['/', '/products', '/reports'], [['/', '/products']])).toEqual(['/reports'])
  })

  it('ignores the catch-all route', () => {
    expect(missingRoutes(['/', '*'], [['/']])).toEqual([])
  })

  it('treats the navigation shells as always covered', () => {
    expect(missingRoutes(['/', '/more', '/settings/:section'], [['/']])).toEqual([])
  })
})
