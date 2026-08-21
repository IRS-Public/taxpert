import { describe, it, expect, beforeEach } from 'vitest'
import * as store from '../src/annotate/store.js'

// A Node-side memory backend so each test starts from a clean store (the M5
// store is deliberately React-free precisely so it can be exercised like this).
function memoryBackend() {
  let v = null
  return { getItem: () => v, setItem: (_k, val) => (v = val), removeItem: () => (v = null) }
}

describe('annotate/store (M5 round-trip)', () => {
  beforeEach(() => store.__setBackend(memoryBackend()))

  it('sets and reads an annotation with a default tag', () => {
    store.setAnnotation('fact:/x', { text: 'hello' })
    const a = store.getAnnotation('fact:/x')
    expect(a.text).toBe('hello')
    expect(a.tag).toBe('note')
    expect(a.updatedAt).toBeTruthy()
  })

  it('respects an explicit tag', () => {
    store.setAnnotation('fact:/x', { text: 'oops', tag: 'bug' })
    expect(store.getAnnotation('fact:/x').tag).toBe('bug')
  })

  it('a blank text with no tag deletes the annotation', () => {
    store.setAnnotation('fact:/x', { text: 'hi' })
    store.setAnnotation('fact:/x', { text: '   ' })
    expect(store.getAnnotation('fact:/x')).toBeNull()
  })

  it('deleteAnnotation removes an existing note', () => {
    store.setAnnotation('fact:/x', { text: 'hi' })
    store.deleteAnnotation('fact:/x')
    expect(store.getAnnotation('fact:/x')).toBeNull()
  })

  it('persists and clears layout positions', () => {
    store.setNodePosition('fact:/x', { x: 10, y: 20 })
    expect(store.getLayout()['fact:/x']).toEqual({ x: 10, y: 20 })
    store.clearLayout()
    expect(store.getLayout()).toEqual({})
  })

  it('exportObject carries the app marker, annotations and layout', () => {
    store.setAnnotation('fact:/x', { text: 'hi', tag: 'question' })
    store.setNodePosition('fact:/x', { x: 1, y: 2 })
    const dump = store.exportObject()
    expect(dump.app).toBe('fact-explorer')
    expect(dump.annotations['fact:/x'].text).toBe('hi')
    expect(dump.layout['fact:/x']).toEqual({ x: 1, y: 2 })
  })

  it('mergeImport merges file-wins and keeps existing keys', () => {
    store.setAnnotation('fact:/keep', { text: 'mine' })
    store.mergeImport({
      annotations: { 'fact:/new': { text: 'theirs', tag: 'note' } },
      layout: { 'fact:/new': { x: 5, y: 6 } },
    })
    expect(store.getAnnotation('fact:/keep').text).toBe('mine')
    expect(store.getAnnotation('fact:/new').text).toBe('theirs')
    expect(store.getLayout()['fact:/new']).toEqual({ x: 5, y: 6 })
  })

  it('mergeImport rejects a non-object', () => {
    expect(() => store.mergeImport(null)).toThrow()
    expect(() => store.mergeImport(42)).toThrow()
  })

  it('subscribe fires on commit and unsubscribe stops it', () => {
    let n = 0
    const off = store.subscribe(() => (n += 1))
    store.setAnnotation('fact:/x', { text: 'a' })
    expect(n).toBe(1)
    off()
    store.setAnnotation('fact:/y', { text: 'b' })
    expect(n).toBe(1)
  })

  it('getSnapshot returns a stable reference until the next commit', () => {
    const s1 = store.getSnapshot()
    const s2 = store.getSnapshot()
    expect(s1).toBe(s2)
    store.setAnnotation('fact:/x', { text: 'a' })
    expect(store.getSnapshot()).not.toBe(s1)
  })
})
