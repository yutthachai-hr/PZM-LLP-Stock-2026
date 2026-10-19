import { expect, test } from 'vitest'
import { createHistoryRequest } from '../src/data/historyRequest'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('history is loading, not empty, until the entire requested scope finishes', async () => {
  const read = deferred<{ id: string }[]>()
  const request = createHistoryRequest<{ id: string }>()
  const pending = request.load('lelapin::ham', () => read.promise)
  expect(request.get().status).toBe('loading')
  read.resolve([])
  await pending
  expect(request.get()).toMatchObject({ key: 'lelapin::ham', status: 'empty', rows: [] })
})

test('switching product/brand clears previous rows and ignores delayed old answers', async () => {
  const old = deferred<{ id: string }[]>()
  const request = createHistoryRequest<{ id: string }>()
  await request.load('pizza::ham', async () => [{ id: 'pizza-row' }])
  const pending = request.load('lelapin::ham', () => old.promise)
  expect(request.get().rows).toEqual([])
  await request.load('rnd::ham', async () => [{ id: 'rnd-row' }])
  old.resolve([{ id: 'll-row' }])
  await pending
  expect(request.get()).toMatchObject({ key: 'rnd::ham', rows: [{ id: 'rnd-row' }], status: 'complete' })
})

test('read failures are errors, never successful empty history; retry can complete', async () => {
  const request = createHistoryRequest<{ id: string }>()
  await request.load('ll::ham', async () => { throw new Error('permission-denied') })
  expect(request.get()).toMatchObject({ status: 'error', rows: [], error: 'permission-denied' })
  await request.load('ll::ham', async () => [{ id: 'rc87' }])
  expect(request.get()).toMatchObject({ status: 'complete', rows: [{ id: 'rc87' }] })
})

test('dispose invalidates an interrupted request', async () => {
  const read = deferred<{ id: string }[]>()
  const request = createHistoryRequest<{ id: string }>()
  const pending = request.load('ll::ham', () => read.promise)
  request.cancel()
  read.resolve([{ id: 'late' }])
  await pending
  expect(request.get().status).not.toBe('complete')
})
