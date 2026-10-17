import { describe, expect, it } from 'vitest'
import React from 'react'
import ReactDOMServer from 'react-dom/server'
import { ToastProvider } from '../src/components/Toast'
import { ToastCard } from '../src/components/ToastCard'
import { I18nProvider } from '../src/i18n/I18nContext'
import type { ToastRecord } from '../src/lib/toastQueue'

function renderWithToast(initialToasts: ToastRecord[] = []) {
  return ReactDOMServer.renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ToastProvider, { initialToasts }, React.createElement('div', { id: 'child' }, 'App Content'))
    )
  )
}

const ASSERTIVE = 'aria-live="assertive"'
const ASSERTIVE_LANE = 'role="region"'
const POLITE = 'role="status"'

describe('Toast live region DOM structure (a11y)', () => {
  it('leaves no always-mounted role="alert" node behind', () => {
    const html = renderWithToast([])
    // Both lanes stay live regions before the first toast arrives…
    expect(html).toContain(ASSERTIVE)
    expect(html).toContain('aria-relevant="additions text"')
    expect(html).toContain(POLITE)
    expect(html).toContain('aria-live="polite"')
    // …but neither may claim role="alert": an empty alert landmark wraps the whole app, so an
    // unscoped page.getByRole('alert') (the sign-in banner, the operational notices) would
    // resolve to two nodes and fail Playwright strict mode.
    expect(html).not.toContain('role="alert"')
    expect(html).not.toContain('data-toast')
  })

  it('names both lanes so screen readers register the live regions up front', () => {
    const html = renderWithToast([])
    const assertive = html.slice(html.indexOf(ASSERTIVE_LANE), html.indexOf(POLITE))
    expect(assertive).toContain(ASSERTIVE)
    expect(assertive).toContain('การแจ้งเตือนสำคัญ')
    expect(html.slice(html.indexOf(POLITE))).toContain('การแจ้งเตือนชั่วคราว')
  })

  it('routes error toasts to the assertive region and keeps polite region empty', () => {
    const html = renderWithToast([{ id: 1, kind: 'error', title: 'Network failed' }])

    const assertiveIndex = html.indexOf(ASSERTIVE_LANE)
    const statusIndex = html.indexOf(POLITE)
    expect(assertiveIndex).toBeGreaterThan(-1)
    expect(statusIndex).toBeGreaterThan(assertiveIndex)

    const assertiveLane = html.slice(assertiveIndex, statusIndex)
    const politeLane = html.slice(statusIndex)

    expect(assertiveLane).toContain('Network failed')
    expect(assertiveLane).toContain('data-toast-kind="error"')
    expect(politeLane).not.toContain('Network failed')
  })

  it('routes success and info toasts to the polite region and keeps assertive region empty', () => {
    const html = renderWithToast([
      { id: 1, kind: 'success', title: 'Saved successfully' },
      { id: 2, kind: 'info', title: 'Sync completed' },
    ])

    const assertiveLane = html.slice(html.indexOf(ASSERTIVE_LANE), html.indexOf(POLITE))
    const politeLane = html.slice(html.indexOf(POLITE))

    expect(assertiveLane).not.toContain('Saved successfully')
    expect(assertiveLane).not.toContain('Sync completed')
    expect(politeLane).toContain('Saved successfully')
    expect(politeLane).toContain('Sync completed')
  })

  it('renders repeated error revision attributes and retains text node', () => {
    const cardHtml = ReactDOMServer.renderToStaticMarkup(
      React.createElement(
        I18nProvider,
        null,
        React.createElement(ToastCard, {
          toast: { id: 1, kind: 'error', title: 'Retry failed', revision: 2 },
          onDismiss: () => {},
        })
      )
    )
    expect(cardHtml).toContain('data-toast-revision="2"')
    expect(cardHtml).toContain('Retry failed')
  })
})
