// Fact Inspector: the <fact-link> (wraps <fg-show>s and dependency links in the host flow) and
// <audited-fact> (a tracked fact card) custom elements, plus trackFact/setFactOptions. Ported
// from credit-assistant. The panel renders DOM with the same ids/classes as before, so the
// document-scoped queries here keep resolving the single panel's controls, and the <audited-fact>
// shadow root clones <template id="tap-fact"> out of templates/audit-panel.html — the same
// clone-a-template shape the original fragments/audit-panel/fact-template.html had.
import {
  factDictionaryXml,
  serializeXml,
  makeCollectionIdPath,
} from './fact-dictionary.js'
import { getTemplate } from '../../shared/js/templates.js'
import { getAuditPanelStorage, setAuditPanelStorage } from './storage.js'
import { setLastActiveTabButton } from './tab-state.js'

// The Fact Inspector's fact-path input; resolved lazily because the panel builds its DOM
// after this module evaluates.
const getFactSelect = () => document.querySelector('#fact-select')

class FactLink extends HTMLElement {
  connectedCallback () {
    this.path = this.getAttribute('path')
    this.collectionId = this.getAttribute('collectionId')

    const link = document.createElement('a')
    link.href = `#${this.path}`
    while (this.firstChild) {
      link.appendChild(this.firstChild)
    } // Move all children to the link
    link.onclick = () => {
      const factGraphTabBtn = document.querySelector(
        '.audit-panel__tab[data-tab="fact-graph"]'
      )
      if (factGraphTabBtn) {
        setLastActiveTabButton(factGraphTabBtn)
        factGraphTabBtn.click()
      } else {
        document.body.classList.add('audit-panel-open')
        setAuditPanelStorage('isOpen', true)
      }
      trackFact(this.path, this.collectionId)
      return false
    }
    this.replaceChildren(link)
  }
}
customElements.define('fact-link', FactLink)

class AuditedFact extends HTMLElement {
  constructor () {
    super()

    this.deleteListener = () => {
      const storage = getAuditPanelStorage()
      const trackedFacts = storage.trackedFacts || []
      const newTrackedFacts = trackedFacts.filter(
        (fact) =>
          fact.path !== this.abstractPath &&
          fact.collectionId !== this.collectionId
      )
      setAuditPanelStorage('trackedFacts', newTrackedFacts)
      this.remove()
    }
    this.renderListener = () => this.render()

    this.attachShadow({ mode: 'open' })
    this.shadowRoot.append(getTemplate('tap-fact'))

    this.factPathElem = this.shadowRoot.querySelector(
      '.audit-panel__fact__path'
    )
    this.factTypeElem = this.shadowRoot.querySelector(
      '.audit-panel__fact__type'
    )
    this.factValueElem = this.shadowRoot.querySelector(
      '.audit-panel__fact__value'
    )
    this.factDefinitionElem = this.shadowRoot.querySelector(
      '.audit-panel__fact__definition'
    )

    this.removeButton = this.shadowRoot.querySelector(
      '.audit-panel__fact__remove'
    )
  }

  connectedCallback () {
    this.abstractPath = this.getAttribute('path')
    this.collectionId = this.getAttribute('collectionid')
    this.factPath = makeCollectionIdPath(this.abstractPath, this.collectionId)

    this.removeButton.addEventListener('click', this.deleteListener)
    this.addEventListener('click', this.handleLinksListener)
    document.addEventListener('fg-update', this.renderListener)

    this.render()
  }

  disconnectedCallback () {
    this.removeButton.removeEventListener('click', this.deleteListener)
    this.removeEventListener('click', this.handleLinksListener)
    document.removeEventListener('fg-update', this.renderListener)
    getFactSelect()?.focus()
  }

  render () {
    const definition = window.factGraph.dictionary.getDefinition(this.factPath)
    const fact = window.factGraph.get(this.factPath)

    // Fill out the data fields
    this.factPathElem.innerText = this.factPath
    this.factTypeElem.innerText = definition.typeNode
    const factValueString = fact.hasValue ? fact.get.toString() + ' ' : ''
    const factCompleteString = fact.complete ? '[Complete]' : '[Incomplete]'
    this.factValueElem.innerText = `${factValueString} ${factCompleteString}`

    // Serialize and sanitize the fact definition for inclusion as HTML
    // Replace brackets with HTML entities to prevent the XML from being rendered, and remove leading indentation after first line for readability
    // We do this because the definition will have live <a> links in it
    const xmlDefinition = factDictionaryXml.querySelector(
      `Fact[path="${this.abstractPath}"]`
    )
    const stringDefinition = serializeXml(xmlDefinition)
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .split('\n')
      .map((line, index) => (index === 0 ? line : line.replace(/^ {4}/, '')))
      .join('\n')

    // Enhance the definition by adding links to dependencies
    const dependencyNodes = Array.from(
      xmlDefinition.querySelectorAll('Dependency')
    )
    const fullDefinition = dependencyNodes.reduce((result, dependencyNode) => {
      const rawPath = dependencyNode.getAttribute('path')

      // For now, we can't resolve abstract collection paths ("/jobs/*/income")
      if (rawPath.includes('*')) {
        return result
      }
      // but we can resolve relative paths ("../income")
      const abstractPath = rawPath.replace(
        '..',
        this.abstractPath.replace(/\*\/.*/, '*')
      )
      const link = `<fact-link path="${abstractPath}" collectionId="${this.collectionId}">${rawPath}</fact-link>`
      return result.replace(`path="${rawPath}"`, `path="${link}"`)
    }, stringDefinition)

    const definitionElement = document.createElement('div')
    definitionElement.setAttribute('slot', 'definition')
    // The serialized fact XML (escaped above) with a <fact-link> spliced in per dependency —
    // arbitrary dictionary structure, so there is no fixed markup to put in a template.
    // eslint-disable-next-line no-restricted-syntax
    definitionElement.innerHTML = fullDefinition

    this.querySelector('[slot="definition"]')?.remove()
    this.append(definitionElement)
  }
}
customElements.define('audited-fact', AuditedFact)

// Fact-inspector "Add fact" button handler: tracks the fact named in the inspector input
// (`#fact-select`) under the collection id in `#fact-collection-id`, then clears the input.
function trackSelectedFact () {
  const factSelect = getFactSelect()
  const factPath = factSelect.value
  const collectionId = document.querySelector('#fact-collection-id').value
  if (factPath) {
    trackFact(factPath, collectionId)
    factSelect.value = ''
  }
}

/**
 * Add a fact to the fact-inspector's tracked list (and persist it to session storage so it survives
 * forward/back navigation). No-op beyond scrolling if the concrete fact is already tracked.
 * @param {string} path the abstract fact path
 * @param {string} collectionId collection item id to resolve a `*` wildcard, or '' for non-collection facts
 * @param {boolean} [setFocus=true] move focus to the newly added fact (skip when restoring on load)
 */
function trackFact (path, collectionId, setFocus = true) {
  const factPath = makeCollectionIdPath(path, collectionId)
  const auditedFactsList = document.querySelector('#audit-panel__fact-list')

  const existingFact = auditedFactsList.querySelector(
    `audited-fact[path="${factPath}"]`
  )
  if (existingFact) {
    return existingFact.scrollIntoView()
  }
  console.debug(`Tracking ${factPath}`)

  // Store the tracked fact in session storage so it persists across page reloads with forward/back navigation
  const storage = getAuditPanelStorage()
  const trackedFacts = storage.trackedFacts || []
  trackedFacts.push({ path, collectionId })
  setAuditPanelStorage('trackedFacts', trackedFacts)

  const auditedFact = document.createElement('audited-fact')
  auditedFact.setAttribute('path', path)
  auditedFact.setAttribute('collectionId', collectionId)

  auditedFactsList.appendChild(auditedFact)
  auditedFact.scrollIntoView()

  // Set focus to the newly added fact for accessibility, and remove the tabindex after focus is lost so the fact doesn't remain in the tab order unnecessarily
  if (setFocus) {
    auditedFact.setAttribute('tabindex', '-1')
    auditedFact.focus()

    auditedFact.addEventListener(
      'focusout',
      () => {
        auditedFact.removeAttribute('tabindex')
      },
      { once: true }
    )
  }
}

/**
 * Drop every tracked fact — what the Explain section's "Clear facts" button does. Its inline
 * `onclick="clearTrackedFacts()"` named a function that existed nowhere in the package, so the
 * button has been inert since the panel moved here; this is that function.
 */
function clearTrackedFacts () {
  setAuditPanelStorage('trackedFacts', [])
  document.querySelector('#audit-panel__fact-list')?.replaceChildren()
}

/**
 * Populate both fact-path datalists (fact-inspector `#fact-options` and chat `#chat-fact-options`)
 * with every path the fact graph knows about. Called once the graph is available.
 */
function setFactOptions () {
  const paths = window.factGraph.paths().sort()
  for (const list of document.querySelectorAll('#fact-options, #chat-fact-options')) {
    list.replaceChildren(
      ...paths.map((path) => {
        const option = document.createElement('option')
        option.value = path
        option.textContent = path
        return option
      })
    )
  }
}

// Enter in either fact-path input (fact-inspector + chat) tracks that input's own value — read off
// the event target, so Enter in the chat input doesn't track the inspector's.
function onFactPathKeydown (event) {
  if (event.key !== 'Enter') return
  const factPath = event.target.value
  const collectionId = document.querySelector('#fact-collection-id')?.value ?? ''
  if (factPath) {
    trackFact(factPath, collectionId)
    event.target.value = ''
  }
}

/**
 * Bind the Fact Inspector's controls inside a freshly cloned section. Replaces the inline
 * `onkeydown=`/`onclick=` attributes the templates used to carry: those need their handlers hung
 * on `window`, and are blocked outright by any Content-Security-Policy worth having.
 * @param {ParentNode} root the panel (or any container holding the cloned sections)
 */
function wireFactInspector (root) {
  for (const input of root.querySelectorAll('[data-fact-path-input]')) {
    input.addEventListener('keydown', onFactPathKeydown)
  }
  root.querySelector('[data-track-selected-fact]')?.addEventListener('click', trackSelectedFact)
  root.querySelector('[data-clear-tracked-facts]')?.addEventListener('click', clearTrackedFacts)
}

// Console helpers (ADR-004): reachable from devtools without a panel click.
window.trackSelectedFact = trackSelectedFact
window.clearTrackedFacts = clearTrackedFacts

export { trackFact, trackSelectedFact, clearTrackedFacts, setFactOptions, wireFactInspector }
