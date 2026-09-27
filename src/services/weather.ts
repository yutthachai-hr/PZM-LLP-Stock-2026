/**
 * Bangkok's weather for the clock panel at the foot of the sidebar (owner, 27 Sep 2026).
 *
 * Open-Meteo: free, no key, no account. It never touches Firestore, and one answer is kept
 * on the device for half an hour, so the panel costs at most two small requests an hour per
 * device and nothing at all against the database's daily limits. Allowed in the CSP's
 * connect-src (public/_headers). A failure just leaves the weather off the panel.
 */

export type Sky = 'clear' | 'partly' | 'cloudy' | 'fog' | 'rain' | 'storm'

export interface Weather {
  temp: number
  sky: Sky
  isDay: boolean
  at: number
}

const URL_ =
  'https://api.open-meteo.com/v1/forecast?latitude=13.7563&longitude=100.5018&current=temperature_2m,weather_code,is_day&timezone=Asia%2FBangkok'
const KEY = 'pzm.weather'
export const WEATHER_TTL_MS = 30 * 60_000

/** WMO weather code → the six skies the panel draws. */
export function skyOf(code: number): Sky {
  if (code === 0) return 'clear'
  if (code <= 2) return 'partly'
  if (code === 3) return 'cloudy'
  if (code === 45 || code === 48) return 'fog'
  if (code >= 95) return 'storm'
  return 'rain'
}

export function keptWeather(now: number): Weather | null {
  try {
    const w = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Weather | null
    return w && typeof w.temp === 'number' && now - w.at < WEATHER_TTL_MS ? w : null
  } catch {
    return null
  }
}

export async function fetchWeather(now: number): Promise<Weather | null> {
  const kept = keptWeather(now)
  if (kept) return kept
  try {
    const res = await fetch(URL_)
    if (!res.ok) return null
    const body = (await res.json()) as { current?: { temperature_2m?: number; weather_code?: number; is_day?: number } }
    const c = body.current
    if (!c || typeof c.temperature_2m !== 'number' || typeof c.weather_code !== 'number') return null
    const w: Weather = { temp: Math.round(c.temperature_2m), sky: skyOf(c.weather_code), isDay: c.is_day !== 0, at: now }
    try {
      localStorage.setItem(KEY, JSON.stringify(w))
    } catch {
      // Storage blocked: fine, it is fetched again next time.
    }
    return w
  } catch {
    return null
  }
}
