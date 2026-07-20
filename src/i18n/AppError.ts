import type { TFn } from './I18nContext'

/**
 * An error whose message is a translation key plus its values, so services can report
 * failures without knowing the current language.
 *
 * Services run outside React and cannot call useT(), and a message that has already had
 * "{qty} {unit}" substituted in would no longer match any dictionary entry. Carrying the
 * key and vars separately lets the component that catches it translate at display time.
 *
 * `message` stays readable Thai so an uncaught one still makes sense in the console.
 */
export class AppError extends Error {
  readonly key: string
  readonly vars?: Record<string, string | number>

  constructor(key: string, vars?: Record<string, string | number>) {
    super(fillForMessage(key, vars))
    this.name = 'AppError'
    this.key = key
    this.vars = vars
  }
}

function fillForMessage(key: string, vars?: Record<string, string | number>): string {
  if (!vars) return key
  return key.replace(/\{(\w+)\}/g, (whole, k) => (vars[k] === undefined ? whole : String(vars[k])))
}

/** Translates a caught error for display. Non-AppErrors fall back to their own message. */
export function errText(e: unknown, t: TFn): string {
  if (e instanceof AppError) return t(e.key, e.vars)
  if (e instanceof Error) return e.message
  return String(e)
}
