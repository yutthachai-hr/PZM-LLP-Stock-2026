import React from 'react'
import ReactDOMServer from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// Setup window stub in Node environment
vi.hoisted(() => {
  ;(globalThis as unknown as { window: unknown }).window = {
    location: { reload() {} },
  }
})

import {
  ErrorBoundary,
  CHUNK_RELOAD_KEY,
  isChunkLoadError,
} from '../src/components/ErrorBoundary'

describe('Route ErrorBoundary & Chunk Load Handling', () => {
  let mockReload: ReturnType<typeof vi.fn>
  let storageStore: Record<string, string>

  beforeEach(() => {
    storageStore = {}
    mockReload = vi.fn()

    // Mock sessionStorage
    const mockSessionStorage = {
      getItem: vi.fn((key: string) => storageStore[key] ?? null),
      setItem: vi.fn((key: string, val: string) => {
        storageStore[key] = String(val)
      }),
      removeItem: vi.fn((key: string) => {
        delete storageStore[key]
      }),
      clear: vi.fn(() => {
        storageStore = {}
      }),
    }

    vi.stubGlobal('sessionStorage', mockSessionStorage)

    // Mock window.location.reload
    window.location = {
      reload: mockReload,
    } as unknown as Location
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('isChunkLoadError detection', () => {
    test('identifies Vite dynamic import fetch failures', () => {
      const err = new TypeError('Failed to fetch dynamically imported module: /assets/Orders-abc1234.js')
      expect(isChunkLoadError(err)).toBe(true)
    })

    test('identifies WebKit/Safari module script failure', () => {
      const err = new Error('Importing a module script failed.')
      expect(isChunkLoadError(err)).toBe(true)
    })

    test('identifies standard ChunkLoadError', () => {
      const err = new Error('ChunkLoadError: Loading chunk 27 failed')
      err.name = 'ChunkLoadError'
      expect(isChunkLoadError(err)).toBe(true)
    })

    test('returns false for generic runtime errors', () => {
      const err = new Error('Cannot read properties of undefined')
      expect(isChunkLoadError(err)).toBe(false)
    })
  })

  describe('ErrorBoundary Lifecycle and UI', () => {
    test('renders children when no error occurs', () => {
      const element = React.createElement(ErrorBoundary, null, React.createElement('div', { id: 'child' }, 'Normal Page'))
      const html = ReactDOMServer.renderToStaticMarkup(element)
      expect(html).toContain('Normal Page')
    })

    test('getDerivedStateFromError captures the error and sets hasError', () => {
      const err = new TypeError('Failed to fetch dynamically imported module')
      const state = ErrorBoundary.getDerivedStateFromError(err)
      expect(state.hasError).toBe(true)
      expect(state.error).toBe(err)
      expect(state.reloading).toBe(false)
    })

    test('auto-reloads on first chunk load failure and sets sessionStorage flag', () => {
      const eb = new ErrorBoundary({ children: 'content' })
      ;(eb as unknown as { updater: unknown }).updater = {
        enqueueSetState: (inst: ErrorBoundary, partial: { reloading?: boolean }) => {
          Object.assign(inst.state, partial)
        },
      }
      const err = new TypeError('Failed to fetch dynamically imported module')

      eb.componentDidCatch(err)

      expect(sessionStorage.setItem).toHaveBeenCalledWith(CHUNK_RELOAD_KEY, '1')
      expect(mockReload).toHaveBeenCalledTimes(1)
      expect(eb.state.reloading).toBe(true)
    })

    test('auto-reload guard fires AT MOST ONCE per session to prevent reload loops', () => {
      storageStore[CHUNK_RELOAD_KEY] = '1'

      const eb = new ErrorBoundary({ children: 'content' })
      const err = new TypeError('Failed to fetch dynamically imported module')

      eb.componentDidCatch(err)

      // Guard should block second reload
      expect(mockReload).not.toHaveBeenCalled()
      expect(eb.state.reloading).toBe(false)
    })

    test('renders bilingual recovery UI with reload button when auto-reload has already fired', () => {
      storageStore[CHUNK_RELOAD_KEY] = '1'
      const eb = new ErrorBoundary({ children: 'content' })
      const err = new TypeError('Failed to fetch dynamically imported module')
      eb.state = { hasError: true, error: err, reloading: false }

      const rendered = eb.render() as React.ReactElement
      const html = ReactDOMServer.renderToStaticMarkup(rendered)

      // Bilingual messages
      expect(html).toContain('ไม่สามารถโหลดหน้านี้ได้')
      expect(html).toContain('Page load failed')
      expect(html).toContain('โหลดใหม่ / Reload')
    })

    test('manual reload button clears the guard flag and triggers window.location.reload', () => {
      storageStore[CHUNK_RELOAD_KEY] = '1'
      const eb = new ErrorBoundary({ children: 'content' })
      eb.handleReload()

      expect(sessionStorage.removeItem).toHaveBeenCalledWith(CHUNK_RELOAD_KEY)
      expect(mockReload).toHaveBeenCalledTimes(1)
    })
  })
})
