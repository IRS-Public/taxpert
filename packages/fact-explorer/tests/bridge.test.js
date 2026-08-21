import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { publish, subscribe, graphStorageKey } from '../src/model/bridge.js'

// The Fact Explorer ↔ embedded-app bridge. Two halves with different failure modes:
//
//  - the sessionStorage half was silently broken — it wrote a bare 'factGraph' while the flow
//    runtime reads `${storagePrefix}:factGraph`. These specs pin the key, because nothing else
//    can: the reader lives in another package (form-builder's flow-runtime), so a mismatch shows up
//    only as a feature that quietly does nothing.
//  - the channel half is a *fixed* contract with fg-graph-bridge.js and must not drift.

class FakeChannel {
  static instances = []
  constructor(name) {
    this.name = name
    this.messages = []
    this.listeners = []
    this.closed = false
    FakeChannel.instances.push(this)
  }
  postMessage(m) {
    this.messages.push(m)
  }
  addEventListener(_type, fn) {
    this.listeners.push(fn)
  }
  removeEventListener(_type, fn) {
    this.listeners = this.listeners.filter((f) => f !== fn)
  }
  close() {
    this.closed = true
  }
  emit(data) {
    this.listeners.forEach((fn) => fn({ data }))
  }
}

let store

beforeEach(() => {
  FakeChannel.instances = []
  store = new Map()
  vi.stubGlobal('BroadcastChannel', FakeChannel)
  vi.stubGlobal('sessionStorage', {
    setItem: (k, v) => store.set(k, v),
    getItem: (k) => store.get(k) ?? null,
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('bridge.graphStorageKey', () => {
  it('matches the flow runtime’s storageKey() format', () => {
    // form-builder/website-static/flow-runtime/js/runtime-config.js: `${prefix}:${name}`
    expect(graphStorageKey('credit-assistant')).toBe('credit-assistant:factGraph')
    expect(graphStorageKey('twe')).toBe('twe:factGraph')
  })
})

describe('bridge.publish', () => {
  it('writes the app-namespaced key, not a bare one', () => {
    publish('{"facts":[]}', 'credit-assistant')
    expect(store.get('credit-assistant:factGraph')).toBe('{"facts":[]}')
    expect(store.has('factGraph')).toBe(false)
  })

  it('keeps two apps’ graphs apart', () => {
    publish('{"app":"ca"}', 'credit-assistant')
    publish('{"app":"twe"}', 'twe')
    expect(store.get('credit-assistant:factGraph')).toBe('{"app":"ca"}')
    expect(store.get('twe:factGraph')).toBe('{"app":"twe"}')
  })

  it('posts the fixed channel name and message shape', () => {
    publish('{"facts":[]}', 'twe')
    const ch = FakeChannel.instances.at(-1)
    // Both are a hard contract with fg-graph-bridge.js — changing either breaks the other side.
    expect(ch.name).toBe('taxpert:factGraph')
    expect(ch.messages).toEqual([{ type: 'factGraph', graph: '{"facts":[]}' }])
    expect(ch.closed).toBe(true)
  })

  it('still broadcasts, but writes nothing, without a prefix', () => {
    publish('{"facts":[]}')
    expect(store.size).toBe(0)
    expect(FakeChannel.instances.at(-1).messages).toHaveLength(1)
  })

  it('ignores a non-string graph', () => {
    publish({ not: 'a string' }, 'twe')
    expect(store.size).toBe(0)
    expect(FakeChannel.instances).toHaveLength(0)
  })
})

describe('bridge.subscribe', () => {
  it('hands back inbound graphs and unsubscribes cleanly', () => {
    const seen = []
    const off = subscribe((g) => seen.push(g))
    const ch = FakeChannel.instances.at(-1)

    ch.emit({ type: 'factGraph', graph: '{"a":1}' })
    ch.emit({ type: 'somethingElse', graph: '{"b":2}' })
    ch.emit({ type: 'factGraph', graph: 42 })
    expect(seen).toEqual(['{"a":1}'])

    off()
    ch.emit({ type: 'factGraph', graph: '{"c":3}' })
    expect(seen).toEqual(['{"a":1}'])
    expect(ch.closed).toBe(true)
  })

  it('no-ops where BroadcastChannel is absent', () => {
    vi.stubGlobal('BroadcastChannel', undefined)
    const off = subscribe(() => {
      throw new Error('should not be called')
    })
    expect(() => off()).not.toThrow()
  })
})
