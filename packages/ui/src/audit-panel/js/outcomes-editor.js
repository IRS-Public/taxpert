// The Outcomes section of Workspace settings: editing `config.determinations` in the browser.
//
// This is the pay-off for making `outcome` declarative (shared/js/outcome-kinds.js). A determination
// used to carry a function, which meant the Outcome tracker's content could only be changed by
// editing a host's JavaScript and rebuilding. It is JSON now, so it can be edited here, stored as an
// override, and shared as text.
//
// Its own module rather than more methods on <taxpert-workspace-settings-modal>: this is a small
// form-builder — nested lists, a kind-dependent field set, reordering — and the modal's job is to
// mount sections, not to know the shape of a determination.
//
// ── How editing works ────────────────────────────────────────────────────────────────────────
//
// There is no draft state. Every control writes the *whole* determinations array back through
// setConfigOverride('determinations', …) on `change`, and the section re-renders from the config it
// just wrote. That is affordable — the array is small and the tracker rebuilds on the same event
// anyway — and it means there is exactly one copy of the truth. A draft layer would need saving,
// discarding, and a story for what happens when the host re-configures mid-edit.
//
// `change` rather than `input`: a text field fires `change` on blur, so a half-typed fact path never
// reaches the config and the tracker doesn't flicker through every keystroke of "/withholdingGap".

import { getConfig, setConfigOverride } from '../../shared/js/config.js'
import { OUTCOME_KINDS, setDescriptorKey } from '../../shared/js/outcome-kinds.js'
import { getTemplate } from '../../shared/js/templates.js'

/**
 * The editable properties of each outcome kind: the descriptor key, and the words on its field.
 * `value` has none — it means "show the fact's own formatted value", which needs no wording.
 *
 * `{abs}` is spelled out in the signed labels because a template without it silently drops the
 * amount, and this is the only place a person would find that out.
 */
const KIND_FIELDS = new Map([
  ['boolean', [
    { key: 'true', label: 'When true, say' },
    { key: 'false', label: 'When false, say' },
  ]],
  ['map', []], // handled separately: its `values` is a list, not a fixed set of fields
  ['signed', [
    { key: 'positive', label: 'When positive, say (use {abs} for the amount)' },
    { key: 'negative', label: 'When negative, say (use {abs} for the amount)' },
    { key: 'zero', label: 'When zero, say' },
  ]],
  ['value', []],
])

/** What each kind is called in the "Spoken as" menu. */
const KIND_LABELS = new Map([
  ['boolean', 'Yes / no fact'],
  ['map', 'One of a set of options'],
  ['signed', 'Amount, with a direction'],
  ['value', 'The value itself'],
])

/** A blank determination, so "Add outcome" produces something the validator accepts. */
function blankDetermination (index) {
  return {
    id: `outcome-${index + 1}`,
    label: 'New outcome',
    rollupPath: '/',
    outcome: { kind: 'value' },
    sections: [{ heading: 'Facts', facts: [] }],
  }
}

const linesToFacts = (text) =>
  text.split('\n').map((line) => line.trim()).filter(Boolean)

/** `values` as "option = label" lines, which is the shortest thing to type and to read back. */
function valuesToLines (values) {
  return Object.entries(values ?? {}).map(([option, label]) => `${option} = ${label}`).join('\n')
}

function linesToValues (text) {
  const values = {}
  for (const line of text.split('\n')) {
    const at = line.indexOf('=')
    if (at === -1) continue
    const option = line.slice(0, at).trim()
    // setDescriptorKey rather than `values[option] = …`: the option name was typed by a person.
    if (option) setDescriptorKey(values, option, line.slice(at + 1).trim())
  }
  return values
}

/**
 * Build the Outcomes section into `host` (the settings modal).
 *
 * @param {HTMLElement} host
 * @returns {{ render: () => void }} render() rebuilds from the current config
 */
export function createOutcomesEditor (host) {
  const list = host.querySelector('[data-options="outcomes"]')
  const empty = host.querySelector('[data-empty="outcomes"]')
  const paths = host.querySelector('#twsm-fact-paths')

  // Writing the whole array is what keeps this stateless. A rejected write leaves the stored config
  // alone and says why — the only way that happens from this form is a path or heading emptied out.
  function commit (determinations) {
    const result = setConfigOverride('determinations', determinations)
    if (!result.ok) {
      console.warn(`taxpert: could not save outcomes — ${result.errors.join('; ')}`)
      render() // put the form back to what is actually stored
    }
    return result
  }

  const current = () => structuredClone(getConfig().determinations)

  function update (index, mutate) {
    const next = current()
    mutate(next[index], next) // eslint-disable-line security/detect-object-injection
    commit(next)
  }

  // The one place a section is reached by position, so the array indexing the linter cannot tell
  // apart from a lookup on user data is guarded once rather than at every field's listener.
  function updateSection (index, sectionIndex, mutate) {
    // eslint-disable-next-line security/detect-object-injection
    update(index, (determination) => mutate(determination.sections[sectionIndex], determination))
  }

  // The fact paths the graph knows, offered to every path input in the section. Read at render
  // time: the graph arrives asynchronously and may hold nothing yet on the first open.
  function renderPathOptions () {
    const known = getConfig().graph.paths() ?? []
    paths.replaceChildren()
    for (const path of known) {
      const option = document.createElement('option')
      option.value = path
      paths.appendChild(option)
    }
  }

  function renderKindFields (container, determination, index) {
    container.replaceChildren()
    const kind = determination.outcome?.kind ?? 'value'

    if (kind === 'map') {
      const field = getTemplate('twsm-kind-field').firstElementChild
      const input = field.querySelector('input')
      // A textarea, because a map is a list: one "option = label" per line.
      const area = document.createElement('textarea')
      area.className = 'usa-textarea'
      area.rows = 4
      area.value = valuesToLines(determination.outcome?.values)
      input.replaceWith(area)

      const label = field.querySelector('label')
      label.textContent = 'Options, one “name = wording” per line'
      label.htmlFor = area.id = `twsm-outcome-${index}-values`

      area.addEventListener('change', () => {
        update(index, (d) => { d.outcome = { kind: 'map', values: linesToValues(area.value) } })
      })
      container.appendChild(field)
      return
    }

    for (const { key, label: wording } of KIND_FIELDS.get(kind) ?? []) {
      const field = getTemplate('twsm-kind-field').firstElementChild
      const input = field.querySelector('input')
      input.id = `twsm-outcome-${index}-${key}`
      input.value = Object.getOwnPropertyDescriptor(determination.outcome ?? {}, key)?.value ?? ''

      const label = field.querySelector('label')
      label.htmlFor = input.id
      label.textContent = wording

      input.addEventListener('change', () => {
        update(index, (d) => {
          d.outcome = setDescriptorKey({ ...d.outcome, kind }, key, input.value)
        })
      })
      container.appendChild(field)
    }
  }

  function renderSections (container, determination, index) {
    container.replaceChildren()

    determination.sections.forEach((section, sectionIndex) => {
      const node = getTemplate('twsm-outcome-section').firstElementChild

      const heading = node.querySelector('[data-field="heading"]')
      heading.id = `twsm-outcome-${index}-section-${sectionIndex}-heading`
      heading.value = section.heading ?? ''
      node.querySelector('[data-field="heading-for"]').htmlFor = heading.id
      heading.addEventListener('change', () => {
        updateSection(index, sectionIndex, (s) => { s.heading = heading.value.trim() })
      })

      const facts = node.querySelector('[data-field="facts"]')
      facts.id = `twsm-outcome-${index}-section-${sectionIndex}-facts`
      facts.value = (section.facts ?? []).join('\n')
      node.querySelector('[data-field="facts-for"]').htmlFor = facts.id
      facts.addEventListener('change', () => {
        updateSection(index, sectionIndex, (s) => { s.facts = linesToFacts(facts.value) })
      })

      node.querySelector('[data-action="remove-section"]').addEventListener('click', () => {
        update(index, (d) => { d.sections.splice(sectionIndex, 1) })
      })

      container.appendChild(node)
    })
  }

  function renderDetermination (determination, index, total) {
    const node = getTemplate('twsm-outcome').firstElementChild
    node.querySelector('.twsm-outcome__label').textContent = determination.label || determination.id

    const label = node.querySelector('[data-field="label"]')
    label.id = `twsm-outcome-${index}-label`
    label.value = determination.label ?? ''
    node.querySelector('[data-field="label-for"]').htmlFor = label.id
    label.addEventListener('change', () => {
      update(index, (d) => { d.label = label.value.trim() })
    })

    const rollup = node.querySelector('[data-field="rollupPath"]')
    rollup.id = `twsm-outcome-${index}-rollup`
    rollup.value = determination.rollupPath ?? ''
    node.querySelector('[data-field="rollup-for"]').htmlFor = rollup.id
    rollup.addEventListener('change', () => {
      update(index, (d) => { d.rollupPath = rollup.value.trim() })
    })

    const kindFields = node.querySelector('[data-field="kind-fields"]')
    const kind = node.querySelector('[data-field="kind"]')
    kind.id = `twsm-outcome-${index}-kind`
    node.querySelector('[data-field="kind-for"]').htmlFor = kind.id
    for (const name of OUTCOME_KINDS) {
      const option = document.createElement('option')
      option.value = name
      option.textContent = KIND_LABELS.get(name) ?? name
      kind.appendChild(option)
    }
    // A host that kept a function gets the menu on 'value' and a note; picking a kind replaces the
    // function, which is a real change and should take a deliberate choice.
    const isFunction = typeof determination.outcome === 'function'
    kind.value = isFunction ? 'value' : (determination.outcome?.kind ?? 'value')
    if (isFunction) {
      kind.insertAdjacentElement('afterend', functionNote())
    }
    kind.addEventListener('change', () => {
      update(index, (d) => { d.outcome = { kind: kind.value } })
    })
    renderKindFields(kindFields, determination, index)

    renderSections(node.querySelector('[data-field="sections"]'), determination, index)

    node.querySelector('[data-action="add-section"]').addEventListener('click', () => {
      update(index, (d) => { d.sections.push({ heading: 'Facts', facts: [] }) })
    })
    const up = node.querySelector('[data-action="move-up"]')
    up.disabled = index === 0
    up.addEventListener('click', () => move(index, -1))
    const down = node.querySelector('[data-action="move-down"]')
    down.disabled = index === total - 1
    down.addEventListener('click', () => move(index, 1))

    node.querySelector('[data-action="remove"]').addEventListener('click', () => {
      const next = current()
      next.splice(index, 1)
      commit(next)
    })

    return node
  }

  function functionNote () {
    const note = document.createElement('p')
    note.className = 'twsm-note'
    note.textContent =
      'This outcome is spoken by host code, which cannot be edited here. Choosing a kind above ' +
      'replaces it.'
    return note
  }

  function move (index, by) {
    const next = current()
    const to = index + by
    if (to < 0 || to >= next.length) return
    const [moved] = next.splice(index, 1)
    next.splice(to, 0, moved)
    commit(next)
  }

  function render () {
    const determinations = getConfig().determinations
    renderPathOptions()
    list.replaceChildren()
    determinations.forEach((determination, index) => {
      list.appendChild(renderDetermination(determination, index, determinations.length))
    })
    empty.hidden = determinations.length > 0
  }

  host.querySelector('[data-add="outcome"]').addEventListener('click', () => {
    const next = current()
    next.push(blankDetermination(next.length))
    commit(next)
  })

  return { render }
}
