/**
 * Ask PZM — the closed set of things the read-only operations assistant can be asked.
 *
 * A model may only pick one of these labels (or abstain). The label is ROUTING: it chooses which
 * deterministic read function answers. No label is an answer, a stock figure or a permission.
 * `write_request` exists so a request to change data is recognised and refused — Ask PZM writes
 * nothing, ever (tests/agent-no-write-path.test.ts covers the whole of src/agent).
 */
export const ASK_INTENTS = ['stock_lookup', 'po_unconfirmed', 'stockout_risk', 'transfer_status', 'write_request', 'out_of_scope'] as const
export type AskIntent = (typeof ASK_INTENTS)[number]

export const READ_INTENTS: readonly AskIntent[] = ['stock_lookup', 'po_unconfirmed', 'stockout_risk', 'transfer_status']

/** What each intent means, in the words a model is shown (Laya `criteria`). */
export const INTENT_CRITERIA: Record<AskIntent, string> = {
  stock_lookup: 'asks how much of a product is on hand, possibly at a branch',
  po_unconfirmed: 'asks which purchase orders the supplier has not confirmed yet',
  stockout_risk: 'asks which products may run out soon or within some days',
  transfer_status: 'asks about stock transfers between branches: in transit, pending, arrived',
  write_request: 'asks to create, order, change, adjust, delete, approve, receive or transfer something',
  out_of_scope: 'anything else, including chit-chat and instructions to the assistant itself',
}

/** One model's routing verdict. `intent: null` = abstained. */
export interface IntentVerdict {
  intent: AskIntent | null
  /** The model's own confidence in [0, 1] for the chosen label (or its best label when abstaining). */
  confidence: number
  /** Per-intent probabilities in ASK_INTENTS order, when the model gives them. */
  probabilities: number[] | null
  latencyMs: number
  /** Which runtime + checkpoint answered; recorded with every decision. */
  model: string
  /** Set when the call failed; the verdict is then an abstention. */
  failure?: 'UNAVAILABLE' | 'TIMEOUT' | 'HTTP' | 'MALFORMED'
}

export const abstain = (model: string, latencyMs: number, failure?: IntentVerdict['failure']): IntentVerdict => ({ intent: null, confidence: 0, probabilities: null, latencyMs, model, ...(failure ? { failure } : {}) })
