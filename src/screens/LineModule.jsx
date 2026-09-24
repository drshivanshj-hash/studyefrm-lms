import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import {
  getLineModule, ecmec,
  saveQuizAttempt, getMyQuestionStats, getCohortQuestionStats, percentileBand,
  getMyMarks, toggleMark, getNodeProgress, markSectionViewed, setNodeCompleted,
  getNotes, addNote, deleteNote, getLineProgress, saveResume, signManuscripts, statsFromAttempts,
} from '../lib/api'
import { useAuth } from '../lib/auth'
import { KindBadge, TraceBlock } from '../components/Primitives'
import { SECTIONS, SideNav, NotesDrawer, DoneBar } from '../components/Workspace'
// Loaded only when a candidate actually opens the document view: keeps pdfjs
// (~340 KB) out of the bundle every other visitor downloads.
const PdfReader = lazy(() => import('../components/PdfReader'))
import { Markdown, StructuredText, ClinicalBlocks } from '../components/ContentBlocks'
import '../styles/module.css'

// Exam pacing. One flat budget of 75 s per ANSWERED item — one SBA, or one
// scenario of an EMQ. The deck flattens each EMQ group into its scenarios, so
// `items.length` counts scenarios, not groups: the budget is per answer given,
// which is the thing the candidate is actually racing.
//
// Where 75 comes from. EFRM Part 1 is 45 questions (22 SBA + 23 EMQ = 69
// scenarios) in 120 min — 91 answered items, so the real paper runs at about
// 79 s per answer. Owner's call, 24 Sep 2026: train DELIBERATELY UNDER real
// pace, "better to train ourselves on a q-bank of 8000 questions than to test
// ourselves on exam day and fail". 75 s is that margin. Do not relax it back
// towards 79 s or 90 s without the owner — the tightness is the point.
//
// This replaces a 120 s / 150 s split whose comment assumed 150 s per EMQ
// GROUP while the code charged it per SCENARIO: a 69-scenario paper was
// silently given 172 min instead of 120.
// MCQ is a 5-statement true/false block — extra practice, NOT part of the
// EFRM Part 1 blueprint. Override any of these per module via `secsPerItem`.
const SECS_PER_ITEM = { sba: 75, emq: 75, mcq: 75 }
const fmtClock = (s) => {
  const v = Math.max(0, Math.round(s))
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`
}

// ── MCQ (true/false block) ───────────────────────────────────────────────────
// Stored with no schema change: `type = 'MCQ'`, `options` holds the statements
// {A: '…', B: '…'}, and `correct_answer` is the T/F pattern in key order, e.g.
// 'FTTFT'. A candidate's answer is the same shape with '-' for unanswered.
const isMcq = (item) => item.type === 'MCQ'
const mcqKeys = (item) => Object.keys(item.options || {})

function setMcqAnswer(val, i, tf, len) {
  const arr = (val || '').padEnd(len, '-').split('')
  arr[i] = arr[i] === tf ? '-' : tf   // clicking the same value clears it
  return arr.join('')
}

function isAnswered(item, val) {
  if (!val) return false
  if (isMcq(item)) return val.length === mcqKeys(item).length && !val.includes('-')
  return true
}

// Answer points: an SBA or EMQ item is worth 1; an MCQ is worth one per
// statement, which is how the European papers mark them — so a candidate who
// gets 4 of 5 statements right is credited for 4.
function pointsFor(item, val) {
  if (isMcq(item)) {
    const keys = mcqKeys(item)
    const key = String(item.correct_answer || '')
    return {
      earned: keys.reduce((n, _s, i) => n + (val && val[i] !== '-' && val[i] === key[i] ? 1 : 0), 0),
      possible: keys.length,
    }
  }
  return { earned: val === item.correct_answer ? 1 : 0, possible: 1 }
}

function tallyPoints(items, answers) {
  return items.reduce((acc, q) => {
    const p = pointsFor(q, answers[q.key])
    return { earned: acc.earned + p.earned, possible: acc.possible + p.possible }
  }, { earned: 0, possible: 0 })
}

// Post-submission report: score vs pass mark, timing, the candidate's own
// history, and an AGGREGATE cohort comparison (no other candidate is named).
function ResultsPanel({ correct, total, pct, passMark, elapsed, auto, save, mine, cohort }) {
  const passed = pct >= passMark
  const band = percentileBand(pct, cohort)
  const priorBest = mine?.sessions?.length > 1 ? mine.bestPct : null
  return (
    <div className={'lm-result ' + (passed ? 'pass' : 'fail')}>
      {auto ? <div className="lm-result-auto">Time expired — your attempt was submitted automatically.</div> : null}
      <div className="lm-result-top">
        <div className="lm-result-score">
          <div className="big">{pct}<span>%</span></div>
          <div className="sub">{correct} of {total} correct · pass mark {passMark}%</div>
        </div>
        <div className={'lm-result-verdict ' + (passed ? 'ok' : 'no')}>{passed ? 'Pass' : 'Below pass mark'}</div>
      </div>

      <div className="lm-result-grid">
        <div><span className="k">Time used</span><b>{fmtClock(elapsed)}</b></div>
        <div><span className="k">Per question</span><b>{total ? Math.round(elapsed / total) : 0}s</b></div>
        {priorBest != null ? <div><span className="k">Your best</span><b>{priorBest}%</b></div> : null}
        {mine?.sessions?.length ? <div><span className="k">Attempts logged</span><b>{mine.sessions.length}</b></div> : null}
        {cohort?.candidates ? (
          <div><span className="k">Cohort average</span><b>{cohort.avgPct}%</b><span className="muted"> · {cohort.candidates} candidates</span></div>
        ) : null}
      </div>

      {band ? <div className={'lm-result-band ' + band.tone}>{band.label}</div> : null}

      <div className="lm-result-save">
        {save === 'saving' ? 'Saving your score…' : null}
        {save === 'saved' ? '✓ Score saved to your record' : null}
        {save === 'anon' ? 'Sign in to keep a record of this score.' : null}
        {save === 'error' ? 'Score shown above, but it could not be saved — check your connection.' : null}
      </div>
    </div>
  )
}

// End-of-exam screen. Shown inside the exam shell after submission, so the
// attempt has a proper ending rather than dropping the candidate back onto the
// line page. Mirrors what candidates see in the commercial banks: pacing,
// attempt rate, points against the pass mark, and a clear verdict.
function ExamResults({
  correct, total, pct, passMark, elapsed, budget, answered, items,
  auto, save, mine, cohort, kind, contextLabel,
  onReview, onRetake, onClose,
}) {
  const passed = pct >= passMark
  const passPoints = Math.ceil((passMark / 100) * total)
  const band = percentileBand(pct, cohort)
  const priorBest = mine?.sessions?.length > 1 ? mine.bestPct : null
  const verdict = !passed ? 'Not yet' : pct >= 85 ? 'Excellent' : pct >= 75 ? 'Strong pass' : 'Passed'
  const timeFrac = budget ? Math.min(1, elapsed / budget) : 0
  const attemptFrac = items ? answered / items : 0

  return (
    <div className="xr">
      <div className="xr-meters">
        <div className="xr-meter">
          <div className="xr-meter-h"><span>Time used</span><b>{fmtClock(elapsed)} / {fmtClock(budget)}</b></div>
          <div className="xr-bar"><span style={{ width: `${timeFrac * 100}%` }} /></div>
        </div>
        <div className="xr-meter">
          <div className="xr-meter-h"><span>Attempted</span><b>{answered} / {items}</b></div>
          <div className="xr-bar"><span className={attemptFrac === 1 ? 'full' : ''} style={{ width: `${attemptFrac * 100}%` }} /></div>
        </div>
      </div>

      {auto ? <div className="xr-auto">Time expired — your attempt was submitted automatically.</div> : null}

      <div className="xr-main">
        <div className="xr-left">
          <div className="ds-eyebrow">Results</div>
          <h2 className={'xr-verdict' + (passed ? ' ok' : ' no')}>{verdict}</h2>
          <p className="xr-line">
            Scored <b>{correct}</b> of <b>{total}</b> points. No marks are deducted for incorrect answers.
          </p>
          <div className="xr-meta">
            <div><span className="k">Paper</span>{contextLabel || kind}</div>
            <div><span className="k">Pass mark</span>{passPoints} points · {passMark}%</div>
            <div><span className="k">Per question</span>{items ? Math.round(elapsed / items) : 0}s</div>
            {priorBest != null ? <div><span className="k">Your best</span>{priorBest}%</div> : null}
            {cohort?.candidates ? <div><span className="k">Cohort average</span>{cohort.avgPct}% · {cohort.candidates} candidates</div> : null}
          </div>
          <div className={'xr-badge ' + (passed ? 'ok' : 'no')}>
            <span aria-hidden="true">{passed ? '✓' : '—'}</span>{passed ? 'PASSED' : 'NOT PASSED'}
          </div>
        </div>

        <div className="xr-score" role="img" aria-label={`${correct} of ${total} points, ${pct} percent`}>
          <div className={'xr-disc' + (passed ? ' ok' : ' no')}>
            <b>{correct}</b>
            <span>of {total}</span>
            <em>{pct}%</em>
          </div>
        </div>
      </div>

      {band ? <div className={'xr-band ' + band.tone}>{band.label}</div> : null}

      <div className="xr-save">
        {save === 'saving' ? 'Saving your score…' : null}
        {save === 'saved' ? '✓ Score saved to your record' : null}
        {save === 'anon' ? 'Sign in to keep a record of this score.' : null}
        {save === 'error' ? 'Score shown above, but it could not be saved — check your connection.' : null}
      </div>

      <div className="xr-actions">
        <button className="btn primary" onClick={onReview}>Review answers</button>
        <button className="btn secondary" onClick={onRetake}>New attempt</button>
        <button className="btn secondary" onClick={onClose}>Back to module</button>
      </div>
    </div>
  )
}

// Self-contained assessment deck. The parent remounts it (via `key`) when the
// paper or question type changes, which resets the attempt cleanly.
// A page is what the candidate sees at once. SBA and MCQ items are one per
// page; an EMQ is one page — lead-in and option list once, then its scenarios,
// each answered from a dropdown — as in the EFRM exam software. Scoring stays
// per scenario.
function buildPages(items) {
  const pages = []
  items.forEach((q, i) => {
    const group = q.groupOptions ? (q.emq_group_node || q.lead_in) : null
    const last = pages[pages.length - 1]
    if (group && last && last.group === group) last.idx.push(i)
    else pages.push({ group, idx: [i] })
  })
  return pages
}

export function AssessmentDeck({ items, passMark = 70, kind, atype, onGraded, result, save, mine, cohort, secsPerItem, contextLabel }) {
  const [answers, setAnswers] = useState({})
  const [index, setIndex] = useState(0)  // page index (see buildPages)
  const pages = useMemo(() => buildPages(items), [items])
  const pageOf = useMemo(() => {
    const m = []
    pages.forEach((p, pi) => p.idx.forEach((i) => { m[i] = pi }))
    return m
  }, [pages])
  const [submitted, setSubmitted] = useState(false)
  const [mode, setMode] = useState('exam')
  const [started, setStarted] = useState(false)
  const [reviewing, setReviewing] = useState(false)  // reading answers after the results screen
  const [closed, setClosed] = useState(false)        // candidate dismissed the exam shell
  const [elapsed, setElapsed] = useState(0)
  const perItem = secsPerItem || SECS_PER_ITEM[atype] || 90
  const budget = items.length * perItem
  const [left, setLeft] = useState(budget)
  const timings = useRef({})
  const mark = useRef(Date.now())
  // Grading reads this, never the `answers` closure. The clock's auto-submit
  // fires from a timer callback, which can hold a render-stale copy of state —
  // that would silently drop the answer a candidate gave in the final second.
  const answersRef = useRef({})
  // Flags persist across attempts and sessions, so a candidate can build a
  // "come back to this" list while working under time pressure.
  const { session } = useAuth()
  const flagUser = session?.user?.id || null
  const [marks, setMarks] = useState(() => ({ flag: new Set(), bookmark: new Set() }))
  const flags = marks.flag

  useEffect(() => {
    let on = true
    const ids = items.map((q) => q.node_id).filter(Boolean)
    if (!flagUser || !ids.length) return undefined
    getMyMarks(flagUser, ids).then((m) => { if (on) setMarks(m) })
    return () => { on = false }
  }, [flagUser, items])

  function onToggleMark(nodeId, markKind) {
    if (!nodeId) return
    const isOn = marks[markKind].has(nodeId)
    setMarks((m) => {
      const next = new Set(m[markKind])
      isOn ? next.delete(nodeId) : next.add(nodeId)
      return { ...m, [markKind]: next }
    })
    if (flagUser) toggleMark(flagUser, nodeId, markKind, !isOn)
  }

  // Accumulate wall-clock time against the page the candidate is leaving,
  // shared equally across its questions (one for SBA, the scenarios of an EMQ).
  function creditPage(pi) {
    const keys = (pages[pi]?.idx || []).map((i) => items[i]?.key).filter(Boolean)
    if (!keys.length) return
    const share = (Date.now() - mark.current) / 1000 / keys.length
    keys.forEach((k) => { timings.current[k] = (timings.current[k] || 0) + share })
  }
  useEffect(() => {
    mark.current = Date.now()
    return () => creditPage(index)
  }, [index, items]) // eslint-disable-line react-hooks/exhaustive-deps

  // The clock. Runs in both modes (practice records time, exam also counts down).
  useEffect(() => {
    if (!started || submitted) return undefined
    const id = window.setInterval(() => {
      setElapsed((e) => e + 1)
      if (mode === 'exam') setLeft((l) => l - 1)
    }, 1000)
    return () => window.clearInterval(id)
  }, [started, submitted, mode])

  // Auto-submit when the exam clock expires — exactly as a real paper closes.
  useEffect(() => {
    if (mode === 'exam' && started && !submitted && left <= 0) submit(true)
  }, [left, mode, started, submitted]) // eslint-disable-line react-hooks/exhaustive-deps

  function submit(auto = false) {
    if (submitted) return
    creditPage(index)
    mark.current = Date.now()
    setSubmitted(true)
    const graded = answersRef.current
    const { earned, possible } = tallyPoints(items, graded)
    onGraded({
      items, answers: graded, timings: { ...timings.current },
      correct: earned, total: possible,
      pct: possible ? Math.round((earned / possible) * 100) : 0,
      elapsed, auto,
    })
  }

  function restart() {
    setAnswers({}); answersRef.current = {}; setIndex(0); setSubmitted(false); setStarted(false)
    setReviewing(false); setClosed(false)
    setElapsed(0); setLeft(budget); timings.current = {}
    onGraded(null)
  }

  // Abandoning a timed attempt loses it, so make that explicit.
  function abandon() {
    if (!window.confirm('Leave this attempt? Your answers so far will not be scored or saved.')) return
    restart()
  }

  // While the exam owns the screen, the page behind it must not scroll.
  const running = mode === 'exam' && started && !submitted
  // The shell now survives submission so the attempt can end on a results
  // screen; it closes only when the candidate chooses to leave.
  const inShell = mode === 'exam' && started && !closed
  useEffect(() => {
    if (!inShell) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [inShell])

  if (!items.length) return null

  // ── Pre-flight: choose the mode before the clock starts ──
  if (!started) {
    return (
      <div className="lm-start">
        <div className="lm-start-h">{kind} · {items.length} question{items.length === 1 ? '' : 's'}</div>

        <ul className="lm-brief">
          <li><b>{items.length}</b> question{items.length === 1 ? '' : 's'}, worth <b>{tallyPoints(items, {}).possible}</b> mark{tallyPoints(items, {}).possible === 1 ? '' : 's'}</li>
          <li>Time allowed <b>{fmtClock(budget)}</b> in exam mode ({perItem}s per question)</li>
          <li>Pass mark <b>{passMark}%</b></li>
          <li><b>No negative marking</b> — an unanswered question simply scores zero</li>
          {items.some(isMcq) ? <li>True/false statements are marked <b>individually</b>, one point each</li> : null}
          <li>Answers and explanations stay hidden until you submit</li>
        </ul>
        <div className="lm-modes">
          <button className={'lm-mode' + (mode === 'exam' ? ' on' : '')} onClick={() => setMode('exam')}>
            <b>Exam mode</b>
            <span>Timed — {fmtClock(budget)} total ({perItem}s per question). Auto-submits at zero.</span>
          </button>
          <button className={'lm-mode' + (mode === 'practice' ? ' on' : '')} onClick={() => setMode('practice')}>
            <b>Practice mode</b>
            <span>Untimed. Your time is still recorded so you can track pacing.</span>
          </button>
        </div>
        <button className="btn primary" onClick={() => { mark.current = Date.now(); setStarted(true) }}>
          Start {mode === 'exam' ? 'timed attempt' : 'practice'}
        </button>
        <div className="lm-start-note">Your score is saved to your record. Check your connection before starting a timed attempt — the clock keeps running.</div>
      </div>
    )
  }

  const page = pages[index] || pages[0]
  const item = items[page.idx[0]]
  const chosen = answers[item.key]
  const markTools = (q) => (
    <div className="qq-tools">
      <button
        type="button"
        className={'lm-flagbtn' + (marks.flag.has(q.node_id) ? ' on' : '')}
        aria-pressed={marks.flag.has(q.node_id)}
        onClick={() => onToggleMark(q.node_id, 'flag')}
      >
        <span aria-hidden="true">{marks.flag.has(q.node_id) ? '★' : '☆'}</span>
        {marks.flag.has(q.node_id) ? 'Flagged for review' : 'Flag for review'}
      </button>
      <button
        type="button"
        className={'lm-flagbtn bm' + (marks.bookmark.has(q.node_id) ? ' on' : '')}
        aria-pressed={marks.bookmark.has(q.node_id)}
        title="Keep this question in your saved list"
        onClick={() => onToggleMark(q.node_id, 'bookmark')}
      >
        <span aria-hidden="true">{marks.bookmark.has(q.node_id) ? '◆' : '◇'}</span>
        {marks.bookmark.has(q.node_id) ? 'Bookmarked' : 'Bookmark'}
      </button>
    </div>
  )
  const firstQ = page.idx[0] + 1
  const lastQ = page.idx[page.idx.length - 1] + 1
  const setAnswer = (key, val) => setAnswers((a) => {
    const n = { ...a }
    if (val) n[key] = val
    else delete n[key]
    answersRef.current = n
    return n
  })
  const answered = items.reduce((n, q) => n + (isAnswered(q, answers[q.key]) ? 1 : 0), 0)
  const { earned: correct, possible: totalPoints } = tallyPoints(items, answers)
  const pct = totalPoints ? Math.round((correct / totalPoints) * 100) : 0
  const complete = answered === items.length
  const options = item.options || item.groupOptions || {}
  const low = mode === 'exam' && left <= 60
  const critical = mode === 'exam' && left <= 20
  // The exam room: the surface darkens for the duration of a timed attempt and
  // returns to paper on submission, so the mode change is the candidate's own
  // doing rather than an unexplained theme switch.
  const inFocus = inShell && !submitted

  const deckEl = (
    <div className={'lm-deck' + (inFocus ? ' lm-deck-focus' : '')}>
      <div className="lm-deck-head">
        <div>
          <div className="eyebrow">
            {page.group
              ? `${kind} · EMQ ${index + 1} of ${pages.length} · Questions ${firstQ}–${lastQ} of ${items.length}`
              : `${kind} · Question ${firstQ} of ${items.length}`}
          </div>
          <div className="lm-deck-progress"><span style={{ width: `${((index + 1) / pages.length) * 100}%` }} /></div>
        </div>
        <div className="lm-deck-meters">
          {!submitted ? (
            <div className={'lm-clock' + (critical ? ' critical' : low ? ' low' : '')} role="timer" aria-live={low ? 'assertive' : 'off'}>
              <span className="lm-clock-k">{mode === 'exam' ? 'Time left' : 'Elapsed'}</span>
              <b>{fmtClock(mode === 'exam' ? left : elapsed)}</b>
            </div>
          ) : null}
          <div className={'quiz-score' + (submitted ? (pct >= passMark ? ' pass' : ' fail') : '')}>
            {submitted ? `${correct}/${totalPoints} · ${pct}%` : `${answered}/${items.length} answered`}
          </div>
        </div>
      </div>

      {submitted && result && !inShell ? (
        <ResultsPanel {...result} passMark={passMark} save={save} mine={mine} cohort={cohort} />
      ) : null}

      {page.group ? (
        <article className="lm-flashcard lm-emq">
          {item.lead_in && <div className="lm-emq-lead"><b>Lead-in:</b> {item.lead_in}</div>}
          <ol className="lm-emq-optlist" style={{ '--rows': Math.ceil(Object.keys(options).length / 2) }}>
            {Object.entries(options).map(([k, t]) => (
              <li key={k}><b className="code">{k}</b><span>{t}</span></li>
            ))}
          </ol>
          {page.idx.map((qi) => {
            const q = items[qi]
            const val = answers[q.key] || ''
            const ok = submitted && val === q.correct_answer
            const verdict = !submitted ? '' : ok ? ' correct' : ' wrong'
            return (
              <section className={'lm-emq-scen' + verdict} key={q.key}>
                <div className="qq-stem"><span className="qq-n">Q{qi + 1}</span>{q.stem}</div>
                <label className="lm-emq-answer">
                  <span className="lm-emq-answer-k">Your answer</span>
                  <select
                    className="lm-emq-select"
                    value={val}
                    disabled={submitted}
                    aria-label={`Answer for question ${qi + 1}`}
                    onChange={(e) => setAnswer(q.key, e.target.value)}
                  >
                    <option value="">Select an option…</option>
                    {Object.entries(options).map(([k, t]) => <option key={k} value={k}>{k}. {t}</option>)}
                  </select>
                </label>
                {markTools(q)}
                {submitted && (
                  <div className={'qq-explain ' + (ok ? 'ok' : 'no')}>
                    <b>{ok ? 'Correct.' : `Answer: ${q.correct_answer}${options[q.correct_answer] ? ` — ${options[q.correct_answer]}` : ''}.`}</b> {q.explanation}
                  </div>
                )}
              </section>
            )
          })}
        </article>
      ) : (
      <article className="lm-flashcard">
        <div className="qq-stem"><span className="qq-n">Q{firstQ}</span>{item.stem}</div>
        {markTools(item)}
        {isMcq(item) ? (
          <div className="qq-mcq">
            <div className="qq-mcq-h">Mark each statement true or false · 1 point each</div>
            {Object.entries(options).map(([k, t], i) => {
              const given = (chosen || '')[i] || '-'
              const want = String(item.correct_answer || '')[i]
              const right = submitted && given === want
              const wrong = submitted && given !== '-' && given !== want
              return (
                <div className={'qq-stmt' + (right ? ' correct' : wrong ? ' wrong' : '')} key={k}>
                  <span className="qq-key">{k}</span>
                  <span className="qq-stmt-t">{t}</span>
                  <span className="qq-tf">
                    {['T', 'F'].map((tf) => (
                      <button
                        key={tf}
                        type="button"
                        className={'qq-tfb' + (given === tf ? ' on' : '') + (submitted && want === tf ? ' key' : '')}
                        disabled={submitted}
                        aria-pressed={given === tf}
                        onClick={() => setAnswers((a) => {
                          const n = { ...a, [item.key]: setMcqAnswer(a[item.key], i, tf, mcqKeys(item).length) }
                          answersRef.current = n
                          return n
                        })}
                      >{tf === 'T' ? 'True' : 'False'}</button>
                    ))}
                  </span>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="qq-opts">
            {Object.entries(options).map(([k, t]) => {
              let cls = 'qq-opt'
              if (chosen === k) cls += ' picked'
              if (submitted) cls += k === item.correct_answer ? ' correct' : (k === chosen ? ' wrong' : ' dim')
              return <button key={k} className={cls} disabled={submitted} onClick={() => setAnswers((a) => { const n = { ...a, [item.key]: k }; answersRef.current = n; return n })}><span className="qq-key">{k}</span><span>{t}</span></button>
            })}
          </div>
        )}
        {submitted && (() => {
          const p = pointsFor(item, chosen)
          const full = p.earned === p.possible
          return (
            <div className={'qq-explain ' + (full ? 'ok' : 'no')}>
              <b>{isMcq(item)
                ? `${p.earned} of ${p.possible} statements correct.`
                : full ? 'Correct.' : `Answer: ${item.correct_answer}.`}</b> {item.explanation}
            </div>
          )
        })()}
      </article>
      )}

      <div className="lm-deck-nav">
        <button className="btn secondary sm" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>Previous</button>
        <div className="lm-ovw" role="group" aria-label="Question overview">
          {items.map((q, i) => {
            const done = isAnswered(q, answers[q.key])
            const flagged = marks.flag.has(q.node_id)
            const here = pageOf[i] === index
            return (
              <button
                key={q.key}
                className={'lm-ovw-n' + (here ? ' on' : '') + (done ? ' done' : '') + (flagged ? ' flagged' : '')}
                onClick={() => setIndex(pageOf[i])}
                aria-current={here ? 'true' : undefined}
                aria-label={`Question ${i + 1}${done ? ', answered' : ', unanswered'}${flagged ? ', flagged' : ''}`}
              >{String(i + 1).padStart(2, '0')}</button>
            )
          })}
        </div>
        {index < pages.length - 1
          ? <button className="btn secondary sm" onClick={() => setIndex((i) => i + 1)}>Next</button>
          : <button className="btn primary sm" disabled={submitted || (mode === 'practice' && !complete)} onClick={() => submit(false)}>Submit answers</button>}
      </div>

      <div className="lm-deck-foot">
        {!submitted && mode === 'exam' && !complete ? <span>You may submit early — unanswered questions score zero.</span> : null}
        {!submitted && mode === 'practice' && !complete ? <span>Answer every question before submission.</span> : null}
        {!submitted && mode === 'exam' ? <button className="btn secondary sm" onClick={() => submit(false)}>Submit now</button> : null}
        {!inFocus ? <button className="btn secondary sm" onClick={restart}>{submitted ? 'Start new attempt' : 'Restart attempt'}</button> : null}
      </div>
    </div>
  )

  if (!inShell) return deckEl

  // A timed attempt takes the screen — during the paper AND for its result.
  // Portalling (rather than re-parenting in the React tree) keeps this
  // component mounted, so the clock and the answers survive the transition.
  const onResults = submitted && !reviewing
  return createPortal(
    <div className={'lm-exam-shell mode-focus' + (onResults ? ' done' : '')}
      role="dialog" aria-modal="true"
      aria-label={onResults ? 'Attempt results' : 'Timed attempt in progress'}>
      <div className="lm-exam-bar">
        <div className="lm-exam-ctx">
          {contextLabel ? <span className="lm-exam-code code">{contextLabel}</span> : null}
          <span className="lm-exam-kind">
            {onResults ? 'Attempt complete' : reviewing ? `${kind} · reviewing answers` : `${kind} · exam conditions`}
          </span>
        </div>
        {reviewing ? (
          <button className="btn secondary sm" onClick={() => setReviewing(false)}>Back to results</button>
        ) : submitted ? (
          <button className="btn secondary sm" onClick={() => setClosed(true)}>Close</button>
        ) : (
          <button className="btn secondary sm" onClick={abandon}>Leave attempt</button>
        )}
      </div>
      <div className="lm-exam-body">
        {onResults && result ? (
          <ExamResults
            {...result}
            passMark={passMark}
            budget={budget}
            answered={answered}
            items={items.length}
            save={save} mine={mine} cohort={cohort}
            kind={kind} contextLabel={contextLabel}
            onReview={() => setReviewing(true)}
            onRetake={restart}
            onClose={() => setClosed(true)}
          />
        ) : deckEl}
      </div>
    </div>,
    document.body
  )
}

function SourceText({ children }) {
  const parts = String(children || '').split(/(\[[A-Z][A-Z0-9 /&.-]+\])/g)
  return <>{parts.map((p, i) => /^\[[A-Z]/.test(p) ? <span className="lm-source-badge" key={i}>{p.slice(1, -1)}</span> : p)}</>
}

function EvidencePanel({ decon, recs, openRecs, toggleRec }) {
  const conv = decon?.evidence_summary?.convergence || []
  const div = decon?.divergences || []
  const table = decon?.appraisal?.table || []
  const grouped = [...new Map((recs || []).map((r) => [r.tier || 3, []])).entries()]
  ;(recs || []).forEach((r) => {
    const entry = grouped.find(([tier]) => tier === (r.tier || 3))
    if (entry) entry[1].push(r)
  })
  grouped.sort((a, b) => a[0] - b[0])
  return (
    <>
      <div className="lm-routine-intro"><b>Evidence &amp; vantage</b><span>Compare authorities, identify divergence, and drill from recommendations into their justification.</span></div>
      {(conv.length || div.length) ? <><div className="lm-h4">Multi-authority vantage</div><div className="lm-van">
        {conv.length ? <div className="lm-vcard conv"><div className="vh">Convergence — defend firmly</div><ul>{conv.map((x, i) => <li key={i}><SourceText>{x}</SourceText></li>)}</ul></div> : null}
        {div.length ? <div className="lm-vcard div"><div className="vh">Divergence — distinction-makers</div><ul>{div.map((x, i) => <li key={i}><SourceText>{x}</SourceText></li>)}</ul></div> : null}
      </div></> : null}
      {table.length > 0 && <div className="lm-table-wrap"><table className="lm-dv"><thead><tr><th>Feature</th><th>ESHRE/ASRM</th><th>NICE</th><th>Other</th></tr></thead><tbody>{table.map((r, i) => <tr key={i}>{r.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>}
      {decon && <div className="lm-h4">Graded recommendations · {decon.guideline_name} {decon.guideline_year || ''}</div>}
      {grouped.map(([tier, items]) => <section className={`lm-tier tier-${Math.min(tier, 3)}`} key={tier}>
        <div className="lm-tier-head">Tier {tier} · {items[0]?.tier_label || (tier === 1 ? 'non-negotiable' : tier === 2 ? 'apply, flag the evidence gap' : 'shared decision-making')}</div>
        {items.map((r) => <div className={'lm-rec' + (openRecs.has(r.id) ? ' open' : '')} key={r.id}>
          <div className="rt"><SourceText>{r.recommendation_text}</SourceText><div className="rm">{[r.source_meta?.authority, r.source_meta?.year, r.source_meta?.type, r.source_meta?.verb, r.grade, r.evidence_level].filter(Boolean).join(' · ')}</div></div>
          {(r.clinical_instruction || r.source_meta?.justification || r.source_meta?.pivotal_evidence || r.source_meta?.evidence_review_url || r.exam_traps?.length) && <><button className="lm-just-t" onClick={() => toggleRec(r.id)}>Justification ▾</button><div className="lm-just">
            {r.source_meta?.justification || r.clinical_instruction}
            {r.source_meta?.pivotal_evidence && <div className="lm-trial"><b>Pivotal evidence:</b> {r.source_meta.pivotal_evidence}</div>}
            {r.exam_traps?.length ? <div><b>Exam traps:</b> {r.exam_traps.join('; ')}</div> : null}
            {r.source_meta?.evidence_review_url && <a href={r.source_meta.evidence_review_url} target="_blank" rel="noreferrer">Open evidence review ↗</a>}
          </div></>}
        </div>)}
      </section>)}
    </>
  )
}

function OsceStation({ station }) {
  const rubric = station.model_answers?._rubric || {}
  const brief = station.candidate_brief || {}
  const scenario = brief.scenario || brief.scenario_text || station.trigger
  const investigations = brief.investigations || brief.results || brief.table
  return <div className="lm-osce">
    <div className="lm-osce-brief"><b>{station.station_number || brief.station_label || 'OSCE station'}</b>{scenario && <StructuredText value={scenario} />}
      {Array.isArray(investigations) && <div className="lm-table-wrap"><table className="lm-rich-table"><tbody>{investigations.map((r, i) => <tr key={i}>{(Array.isArray(r) ? r : [r.label, r.value]).map((c, j) => <td key={j}><StructuredText value={c} /></td>)}</tr>)}</tbody></table></div>}
    </div>
    {Object.entries(station.examiner_questions || {}).map(([k, q]) => <div className="lm-eq" key={k}><span className="qn">Q{k}.</span> <StructuredText value={typeof q === 'string' ? q : q.question || q.text || q} />{station.model_answers?.[k] ? <div className="model"><StructuredText value={station.model_answers[k]} /></div> : null}</div>)}
    {Array.isArray(rubric.mark_scheme) && <div className="lm-table-wrap"><table className="lm-mk"><thead><tr><th>Question</th><th>Marks</th><th>Distinction requirement</th></tr></thead><tbody>{rubric.mark_scheme.map((r, j) => <tr key={j}>{(Array.isArray(r) ? r : [r]).map((c, k) => <td key={k}><StructuredText value={c} /></td>)}</tr>)}</tbody></table></div>}
    {(rubric.pass || rubric.distinction) && <div className="lm-twocol"><div><div className="h">Pass candidate</div><StructuredText value={rubric.pass} /></div><div><div className="h">Distinction candidate also</div><StructuredText value={rubric.distinction} /></div></div>}
    {Array.isArray(rubric.fail) && rubric.fail.length > 0 && <><div className="lm-h4">Three things that fail candidates</div><ul className="lm-fail">{rubric.fail.map((f, j) => <li key={j}>{f}</li>)}</ul></>}
  </div>
}

// PICO may arrive as prose, as a {population,intervention,comparison,outcome} object,
// or (a Codex quirk) as that object serialised into a JSON string — render all three.
function Pico({ value }) {
  let v = value
  if (typeof value === 'string' && value.trim().startsWith('{')) { try { v = JSON.parse(value) } catch { v = value } }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const order = ['population', 'intervention', 'comparison', 'outcome']
    const keys = [...order.filter((k) => k in v), ...Object.keys(v).filter((k) => !order.includes(k))]
    return <ul className="lm-pico">{keys.map((k) => <li key={k}><b>{k[0].toUpperCase()}</b> · {k} — <StructuredText value={v[k]} /></li>)}</ul>
  }
  return <p className="ds-body">{v}</p>
}

function referenceKey(r) {
  return String(r.doi || r.url || r.citation || r.vancouver || r.title || r).trim().toLowerCase()
}

function ModuleReferences({ content, anchors = [] }) {
  const refs = []
  const add = (value) => {
    if (!value) return
    if (Array.isArray(value)) return value.forEach(add)
    if (typeof value === 'string') refs.push({ citation: value })
    else refs.push(value)
  }
  add(content.theory?.guidelines_synthesised)
  add(content.theory?.tag_legend?.references)
  add(anchors.map((anchor) => ({ title: [anchor.body, anchor.name, anchor.year].filter(Boolean).join(' · '), url: anchor.url })))
  add(content.evidenceDocuments)
  ;(content.recs || []).forEach((r) => add(r.source_meta?.references || r.source_meta?.citation))
  ;(content.osce || []).forEach((s) => add(s.candidate_brief?.source_evidence || s.source_evidence))
  ;(content.appraisals || []).forEach((a) => add(a.appraisal?.source_evidence || a.source_evidence))
  // Source rows also carry authoring bookkeeping (locators such as "owner-downloaded
  // article", internal "extract"/"synthesis" entries, mapping status). Candidates see
  // the citation itself and its link; the bookkeeping stays in the database.
  const label = (r) => String(r.vancouver || r.citation || r.title || r.doc_id || '').replace(/\s+adjacent\s*$/i, '').trim()
  const INTERNAL = /\b(internal|not seeded|standalone|owner|preview|module synthesis|science synthesis|extract)\b/i
  const unique = [...new Map(refs.filter(Boolean).map((r) => [referenceKey(r), r])).values()]
    .filter((r) => label(r) && !INTERNAL.test(label(r)))
  if (!unique.length) return null
  return <div className="lm-refs"><div className="lm-h4">References used in this line module</div><ol>{unique.map((r, i) => <li key={referenceKey(r) || i}>{label(r)}{r.doi ? <> · <a href={`https://doi.org/${r.doi}`} target="_blank" rel="noreferrer">doi</a></> : r.url ? <> · <a href={r.url} target="_blank" rel="noreferrer">source</a></> : null}</li>)}</ol></div>
}

function Collapsible({ title, children, open, onToggle, seen }) {
  return (
    <div className={'lm-sub' + (open ? ' open' : '') + (seen ? ' seen' : '')}>
      <div className="lm-sub-h" onClick={onToggle}>
        <span className="lm-seen" aria-hidden="true">{seen ? '✓' : ''}</span>
        <span className="t">{title}</span><span className="a">▶</span>
      </div>
      <div className="lm-sub-b">{children}</div>
    </div>
  )
}

// Completion by viewing: every section opened is the evidence. No self-declared
// zone, no assessment requirement — opening and reading is what's being recorded.
function CompletionPanel({ prog, total, signedIn, saving, onToggle, unit = 'sections' }) {
  if (!signedIn || !total) return null
  const seen = (prog?.viewed || []).filter((i) => i < total).length
  const allSeen = seen >= total
  const isDone = prog?.state === 'completed'
  return (
    <div className={'lm-complete' + (isDone ? ' done' : '')}>
      <div className="lm-complete-b">
        <div className="lm-complete-t">{isDone ? 'Completed' : allSeen ? (unit === 'pages' ? 'All pages read' : 'All sections opened') : 'Keep going'}</div>
        <div className="lm-complete-s">
          {seen} of {total} {unit === 'pages' ? 'pages read' : 'sections opened'}{!allSeen ? (unit === 'pages' ? ' — read on to finish this module' : ' — open the rest to finish this module') : ''}
        </div>
        <div className="lm-complete-bar"><span style={{ width: `${Math.round((seen / total) * 100)}%` }} /></div>
      </div>
      <button
        type="button"
        className={'lm-donebtn' + (isDone ? ' on' : '')}
        onClick={onToggle}
        disabled={saving || (!allSeen && !isDone)}
        title={!allSeen && !isDone ? (unit === 'pages' ? 'Read every page first' : 'Open every section first') : undefined}
      >
        <span aria-hidden="true">{isDone ? '✓' : '○'}</span>
        {isDone ? 'Completed' : 'Mark as completed'}
      </button>
    </div>
  )
}

function TheoryToc({ sections, openSection }) {  // openSection(i, total)
  if (!sections.length) return null
  return (
    <div className="lm-toc">
      {sections.map((s, i) => (
        <button key={s.id || i} onClick={() => openSection(i, sections.length)}>
          {`${i + 1}. `}{String(s.section_title || '').replace(/\s+—\s+.*/, '')}
        </button>
      ))}
    </div>
  )
}

// The six learning operations, in the order a candidate should meet them.
const PRIMARY_TABS = [
  { id: 'need', label: 'Need', short: 'NEED', purpose: 'Why does this matter?' },
  { id: 'theory', label: 'Theory', short: 'THEORY', purpose: 'What is it?' },
  { id: 'evidence', label: 'Evidence & Vantage', short: 'EVIDENCE', purpose: 'What does the evidence say, and where do the authorities differ?' },
  { id: 'part1', label: 'Part 1', short: 'PART 1', purpose: 'Can I retrieve it and apply it?' },
  { id: 'osce', label: 'OSCE', short: 'OSCE', purpose: 'Can I reason, decide and defend a clinical decision?' },
  { id: 'appraisal', label: 'Appraisal', short: 'APPRAISAL', purpose: 'Can I critically evaluate the evidence?' },
]

// Phones read reflowed text better than a scaled-down A4 page — Adobe's answer is
// "Liquid Mode". Same content, two presentations; laptops stay on the document.
const PHONE_QUERY = '(max-width: 760px)'
function usePhone() {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(PHONE_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY)
    const on = () => setM(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return m
}

function LiquidToggle({ mode, onChange }) {
  return (
    <div className="lm-liquid" role="group" aria-label="Reading mode">
      <button type="button" className={mode === 'text' ? 'on' : ''} onClick={() => onChange('text')}>Text</button>
      <button type="button" className={mode === 'pages' ? 'on' : ''} onClick={() => onChange('pages')}>Pages</button>
      <span className="lm-liquid-note">{mode === 'text' ? 'Reflowed for your screen — the same content as the document.' : 'The document, page by page.'}</span>
    </div>
  )
}

// How a related line connects to this one — the wording used in the build files.
const LINK_LABEL = { explains: 'Explains', applied_in: 'Applied in', related: 'Related', see_also: 'See also' }

// Competencies this line also carries, with the lens each one is studied through
// — the "also studied in (stars)" of the build files.
function BroaderStrip({ items }) {
  if (!items?.length) return null
  return (
    <div className="lm-broader-strip">
      <div className="lm-bs-k">Also studied in</div>
      <div className="lm-bs-list">
        {items.map((b, i) => (
          <Link className="lm-bs-i" key={b.code || i} to={`/app/line/${b.code}`}>
            <span className="lm-bs-top">
              <span className="code">{b.code}</span>
              <span className="lm-bs-t">{b.line_text || b.title}</span>
              {LINK_LABEL[b.link_type] ? <span className="lm-bs-rel">{LINK_LABEL[b.link_type]}</span> : null}
            </span>
            {b.lens ? <span className="lm-bs-lens">{b.lens}</span> : null}
          </Link>
        ))}
      </div>
    </div>
  )
}

function VisualResources({ items }) {
  if (!items.length) return null
  const isImage = (r) => {
    const url = String(r.storage_url || '').toLowerCase()
    const media = String(r.node?.media_type || '').toLowerCase()
    return media === 'image' || /\.(png|jpe?g|webp|gif|svg)(\?|#|$)/.test(url)
  }
  const isPdf = (r) => {
    const url = String(r.storage_url || '').toLowerCase()
    const media = String(r.node?.media_type || '').toLowerCase()
    return media === 'pdf' || /\.pdf(\?|#|$)/.test(url)
  }
  return (
    <div className="lm-visuals">
      {items.map((r, i) => {
        const title = r.node?.title || r.resource_type || `Visual ${i + 1}`
        return (
          <article className="lm-vis" key={r.node_id || i}>
            <div className="lm-vis-head">
              <div>
                <div className="lm-vis-title">{title}</div>
                <div className="lm-vis-meta code">{[r.resource_type, r.node?.slug].filter(Boolean).join(' · ')}</div>
              </div>
              {r.storage_url ? <a className="btn secondary sm" href={r.storage_url} target="_blank" rel="noreferrer">Open</a> : null}
            </div>
            {r.storage_url && isImage(r) ? (
              <div className="lm-vis-img"><img src={r.storage_url} alt={title} loading="lazy" /></div>
            ) : r.storage_url && isPdf(r) ? (
              <div className="lm-vis-file">PDF resource · opens in a new tab</div>
            ) : r.storage_url ? (
              <div className="lm-vis-file">External visual resource · opens in a new tab</div>
            ) : (
              <div className="lm-vis-file">Storage URL not attached yet.</div>
            )}
            {(r.file_size_mb || r.page_count) ? (
              <div className="lm-vis-foot">{r.file_size_mb ? `${r.file_size_mb} MB` : ''}{r.file_size_mb && r.page_count ? ' · ' : ''}{r.page_count ? `${r.page_count} pages` : ''}</div>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}

// ── Routine 3 / Station-7 Abstract Appraisal ────────────────────────────────
// Ingests one `abstract_appraisals` row (see db/04_phase1B_additive.sql):
//   appraisal JSONB  → { opening_line, evidence_level:{pyramid_key|rank}, domains[], bottom_line, verdict }
//   stats_summary JSONB → { primary_outcome, metrics[], sample_size:{n,powered,calculation}, analysis, interpretation }
//   biases TEXT[]    → ['selection','performance','detection','attrition','reporting','confounding', …]
// Every field is optional — Routine 3 may emit a partial payload; render defensively.
const PYRAMID = [
  { key: 'meta', label: 'Meta-analysis / Systematic review' },
  { key: 'rct', label: 'Randomised controlled trial' },
  { key: 'cohort', label: 'Cohort study' },
  { key: 'case_control', label: 'Case-control study' },
  { key: 'cross_sectional', label: 'Cross-sectional / diagnostic' },
  { key: 'case_series', label: 'Case series / case reports' },
  { key: 'expert', label: 'Expert opinion / editorial' },
]

const BIAS_GLOSSARY = {
  selection: 'Selection bias — entrants differ systematically from non-entrants. Ask: are these patients representative of my clinical population?',
  performance: 'Performance bias — participants/providers behave differently knowing allocation. Mitigated by blinding (ideally double-blind).',
  detection: 'Detection (assessment) bias — outcomes measured differently between groups. Mitigated by blinding outcome assessors.',
  attrition: 'Attrition bias — dropouts differ from completers. Ask dropout rate, reasons, balance; ITT is the most conservative analysis.',
  reporting: 'Reporting / publication bias — positive studies are more likely to be published; funnel plots detect it visually.',
  confounding: 'Confounding — a third variable linked to both exposure and outcome creates a false association. Mitigated by randomisation or multivariable adjustment.',
  recall: 'Recall bias — differential accuracy of recollection between cases and controls (typical in case-control designs).',
}

const VERDICT_COLOR = { ok: 'var(--ok)', caution: 'var(--authority)', flaw: 'var(--danger)', na: 'var(--ink-4)' }
const BOTTOM_LINE = {
  adopt: ['ok', 'Practice-changing — adopt'],
  adopt_selected: ['caution', 'Cautiously adopt in selected patients'],
  do_not_adopt: ['flaw', 'Do not change practice yet'],
}

function AppraisalReport({ a }) {
  const ap = a.appraisal || {}
  const stats = a.stats_summary || {}
  const domains = ap.domains || []
  const metrics = stats.metrics || []
  const biases = a.biases || []
  const [openD, setOpenD] = useState(() => new Set(domains.length ? [0] : []))
  const toggleD = (i) => setOpenD((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n })

  const plKey = ap.evidence_level && ap.evidence_level.pyramid_key
  const plIdx = PYRAMID.findIndex((p) => p.key === plKey)
  const pyramidRank = plIdx >= 0 ? plIdx + 1 : (ap.evidence_level && ap.evidence_level.rank) || 0
  const [bClass, bLabel] = BOTTOM_LINE[ap.verdict] || [null, null]
  const hasStats = stats.primary_outcome || metrics.length || stats.sample_size || stats.analysis || stats.interpretation

  return (
    <div className="lm-ap">
      <div className="lm-ap-head">
        <div className="lm-ap-title">{a.article_title || 'Untitled abstract'}</div>
        {(a.journal || a.publish_year || a.doi) && (
          <div className="lm-ap-cite">
            {[a.journal, a.publish_year].filter(Boolean).join(' · ')}
            {a.doi ? <> · <span className="code">{a.doi}</span></> : null}
          </div>
        )}
        {(a.study_design || a.grade) && (
          <div className="lm-ap-chips">
            {a.study_design ? <span className="lm-ap-chip design">{a.study_design}</span> : null}
            {a.grade ? <span className="lm-ap-chip grade">GRADE {a.grade}</span> : null}
          </div>
        )}
      </div>

      {a.pico ? <><div className="lm-h4">PICO</div><Pico value={a.pico} /></> : null}

      {ap.opening_line ? (
        <div className="lm-ap-opener"><div className="vh">How to open in the viva</div>{ap.opening_line}</div>
      ) : null}

      {pyramidRank ? (
        <>
          <div className="lm-h4">Hierarchy of evidence</div>
          <div className="lm-ap-pyramid">
            {PYRAMID.map((p, i) => (
              <div key={p.key} className={'lvl' + (i + 1 === pyramidRank ? ' on' : i + 1 < pyramidRank ? ' above' : '')} style={{ width: `${100 - i * 11}%` }}>{p.label}</div>
            ))}
          </div>
        </>
      ) : null}

      {domains.length ? (
        <>
          <div className="lm-h4">Critical appraisal — {domains.length} domains</div>
          {domains.map((d, i) => (
            <div className={'lm-ap-dom' + (openD.has(i) ? ' open' : '')} key={d.key || i}>
              <div className="lm-ap-dom-h" onClick={() => toggleD(i)}>
                <span className="lm-ap-dot" style={{ background: VERDICT_COLOR[d.verdict] || 'var(--ink-4)' }} />
                <span className="t">{d.n ? `${d.n}. ` : ''}{d.title}</span>
                <span className="a">▶</span>
              </div>
              <div className="lm-ap-dom-b">
                {d.findings ? <p>{d.findings}</p> : null}
                {d.examiner_probe ? <div className="lm-ap-probe"><b>Examiner probe:</b> {d.examiner_probe}</div> : null}
                {d.model_answer ? <div className="lm-ap-model"><b>Model answer:</b> {d.model_answer}</div> : null}
              </div>
            </div>
          ))}
        </>
      ) : null}

      {hasStats ? (
        <>
          <div className="lm-h4">Statistics</div>
          {stats.primary_outcome ? <p className="ds-body"><b>Primary outcome:</b> {stats.primary_outcome}</p> : null}
          {metrics.length ? (
            <table className="lm-ap-stats">
              <thead><tr><th>Measure</th><th>Estimate</th><th>95% CI</th><th>p</th><th>Interpretation</th></tr></thead>
              <tbody>
                {metrics.map((m, i) => (
                  <tr key={i} className={m.significant === true ? 'sig' : m.significant === false ? 'nonsig' : ''}>
                    <td><b>{m.label}</b></td><td>{m.value ?? '—'}</td><td>{m.ci || '—'}</td><td>{m.p || '—'}</td><td>{m.note || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {(stats.sample_size || stats.analysis) && (
            <div className="lm-ap-statmeta">
              {stats.sample_size ? <span><b>Sample</b> n={stats.sample_size.n ?? '—'} · {stats.sample_size.powered ? 'adequately powered' : 'power not demonstrated'}{stats.sample_size.calculation ? ` — ${stats.sample_size.calculation}` : ''}</span> : null}
              {stats.analysis ? <span><b>Analysis</b> {stats.analysis}</span> : null}
            </div>
          )}
          {stats.interpretation ? <p className="ds-body">{stats.interpretation}</p> : null}
        </>
      ) : null}

      {biases.length ? (
        <>
          <div className="lm-h4">Bias &amp; threats to validity</div>
          <div className="lm-ap-bias">
            {biases.map((b, i) => {
              const key = String(b).toLowerCase().split(/[\s_]/)[0]
              const desc = BIAS_GLOSSARY[key]
              return <div className="lm-ap-bchip" key={i}><b>{b}</b>{desc ? <span>{desc}</span> : null}</div>
            })}
          </div>
        </>
      ) : null}

      {a.applicability ? <><div className="lm-h4">Clinical applicability</div><p className="ds-body">{a.applicability}</p></> : null}

      {(bLabel || ap.bottom_line) ? (
        <div className={'lm-ap-bottom ' + (bClass || 'caution')}>
          <div className="vh">{bLabel || 'Bottom line'}</div>
          {ap.bottom_line ? <p>{ap.bottom_line}</p> : null}
        </div>
      ) : null}
    </div>
  )
}

export default function LineModule({ line, preloaded = null }) {
  const [c, setC] = useState(undefined)
  // ── line workspace: first visit → overview; afterwards → resume where they stopped
  const [view, setView] = useState(null)        // null = deciding | 'overview' | 'work'
  const [sec, setSec] = useState('theory')
  const [resumeSec, setResumeSec] = useState(null)
  const [resumePage, setResumePage] = useState(1)
  const [lp, setLp] = useState({})              // this candidate's progress rows on the line
  const [qStats, setQStats] = useState(null)    // Q-bank history across the whole line
  const [pinned, setPinned] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [noteCount, setNoteCount] = useState(0)
  const [toast, setToast] = useState(null)
  const [doneBusy, setDoneBusy] = useState(false)
  const [, setSignTick] = useState(0)          // re-render once the PDF link is signed
  const pageRef = useRef(1)
  const resumeTimer = useRef(null)
  const [tview, setTview] = useState(null) // null = automatic: text on phones, pages elsewhere
  const isPhone = usePhone()
  const [hls, setHls] = useState([])
  const [paper, setPaper] = useState('1')
  const [atype, setAtype] = useState('sba')
  const { session } = useAuth()
  const userId = session?.user?.id || null
  const [prog, setProg] = useState(null)       // viewing evidence for the theory node
  const [savingDone, setSavingDone] = useState(false)
  const [result, setResult] = useState(null)   // graded payload from the deck
  const [save, setSave] = useState('idle')     // idle|saving|saved|error|anon
  const [mine, setMine] = useState(null)       // this candidate's history
  const [cohort, setCohort] = useState(null)   // aggregate cohort stats
  const [openSubs, setOpenSubs] = useState(() => new Set([0]))
  const [openRecs, setOpenRecs] = useState(() => new Set())
  const [apprIdx, setApprIdx] = useState(0)

  useEffect(() => {
    let on = true; setC(undefined); setTview(null)
    if (preloaded) { setC(preloaded); return () => { on = false } }
    getLineModule(line.id)
      .then((d) => {
        if (!on) return
        setC(d)
      })
      .catch(() => on && setC({ empty: true }))
    return () => { on = false }
  }, [line.id])

  useEffect(() => {
    document.querySelector('.ws-si.on')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [sec, view])

  // Viewing evidence lives on the theory node — the thing with sections to open.
  const theoryId = c && !c.empty ? c.theory?.node_id || c.nodes?.find((n) => n.node_type === 'theory_module')?.id : null

  const allQIds = c && !c.empty
    ? [...(c.sba || []), ...(c.mcq || []), ...(c.emqGroups || []).flatMap((g) => g.items || [])].map((q) => q.node_id).filter(Boolean)
    : []

  // One read of everything the candidate has done on this line decides the
  // entry point: nothing yet → the overview; anything → straight back to work.
  useEffect(() => {
    let on = true
    setProg(null); setLp({}); setQStats(null); setResumeSec(null); setResumePage(1)
    setSec('theory'); setToast(null); setDrawer(false); setView(null)
    pageRef.current = 1
    if (!c) return undefined
    if (c.empty || !userId) { setView('overview'); return undefined }
    const nodeIds = (c.nodes || []).map((n) => n.id)
    // the one-request bundle already carries this candidate's progress + attempts
    const loaded = c.progress
      ? Promise.resolve([c.progress, statsFromAttempts(c.attempts || [])])
      : Promise.all([getLineProgress(userId, nodeIds), getMyQuestionStats(userId, allQIds)])
    loaded.then(([p, qs]) => {
      if (!on) return
      setLp(p); setQStats(qs)
      const tRow = theoryId ? p[theoryId] : null
      if (tRow) setProg(tRow)
      const r = tRow?.resume
      const rs = r?.sec && SECTIONS.some((x) => x.id === r.sec) ? r.sec : null
      if (rs) setResumeSec(rs)
      if (r?.page > 1) { setResumePage(r.page); pageRef.current = r.page }
      const started = Object.keys(p).length > 0 || (qs?.attempts || 0) > 0
      if (!started) { setView('overview'); return }
      const s2 = rs || 'theory'
      setSec(s2); setView('work')
      setToast(SECTIONS.find((x) => x.id === s2).name + (s2 === 'theory' && r?.page > 1 ? `, page ${r.page}` : ''))
      setTimeout(() => { if (on) setToast(null) }, 2800)
    })
    return () => { on = false }
  }, [c, userId]) // eslint-disable-line react-hooks/exhaustive-deps

  // The bundle arrives unsigned so the page can paint at once; the private PDF
  // link is signed in the background and the reader opens when it lands.
  useEffect(() => {
    if (!c || c.empty) return undefined
    const pending = (c.resources || []).some((r) => r.resource_type === 'manuscript' && r.storage_url && !r.signed_url && !/^(https?:)?\/\//i.test(r.storage_url))
    if (!pending) return undefined
    let on = true
    signManuscripts(c.resources).then(() => { if (on) setSignTick((t) => t + 1) })
    return () => { on = false }
  }, [c])

  // Remember where the candidate is (section + PDF page) so the line reopens there.
  function scheduleResume(nextSec) {
    if (!userId || !theoryId) return
    clearTimeout(resumeTimer.current)
    resumeTimer.current = setTimeout(() => { saveResume(userId, theoryId, { sec: nextSec, page: pageRef.current }) }, 1500)
  }
  useEffect(() => {
    if (view === 'work') scheduleResume(sec)
    return () => clearTimeout(resumeTimer.current)
  }, [view, sec]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let on = true
    setHls([])
    if (!userId) return undefined
    getNotes(userId, line.id, 'knowledge').then((rows) => {
      if (!on) return
      setHls((rows || []).flatMap((r) => {
        if (!r.anchor) return []
        try {
          const a = JSON.parse(r.anchor)
          return a && a.page ? [{ id: r.id, body: r.body, anchor: a }] : []
        } catch { return [] }
      }))
    })
    return () => { on = false }
  }, [userId, line.id])

  async function addHighlight(sel) {
    if (!userId) return
    const body = window.prompt('Note for this highlight (optional):', sel.text.slice(0, 120)) 
    if (body === null) return
    const saved = await addNote({
      userId, lineId: line.id, tab: 'knowledge',
      body: body.trim() || sel.text.slice(0, 160),
      anchor: JSON.stringify(sel),
    })
    if (saved) setHls((h) => [...h, { id: saved.id, body: saved.body, anchor: sel }])
  }

  async function removeHighlight(id) {
    const ok = await deleteNote(userId, id)
    if (ok) setHls((h) => h.filter((x) => x.id !== id))
  }

  // Called as each section is opened. Opening IS the evidence.
  async function onSectionOpened(i, total) {
    if (!userId || !theoryId) return
    if (prog?.viewed?.includes(i) && prog?.total === total) return
    const next = await markSectionViewed(userId, theoryId, i, total)
    if (next) setProg(next)
  }

  function onPageViewed(i, tot) {
    pageRef.current = i + 1
    onSectionOpened(i, tot)
    scheduleResume('theory')
  }

  function enter(s2) { setSec(s2); setView('work'); window.scrollTo({ top: 0 }) }
  function go(s2) { setSec(s2); setDrawer(false); window.scrollTo({ top: 0 }) }

  async function toggleDone() {
    if (!userId || !theoryId || savingDone) return
    const next = prog?.state !== 'completed'
    setSavingDone(true)
    setProg((p) => ({ ...(p || { viewed: [], total: 0 }), state: next ? 'completed' : 'in_progress' }))
    const ok = await setNodeCompleted(userId, theoryId, next, prog?.viewed || [], prog?.total || 0)
    setSavingDone(false)
    if (!ok) setProg((p) => ({ ...p, state: next ? 'in_progress' : 'completed' }))
  }

  if (c === undefined || view === null) return <div className="lm"><div className="ph"><div className="ph-s">Loading module…</div></div></div>

  const hasTheory = c.theory || (c.sections && c.sections.length)
  const hasEvidence = c.decon || (c.recs && c.recs.length)
  // The manuscript is this line's primary document: one PDF per line, held in the
  // private bucket and opened through a signed URL. Everything else attached to the
  // line (Routine 4 flowcharts, atlases) renders as a visual in the same tab.
  const manuscriptRes = (c.resources || []).find((r) => r.resource_type === 'manuscript') || null
  const manuscriptUrl = manuscriptRes
    ? manuscriptRes.signed_url || (/^(https?:)?\/\//i.test(String(manuscriptRes.storage_url || '')) ? manuscriptRes.storage_url : null)
    : null
  // Several older library_resources rows still hold repo-relative authoring paths
  // rather than an uploaded URL; those render as "not attached yet", never a 404.
  const visualRes = (c.resources || []).filter((r) => r.resource_type !== 'manuscript')
  const theoryMode = tview || (isPhone && hasTheory ? 'text' : 'pages')
  const hasVisuals = visualRes.length > 0
  const hasAssess = (c.sba && c.sba.length) || (c.emqGroups && c.emqGroups.length) || (c.mcq && c.mcq.length)
  const hasOsce = c.osce && c.osce.length
  const hasAppraisal = c.appraisals && c.appraisals.length
  const hasBroader = c.broader && c.broader.length

  const anchors = line.anchors || []
  const anchor = anchors.find((a) => /ESHRE/i.test(a.body || '')) || anchors[0]
  const pactRow = (line.frameworks || []).find((f) => f.framework_nodes?.curriculum_frameworks?.code === 'EBCOG.PACT')
  const pact = pactRow ? (pactRow.framework_nodes.title || pactRow.framework_nodes.code) : null
  const traceNotes = { root: line.root?.note || null, pact: pactRow?.note || null, guideline: anchor?.note || null }

  const deconId = (c.nodes || []).find((n) => n.node_type === 'guideline')?.id
  const doneIds = {
    evidence: deconId ? [deconId] : [],
    osce: (c.osce || []).map((o) => o.node_id).filter(Boolean),
    appraisal: (c.appraisals || []).map((a) => a.node_id).filter(Boolean),
  }
  const isDone = (k) => doneIds[k].length > 0 && doneIds[k].every((id) => lp[id]?.state === 'completed')
  async function markDone(k, v) {
    if (!userId || doneBusy) return
    setDoneBusy(true)
    const ok = await Promise.all(doneIds[k].map((id) => setNodeCompleted(userId, id, v)))
    if (ok.every(Boolean)) {
      setLp((p) => ({ ...p, ...Object.fromEntries(doneIds[k].map((id) => [id, { ...(p[id] || { viewed: [], total: 0 }), state: v ? 'completed' : 'in_progress' }])) }))
    }
    setDoneBusy(false)
  }

  const tTotal = prog?.total || manuscriptRes?.page_count || (c.sections || []).length || 0
  const tSeen = (prog?.viewed || []).filter((i) => i < tTotal).length
  const tPct = tTotal ? Math.round((tSeen / tTotal) * 100) : 0
  const tOk = prog?.state === 'completed' || tPct >= 90
  const passMark = Number(c.theory?.pass_mark) || 70
  const doneState = (k, verb) => {
    if (!doneIds[k].length) return { pct: 0, ok: false, text: '' }
    return isDone(k) ? { pct: 100, ok: true, text: verb + ' ✓' } : { pct: 0, ok: false, text: 'Not started' }
  }
  const secStates = {
    theory: { pct: tOk ? 100 : tPct, ok: tOk, text: tOk ? 'Read ✓' : tSeen ? `${tSeen}/${tTotal} ${manuscriptRes ? 'pages' : 'sections'}` : 'Not started' },
    evidence: doneState('evidence', 'Reviewed'),
    part1: qStats?.attempts
      ? { pct: qStats.lastPct || 0, ok: (qStats.bestPct || 0) >= passMark, text: `Last ${qStats.lastPct}% · best ${qStats.bestPct}%` }
      : { pct: 0, ok: false, text: allQIds.length ? `${allQIds.length} questions` : '' },
    osce: doneState('osce', 'Done'),
    appraisal: doneState('appraisal', 'Done'),
  }

  const toggle = (set, setter, i) => { const n = new Set(set); n.has(i) ? n.delete(i) : n.add(i); setter(n) }
  const openSection = (i, total) => { setOpenSubs((s) => new Set([...s, i])); onSectionOpened(i, total) }
  const sbaPaper = (c.sba || []).filter((q) => String(q.paper || '1') === paper)
  const mcqPaper = (c.mcq || []).filter((q) => String(q.paper || '1') === paper)
  const emqPaper = (c.emqGroups || []).filter((g) => String(g.paper || '1') === paper)
  const activeItems = atype === 'sba'
    ? sbaPaper
    : atype === 'mcq'
      ? mcqPaper
      : emqPaper.flatMap((g) => (g.items || []).map((it) => ({ ...it, lead_in: g.lead_in, groupOptions: g.options })))
  const resetAttempt = () => { setResult(null); setSave('idle'); setMine(null); setCohort(null) }
  const switchAssessment = (next) => { next(); resetAttempt() }

  // Grade → persist the attempt → load the candidate's history and the
  // aggregate cohort comparison. Saving is best-effort: a failure never blocks
  // the candidate from seeing their result.
  async function handleGraded(graded) {
    if (!graded) { resetAttempt(); return }
    setResult(graded)
    const nodeIds = [...new Set(graded.items.map((q) => q.node_id).filter(Boolean))]
    if (!userId) {
      setSave('anon')
    } else {
      setSave('saving')
      const res = await saveQuizAttempt({
        userId, items: graded.items, answers: graded.answers, timings: graded.timings,
      })
      setSave(res.error ? 'error' : 'saved')
    }
    const [m, co] = await Promise.all([
      userId ? getMyQuestionStats(userId, nodeIds) : Promise.resolve(null),
      getCohortQuestionStats(nodeIds),
    ])
    setMine(m); setCohort(co)
    if (userId) getMyQuestionStats(userId, allQIds).then((qs) => qs && setQStats(qs))
  }

  const secMeta = SECTIONS.find((s) => s.id === sec) || SECTIONS[0]
  const qCount = (c.sba || []).length + (c.mcq || []).length + (c.emqGroups || []).reduce((n, g) => n + (g.items || []).length, 0)
  const sizes = {
    theory: manuscriptRes?.page_count ? `${manuscriptRes.page_count}-page document` : (c.sections || []).length ? `${c.sections.length} sections` : '',
    evidence: (c.recs || []).length ? `${c.recs.length} graded recommendations` : '',
    part1: qCount ? `${qCount} questions` : '',
    osce: hasOsce ? `${c.osce.length} examiner viva${c.osce.length === 1 ? '' : 's'}` : '',
    appraisal: hasAppraisal ? `${c.appraisals.length} paper${c.appraisals.length === 1 ? '' : 's'} to appraise` : '',
  }
  const outcomes = Array.isArray(c.theory?.educational_outcomes) ? c.theory.educational_outcomes : []
  const miniSide = !isPhone && sec === 'theory' && !pinned

  if (view === 'overview') {
    return (
      <div className="lm ws-ov fade-up">
        <div className="lv-head">
          <div className="lv-codeline"><span className="code lv-code">{line.code}</span><KindBadge kind={line.competency_kind} /></div>
          <h1 className="lv-text">{line.line_text}</h1>
        </div>
        <div className="ws-cta ws-cta-top">
          <button type="button" className="btn primary" onClick={() => enter(resumeSec || 'theory')}>{resumeSec ? 'Continue →' : 'Start with Theory →'}</button>
        </div>

        <div className="ws-eye">Where this sits</div>
        <TraceBlock
          root={line.root?.name || 'MRCOG foundation'}
          pact={pact}
          line={{ code: line.code, kind: line.competency_kind, text: line.line_text }}
          guideline={anchor ? { src: anchor.body, name: anchor.name } : null}
          orientation={isPhone ? 'col' : 'row'}
          notes={traceNotes}
        />
        {c.theory && (c.theory.estimated_minutes || c.theory.pass_mark || anchors.length) ? (
          <div className="lm-meta">
            {c.theory.estimated_minutes ? <span><b>Est.</b> {c.theory.estimated_minutes} min</span> : null}
            {ecmec(c.theory.estimated_minutes) ? <span><b>ECMEC</b> {ecmec(c.theory.estimated_minutes)}</span> : null}
            {c.theory.pass_mark ? <span><b>Pass</b> {c.theory.pass_mark}%</span> : null}
            {anchors.length ? <span><b>Anchors</b> <span className="code">{anchors.map((a) => a.code).join(' · ')}</span></span> : null}
          </div>
        ) : null}

        {(c.theory?.needs_assessment || outcomes.length) ? (
          <>
            <div className="ws-eye">Why this matters</div>
            <div className="ws-need">
              {c.theory?.needs_assessment ? (
                <div className="card ws-card"><h3>The need</h3><StructuredText value={c.theory.needs_assessment} /></div>
              ) : null}
              {outcomes.length ? (
                <div className="card ws-card">
                  <h3>After this line you will be able to</h3>
                  <ul className="ws-outc">{outcomes.map((o, i) => <li key={i}>{typeof o === 'string' ? o : [o.verb, o.statement].filter(Boolean).join(' ')}</li>)}</ul>
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        <div className="ws-eye">Your path through this line</div>
        <div className="ws-path">
          {SECTIONS.map((s, i) => (
            <button type="button" key={s.id} className="ws-pstep" onClick={() => enter(s.id)}>
              <span className="n">{String(i + 1).padStart(2, '0')}</span>
              <span className="h">{s.name}</span>
              <span className="p">{s.purpose}</span>
              {sizes[s.id] ? <span className="sz">{sizes[s.id]}</span> : null}
            </button>
          ))}
        </div>

        <div className="ws-cta">
          <button type="button" className="btn primary" onClick={() => enter(resumeSec || 'theory')}>{resumeSec ? 'Continue →' : 'Start with Theory →'}</button>
          <span className="ws-cta-note">Next time you open this line, you’ll go straight back to where you stopped.</span>
        </div>

        <BroaderStrip items={c.broader} />

        {c.theory && (
          <div className="lm-gov">
            <div className="lm-gov-grid">
              <div><span className="k">Primary line</span> <span className="code">{line.code}</span> ({line.competency_kind})</div>
              <div><span className="k">Anchors</span> <span className="code">{anchors.map((a) => a.code).join(' · ') || '—'}</span></div>
            </div>
            <ModuleReferences content={c} anchors={anchors} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={'lm ws' + (miniSide ? ' side-mini' : '')}>
      <div className="ws-head">
        <span className="code ws-code">{line.code}</span>
        <span className="ws-title">{line.line_text}</span>
        <button type="button" className="ws-ovbtn" onClick={() => setView('overview')}>Overview</button>
      </div>

      <SideNav current={sec} states={secStates} onGo={go} mini={miniSide} onTogglePin={() => setPinned((p) => !p)} />

      <main className="ws-main">
        {toast ? <div className="ws-toast" role="status">Resumed · <b>{toast}</b></div> : null}
        <div className="ws-mhead">
          <h2>{secMeta.name}</h2>
          <span className="ws-q">{secMeta.purpose}</span>
          {userId ? (
            <button type="button" className="ws-notesbtn" onClick={() => setDrawer(true)}>
              Notes{noteCount ? <span className="c">{noteCount}</span> : null}
            </button>
          ) : null}
        </div>

        {sec === 'theory' && (<>
          {isPhone && hasTheory && manuscriptRes ? <LiquidToggle mode={theoryMode} onChange={setTview} /> : null}
          {theoryMode === 'pages' && manuscriptRes && !manuscriptUrl ? (
            <div className="ph"><div className="ph-s">Opening the document…</div></div>
          ) : theoryMode === 'pages' && manuscriptUrl ? (
          <>
            <Suspense fallback={<div className="ph"><div className="ph-s">Opening the document…</div></div>}>
              <PdfReader
                url={manuscriptUrl}
                title={manuscriptRes.node?.title || line.code}
                highlights={hls}
                onAddHighlight={addHighlight}
                onDeleteHighlight={removeHighlight}
                onPageViewed={onPageViewed}
                initialPage={resumePage}
              />
            </Suspense>
            <CompletionPanel
              prog={prog}
              total={prog?.total || manuscriptRes?.page_count || 0}
              signedIn={!!userId}
              saving={savingDone}
              onToggle={toggleDone}
              unit="pages"
            />
            {hasVisuals ? <VisualResources items={visualRes} /> : null}
          </>
        ) : hasTheory ? (
          <>
            <TheoryToc sections={c.sections} openSection={openSection} />
            {c.sections.map((sct, i) => (
              <Collapsible
                key={sct.id || i}
                title={`${i + 1}. ${sct.section_title}`}
                open={openSubs.has(i)}
                seen={prog?.viewed?.includes(i)}
                onToggle={() => { toggle(openSubs, setOpenSubs, i); if (!openSubs.has(i)) onSectionOpened(i, c.sections.length) }}
              >
                <ClinicalBlocks section={sct} />
              </Collapsible>
            ))}
            <CompletionPanel
              prog={prog}
              total={c.sections.length}
              signedIn={!!userId}
              saving={savingDone}
              onToggle={toggleDone}
            />
            {hasVisuals ? <VisualResources items={visualRes} /> : null}
          </>
        ) : null}
        </>)}

        {sec === 'evidence' && (hasEvidence ? (
          <>
            <EvidencePanel decon={c.decon} recs={c.recs} openRecs={openRecs} toggleRec={(id) => toggle(openRecs, setOpenRecs, id)} />
            {userId && doneIds.evidence.length ? <DoneBar done={isDone('evidence')} verb="reviewed" busy={doneBusy} onToggle={(v) => markDone('evidence', v)} /> : null}
          </>
        ) : null)}

        {sec === 'part1' && (hasAssess ? (
          <>
            <div className="lm-stabbar">
              <span className={'lm-stab' + (paper === '1' ? ' on' : '')} onClick={() => switchAssessment(() => setPaper('1'))}>Paper 1 · Diagnosis &amp; Physiology</span>
              <span className={'lm-stab' + (paper === '2' ? ' on' : '')} onClick={() => switchAssessment(() => setPaper('2'))}>Paper 2 · Treatment</span>
            </div>
            <div className="lm-stabbar">
              <span className={'lm-stab' + (atype === 'sba' ? ' on' : '')} onClick={() => switchAssessment(() => setAtype('sba'))}>SBA · {sbaPaper.length}</span>
              <span className={'lm-stab' + (atype === 'emq' ? ' on' : '')} onClick={() => switchAssessment(() => setAtype('emq'))}>EMQ · universal format</span>
              {mcqPaper.length ? <span className={'lm-stab' + (atype === 'mcq' ? ' on' : '')} onClick={() => switchAssessment(() => setAtype('mcq'))}>MCQ · {mcqPaper.length}</span> : null}
            </div>
            {activeItems.length ? (
              <AssessmentDeck
                key={`${paper}-${atype}`}
                items={activeItems}
                atype={atype}
                passMark={c.theory?.pass_mark || 70}
                kind={atype === 'sba' ? 'Single best answer' : atype === 'mcq' ? 'Multiple true/false' : 'Extended matching question'}
                contextLabel={`${line.code} · Paper ${paper}`}
                onGraded={handleGraded}
                result={result}
                save={save}
                mine={mine}
                cohort={cohort}
              />
            ) : null}
          </>
        ) : null)}

        {sec === 'osce' && (hasOsce ? (
          <>
            {c.osce.map((st, i) => <OsceStation station={st} key={st.node_id || i} />)}
            {userId && doneIds.osce.length ? <DoneBar done={isDone('osce')} busy={doneBusy} onToggle={(v) => markDone('osce', v)} /> : null}
          </>
        ) : null)}

        {sec === 'appraisal' && (hasAppraisal ? (() => {
          const idx = Math.min(apprIdx, c.appraisals.length - 1)
          return (
            <>
              {c.appraisals.length > 1 && (
                <div className="lm-stabbar">
                  {c.appraisals.map((a, i) => (
                    <span key={a.node_id || i} className={'lm-stab' + (idx === i ? ' on' : '')} onClick={() => setApprIdx(i)}>
                      Paper {i + 1}{a.study_design ? ` · ${a.study_design}` : ''}
                    </span>
                  ))}
                </div>
              )}
              <AppraisalReport key={idx} a={c.appraisals[idx]} />
              {userId && doneIds.appraisal.length ? <DoneBar done={isDone('appraisal')} busy={doneBusy} onToggle={(v) => markDone('appraisal', v)} /> : null}
            </>
          )
        })() : null)}

        {userId ? (
          <NotesDrawer userId={userId} lineId={line.id} lineCode={line.code} section={secMeta}
            open={drawer} onClose={() => setDrawer(false)} onCount={setNoteCount} />
        ) : null}
      </main>
    </div>
  )
}
