import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { onRequestPost } from '../functions/api/ocr-bill'

type Ctx = Parameters<typeof onRequestPost>[0]

const DEMO_KEY = 'test-demo-key'
const GEMINI_KEY = 'test-gemini-key'

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    PO_IMAGE_DEMO_KEY: DEMO_KEY,
    GEMINI_API_KEY: GEMINI_KEY,
    ...overrides,
  }
}

function makeRequest(body: unknown, key = DEMO_KEY) {
  return new Request('https://pzm.example/api/ocr-bill', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-demo-key': key,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const TINY_IMAGE = 'data:image/jpeg;base64,' + btoa('fake-image-bytes')
const TINY_PDF = 'data:application/pdf;base64,' + btoa('%PDF-fake-bytes')

describe('functions/api/ocr-bill - server resilience and TDD requirements', () => {
  const originalFetch = globalThis.fetch
  let fetchMock: ReturnType<typeof vi.fn>
  let consoleInfoMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    consoleInfoMock = vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    consoleInfoMock.mockRestore()
    vi.restoreAllMocks()
  })

  test('503 then 200 -> success after retry', async () => {
    // Attempt 1: 503 UNAVAILABLE
    // Attempt 2: 200 OK with valid JSON response
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { status: 'UNAVAILABLE', message: 'Model is overloaded' } }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        supplier: 'Test Supplier',
                        invoiceNo: 'INV-123',
                        date: '2026-10-19',
                        lines: [{ name: 'Item 1', qty: 5, unit: 'KG' }],
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )

    const res = await onRequestPost({
      request: makeRequest({ image: TINY_IMAGE }),
      env: makeEnv(),
      params: {},
    } as unknown as Ctx)

    expect(res.status).toBe(200)
    const json = (await res.json()) as { lines: unknown[]; model?: string; trace?: { retries: number } }
    expect(json.lines).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(json.trace?.retries).toBe(1)
  })

  test('503x3 -> typed model_unavailable with upstreamStatus 503', async () => {
    // 3 consecutive 503s -> exhausts 2 retries (3 calls total)
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { status: 'UNAVAILABLE', message: 'High demand' } }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const res = await onRequestPost({
      request: makeRequest({ image: TINY_PDF }),
      env: makeEnv(),
      params: {},
    } as unknown as Ctx)

    expect(res.status).toBe(503)
    const json = (await res.json()) as { error: string; upstreamStatus: number; model?: string }
    expect(json.error).toBe('model_unavailable')
    expect(json.upstreamStatus).toBe(503)
    expect(fetchMock).toHaveBeenCalledTimes(3) // 1 initial + 2 retries
  })

  test('500 and 504 are retried on transient error', async () => {
    // 500 then 200
    fetchMock
      .mockResolvedValueOnce(new Response('Internal Error', { status: 500 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify({ lines: [{ name: 'A', qty: 1 }] }) }] } }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )

    const res500 = await onRequestPost({
      request: makeRequest({ image: TINY_IMAGE }),
      env: makeEnv(),
      params: {},
    } as unknown as Ctx)
    expect(res500.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    fetchMock.mockReset()

    // 504 then 200
    fetchMock
      .mockResolvedValueOnce(new Response('Gateway Timeout', { status: 504 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify({ lines: [{ name: 'B', qty: 2 }] }) }] } }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )

    const res504 = await onRequestPost({
      request: makeRequest({ image: TINY_IMAGE }),
      env: makeEnv(),
      params: {},
    } as unknown as Ctx)
    expect(res504.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('429 not retried -> quota with upstreamStatus 429', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' } }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const res = await onRequestPost({
      request: makeRequest({ image: TINY_PDF }),
      env: makeEnv(),
      params: {},
    } as unknown as Ctx)

    expect(res.status).toBe(429)
    const json = (await res.json()) as { error: string; upstreamStatus: number }
    expect(json.error).toBe('quota')
    expect(json.upstreamStatus).toBe(429)
    expect(fetchMock).toHaveBeenCalledTimes(1) // NEVER retry 429
  })

  test('400 not retried', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'Bad request' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const res = await onRequestPost({
      request: makeRequest({ image: TINY_PDF }),
      env: makeEnv(),
      params: {},
    } as unknown as Ctx)

    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string; upstreamStatus?: number }
    expect(json.error).toBe('bad_request')
    expect(fetchMock).toHaveBeenCalledTimes(1) // NEVER retry 400
  })

  test('malformed JSON from model -> typed unreadable with 502', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'Here is some prose with no valid json at all!' }] } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const res = await onRequestPost({
      request: makeRequest({ image: TINY_IMAGE }),
      env: makeEnv(),
      params: {},
    } as unknown as Ctx)

    expect(res.status).toBe(502)
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe('unreadable')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('network timeout -> upstream_timeout', async () => {
    // 3 network timeout errors
    fetchMock.mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))

    const res = await onRequestPost({
      request: makeRequest({ image: TINY_IMAGE }),
      env: makeEnv(),
      params: {},
    } as unknown as Ctx)

    expect(res.status).toBe(504)
    const json = (await res.json()) as { error: string; upstreamStatus?: number }
    expect(json.error).toBe('upstream_timeout')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  test('PDF + no AI binding + Gemini down -> typed error (no crash)', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { status: 'UNAVAILABLE', message: 'overloaded' } }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    )

    // env.AI is explicitly undefined (e.g. Preview environment)
    const envNoAi = makeEnv({ AI: undefined })

    const res = await onRequestPost({
      request: makeRequest({ image: TINY_PDF }),
      env: envNoAi,
      params: {},
    } as unknown as Ctx)

    expect(res.status).toBe(503)
    const json = (await res.json()) as { error: string; upstreamStatus: number }
    expect(json.error).toBe('model_unavailable')
    expect(json.upstreamStatus).toBe(503)
  })

  test('image + AI binding fallback still works when Gemini fails', async () => {
    // Gemini 503s
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { status: 'UNAVAILABLE', message: 'overloaded' } }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const mockAiRun = vi.fn().mockResolvedValue({
      response: JSON.stringify({
        lines: [{ name: 'Llama Fallback Cheese', qty: 3, unit: 'KG' }],
      }),
    })

    const envWithAi = makeEnv({
      AI: { run: mockAiRun },
    })

    const res = await onRequestPost({
      request: makeRequest({ image: TINY_IMAGE }),
      env: envWithAi,
      params: {},
    } as unknown as Ctx)

    expect(res.status).toBe(200)
    const json = (await res.json()) as { lines: { name: string; qty: number }[]; model: string }
    expect(json.lines).toEqual([{ name: 'Llama Fallback Cheese', qty: 3, unit: 'KG' }])
    expect(json.model).toBe('@cf/meta/llama-4-scout-17b-16e-instruct')
    expect(mockAiRun).toHaveBeenCalledTimes(1)
  })

  test('trace contains no document content, names, quantities, or base64 data', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      supplier: 'SUPER_SECRET_SUPPLIER',
                      invoiceNo: 'SECRET_INV_9999',
                      lines: [{ name: 'SECRET_CONFIDENTIAL_HAM', qty: 42.5, unit: 'KG' }],
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const res = await onRequestPost({
      request: makeRequest({ image: TINY_IMAGE }),
      env: makeEnv(),
      params: {},
    } as unknown as Ctx)

    expect(res.status).toBe(200)

    // Inspect console.info calls for trace logging
    const traceCalls = consoleInfoMock.mock.calls.filter((call) =>
      typeof call[0] === 'string' && call[0].includes('[ocr-bill]'),
    )
    expect(traceCalls.length).toBeGreaterThan(0)

    const loggedPayload = traceCalls.map((c) => c.join(' ')).join('\n')
    // Must NOT contain sensitive text, supplier, line names, qty, or raw data URL
    expect(loggedPayload).not.toContain('SUPER_SECRET_SUPPLIER')
    expect(loggedPayload).not.toContain('SECRET_INV_9999')
    expect(loggedPayload).not.toContain('SECRET_CONFIDENTIAL_HAM')
    expect(loggedPayload).not.toContain('42.5')
    expect(loggedPayload).not.toContain(TINY_IMAGE)
  })

  test('valid 35s upstream response (observed normal 24-35s) succeeds without premature 30s cutoff', async () => {
    vi.useFakeTimers()
    try {
      fetchMock.mockImplementation(() => {
        return new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(
              new Response(
                JSON.stringify({
                  candidates: [
                    {
                      content: {
                        parts: [
                          {
                            text: JSON.stringify({
                              supplier: 'Normal 35s Bakery',
                              invoiceNo: 'N35-1',
                              lines: [{ name: 'Bread', qty: 2 }],
                            }),
                          },
                        ],
                      },
                    },
                  ],
                }),
                { status: 200, headers: { 'content-type': 'application/json' } },
              ),
            )
          }, 35_000)
        })
      })

      const requestPromise = onRequestPost({
        request: makeRequest({ image: TINY_IMAGE }),
        env: makeEnv(),
        params: {},
      } as unknown as Ctx)

      await vi.advanceTimersByTimeAsync(36_000)

      const res = await requestPromise
      expect(res.status).toBe(200)
      const data = (await res.json()) as { supplier: string }
      expect(data.supplier).toBe('Normal 35s Bakery')
    } finally {
      vi.useRealTimers()
    }
  })

  test('success near deadline (headers at 70s) with stalled body aborts strictly at 75s aggregate budget without fresh 30s', async () => {
    vi.useFakeTimers()
    try {
      // Headers arrive at 70s (within 75s budget)
      fetchMock.mockImplementation(() => {
        return new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve({
              ok: true,
              status: 200,
              headers: new Headers({ 'content-type': 'application/json' }),
              // Body never resolves
              json: () => new Promise<never>(() => {}),
            } as unknown as Response)
          }, 70_000)
        })
      })

      const requestPromise = onRequestPost({
        request: makeRequest({ image: TINY_IMAGE }),
        env: makeEnv(),
        params: {},
      } as unknown as Ctx)

      // Advance to 70s (headers arrive)
      await vi.advanceTimersByTimeAsync(70_000)
      // Advance to 76s (1s past aggregate 75s)
      await vi.advanceTimersByTimeAsync(6_000)

      const res = await requestPromise
      expect(res.status).toBe(504)
      const data = (await res.json()) as { error: string; trace?: { durations: { totalMs: number } } }
      expect(data.error).toBe('upstream_timeout')
      // Must not have waited for a fresh 30s (which would be 100s)!
      expect(data.trace?.durations.totalMs).toBeLessThanOrEqual(76_000)
    } finally {
      vi.useRealTimers()
    }
  })

  test('hung Workers AI fallback after transient error terminates strictly within aggregate 75s budget', async () => {
    vi.useFakeTimers()
    try {
      // Gemini immediately returns 503
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ error: 'overloaded' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }),
      )

      // Workers AI hangs forever (SDK ignores signal)
      const mockAiRun = vi.fn().mockImplementation(() => new Promise<never>(() => {}))

      const envWithAi = makeEnv({
        AI: { run: mockAiRun },
      })

      const requestPromise = onRequestPost({
        request: makeRequest({ image: TINY_IMAGE }),
        env: envWithAi,
        params: {},
      } as unknown as Ctx)

      // Advance past 75s aggregate budget
      await vi.advanceTimersByTimeAsync(80_000)

      const res = await requestPromise
      expect(res.status).toBe(504)
      const data = (await res.json()) as { error: string; trace?: { durations: { totalMs: number } } }
      expect(data.error).toBe('upstream_timeout')
      expect(data.trace?.durations.totalMs).toBeLessThanOrEqual(80_000)
    } finally {
      vi.useRealTimers()
    }
  })

  test('never-resolving upstream fetch times out within per-attempt budget and returns 504', async () => {
    vi.useFakeTimers()
    try {
      fetchMock.mockImplementation((_url: string, opts?: { signal?: AbortSignal }) => {
        return new Promise<Response>((_, reject) => {
          opts?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
          })
        })
      })

      const requestPromise = onRequestPost({
        request: makeRequest({ image: TINY_IMAGE }),
        env: makeEnv(),
        params: {},
      } as unknown as Ctx)

      // Fast forward time through per-attempt timeout (30s) x 3 attempts
      await vi.advanceTimersByTimeAsync(35_000)
      await vi.advanceTimersByTimeAsync(35_000)
      await vi.advanceTimersByTimeAsync(35_000)

      const res = await requestPromise
      expect(res.status).toBe(504)
      const body = (await res.json()) as { error: string }
      expect(body.error).toBe('upstream_timeout')
    } finally {
      vi.useRealTimers()
    }
  })

  test('never-resolving upstream body stream times out', async () => {
    vi.useFakeTimers()
    try {
      fetchMock.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => new Promise<never>(() => {}), // never resolves
        } as unknown as Response),
      )

      const requestPromise = onRequestPost({
        request: makeRequest({ image: TINY_IMAGE }),
        env: makeEnv(),
        params: {},
      } as unknown as Ctx)

      await vi.advanceTimersByTimeAsync(35_000)
      await vi.advanceTimersByTimeAsync(35_000)
      await vi.advanceTimersByTimeAsync(35_000)

      const res = await requestPromise
      expect(res.status).toBe(504)
      const body = (await res.json()) as { error: string }
      expect(body.error).toBe('upstream_timeout')
    } finally {
      vi.useRealTimers()
    }
  })

  test('HTTP 200 with malformed JSON body returns typed 502 unreadable without unhandled exception', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{malformed json syntax', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const res = await onRequestPost({
      request: makeRequest({ image: TINY_IMAGE }),
      env: makeEnv(),
      params: {},
    } as unknown as Ctx)

    expect(res.status).toBe(502)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('unreadable')
  })

  test('reply error does not reflect raw candidate/document text in message', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: 'CONFIDENTIAL_CUSTOMER_DOCUMENT_CONTENT not json' }],
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const res = await onRequestPost({
      request: makeRequest({ image: TINY_IMAGE }),
      env: makeEnv(),
      params: {},
    } as unknown as Ctx)

    expect(res.status).toBe(502)
    const body = (await res.json()) as { error: string; message?: string }
    expect(body.error).toBe('unreadable')
    expect(body.message).not.toContain('CONFIDENTIAL_CUSTOMER_DOCUMENT_CONTENT')
  })
})

