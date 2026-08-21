import { useMemo, useState } from 'react'
import PropTypes from 'prop-types'
import { renderFactExplanation } from './factRender.js'
import { ScenarioValueChip } from './scenarioValue.jsx'

export default function FactDetail({ fact, factLabel, onNavigate, scenarioValue }) {
  const [showXml, setShowXml] = useState(false)
  const { summaryHtml, xmlHtml } = useMemo(
    () => renderFactExplanation(fact, { factLabel }),
    [fact, factLabel]
  )

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
          <code dangerouslySetInnerHTML={{ __html: xmlHtml }} />
        </pre>
      ) : (
        <div
          className="hr-body"
          onClick={onClick}
          onKeyDown={onKeyDown}
          dangerouslySetInnerHTML={{ __html: summaryHtml }}
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
