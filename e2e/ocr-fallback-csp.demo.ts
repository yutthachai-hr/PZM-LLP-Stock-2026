import { test, expect } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'

const CSP_HEADER =
  "default-src 'self'; script-src 'self' https://static.line-scdn.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://profile.line-scdn.net https://static.line-scdn.net; font-src 'self' data:; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com wss://*.firebaseio.com https://api.line.me https://liff.line.me https://access.line.me https://static.line-scdn.net https://liffsdk.line-scdn.net https://api.open-meteo.com; frame-src https://liff.line.me https://access.line.me https://static.line-scdn.net; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self' https://access.line.me; frame-ancestors 'none'; upgrade-insecure-requests"

test.describe('real browser OCR fallback under production CSP', () => {
  test('renders synthetic PDF via fallback under strict production CSP', async ({ page }) => {
    const cspErrors: string[] = []
    const loadedWorkerUrls: string[] = []
    page.on('console', (msg) => {
      const text = msg.text()
      console.log('BROWSER CONSOLE:', text)
      if (text.includes('Content Security Policy') || text.includes('Refused to load') || text.includes('violates')) {
        cspErrors.push(text)
      }
    })
    page.on('pageerror', (err) => {
      console.log('BROWSER PAGEERROR:', err)
    })
    page.on('request', (req) => {
      if (req.url().includes('pdf.worker')) {
        loadedWorkerUrls.push(req.url())
      }
    })

    // Attach CSP to HTML documents
    await page.route('**/*.html', async (route) => {
      const res = await route.fetch()
      const headers = { ...res.headers(), 'content-security-policy': CSP_HEADER }
      await route.fulfill({ response: res, headers })
    })

    // Mock /api/ocr-bill to simulate transient 503 for initial PDF, then 200 for fallback image pages
    const requestedImages: string[] = []
    await page.route('**/api/ocr-bill', async (route) => {
      const req = route.request()
      const body = JSON.parse(req.postData() || '{}') as { image?: string }
      if (body.image?.startsWith('data:application/pdf')) {
        // Transient 503 to trigger client PDF.js fallback
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'model_unavailable',
            upstreamStatus: 503,
            model: 'gemini-2.5-flash',
            message: 'Model is overloaded',
          }),
        })
        return
      }
      if (body.image?.startsWith('data:image/')) {
        requestedImages.push(body.image)
        // Fallback page rendered image succeeds
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            supplier: 'Synthetic Supplier Co.',
            invoiceNo: 'SYN-001',
            date: '2026-10-19',
            lines: [{ name: 'Synthetic Item 1', qty: 10, unit: 'KG' }],
            model: '@cf/meta/llama-4-scout-17b-16e-instruct',
          }),
        })
        return
      }
      await route.fulfill({ status: 400, body: 'bad request' })
    })

    await page.goto('/e2e/ocr-harness.html')
    await expect(page.getByTestId('ocr-status')).toHaveText('idle')

    const textPdfPath = path.resolve(process.cwd(), 'tests/fixtures/ocr/synthetic-31-text.pdf')
    expect(fs.existsSync(textPdfPath), `fixture must exist at ${textPdfPath}`).toBe(true)

    // Upload the synthetic text PDF into the harness
    await page.getByTestId('ocr-input').setInputFiles(textPdfPath)

    // Wait for reading to complete
    try {
      await expect(page.getByTestId('ocr-status')).toHaveText('success', { timeout: 20_000 })
    } catch (e) {
      const errText = await page.getByTestId('ocr-error').innerText().catch(() => 'no error text')
      console.log('TEST FAILURE ERROR TEXT:', errText)
      throw e
    }
    expect(cspErrors).toHaveLength(0)

    const resultText = await page.getByTestId('ocr-result').innerText()
    const parsed = JSON.parse(resultText)
    expect(parsed.supplier).toBe('Synthetic Supplier Co.')
    expect(parsed.lines.length).toBeGreaterThan(0)
    expect(requestedImages.length).toBeGreaterThan(0)
    expect(loadedWorkerUrls.length).toBeGreaterThan(0)
    expect(loadedWorkerUrls[0]).toMatch(/^http:\/\/127\.0\.0\.1:5194\/assets\/pdf\.worker-.*\.mjs$/)
  })

  test('renders synthetic scanned PDF via fallback under strict production CSP', async ({ page }) => {
    const cspErrors: string[] = []
    const loadedWorkerUrls: string[] = []
    page.on('console', (msg) => {
      const text = msg.text()
      console.log('BROWSER CONSOLE:', text)
      if (text.includes('Content Security Policy') || text.includes('Refused to load') || text.includes('violates')) {
        cspErrors.push(text)
      }
    })
    page.on('pageerror', (err) => {
      console.log('BROWSER PAGEERROR:', err)
    })
    page.on('request', (req) => {
      if (req.url().includes('pdf.worker')) {
        loadedWorkerUrls.push(req.url())
      }
    })

    await page.route('**/*.html', async (route) => {
      const res = await route.fetch()
      const headers = { ...res.headers(), 'content-security-policy': CSP_HEADER }
      await route.fulfill({ response: res, headers })
    })

    await page.route('**/api/ocr-bill', async (route) => {
      const req = route.request()
      const body = JSON.parse(req.postData() || '{}') as { image?: string }
      if (body.image?.startsWith('data:application/pdf')) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'model_unavailable',
            upstreamStatus: 503,
            model: 'gemini-2.5-flash',
            message: 'Model is overloaded',
          }),
        })
        return
      }
      if (body.image?.startsWith('data:image/')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            supplier: 'Scan Supplier Co.',
            invoiceNo: 'SCAN-002',
            date: '2026-10-19',
            lines: [{ name: 'Scanned Item 1', qty: 5, unit: 'Carton' }],
            model: '@cf/meta/llama-4-scout-17b-16e-instruct',
          }),
        })
        return
      }
      await route.fulfill({ status: 400, body: 'bad request' })
    })

    await page.goto('/e2e/ocr-harness.html')
    await expect(page.getByTestId('ocr-status')).toHaveText('idle')

    const scanPdfPath = path.resolve(process.cwd(), 'tests/fixtures/ocr/synthetic-31-scan.pdf')
    expect(fs.existsSync(scanPdfPath), `fixture must exist at ${scanPdfPath}`).toBe(true)

    await page.getByTestId('ocr-input').setInputFiles(scanPdfPath)
    await expect(page.getByTestId('ocr-status')).toHaveText('success', { timeout: 20_000 })
    expect(cspErrors).toHaveLength(0)

    const resultText = await page.getByTestId('ocr-result').innerText()
    const parsed = JSON.parse(resultText)
    expect(parsed.supplier).toBe('Scan Supplier Co.')
    expect(parsed.lines.length).toBeGreaterThan(0)
    expect(loadedWorkerUrls.length).toBeGreaterThan(0)
    expect(loadedWorkerUrls[0]).toMatch(/^http:\/\/127\.0\.0\.1:5194\/assets\/pdf\.worker-.*\.mjs$/)
  })
})
