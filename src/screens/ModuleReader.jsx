import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getOrientationModules, ecmec } from '../lib/api'
import { ClinicalBlocks } from '../components/ContentBlocks'

function Overview({ mod }) {
  return (
    <div className="rstep">
      <p className="ds-body lead">{mod.needs_assessment}</p>
      {Array.isArray(mod.educational_outcomes) && mod.educational_outcomes.length > 0 && (
        <div className="ov-outcomes">
          <div className="eyebrow">After this module you will be able to</div>
          <ul className="mod-outcomes">
            {mod.educational_outcomes.map((o, i) => <li key={i}>{o}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

// Sections carrying content_blocks (tables, callouts) render through the shared v4
// block renderer; plain content_md still falls through it as a markdown block, so
// the existing orientation modules are unaffected apart from gaining real markdown.
function Section({ s }) {
  return (
    <div className="rstep">
      <ClinicalBlocks section={s} />
    </div>
  )
}

function Quiz({ assessment, passMark }) {
  const [answers, setAnswers] = useState({})
  const answered = Object.keys(answers).length
  const correct = assessment.reduce((n, q) => n + (answers[q.slug] === q.correct_answer ? 1 : 0), 0)
  const pct = assessment.length ? Math.round((correct / assessment.length) * 100) : 0
  const done = answered === assessment.length

  function pick(slug, key) {
    setAnswers((a) => (a[slug] ? a : { ...a, [slug]: key })) // lock once answered
  }

  return (
    <div className="rstep quiz">
      <div className="quiz-head">
        <div className="eyebrow">Self-test · {assessment.length} questions · pass mark {passMark}%</div>
        <div className={'quiz-score' + (done ? (pct >= passMark ? ' pass' : ' fail') : '')}>
          {correct}/{assessment.length}{done ? ` · ${pct}%` : ''}
        </div>
      </div>

      {assessment.map((q, qi) => {
        const chosen = answers[q.slug]
        return (
          <div className="quiz-q" key={q.slug || qi}>
            <div className="qq-stem"><span className="qq-n">Q{qi + 1}</span>{q.stem}</div>
            <div className="qq-opts">
              {Object.entries(q.options || {}).map(([key, text]) => {
                let cls = 'qq-opt'
                if (chosen) {
                  if (key === q.correct_answer) cls += ' correct'
                  else if (key === chosen) cls += ' wrong'
                  else cls += ' dim'
                }
                return (
                  <button key={key} className={cls} disabled={!!chosen} onClick={() => pick(q.slug, key)}>
                    <span className="qq-key">{key}</span><span>{text}</span>
                  </button>
                )
              })}
            </div>
            {chosen && (
              <div className={'qq-explain ' + (chosen === q.correct_answer ? 'ok' : 'no')}>
                <b>{chosen === q.correct_answer ? 'Correct.' : `Answer: ${q.correct_answer}.`}</b> {q.explanation}
              </div>
            )}
          </div>
        )
      })}

      {done && (
        <div className={'quiz-result ' + (pct >= passMark ? 'pass' : 'fail')}>
          {pct >= passMark
            ? `Passed — ${correct}/${assessment.length} (${pct}%).`
            : `${correct}/${assessment.length} (${pct}%) — below the ${passMark}% pass mark. Review and try again.`}
        </div>
      )}
    </div>
  )
}

function References({ refs }) {
  return (
    <div className="rstep">
      <ol className="ref-list">{refs.map((r, i) => <li key={i} className="ds-sm">{r}</li>)}</ol>
    </div>
  )
}

export default function ModuleReader() {
  const { slug } = useParams()
  const [mod, setMod] = useState(undefined) // undefined = loading, null = not found
  const [err, setErr] = useState(null)
  const [stepIdx, setStepIdx] = useState(0)
  const [visited, setVisited] = useState(() => new Set([0]))

  useEffect(() => {
    getOrientationModules()
      .then((list) => setMod(list.find((m) => m.slug === slug) || null))
      .catch((e) => setErr(e.message))
  }, [slug])

  const steps = useMemo(() => {
    if (!mod) return []
    const sections = (mod.sections || []).slice().sort((a, b) => a.sort_order - b.sort_order)
    const out = [{ id: 'overview', label: 'Overview', kind: 'overview' }]
    sections.forEach((s) => out.push({ id: 's' + s.section_number, label: s.section_number + '. ' + s.section_title, kind: 'section', data: s }))
    if (Array.isArray(mod.assessment) && mod.assessment.length) out.push({ id: 'quiz', label: 'Self-test', kind: 'quiz' })
    if (Array.isArray(mod.references) && mod.references.length) out.push({ id: 'refs', label: 'References', kind: 'references' })
    return out
  }, [mod])

  function go(i) {
    const n = Math.max(0, Math.min(steps.length - 1, i))
    setStepIdx(n)
    setVisited((v) => new Set(v).add(n))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (err) return <div className="wrap page-head"><p className="ds-body">Error: {err}</p></div>
  if (mod === undefined) return <div className="wrap page-head"><p className="ds-body">Loading…</p></div>
  if (mod === null) return <div className="wrap page-head"><p className="ds-body">Module not found. <Link to="/">Back to home</Link></p></div>

  const step = steps[stepIdx] || steps[0]
  const sectionTotal = (mod.sections || []).length
  const pct = steps.length > 1 ? Math.round((stepIdx / (steps.length - 1)) * 100) : 100
  const stepMeta = step.kind === 'overview' ? 'Overview'
    : step.kind === 'quiz' ? 'Self-test'
    : step.kind === 'references' ? 'References'
    : `Section ${step.data.section_number} of ${sectionTotal}`

  return (
    <div className="wrap fade-up">
      <div className="breadcrumb" style={{ paddingTop: 20 }}>
        <Link to="/">Home</Link><span className="sep">›</span><span>Orientation</span>
      </div>

      <div className="reader-head">
        <div className="eyebrow">Orientation module</div>
        <h1 className="page-h1">{mod.title}</h1>
        <div className="mod-meta code">~{mod.estimated_minutes} min · {ecmec(mod.estimated_minutes)} ECMEC · pass mark {mod.pass_mark}%</div>
      </div>

      <div className="reader-shell">
        <aside className="reader-rail">
          {steps.map((s, i) => (
            <button key={s.id}
              className={'rail-item' + (i === stepIdx ? ' current' : '') + (visited.has(i) && i !== stepIdx ? ' done' : '')}
              onClick={() => go(i)}>
              <span className="rail-mark">{visited.has(i) && i !== stepIdx ? '✓' : i + 1}</span>
              <span className="rail-label">{s.label}</span>
            </button>
          ))}
        </aside>

        <div className="reader-main">
          <div className="reader-progress"><div className="rp-fill" style={{ width: pct + '%' }} /></div>
          <div className="reader-stepmeta ds-meta">{stepMeta}</div>

          {step.kind === 'section' && <h2 className="rs-title2">{step.data.section_title}</h2>}
          {step.kind === 'quiz' && <h2 className="rs-title2">Check your understanding</h2>}
          {step.kind === 'references' && <h2 className="rs-title2">References</h2>}

          {step.kind === 'overview' && <Overview mod={mod} />}
          {step.kind === 'section' && <Section s={step.data} />}
          {step.kind === 'quiz' && <Quiz assessment={mod.assessment} passMark={mod.pass_mark} />}
          {step.kind === 'references' && <References refs={mod.references} />}

          <div className="reader-nav">
            <button className="btn secondary" disabled={stepIdx === 0} onClick={() => go(stepIdx - 1)}>← Back</button>
            <span className="rn-count ds-meta">{stepIdx + 1} / {steps.length}</span>
            {stepIdx < steps.length - 1
              ? <button className="btn primary" onClick={() => go(stepIdx + 1)}>Next →</button>
              : <Link className="btn primary" to="/">Finish</Link>}
          </div>
        </div>
      </div>

      <div className="reader-foot ds-meta">Prepared {mod.prepared_on} · expires {mod.expires_on} · StudyEFRM</div>
    </div>
  )
}
