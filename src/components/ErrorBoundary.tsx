import { Component, type ReactNode } from 'react'
import { Button, Spinner } from './ui'

export const CHUNK_RELOAD_KEY = 'pzm_chunk_reload'

export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false
  const msg = error instanceof Error ? error.message : String(error)
  const name = error instanceof Error ? error.name : ''
  return name === 'ChunkLoadError' || /chunk|dynamically imported module|module script/i.test(msg)
}

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  reloading: boolean
}

// ponytail: class error boundary for lazy routes; add remote error telemetry when configured
export class ErrorBoundary extends Component<Props, State> {
  static readonly CHUNK_RELOAD_KEY = CHUNK_RELOAD_KEY
  static readonly isChunkLoadError = isChunkLoadError

  override state: State = { hasError: false, error: null, reloading: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, reloading: false }
  }

  override componentDidCatch(error: Error) {
    if (isChunkLoadError(error)) {
      try {
        const alreadyReloaded = sessionStorage.getItem(CHUNK_RELOAD_KEY)
        if (!alreadyReloaded) {
          sessionStorage.setItem(CHUNK_RELOAD_KEY, '1')
          this.setState({ reloading: true })
          window.location.reload()
        }
      } catch {
        // sessionStorage may throw in privacy-restricted sandboxes
      }
    }
  }

  handleReload = () => {
    try {
      sessionStorage.removeItem(CHUNK_RELOAD_KEY)
    } catch {
      // ignore
    }
    window.location.reload()
  }

  override render() {
    if (this.state.hasError) {
      if (this.state.reloading) {
        return (
          <div className="flex min-h-[50vh] flex-col items-center justify-center p-6 text-center">
            <Spinner label="กำลังโหลดเวอร์ชันใหม่... / Loading update..." /> {/* bilingual chunk-load message — i18n-key */}
          </div>
        )
      }
      return (
        <div className="flex min-h-[50vh] flex-col items-center justify-center p-6 text-center">
          <div className="max-w-md space-y-4 rounded-xl border border-line bg-surface p-6 shadow-sm">
            <h2 className="text-base font-semibold text-ink">
              ไม่สามารถโหลดหน้านี้ได้ / Page load failed {/* bilingual chunk-load message — i18n-key */}
            </h2>
            <p className="text-sm text-ink-soft">
              ระบบอาจมีการอัปเดตเวอร์ชันใหม่ หรือการเชื่อมต่ออินเทอร์เน็ตขัดข้อง กรุณากดโหลดใหม่ {/* bilingual chunk-load message — i18n-key */}
              <br />
              The app may have been updated or network connection was lost. Please reload.
            </p>
            <div className="pt-2">
              <Button variant="primary" onClick={this.handleReload}>
                โหลดใหม่ / Reload {/* bilingual chunk-load message — i18n-key */}
              </Button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
