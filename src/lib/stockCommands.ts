/**
 * Which stock commands go through the trusted server (ADR-001), from VITE_STOCK_COMMANDS.
 * Read once; a build either sends a command to the server or does not.
 */
export type StockCommandName = 'receivePO'

const ON = new Set(
  (import.meta.env.VITE_STOCK_COMMANDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
)

export function commandOn(name: StockCommandName): boolean {
  return ON.has(name)
}
