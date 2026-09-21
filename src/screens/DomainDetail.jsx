import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getDomainByNumber, getDomainLines, getDomainCycle } from '../lib/api'
import { useAuth } from '../lib/auth'
import { KindBadge, GuidelineChip, clickable } from '../components/Primitives'
import { PhaseRing, PhaseLegend } from '../components/StudyTools'

const PHASE_TITLE = { carried: 'Carried', due: 'Due for review', open: 'Not opened yet' }

function LineRow({ line, onOpen, phase }) {
  const a = line.anchors && line.anchors[0]
  return (
    <div className="linerow" {...clickable(onOpen)}>
      <span className={'lr-phase ' + (phase || 'open')} title={PHASE_TITLE[phase] || PHASE_TITLE.open} aria-label={PHASE_TITLE[phase] || PHASE_TITLE.open} />
      <span className="lr-code code">{line.code}</span>
      <KindBadge kind={line.competency_kind} compact />
      <span className="lr-text">{line.line_text}</span>
      <span className="lr-g"><GuidelineChip g={a ? { src: a.body, name: a.name } : null} /></span>
      <span className="lr-arr">›</span>
    </div>
  )
}

// The Cycle view: where the candidate is in this domain, before the list of lines.
function CyclePanel({ cycle, domainName }) {
  if (!cycle || !cycle.total) return null
  const { carried, due, open, total } = cycle
  const phase = carried === 0 ? 'Not started'
    : carried / total >= 0.85 ? 'Consolidated'
    : carried / total >= 0.4 ? 'Consolidating'
    : 'Building'
  const line = carried === 0
    ? `${total} lines waiting. Open any line to begin.`
    : `${carried} of ${total} lines carried${due ? ` · ${due} due for review` : ''}${open ? ` · ${open} not opened` : ''}.`
  return (
    <section className="dd-cycle">
      <PhaseRing carried={carried} due={due} open={open} size={78} />
      <div className="dd-cycle-b">
        <span className="ds-eyebrow">Your phase in {domainName}</span>
        <h2 className="dd-cycle-h">{phase}</h2>
        <p className="dd-cycle-p">{line}</p>
        <PhaseLegend carried={carried} due={due} open={open} />
      </div>
    </section>
  )
}

export default function DomainDetail() {
  const { num } = useParams()
  const nav = useNavigate()
  const [domain, setDomain] = useState(undefined) // undefined=loading, null=not found
  const [lines, setLines] = useState(null)
  const [cycle, setCycle] = useState(null)
  const [err, setErr] = useState(null)
  const { session } = useAuth()
  const userId = session?.user?.id || null

  useEffect(() => {
    let on = true
    setDomain(undefined); setLines(null); setCycle(null); setErr(null)
    getDomainByNumber(Number(num))
      .then((d) => {
        if (!on) return
        setDomain(d)
        if (!d) return
        getDomainLines(d.domain_id)
          .then((ls) => {
            if (!on) return
            setLines(ls)
            // Phase comes from data that already exists (user_line_state.zone),
            // so this is a read, not a new tracking mechanism.
            getDomainCycle(userId, d.domain_id, ls).then((c) => on && setCycle(c))
          })
          .catch((e) => on && setErr(e.message))
      })
      .catch((e) => on && setErr(e.message))
    return () => { on = false }
  }, [num, userId])

  if (err) return <div className="wrap page-head"><p className="ds-body">Error: {err}</p></div>
  if (domain === undefined) return <div className="wrap page-head"><p className="ds-body">Loading…</p></div>
  if (!domain) return <div className="wrap page-head"><p className="ds-body">Domain not found. <Link to="/app">Back to curriculum</Link></p></div>

  return (
    <div className="wrap fade-up">
      <div className="page-head">
        <div className="breadcrumb">
          <Link to="/app">Curriculum</Link><span className="sep">›</span><span>Domain {domain.domain_number}</span>
        </div>
        <div className="dd-title">
          <div className="dc-num lg">{domain.domain_number}</div>
          <div><h1 className="page-h1" style={{ fontSize: 27 }}>{domain.domain_name}</h1></div>
        </div>
        <div className="dd-meta">
          <span><b>{domain.lines}</b> syllabus lines</span><span className="sep">·</span>
          <span><b>{domain.guidelines}</b> mapped guidelines</span>
        </div>
      </div>

      <CyclePanel cycle={cycle} domainName={domain.domain_name} />

      <div className="list-head">
        <span>Syllabus lines</span>
        <span className="list-count">{lines ? `${lines.length} lines` : ''}</span>
      </div>

      {err && <div className="ph"><div className="ph-s">{err}</div></div>}
      {!lines && !err && <div className="ph"><div className="ph-s">Loading lines…</div></div>}

      <div className="card linelist">
        {(lines || []).map((l) => (
          <LineRow
            key={l.code}
            line={l}
            phase={cycle?.byLine?.[l.id]?.phase}
            onOpen={() => nav(`/app/line/${l.code}`)}
          />
        ))}
      </div>
    </div>
  )
}
