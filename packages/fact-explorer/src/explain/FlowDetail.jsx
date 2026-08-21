import { useState } from 'react'
import PropTypes from 'prop-types'

export default function FlowDetail({ el }) {
  const rows = [
    ['Tag', el.tag],
    ['Page', el.pageId],
    ['Binds', el.factPath],
    ['Input', el.inputType],
    ['Options', el.optionsPath],
    ['Gate', el.gate && `${el.gate.kind} ${el.gate.factPath}`],
    [
      'Condition',
      el.condition?.factPath && `${el.condition.factPath} ${el.condition.operator ?? ''}`.trim(),
    ],
    [
      'Alert',
      el.alert &&
        `${el.alert.alertKey} (${el.alert.alertType}${el.alert.knockout ? ', knockout' : ''})`,
    ],
    ['Collection', el.collection && (el.collection.itemName || el.collection.addItemIfTrue)],
    ['Displays', el.fgShowPaths?.length ? el.fgShowPaths.join(', ') : null],
    ['Modal', el.modalLinkId],
  ].filter(([, v]) => v)

  const [showXml, setShowXml] = useState(false)

  return (
    <>
      <h3 className="detail-title">
        {el.questionText || el.headingText || el.alert?.alertKey || el.tag}
      </h3>
      <p className="detail-meta">
        <code>{el.id}</code>
      </p>

      <table className="detail-table">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td className="detail-table__key">{k}</td>
              <td className="detail-table__value">
                <code>{v}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {el.conditionalSpans?.length > 0 && (
        <div className="detail-spans">
          <strong className="detail-section__label">Conditional text</strong>
          <ul className="detail-spans__list">
            {el.conditionalSpans.map((s, i) => (
              <li key={i}>
                <code>
                  {s.conditionPath} {s.operator}
                </code>{' '}
                → “{s.text}”
              </li>
            ))}
          </ul>
        </div>
      )}

      {el.rawXml && (
        <div className="detail-rawxml">
          <button className="detail-xml-toggle" onClick={() => setShowXml((v) => !v)}>
            {showXml ? 'Hide XML' : 'Show XML'}
          </button>
          {showXml && (
            <pre className="hr-xml-view">
              <code>{el.rawXml}</code>
            </pre>
          )}
        </div>
      )}
    </>
  )
}

FlowDetail.propTypes = {
  el: PropTypes.shape({
    id: PropTypes.string,
    tag: PropTypes.string,
    pageId: PropTypes.string,
    factPath: PropTypes.string,
    inputType: PropTypes.string,
    optionsPath: PropTypes.string,
    gate: PropTypes.shape({
      kind: PropTypes.string,
      factPath: PropTypes.string,
    }),
    condition: PropTypes.shape({
      factPath: PropTypes.string,
      operator: PropTypes.string,
    }),
    alert: PropTypes.shape({
      alertKey: PropTypes.string,
      alertType: PropTypes.string,
      knockout: PropTypes.bool,
    }),
    collection: PropTypes.shape({
      itemName: PropTypes.string,
      addItemIfTrue: PropTypes.string,
    }),
    fgShowPaths: PropTypes.arrayOf(PropTypes.string),
    modalLinkId: PropTypes.string,
    questionText: PropTypes.string,
    headingText: PropTypes.string,
    conditionalSpans: PropTypes.arrayOf(
      PropTypes.shape({
        conditionPath: PropTypes.string,
        operator: PropTypes.string,
        text: PropTypes.string,
      })
    ),
    rawXml: PropTypes.string,
  }).isRequired,
}
