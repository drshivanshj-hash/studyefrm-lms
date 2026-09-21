// Study tools shared across the app: the universal per-tab notes section, and
// the Cycle phase ring. Both read/write only per-user data (db/25 + existing
// user_line_state), never content.
import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { getNotes, addNote, deleteNote } from '../lib/api'

const TAB_LABEL = {
  knowledge: 'this topic',
  assessment: 'these questions',
  osce: 'this station',
  appraisal: 'this paper',
  broader: 'related lines',
}

function when(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return d.toLocaleDateString()
}

// Universal comments section — identical on every tab, scoped to (line, tab).
export function TabNotes({ lineId, tab }) {
  const { session } = useAuth()
  const userId = session?.user?.id || null
  const [notes, setNotes] = useState([])
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let on = true
    if (!userId || !lineId) { setNotes([]); return undefined }
    getNotes(userId, lineId, tab).then((n) => { if (on) setNotes(n) })
    return () => { on = false }
  }, [userId, lineId, tab])

  async function submit(e) {
    e.preventDefault()
    if (!body.trim() || busy) return
    setBusy(true)
    const saved = await addNote({ userId, lineId, tab, body })
    setBusy(false)
    if (saved) { setNotes((n) => [saved, ...n]); setBody('') }
  }

  async function remove(id) {
    const ok = await deleteNote(userId, id)
    if (ok) setNotes((n) => n.filter((x) => x.id !== id))
  }

  if (!userId) return null

  return (
    <section className={'st-notes' + (open || notes.length ? ' open' : '')}>
      <button className="st-notes-h" onClick={() => setOpen((o) => !o)} aria-expanded={open || notes.length > 0}>
        <span className="st-notes-t">My notes on {TAB_LABEL[tab] || 'this tab'}</span>
        {notes.length ? <span className="st-count">{notes.length}</span> : null}
        <span className="st-caret" aria-hidden="true">▾</span>
      </button>

      <div className="st-notes-b">
        <form className="st-add" onSubmit={submit}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a note — a trap you fell for, a threshold to remember, a question to bring to your supervisor."
            rows={2}
          />
          <div className="st-add-foot">
            <span className="st-priv">Private to you</span>
            <button className="btn primary sm" type="submit" disabled={!body.trim() || busy}>
              {busy ? 'Saving…' : 'Add note'}
            </button>
          </div>
        </form>

        {notes.length ? (
          <ul className="st-list">
            {notes.map((n) => (
              <li key={n.id}>
                <p>{n.body}</p>
                <div className="st-meta">
                  <span>{when(n.created_at)}</span>
                  <button className="linkbtn" onClick={() => remove(n.id)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="st-empty">No notes yet on this tab.</p>}
      </div>
    </section>
  )
}

// Cycle phase ring — carried / due for review / not opened.
// Drawn as a conic gradient so it stays crisp at any size with no SVG maths.
export function PhaseRing({ carried = 0, due = 0, open = 0, size = 76 }) {
  const total = Math.max(1, carried + due + open)
  const a = (carried / total) * 100
  const b = a + (due / total) * 100
  const pct = Math.round((carried / total) * 100)
  return (
    <div
      className="st-ring"
      style={{
        width: size, height: size, flex: `0 0 ${size}px`,
        background: `conic-gradient(var(--phase-carried) 0 ${a}%, var(--phase-due) ${a}% ${b}%, var(--phase-track) ${b}% 100%)`,
      }}
      role="img"
      aria-label={`${pct}% carried, ${due} due for review, ${open} not opened`}
    >
      <b style={{ width: size - 16, height: size - 16 }}>{pct}<i>%</i></b>
    </div>
  )
}

export function PhaseLegend({ carried, due, open }) {
  return (
    <div className="st-legend">
      <span><i style={{ background: 'var(--phase-carried)' }} />Carried {carried}</span>
      <span><i style={{ background: 'var(--phase-due)' }} />Due review {due}</span>
      <span><i style={{ background: 'var(--phase-track)' }} />Not opened {open}</span>
    </div>
  )
}
