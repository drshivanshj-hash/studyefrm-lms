import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { getNotes, addNote, deleteNote, flagTab } from '../lib/api'

// The five learning operations of the line workspace, in the order a candidate
// meets them. `id` doubles as the notes tab key, so existing notes stay attached.
export const SECTIONS = [
  { id: 'theory', name: 'Theory', ab: 'TH', short: 'THEORY', purpose: 'What is it?' },
  { id: 'evidence', name: 'Evidence & Vantage', ab: 'EV', short: 'EVIDENCE', purpose: 'What does the evidence say, and where do the authorities differ?' },
  { id: 'part1', name: 'Q-bank · Part 1', ab: 'QB', short: 'Q-BANK', purpose: 'Can I retrieve it and apply it?' },
  { id: 'osce', name: 'OSCE', ab: 'OS', short: 'OSCE', purpose: 'Can I reason, decide and defend a clinical decision?' },
  { id: 'appraisal', name: 'Appraisal', ab: 'AP', short: 'APPRAISAL', purpose: 'Can I critically evaluate the evidence?' },
]

function Ring({ pct = 0, ok = false, ab }) {
  const r = 13
  const c = 2 * Math.PI * r
  return (
    <span className="ws-ring" aria-hidden="true">
      <svg viewBox="0 0 32 32">
        <circle cx="16" cy="16" r={r} fill="none" stroke="var(--line)" strokeWidth="2.5" />
        {pct > 0 ? (
          <circle cx="16" cy="16" r={r} fill="none" stroke={ok ? 'var(--ok, #2E7D5B)' : 'var(--primary)'} strokeWidth="2.5"
            strokeLinecap="round" strokeDasharray={`${(c * Math.min(100, pct)) / 100} ${c}`} transform="rotate(-90 16 16)" />
        ) : null}
      </svg>
      <span className="ws-ab">{ab}</span>
      {ok ? <span className="ws-tick">✓</span> : null}
    </span>
  )
}

// Sidebar on laptops (collapses to a rail of rings), a sideways strip on phones.
export function SideNav({ current, states, onGo, mini, onTogglePin }) {
  return (
    <nav className={'ws-side' + (mini ? ' mini' : '')} aria-label="Sections of this line">
      <div className="ws-side-h">
        <span>This line</span>
        <button type="button" className="ws-pin" onClick={onTogglePin} title={mini ? 'Expand' : 'Collapse'}>{mini ? '›' : '‹'}</button>
      </div>
      {SECTIONS.map((s) => {
        const st = states[s.id] || {}
        return (
          <button key={s.id} type="button" className={'ws-si' + (current === s.id ? ' on' : '')}
            onClick={() => onGo(s.id)} title={s.name} aria-current={current === s.id ? 'page' : undefined}>
            <Ring pct={st.pct} ok={st.ok} ab={s.ab} />
            <span className="ws-si-tx">
              <span className="ws-si-nm">{s.name}</span>
              <span className={'ws-si-st' + (st.ok ? ' ok' : '')}>{st.text}</span>
            </span>
            <span className="ws-si-short">{s.short}</span>
          </button>
        )
      })}
      <div className="ws-side-foot">Progress saves as you go and follows you across devices.</div>
    </nav>
  )
}

// Explicit completion for sections without a page count (Evidence, OSCE, Appraisal).
export function DoneBar({ done, verb = 'done', busy, onToggle }) {
  return (
    <div className={'ws-done' + (done ? ' is-done' : '')}>
      {done
        ? <p>✓ Marked as {verb}. It shows as complete in your progress.</p>
        : <p>Worked through this section? Mark it so your progress stays accurate.</p>}
      {done
        ? <button type="button" className="linkbtn" disabled={busy} onClick={() => onToggle(false)}>Undo</button>
        : <button type="button" className="btn primary sm" disabled={busy} onClick={() => onToggle(true)}>Mark as {verb}</button>}
    </div>
  )
}

// One drawer for every section: private notes, and flags that reach the
// StudyEFRM team (read in the owner console).
export function NotesDrawer({ userId, lineId, lineCode, section, open, onClose, onCount }) {
  const [mode, setMode] = useState('mine') // 'mine' | 'flag'
  const [mine, setMine] = useState([])
  const [flags, setFlags] = useState([])
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let on = true
    setMine([]); setFlags([]); setBody('')
    if (!userId || !lineId) return undefined
    Promise.all([getNotes(userId, lineId, section.id), getNotes(userId, lineId, flagTab(section.id))])
      .then(([m, f]) => { if (on) { setMine(m); setFlags(f) } })
    return () => { on = false }
  }, [userId, lineId, section.id])

  useEffect(() => { onCount?.(mine.length + flags.length) }, [mine.length, flags.length]) // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e) {
    e.preventDefault()
    if (!body.trim() || busy) return
    setBusy(true)
    const tab = mode === 'mine' ? section.id : flagTab(section.id)
    const saved = await addNote({ userId, lineId, tab, body })
    setBusy(false)
    if (!saved) return
    if (mode === 'mine') setMine((n) => [saved, ...n]); else setFlags((n) => [saved, ...n])
    setBody('')
  }

  async function remove(id, which) {
    const ok = await deleteNote(userId, id)
    if (!ok) return
    if (which === 'mine') setMine((n) => n.filter((x) => x.id !== id)); else setFlags((n) => n.filter((x) => x.id !== id))
  }

  const list = mode === 'mine' ? mine : flags
  return createPortal(
    <>
      {open ? <div className="ws-scrim" onClick={onClose} aria-hidden="true" /> : null}
      <aside className={'ws-drawer' + (open ? ' open' : '')} aria-hidden={!open} aria-label="Notes">
        <div className="ws-dh">
          <div><h3>Notes</h3><div className="ws-dctx code">{lineCode} · {section.name}</div></div>
          <button type="button" className="ws-dx" onClick={onClose} aria-label="Close notes">✕</button>
        </div>
        <div className="ws-dtabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'mine'} className={mode === 'mine' ? 'on' : ''} onClick={() => setMode('mine')}>
            My note{mine.length ? ` · ${mine.length}` : ''}
          </button>
          <button type="button" role="tab" aria-selected={mode === 'flag'} className={'flag' + (mode === 'flag' ? ' on' : '')} onClick={() => setMode('flag')}>
            Flag for review{flags.length ? ` · ${flags.length}` : ''}
          </button>
        </div>
        <form className="ws-dbody" onSubmit={submit}>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4}
            placeholder={mode === 'mine'
              ? 'A trap you fell for, a threshold to remember, a question to bring to your supervisor…'
              : 'Something wrong, unclear or missing? Tell us what and where.'} />
          <div className="ws-dhelp">
            {mode === 'mine' ? 'Private to you. Saved against this line and section.' : 'Sent to the StudyEFRM editorial team. It stays listed here until it is resolved.'}
          </div>
          <button type="submit" className={'btn sm ' + (mode === 'mine' ? 'primary' : 'ws-flagbtn')} disabled={!body.trim() || busy}>
            {busy ? 'Saving…' : mode === 'mine' ? 'Save note' : 'Send for review'}
          </button>
          <ul className="ws-nlist">
            {list.map((n) => (
              <li key={n.id} className={mode === 'flag' ? 'fl' : ''}>
                <div className="ws-nmeta">
                  <span>{new Date(n.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
                  {mode === 'flag' ? <span className="ws-status">Received</span> : null}
                </div>
                <p>{n.body}</p>
                <button type="button" className="linkbtn" onClick={() => remove(n.id, mode)}>{mode === 'flag' ? 'Withdraw' : 'Delete'}</button>
              </li>
            ))}
          </ul>
        </form>
      </aside>
    </>,
    document.body,
  )
}
