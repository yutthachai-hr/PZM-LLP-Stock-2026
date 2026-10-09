/**
 * Which stock commands go through the trusted server (ADR-001), from VITE_STOCK_COMMANDS:
 * names separated by commas, or `all`. Read once; a build either sends a command to the
 * server or does not.
 */
const ON = new Set(
  (import.meta.env.VITE_STOCK_COMMANDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
)

export function commandOn(name: string): boolean {
  return ON.has('all') || ON.has(name)
}
