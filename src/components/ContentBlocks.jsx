// Shared v4 content-block renderer. Extracted verbatim from LineModule so the
// public ModuleReader renders the same block contract — clinical line modules and
// standalone reference modules (career/orientation) now share one renderer.
//
// Block contract (theory_sections.content_blocks):
//   'markdown'      { content }                      — GFM, so pipe tables work
//   'table'         { headers?, rows: [[cell,…],…] } — rich table, cells structured
//   'flow'          { steps: [step,…] }
//   'callout'       { tone?, title?, content|text }
//   'examiner_note' { title?, content|text }          — callout with the exam tone
//   'source'        { label?, citation|content }
// A bare string, or any unknown type carrying content/text, falls back to markdown.
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function Markdown({ children }) {
  return <div className="lm-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{String(children || '')}</ReactMarkdown></div>
}

export function StructuredText({ value }) {
  if (value === null || value === undefined || value === '') return <span>—</span>
  if (typeof value === 'number' || typeof value === 'boolean') return <>{String(value)}</>
  if (typeof value === 'string') return <Markdown>{value}</Markdown>
  if (Array.isArray(value)) return <ul className="lm-outcomes">{value.map((v, i) => <li key={i}><StructuredText value={v} /></li>)}</ul>
  return <div className="lm-structured">{Object.entries(value).map(([key, text]) => <div key={key}><b>{key.replaceAll('_', ' ')}</b><StructuredText value={text} /></div>)}</div>
}

export function ClinicalBlocks({ section }) {
  const blocks = Array.isArray(section.content_blocks) && section.content_blocks.length
    ? section.content_blocks
    : [{ type: 'markdown', content: section.content_md }]
  return (
    <div className="lm-clinical-blocks">
      {blocks.map((b, i) => {
        if (!b) return null
        if (typeof b === 'string') return <Markdown key={i}>{b}</Markdown>
        if (b.type === 'table' && Array.isArray(b.rows)) return (
          <div className="lm-table-wrap" key={i}><table className="lm-rich-table">
            {Array.isArray(b.headers) && <thead><tr>{b.headers.map((h, j) => <th key={j}>{h}</th>)}</tr></thead>}
            <tbody>{b.rows.map((row, j) => <tr key={j}>{row.map((cell, k) => <td key={k}><StructuredText value={cell} /></td>)}</tr>)}</tbody>
          </table></div>
        )
        if (b.type === 'flow' && Array.isArray(b.steps)) return <div className="lm-flow" key={i}>{b.steps.map((s, j) => <div className="lm-flow-step" key={j}><StructuredText value={s} /></div>)}</div>
        if (b.type === 'callout' || b.type === 'examiner_note') return <div className={'lm-callout ' + (b.tone || (b.type === 'examiner_note' ? 'exam' : 'info'))} key={i}>{b.title && <b>{b.title}</b>}<Markdown>{b.content || b.text}</Markdown></div>
        if (b.type === 'source') return <div className="lm-source-note" key={i}>{b.label || 'Source'}: {b.citation || b.content}</div>
        return <Markdown key={i}>{b.content || b.text || ''}</Markdown>
      })}
      {Array.isArray(section.exam_points) && section.exam_points.filter(Boolean).length > 0 && (
        <div className="lm-callout exam"><b>Exam focus</b><ul>{section.exam_points.filter(Boolean).map((p, i) => <li key={i}>{p}</li>)}</ul></div>
      )}
    </div>
  )
}
