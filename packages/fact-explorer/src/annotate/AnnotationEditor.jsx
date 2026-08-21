// Per-node annotation editor, mounted at the top of DetailPanel (M5).
// Reads/writes through the annotation store; one note (text + tag) per node id.
import { useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import { useAnnotation } from './hooks.js'
import { setAnnotation, deleteAnnotation } from './store.js'
import { ANNOTATION_TAG_STYLE } from '../canvas/style.js'

export default function AnnotationEditor({ nodeId }) {
  const existing = useAnnotation(nodeId)
  const [text, setText] = useState(existing?.text ?? '')
  const [tag, setTag] = useState(existing?.tag ?? 'note')

  // Reset the draft when the selected node changes (not when `existing` mutates,
  // so typing isn't clobbered by our own writes).
  useEffect(() => {
    const cur = existing
    setText(cur?.text ?? '')
    setTag(cur?.tag ?? 'note')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId])

  const dirty = text !== (existing?.text ?? '') || tag !== (existing?.tag ?? 'note')

  return (
    <section className="annotate-editor">
      <div className="annotate-editor__head">
        <strong className="annotate-editor__label">Annotation</strong>
        <span
          className="annotate-editor__dot"
          style={{ background: ANNOTATION_TAG_STYLE[tag]?.color ?? '#6b7785' }}
        />
        <select
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          className="annotate-editor__select"
        >
          {Object.entries(ANNOTATION_TAG_STYLE).map(([k, s]) => (
            <option key={k} value={k}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a note for this node…"
        rows={3}
        className="annotate-editor__textarea"
      />
      <div className="annotate-editor__actions">
        <button
          onClick={() => setAnnotation(nodeId, { text, tag })}
          disabled={!dirty}
          className="annotate-editor__btn"
        >
          Save
        </button>
        <button
          onClick={() => {
            deleteAnnotation(nodeId)
            setText('')
            setTag('note')
          }}
          disabled={!existing}
          className="annotate-editor__btn annotate-editor__btn--delete"
        >
          Delete
        </button>
        {existing && (
          <span className="annotate-editor__saved">
            saved {new Date(existing.updatedAt).toLocaleString()}
          </span>
        )}
      </div>
    </section>
  )
}

AnnotationEditor.propTypes = {
  nodeId: PropTypes.string.isRequired,
}
