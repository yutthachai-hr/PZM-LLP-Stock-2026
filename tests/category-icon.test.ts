// Products without a photo get an icon from their category (spec §2.2).
import { expect, test } from 'vitest'
import { categoryIcon } from '../src/lib/categoryIcon'

test('every category in the company workbooks gets a specific icon, not the fallback box, where one fits', () => {
  expect(categoryIcon('Vegetable').icon).toBe('leaf')
  expect(categoryIcon('Meat & Seafood').icon).toBe('fish')
  expect(categoryIcon('Cheese & Dairy').icon).toBe('milk')
  expect(categoryIcon('Cooking Oil').icon).toBe('droplet')
  expect(categoryIcon('Seasoning').icon).toBe('sparkles')
  expect(categoryIcon('Flour').icon).toBe('wheat')
  expect(categoryIcon('Bread & Powder').icon).toBe('wheat')
  expect(categoryIcon('Beverage').icon).toBe('cupSoda')
  expect(categoryIcon('Ice Cream').icon).toBe('snowflake')
  expect(categoryIcon('Gas').icon).toBe('flame')
  expect(categoryIcon('Wood').icon).toBe('flame')
  expect(categoryIcon('Canned Goods').icon).toBe('package')
  expect(categoryIcon('Office Supply').icon).toBe('note')
})

test('a sauce pack is a sauce, a pizza box is a box, and anything unknown is a box', () => {
  expect(categoryIcon('PM Sauce Pack').icon).toBe('droplet')
  expect(categoryIcon('Pizza Sauce').icon).toBe('droplet')
  expect(categoryIcon('Pizza Box').icon).toBe('box')
  expect(categoryIcon('Pizza Packing Other').icon).toBe('box')
  expect(categoryIcon('Something new').icon).toBe('box')
  expect(categoryIcon(undefined)).toEqual({ icon: 'box', tone: 'slate' })
})
