import { expect, type Browser, type Page } from '@playwright/test'
import { PASSWORD, PEOPLE, type Person } from './fixture'

/**
 * Open a screen. A full page load asks for the brand again (the choice lives for the
 * session), so the picker is answered whenever it shows.
 */
export async function open(page: Page, path: string): Promise<void> {
  await page.goto(path)
  const brand = page.getByRole('button', { name: 'Pizza Mania' })
  const app = page.getByText('ฐานข้อมูลจำลองสำหรับทดสอบ (emulator)')
  await expect(brand.or(page.locator('main'))).toBeVisible()
  if (await brand.isVisible()) await brand.click()
  await expect(app).toBeVisible()
  await expect(page.locator('main')).toBeVisible()
}

/** A signed-in person in their own browser context — a separate device, own storage. */
export async function signedIn(browser: Browser, who: Person, path = '/'): Promise<Page> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/')
  await page.getByPlaceholder('you@email.com').fill(PEOPLE[who].email)
  await page.locator('input[type="password"]').fill(PASSWORD)
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
  await page.getByRole('button', { name: 'Pizza Mania' }).click()
  await expect(page.locator('main')).toBeVisible()
  if (path !== '/') await open(page, path)
  return page
}
