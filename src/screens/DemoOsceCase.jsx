import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { getDemoOsceCase } from '../lib/api'

function asObject(value) {
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  return typeof value === 'object' ? value : {}
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean)
  if (!value) return []
  return []
}

function normalize(row) {
  const full = asObject(row.full_analysis)
  const card = asObject(row.teaching_card)
  return {
    caseCode: row.case_code,
    title: row.title,
    difficulty: row.difficulty,
    stations: asArray(row.stations),
    brief: asObject(full.candidate_brief),
    questions: asArray(full.examiner_questions),
    markScheme: asObject(full.mark_scheme),
    passVsDistinction: asObject(full.distinction_vs_pass),
    failTraps: asArray(full.fail_traps),
    sources: asArray(full.source_evidence),
    teachingCard: card,
  }
}

export default function DemoOsceCase() {
  const [row, setRow] = useState(undefined)
  const [err, setErr] = useState(null)

  useEffect(() => {
    getDemoOsceCase().then(setRow).catch((e) => setErr(e.message))
  }, [])

  const c = useMemo(() => row ? normalize(row) : null, [row])
  const total = c?.markScheme?.total_marks

  if (err) return <div className="wrap page-head"><p className="ds-body">Demo case could not load: {err}</p></div>
  if (row === undefined) return <div className="wrap page-head"><p className="ds-body">Loading demo OSCE case…</p></div>
  if (!c) return <Navigate to="/" replace />

  return (
    <div className="wrap fade-up demo-osce">
      <div className="breadcrumb" style={{ paddingTop: 20 }}>
        <Link to="/">Home</Link><span className="sep">›</span><span>Demo OSCE Case</span>
      </div>

      <div className="reader-head">
        <div className="eyebrow">Demo OSCE Case</div>
        <h1 className="page-h1">{c.title}</h1>
        <div className="mod-meta code">{c.caseCode} · {c.stations.join(' + ')} · D{c.difficulty} · {c.brief.time_available || '12 minutes'}</div>
      </div>

      <div className="reader-shell">
        <aside className="reader-rail">
          <a className="rail-item current" href="#brief"><span className="rail-mark">1</span><span className="rail-label">Candidate brief</span></a>
          <a className="rail-item" href="#questions"><span className="rail-mark">2</span><span className="rail-label">Examiner viva</span></a>
          <a className="rail-item" href="#marks"><span className="rail-mark">3</span><span className="rail-label">Mark scheme</span></a>
          <a className="rail-item" href="#traps"><span className="rail-mark">4</span><span className="rail-label">Fail traps</span></a>
          <a className="rail-item" href="#sources"><span className="rail-mark">5</span><span className="rail-label">Sources</span></a>
        </aside>

        <main className="reader-main demo-osce-main">
          <section id="brief" className="demo-sec">
            <div className="reader-stepmeta ds-meta">Candidate brief</div>
            <h2 className="rs-title2">Read the stem as the examiner will use it</h2>
            <div className="demo-card scenario">
              <div className="eyebrow">Clinical scenario</div>
              <p className="ds-body">{c.teachingCard.scenario || c.brief.scenario_text}</p>
            </div>
            {c.teachingCard.commonError && (
              <div className="demo-card danger">
                <div className="eyebrow">Common error</div>
                <p className="ds-body">{c.teachingCard.commonError}</p>
              </div>
            )}
            {c.teachingCard.eshreAnchor && (
              <div className="demo-card anchor">
                <div className="eyebrow">Guideline anchor</div>
                <p className="ds-body">{c.teachingCard.eshreAnchor}</p>
              </div>
            )}
            {c.brief.scenario_text && <pre className="demo-brief">{c.brief.scenario_text}</pre>}
          </section>

          <section id="questions" className="demo-sec">
            <div className="reader-stepmeta ds-meta">Examiner viva</div>
            <h2 className="rs-title2">Questions and model answers</h2>
            {c.questions.map((q, i) => (
              <details key={q.question_id || i} className="demo-q" open={i === 0}>
                <summary>
                  <span className="code">{q.question_id || `Q${i + 1}`}</span>
                  <span>{q.question}</span>
                  <b>{q.marks} marks</b>
                </summary>
                <div className="demo-q-body">
                  <p className="ds-body">{q.model_answer}</p>
                  {q.distinction_addition && <p className="demo-dist"><b>Distinction:</b> {q.distinction_addition}</p>}
                  {q.mark_breakdown && (
                    <ul className="mod-outcomes">
                      {Object.values(q.mark_breakdown).map((m, idx) => <li key={idx}>{m}</li>)}
                    </ul>
                  )}
                </div>
              </details>
            ))}
          </section>

          <section id="marks" className="demo-sec">
            <div className="reader-stepmeta ds-meta">Mark scheme</div>
            <h2 className="rs-title2">{total ? `${total} marks` : 'Mark scheme'}</h2>
            <div className="demo-marks">
              {c.markScheme.pass_mark && <span>Pass {c.markScheme.pass_mark}</span>}
              {c.markScheme.merit_mark && <span>Merit {c.markScheme.merit_mark}</span>}
              {c.markScheme.distinction_mark && <span>Distinction {c.markScheme.distinction_mark}</span>}
            </div>
            <div className="demo-cols">
              <div>
                <div className="eyebrow">Pass candidate</div>
                <ul className="mod-outcomes">{asArray(c.passVsDistinction.pass_candidate).map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
              <div>
                <div className="eyebrow">Distinction candidate also</div>
                <ul className="mod-outcomes">{asArray(c.passVsDistinction.distinction_candidate).map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
            </div>
          </section>

          <section id="traps" className="demo-sec">
            <div className="reader-stepmeta ds-meta">Examiner traps</div>
            <h2 className="rs-title2">What fails candidates</h2>
            {c.failTraps.map((t, i) => (
              <div key={t.trap_id || i} className="demo-trap">
                <b>{t.trap_description}</b>
                {t.examiner_probe && <p><span>Probe:</span> {t.examiner_probe}</p>}
                {t.correct_anchor && <p><span>Correct:</span> {t.correct_anchor}</p>}
              </div>
            ))}
          </section>

          <section id="sources" className="demo-sec">
            <div className="reader-stepmeta ds-meta">Sources</div>
            <h2 className="rs-title2">Evidence anchors</h2>
            <ol className="ref-list">{c.sources.map((s, i) => <li key={s.doc_id || i}>{s.citation}</li>)}</ol>
          </section>
        </main>
      </div>
    </div>
  )
}
