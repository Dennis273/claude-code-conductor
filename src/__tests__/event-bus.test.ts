import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createBus,
  getBus,
  removeBus,
  publish,
  subscribe,
  markDone,
} from '../core/event-bus.js'
import type { ConductorEvent } from '../types.js'

const sessionCreated: ConductorEvent = {
  type: 'session_created',
  session_id: 'test-123',
  workspace: '/tmp/test',
}

const textDelta: ConductorEvent = {
  type: 'text_delta',
  text: 'hello',
}

const result: ConductorEvent = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'done',
  session_id: 'test-123',
  num_turns: 1,
  cost_usd: 0.01,
  errors: [],
}

beforeEach(() => {
  vi.useFakeTimers()
  // Clean up any leftover buses from previous tests
  removeBus('s1')
  removeBus('s2')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createBus / getBus / removeBus', () => {
  it('creates a bus and retrieves it by session id', () => {
    createBus('s1')
    const bus = getBus('s1')
    expect(bus).toBeDefined()
  })

  it('returns undefined for unknown session id', () => {
    expect(getBus('nonexistent')).toBeUndefined()
  })

  it('removes a bus', () => {
    createBus('s1')
    removeBus('s1')
    expect(getBus('s1')).toBeUndefined()
  })

  it('removeBus is idempotent for unknown id', () => {
    expect(() => removeBus('nonexistent')).not.toThrow()
  })
})

describe('publish', () => {
  it('buffers events', () => {
    createBus('s1')
    publish('s1', sessionCreated)
    publish('s1', textDelta)

    const bus = getBus('s1')!
    expect(bus.buffer).toHaveLength(2)
    expect(bus.buffer[0]).toEqual(sessionCreated)
    expect(bus.buffer[1]).toEqual(textDelta)
  })

  it('broadcasts to subscribers', () => {
    createBus('s1')
    const received: ConductorEvent[] = []
    subscribe('s1', (event) => received.push(event))

    publish('s1', textDelta)
    expect(received).toHaveLength(1)
    expect(received[0]).toEqual(textDelta)
  })

  it('broadcasts to multiple subscribers', () => {
    createBus('s1')
    const received1: ConductorEvent[] = []
    const received2: ConductorEvent[] = []
    subscribe('s1', (event) => received1.push(event))
    subscribe('s1', (event) => received2.push(event))

    publish('s1', textDelta)
    expect(received1).toHaveLength(1)
    expect(received2).toHaveLength(1)
  })
})

describe('subscribe', () => {
  it('replays buffered events synchronously on subscribe', () => {
    createBus('s1')
    publish('s1', sessionCreated)
    publish('s1', textDelta)

    const received: ConductorEvent[] = []
    subscribe('s1', (event) => received.push(event))

    // Should have received the 2 buffered events immediately
    expect(received).toHaveLength(2)
    expect(received[0]).toEqual(sessionCreated)
    expect(received[1]).toEqual(textDelta)
  })

  it('receives live events after replay', () => {
    createBus('s1')
    publish('s1', sessionCreated)

    const received: ConductorEvent[] = []
    subscribe('s1', (event) => received.push(event))

    // 1 replayed
    expect(received).toHaveLength(1)

    // Now publish live
    publish('s1', textDelta)
    expect(received).toHaveLength(2)
    expect(received[1]).toEqual(textDelta)
  })

  it('returns an unsubscribe function', () => {
    createBus('s1')
    const received: ConductorEvent[] = []
    const unsub = subscribe('s1', (event) => received.push(event))

    publish('s1', textDelta)
    expect(received).toHaveLength(1)

    unsub()

    publish('s1', result)
    // Should NOT receive the result event
    expect(received).toHaveLength(1)
  })
})

describe('markDone', () => {
  it('marks bus as done', () => {
    createBus('s1')
    markDone('s1')

    const bus = getBus('s1')!
    expect(bus.done).toBe(true)
  })

  it('late subscribers still get replay after markDone', () => {
    createBus('s1')
    publish('s1', sessionCreated)
    publish('s1', textDelta)
    publish('s1', result)
    markDone('s1')

    const received: ConductorEvent[] = []
    subscribe('s1', (event) => received.push(event))

    expect(received).toHaveLength(3)
    expect(received[0]).toEqual(sessionCreated)
    expect(received[2]).toEqual(result)
  })

  it('schedules bus cleanup after 60 seconds', () => {
    createBus('s1')
    markDone('s1')

    expect(getBus('s1')).toBeDefined()

    vi.advanceTimersByTime(60_000)

    expect(getBus('s1')).toBeUndefined()
  })

  it('does not clean up before 60 seconds', () => {
    createBus('s1')
    markDone('s1')

    vi.advanceTimersByTime(59_999)

    expect(getBus('s1')).toBeDefined()
  })
})

describe('createBus cancels pending cleanup', () => {
  it('new createBus cancels cleanup timer from previous markDone', () => {
    // Run N
    createBus('s1')
    publish('s1', sessionCreated)
    markDone('s1') // schedules cleanup in 60s

    // Within 60s, Run N+1 starts
    createBus('s1')

    const received: ConductorEvent[] = []
    subscribe('s1', (event) => received.push(event))

    // Old timer fires — should be cancelled, bus should survive
    vi.advanceTimersByTime(60_000)

    expect(getBus('s1')).toBeDefined()

    // Publishing still works
    publish('s1', textDelta)
    expect(received).toHaveLength(1)
    expect(received[0]).toEqual(textDelta)
  })

  it('new run events are not lost after old cleanup timer would have fired', () => {
    // Run N
    createBus('s1')
    publish('s1', sessionCreated)
    markDone('s1')

    // Run N+1 starts at T+30s
    vi.advanceTimersByTime(30_000)
    createBus('s1')

    const received: ConductorEvent[] = []
    subscribe('s1', (event) => received.push(event))

    // T+60s: old timer would fire
    vi.advanceTimersByTime(30_000)

    // Bus still alive, subscriber still works
    publish('s1', textDelta)
    publish('s1', result)
    expect(received).toHaveLength(2)

    // Run N+1 finishes and schedules its own cleanup
    markDone('s1')

    // Its cleanup fires 60s later (T+120s)
    vi.advanceTimersByTime(60_000)
    expect(getBus('s1')).toBeUndefined()
  })
})
