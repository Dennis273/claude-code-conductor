import type { ConductorEvent } from '../types.js'

type EventListener = (event: ConductorEvent) => void

export interface SessionBus {
  buffer: ConductorEvent[]
  subscribers: Set<EventListener>
  done: boolean
}

const buses = new Map<string, SessionBus>()

export function createBus(sessionId: string): SessionBus {
  const bus: SessionBus = {
    buffer: [],
    subscribers: new Set(),
    done: false,
  }
  buses.set(sessionId, bus)
  return bus
}

export function getBus(sessionId: string): SessionBus | undefined {
  return buses.get(sessionId)
}

export function removeBus(sessionId: string): void {
  buses.delete(sessionId)
}

export function publish(sessionId: string, event: ConductorEvent): void {
  const bus = buses.get(sessionId)
  if (!bus) return
  bus.buffer.push(event)
  for (const listener of bus.subscribers) {
    listener(event)
  }
}

/**
 * Subscribe to a session's events.
 * Replays all buffered events synchronously, then receives live events.
 * Returns an unsubscribe function.
 */
export function subscribe(
  sessionId: string,
  callback: EventListener,
): () => void {
  const bus = buses.get(sessionId)
  if (!bus) return () => {}

  // Replay buffered events
  for (const event of bus.buffer) {
    callback(event)
  }

  // Add to live subscribers
  bus.subscribers.add(callback)

  return () => {
    bus.subscribers.delete(callback)
  }
}

export function markDone(sessionId: string): void {
  const bus = buses.get(sessionId)
  if (!bus) return
  bus.done = true
}
