import { useMemo, useState } from 'react'
import PropTypes from 'prop-types'
import DOMPurify from 'dompurify'
import { renderFactExplanation } from './factRender.js'
import { ScenarioValueChip } from './scenarioValue.jsx'

export default function FactDetail({ fact, factLabel, onNavigate, scenarioValue }) {
  const [showXml, setShowXml] = useState(false)
  const { summaryHtml, xmlHtml } = useMemo(
    () => renderFactExplanation(fact, { factLabel }),
    [fact, factLabel]
  )
  // renderFactExplanation already escapes text content, but the result still
  // flows into dangerouslySetInnerHTML, so sanitize it too as defense in depth.
  // Sanitized inline (rather than via a memoized helper) so the DOMPurify call
  // sits directly between the raw HTML and the sink.
  const safeSummaryHtml = DOMPurify.sanitize(summaryHtml)
  const safeXmlHtml = DOMPurify.sanitize(xmlHtml)

  // Event-delegate clicks on navigable dependency names (data-nav-path).
  const onClick = (e) => {
    const hit = e.target.closest?.('[data-nav-path]')
    if (hit) onNavigate?.(hit.getAttribute('data-nav-path'))
  }
  const onKeyDown = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    const hit = e.target.closest?.('[data-nav-path]')
    if (hit) {
      e.preventDefault()
      onNavigate?.(hit.getAttribute('data-nav-path'))
    }
  }

  return (
    <>
      <h3 className="detail-title">{fact.name || fact.path}</h3>
      <p className="detail-path">
        <code>{fact.path}</code>
      </p>
      <p className="detail-meta">
        {fact.kind} · {fact.typeNode ?? '?'}
        {fact.sourceFile ? ` · ${fact.sourceFile}` : ''}
        {fact.taxYear ? ` · TY${fact.taxYear}` : ''}
      </p>
      {fact.description && <p className="detail-description">{fact.description}</p>}

      {scenarioValue && <ScenarioValueChip state={scenarioValue} />}

      <div className="detail-section__head">
        <strong className="detail-section__label">
          {fact.kind === 'writable' ? 'Input' : 'Derivation'}
        </strong>
        {fact.rawXml && (
          <button className="detail-xml-toggle" onClick={() => setShowXml((v) => !v)}>
            {showXml ? 'Show summary' : 'Show XML'}
          </button>
        )}
      </div>

      {showXml ? (
        <pre className="hr-xml-view">
          <code dangerouslySetInnerHTML={{ __html: safeXmlHtml }} />
        </pre>
      ) : (
        <div
          className="hr-body"
          onClick={onClick}
          onKeyDown={onKeyDown}
          dangerouslySetInnerHTML={{ __html: safeSummaryHtml }}
        />
      )}
    </>
  )
}

FactDetail.propTypes = {
  fact: PropTypes.shape({
    name: PropTypes.string,
    path: PropTypes.string,
    kind: PropTypes.string,
    typeNode: PropTypes.string,
    sourceFile: PropTypes.string,
    taxYear: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    description: PropTypes.string,
    rawXml: PropTypes.string,
  }).isRequired,
  factLabel: PropTypes.func,
  onNavigate: PropTypes.func,
  scenarioValue: PropTypes.shape({
    hasValue: PropTypes.bool,
    complete: PropTypes.bool,
    value: PropTypes.any,
  }),
}
