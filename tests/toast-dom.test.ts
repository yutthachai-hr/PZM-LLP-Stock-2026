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

describe('Toast live region DOM structure (a11y)', () => {
  it('renders both assertive and polite persistent regions when empty', () => {
    const html = renderWithToast([])
    // Both regions must be present in the DOM BEFORE toasts arrive
    expect(html).toContain('role="alert"')
    expect(html).toContain('aria-live="assertive"')
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
    // aria-relevant should include text for re-announcement
    expect(html).toContain('aria-relevant="additions text"')
    // No toast cards rendered when empty
    expect(html).not.toContain('data-toast')
  })

  it('routes error toasts to the assertive region and keeps polite region empty', () => {
    const html = renderWithToast([{ id: 1, kind: 'error', title: 'Network failed' }])
    
    const alertIndex = html.indexOf('role="alert"')
    const statusIndex = html.indexOf('role="status"')
    expect(alertIndex).toBeGreaterThan(-1)
    expect(statusIndex).toBeGreaterThan(alertIndex)
    
    const alertContent = html.slice(alertIndex, statusIndex)
    const statusContent = html.slice(statusIndex)
    
    expect(alertContent).toContain('Network failed')
    expect(alertContent).toContain('data-toast-kind="error"')
    expect(statusContent).not.toContain('Network failed')
  })

  it('routes success and info toasts to the polite region and keeps assertive region empty', () => {
    const html = renderWithToast([
      { id: 1, kind: 'success', title: 'Saved successfully' },
      { id: 2, kind: 'info', title: 'Sync completed' },
    ])
    
    const alertIndex = html.indexOf('role="alert"')
    const statusIndex = html.indexOf('role="status"')
    expect(alertIndex).toBeGreaterThan(-1)
    expect(statusIndex).toBeGreaterThan(alertIndex)
    
    const alertContent = html.slice(alertIndex, statusIndex)
    const statusContent = html.slice(statusIndex)
    
    expect(alertContent).not.toContain('Saved successfully')
    expect(alertContent).not.toContain('Sync completed')
    expect(statusContent).toContain('Saved successfully')
    expect(statusContent).toContain('Sync completed')
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
