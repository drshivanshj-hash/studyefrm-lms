import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDomainCoverage, getOsceLmsCases, getRegistryStats } from '../lib/api'
import { MiniTrace, clickable } from '../components/Primitives'

function DomainCard({ d, onOpen }) {
  return (
    <div className="card hoverable domcard" {...clickable(onOpen)}>
      <div className="dc-head">
        <div className="dc-num">{d.domain_number}</div>
        <div><div className="dc-name">{d.domain_name}</div></div>
        <span className="trace-stop" title="MRCOG → ATCRM → Guideline" onClick={(e) => e.stopPropagation()}><MiniTrace /></span>
      </div>
      <div className="dc-meta">
        <b>{d.lines}</b> syllabus lines<span className="dc-dot">·</span><b>{d.guidelines}</b> guidelines
      </div>
    </div>
  )
}

export default function CurriculumBrowser() {
  const nav = useNavigate()
  const [domains, setDomains] = useState(null)
  const [stats, setStats] = useState(null)
  const [osceStats, setOsceStats] = useState({ cases: 1, stations: 1 })
  const [err, setErr] = useState(null)

  useEffect(() => {
    getDomainCoverage().then(setDomains).catch((e) => setErr(e.message))
    getRegistryStats().then(setStats).catch(() => {})
    getOsceLmsCases().then((rows) => {
      const stations = new Set(rows.flatMap((r) => Array.isArray(r.stations) ? r.stations : (r.primary_domain ? [r.primary_domain] : [])))
      setOsceStats({ cases: rows.length || 1, stations: stations.size || 1 })
    }).catch(() => setOsceStats({ cases: 1, stations: 1 }))
  }, [])

  const totalLines = (domains || []).reduce((n, d) => n + Number(d.lines || 0), 0)

  return (
    <div className="wrap fade-up">
      <div className="page-head">
        <div className="eyebrow">Curriculum registry</div>
        <h1 className="page-h1">Curriculum browser</h1>
        <p className="page-lede">
          Every domain and line of the EFRM syllabus, each mapped to its MRCOG root and governing guideline.
        </p>
        <div className="reg-stats">
          <div className="rs"><b>{domains ? domains.length : '—'}</b><span>domains</span></div>
          <div className="rs"><b>{domains ? totalLines : '—'}</b><span>syllabus lines</span></div>
          <div className="rs"><b>{stats ? stats.knowledge_areas : '—'}</b><span>MRCOG roots</span></div>
          <div className="rs"><b>{stats ? stats.guideline_anchors : '—'}</b><span>guideline anchors</span></div>
        </div>
      </div>

      {err && <div className="ph"><div className="ph-s">Couldn’t load the curriculum: {err}</div></div>}
      {!domains && !err && <div className="ph"><div className="ph-s">Loading the curriculum…</div></div>}

      <div className="domgrid">
        <div className="card hoverable domcard osce-entry" {...clickable(() => nav('/app/osce'))}>
          <div className="dc-head">
            <div className="dc-num">O</div>
            <div><div className="dc-name">Part 2 OSCE Case Library</div></div>
          </div>
          <div className="dc-meta">
            <b>{osceStats.cases}</b> real case{osceStats.cases === 1 ? '' : 's'}<span className="dc-dot">·</span><b>{osceStats.stations}</b> exam station{osceStats.stations === 1 ? '' : 's'}
          </div>
          <div className="dc-foot">
            <span className="pill registry">
              <span className="dot" style={{ background: 'var(--primary)' }} />
              Full case analysis · examiner Q&amp;A
            </span>
          </div>
        </div>
        {(domains || []).map((d) => (
          <DomainCard key={d.domain_number} d={d} onOpen={() => nav(`/app/domain/${d.domain_number}`)} />
        ))}
      </div>
    </div>
  )
}
