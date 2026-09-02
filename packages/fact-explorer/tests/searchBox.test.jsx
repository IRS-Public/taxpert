// @vitest-environment jsdom
//
// The one component spec in this suite, and it is here because the thing worth asserting about
// SearchBox is not a value it computes — it is which callback a browser event reaches. Picking a
// row from a <datalist> arrives as an ordinary change event carrying the row's value, exactly like
// typing does, so "the reader chose a suggestion" is a rule about the event rather than a distinct
// event of its own. That rule is what makes search able to navigate at all (see focusNode in
// canvas/FactExplorer.jsx), and it is invisible to the model tests.
//
// react-dom/client and act directly, no testing-library: two renders and two events do not need
// one, and the package is not a dependency here.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import SearchBox from '../src/canvas/controls/SearchBox.jsx'

const ROWS = [
  { id: 'fact:/filingStatus', path: '/filingStatus' },
  { id: 'fact:/taxableIncome', path: '/taxableIncome' },
]

describe('SearchBox', () => {
  let host
  let root
  let picked
  let typed

  const render = (props = {}) =>
    act(() => {
      root.render(
        <SearchBox
          query=""
          onQuery={(q) => typed.push(q)}
          onPick={(id) => picked.push(id)}
          suggestions={ROWS}
          onStep={() => {}}
          {...props}
        />
      )
    })

  const input = () => host.querySelector('.fe-search__input')

  const change = (value) =>
    act(() => {
      const el = input()
      // The setter React's onChange listener reads, rather than el.value, which React's own
      // value tracking would then treat as unchanged and swallow.
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(
        el,
        value
      )
      el.dispatchEvent(new window.Event('input', { bubbles: true }))
    })

  beforeEach(() => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    picked = []
    typed = []
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('offers the fact paths through a datalist the input is bound to', () => {
    render()
    const list = host.querySelector('datalist')
    expect(input().getAttribute('list')).toBe(list.id)
    expect([...list.querySelectorAll('option')].map((o) => o.value)).toEqual(
      ROWS.map((r) => r.path)
    )
  })

  it('typing part of a path reports the query and jumps nowhere', () => {
    render()
    change('/filing')
    expect(typed).toEqual(['/filing'])
    expect(picked).toEqual([])
  })

  it('a value equal to a whole path is a pick, and jumps to that fact', () => {
    render()
    change('/filingStatus')
    expect(picked).toEqual(['fact:/filingStatus'])
  })

  it('Enter takes the first suggestion without opening the list', () => {
    render()
    act(() => {
      input().dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      )
    })
    expect(picked).toEqual([ROWS[0].id])
    expect(typed).toEqual([ROWS[0].path])
  })

  it('shows why a jump is not on the canvas, when it is not', () => {
    render({ miss: 'Found it, but the current Layers or Type filters leave it off the canvas.' })
    const note = host.querySelector('.fe-search__miss')
    expect(note.getAttribute('role')).toBe('status')
    expect(note.textContent).toMatch(/off the canvas/)
  })
})
